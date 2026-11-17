/* The Library view. */

import { h, toast, glyph, GLYPHS, MB } from './dom.js';
import { state } from './state.js';
import { marks, placeMarks } from './marks.js';
import { call, act, loadLibrary } from './server.js';
import { render } from './render.js';
import { libraryPhoto, videoItem, sceneRendition } from './uploads.js';
import { paintFrom } from './add.js';
import { strongest, useMarks } from './uses.js';
import { showItems, blinkView } from './compare.js';

/* Every item in the Library (library.js on the server), newest first: the one place files come in (step 4,
   slice 3). An upload keeps only the original (a photo), or a video's versions; what is made from an item is
   made here or from here: a site picture (its sizes, as it is), a painting (in the Gallery, from its photo).
   Each row uses the page's width: its picture (the size of the pickers' tiles, tap to see it large); what is
   true of the item itself, each saving itself with a tick (its name, alternative text and credit), its code (tap
   to copy), what uses it (each mark a link to where) and what can be done with it; and beside those a line for
   each original and each rendition (a recipe's result: a picture's sizes, or a video's versions and frames) with
   its weight, a tick to compare (two or three side by side, or blink between two), and a bin for a rendition
   nothing uses. The row's bin deletes the whole item, only when no draft or published page uses it.
   The filter is on what an item is made or used for, so an item can be both a painting and a site picture. */
let libBusy = '';
const libDoing = {};           // item code -> what is being made from it, while it is
const libPicked = new Set();   // lines ticked to compare (two or three): an item's code (its original) or <code>/<rendition id>
let libFilter = 'all';
const FILTERS = [
  ['all', 'all', 'Everything', () => true],
  ['fresh', 'tray', 'Just uploaded: nothing made from them yet', (it) => !it.recipes.length],
  ['painting', 'brush', 'Paintings', (it) => it.painting],
  ['site', 'crop', 'Site pictures', (it) => it.site],
];

export function libraryView() {
  if (!state.library) { loadLibrary(); return [h('h1', {}, 'Library'), h('p', { class: 'muted' }, 'Loading…')]; }
  const pick = h('input', { type: 'file', accept: 'image/*,video/mp4,.mp4,.m4v', multiple: true, hidden: true,
    onchange: () => pick.files.length && addToLibrary([...pick.files]) });
  const all = state.library.items.slice().sort((a, b) => b.added.localeCompare(a.added));
  const items = all.filter((FILTERS.find((f) => f[0] === libFilter) || FILTERS[0])[3]);
  const total = items.reduce((n, it) => n + it.bytes, 0);
  const out = [h('h1', { class: 'row lib-title' }, 'Library',
    h('button', { class: 'lib-add main', disabled: !!libBusy || !state.media, title: 'Upload photos, or the versions of one video: everything on the site starts here',
      'aria-label': 'Upload to the Library', onclick: () => pick.click() }, glyph(GLYPHS.upload, 20))),
    pick,
    h('div', { class: 'row lib-filter' },
      ...FILTERS.map(([key, symbol, title, test]) => h('button', { class: 'lib-filter-btn' + (libFilter === key ? ' on' : ''), title, 'aria-label': title,
        'aria-pressed': String(libFilter === key), onclick: () => { libFilter = key; render(); } }, glyph(GLYPHS[symbol], 18), h('span', {}, String(all.filter(test).length)))),
      h('span', { class: 'muted lib-total' }, MB(total))),
    h('p', { class: 'hint lib-busy' }, libBusy)];
  if (items.length) out.push(h('div', { class: 'card lib-list' }, ...items.map(libraryRow)));
  else out.push(h('p', { class: 'hint' }, all.length ? 'Nothing of that kind.' : 'Nothing here yet: upload a photo or a video.'));
  const chosen = pickedList();
  for (const key of [...libPicked]) if (!chosen.some((c) => c.key === key)) libPicked.delete(key);
  if (libPicked.size) {
    out.push(h('div', { class: 'lib-comparebar' },
      h('button', { class: 'lib-compare', disabled: chosen.length < 2, title: chosen.length < 2 ? 'Tick one or two more to compare' : chosen.length === 2 ? 'Compare: blink between the two' : 'Compare side by side',
        'aria-label': 'Compare', onclick: () => (chosen.length === 2 ? blinkView(chosen) : showItems(chosen)) }, glyph(GLYPHS.compare, 20), h('span', {}, String(chosen.length))),
      h('button', { title: 'Untick them all', 'aria-label': 'Untick them all', onclick: () => { libPicked.clear(); render(); } }, glyph(GLYPHS.close, 16))));
  }
  return out.filter(Boolean);
}

