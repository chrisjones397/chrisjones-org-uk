/* Scaffolding for step 4, slice 2 (docs/entities.md, section 7), sub-step (c): the media layer's tables (file,
   original, recipe, rendition, rendition_file) are filled from what is already known: the Library's records, the
   table old_key (which digest each old key's bytes have, from sub-step (b)) and the paintings' `process` records.
   No file's content is read again; only the first bytes of each picture, for its size in pixels.
   Nothing reads the tables yet: the site and the editor go on using the old keys and records until sub-step (d).
   This file, its route, the table old_part and the Library's button all go in sub-step (e).

   The rules (plan(), below, which touches nothing and can be run in node):
   - File: one row for each distinct digest among the old keys still in storage.
   - Original: a photo's original.<ext>; each version of a video. Items whose originals are the very same photo
     (the same digest) become one item, as the model requires (a file is the original of at most one item): the
     one a page uses, else the earliest, keeps the original, and the others' sets of sizes become its recipes.
     Their Library rows are left alone until (d), as today's code still reads them.
   - Recipe: sets of sizes that one painting has named over time (its draft, published version and History) are
     one recipe, re-edited; a set named by a different painting is another recipe. A set nothing names joins the
     recipe of the set before it. A recipe is `flat` when its sets came from the paintings' darkroom (they have a
     link preview), else `scene`. Settings: the painting's process record without `original` (white, spots,
     brightness, warmth, corners, shape), with white_paper when it was set; {} when no choices were recorded
     (paintings moved from git, backgrounds: as supplied). A video has one recipe, kind `video`, settings {}.
   - Rendition: each set of sizes, numbered again from 1 within its recipe, with a frozen copy of its settings.
     A video's: its versions with one set of frames for each shape, once for each combination a background has
     named, and once for the item as it stands if no background names that.
   - old_part: which rendition each old part became (migration 0004), for (d).

   It can be run again: files are measured a few at a time (a Worker's limits), then everything but `file` is
   rebuilt in one transaction. It refuses once (d) has run, as rendition ids are then named by the entries. */

import { listAll, partOf, Bad } from './library.js';
import { dimensions, HEAD_BYTES } from './dimensions.js';

const AT_A_TIME = 30;
const iso = (d) => (d instanceof Date ? d.toISOString() : String(d || '')).replace(/\.\d+Z$/, 'Z');
const num = (s) => Number(/\d+/.exec(s)[0]);

/* What the old keys say about each item: { code: { original: [{digest, key}], sets: { r1: [{digest, file, at}] },
   versions: { '3840x2880': {digest, at} }, frames: { 'wide-1': [{digest, file, at}] }, other } }. */
function inventory(keys) {
  const items = new Map();
  for (const k of keys) {
    const code = k.key.slice(6, 14), rest = k.key.slice(15), part = partOf(rest);
    if (!items.has(code)) items.set(code, { original: [], sets: {}, versions: {}, frames: {}, other: 0 });
    const it = items.get(code), f = { digest: k.digest, file: rest.split('/').pop(), at: k.at, key: k.key };
    if (part === 'original') it.original.push(f);
    else if (/^r\d+$/.test(part)) (it.sets[part] ||= []).push(f);
    else if (/^(wide|tall)-\d+$/.test(part)) (it.frames[part] ||= []).push(f);
    else if (part !== 'other') it.versions[part] = f;
    else it.other++;
  }
  return items;
}

/* The name a video use goes by in old_part. */
export const videoPart = (versions, dirs) => `v:${[...versions].sort().join('+')}|${[...dirs].sort().join('+')}`;

/* Everything to write, worked out from:
   lib      the library table's rows
   keys     the old keys still in storage: { key, digest, at (when stored) }
   sizes    Map digest -> { w, h } (the file table, as measured)
   stored   every version of every painting and background, oldest first: { entry, kind, state: 'history' |
            'published' | 'draft', d (parsed) }
   Returns rows with their own numbering from 1 (recipe.no, rendition.no): the caller turns those into ids. */
