/* The library (step 1d): the editor's catalogue of every file kept in R2, for the editor's Library tab.

   One item for each thing uploaded, with every file that came from it:
     a photo     originals/<...>.<ext> as uploaded, plus each set of sizes made from it (images/<file>-<width>.jpg,
                 or .webp for paintings moved from git, and -preview.jpg); a painting reprocessed has several sets
     a video     every version of one background video (a set: its sizes for wide screens and any for phones
                 held upright), videos/<file>-<w>x<h>.mp4, plus their first and last frames
                 (images/<version>-first-<width>.jpg and -last-); its id is videos/<file>, the set's own name.
                 A stored version that nothing has ever listed is an item of its own.
   Anything that fits neither (sizes whose original is missing) is an item of its own.

   The catalogue is the `media` table (db/schema.sql). Its id is the storage key of the item's main file
   (originals/apple-1.webp; videos/bg-hero for a video's set; images/<file> for sizes with no original): fixed for
   good. R2 can't rename (only copy and delete), and renaming would break History and every cached copy, so the
   name shown is only the catalogue's `name`, changed freely. The table is brought up to date with R2 every time
   the library is looked at, so nothing else has to remember to add to it.

   What uses an item: entries' drafts and published versions, and History (revisions' data: what "Bring back"
   restores). "Delete for good" is allowed only when no draft or published version uses it; if History does,
   it must be asked for explicitly, and those versions leave History with it. */

const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
class Bad extends Error { constructor(m, s = 400) { super(m); this.status = s; } }
export { Bad };

const SECTIONS = { hero: 'Opening', contact: 'Contact', footer: 'Footer' };