/* Photos (each an item: its original and a small picture, nothing else) or video files (chosen together: one
   video's versions, one item, with its first and last frames) into the Library. */
async function addToLibrary(files) {
  const say = (t) => { libBusy = t; render(); };
  const videos = files.filter((f) => /\.(mp4|m4v)$/i.test(f.name) || f.type === 'video/mp4'), photos = files.filter((f) => !videos.includes(f));
  const nameOf = (f) => f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
  const had = [];
  try {
    for (const [i, f] of photos.entries()) {
      const got = await libraryPhoto(f, nameOf(f), (t) => say(photos.length > 1 ? `Photo ${i + 1} of ${photos.length}: ${t}` : t));
      if (got.shared) had.push(got.name);
    }
    if (videos.length) await videoItem(null, nameOf(videos[0]), videos, null, say);
    toast(had.length ? `Already in the Library: ${had.join(', ')}` : 'Added to the Library');
    if (libFilter !== 'all') libFilter = 'fresh';
  } catch (e) { toast(e.message, true); }
  libBusy = ''; state.library = null; render();
}

/* An item's renditions, each with the name it goes by in its row: r1, r2... within its recipe, after the recipe's
   label when the item has several recipes ("Part 2 r1"; a site picture's recipe has none, so "As it is r1"). */
export function renditionsOf(it) {
  return it.recipes.flatMap((c, i) => c.renditions.map((r) => ({ ...r,
    name: `${it.recipes.length > 1 ? `${c.label || (c.kind === 'scene' ? 'As it is' : `Recipe ${i + 1}`)} ` : ''}r${r.n}` })));
}

/* What is true of the item itself saves itself as soon as it's changed, with a tick in the field. */
async function describe(it, field, input) {
  const v = input.value.trim();
  if (field === 'name' && !v) { input.value = it.name; return; }
  if (v === it[field]) return;
  try {
    await call('POST', 'library/item', { id: it.id, [field]: v });
    it[field] = v;
    marks.set(`lib:${it.id}:${field}`, [Date.now(), 'Saved: the Library keeps it straight away']); placeMarks();
  } catch (e) { toast(e.message, true); input.value = it[field]; }
}