export function plan({ lib, keys, sizes, stored }) {
  const inv = inventory(keys);
  const rowOf = new Map(lib.map((r) => [r.id, { ...r, data: JSON.parse(r.data || '{}') }]));
  const codes = [...inv.keys()].filter((c) => rowOf.has(c));
  const strays = keys.filter((k) => !rowOf.has(k.key.slice(6, 14))).length;   // files of no Library item
  const live = new Set(stored.filter((s) => s.state !== 'history' && s.d.media).map((s) => s.d.media));
  const first = (a, b) => (live.has(b) - live.has(a)) || rowOf.get(a).added.localeCompare(rowOf.get(b).added) || a.localeCompare(b);

  // Items that are the same photo: grouped by their original's digest; the first of each group keeps it.
  const groups = new Map();   // keeper's code -> [codes], keeper first
  const byDigest = new Map();
  for (const c of codes) {
    const it = inv.get(c), photo = rowOf.get(c).kind === 'photo' && it.original[0];
    const k = photo ? photo.digest : `item ${c}`;
    (byDigest.get(k) || byDigest.set(k, []).get(k)).push(c);
  }
  for (const list of byDigest.values()) { list.sort(first); groups.set(list[0], list); }

  // Who names what: painting and background versions, oldest first, so the last seen is the newest.
  const named = new Map();    // 'code/r1' -> [{ entry, kind, state, d }]
  const videoUses = new Map(); // code -> [{ versions, dirs }]
  for (const s of stored) {
    const d = s.d;
    if (!d.media) continue;
    if (d.type === 'video') {
      (videoUses.get(d.media) || videoUses.set(d.media, []).get(d.media)).push({
        versions: (d.versions || []).map((v) => v.file), dirs: Object.values(d.frames || {}).map((f) => f.dir) });
    } else if (d.rendition) {
      const k = `${d.media}/${d.rendition}`;
      (named.get(k) || named.set(k, []).get(k)).push(s);
    }
  }

  const out = { originals: [], recipes: [], renditions: [], files: [], parts: [], merged: [], unplaced: strays };
  const madeBy = (c) => rowOf.get(c).added_by || null;
  const latest = (list) => list.reduce((a, f) => (f.at > a ? f.at : a), '');
  const keepers = [...groups.keys()].sort((a, b) => rowOf.get(a).added.localeCompare(rowOf.get(b).added) || a.localeCompare(b));

  for (const keeper of keepers) {
    const members = groups.get(keeper), row = rowOf.get(keeper);
    for (const c of members) out.unplaced += inv.get(c).other;
    if (members.length > 1) out.merged.push({ into: keeper, from: members.slice(1) });

    if (row.kind === 'video') {
      const it = inv.get(keeper), ver = (f) => row.data.versions?.find((v) => v.file === f);
      const shapeOf = (f) => { const v = ver(f) || {}; const [w, h] = v.w ? [v.w, v.h] : f.split(/x|-/).map(Number); return { w, h, shape: h > w ? 'tall' : 'wide' }; };
      for (const f of Object.values(it.versions)) out.originals.push({ digest: f.digest, item: keeper });
      const present = Object.keys(it.versions);
      if (!present.length) continue;
      const newest = (shape) => Object.keys(it.frames).filter((d) => d.startsWith(shape)).sort((a, b) => num(b) - num(a))[0];
      const combos = [...(videoUses.get(keeper) || []), { versions: present, dirs: ['wide', 'tall'].map(newest).filter(Boolean), now: true }];
      const recipe = { no: out.recipes.length + 1, item: keeper, kind: 'video', label: '', settings: '{}', changed: '', by: madeBy(keeper) };
      const seen = new Map();
      for (const c of combos) {
        const versions = c.versions.filter((f) => it.versions[f]), dirs = c.dirs.filter((d) => it.frames[d]);
        const name = videoPart(c.versions, c.dirs), key = videoPart(versions, dirs);
        if (!versions.length) continue;
        if (!seen.has(key)) {
          const used = [...versions.map((f) => it.versions[f]), ...dirs.flatMap((d) => it.frames[d])];
          const top = versions.map(shapeOf).sort((a, b) => b.w * b.h - a.w * a.h)[0];
          const r = { no: out.renditions.length + 1, recipe: recipe.no, n: seen.size + 1, settings: '{}', w: top.w, h: top.h, made: latest(used), by: madeBy(keeper) };
          out.renditions.push(r); seen.set(key, r.no);
          for (const f of versions) out.files.push({ rendition: r.no, digest: it.versions[f].digest, role: 'version', width: shapeOf(f).w, shape: shapeOf(f).shape });
          for (const d of dirs) for (const f of it.frames[d]) {
            const m = /^(first|last)-(\d+)\.jpg$/.exec(f.file);
            if (m) out.files.push({ rendition: r.no, digest: f.digest, role: m[1], width: sizes.get(f.digest)?.w || Number(m[2]), shape: d.startsWith('tall') ? 'tall' : 'wide' });
          }
          recipe.changed = r.made > recipe.changed ? r.made : recipe.changed;
        }
        if (!c.now || !out.parts.some((p) => p.code === keeper && p.part === name)) out.parts.push({ code: keeper, part: name, rendition: seen.get(key) });
      }
      if (seen.size) out.recipes.push(recipe);
      continue;
    }

    // A photo (or several items that are one photo)
    const original = inv.get(keeper).original[0];
    if (original) out.originals.push({ digest: original.digest, item: keeper });
    const sets = members.flatMap((c) => Object.keys(inv.get(c).sets).sort((a, b) => num(a) - num(b)).map((part) => ({ code: c, part, key: `${c}/${part}`, files: inv.get(c).sets[part] })));
    // Recipes: sets one painting has named belong together; a set nothing names goes with the set before it.
    const owner = new Map();   // entry id -> recipe index
    const before = new Map();  // code -> the recipe index of its previous set
    const mine = [];           // recipe index -> [sets]
    for (const s of sets) {
      const users = [...new Set((named.get(s.key) || []).map((u) => u.entry))];
      let at = users.map((u) => owner.get(u)).find((x) => x != null);
      if (at == null && !users.length) at = before.get(s.code);
      if (at == null) { at = mine.length; mine.push([]); }
      for (const u of users) if (!owner.has(u)) owner.set(u, at);
      before.set(s.code, at);
      s.made = latest(s.files);
      s.now = (named.get(s.key) || []).some((u) => u.state !== 'history');   // a draft or published page names it
      mine[at].push(s);
    }
    for (const list of mine) {
      // in the order they were made; made together (files moved in one go), what a page names today comes last
      list.sort((a, b) => a.made.localeCompare(b.made) || (a.now - b.now));
      const uses = list.flatMap((s) => named.get(s.key) || []);
      const flat = list.some((s) => s.files.some((f) => f.file === 'preview.jpg')) || uses.some((u) => u.kind === 'painting')
        || (!uses.length && rowOf.get(list[0].code).grp === 'painting');
      const titled = [...uses].reverse().find((u) => u.d.title);
      const label = mine.length > 1 ? (titled ? titled.d.title : list[0].code !== keeper ? rowOf.get(list[0].code).name : '') : '';
      const recipe = { no: out.recipes.length + 1, item: keeper, kind: flat ? 'flat' : 'scene', label, settings: '{}', changed: '', by: madeBy(list[0].code) };
      let current = null, drafted = null, n = 0;
      for (const s of list) {
        const us = named.get(s.key) || [];
        const withProcess = [...us].reverse().find((u) => u.d.process), paper = [...us].reverse().find((u) => u.kind === 'painting');
        const settings = {};
        if (flat && withProcess) { const { original: _o, ...rest } = withProcess.d.process; Object.assign(settings, rest); }
        if (flat && paper && paper.d.white_paper) settings.white_paper = true;
        const pictures = s.files.filter((f) => /^\d+\.[a-z]+$/.test(f.file)).map((f) => ({ ...f, width: sizes.get(f.digest)?.w || num(f.file), size: sizes.get(f.digest) }));
        if (!pictures.length) { out.unplaced += s.files.length; continue; }
        const top = pictures.reduce((a, f) => (f.width > a.width ? f : a));
        const rec = rowOf.get(s.code).data.renditions?.[s.part];
        const w = top.size?.w || top.width, h = top.size?.h || (rec && rec.w ? Math.round(rec.h * w / rec.w) : 0);
        const r = { no: out.renditions.length + 1, recipe: recipe.no, n: ++n, settings: JSON.stringify(settings), w, h, made: s.made, by: madeBy(s.code) };
        out.renditions.push(r);
        out.parts.push({ code: s.code, part: s.part, rendition: r.no });
        for (const f of pictures) out.files.push({ rendition: r.no, digest: f.digest, role: 'size', width: f.width, shape: null });
        const pv = s.files.find((f) => f.file === 'preview.jpg');
        if (pv) out.files.push({ rendition: r.no, digest: pv.digest, role: 'preview', width: sizes.get(pv.digest)?.w || Math.min(1200, w), shape: null });
        current = r;
        if (us.some((u) => u.state === 'draft')) drafted = r;
        recipe.changed = r.made > recipe.changed ? r.made : recipe.changed;
      }
      if (!current) continue;
      recipe.settings = (drafted || current).settings;   // the current choices: the set a draft names, else the newest
      out.recipes.push(recipe);
    }
  }
  // the same file twice in one rendition in the same role (it can't be, but the key forbids it): keep one
  const once = new Set();
  out.files = out.files.filter((f) => { const k = `${f.rendition} ${f.digest} ${f.role}`; if (once.has(k)) return false; once.add(k); return true; });
  const digests = new Set();
  out.originals = out.originals.filter((o) => !digests.has(o.digest) && digests.add(o.digest));
  return out;
}

