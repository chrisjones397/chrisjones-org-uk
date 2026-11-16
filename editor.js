/* The editor's server side: who is signed in, and the API the editor page (edit/, starting at edit/editor.js) calls.

   It runs only on the editor's address (admin.chrisjones.org.uk for live, admin-dev.chrisjones.org.uk for
   dev), which Cloudflare Access guards as a whole: nobody reaches it without the one-time code sent to an
   allowed email address. This checks Access's signed token as well, so a mistake in the Access settings
   can't open it up.

   Content lives in the database (migrations/): each entry has a draft and a published version. Editing
   changes drafts only; publishing copies chosen drafts to published, as one release, keeping a revision of
   each so any earlier version can be brought back as a draft. Uploaded files go to R2 (binding MEDIA), each
   under the digest of its bytes, and are recorded in the media layer's tables (library.js, media.js, paths.js).
   A document (an artwork, a background) names a rendition by its id: the one place the two layers meet.

   Every change is a POST (or PUT) with the editor's own address as its Origin, so another site can't make a
   signed-in browser change anything. Text is stored as typed and escaped wherever it's shown (site.js). */

import { slug } from './site.js';
import { SITES, tidy, ok } from './links.js';
import { library, rename, remove, newItem, addOriginal, newRendition, haveFile, putFile, original } from './library.js';
import { renditions, NAMED } from './media.js';

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
  const path = url.pathname.slice('/edit/api/'.length);
  try {
    if (request.method === 'GET') {
      if (path === 'state') return json(await state(env, who));
      if (path === 'history') return json(await history(env));
      if (path === 'original') return await original(env, url.searchParams.get('item') || '');
      if (path === 'file') return json(await haveFile(env, url.searchParams.get('digest') || ''));
      if (path === 'library') return json(await library(env));
      throw new Bad('Not found', 404);
    }
    if (request.headers.get('origin') !== url.origin) throw new Bad('Changes must come from the editor page', 403);
    if (request.method === 'PUT' && path === 'file') return json(await putFile(request, env, url, who));
    if (request.method !== 'POST' || !(request.headers.get('content-type') || '').startsWith('application/json')) {
      throw new Bad('Not found', 404);
    }
    const body = await request.json();
    if (path === 'save') return json(await save(env, who, body.items));
    if (path === 'discard') return json(await discard(env, body.ids));
    if (path === 'publish') return json(await publish(env, who, body.ids, body.note));
    if (path === 'restore') return json(await restore(env, who, body.revision));
    if (path === 'hide') return json(await setHidden(env, who, String(body.id || ''), body.hidden === true));
    if (path === 'library/name') return json(await rename(env, String(body.id || ''), body.name));
    if (path === 'library/delete') return json(await remove(env, url, body));
    if (path === 'library/new') return json(await newItem(env, who, body));
    if (path === 'library/original') return json(await addOriginal(env, String(body.id || ''), String(body.digest || '')));
    if (path === 'library/rendition') return json(await newRendition(env, who, body));
    throw new Bad('Not found', 404);
  } catch (e) {
    return json({ error: e.message || String(e) }, e.status || 500);
  }
}

async function rows(env) {
  return (await env.DB.prepare('SELECT id, kind, draft, published, draft_at, draft_by, published_at FROM entries').all()).results;
}

/* What the editor page keeps in step with the server after every change: the entries, and the renditions their
   drafts and published versions name (media.js), by id. */
async function content(env) {
  const [entries, named] = await Promise.all([rows(env), renditions(env, NAMED.both)]);
  return { entries, renditions: Object.fromEntries(named) };
}