function libraryRow(it) {
  const uses = strongest(it.uses);
  const live = uses.filter((u) => u.state !== 'history');
  const pastOnly = !live.length && uses.length > 0;
  const pic = it.thumb
    ? h('img', { src: it.thumb, alt: '', loading: 'lazy' })
    : h('span', { class: 'lib-none', title: 'No picture to show' }, glyph(GLYPHS.photo, 28));
  const field = (name, max, label, symbol, placeholder) => h('label', { class: 'lib-field', title: label },
    symbol ? glyph(GLYPHS[symbol], 16) : null,
    h('input', { type: 'text', class: name === 'name' ? 'lib-name' : '', value: it[name] || '', maxLength: max, placeholder, 'aria-label': label, 'data-k': `lib:${it.id}:${name}`,
      onkeydown: (ev) => { if (ev.key === 'Enter') ev.target.blur(); }, onchange: (ev) => describe(it, name, ev.target) }));
  const copied = h('span', { class: 'lib-saved', title: 'Copied', hidden: true }, glyph(GLYPHS.tick, 14));
  const codeChip = h('button', { class: 'lib-code', title: 'Its code in the Library, which never changes (tap to copy)',
    onclick: () => { navigator.clipboard?.writeText(it.id).then(() => { copied.hidden = false; setTimeout(() => { copied.hidden = true; }, 1500); }); } }, it.id);
  const doing = libDoing[it.id];
  const bin = h('button', { class: 'lib-bin danger', disabled: live.length > 0 || !!doing,
    title: live.length ? `In use: ${[...new Set(live.map((u) => u.label))].join(', ')}` : 'Delete for good',
    'aria-label': 'Delete for good', onclick: () => deleteForGood(it, pastOnly) }, glyph(GLYPHS.bin));
  const hasScene = it.recipes.some((c) => c.kind === 'scene' && c.renditions.length);
  return h('div', { class: 'lib-item' },
    h(it.large ? 'button' : 'span', { class: 'lib-thumb', ...(it.large ? { title: 'See it large', 'aria-label': `See ${it.name} large`, onclick: () => showItems([it]) } : {}) },
      pic, it.kind === 'video' ? h('span', { class: 'lib-video', title: 'Video' }, glyph(GLYPHS.play, 14)) : null),
    h('div', { class: 'lib-about' },
      field('name', 120, 'Its name in the Library', null, ''),
      h('span', { class: 'lib-marks' }, codeChip, copied,
        uses.length ? useMarks(uses, it.name)
          : !it.recipes.length ? h('span', { class: 'lib-use fresh', title: 'Just uploaded: nothing has been made from it yet' }, glyph(GLYPHS.tray, 13))
            : h('span', { class: 'badge gone', title: 'Nothing uses it' }, 'Unused')),
      field('alt', 500, 'Alternative text: what the picture shows, for visitors who can\'t see it', 'says', 'What it shows'),
      field('credit', 200, 'Credit: who made it, if it wasn\'t you', 'person', 'Who made it, if not you'),
      h('div', { class: 'lib-acts' },
        it.kind === 'photo' ? h('button', { disabled: !!doing, title: 'Make a painting from it: to the Gallery, with this photo in the darkroom', 'aria-label': 'Make a painting',
          onclick: () => paintFrom(it) }, glyph(GLYPHS.brush)) : null,
        it.kind === 'photo' && !hasScene ? h('button', { disabled: !!doing, title: 'Make a site picture: its sizes, as it is, for backgrounds', 'aria-label': 'Make a site picture',
          onclick: () => makeScene(it) }, glyph(GLYPHS.crop)) : null,
        h('span', { class: 'lib-doing muted', 'data-doing': it.id }, doing || ''),
        bin)),
    h('div', { class: 'lib-parts' }, ...it.originals.map((o) => originalLine(it, o)), ...renditionsOf(it).map((r) => renditionLine(it, r))));
}

/* A site picture from a photo: its sizes made in the browser from the original, as it is. */
async function makeScene(it) {
  const say = (t) => { libDoing[it.id] = t; const el = document.querySelector(`[data-doing="${it.id}"]`); if (el) el.textContent = t; else render(); };
  say('Starting…'); render();
  try { await sceneRendition(it.id, say); toast('Site picture made: choose it as a background under Content'); }
  catch (e) { toast(e.message, true); }
  delete libDoing[it.id]; state.library = null; render();
}

/* A tick box to compare: an item's original (key the item's code) or one of its renditions (key <code>/<rendition id>);
   three at most. */
function pickTick(key, what) {
  const picked = libPicked.has(key), full = !picked && libPicked.size >= 3;
  return h('label', { class: 'lib-tick' + (picked ? ' on' : ''), title: full ? 'Three are ticked already: untick one to compare this' : picked ? 'Ticked to compare' : 'Tick two or three to compare them side by side' },
    h('input', { type: 'checkbox', checked: picked, disabled: full, 'aria-label': `Compare ${what}`,
      onchange: (ev) => { if (ev.target.checked) libPicked.add(key); else libPicked.delete(key); render(); } }));
}
/* The ticked things, as { it, ren } (ren null for a whole item). */
function pickedList() {
  return [...libPicked].map((key) => {
    const [code, rid] = key.split('/');
    const it = state.library.items.find((x) => x.id === code);
    const ren = it && rid ? renditionsOf(it).find((r) => String(r.id) === rid) : null;
    return it && (!rid || ren) ? { it, ren, key } : null;
  }).filter(Boolean);
}

