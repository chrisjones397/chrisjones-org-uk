/* The editor's server side: who is signed in, and the API the editor page (admin/editor.js) calls.

   It runs only on the editor's address (admin.chrisjones.org.uk for live, admin-dev.chrisjones.org.uk for
   dev), which Cloudflare Access guards as a whole: nobody reaches it without the one-time code sent to an
   allowed email address. This checks Access's signed token as well, so a mistake in the Access settings
   can't open it up.

   Content lives in the database (db/schema.sql): each entry has a draft and a published version. Editing
   changes drafts only; publishing copies chosen drafts to published, as one release, keeping a revision of
   each so any earlier version can be brought back as a draft. Uploaded images go to R2 (binding MEDIA).

   Every change is a POST (or PUT) with the editor's own address as its Origin, so another site can't make a
   signed-in browser change anything. Text is stored as typed and escaped wherever it's shown (site.js). */

import { slug } from './site.js';

const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
class Bad extends Error { constructor(m, s = 400) { super(m); this.status = s; } }

// ---- signing in: check the Access token -------------------------------------------------------------------

let certs = null;   // the team's public keys, kept while this Worker instance lives
export async function signedIn(request, env, url) {
  // Local testing only (npx wrangler dev, with DEV_USER in .dev.vars, which is never deployed)
  if (env.DEV_USER && url.hostname === 'localhost') return env.DEV_USER;
  if (!env.ACCESS_TEAM || !env.ACCESS_AUD) return null;
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return null;
  const [h, p, sig] = token.split('.');
  if (!sig) return null;
  try {
    const header = JSON.parse(b64text(h)), payload = JSON.parse(b64text(p));
    if (![].concat(payload.aud).includes(env.ACCESS_AUD)) return null;
    if (payload.iss !== `https://${env.ACCESS_TEAM}.cloudflareaccess.com`) return null;
    if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
    for (const fresh of [false, true]) {
      if (!certs || fresh) {
        const r = await fetch(`https://${env.ACCESS_TEAM}.cloudflareaccess.com/cdn-cgi/access/certs`);
        certs = (await r.json()).keys;
      }
      const jwk = certs.find((k) => k.kid === header.kid);
      if (!jwk) continue;
      const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
      const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64bytes(sig), new TextEncoder().encode(`${h}.${p}`));
      return ok ? (payload.email || 'signed in') : null;
    }
  } catch { /* a malformed token is simply not signed in */ }
  return null;
}
const b64bytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const b64text = (s) => new TextDecoder().decode(b64bytes(s));

// ---- the API ----------------------------------------------------------------------------------------------

export async function api(request, env, url, who) {
  const path = url.pathname.slice('/admin/api/'.length);
  try {
    if (request.method === 'GET') {
      if (path === 'state') return json(await state(env, who));
      if (path === 'history') return json(await history(env));
      if (path === 'free') return json(await free(env, url.searchParams.get('name') || ''));
      if (path === 'original') return await original(env, url.searchParams.get('key') || '');
      if (path === 'stored') return json({ key: await stored(env, url.searchParams.get('hash') || '') });
      throw new Bad('Not found', 404);
    }
    if (request.headers.get('origin') !== url.origin) throw new Bad('Changes must come from the editor page', 403);
    if (request.method === 'PUT' && path === 'upload') return json(await upload(request, env, url));
    if (request.method !== 'POST' || !(request.headers.get('content-type') || '').startsWith('application/json')) {
      throw new Bad('Not found', 404);
    }
    const body = await request.json();
    if (path === 'save') return json(await save(env, who, body.items));
    if (path === 'discard') return json(await discard(env, body.ids));
    if (path === 'publish') return json(await publish(env, who, body.ids, body.note));
    if (path === 'restore') return json(await restore(env, who, body.revision));
    throw new Bad('Not found', 404);
  } catch (e) {
    return json({ error: e.message || String(e) }, e.status || 500);
  }
}

async function rows(env) {
  return (await env.DB.prepare('SELECT * FROM entries').all()).results;
}

async function state(env, who) {
  return { who, media: !!env.MEDIA, entries: await rows(env) };
}

async function history(env) {
  const releases = (await env.DB.prepare('SELECT * FROM releases ORDER BY id DESC LIMIT 40').all()).results;
  if (!releases.length) return { releases };
  const revisions = (await env.DB.prepare('SELECT * FROM revisions WHERE release_id >= ? ORDER BY id')
    .bind(releases[releases.length - 1].id).all()).results;
  for (const r of releases) r.revisions = revisions.filter((v) => v.release_id === r.id);
  return { releases };
}

