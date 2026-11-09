/* The one-off move of files from the old names (images/, originals/, videos/) into the Library's layout
   (media/<code>/..., paths.js), step 1d, Nov 2026. Run from the editor's Library tab on each site (dev and live
   hold different files, so each works out its own plan); remove this file once both have moved.

   1. plan:   works out an item for everything any entry or History version uses: a photo item for each
              original (with a set of sizes, r1, r2..., for each set of images made from it), and a video item
              for each background video (its versions as <w>x<h>.mp4, and one set of frames per shape, taken
              from that shape's largest version, up to 2560 across). Catalogues them (the `library` table, with
              names carried over from the Library's earlier names where it had them) and lists every copy to make
              (the `moves` table). Files nothing uses are left out: they go with the old folders.
   2. copy:   copies a few files a call (the browser calls until done), never overwriting.
   3. finish: rewrites every entry, draft and published, and every History version to name the items instead.
              The old files are untouched, so this can be checked on the site before:
   4. clear:  deletes the old folders, a batch a call, then the move's own tables. */

import { listAll, Bad } from './library.js';

const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const FRAME_MAX = 2560;
const SECTIONS = { hero: 'Opening', contact: 'Contact', footer: 'Footer' };
const code = () => [...crypto.getRandomValues(new Uint8Array(4))].map((x) => x.toString(16).padStart(2, '0')).join('');
const vnum = (s) => Number((/-v(\d+)$/.exec(s) || [0, 1])[1]);

async function tables(env) {
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS moves (src TEXT PRIMARY KEY, dst TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS migration (k TEXT PRIMARY KEY, v TEXT NOT NULL)'),
  ]);
}
async function getMap(env) {
  const r = await env.DB.prepare('SELECT v FROM migration WHERE k = \'map\'').first().catch(() => null);
  return r ? JSON.parse(r.v) : null;
}

/* Every stored version of every painting and background, old-style ones only. */
async function sources(env) {
  const out = [];
  const e = await env.DB.prepare('SELECT id, kind, draft, published FROM entries WHERE kind IN (\'painting\', \'background\')').all();
  for (const r of e.results) for (const t of [r.draft, r.published]) if (t) out.push([r.kind, r.id, JSON.parse(t)]);
  const v = await env.DB.prepare('SELECT entry_id, kind, data, previous FROM revisions WHERE kind IN (\'painting\', \'background\') ORDER BY id DESC').all();
  for (const r of v.results) for (const t of [r.data, r.previous]) if (t) out.push([r.kind, r.entry_id, JSON.parse(t)]);
  return out.filter(([, , d]) => !d.media);
}

export async function status(env) {
  const map = await getMap(env);
  const m = map ? await env.DB.prepare('SELECT count(*) n, sum(done > 0) d, sum(done = 2) missing FROM moves').first() : null;
  return { planned: !!map, finished: !!(map && map.finished), total: m ? m.n : 0, done: m ? m.d || 0 : 0, missing: m ? m.missing || 0 : 0 };
}

