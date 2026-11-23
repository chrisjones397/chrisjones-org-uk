/* The Library: the media layer, written and listed (docs/entities.md, section 2). Server only; media.js reads
   renditions for everyone.

   A Library item is one thing uploaded: a photo, or a video (one or several versions, a set). Its code, 8 hex
   digits, never changes; its name is the Library's own, changed freely. Under it:
     originals   the untouched uploaded files: a photo has one, a video one for each version;
     recipes     the darkroom settings applied to it (flat: white balance, four corners, squared up; scene: white
                 balance, straightened and cropped; video: its stills), several if several things were made from one photo;
     renditions  each frozen set of files a recipe produced (a picture at several sizes and a link preview; or a
                 video's versions with their first and last frames). Never changed: a new result is a new one.
   Files are known only by the digest of their bytes (table file; R2 key = digest; paths.js). The same bytes are
   stored once, whatever they are used for.

   What uses a rendition: drafts and published documents that name its id, and History (what "Bring back"
   restores). "Delete for good": an item only while no draft or published document names any of its renditions
   (if History does, it must be asked for, and those versions leave History); a rendition only while nothing at
   all names it. From History, a removed thing can be deleted for good (forget): its versions, and the pictures
   only they named (not a recipe's newest). A file goes from storage when no original, no rendition and no item's small picture refers to it any more. */

import { CODE, DIGEST, fileUrl } from './paths.js';
import { dimensions, HEAD_BYTES } from './dimensions.js';
import { renditions } from './media.js';

const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
class Bad extends Error { constructor(m, s = 400) { super(m); this.status = s; } }
export { Bad };

const SECTIONS = { hero: 'Hero', contact: 'Contact', footer: 'Footer' };
const MAX_BYTES = 95 * 1024 * 1024;
const SHOWN = ['image/jpeg', 'image/png', 'image/webp'];   // photo types every browser shows

// ---- what uses what ----------------------------------------------------------------------------------------

/* What one stored version of a document uses: the rendition it names, and how to describe it. */
function useOf(kind, id, text) {
  if (!text) return null;
  let d;
  try { d = JSON.parse(text); } catch { return null; }
  if (d.rendition == null) return null;
  if (kind === 'artwork') return { rendition: d.rendition, label: d.title || d.name, hidden: !!d.hidden };
  if (kind === 'background') return { rendition: d.rendition, label: `${SECTIONS[id.slice(3)] || id.slice(3)} background`, hidden: !!d.hidden };
  return null;
}

/* Every use of every rendition: Map rendition id -> [{ entry, state: draft | published | hidden | history,
   label, revision? }]. */
async function allUses(env) {
  const [entries, revisions] = await env.DB.batch([
    env.DB.prepare('SELECT id, kind, draft, published FROM entries WHERE draft_rendition IS NOT NULL OR published_rendition IS NOT NULL'),
    env.DB.prepare('SELECT id, entry_id, kind, data, previous FROM revisions WHERE kind IN (\'artwork\', \'background\') AND (data IS NOT NULL OR previous IS NOT NULL)'),
  ]);
  const uses = new Map();
  const add = (u, how) => { if (u) (uses.get(u.rendition) || uses.set(u.rendition, []).get(u.rendition)).push({ ...how, label: u.label }); };
  for (const e of entries.results) {
    add(useOf(e.kind, e.id, e.draft), { entry: e.id, state: 'draft' });
    const p = useOf(e.kind, e.id, e.published);
    add(p, { entry: e.id, state: p && p.hidden ? 'hidden' : 'published' });
  }
  // History: what "Bring back" restores: a version's data, or for a removal what it was before (editor.js restore)
  for (const v of revisions.results) add(useOf(v.kind, v.entry_id, v.data ?? v.previous), { entry: v.entry_id, state: 'history', revision: v.id });
  return uses;
}

// ---- the listing --------------------------------------------------------------------------------------------

/* Every item with its originals, recipes and renditions, and what uses each.
     { id, kind, name, alt, credit, added, originals: [{ digest, type, url, bytes, w, h, seconds }],
       recipes: [{ id, kind, label, settings, renditions: [rendition (media.js) + { bytes, uses }] }],
       uses, bytes, files (distinct files and their weight),
       thumb (a small picture's address: the item's own, made at upload, or its newest rendition's smallest size),
       large (to see it large: a photo's original if browsers can show its type, else its newest rendition's largest) }
   What an item is used for (a painting, a background) is read from its uses, not from its recipes' kinds: a
   recipe says how a picture was prepared, never where it goes (step 4 slice 4). */