/* An original, on a line of its own: a photo as uploaded, or one of a video's versions. */
function originalLine(it, o) {
  const video = o.type === 'video/mp4', ext = (o.url.split('.').pop() || '').toUpperCase();
  return h('div', { class: 'lib-part', title: video ? 'A version of the video, as uploaded' : 'The photo as uploaded: never shown to visitors' },
    video || !it.large ? h('span', { class: 'lib-tick-space' }) : pickTick(it.id, `${it.name}, the original`),
    h('span', { class: 'lib-part-icon' }, video ? shapeOf(o, it.originals) : glyph(GLYPHS.photo, 16)),
    h('span', { class: 'lib-part-what' }, video ? `${o.w} × ${o.h}${o.seconds ? `, ${o.seconds} seconds` : ''}` : `Original${o.w ? `, ${o.w} × ${o.h}` : ''} (${ext})`),
    h('span', { class: 'lib-part-uses' }), h('span', { class: 'lib-size' }, MB(o.bytes)), h('span', { class: 'lib-bin-space' }));
}

/* A rendition, on a line of its own: what it is, as a symbol and its size, its weight, its users' marks, and a
   bin when nothing (not even History) uses it. */
function renditionLine(it, r) {
  const day = r.made ? new Date(r.made).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
  const video = r.kind === 'video', n = video ? r.versions.length : r.sizes.length;
  const what = video ? `${r.name}: ${n} version${n === 1 ? '' : 's'} with first and last frames${day ? `, ${day}` : ''}`
    : `${r.name}: ${n} size${n === 1 ? '' : 's'}, up to ${r.w} × ${r.h}${day ? `, ${day}` : ''}`;
  const uses = strongest(r.uses);
  return h('div', { class: 'lib-part', title: `${r.kind === 'flat' ? 'Squared up in the darkroom' : video ? 'The video as shown' : 'The photo as it is'} (${r.files.length} files)` },
    video ? h('span', { class: 'lib-tick-space' }) : pickTick(`${it.id}/${r.id}`, `${it.name}, ${r.name}`),
    h('span', { class: 'lib-part-icon' }, glyph(video ? GLYPHS.frames : GLYPHS.sizes, 16)), h('span', { class: 'lib-part-what' }, what),
    h('span', { class: 'lib-part-uses' }, ...useMarks(uses, it.name).map((m) => { m.lastChild && m.lastChild.nodeType === 3 && m.lastChild.remove(); return m; })),
    h('span', { class: 'lib-size' }, MB(r.bytes)),
    !r.uses.length
      ? h('button', { class: 'lib-bin small danger', title: 'Delete this rendition for good', 'aria-label': 'Delete this rendition for good',
        onclick: () => deleteRendition(it, r) }, glyph(GLYPHS.bin, 14))
      : h('span', { class: 'lib-bin-space' }));
}
/* A video version as a small outline of its shape, sized against the item's largest. */
function shapeOf(p, parts) {
  const top = Math.max(...parts.filter((x) => x.w).map((x) => Math.max(x.w, x.h)), 1);
  const long = 6 + 12 * Math.max(p.w, p.h) / top, ratio = Math.min(p.w, p.h) / Math.max(p.w, p.h);
  const [w, hh] = p.h > p.w ? [long * ratio, long] : [long, long * ratio];
  return h('span', { class: 'lib-ver', title: p.h > p.w ? 'For phones held upright' : 'For wide screens', style: `width:${w.toFixed(1)}px;height:${hh.toFixed(1)}px` });
}

function deleteRendition(it, r) {
  if (!confirm(`Delete ${r.name} of "${it.name}" for good (${MB(r.bytes)})? This can't be undone.`)) return;
  act(async () => { const out = await call('POST', 'library/delete', { rendition: r.id }); state.library = null; return out; }, 'Deleted for good');
}

function deleteForGood(it, pastOnly) {
  const versions = new Set(it.uses.map((u) => u.revision)).size;
  const sure = pastOnly
    ? `Delete "${it.name}" for good?\n\nIts ${it.files} file${it.files === 1 ? '' : 's'} (${MB(it.bytes)}) go from storage, and the ${versions} version${versions === 1 ? '' : 's'} in History that use it go from History. This can't be undone.`
    : `Delete "${it.name}" for good?\n\nIts ${it.files} file${it.files === 1 ? '' : 's'} (${MB(it.bytes)}) go from storage. This can't be undone.`;
  if (!confirm(sure)) return;
  act(async () => {
    const out = await call('POST', 'library/delete', { id: it.id, history: pastOnly });
    state.library.items = state.library.items.filter((x) => x.id !== it.id);
    state.history = null;
    return out;
  }, (out) => `Deleted for good${out.purged === 'this data centre only' ? ' (cached copies elsewhere may linger)' : ''}`);
}