export async function plan(env, who) {
  await tables(env);
  if (await getMap(env)) return status(env);
  const keys = new Map();
  for (const p of ['images/', 'originals/', 'videos/']) for (const o of await listAll(env, p)) keys.set(o.key, o.size);
  const oldNames = Object.fromEntries(((await env.DB.prepare('SELECT id, name FROM media').all().catch(() => ({ results: [] }))).results || []).map((r) => [r.id, r.name]));
  const findOriginal = (name) => [...keys.keys()].find((k) => k.startsWith(`originals/${name}.`) && k.slice(10, k.lastIndexOf('.')) === name);

  const photos = new Map();     // original key -> { stems: Map stem -> { ext, w, h, widths }, name, grp }
  const videos = new Map();     // set file -> { versions: Map name -> v, name }
  for (const [kind, id, d] of await sources(env)) {
    if (kind === 'painting' || d.type !== 'video') {
      const stem = kind === 'painting' ? (d.file || d.name) : d.file;
      const orig = kind === 'painting' ? (d.process?.original || findOriginal(d.name) || `none:${stem}`) : (d.original || `none:${stem}`);
      if (!photos.has(orig)) {
        photos.set(orig, { stems: new Map(), grp: kind === 'painting' ? 'painting' : 'site',
          name: oldNames[orig] || (kind === 'painting' ? d.title : `${SECTIONS[id.slice(3)] || id.slice(3)} background`) });
      }
      const ph = photos.get(orig);
      if (!ph.stems.has(stem)) ph.stems.set(stem, { ext: kind === 'painting' ? d.ext : 'jpg', w: d.w, h: d.h, widths: d.widths });
    } else {
      if (!videos.has(d.file)) videos.set(d.file, { versions: new Map(), name: oldNames[`videos/${d.file}`] || `${SECTIONS[id.slice(3)] || id.slice(3)} background video` });
      const vs = videos.get(d.file).versions;
      for (const v of d.versions) if (!vs.has(v.name) || (v.stills && !vs.get(v.name).stills)) vs.set(v.name, v);
    }
  }

  const map = { photos: {}, videos: {}, at: now(), by: who };
  const moves = [], rows = [];
  for (const [orig, ph] of photos) {
    const id = code();
    const renditions = {}, stems = {};
    [...ph.stems.keys()].sort((a, b) => vnum(a) - vnum(b) || a.localeCompare(b)).forEach((stem, i) => {
      const part = `r${i + 1}`, s = ph.stems.get(stem);
      stems[stem] = part;
      renditions[part] = { widths: s.widths, w: s.w, h: s.h, ext: s.ext };
      const own = new RegExp(`^images/${stem.replace(/[-]/g, '\\-')}-(\\d{2,4}|preview)\\.(jpg|webp)$`);
      for (const k of keys.keys()) { const m = own.exec(k); if (m) moves.push([k, `media/${id}/${part}/${m[1]}.${m[2]}`]); }
    });
    const hasOriginal = keys.has(orig);
    if (hasOriginal) moves.push([orig, `media/${id}/original.${orig.split('.').pop().toLowerCase()}`]);
    const hash = (/^originals\/([0-9a-f]{12})-/.exec(orig) || [])[1] || null;
    map.photos[orig] = { id, stems };
    rows.push([id, 'photo', ph.grp, ph.name, hash, JSON.stringify({ renditions })]);
  }
  for (const [file, vd] of videos) {
    const id = code();
    const versions = {}, list = [], frames = {};
    const used = new Set();
    for (const v of vd.versions.values()) {
      let f = `${v.w}x${v.h}`;
      for (let n = 2; used.has(f); n++) f = `${v.w}x${v.h}-${n}`;
      used.add(f);
      versions[v.name] = f;
      list.push({ file: f, w: v.w, h: v.h, bytes: v.bytes, seconds: v.seconds });
      if (keys.has(`videos/${v.name}.mp4`)) moves.push([`videos/${v.name}.mp4`, `media/${id}/${f}.mp4`]);
    }
    for (const [shape, up] of [['wide', false], ['tall', true]]) {
      const from = [...vd.versions.values()].filter((v) => (v.h > v.w) === up && v.stills).sort((a, b) => b.w - a.w)[0];
      if (!from) continue;
      const widths = from.stills.filter((w) => w <= FRAME_MAX && keys.has(`images/${from.name}-first-${w}.jpg`) && keys.has(`images/${from.name}-last-${w}.jpg`));
      if (!widths.length) continue;
      const dir = `${shape}-1`;
      frames[shape] = { dir, widths, from: versions[from.name] };
      for (const w of widths) for (const fl of ['first', 'last']) moves.push([`images/${from.name}-${fl}-${w}.jpg`, `media/${id}/${dir}/${fl}-${w}.jpg`]);
    }
    map.videos[file] = { id, versions, frames };
    rows.push([id, 'video', 'site', vd.name, null, JSON.stringify({ versions: list, frames })]);
  }
  const at = now();
  const stmts = [env.DB.prepare('INSERT INTO migration (k, v) VALUES (\'map\', ?)').bind(JSON.stringify(map))];
  for (const r of rows) stmts.push(env.DB.prepare('INSERT INTO library (id, kind, grp, name, hash, data, added, added_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(...r, at, who));
  for (const [src, dst] of moves) stmts.push(env.DB.prepare('INSERT OR IGNORE INTO moves (src, dst) VALUES (?, ?)').bind(src, dst));
  await env.DB.batch(stmts);
  return status(env);
}

/* Copy a few files (R2 to R2, streamed). A file already copied is skipped; a missing one is marked (done 2). */
export async function copy(env, n = 8) {
  const { results } = await env.DB.prepare('SELECT src, dst FROM moves WHERE done = 0 LIMIT ?').bind(Math.min(n, 20)).all();
  const stmts = [];
  for (const { src, dst } of results) {
    let done = 1;
    if (!(await env.MEDIA.head(dst))) {
      const obj = await env.MEDIA.get(src);
      if (!obj) done = 2;
      else await env.MEDIA.put(dst, obj.body, { httpMetadata: obj.httpMetadata });
    }
    stmts.push(env.DB.prepare('UPDATE moves SET done = ? WHERE src = ?').bind(done, src));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return status(env);
}

/* An old-style painting or background as it is in the new layout. */
function rewrite(map, kind, d) {
  if (!d || d.media) return d;
  if (kind === 'painting' || d.type !== 'video') {
    const stem = kind === 'painting' ? (d.file || d.name) : d.file;
    const ph = Object.values(map.photos).find((p) => p.stems[stem]);
    if (!ph) return d;
    const part = ph.stems[stem];
    if (kind === 'painting') {
      const { base, file, preview, process, ...rest } = d;
      return { ...rest, media: ph.id, rendition: part,
        preview: { src: `media/${ph.id}/${part}/preview.jpg`, w: preview.w, h: preview.h },
        ...(process ? { process: { ...process, original: `media/${ph.id}` } } : {}) };
    }
    return { type: 'photo', media: ph.id, rendition: part, focus: d.focus, shade: d.shade, w: d.w, h: d.h, widths: d.widths };
  }
  const vi = map.videos[d.file];
  if (!vi) return d;
  const versions = d.versions.map((v) => ({ file: vi.versions[v.name], w: v.w, h: v.h, bytes: v.bytes, seconds: v.seconds }));
  const frames = {};
  for (const [shape, up] of [['wide', false], ['tall', true]]) {
    if (versions.some((v) => (v.h > v.w) === up) && vi.frames[shape]) frames[shape] = vi.frames[shape];
  }
  if (!frames.wide && !frames.tall) Object.assign(frames, vi.frames);
  return { type: 'video', media: vi.id, focus: d.focus, shade: d.shade, versions, frames, play: d.play, calm: d.calm };
}

/* Rewrite every entry and History version. normalise: editor.js's, so the JSON has its usual key order. */
export async function finish(env, normalise) {
  const map = await getMap(env);
  if (!map) throw new Bad('Nothing planned');
  if (map.finished) return status(env);
  const s = await status(env);
  if (s.done < s.total) throw new Bad('Not every file has been copied yet');
  const tidy = (id, kind, text) => {
    if (!text) return text;
    const d = JSON.parse(text);
    if (d.media) return text;
    const n = rewrite(map, kind, d);
    if (n === d) return text;
    try { return JSON.stringify(normalise(id, kind, n)); } catch { return JSON.stringify(n); }
  };
  const stmts = [];
  const e = await env.DB.prepare('SELECT id, kind, draft, published FROM entries WHERE kind IN (\'painting\', \'background\')').all();
  for (const r of e.results) {
    const draft = tidy(r.id, r.kind, r.draft), published = tidy(r.id, r.kind, r.published);
    if (draft !== r.draft || published !== r.published) {
      stmts.push(env.DB.prepare('UPDATE entries SET draft = ?, published = ? WHERE id = ?').bind(draft, published, r.id));
    }
  }
  const v = await env.DB.prepare('SELECT id, entry_id, kind, data, previous FROM revisions WHERE kind IN (\'painting\', \'background\')').all();
  for (const r of v.results) {
    const data = tidy(r.entry_id, r.kind, r.data), previous = tidy(r.entry_id, r.kind, r.previous);
    if (data !== r.data || previous !== r.previous) {
      stmts.push(env.DB.prepare('UPDATE revisions SET data = ?, previous = ? WHERE id = ?').bind(data, previous, r.id));
    }
  }
  map.finished = now();
  stmts.push(env.DB.prepare('UPDATE migration SET v = ? WHERE k = \'map\'').bind(JSON.stringify(map)));
  await env.DB.batch(stmts);
  return { ...(await status(env)), rewritten: stmts.length - 1 };
}

/* Delete a batch of the old files; when none are left, the move's own tables (and the old catalogue) go too. */
export async function clear(env) {
  const map = await getMap(env);
  if (!map || !map.finished) throw new Bad('Finish the move (and check the site) first');
  let deleted = 0;
  for (const p of ['images/', 'originals/', 'videos/']) {
    const page = await env.MEDIA.list({ prefix: p, limit: 500 });
    if (page.objects.length) { await env.MEDIA.delete(page.objects.map((o) => o.key)); deleted += page.objects.length; }
  }
  if (!deleted) {
    await env.DB.batch(['moves', 'migration', 'media'].map((t) => env.DB.prepare(`DROP TABLE IF EXISTS ${t}`)));
  }
  return { deleted };
}
