/* Scaffolding for step 4, slice 2 (docs/entities.md, section 7), sub-step (b): every stored file gets a copy
   under the SHA-256 digest of its bytes, which becomes its key in R2 (the digest alone, no folder, no name).
   The old keys (media/<code>/<file>) stay where they are and the site goes on using them until sub-step (d).
   This file, its three routes in editor.js, the Library's button and the table old_key all go in sub-step (e).

   Who does what: working out a digest means reading every byte, and the free plan gives a Worker 10 milliseconds
   of processor time, so the browser reads each file and works out its digest. The copy itself is made here, from
   R2 to R2, streamed (no processing), and the digest is handed to R2 with it: R2 works out the SHA-256 of what
   it receives and refuses the copy if it differs (Cloudflare's documented way to check an upload). So what the
   browser says is never taken on trust, and a row in old_key is a fact about the stored bytes.

   It can be stopped and run again: only keys with no row in old_key are left to do. */

import { listAll, Bad } from './library.js';

const OLD = /^media\/[0-9a-f]{8}\/[a-z0-9./-]+$/;
const DIGEST = /^[0-9a-f]{64}$/;
const TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic',
  heif: 'image/heif', tif: 'image/tiff', tiff: 'image/tiff', mp4: 'video/mp4' };
const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

/* The old keys still to do, and how many are done. */
async function survey(env) {
  const [objects, rows] = await Promise.all([listAll(env, 'media/'), env.DB.prepare('SELECT key FROM old_key').all()]);
  const done = new Set(rows.results.map((r) => r.key));
  const all = objects.filter((o) => OLD.test(o.key));
  return { total: all.length, todo: all.filter((o) => !done.has(o.key)).map((o) => ({ key: o.key, bytes: o.size })) };
}

/* How many files still wait (for the Library's button; 0 hides it). */
export async function waiting(env) {
  return (await survey(env)).todo.length;
}

/* GET /edit/api/digest/todo: { total, todo: [{ key, bytes }] } */
export async function todo(env) {
  if (!env.MEDIA) throw new Bad('File storage (R2) is not switched on', 503);
  return survey(env);
}

/* GET /edit/api/digest/file?key=media/<code>/<file>: the file's bytes, originals included, to the signed-in
   editor only, for the browser to work out its digest. */
export async function file(env, key) {
  if (!OLD.test(key)) throw new Bad('Bad file name');
  const obj = await env.MEDIA.get(key);
  if (!obj) throw new Bad('That file isn\'t in storage', 404);
  return new Response(obj.body, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(obj.size),
    'cache-control': 'private, no-store' } });
}

/* POST /edit/api/digest/store { key, digest }: copy the file to the key <digest>, R2 checking the digest. The
   copy is made even if that digest is already stored (the same bytes again, so nothing changes), because the
   check is what proves this key's bytes have that digest. */
export async function store(env, key, digest) {
  if (!OLD.test(key)) throw new Bad('Bad file name');
  if (!DIGEST.test(digest)) throw new Bad('Bad digest');
  const src = await env.MEDIA.get(key);
  if (!src) throw new Bad('That file isn\'t in storage', 404);
  const type = src.httpMetadata?.contentType || TYPES[key.split('.').pop()] || 'application/octet-stream';
  try {
    await env.MEDIA.put(digest, src.body, { sha256: digest, httpMetadata: { contentType: type } });
  } catch (e) {
    throw new Bad(`Storage refused the copy (the digest didn't match the stored file, or the copy failed): ${e.message || e}`, 409);
  }
  await env.DB.prepare('INSERT OR REPLACE INTO old_key (key, digest, bytes, type, at) VALUES (?, ?, ?, ?, ?)')
    .bind(key, digest, src.size, type, now()).run();
  return { key, digest, bytes: src.size };
}
