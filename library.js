/* The library (step 1d): every file the site keeps in R2, as items, for the editor's Library tab.

   One item for each thing uploaded: a photo, or a video (one or several versions, a set). Each has a code, 8 hex
   digits made when it's created, and one folder in R2, media/<code>/, holding everything that belongs to it
   (paths.js has the layout). Its name is the Library's own (the `library` table, migrations/), shown and
   changed freely: the folder never changes, so History and Cloudflare's cached copies never break, and the code
   in the Library is what to look for in R2.

   An item's parts: its original (a photo as uploaded), each set of sizes made from it (r1, r2...), each video
   version (<w>x<h>.mp4), each set of video frames (wide-1, tall-1...). What uses an item: entries' drafts and
   published versions, and History (revisions' data: what "Bring back" restores), by its code (media) and the
   parts they name (for a removal, what it was before, which "Bring back" restores). "Delete for good": the whole item only while no draft or published version uses it (if
   History does, it must be asked for, and those versions leave History); a part only while nothing at all does.

*/

import { CODE } from './paths.js';
import { dimensions, HEAD_BYTES } from './dimensions.js';

const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
class Bad extends Error { constructor(m, s = 400) { super(m); this.status = s; } }
export { Bad };

const SECTIONS = { hero: 'Hero', contact: 'Contact', footer: 'Footer' };

