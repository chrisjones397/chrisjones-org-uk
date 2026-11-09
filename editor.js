/* The editor's server side: who is signed in, and the API the editor page (admin/editor.js) calls.

   It runs only on the editor's address (admin.chrisjones.org.uk for live, admin-dev.chrisjones.org.uk for
   dev), which Cloudflare Access guards as a whole: nobody reaches it without the one-time code sent to an
   allowed email address. This checks Access's signed token as well, so a mistake in the Access settings
   can't open it up.

   Content lives in the database (db/schema.sql): each entry has a draft and a published version. Editing
   changes drafts only; publishing copies chosen drafts to published, as one release, keeping a revision of
   each so any earlier version can be brought back as a draft. Uploaded files go to R2 (binding MEDIA), one folder
   per Library item (library.js, paths.js).

   Every change is a POST (or PUT) with the editor's own address as its Origin, so another site can't make a
   signed-in browser change anything. Text is stored as typed and escaped wherever it's shown (site.js). */

import { slug } from './site.js';
import { SITES, tidy, ok } from './links.js';
import { library, rename, remove, newItem, setData, nextPart, storedPhoto, uploadAllowed } from './library.js';
import { CODE, upright } from './paths.js';

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
      if (path === 'original') return await original(env, url.searchParams.get('key') || '');
      if (path === 'stored') return json({ key: await storedPhoto(env, url.searchParams.get('hash') || '') });
      if (path === 'library') return json(await library(env));
      if (path === 'library/next') return json(await nextPart(env, url.searchParams.get('id') || '', url.searchParams.get('part') || ''));
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
    if (path === 'library/name') return json(await rename(env, String(body.id || ''), body.name));
    if (path === 'library/delete') return json(await remove(env, url, String(body.id || ''), body.part ? String(body.part) : null, body.history === true));
    if (path === 'library/new') return json(await newItem(env, who, body));
    if (path === 'library/data') return json(await setData(env, String(body.id || ''), body.data));
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

/* The page sections that can have a photo or a video behind them (entries bg-<section>; index.html marks each
   with data-background="<section>"; BACKGROUNDS in admin/editor.js lists the same). The gallery has its floating
   wall and the profile its head animation (a live 3D drawing), so they aren't listed. A new section that can take
   one needs only its name here and in admin/editor.js, and the attribute. */
const BACKGROUNDS = ['hero', 'contact', 'footer'];

/* How a painting's images were made from its original (admin/darkroom.js): white balance 'none', 'paper' (all
   round) or 'picks' (from spots), and the four corners it was squared up from, all as fractions of the original's
   width and height; brightness (how bright the white comes out, 0.5 to 1) and warmth (the share of the light's
   colour kept, 0 to 1) go with any white balance; the corners are in the order the painting's top left, top
   right, bottom right and bottom left, so they also say which way up it goes (and whether it's mirrored); shape is the size from its details [height, width] when the crop took that shape. Kept so
   the images can be made again from the original. */