async function survey(env) {
  const [items, originals, recipes] = await env.DB.batch([
    env.DB.prepare('SELECT l.id, l.kind, l.name, l.alt, l.credit, l.added, l.thumb, f.type AS thumb_type FROM library l LEFT JOIN file f ON f.digest = l.thumb'),
    env.DB.prepare('SELECT o.item_id, f.digest, f.type, f.bytes, f.w, f.h, f.seconds FROM original o JOIN file f ON f.digest = o.digest'),
    env.DB.prepare('SELECT id, item_id, kind, label, settings FROM recipe ORDER BY id'),
  ]);
  const [all, uses] = await Promise.all([renditions(env), allUses(env)]);
  const byId = new Map(items.results.map((r) => [r.id, { ...r, originals: [], recipes: [], uses: [] }]));
  for (const o of originals.results) {
    const it = byId.get(o.item_id);
    if (it) it.originals.push({ digest: o.digest, type: o.type, url: fileUrl(o), bytes: o.bytes, w: o.w, h: o.h, seconds: o.seconds });
  }
  const recipeOf = new Map();
  for (const c of recipes.results) {
    const it = byId.get(c.item_id);
    if (!it) continue;
    const recipe = { id: c.id, kind: c.kind, label: c.label, settings: JSON.parse(c.settings || '{}'), renditions: [] };
    it.recipes.push(recipe); recipeOf.set(c.id, recipe);
  }
  for (const r of [...all.values()].sort((a, b) => a.id - b.id)) {
    const recipe = recipeOf.get(r.recipe), it = byId.get(r.item);
    if (!recipe || !it) continue;
    const mine = uses.get(r.id) || [];
    recipe.renditions.push({ ...r, bytes: r.files.reduce((n, f) => n + f.bytes, 0), uses: mine });
    it.uses.push(...mine.map((u) => ({ ...u, rendition: r.id })));
  }
  return [...byId.values()].map((it) => {
    it.originals.sort((a, b) => (b.w || 0) * (b.h || 0) - (a.w || 0) * (a.h || 0));
    const weigh = new Map(it.originals.map((o) => [o.digest, o.bytes]));
    const rens = it.recipes.flatMap((c) => c.renditions);
    for (const r of rens) for (const f of r.files) weigh.set(f.digest, f.bytes);
    const latest = rens[rens.length - 1], frames = latest && (latest.frames.wide || latest.frames.tall);
    const pics = latest && latest.sizes.length ? latest.sizes : frames ? frames.last : [];
    const { thumb, thumb_type: thumbType, ...rest } = it;
    if (thumb) weigh.set(thumb, 0);
    const o = it.kind === 'photo' && it.originals[0];
    const shown = o && SHOWN.includes(o.type) ? o.url : null;
    return { ...rest, bytes: [...weigh.values()].reduce((a, b) => a + b, 0), files: weigh.size,
      thumb: thumb ? fileUrl({ digest: thumb, type: thumbType }) : pics.length ? pics[0].url : null,
      large: shown || (pics.length ? pics[pics.length - 1].url : null),
    };
  });
}

// ---- the API ----------------------------------------------------------------------------------------------

/* GET /edit/api/library */
export async function library(env) {
  if (!env.MEDIA) throw new Bad('File storage (R2) is not switched on', 503);
  return { items: await survey(env) };
}

/* GET /edit/api/file?digest=<sha256>: is a file with these bytes already stored? And, if it is some item's
   original, which item (so the same photo is never a second item). */
export async function haveFile(env, digest) {
  if (!DIGEST.test(digest)) throw new Bad('Bad digest');
  const row = await env.DB.prepare(`SELECT f.digest, o.item_id, l.name FROM file f LEFT JOIN original o ON o.digest = f.digest
    LEFT JOIN library l ON l.id = o.item_id WHERE f.digest = ?`).bind(digest).first();
  return { have: !!row, item: row ? row.item_id : null, name: row ? row.name : null };
}

/* PUT /edit/api/file?digest=<sha256>[&w=&h=&seconds=]: store a file under the digest of its bytes, as sent,
   streamed through. The digest is worked out by the browser and handed to R2 with the upload: R2 works out the
   SHA-256 of what it receives and refuses the file if it differs (Cloudflare's documented way to check an
   upload), so a row in `file` is a fact about the stored bytes. A picture's size in pixels is read here from the
   start of the stored file; a video's size and length are as the browser measured them (w, h, seconds).
   Sending bytes that are already stored changes nothing. */