/* Every key under a prefix, with its size and upload time. */
export async function listAll(env, prefix) {
  const out = [];
  let cursor;
  do {
    const page = await env.MEDIA.list({ prefix, limit: 1000, cursor });
    for (const o of page.objects) out.push({ key: o.key, size: o.size, uploaded: o.uploaded });
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

/* Which part of its item a file is: 'original', 'r1', '1536x1152' (a video version), 'wide-1', or 'other'. */
export function partOf(rest) {
  if (/^original\.[a-z0-9]{1,5}$/.test(rest)) return 'original';
  const dir = /^((?:r|wide-|tall-)\d{1,3})\//.exec(rest);
  if (dir) return dir[1];
  const vid = /^(\d{2,5}x\d{2,5}(?:-\d{1,2})?)\.mp4$/.exec(rest);
  return vid ? vid[1] : 'other';
}

/* What one stored version of an entry uses: its item's code and the parts it names, and how to describe it. */
function usesOf(kind, id, text) {
  if (!text) return null;
  let d;
  try { d = JSON.parse(text); } catch { return null; }
  if (!d.media) return null;
  if (kind === 'painting') return { code: d.media, parts: [d.rendition, 'original'], label: d.title || d.name, site: false };
  if (kind !== 'background') return null;
  const where = SECTIONS[id.slice(3)] || id.slice(3);
  if (d.type === 'video') {
    return { code: d.media, label: `${where} background video`, site: true,
      parts: [...(d.versions || []).map((v) => v.file), ...Object.values(d.frames || {}).map((f) => f.dir)] };
  }
  return { code: d.media, parts: [d.rendition, 'original'], label: `${where} background`, site: true };
}

/* The whole library worked out afresh from R2, the catalogue and what uses each item. */
async function survey(env) {
  const [objects, rows, entries, revisions] = await Promise.all([
    listAll(env, 'media/'),
    env.DB.prepare('SELECT * FROM library').all(),
    env.DB.prepare('SELECT id, kind, draft, published FROM entries WHERE kind IN (\'painting\', \'background\')').all(),
    env.DB.prepare('SELECT id, entry_id, kind, data, previous FROM revisions WHERE kind IN (\'painting\', \'background\') AND (data IS NOT NULL OR previous IS NOT NULL)').all(),
  ]);
  const items = new Map();
  const item = (code) => {
    if (!items.has(code)) items.set(code, { id: code, parts: new Map(), bytes: 0, files: 0, uses: [] });
    return items.get(code);
  };
  for (const r of rows.results) item(r.id).row = r;
  for (const o of objects) {
    const m = /^media\/([0-9a-f]{8})\/(.+)$/.exec(o.key);
    if (!m) continue;
    const it = item(m[1]), part = partOf(m[2]);
    if (!it.parts.has(part)) it.parts.set(part, { part, bytes: 0, files: 0, uses: [] });
    const p = it.parts.get(part);
    p.bytes += o.size; p.files++; it.bytes += o.size; it.files++;
    const at = o.uploaded instanceof Date ? o.uploaded.toISOString() : String(o.uploaded || '');
    if (!p.made || at > p.made) p.made = at;          // when the part was made (its newest file)
    if (part === 'original') p.ext = m[2].split('.').pop();
  }
  const use = (u, how) => {
    if (!u || !items.has(u.code)) return;
    const it = items.get(u.code);
    it.uses.push({ ...how, label: u.label });
    if (u.site) it.site = true;
    for (const name of u.parts) { const p = it.parts.get(name); if (p) p.uses.push({ ...how, label: u.label }); }
  };
  for (const e of entries.results) {
    use(usesOf(e.kind, e.id, e.draft), { entry: e.id, state: 'draft' });
    use(usesOf(e.kind, e.id, e.published), { entry: e.id, state: e.published && JSON.parse(e.published).hidden ? 'hidden' : 'published' });
  }
  // History: what "Bring back" restores: a version's data, or for a removal what it was before (editor.js restore)
  for (const v of revisions.results) use(usesOf(v.kind, v.entry_id, v.data ?? v.previous), { entry: v.entry_id, state: 'history', revision: v.id });
  await originalSizes(env, items);

  return [...items.values()].map((it) => {
    const r = it.row || {};
    const data = JSON.parse(r.data || '{}');
    const parts = [...it.parts.values()].map((p) => {
      const out = { part: p.part, bytes: p.bytes, files: p.files, uses: p.uses, made: p.made || '' };
      const ver = (data.versions || []).find((v) => v.file === p.part);
      if (ver) Object.assign(out, { w: ver.w, h: ver.h, seconds: ver.seconds });
      else if (/^\d+x\d+/.test(p.part)) { const [w, h] = p.part.split(/x|-/).map(Number); Object.assign(out, { w, h }); }
      const ren = (data.renditions || {})[p.part];
      if (ren) Object.assign(out, { w: ren.w, h: ren.h, sizes: ren.widths.length });
      if (data.original && data.original.w && p.part === 'original') Object.assign(out, { w: data.original.w, h: data.original.h });
      if (p.ext) out.ext = p.ext;
      return out;
    });
    const order = (p) => (p.part === 'original' ? 0 : /^r/.test(p.part) ? 1 : /^\d/.test(p.part) ? 2 : /^(wide|tall)/.test(p.part) ? 3 : 4);
    parts.sort((a, b) => order(a) - order(b) || ((b.w || 0) - (a.w || 0)) || a.part.localeCompare(b.part, 'en', { numeric: true }));
    const kind = r.kind || (parts.some((p) => /^\d+x\d+/.test(p.part)) ? 'video' : 'photo');
    return { id: it.id, kind, grp: r.grp || (it.site ? 'site' : 'painting'), name: r.name || `Item ${it.id}`,
      catalogued: !!it.row, added: r.added || '', bytes: it.bytes, files: it.files, parts, uses: it.uses, ...picturesOf(it.id, parts, data), data };
  });
}

/* Pictures for the list: the newest set of sizes, or a video's last frame; thumb its smallest, large its largest
   (for seeing it large and comparing, where detail matters). */
function picturesOf(code, parts, data) {
  const upTo = (widths) => Math.max(...widths);
  const ren = parts.filter((p) => /^r\d+$/.test(p.part)).sort((a, b) => Number(b.part.slice(1)) - Number(a.part.slice(1)))[0];
  if (ren && data.renditions && data.renditions[ren.part]) {
    const r = data.renditions[ren.part], ext = r.ext || 'jpg';
    return { thumb: `${code}/${ren.part}/${r.widths[0]}.${ext}`, large: `${code}/${ren.part}/${upTo(r.widths)}.${ext}` };
  }
  const f = data.frames && (data.frames.wide || data.frames.tall);
  if (f) return { thumb: `${code}/${f.dir}/last-${f.widths[0]}.jpg`, large: `${code}/${f.dir}/last-${upTo(f.widths)}.jpg` };
  return { thumb: null, large: null };
}

/* An original's size in pixels, read once from its file's header (dimensions.js) and kept in the item's record
   (data.original { w, h }; 0 x 0 if it couldn't be read, so it isn't tried again). Covers items from before it was
   recorded (the move from the old layout) as well as new ones. At most 20 a visit, to stay well inside a Worker's
   limits; the rest follow on the next. */
async function originalSizes(env, items) {
  const todo = [...items.values()].filter((it) => it.row && it.parts.has('original') && !JSON.parse(it.row.data || '{}').original).slice(0, 20);
  await Promise.all(todo.map(async (it) => {
    const key = `media/${it.id}/original.${it.parts.get('original').ext}`;
    let size = null;
    try {
      const obj = await env.MEDIA.get(key, { range: { offset: 0, length: HEAD_BYTES } });
      if (obj) size = dimensions(await obj.arrayBuffer());
    } catch { /* unreadable: recorded as unknown */ }
    const data = { ...JSON.parse(it.row.data || '{}'), original: size || { w: 0, h: 0 } };
    it.row.data = JSON.stringify(data);
    await env.DB.prepare('UPDATE library SET data = ? WHERE id = ?').bind(it.row.data, it.id).run();
  }));
}

// ---- the API ----------------------------------------------------------------------------------------------

/* GET /edit/api/library */
export async function library(env) {
  if (!env.MEDIA) throw new Bad('File storage (R2) is not switched on', 503);
  return { items: await survey(env) };
}

/* POST /edit/api/library/new { kind, grp, name, hash?, data? }: a new, empty item; answers its code. */
export async function newItem(env, who, b) {
  if (!['photo', 'video'].includes(b.kind)) throw new Bad('An item is a photo or a video');
  if (!['site', 'painting'].includes(b.grp)) throw new Bad('Bad group');
  const name = String(b.name || '').trim().slice(0, 120) || (b.kind === 'video' ? 'Video' : 'Photo');
  const hash = b.hash == null ? null : String(b.hash);
  if (hash && !/^[0-9a-f]{12}$/.test(hash)) throw new Bad('Bad fingerprint');
  for (let tries = 0; tries < 5; tries++) {
    const id = [...crypto.getRandomValues(new Uint8Array(4))].map((x) => x.toString(16).padStart(2, '0')).join('');
    const r = await env.DB.prepare('INSERT OR IGNORE INTO library (id, kind, grp, name, hash, data, added, added_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, b.kind, b.grp, name, hash, dataOf(b.data || {}), now(), who).run();
    if (r.meta.changes) return { id };
  }
  throw new Bad('Couldn\'t make a code for it: try again', 500);
}

/* What an item records about its parts, so it can be picked and shown without reading the files:
   original { w, h }, renditions { r1: { widths, w, h, ext } }, versions [{ file, w, h, bytes, seconds }],
   frames { wide: { dir, widths, from }, tall: {...} }. Checked for shape only; kept small. */
function dataOf(d) {
  if (typeof d !== 'object' || Array.isArray(d)) throw new Bad('Bad item record');
  const text = JSON.stringify(d);
  if (text.length > 20000) throw new Bad('Item record too large');
  return text;
}

/* POST /edit/api/library/data { id, data }: merged into the item's record (a part named again replaces its own). */
export async function setData(env, id, data) {
  const row = await env.DB.prepare('SELECT data FROM library WHERE id = ?').bind(id).first();
  if (!row) throw new Bad('No such item', 404);
  const d = JSON.parse(row.data || '{}');
  const n = JSON.parse(dataOf(data));
  if (n.original) d.original = n.original;
  if (n.renditions) d.renditions = { ...(d.renditions || {}), ...n.renditions };
  if (n.versions) {
    const keep = (d.versions || []).filter((v) => !n.versions.some((x) => x.file === v.file));
    d.versions = [...keep, ...n.versions];
  }
  if (n.frames) d.frames = { ...(d.frames || {}), ...n.frames };
  await env.DB.prepare('UPDATE library SET data = ? WHERE id = ?').bind(dataOf(d), id).run();
  return { id, data: d };
}

/* GET /edit/api/library/next?id=<code>&part=r|wide|tall|<w>x<h>: the next free part name in the item's folder
   (r3, wide-2, 1536x1152 or 1536x1152-2), so nothing is ever overwritten. */
export async function nextPart(env, id, part) {
  if (!CODE.test(id)) throw new Bad('Bad code');
  if (!(await env.DB.prepare('SELECT 1 FROM library WHERE id = ?').bind(id).first())) throw new Bad('No such item', 404);
  const taken = new Set((await listAll(env, `media/${id}/`)).map((o) => partOf(o.key.slice(15))));
  if (part === 'r') { for (let n = 1; ; n++) if (!taken.has(`r${n}`)) return { part: `r${n}` }; }
  if (part === 'wide' || part === 'tall') { for (let n = 1; ; n++) if (!taken.has(`${part}-${n}`)) return { part: `${part}-${n}` }; }
  if (/^\d{2,5}x\d{2,5}$/.test(part)) {
    if (!taken.has(part)) return { part };
    for (let n = 2; n < 100; n++) if (!taken.has(`${part}-${n}`)) return { part: `${part}-${n}` };
  }
  throw new Bad('Bad part');
}

/* GET /edit/api/stored?hash=: a photo already stored with that content (the first 12 hex digits of its SHA-256,
   worked out in the browser), as media/<code>, or null; so the same photo is never uploaded twice. */
export async function storedPhoto(env, hash) {
  if (!/^[0-9a-f]{12}$/.test(hash)) throw new Bad('Bad fingerprint');
  const row = await env.DB.prepare('SELECT id FROM library WHERE hash = ? AND kind = \'photo\' ORDER BY added LIMIT 1').bind(hash).first();
  if (!row) return null;
  const has = (await env.MEDIA.list({ prefix: `media/${row.id}/original.`, limit: 1 })).objects.length;
  return has ? `media/${row.id}` : null;
}

/* PUT /edit/api/upload?key=media/<code>/<file>: is this a file an item may have? (the item must exist) */
export async function uploadAllowed(env, key) {
  const m = /^media\/([0-9a-f]{8})\/(original\.(?:jpg|jpeg|png|webp|heic|heif|tif|tiff)|r\d{1,3}\/(?:\d{2,4}|preview)\.jpg|\d{2,5}x\d{2,5}(?:-\d{1,2})?\.mp4|(?:wide|tall)-\d{1,3}\/(?:first|last)-\d{2,4}\.jpg)$/.exec(key);
  if (!m) return false;
  return !!(await env.DB.prepare('SELECT 1 FROM library WHERE id = ?').bind(m[1]).first());
}

/* POST /edit/api/library/name { id, name } */
export async function rename(env, id, name) {
  if (typeof name !== 'string' || !name.trim() || name.length > 120) throw new Bad('A name must be 1 to 120 characters');
  const r = await env.DB.prepare('UPDATE library SET name = ? WHERE id = ?').bind(name.trim(), id).run();
  if (!r.meta.changes) throw new Bad('No such item', 404);
  return { id, name: name.trim() };
}

/* POST /edit/api/library/delete { id, part?, history? }: an item for good (see the top), or one of its parts. */
export async function remove(env, url, id, part, history) {
  if (!env.MEDIA) throw new Bad('File storage (R2) is not switched on', 503);
  if (!CODE.test(id)) throw new Bad('Bad code');
  const it = (await survey(env)).find((x) => x.id === id);
  if (!it) throw new Bad('No such item', 404);
  const files = (await listAll(env, `media/${id}/`)).map((o) => o.key);
  if (part) {
    const p = it.parts.find((x) => x.part === part);
    if (!p || part === 'original') throw new Bad('That part can\'t be deleted on its own');
    if (p.uses.length) throw new Bad(`Still used by ${[...new Set(p.uses.map((u) => u.label))].join(', ')}`, 409);
    const keys = files.filter((k) => partOf(k.slice(15)) === part);
    await env.MEDIA.delete(keys);
    return { deleted: `${id}/${part}`, files: keys.length, purged: await purge(env, url, keys) };
  }
  const live = it.uses.filter((u) => u.state !== 'history');
  if (live.length) throw new Bad(`Still used by ${[...new Set(live.map((u) => u.label))].join(', ')}: remove it there first`, 409);
  const past = [...new Set(it.uses.map((u) => u.revision))];
  if (past.length && !history) throw new Bad('History still has versions that use it', 409);
  const stmts = [];
  if (past.length) {
    stmts.push(env.DB.prepare(`DELETE FROM revisions WHERE id IN (${past.map(() => '?').join(',')})`).bind(...past));
    stmts.push(env.DB.prepare('DELETE FROM releases WHERE id NOT IN (SELECT release_id FROM revisions)'));
  }
  stmts.push(env.DB.prepare('DELETE FROM library WHERE id = ?').bind(id));
  for (let i = 0; i < files.length; i += 1000) await env.MEDIA.delete(files.slice(i, i + 1000));
  await env.DB.batch(stmts);
  return { deleted: id, files: files.length, history: past.length, purged: await purge(env, url, files) };
}

/* Cloudflare keeps visitors' copies of published files for up to a year (worker.js), in every data centre. This
   Worker's cache.delete reaches only the one it runs in, so the proper purge is Cloudflare's API (purge by URL),
   with secret PURGE_TOKEN (Zone > Cache Purge) and var ZONE_ID. Keys are R2 keys (media/<code>/... is served at
   /media/<code>/...). */
export async function purge(env, url, keys) {
  const hosts = url.hostname.startsWith('admin-dev') ? ['dev.chrisjones.org.uk']
    : url.hostname.startsWith('admin') ? ['chrisjones.org.uk', 'www.chrisjones.org.uk'] : [url.host];
  const paths = keys.filter((k) => !/\/original\./.test(k)).map((k) => `/${k}`);
  const urls = hosts.flatMap((h) => paths.map((p) => `https://${h}${p}`));
  await Promise.all(urls.map((u) => caches.default.delete(u).catch(() => false)));
  if (!urls.length) return 'nothing to purge';
  if (!env.PURGE_TOKEN || !env.ZONE_ID) return 'this data centre only';
  for (let i = 0; i < urls.length; i += 30) {      // the API takes 30 addresses a call on the free plan
    const r = await fetch(`https://api.cloudflare.com/client/v4/zones/${env.ZONE_ID}/purge_cache`, {
      method: 'POST', headers: { authorization: `Bearer ${env.PURGE_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ files: urls.slice(i, i + 30) }) });
    if (!r.ok) return `everywhere failed (${r.status})`;
  }
  return 'everywhere';
}