// Each kind of entry, checked and written with its keys always in the same order, so that a draft equal to
// its published version is equal as text too (that's how a change is recognised).
const str = (v, max, what) => {
  if (typeof v !== 'string' || v.length > max) throw new Bad(`${what} must be text of at most ${max} characters`);
  return v.trim();
};
const num = (v, what) => { if (typeof v !== 'number' || !isFinite(v)) throw new Bad(`${what} must be a number`); return v; };
const int = (v, what) => { if (!Number.isInteger(v) || v < 0 || v > 100000) throw new Bad(`${what} must be a whole number`); return v; };
const GALLERY_SETTINGS = ['size', 'spacing', 'spread', 'depth', 'nearness', 'drift', 'seed'];

/* The page sections' paragraph entries (admin/editor.js PAGE), which may be created by the first paragraph typed. */
const PARAGRAPHS = ['t-hero', 't-gallery', 't-contact', 't-profile', 't-footer'];

/* How a painting's images were made from its original (admin/darkroom.js): white balance 'none', 'paper' (all
   round) or 'picks' (from spots), and the four corners it was squared up from, all as fractions of the original's
   width and height; brightness (how bright the white comes out, 0.5 to 1) and warmth (the share of the light's
   colour kept, 0 to 1) go with any white balance; the corners are in the order the painting's top left, top
   right, bottom right and bottom left, so they also say which way up it goes (and whether it's mirrored); shape is the size from its details [height, width] when the crop took that shape. Kept so
   the images can be made again from the original. */
function processOf(p) {
  if (typeof p !== 'object' || Array.isArray(p)) throw new Bad('Bad processing record');
  if (typeof p.original !== 'string' || !/^originals\/[a-z0-9-]{1,110}\.[a-z0-9]{1,5}$/.test(p.original)) throw new Bad('Bad original');
  if (!['none', 'paper', 'picks'].includes(p.white)) throw new Bad('Bad white balance');
  const frac = (v) => { num(v, 'A position'); if (v < 0 || v > 1) throw new Bad('A position is off the photo'); return Math.round(v * 1e5) / 1e5; };
  const points = (a, lo, hi, what) => {
    if (!Array.isArray(a) || a.length < lo || a.length > hi) throw new Bad(`Bad ${what}`);
    return a.map((q) => { if (!Array.isArray(q) || q.length !== 2) throw new Bad(`Bad ${what}`); return q.map(frac); });
  };
  const out = { original: p.original, white: p.white };
  if (p.white === 'picks') out.spots = points(p.spots, 1, 20, 'white spots');
  if (p.white !== 'none') {
    const share = (v, lo, what) => { num(v, what); if (v < lo || v > 1) throw new Bad(`Bad ${what}`); return Math.round(v * 100) / 100; };
    out.brightness = share(p.brightness ?? 1, 0.5, 'brightness');
    out.warmth = share(p.warmth ?? 0, 0, 'warmth');
  }
  if (p.corners != null) out.corners = points(p.corners, 4, 4, 'corners');
  if (p.shape != null) {
    if (!Array.isArray(p.shape) || p.shape.length !== 2 || !p.shape.every((v) => num(v, 'Size') > 0 && v < 10000)) throw new Bad('Bad size');
    out.shape = p.shape.slice();
  }
  return out;
}