/* Has the filling been done (for the Library's button)? */
export async function filled(env) {
  return !!(await env.DB.prepare('SELECT 1 FROM original LIMIT 1').first());
}

/* POST /edit/api/digest/fill: one step. Answers { done: false, left } while files are still to be measured (call
   again), then { done: true, items, files, originals, recipes, renditions, merged, unplaced } once the tables are filled. */
export async function fill(env, who) {
  if (!env.MEDIA) throw new Bad('File storage (R2) is not switched on', 503);
  const db = env.DB, all = async (sql) => (await db.prepare(sql).all()).results;
  if (await db.prepare('SELECT 1 FROM entries WHERE kind IN (\'artwork\', \'genre\') LIMIT 1').first()) {
    throw new Bad('The entries already name these renditions (sub-step (d) has run): the tables can\'t be rebuilt', 409);
  }
  const [objects, old, lib, have] = await Promise.all([listAll(env, 'media/'), all('SELECT key, digest, bytes, type FROM old_key'),
    all('SELECT id, kind, grp, name, data, added, added_by FROM library'), all('SELECT digest, w, h FROM file')]);
  const oldOf = new Map(old.map((o) => [o.key, o]));
  const there = objects.filter((o) => /^media\/[0-9a-f]{8}\//.test(o.key));
  const waiting = there.filter((o) => !oldOf.has(o.key)).length;
  if (waiting) throw new Bad(`${waiting} file${waiting === 1 ? ' is' : 's are'} not stored by digest yet: do that first`, 409);
  const keys = there.map((o) => ({ ...oldOf.get(o.key), at: iso(o.uploaded) }));   // old keys since deleted are ignored
  const rowOf = new Map(lib.map((r) => [r.id, r]));

  // 1. A row in `file` for each digest, a few at a time: its size in pixels from the first bytes of the file.
  const sizes = new Map(have.map((f) => [f.digest, { w: f.w, h: f.h }]));
  const first = new Map();   // digest -> its earliest old key
  for (const k of keys) if (!first.has(k.digest) || k.at < first.get(k.digest).at) first.set(k.digest, k);
  const todo = [...first.values()].filter((k) => !sizes.has(k.digest));
  if (todo.length) {
    const rows = await Promise.all(todo.slice(0, AT_A_TIME).map(async (k) => {
      const row = rowOf.get(k.key.slice(6, 14)), data = JSON.parse((row && row.data) || '{}'), rest = k.key.slice(15);
      let size = null, seconds = null;
      if (k.type === 'video/mp4') {
        const v = (data.versions || []).find((x) => `${x.file}.mp4` === rest);
        const [w, h] = rest.split(/x|-|\./).map(Number);
        size = v ? { w: v.w, h: v.h } : { w, h };
        seconds = v && v.seconds ? v.seconds : null;
      } else if (partOf(rest) === 'original' && data.original && data.original.w) size = data.original;
      else {
        for (const length of [65536, HEAD_BYTES]) {
          const obj = await env.MEDIA.get(k.digest, { range: { offset: 0, length } });
          if (!obj) throw new Bad(`${k.key} has no copy under its digest`, 500);
          size = dimensions(await obj.arrayBuffer());
          if (size || obj.size <= length) break;
        }
      }
      return [k.digest, k.bytes, k.type, size ? size.w : null, size ? size.h : null, seconds, k.at, row ? row.added_by : who];
    }));
    await db.prepare('INSERT OR IGNORE INTO file (digest, bytes, type, w, h, seconds, added, added_by) SELECT value->>0, value->>1, value->>2, value->>3, value->>4, value->>5, value->>6, value->>7 FROM json_each(?)')
      .bind(JSON.stringify(rows)).run();
    return { done: false, left: todo.length - rows.length };
  }

  // 2. Everything else, rebuilt in one transaction.
  const [entries, revisions, seq] = await Promise.all([
    all('SELECT id, kind, draft, published FROM entries WHERE kind IN (\'painting\', \'background\')'),
    all('SELECT entry_id, kind, data, previous FROM revisions WHERE kind IN (\'painting\', \'background\') ORDER BY id'),
    all('SELECT name, seq FROM sqlite_sequence WHERE name IN (\'recipe\', \'rendition\')')]);
  const stored = [];
  const add = (entry, kind, state, text) => { if (text) { try { stored.push({ entry, kind, state, d: JSON.parse(text) }); } catch { /* not JSON: ignored */ } } };
  for (const v of revisions) { add(v.entry_id, v.kind, 'history', v.previous); add(v.entry_id, v.kind, 'history', v.data); }
  for (const e of entries) add(e.id, e.kind, 'published', e.published);
  for (const e of entries) add(e.id, e.kind, 'draft', e.draft);
  const p = plan({ lib, keys, sizes, stored });
  // ids carry on from the last ever given (AUTOINCREMENT never gives one twice), so a rebuild never reuses one
  const base = (name) => (seq.find((s) => s.name === name) || { seq: 0 }).seq;
  const rb = base('recipe'), nb = base('rendition');
  const into = (sql, rows) => db.prepare(sql).bind(JSON.stringify(rows));
  await db.batch([
    db.prepare('DELETE FROM old_part'), db.prepare('DELETE FROM rendition_file'), db.prepare('DELETE FROM rendition'),
    db.prepare('DELETE FROM recipe'), db.prepare('DELETE FROM original'),
    into('INSERT INTO original (digest, item_id) SELECT value->>0, value->>1 FROM json_each(?)', p.originals.map((o) => [o.digest, o.item])),
    into('INSERT INTO recipe (id, item_id, kind, label, settings, changed, changed_by) SELECT value->>0, value->>1, value->>2, value->>3, value->>4, value->>5, value->>6 FROM json_each(?)',
      p.recipes.map((r) => [rb + r.no, r.item, r.kind, r.label, r.settings, r.changed, r.by])),
    into('INSERT INTO rendition (id, recipe_id, n, settings, w, h, made, made_by) SELECT value->>0, value->>1, value->>2, value->>3, value->>4, value->>5, value->>6, value->>7 FROM json_each(?)',
      p.renditions.map((r) => [nb + r.no, rb + r.recipe, r.n, r.settings, r.w, r.h, r.made, r.by])),
    into('INSERT INTO rendition_file (rendition_id, digest, role, width, shape) SELECT value->>0, value->>1, value->>2, value->>3, value->>4 FROM json_each(?)',
      p.files.map((f) => [nb + f.rendition, f.digest, f.role, f.width, f.shape])),
    into('INSERT INTO old_part (code, part, rendition_id) SELECT value->>0, value->>1, value->>2 FROM json_each(?)', p.parts.map((x) => [x.code, x.part, nb + x.rendition])),
    // files nothing refers to any more (their old keys were deleted): their rows go; the stored copies go in (e)
    db.prepare('DELETE FROM file WHERE digest NOT IN (SELECT digest FROM original) AND digest NOT IN (SELECT digest FROM rendition_file)'),
  ]);
  const count = async (t) => (await db.prepare(`SELECT count(*) n FROM ${t}`).first()).n;
  return { done: true, items: new Set(p.recipes.map((r) => r.item)).size, files: await count('file'), originals: p.originals.length,
    recipes: p.recipes.length, renditions: p.renditions.length, merged: p.merged, unplaced: p.unplaced };
}