function processOf(p) {
  if (typeof p !== 'object' || Array.isArray(p)) throw new Bad('Bad processing record');
  if (typeof p.original !== 'string' || !/^media\/[0-9a-f]{8}$/.test(p.original)) throw new Bad('Bad original');
  if (!['none', 'paper', 'picks'].includes(p.white)) throw new Bad('Bad white balance');
  const frac = (v) => { num(v, 'A position'); if (v < 0 || v > 1) throw new Bad('A position is off the photo'); return Math.round(v * 1e5) / 1e5; };
  const points = (a, lo, hi, what) => {
    if (!Array.isArray(a) || a.length < lo || a.length > hi) throw new Bad(`Bad ${what}`);
    return a.map((q) => { if (!Array.isArray(q) || q.length !== 2) throw new Bad(`Bad ${what}`); return q.map(frac); });
  };
  const out = { original: p.original, white: p.white };
  if (p.white === 'picks') out.spots = points(p.spots, 1, 40, 'white spots');
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

export function normalise(id, kind, d) {
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
    if (!['webp', 'jpg'].includes(d.ext)) throw new Bad('Bad image type');
    // its images: a set of sizes of a Library item (media, rendition: paths.js)
    if (!CODE.test(d.media || '') || !/^r\d{1,3}$/.test(d.rendition || '')) throw new Bad('Bad Library item');
    if (!Array.isArray(d.widths) || !d.widths.length || d.widths.length > 12) throw new Bad('Bad image sizes');
    const pv = d.preview || {};
    if (pv.src !== `media/${d.media}/${d.rendition}/preview.jpg`) throw new Bad('Bad preview image');
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
    // estimated: the size isn't measured (only a scale; the photo gave the shape). size_shown: whether visitors see
    // the size, kept only when it differs from the default (shown when measured, hidden when not); an estimated
    // size that is shown is followed by "(est.)".
    const estimated = parts && cm && !!d.estimated;
    const shown = !!cm && (d.size_shown == null ? !estimated : !!d.size_shown);
    const size = cm && shown && `${cm[0]} x ${cm[1]} cm${estimated ? ' (est.)' : ''}`;
    const details = parts ? [medium, size, year].filter(Boolean).join(', ') : str(d.details || '', 200, 'Details');
    return {
      name: d.name, title, ...(parts ? { medium, cm, year, ...(estimated ? { estimated: true } : {}),
        ...(cm && shown !== !estimated ? { size_shown: shown } : {}) } : {}), details, section: d.section,
      order: int(d.order, 'Order'), wide: !!d.wide, white_paper: !!d.white_paper,
      w: int(d.w, 'Width'), h: int(d.h, 'Height'), widths: d.widths.map((w) => int(w, 'A size')),
      media: d.media, rendition: d.rendition,
      ext: d.ext, preview: { src: pv.src, w: int(pv.w, 'Preview width'), h: int(pv.h, 'Preview height') },
      ...(d.process != null ? { process: processOf(d.process) } : {}),
    };
  }
  if (kind === 'background') return backgroundOf(id, d);
  if (kind === 'text') return { text: str(d.text, 5000, 'Text') };
  if (kind === 'links') return linksOf(d);
  if (id === 'settings-gallery') return Object.fromEntries(GALLERY_SETTINGS.filter((k) => k in d).map((k) => [k, num(d[k], k)]));
  if (id === 'settings-invitation') {
    if (!Array.isArray(d.paintings) || d.paintings.length > 12) throw new Bad('Bad invitation list');
    return { paintings: d.paintings.map((n) => str(n, 100, 'A painting name')) };
  }
  throw new Bad('Unknown kind of content');
}

/* A section's background (entries bg-<section>): a Library item, see backgroundItem. */
function backgroundOf(id, d) {
  if (!BACKGROUNDS.includes(id.slice(3))) throw new Bad('That section can\'t have a background');
  return backgroundItem(d);
}

/* A background from a Library item (paths.js): what it uses of the item, so visitors see a change only once it's
   published. A photo: one set of sizes (rendition, widths, w, h). A video: its versions (file <w>x<h>, w, h,
   bytes, seconds) and frames for each shape it has ({ wide, tall }: dir wide-1..., widths, from: the version
   they were taken from). Both: focus, shade; a video: play, calm. */
function backgroundItem(d) {
  if (!CODE.test(d.media)) throw new Bad('Bad Library item');
  const frac = (v) => { num(v, 'A position'); if (v < 0 || v > 1) throw new Bad('The focus is off the picture'); return Math.round(v * 1000) / 1000; };
  if (!Array.isArray(d.focus) || d.focus.length !== 2) throw new Bad('Bad focus');
  num(d.shade, 'Shade');
  if (d.shade < 0 || d.shade > 0.6) throw new Bad('The shade must be between 0 and 60%');
  const widths = (a) => {
    if (!Array.isArray(a) || !a.length || a.length > 12) throw new Bad('Bad image sizes');
    return a.map((w) => int(w, 'A size'));
  };
  const common = { media: d.media, focus: d.focus.map(frac), shade: Math.round(d.shade * 100) / 100 };
  if (d.type === 'photo') {
    if (!/^r\d{1,3}$/.test(d.rendition || '')) throw new Bad('Bad set of sizes');
    return { type: 'photo', ...common, rendition: d.rendition, w: int(d.w, 'Width'), h: int(d.h, 'Height'), widths: widths(d.widths) };
  }
  if (d.type !== 'video') throw new Bad('A background is a photo or a video');
  if (!Array.isArray(d.versions) || !d.versions.length || d.versions.length > 6) throw new Bad('A video needs one to six versions');
  const files = new Set();
  const versions = d.versions.map((v) => {
    if (!/^\d{2,5}x\d{2,5}(?:-\d{1,2})?$/.test(v.file || '') || files.has(v.file)) throw new Bad('Bad version');
    files.add(v.file);
    num(v.seconds, 'Length');
    if (!(v.seconds > 0 && v.seconds < 600)) throw new Bad('A video must be under ten minutes');
    if (!Number.isInteger(v.bytes) || v.bytes <= 0 || v.bytes > 2e8) throw new Bad('Bad file size');
    return { file: v.file, w: int(v.w, 'Width'), h: int(v.h, 'Height'), bytes: v.bytes, seconds: Math.round(v.seconds * 100) / 100 };
  });
  const frames = {};
  for (const [shape, up] of [['wide', false], ['tall', true]]) {
    const f = (d.frames || {})[shape];
    if (!versions.some((v) => upright(v) === up)) continue;
    if (!f) throw new Bad(`The video's ${up ? 'upright' : 'level'} versions have no first and last frames`);
    if (!new RegExp(`^${shape}-\\d{1,3}$`).test(f.dir || '')) throw new Bad('Bad frames');
    frames[shape] = { dir: f.dir, widths: widths(f.widths), ...(f.from ? { from: String(f.from).slice(0, 20) } : {}) };
  }
  if (!['once', 'loop'].includes(d.play)) throw new Bad('Bad way of playing');
  if (!['last', 'fade'].includes(d.calm)) throw new Bad('Bad choice for reduced motion');
  return { type: 'video', ...common, versions, frames, play: d.play, calm: d.calm };
}