async function state(env, who) {
  return { who, media: !!env.MEDIA, ...(await content(env)) };
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

/* The page sections' paragraph entries (edit/state.js PAGE), which may be created by the first paragraph typed. */
const PARAGRAPHS = ['t-hero', 't-gallery', 't-contact', 't-profile', 't-footer'];

/* The page sections that can have a photo or a video behind them (entries bg-<section>; index.html marks each
   with data-background="<section>"; PAGE in edit/state.js marks the same with bg). The gallery has its floating
   wall and the profile its head animation (a live 3D drawing), so they aren't listed. A new section that can take
   one needs only its name here and in edit/state.js, and the attribute. */
const BACKGROUNDS = ['hero', 'contact', 'footer'];

/* Hide (step 1d): an artwork, a genre or a section's background can be hidden: off the site (the editor's
   preview too, as it shows the site as it will be) but kept in the editor. Hiding acts at once (setHidden, slice
   4b): it's the opposite of Publish, not a change waiting for it. Stored only when true, last, so showing it again
   gives back the very same text as before. */
const hide = (d) => (d.hidden === true ? { hidden: true } : {});

/* A rendition's id, as a document names it. Whether it exists is checked where documents are saved (linked()). */
const renditionId = (v) => { if (!Number.isInteger(v) || v < 1) throw new Bad('Bad picture'); return v; };

export function normalise(id, kind, d) {
  if (!d || typeof d !== 'object') throw new Bad('Missing content');
  if (kind === 'genre') {
    const title = str(d.title, 120, 'A genre\'s name');
    if (!title) throw new Bad('A genre needs a name');
    return { title, order: int(d.order, 'Order'), ...hide(d) };
  }
  if (kind === 'artwork') {
    const title = str(d.title, 200, 'A title');
    if (!title) throw new Bad('A painting needs a title');
    if (!/^[a-z0-9-]{1,100}$/.test(d.name || '')) throw new Bad('Bad painting name');
    if (!/^s-[a-z0-9-]{1,80}$/.test(d.genre || '')) throw new Bad('Bad genre');
    // Medium, size in centimetres (height, width) and year, kept separately; the details line visitors see is
    // made from them whenever it's shown (paths.js detailsLine), never stored.
    const medium = str(d.medium ?? '', 120, 'Medium'), year = str(d.year ?? '', 20, 'Year');
    let cm = null;
    if (d.cm != null) {
      if (!Array.isArray(d.cm) || d.cm.length !== 2) throw new Bad('Bad size');
      cm = d.cm.map((v) => { num(v, 'Size'); if (!(v > 0 && v < 10000)) throw new Bad('A size must be more than 0 cm'); return Math.round(v * 10) / 10; });
    }
    // estimated: the size isn't measured (only a scale; the photo gave the shape). size_shown: whether visitors see
    // the size, kept only when it differs from the default (shown when measured, hidden when not).
    const estimated = !!cm && !!d.estimated;
    const shown = !!cm && (d.size_shown == null ? !estimated : !!d.size_shown);
    return {
      name: d.name, title, medium, cm, year, ...(estimated ? { estimated: true } : {}),
      ...(cm && shown !== !estimated ? { size_shown: shown } : {}), genre: d.genre,
      order: int(d.order, 'Order'), wide: !!d.wide, rendition: renditionId(d.rendition),
      ...(d.featured === true ? { featured: true } : {}), ...hide(d),   // Featured (starred): on the home page's wall; only when true
    };
  }
  if (kind === 'background') return backgroundOf(id, d);
  if (kind === 'text') return { text: str(d.text, 5000, 'Text') };
  if (kind === 'links') return linksOf(d);
  if (id === 'settings-gallery') return Object.fromEntries(GALLERY_SETTINGS.filter((k) => k in d).map((k) => [k, num(d[k], k)]));
  throw new Bad('Unknown kind of content');
}

/* A section's background (entries bg-<section>): the rendition it shows (a photo's sizes, or a video's versions
   and frames), its focus (the point kept in view when the screen's shape crops it) and shade; for a video also
   how it plays (once or loop) and what visitors who ask for reduced motion get (its last frame, or a fade).
   (Focus, play and calm become the Framing in step 5; the background keeps the shade and gains a list.) */
function backgroundOf(id, d) {
  if (!BACKGROUNDS.includes(id.slice(3))) throw new Bad('That section can\'t have a background');
  const frac = (v) => { num(v, 'A position'); if (v < 0 || v > 1) throw new Bad('The focus is off the picture'); return Math.round(v * 1000) / 1000; };
  if (!Array.isArray(d.focus) || d.focus.length !== 2) throw new Bad('Bad focus');
  num(d.shade, 'Shade');
  if (d.shade < 0 || d.shade > 0.6) throw new Bad('The shade must be between 0 and 60%');
  const out = { rendition: renditionId(d.rendition), focus: d.focus.map(frac), shade: Math.round(d.shade * 100) / 100 };
  if (d.play != null || d.calm != null) {
    if (!['once', 'loop'].includes(d.play)) throw new Bad('Bad way of playing');
    if (!['last', 'fade'].includes(d.calm)) throw new Bad('Bad choice for reduced motion');
    Object.assign(out, { play: d.play, calm: d.calm });
  }
  return { ...out, ...hide(d) };
}

/* The links inside documents can't be foreign keys (they are inside JSON), so they are checked here, on saving
   (docs/entities.md, section 3): the rendition a document names must exist and be the right kind of thing: a
   picture squared up or as it is for an artwork; a picture or a video for a background, with play and calm
   exactly when it is a video. docs: [{ kind, d }] as normalised. */
async function linked(env, docs) {
  const ids = [...new Set(docs.filter((x) => x.d.rendition != null).map((x) => x.d.rendition))];
  if (!ids.length) return;
  const { results } = await env.DB.prepare('SELECT r.id, c.kind FROM rendition r JOIN recipe c ON c.id = r.recipe_id WHERE r.id IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(ids)).all();
  const kindOf = new Map(results.map((r) => [r.id, r.kind]));
  for (const { kind, d } of docs) {
    if (d.rendition == null) continue;
    const k = kindOf.get(d.rendition);
    if (!k) throw new Bad('Its picture is no longer in the Library');
    if (kind === 'artwork' && k === 'video') throw new Bad('A painting\'s picture can\'t be a video');
    if (kind === 'background' && (k === 'video') !== (d.play != null)) throw new Bad(k === 'video' ? 'A video background needs how it plays' : 'Only a video background has a way of playing');
  }
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

/* items: [{ id, kind, data }], data null to delete. New artworks are "p-<name>"; new genres "s-<random>". */
async function save(env, who, items) {
  if (!Array.isArray(items) || !items.length || items.length > 200) throw new Bad('Nothing to save');
  const all = await rows(env);
  const byId = Object.fromEntries(all.map((r) => [r.id, r]));
  const names = new Set();
  for (const r of all) if (r.kind === 'artwork') for (const v of [r.draft, r.published]) if (v) names.add(`${JSON.parse(v).name}\u0000${r.id}`);
  const stmts = [], docs = [], at = now();
  for (const it of items) {
    if (!/^[a-z0-9-]{1,100}$/.test(it.id || '')) throw new Bad('Bad id');
    const old = byId[it.id];
    if (old && old.kind !== it.kind) throw new Bad('That entry is a different kind');
    if (!old && !((it.kind === 'artwork' && it.id.startsWith('p-')) || (it.kind === 'genre' && it.id.startsWith('s-'))
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
    docs.push({ kind: it.kind, d });
    if (it.kind === 'artwork') {
      if (it.id !== `p-${d.name}` && !old) throw new Bad('A new painting\'s id must be p-<name>');
      for (const n of names) {
        const [name, id] = n.split('\u0000');
        if (name === d.name && id !== it.id) throw new Bad(`Another painting already has the address /gallery/${d.name}/`);
      }
    }
    stmts.push(env.DB.prepare(`INSERT INTO entries (id, kind, draft, published, draft_at, draft_by) VALUES (?, ?, ?, NULL, ?, ?)
      ON CONFLICT(id) DO UPDATE SET draft = excluded.draft, draft_at = excluded.draft_at, draft_by = excluded.draft_by`)
      .bind(it.id, it.kind, JSON.stringify(d), at, who));
  }
  await linked(env, docs);
  if (stmts.length) await env.DB.batch(stmts);
  return content(env);
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
  return content(env);
}

/* Publish the chosen changes (ids), or every change (ids null), as one release. Anything a chosen change
   can't do without comes too, and is listed in the answer: an artwork's new genre, and the artworks
   still published in a genre being deleted. */
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
      if (r.kind === 'artwork' && r.draft) {
        const s = JSON.parse(r.draft).genre;
        if (byId[s] && byId[s].published === null) need.push(s);      // a genre not yet published
      }
      if (r.kind === 'genre' && r.draft === null) {
        for (const p of all) if (p.kind === 'artwork' && p.published && JSON.parse(p.published).genre === id) need.push(p.id);
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
  return { published: [...chosen], added, ...(await content(env)) };
}

/* Hide or show again at once (slice 4b): the published version and the draft both change, straight away, as a
   release of its own in History (so it can be brought back); any other change waiting in the draft stays waiting.
   Only something already on the site can be hidden: a never-published thing isn't seen by visitors anyway. */
const HIDEABLE = ['artwork', 'genre', 'background'];
async function setHidden(env, who, id, hidden) {
  const r = await env.DB.prepare('SELECT * FROM entries WHERE id = ?').bind(id).first();
  if (!r) throw new Bad('No such entry', 404);
  if (!HIDEABLE.includes(r.kind)) throw new Bad('Only paintings, genres and backgrounds can be hidden');
  if (r.published === null) throw new Bad('That isn\'t on the site yet, so there is nothing to hide');
  const flip = (text) => {
    const d = JSON.parse(text);
    delete d.hidden;
    if (hidden) d.hidden = true;
    return JSON.stringify(normalise(id, r.kind, d));
  };
  const published = flip(r.published);
  if (published === r.published) return content(env);
  let draft = r.draft;
  if (draft !== null) {
    try { draft = r.draft === r.published ? published : flip(r.draft); }
    catch { /* a draft that no longer passes the checks keeps waiting as it is */ }
  }
  const at = now(), d = JSON.parse(r.published);
  const what = r.kind === 'genre' ? `the genre ${d.title}` : r.kind === 'artwork' ? d.title : `the ${id.slice(3)} background`;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO releases (at, by, note) VALUES (?, ?, ?)').bind(at, who, `${hidden ? 'Hidden' : 'Shown again'}: ${what}`),
    env.DB.prepare('INSERT INTO revisions (release_id, entry_id, kind, data, previous) VALUES ((SELECT MAX(id) FROM releases), ?, ?, ?, ?)')
      .bind(id, r.kind, published, r.published),
    env.DB.prepare('UPDATE entries SET published = ?, published_at = ?, draft = ? WHERE id = ?').bind(published, at, draft, id),
  ]);
  return content(env);
}

/* Bring back an earlier version (a revision) as the draft. For a removal, that means undoing it: what it was just
   before it was removed (the revision's previous), not the removal itself (which would do nothing to something
   already gone). Refused if the picture it needs was deleted for good from the Library, or its genre is gone. */
async function restore(env, who, revision) {
  const v = await env.DB.prepare('SELECT * FROM revisions WHERE id = ?').bind(revision).first();
  if (!v) throw new Bad('No such version');
  const data = v.data ?? v.previous;
  if (data === null) throw new Bad('There is nothing in that version to bring back');
  const d = JSON.parse(data);
  if (d.rendition != null && !(await env.DB.prepare('SELECT 1 FROM rendition WHERE id = ?').bind(d.rendition).first())) {
    throw new Bad('Its picture has been deleted for good from the Library, so that version can\'t come back');
  }
  if (v.kind === 'artwork') {
    const sec = await env.DB.prepare('SELECT draft FROM entries WHERE id = ?').bind(d.genre).first();
    if (!sec || !sec.draft) throw new Bad('That version\'s genre no longer exists: bring the genre back first');
  }
  await env.DB.prepare(`INSERT INTO entries (id, kind, draft, published, draft_at, draft_by) VALUES (?, ?, ?, NULL, ?, ?)
    ON CONFLICT(id) DO UPDATE SET draft = excluded.draft, draft_at = excluded.draft_at, draft_by = excluded.draft_by`)
    .bind(v.entry_id, v.kind, data, now(), who).run();
  return content(env);
}

export { slug };