function normalise(id, kind, d) {
  if (!d || typeof d !== 'object') throw new Bad('Missing content');
  if (kind === 'section') {
    const title = str(d.title, 120, 'A section title');
    if (!title) throw new Bad('A section needs a title');
    return { title, order: int(d.order, 'Order') };
  }
  if (kind === 'painting') {
    const title = str(d.title, 200, 'A title');
    if (!title) throw new Bad('A painting needs a title');
    if (!/^[a-z0-9-]{1,100}$/.test(d.name || '')) throw new Bad('Bad painting name');
    if (!['img/', 'media/images/'].includes(d.base)) throw new Bad('Bad image location');
    if (!['webp', 'jpg'].includes(d.ext)) throw new Bad('Bad image type');
    const file = d.file || d.name;
    if (!/^[a-z0-9-]{1,110}$/.test(file) || !(file === d.name || file.startsWith(`${d.name}-v`))) throw new Bad('Bad file name');
    if (!Array.isArray(d.widths) || !d.widths.length || d.widths.length > 12) throw new Bad('Bad image sizes');
    const pv = d.preview || {};
    if (typeof pv.src !== 'string' || !pv.src.startsWith(d.base) || !/^[a-z0-9/.-]+$/.test(pv.src)) throw new Bad('Bad preview image');
    if (!/^s-[a-z0-9-]{1,80}$/.test(d.section || '')) throw new Bad('Bad section');
    // Medium, size in centimetres (height, width) and year, kept separately; the details line visitors see is
    // made from them ("Oil on canvas, 60 x 90 cm, 2020"). Older entries with only a details line keep it.
    const parts = d.medium != null || d.cm != null || d.year != null;
    const medium = str(d.medium ?? '', 120, 'Medium'), year = str(d.year ?? '', 20, 'Year');
    let cm = null;
    if (d.cm != null) {
      if (!Array.isArray(d.cm) || d.cm.length !== 2) throw new Bad('Bad size');
      cm = d.cm.map((v) => { num(v, 'Size'); if (!(v > 0 && v < 10000)) throw new Bad('A size must be more than 0 cm'); return Math.round(v * 10) / 10; });
    }
    // An estimated size shapes the picture and scales it in the gallery, but isn't shown until measured.
    const estimated = parts && cm && !!d.estimated;
    const details = parts ? [medium, cm && !estimated && `${cm[0]} x ${cm[1]} cm`, year].filter(Boolean).join(', ') : str(d.details || '', 200, 'Details');
    return {
      name: d.name, title, ...(parts ? { medium, cm, year, ...(estimated ? { estimated: true } : {}) } : {}), details, section: d.section,
      order: int(d.order, 'Order'), wide: !!d.wide, white_paper: !!d.white_paper,
      w: int(d.w, 'Width'), h: int(d.h, 'Height'), widths: d.widths.map((w) => int(w, 'A size')),
      base: d.base, ext: d.ext, preview: { src: pv.src, w: int(pv.w, 'Preview width'), h: int(pv.h, 'Preview height') },
      ...(file !== d.name ? { file } : {}),     // only when it differs, so imported entries keep their exact text
      ...(d.process != null ? { process: processOf(d.process) } : {}),
    };
  }
  if (kind === 'text') return { text: str(d.text, 5000, 'Text') };
  if (id === 'settings-gallery') return Object.fromEntries(GALLERY_SETTINGS.filter((k) => k in d).map((k) => [k, num(d[k], k)]));
  if (id === 'settings-invitation') {
    if (!Array.isArray(d.paintings) || d.paintings.length > 12) throw new Bad('Bad invitation list');
    return { paintings: d.paintings.map((n) => str(n, 100, 'A painting name')) };
  }
  throw new Bad('Unknown kind of content');
}