/* Every key in the bucket, with its size and upload time. */
async function allObjects(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.MEDIA.list({ limit: 1000, cursor });
    for (const o of page.objects) out.push({ key: o.key, size: o.size, uploaded: o.uploaded });
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

/* What one stored version of an entry points at: sizes (images/<stem>-...), originals (key, or originals/<stem>
   with no extension for paintings moved from git, which have no record of theirs) and video versions; links say
   which original each set of sizes was made from. */
function refsOf(kind, id, text) {
  const r = { stems: [], originals: [], videos: [], links: [], label: '', site: false, sets: [], dims: [] };
  if (!text) return r;
  let d;
  try { d = JSON.parse(text); } catch { return r; }
  if (kind === 'painting') {
    const stem = d.file || d.name;
    const orig = d.process?.original || `originals/${d.name}`;
    r.stems.push(stem); r.originals.push(orig); r.links.push([stem, orig]);
    r.label = d.title || stem;
  } else if (kind === 'background') {
    const where = SECTIONS[id.slice(3)] || id.slice(3);
    r.site = true;
    if (d.type === 'video') {
      for (const v of d.versions || []) {
        r.videos.push(v.name);
        r.sets.push([v.name, `videos/${d.file}`]);
        r.dims.push([v.name, v.w, v.h]);
        r.links.push([`${v.name}-first`, `videos/${v.name}`], [`${v.name}-last`, `videos/${v.name}`]);
      }
      r.label = `${where} background video`;
    } else {
      r.stems.push(d.file);
      if (d.original) { r.originals.push(d.original); r.links.push([d.file, d.original]); }
      r.label = `${where} background`;
    }
  }
  return r;
}

const noExt = (key) => key.replace(/\.[a-z0-9]{1,5}$/, '');

/* The whole library worked out afresh: items (with their files and what uses them), and the rows to write so the
   media table matches. */
async function survey(env) {
  const [objects, entries, revisions, known] = await Promise.all([
    allObjects(env),
    env.DB.prepare('SELECT id, kind, draft, published FROM entries WHERE kind IN (\'painting\', \'background\')').all(),
    env.DB.prepare('SELECT id, release_id, entry_id, kind, data FROM revisions WHERE kind IN (\'painting\', \'background\') AND data IS NOT NULL').all(),
    env.DB.prepare('SELECT * FROM media').all(),
  ]);

  // Everything that refers to stored files: [refs, how it's used]
  const uses = [];
  for (const e of entries.results) {
    if (e.draft) uses.push([refsOf(e.kind, e.id, e.draft), { entry: e.id, state: 'draft' }]);
    if (e.published) uses.push([refsOf(e.kind, e.id, e.published), { entry: e.id, state: 'published' }]);
  }
  for (const v of revisions.results) uses.push([refsOf(v.kind, v.entry_id, v.data), { entry: v.entry_id, state: 'history', revision: v.id }]);
  const link = new Map();                       // stem of a set of sizes -> its original (or video)
  const setOf = new Map(), dims = new Map();    // video version -> its set (videos/<file>), and its size
  for (const [r] of uses) {
    for (const [s, o] of r.links) if (!link.has(s)) link.set(s, o);
    for (const [v, set] of r.sets) if (!setOf.has(v)) setOf.set(v, set);
    for (const [v, w, h] of r.dims) if (!dims.has(v)) dims.set(v, [w, h]);
  }
  // a stored video version's item: its set, or itself if nothing ever listed it
  const videoItem = (name) => setOf.get(name) || `videos/${name}.mp4`;

  // The originals and videos actually stored, by key without extension
  const originals = new Map(), videos = new Set();
  for (const o of objects) {
    if (o.key.startsWith('originals/')) originals.set(noExt(o.key), o.key);
    else if (/^videos\/[a-z0-9-]+\.mp4$/.test(o.key)) videos.add(noExt(o.key));
  }

  const items = new Map();
  const item = (id) => {
    if (!items.has(id)) items.set(id, { id, files: [], bytes: 0, added: '', stems: new Set(), uses: [], labels: [], site: false });
    return items.get(id);
  };
  const add = (it, o) => {
    it.files.push(o.key); it.bytes += o.size;
    const t = o.uploaded instanceof Date ? o.uploaded.toISOString() : String(o.uploaded || '');
    if (!it.added || t < it.added) it.added = t.replace(/\.\d+Z$/, 'Z');
  };
  // which item a set of sizes (or a video's frames) belongs to
  const owner = (stem) => {
    const to = link.get(stem);
    if (to && to.startsWith('videos/') && videos.has(to)) return videoItem(to.slice(7));
    if (to && originals.has(noExt(to))) return originals.get(noExt(to));
    if (originals.has(`originals/${stem}`)) return originals.get(`originals/${stem}`);
    const frames = /^(.*)-(?:first|last)$/.exec(stem);
    if (frames && videos.has(`videos/${frames[1]}`)) return videoItem(frames[1]);
    return `images/${frames ? frames[1] : stem}`;
  };
  for (const o of objects) {
    const img = /^images\/([a-z0-9-]+)-(?:\d{2,4}|preview)\.(?:jpg|webp)$/.exec(o.key);
    if (img) { const it = item(owner(img[1])); add(it, o); it.stems.add(img[1]); continue; }
    const vid = /^videos\/([a-z0-9-]+)\.mp4$/.exec(o.key);
    if (vid) {                                       // a version: its set's item
      const it = item(videoItem(vid[1])); add(it, o);
      const [w, h] = dims.get(vid[1]) || (/-(\d+)x(\d+)(?:-v\d+)?$/.exec(vid[1]) || []).slice(1).map(Number);
      (it.versions ||= []).push({ name: vid[1], w: w || 0, h: h || 0, bytes: o.size });
      continue;
    }
    add(item(o.key), o);   // an original, or anything else: an item of its own (or its main file)
  }

  // Who uses what
  for (const [r, how] of uses) {
    const hit = new Set();
    for (const s of r.stems) { const id = owner(s); if (items.has(id)) hit.add(id); }
    for (const o of r.originals) { const k = originals.get(noExt(o)); if (k) hit.add(k); }
    for (const v of r.videos) if (videos.has(`videos/${v}`)) hit.add(videoItem(v));
    for (const id of hit) {
      const it = items.get(id);
      it.uses.push({ ...how, label: r.label });
      if (r.label && !it.labels.includes(r.label)) it.labels.push(r.label);
      if (r.site) it.site = true;
    }
  }

  // Bring the media table up to date
  const rows = new Map(known.results.map((m) => [m.id, m]));
  const stmts = [];
  const out = [];
  for (const it of items.values()) {
    it.files.sort();
    const kind = it.id.startsWith('videos/') ? 'video' : 'photo';
    const grp = it.site || /^(?:originals|images|videos)\/(?:[0-9a-f]{12}-)?bg-/.test(it.id) ? 'site' : 'painting';
    const files = JSON.stringify(it.files);
    let row = rows.get(it.id);
    if (!row) {
      row = { id: it.id, kind, grp, name: nameFor(it), files, bytes: it.bytes, added: it.added || now() };
      stmts.push(env.DB.prepare('INSERT INTO media (id, kind, grp, name, files, bytes, added) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(row.id, row.kind, row.grp, row.name, row.files, row.bytes, row.added));
    } else if (row.files !== files || row.bytes !== it.bytes) {
      row.files = files; row.bytes = it.bytes;
      stmts.push(env.DB.prepare('UPDATE media SET files = ?, bytes = ? WHERE id = ?').bind(files, it.bytes, it.id));
    }
    rows.delete(it.id);
    out.push({ id: it.id, kind: row.kind, grp: row.grp, name: row.name, added: row.added, bytes: it.bytes,
      files: it.files, thumb: thumbOf(it, kind), uses: it.uses,
      ...(it.versions ? { versions: it.versions.sort((a, b) => (a.h > a.w) - (b.h > b.w) || b.w - a.w) } : {}) });
  }
  for (const gone of rows.keys()) stmts.push(env.DB.prepare('DELETE FROM media WHERE id = ?').bind(gone));
  if (stmts.length) await env.DB.batch(stmts);
  return out;
}

/* The name an item is first given: what uses it (a painting's title, "Opening background"), or else its file
   name made readable. Changed in the Library afterwards as wished. */
function nameFor(it) {
  // a lone video version (removed from its set, or never listed): its section and size, from its name
  const lone = /^videos\/bg-([a-z]+)(?:-v\d+)?-(\d+)x(\d+)(?:-v\d+)?\.mp4$/.exec(it.id);
  if (it.labels.length) return it.labels[0].slice(0, 120);
  if (lone) return `${SECTIONS[lone[1]] || lone[1]} background video, ${lone[2]} × ${lone[3]}`;
  const base = it.id.replace(/^[a-z]+\//, '').replace(/\.[a-z0-9]+$/, '').replace(/^[0-9a-f]{12}-/, '');
  const words = base.replace(/-/g, ' ').trim();
  return (words.charAt(0).toUpperCase() + words.slice(1)).slice(0, 120) || it.id;
}

/* A small picture for the list: the smallest size of the newest set (name-v3 after name-v2 after name), or a
   video's smallest last frame. */
function thumbOf(it, kind) {
  const sized = it.files.map((k) => /^images\/([a-z0-9-]+)-(\d{2,4})\.(jpg|webp)$/.exec(k)).filter(Boolean);
  const want = kind === 'video' ? sized.filter((m) => m[1].endsWith('-last')) : sized.filter((m) => !/-(?:first|last)$/.test(m[1]));
  if (!want.length) return null;
  const v = (s) => Number((/-v(\d+)$/.exec(s) || [0, 1])[1]);
  want.sort((a, b) => (v(b[1]) - v(a[1])) || (Number(a[2]) - Number(b[2])));
  return want[0][0];
}

// ---- the API: GET /admin/api/library, POST /admin/api/library/name and /admin/api/library/delete ---------------

export async function library(env) {
  if (!env.MEDIA) throw new Bad('Image storage (R2) is not switched on', 503);
  return { items: await survey(env) };
}

export async function rename(env, id, name) {
  if (typeof name !== 'string' || !name.trim() || name.length > 120) throw new Bad('A name must be 1 to 120 characters');
  const r = await env.DB.prepare('UPDATE media SET name = ? WHERE id = ?').bind(name.trim(), id).run();
  if (!r.meta.changes) throw new Bad('No such file in the library', 404);
  return { id, name: name.trim() };
}

/* Delete an item for good: every one of its files from R2, its catalogue row, and Cloudflare's cached copies.
   Refused while a draft or the published site uses it. If only History does, history must be true: those
   versions are taken out of History (and any publication left with nothing in it). */
export async function remove(env, url, id, history) {
  if (!env.MEDIA) throw new Bad('Image storage (R2) is not switched on', 503);
  const it = (await survey(env)).find((x) => x.id === id);
  if (!it) throw new Bad('No such file in the library', 404);
  const live = it.uses.filter((u) => u.state !== 'history');
  if (live.length) throw new Bad(`Still used by ${[...new Set(live.map((u) => u.label))].join(', ')}: remove it there first`, 409);
  const past = [...new Set(it.uses.map((u) => u.revision))];
  if (past.length && !history) throw new Bad('History still has versions that use it', 409);
  const stmts = [];
  if (past.length) {
    stmts.push(env.DB.prepare(`DELETE FROM revisions WHERE id IN (${past.map(() => '?').join(',')})`).bind(...past));
    stmts.push(env.DB.prepare('DELETE FROM releases WHERE id NOT IN (SELECT release_id FROM revisions)'));
  }
  stmts.push(env.DB.prepare('DELETE FROM media WHERE id = ?').bind(id));
  for (let i = 0; i < it.files.length; i += 1000) await env.MEDIA.delete(it.files.slice(i, i + 1000));
  await env.DB.batch(stmts);
  const purged = await purge(env, url, it.files);
  return { deleted: id, files: it.files.length, history: past.length, purged };
}

/* Cloudflare keeps visitors' copies of published files for up to a year (worker.js media()), in every data
   centre. This Worker's own cache.delete reaches only the data centre it runs in, so the proper purge is
   Cloudflare's API (purge by URL), which needs a token: secret PURGE_TOKEN (permission Zone > Cache Purge) and
   var ZONE_ID. Without them, only the local copies go, and the answer says so. */
async function purge(env, url, files) {
  const hosts = url.hostname.startsWith('admin-dev') ? ['dev.chrisjones.org.uk']
    : url.hostname.startsWith('admin') ? ['chrisjones.org.uk', 'www.chrisjones.org.uk'] : [url.host];
  const urls = hosts.flatMap((h) => files.filter((k) => !k.startsWith('originals/')).map((k) => `https://${h}/media/${k}`));
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