/* The contact links (links.js): { <site>: { name, on } } in links.js's order; a ticked one needs a username that
   fits its site, an unticked one may keep any it had, or none. */
function linksOf(d) {
  const out = {};
  for (const s of SITES) {
    const v = d[s.key];
    if (v == null) continue;
    if (typeof v !== 'object') throw new Bad(`Bad ${s.name} link`);
    const name = tidy(s.key, str(v.name ?? '', 200, `The ${s.name} username`));
    if (name && !ok(s.key, name)) throw new Bad(`That doesn't look like ${s.key === 'email' ? 'an email address' : `a username for ${s.name}`}: ${name}`);
    if (v.on && !name) throw new Bad(`A ticked ${s.name} link needs ${s.key === 'email' ? 'an address' : 'a username'}`);
    if (name || v.on) out[s.key] = { name, on: !!v.on };
  }
  return out;
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
        || (it.kind === 'text' && PARAGRAPHS.includes(it.id)) || (it.kind === 'links' && it.id === 'links')
        || (it.kind === 'background' && it.id.startsWith('bg-') && BACKGROUNDS.includes(it.id.slice(3))))) {
      throw new Bad('Only paintings, genres, the sections\' paragraphs, background pictures and the contact links can be added');
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

/* GET /admin/api/original?key=media/<code>: a Library item's original photo (original.<ext>), for reopening a
   painting's picture in the editor. Only ever to the signed-in editor (this API); visitors never get originals.
   x-original says what the darkroom records as the original (media/<code>). */
async function original(env, key) {
  if (!env.MEDIA) throw new Bad('Image storage (R2) is not switched on', 503);
  const item = /^media\/([0-9a-f]{8})$/.exec(key);
  if (!item) throw new Bad('Bad file name');
  const found = (await env.MEDIA.list({ prefix: `media/${item[1]}/original.`, limit: 1 })).objects[0];
  const obj = found && await env.MEDIA.get(found.key);
  if (!obj) throw new Bad('The original photo isn\'t in storage', 404);
  return new Response(obj.body, { headers: { 'content-type': obj.httpMetadata?.contentType || 'application/octet-stream',
    'x-original': key, 'cache-control': 'private, no-store' } });
}

/* PUT /admin/api/upload?key=media/<code>/<file> */
async function upload(request, env, url) {
  if (!env.MEDIA) throw new Bad('File storage (R2) is not switched on yet', 503);
  return uploadItem(request, env, url.searchParams.get('key') || '');
}

/* PUT /admin/api/upload?key=media/<code>/<file>: a file of a Library item (library.js uploadAllowed has the
   names it may have), stored as sent, streamed through. Never overwrites. */
async function uploadItem(request, env, key) {
  if (!(await uploadAllowed(env, key))) throw new Bad('Bad file name');
  const video = key.endsWith('.mp4');
  const type = request.headers.get('content-type') || '';
  if (video ? type !== 'video/mp4' : !/^image\/[a-z0-9.+-]+$/.test(type)) throw new Bad(video ? 'Only MP4 videos can be uploaded' : 'Only images can be uploaded');
  const size = Number(request.headers.get('content-length') || 0);
  if (!size || size > 95 * 1024 * 1024) throw new Bad('Files must be under 95 megabytes');
  if (await env.MEDIA.head(key)) throw new Bad('A file by that name already exists', 409);
  const { readable, writable } = new FixedLengthStream(size);
  const piping = request.body.pipeTo(writable);
  await Promise.all([env.MEDIA.put(key, readable, { httpMetadata: { contentType: video ? 'video/mp4' : type } }), piping]);
  return { key };
}

export { slug };