export async function putFile(request, env, url, who) {
  if (!env.MEDIA) throw new Bad('File storage (R2) is not switched on yet', 503);
  const digest = url.searchParams.get('digest') || '';
  if (!DIGEST.test(digest)) throw new Bad('Bad digest');
  const type = (request.headers.get('content-type') || '').toLowerCase();
  const video = type === 'video/mp4';
  if (!video && !/^image\/[a-z0-9.+-]+$/.test(type)) throw new Bad('Only images and MP4 videos can be uploaded');
  const size = Number(request.headers.get('content-length') || 0);
  if (!size || size > MAX_BYTES) throw new Bad('Files must be under 95 megabytes');
  let dim = null, seconds = null;
  if (video) {
    const n = (k) => Number(url.searchParams.get(k));
    if (!(n('w') > 0 && n('h') > 0 && n('seconds') > 0 && n('seconds') < 600)) throw new Bad('A video needs its size and length');
    dim = { w: Math.round(n('w')), h: Math.round(n('h')) }; seconds = Math.round(n('seconds') * 100) / 100;
  }
  const had = await env.DB.prepare('SELECT w, h FROM file WHERE digest = ?').bind(digest).first();
  if (had) return { digest, w: had.w, h: had.h, have: true };
  const { readable, writable } = new FixedLengthStream(size);
  const piping = request.body.pipeTo(writable);
  try {
    await Promise.all([env.MEDIA.put(digest, readable, { sha256: digest, httpMetadata: { contentType: type } }), piping]);
  } catch (e) {
    throw new Bad(`Storage refused the file (its bytes didn't match its digest, or the upload broke off): ${e.message || e}`, 409);
  }
  if (!video) {
    for (const length of [65536, HEAD_BYTES]) {
      const obj = await env.MEDIA.get(digest, { range: { offset: 0, length } });
      dim = obj && dimensions(await obj.arrayBuffer());
      if (dim || !obj || obj.size <= length) break;
    }
  }
  await env.DB.prepare('INSERT OR IGNORE INTO file (digest, bytes, type, w, h, seconds, added, added_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(digest, size, type, dim ? dim.w : null, dim ? dim.h : null, seconds, now(), who).run();
  return { digest, w: dim ? dim.w : null, h: dim ? dim.h : null, have: false };
}

/* The rows of some stored files: Map digest -> { digest, type, w, h, bytes, seconds }. */
async function filesOf(env, digests) {
  const list = [...new Set(digests)];
  if (list.some((d) => !DIGEST.test(d))) throw new Bad('Bad digest');
  if (!list.length) return new Map();
  const { results } = await env.DB.prepare('SELECT digest, type, w, h, bytes, seconds FROM file WHERE digest IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(list)).all();
  const out = new Map(results.map((f) => [f.digest, f]));
  if (out.size !== list.length) throw new Bad('A file isn\'t in storage: upload it first');
  return out;
}

/* POST /edit/api/library/new { kind, name, originals: [digest], thumb? }: a new item from files already stored: a
   photo's one original, or a video's versions; thumb: a small picture of it, already stored (migration 0007).
   A photo that is already an item's original is that item (answer { id, shared: true, scene: the id of its
   newest rendition made as it is, if any }); it takes the thumb if it has none. */
export async function newItem(env, who, b) {
  if (!['photo', 'video'].includes(b.kind)) throw new Bad('An item is a photo or a video');
  const digests = Array.isArray(b.originals) ? b.originals.map(String) : [];
  if (b.kind === 'photo' ? digests.length !== 1 : digests.length < 1 || digests.length > 6) throw new Bad(b.kind === 'photo' ? 'A photo has one original' : 'A video needs one to six versions');
  const files = await filesOf(env, digests);
  for (const f of files.values()) if ((f.type === 'video/mp4') !== (b.kind === 'video')) throw new Bad('That file isn\'t a ' + b.kind);
  let thumb = null;
  if (b.thumb != null) {
    thumb = String(b.thumb);
    if ((await filesOf(env, [thumb])).get(thumb).type === 'video/mp4') throw new Bad('A small picture can\'t be a video');
  }
  const taken = (await env.DB.prepare('SELECT o.digest, o.item_id, l.name FROM original o JOIN library l ON l.id = o.item_id WHERE o.digest IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(digests)).all()).results;
  if (taken.length) {
    if (b.kind === 'video') throw new Bad(`That video is already in the Library, as "${taken[0].name}": choose it from the Library`, 409);
    const scene = await env.DB.prepare('SELECT r.id FROM rendition r JOIN recipe c ON c.id = r.recipe_id WHERE c.item_id = ? AND c.kind = \'scene\' ORDER BY r.id DESC LIMIT 1')
      .bind(taken[0].item_id).first();
    if (thumb) await env.DB.prepare('UPDATE library SET thumb = ? WHERE id = ? AND thumb IS NULL').bind(thumb, taken[0].item_id).run();
    return { id: taken[0].item_id, shared: true, name: taken[0].name, scene: scene ? scene.id : null };
  }
  const name = String(b.name || '').trim().slice(0, 120) || (b.kind === 'video' ? 'Video' : 'Photo');
  for (let tries = 0; tries < 5; tries++) {
    const id = [...crypto.getRandomValues(new Uint8Array(4))].map((x) => x.toString(16).padStart(2, '0')).join('');
    if (await env.DB.prepare('SELECT 1 FROM library WHERE id = ?').bind(id).first()) continue;
    await env.DB.batch([
      env.DB.prepare('INSERT INTO library (id, kind, name, added, added_by, thumb) VALUES (?, ?, ?, ?, ?, ?)').bind(id, b.kind, name, now(), who, thumb),
      ...digests.map((d) => env.DB.prepare('INSERT INTO original (digest, item_id) VALUES (?, ?)').bind(d, id)),
    ]);
    return { id, shared: false, name, scene: null };
  }
  throw new Bad('Couldn\'t make a code for it: try again', 500);
}

/* POST /edit/api/library/original { id, digest }: another version of a video item (a file already stored). */
export async function addOriginal(env, id, digest) {
  const item = await env.DB.prepare('SELECT kind FROM library WHERE id = ?').bind(id).first();
  if (!item) throw new Bad('No such item', 404);
  if (item.kind !== 'video') throw new Bad('Only a video has several versions');
  const f = (await filesOf(env, [digest])).get(digest);
  if (f.type !== 'video/mp4') throw new Bad('That file isn\'t a video');
  const at = await env.DB.prepare('SELECT item_id FROM original WHERE digest = ?').bind(digest).first();
  if (at && at.item_id !== id) throw new Bad('That video file already belongs to another item in the Library', 409);
  if (!at) {
    if ((await env.DB.prepare('SELECT count(*) n FROM original WHERE item_id = ?').bind(id).first()).n >= 12) throw new Bad('That video has too many versions');
    await env.DB.prepare('INSERT INTO original (digest, item_id) VALUES (?, ?)').bind(digest, id).run();
  }
  return { id, digest };
}

/* A recipe's settings, checked: how a picture was made from its original (edit/darkroom.js), all positions as
   fractions of the original's width and height. Every photo recipe may have white balance: 'none' or 'picks'
   (from spots), with brightness (how bright the white comes out, 0.5 to 1) and warmth (the share of the light's
   colour kept, 0 to 1). Then, by kind:
   flat (a flat thing squared up): the four corners, in the order its top left, top right, bottom right and
   bottom left, so they also say which way up it goes (and whether it's mirrored); shape, the proportions it was
   squared up to [height, width] when known (typed in the darkroom, or a painting's measured size offered there:
   the artwork drives the recipe, never the reverse); white_paper: a drawing on white paper (reopening one with
   no other choices starts from "Find the paper").
   scene (a scene straightened and cropped, step 4 slice 4): angle, the turn in degrees (clockwise positive) about
   the photo's centre, and crop [left, top, right, bottom] of the turned photo's frame (the original's size).
   video: no choices yet. {} = as supplied. */
function settingsOf(kind, p) {
  if (kind === 'video') return {};
  if (p == null || typeof p !== 'object' || Array.isArray(p)) throw new Bad('Bad settings');
  const num = (v, what) => { if (typeof v !== 'number' || !isFinite(v)) throw new Bad(`${what} must be a number`); return v; };
  const frac = (v) => { num(v, 'A position'); if (v < 0 || v > 1) throw new Bad('A position is off the photo'); return Math.round(v * 1e5) / 1e5; };
  const out = {};
  if (p.white != null) {
    if (!['none', 'picks'].includes(p.white)) throw new Bad('Bad white balance');
    const points = (a, lo, hi, what) => {
      if (!Array.isArray(a) || a.length < lo || a.length > hi) throw new Bad(`Bad ${what}`);
      return a.map((q) => { if (!Array.isArray(q) || q.length !== 2) throw new Bad(`Bad ${what}`); return q.map(frac); });
    };
    out.white = p.white;
    if (p.white === 'picks') out.spots = points(p.spots, 1, 40, 'white spots');
    if (p.white !== 'none') {
      const share = (v, lo, what) => { num(v, what); if (v < lo || v > 1) throw new Bad(`Bad ${what}`); return Math.round(v * 100) / 100; };
      out.brightness = share(p.brightness ?? 1, 0.5, 'brightness');
      out.warmth = share(p.warmth ?? 0, 0, 'warmth');
    }
    if (kind === 'flat' && p.corners != null) out.corners = points(p.corners, 4, 4, 'corners');
    if (kind === 'flat' && p.shape != null) {
      if (!Array.isArray(p.shape) || p.shape.length !== 2 || !p.shape.every((v) => num(v, 'Size') > 0 && v < 10000)) throw new Bad('Bad size');
      out.shape = p.shape.slice();
    }
  }
  if (kind === 'scene') {
    if (p.angle != null && num(p.angle, 'The angle') !== 0) {
      if (Math.abs(p.angle) > 45) throw new Bad('The angle must be within 45 degrees');
      out.angle = Math.round(p.angle * 100) / 100;
    }
    if (p.crop != null) {
      if (!Array.isArray(p.crop) || p.crop.length !== 4) throw new Bad('Bad crop');
      const c = p.crop.map(frac);
      if (!(c[2] - c[0] > 0.01 && c[3] - c[1] > 0.01)) throw new Bad('The crop is too small');
      out.crop = c;
    }
  }
  if (kind === 'flat' && p.white_paper === true) out.white_paper = true;
  return out;
}

/* POST /edit/api/library/rendition { item, recipe?, kind?, label?, settings?, files: [{ digest, role, shape? }] }:
   a new rendition, from files already stored. With `recipe` it is that recipe's next one, and the recipe's
   settings become these (the recipe re-edited); without, a new recipe of `kind` is made for it.
   A picture (flat or scene): its sizes (role size) and, for link previews, a preview. A video: its versions
   (role version; each must be one of the item's originals) and first and last frames for each shape (role first
   or last, with shape wide or tall). Widths, and a version's shape, are the stored files' own: facts, not what
   the browser says. Answers the rendition as media.js describes it. */
export async function newRendition(env, who, b) {
  const id = String(b.item || '');
  if (!CODE.test(id)) throw new Bad('Bad code');
  const item = await env.DB.prepare('SELECT kind FROM library WHERE id = ?').bind(id).first();
  if (!item) throw new Bad('No such item', 404);
  let recipe = null;
  if (b.recipe != null) {
    recipe = await env.DB.prepare('SELECT id, kind, item_id FROM recipe WHERE id = ?').bind(b.recipe).first();
    if (!recipe || recipe.item_id !== id) throw new Bad('No such recipe for that item', 404);
  }
  const kind = recipe ? recipe.kind : b.kind;
  if (!['flat', 'scene', 'video'].includes(kind)) throw new Bad('Bad kind of recipe');
  if ((kind === 'video') !== (item.kind === 'video')) throw new Bad('That kind of recipe doesn\'t fit that item');
  const settings = JSON.stringify(settingsOf(kind, b.settings ?? {}));
  if (!Array.isArray(b.files) || !b.files.length || b.files.length > 40) throw new Bad('A rendition needs its files');
  const stored = await filesOf(env, b.files.map((f) => String(f.digest || '')));
  const mine = kind === 'video' ? new Set((await env.DB.prepare('SELECT digest FROM original WHERE item_id = ?').bind(id).all()).results.map((o) => o.digest)) : null;
  const rows = [], seen = new Set();
  let top = null;
  for (const f of b.files) {
    const s = stored.get(f.digest), isVideo = s.type === 'video/mp4';
    if (!(kind === 'video' ? ['version', 'first', 'last'] : ['size', 'preview']).includes(f.role)) throw new Bad('Bad role for a file');
    if ((f.role === 'version') !== isVideo) throw new Bad('A file isn\'t what its role says');
    if (!s.w || !s.h) throw new Bad('A file\'s size in pixels isn\'t known');
    if (f.role === 'version' && !mine.has(f.digest)) throw new Bad('A version isn\'t one of that video\'s originals');
    const shape = f.role === 'version' ? (s.h > s.w ? 'tall' : 'wide') : kind === 'video' ? f.shape : null;
    if (kind === 'video' && !['wide', 'tall'].includes(shape)) throw new Bad('A frame needs its shape');
    const key = `${f.digest} ${f.role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push([f.digest, f.role, s.w, shape]);
    if ((f.role === 'size' || f.role === 'version') && (!top || s.w * s.h > top.w * top.h)) top = s;
  }
  if (!top) throw new Bad(kind === 'video' ? 'A video\'s rendition needs a version' : 'A picture\'s rendition needs a size');
  const at = now();
  if (!recipe) {
    const label = String(b.label || '').trim().slice(0, 120);
    recipe = await env.DB.prepare('INSERT INTO recipe (item_id, kind, label, settings, changed, changed_by) VALUES (?, ?, ?, ?, ?, ?) RETURNING id')
      .bind(id, kind, label, settings, at, who).first();
  }
  const n = ((await env.DB.prepare('SELECT max(n) n FROM rendition WHERE recipe_id = ?').bind(recipe.id).first()).n || 0) + 1;
  await env.DB.batch([   // one transaction: the rendition with all its files, or nothing
    env.DB.prepare('UPDATE recipe SET settings = ?, changed = ?, changed_by = ? WHERE id = ?').bind(settings, at, who, recipe.id),
    env.DB.prepare('INSERT INTO rendition (recipe_id, n, settings, w, h, made, made_by) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(recipe.id, n, settings, top.w, top.h, at, who),
    env.DB.prepare(`INSERT INTO rendition_file (rendition_id, digest, role, width, shape)
      SELECT (SELECT id FROM rendition WHERE recipe_id = ? AND n = ?), value->>0, value->>1, value->>2, value->>3 FROM json_each(?)`).bind(recipe.id, n, JSON.stringify(rows)),
  ]);
  const made = [...(await renditions(env, 'WHERE r.recipe_id = ? AND r.n = ?', recipe.id, n)).values()][0];
  return { rendition: made };
}

/* GET /edit/api/original?item=<code>: a photo item's original, for reopening a picture in the darkroom. Only
   ever to the signed-in editor (this API); visitors never get originals. */
export async function original(env, id) {
  if (!env.MEDIA) throw new Bad('Image storage (R2) is not switched on', 503);
  if (!CODE.test(id)) throw new Bad('Bad code');
  const row = await env.DB.prepare('SELECT f.digest, f.type FROM original o JOIN file f ON f.digest = o.digest WHERE o.item_id = ? AND f.type != \'video/mp4\' LIMIT 1').bind(id).first();
  const obj = row && await env.MEDIA.get(row.digest);
  if (!obj) throw new Bad('The original photo isn\'t in storage', 404);
  return new Response(obj.body, { headers: { 'content-type': row.type, 'cache-control': 'private, no-store' } });
}

/* POST /edit/api/library/item { id, name?, alt?, credit? }: what is true of the item itself: its name in the
   Library, its alternative text (what the picture shows, for visitors who can't see it) and its credit (who made
   it, when it wasn't the site's owner). Only what is sent changes; alt and credit may be emptied, a name not. */
export async function describe(env, b) {
  const id = String(b.id || '');
  if (!CODE.test(id)) throw new Bad('Bad code');
  const sets = [], binds = [], out = { id };
  const text = (k, max, what, need) => {
    if (b[k] == null) return;
    if (typeof b[k] !== 'string' || b[k].length > max || (need && !b[k].trim())) throw new Bad(`${what} must be ${need ? '1' : '0'} to ${max} characters`);
    out[k] = b[k].trim(); sets.push(`${k} = ?`); binds.push(out[k]);
  };
  text('name', 120, 'A name', true); text('alt', 500, 'Alternative text'); text('credit', 200, 'A credit');
  if (!sets.length) throw new Bad('Nothing to change');
  const r = await env.DB.prepare(`UPDATE library SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, id).run();
  if (!r.meta.changes) throw new Bad('No such item', 404);
  return out;
}

/* POST /edit/api/library/recipe { id, label }: a recipe's label, to tell several made from one photo apart
   ('' = none). Saves at once, like the item's name. */
export async function nameRecipe(env, who, b) {
  const id = Number(b.id);
  if (!Number.isInteger(id) || id < 1) throw new Bad('Bad recipe');
  if (typeof b.label !== 'string' || b.label.length > 120) throw new Bad('A label must be 0 to 120 characters');
  const label = b.label.trim();
  const r = await env.DB.prepare('UPDATE recipe SET label = ?, changed = ?, changed_by = ? WHERE id = ?').bind(label, now(), who, id).run();
  if (!r.meta.changes) throw new Bad('No such recipe', 404);
  return { id, label };
}

/* POST /edit/api/library/delete { rendition } or { id, history? }: a rendition, or an item, for good (see the
   top). Files nothing refers to any more go from storage, and visitors' cached copies are purged. */
export async function remove(env, url, b) {
  if (!env.MEDIA) throw new Bad('File storage (R2) is not switched on', 503);
  const uses = await allUses(env);
  const names = (list) => [...new Set(list.map((u) => u.label))].join(', ');
  if (b.rendition != null) {
    const r = await env.DB.prepare('SELECT id, recipe_id FROM rendition WHERE id = ?').bind(b.rendition).first();
    if (!r) throw new Bad('No such rendition', 404);
    const used = uses.get(r.id) || [];
    if (used.length) throw new Bad(`Still used by ${names(used)}`, 409);
    const digests = (await env.DB.prepare('SELECT digest FROM rendition_file WHERE rendition_id = ?').bind(r.id).all()).results.map((f) => f.digest);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM rendition WHERE id = ?').bind(r.id),
      env.DB.prepare('DELETE FROM recipe WHERE id = ? AND id NOT IN (SELECT recipe_id FROM rendition)').bind(r.recipe_id),
      // the recipe's settings are those of its newest rendition (a trial that was deleted leaves no trace)
      env.DB.prepare('UPDATE recipe SET settings = (SELECT settings FROM rendition WHERE recipe_id = ?1 ORDER BY n DESC LIMIT 1) WHERE id = ?1').bind(r.recipe_id),
      ...closeGap(env, r.recipe_id),
    ]);
    const gone = await sweep(env, url, digests);
    return { deleted: r.id, ...gone };
  }
  const id = String(b.id || '');
  if (!CODE.test(id)) throw new Bad('Bad code');
  if (!(await env.DB.prepare('SELECT 1 FROM library WHERE id = ?').bind(id).first())) throw new Bad('No such item', 404);
  const rens = (await env.DB.prepare('SELECT r.id FROM rendition r JOIN recipe c ON c.id = r.recipe_id WHERE c.item_id = ?').bind(id).all()).results.map((r) => r.id);
  const mine = rens.flatMap((r) => uses.get(r) || []);
  const live = mine.filter((u) => u.state !== 'history');
  if (live.length) throw new Bad(`Still used by ${names(live)}: remove it there first`, 409);
  const past = [...new Set(mine.map((u) => u.revision))];
  if (past.length && b.history !== true) throw new Bad('History still has versions that use it', 409);
  const digests = (await env.DB.prepare(`SELECT digest FROM original WHERE item_id = ?1 UNION
    SELECT thumb FROM library WHERE id = ?1 AND thumb IS NOT NULL UNION
    SELECT rf.digest FROM rendition_file rf JOIN rendition r ON r.id = rf.rendition_id JOIN recipe c ON c.id = r.recipe_id WHERE c.item_id = ?1`).bind(id).all()).results.map((f) => f.digest);
  const stmts = [];
  if (past.length) {
    stmts.push(env.DB.prepare('DELETE FROM revisions WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(past)));
    stmts.push(env.DB.prepare('DELETE FROM releases WHERE id NOT IN (SELECT release_id FROM revisions)'));
  }
  stmts.push(env.DB.prepare('DELETE FROM library WHERE id = ?').bind(id));   // its originals, recipes and renditions go with it (foreign keys)
  await env.DB.batch(stmts);
  const gone = await sweep(env, url, digests);
  return { deleted: id, history: past.length, ...gone };
}

/* POST /edit/api/history/forget { entry }: something removed from the site (its removal published, so it is no
   longer in the editor at all) deleted for good from History: every version of it goes (and any publication left
   with nothing in it), so it can't be brought back. Pictures that only those versions named go too, files and
   all, except a recipe's newest picture, which is the darkroom's latest work and stays in the Library (delete it
   there, line or item, if it isn't wanted either). The Library item, its photo and its recipes stay: removing a
   use never deletes what it used (the two layers, docs/entities.md). */
export async function forget(env, url, b) {
  const id = String(b.entry || '');
  if (!id || id.length > 100) throw new Bad('Bad entry');
  if (await env.DB.prepare('SELECT 1 FROM entries WHERE id = ?').bind(id).first()) {
    throw new Bad('It is still in the editor: remove it and publish that first', 409);
  }
  const versions = (await env.DB.prepare('SELECT data, previous FROM revisions WHERE entry_id = ?').bind(id).all()).results;
  if (!versions.length) throw new Bad('History has nothing of that', 404);
  const named = new Set();
  for (const v of versions) for (const t of [v.data, v.previous]) {
    try { const r = t && JSON.parse(t).rendition; if (Number.isInteger(r)) named.add(r); } catch { /* not a document with a picture */ }
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM revisions WHERE entry_id = ?').bind(id),
    env.DB.prepare('DELETE FROM releases WHERE id NOT IN (SELECT release_id FROM revisions)'),
  ]);
  const uses = await allUses(env);
  const loose = JSON.stringify([...named].filter((r) => !uses.has(r)));
  const olds = await env.DB.prepare(`SELECT r.id FROM rendition r WHERE r.id IN (SELECT value FROM json_each(?1))
    AND r.n < (SELECT MAX(x.n) FROM rendition x WHERE x.recipe_id = r.recipe_id)`).bind(loose).all();
  const gone = JSON.stringify(olds.results.map((r) => r.id));
  const digests = (await env.DB.prepare('SELECT DISTINCT digest FROM rendition_file WHERE rendition_id IN (SELECT value FROM json_each(?))')
    .bind(gone).all()).results.map((f) => f.digest);
  if (olds.results.length) {
    const recipes = (await env.DB.prepare('SELECT DISTINCT recipe_id FROM rendition WHERE id IN (SELECT value FROM json_each(?))').bind(gone).all()).results;
    await env.DB.batch([env.DB.prepare('DELETE FROM rendition WHERE id IN (SELECT value FROM json_each(?))').bind(gone),
      ...recipes.flatMap((c) => closeGap(env, c.recipe_id))]);
  }
  return { forgotten: id, versions: versions.length, renditions: olds.results.length, ...(await sweep(env, url, digests)) };
}

/* A recipe's renditions numbered 1, 2, 3... again in the order they were made, after one is deleted (the number is
   only its place in the list: migration 0008). Two steps, so no two share a number midway. For a batch. */
function closeGap(env, recipe) {
  return [env.DB.prepare('UPDATE rendition SET n = n + 100000 WHERE recipe_id = ?').bind(recipe),
    env.DB.prepare(`UPDATE rendition SET n = (SELECT COUNT(*) FROM rendition x WHERE x.recipe_id = ?1 AND x.id <= rendition.id)
      WHERE recipe_id = ?1`).bind(recipe)];
}

/* Of these files, delete from storage those that no original and no rendition refers to any more; and with
   them any stray file stored over a day ago that nothing ever referred to (an upload that broke off). */
async function sweep(env, url, digests) {
  const { results } = await env.DB.prepare(`SELECT digest, type FROM file
    WHERE (digest IN (SELECT value FROM json_each(?1)) OR added < ?2)
      AND digest NOT IN (SELECT digest FROM original) AND digest NOT IN (SELECT digest FROM rendition_file)
      AND digest NOT IN (SELECT thumb FROM library WHERE thumb IS NOT NULL)`)
    .bind(JSON.stringify(digests), new Date(Date.now() - 86400000).toISOString()).all();
  if (!results.length) return { files: 0, purged: 'nothing to purge' };
  const keys = results.map((f) => f.digest);
  for (let i = 0; i < keys.length; i += 1000) await env.MEDIA.delete(keys.slice(i, i + 1000));
  await env.DB.prepare('DELETE FROM file WHERE digest IN (SELECT value FROM json_each(?))').bind(JSON.stringify(keys)).run();
  return { files: keys.length, purged: await purge(env, url, results.map((f) => fileUrl(f))) };
}

/* Cloudflare keeps visitors' copies of published files for up to a year (worker.js), in every data centre. This
   Worker's cache.delete reaches only the one it runs in, so the proper purge is Cloudflare's API (purge by URL),
   with secret PURGE_TOKEN (Zone > Cache Purge) and var ZONE_ID. paths: the files' addresses (/media/...). */
export async function purge(env, url, paths) {
  const hosts = url.hostname.startsWith('admin-dev') ? ['dev.chrisjones.org.uk']
    : url.hostname.startsWith('admin') ? ['chrisjones.org.uk', 'www.chrisjones.org.uk'] : [url.host];
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