/* items: [{ id, kind, data }], data null to delete. New paintings are "p-<name>"; new sections "s-<random>". */
async function save(env, who, items) {
  if (!Array.isArray(items) || !items.length || items.length > 200) throw new Bad('Nothing to save');
  const all = await rows(env);
  const byId = Object.fromEntries(all.map((r) => [r.id, r]));
  const names = new Set();
  for (const r of all) if (r.kind === 'painting') for (const v of [r.draft, r.published]) if (v) names.add(`${JSON.parse(v).name}\u0000${r.id}`);
  const stmts = [], at = now();
  for (const it of items) {
    if (!/^[a-z0-9-]{1,100}$/.test(it.id || '')) throw new Bad('Bad id');
    const old = byId[it.id];
    if (old && old.kind !== it.kind) throw new Bad('That entry is a different kind');
    if (!old && !((it.kind === 'painting' && it.id.startsWith('p-')) || (it.kind === 'section' && it.id.startsWith('s-'))
        || (it.kind === 'text' && PARAGRAPHS.includes(it.id)))) {
      throw new Bad('Only paintings, genres and the sections\' paragraphs can be added');
    }
    if (it.data === null) {
      if (!old) continue;
      if (old.published === null) stmts.push(env.DB.prepare('DELETE FROM entries WHERE id = ?').bind(it.id));
      else stmts.push(env.DB.prepare('UPDATE entries SET draft = NULL, draft_at = ?, draft_by = ? WHERE id = ?').bind(at, who, it.id));
      continue;
    }
    const d = normalise(it.id, it.kind, it.data);
    if (it.kind === 'painting') {
      if (it.id !== `p-${d.name}` && !old) throw new Bad('A new painting\'s id must be p-<name>');
      for (const n of names) {
        const [name, id] = n.split('\u0000');
        if (name === d.name && id !== it.id) throw new Bad(`Another painting already has the address /paintings/${d.name}/`);
      }
    }
    stmts.push(env.DB.prepare(`INSERT INTO entries (id, kind, draft, published, draft_at, draft_by) VALUES (?, ?, ?, NULL, ?, ?)
      ON CONFLICT(id) DO UPDATE SET draft = excluded.draft, draft_at = excluded.draft_at, draft_by = excluded.draft_by`)
      .bind(it.id, it.kind, JSON.stringify(d), at, who));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return { entries: await rows(env) };
}

/* Put the chosen drafts back to their published versions (a never-published entry goes altogether). */
async function discard(env, ids) {
  if (!Array.isArray(ids) || !ids.length) throw new Bad('Nothing chosen');
  const all = Object.fromEntries((await rows(env)).map((r) => [r.id, r]));
  const stmts = [];
  for (const id of ids) {
    const r = all[id];
    if (!r || r.draft === r.published) continue;
    stmts.push(r.published === null
      ? env.DB.prepare('DELETE FROM entries WHERE id = ?').bind(id)
      : env.DB.prepare('UPDATE entries SET draft = published, draft_at = published_at, draft_by = NULL WHERE id = ?').bind(id));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return { entries: await rows(env) };
}

/* Publish the chosen changes (ids), or every change (ids null), as one release. Anything a chosen change
   can't do without comes too, and is listed in the answer: a painting's new section, and the paintings
   still published in a section being deleted. */
async function publish(env, who, ids, note) {
  const all = await rows(env);
  const byId = Object.fromEntries(all.map((r) => [r.id, r]));
  const changed = all.filter((r) => r.draft !== r.published);
  const chosen = new Set(ids == null ? changed.map((r) => r.id) : ids.filter((id) => byId[id] && byId[id].draft !== byId[id].published));
  if (!chosen.size) throw new Bad('Nothing to publish');
  const added = [];
  for (let grew = true; grew;) {
    grew = false;
    for (const id of [...chosen]) {
      const r = byId[id];
      const need = [];
      if (r.kind === 'painting' && r.draft) {
        const s = JSON.parse(r.draft).section;
        if (byId[s] && byId[s].published === null) need.push(s);      // a section not yet published
      }
      if (r.kind === 'section' && r.draft === null) {
        for (const p of all) if (p.kind === 'painting' && p.published && JSON.parse(p.published).section === id) need.push(p.id);
      }
      for (const n of need) {
        const d = byId[n];
        if (d && d.draft !== d.published && !chosen.has(n)) {
          chosen.add(n); added.push(n); grew = true;
        }
      }
    }
  }
  const at = now();
  const stmts = [env.DB.prepare('INSERT INTO releases (at, by, note) VALUES (?, ?, ?)').bind(at, who, note ? String(note).slice(0, 500) : null)];
  const rel = '(SELECT MAX(id) FROM releases)';
  for (const id of chosen) {
    const r = byId[id];
    stmts.push(env.DB.prepare(`INSERT INTO revisions (release_id, entry_id, kind, data, previous) VALUES (${rel}, ?, ?, ?, ?)`)
      .bind(id, r.kind, r.draft, r.published));
    stmts.push(r.draft === null
      ? env.DB.prepare('DELETE FROM entries WHERE id = ?').bind(id)
      : env.DB.prepare('UPDATE entries SET published = draft, published_at = ? WHERE id = ?').bind(at, id));
  }
  await env.DB.batch(stmts);   // one transaction: all of it is published, or none
  return { published: [...chosen], added, entries: await rows(env) };
}

/* Bring back an earlier version (a revision) as the draft. */
async function restore(env, who, revision) {
  const v = await env.DB.prepare('SELECT * FROM revisions WHERE id = ?').bind(revision).first();
  if (!v) throw new Bad('No such version');
  const at = now();
  if (v.data === null) return save(env, who, [{ id: v.entry_id, kind: v.kind, data: null }]);
  if (v.kind === 'painting') {
    const d = JSON.parse(v.data);
    const sec = await env.DB.prepare('SELECT draft FROM entries WHERE id = ?').bind(d.section).first();
    if (!sec || !sec.draft) throw new Bad('That version\'s section no longer exists: restore the section first');
  }
  await env.DB.prepare(`INSERT INTO entries (id, kind, draft, published, draft_at, draft_by) VALUES (?, ?, ?, NULL, ?, ?)
    ON CONFLICT(id) DO UPDATE SET draft = excluded.draft, draft_at = excluded.draft_at, draft_by = excluded.draft_by`)
    .bind(v.entry_id, v.kind, v.data, at, who).run();
  return { entries: await rows(env) };
}

/* The file name to use for a new painting's images: its name, or name-v2, -v3... if R2 already has files by
   that name (a painting deleted earlier keeps its files, so History can bring it back). Originals are named by
   their content now (see stored), but those moved from git are still originals/<name>.<ext>, so both count. */
async function free(env, name) {
  if (!env.MEDIA) throw new Bad('Image storage (R2) is not switched on', 503);
  if (!/^[a-z0-9-]{1,100}$/.test(name)) throw new Bad('Bad name');
  for (let v = 1; v < 100; v++) {
    const file = v === 1 ? name : `${name}-v${v}`;
    const found = await env.MEDIA.list({ prefix: `originals/${file}.`, limit: 1 });
    const sized = await env.MEDIA.list({ prefix: `images/${file}-preview.`, limit: 1 });
    if (!found.objects.length && !sized.objects.length) return { file };
  }
  throw new Bad('Too many versions of that name');
}

/* GET /admin/api/original?key=originals/<file>.<ext>, or originals/<file> to find it whatever its extension
   (paintings moved from git have no record of it): a painting's original photo, for reopening its picture in
   the editor. Only ever to the signed-in editor (this API); visitors never get originals. The key found is
   sent back as x-original. */
async function original(env, key) {
  if (!env.MEDIA) throw new Bad('Image storage (R2) is not switched on', 503);
  const m = /^originals\/([a-z0-9-]{1,110})(\.[a-z0-9]{1,5})?$/.exec(key);
  if (!m) throw new Bad('Bad file name');
  if (!m[2]) {
    const found = (await env.MEDIA.list({ prefix: `originals/${m[1]}.`, limit: 5 })).objects
      .find((o) => /^originals\/[a-z0-9-]+\.[a-z0-9]{1,5}$/.test(o.key) && o.key.slice(0, o.key.lastIndexOf('.')) === `originals/${m[1]}`);
    if (!found) throw new Bad('The original photo isn\'t in storage', 404);
    key = found.key;
  }
  const obj = await env.MEDIA.get(key);
  if (!obj) throw new Bad('The original photo isn\'t in storage', 404);
  return new Response(obj.body, { headers: { 'content-type': obj.httpMetadata?.contentType || 'application/octet-stream',
    'x-original': key, 'cache-control': 'private, no-store' } });
}

/* Originals are named by their content: originals/<hash>-<name>.<ext>, hash the first 12 hex digits of the
   file's SHA-256 (worked out in the browser; the free plan's 10 ms of CPU won't stretch to hashing a large photo
   here), name the painting it was first uploaded for (readable only: the hash alone identifies it). So a photo
   already stored is found and shared, never uploaded twice: one photo can serve several paintings, each with
   its own corners. Originals from before (originals/<file>.<ext>, and those moved from git) keep their names.
   GET /admin/api/stored?hash=<12 hex>: the original with that content, or null. */
async function stored(env, hash) {
  if (!env.MEDIA) throw new Bad('Image storage (R2) is not switched on', 503);
  if (!/^[0-9a-f]{12}$/.test(hash)) throw new Bad('Bad fingerprint');
  const found = (await env.MEDIA.list({ prefix: `originals/${hash}-`, limit: 1 })).objects[0];
  return found ? found.key : null;
}

/* PUT /admin/api/upload?key=images/<file>-<width>.jpg or images/<file>-preview.jpg (made in the browser), or
   originals/<hash>-<name>.<ext> (the photo as sent). Never overwrites. An original whose content is already
   stored (under any name) isn't stored again: the existing key is sent back instead. */
async function upload(request, env, url) {
  if (!env.MEDIA) throw new Bad('Image storage (R2) is not switched on yet', 503);
  const key = url.searchParams.get('key') || '';
  const m = /^(?:images\/[a-z0-9-]{1,110}-(?:\d{2,4}|preview)\.jpg|originals\/([0-9a-f]{12})-[a-z0-9-]{1,96}\.(?:jpg|jpeg|png|webp|heic|heif|tif|tiff))$/.exec(key);
  if (!m) throw new Bad('Bad file name');
  const original = key.startsWith('originals/');
  const type = request.headers.get('content-type') || '';
  if (!/^image\/[a-z0-9.+-]+$/.test(type)) throw new Bad('Only images can be uploaded');
  const size = Number(request.headers.get('content-length') || 0);
  if (!size || size > 80 * 1024 * 1024) throw new Bad('Images must be under 80 megabytes');
  if (original) {
    const have = await stored(env, m[1]);
    if (have) return { key: have, existed: true };
  } else if (await env.MEDIA.head(key)) throw new Bad('A file by that name already exists', 409);
  const body = await request.arrayBuffer();
  const b = new Uint8Array(body.slice(0, 4));
  if (!original && !(b[0] === 0xff && b[1] === 0xd8)) throw new Bad('That file is not a JPEG');
  await env.MEDIA.put(key, body, { httpMetadata: { contentType: original ? type : 'image/jpeg' } });
  return { key };
}

export { slug };
