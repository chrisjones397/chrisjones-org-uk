/* The Library view. */

import { h, toast, glyph, GLYPHS, MB } from './dom.js';
import { state } from './state.js';
import { call, act, loadLibrary } from './server.js';
import { render } from './render.js';
import { photoItem, videoItem } from './uploads.js';
import { strongest, useMarks } from './uses.js';
import { showItems, blinkView } from './compare.js';

/* Every item in storage (library.js on the server), as Site pictures and Paintings. Each row: its picture, its name
   (the Library's own: saved as soon as it's changed, with a tick), its code (its folder in R2, media/<code>/: tap to
   copy), what uses it, then a line for each part (the original, each set of sizes, each video version, each set of
   frames) with its weight, and a bin for a part nothing uses. The bin on the right deletes the whole item, only
   when no draft or published page uses it. Photos and videos for the site can be added here; paintings come in
   through the Gallery (their pictures are prepared in the darkroom). */
let libBusy = '';
const libPicked = new Set();   // items ticked to compare (two or three)

export function libraryView() {
  if (!state.library) { loadLibrary(); return [h('h1', {}, 'Library'), h('p', { class: 'muted' }, 'Loading…')]; }
  const out = [h('h1', {}, 'Library')];
  const pick = h('input', { type: 'file', accept: 'image/*,video/mp4,.mp4,.m4v', multiple: true, hidden: true,
    onchange: () => pick.files.length && addToLibrary([...pick.files]) });
  for (const [grp, title] of [['site', 'Site pictures'], ['painting', 'Paintings']]) {
    const items = state.library.items.filter((it) => it.grp === grp).sort((a, b) => b.added.localeCompare(a.added));
    const total = items.reduce((n, it) => n + it.bytes, 0);
    out.push(h('h2', { class: 'row' }, title, h('span', { class: 'muted', style: 'font-size:0.85rem' }, `${items.length} · ${MB(total)}`),
      grp === 'site' ? h('button', { class: 'lib-add', disabled: !!libBusy, title: 'Add photos, or the versions of one video, to the Library', 'aria-label': 'Add to the Library',
        onclick: () => pick.click() }, glyph(GLYPHS.add)) : null));
    if (grp === 'site') out.push(pick, libBusy ? h('p', { class: 'hint' }, libBusy) : null);
    if (items.length) out.push(h('div', { class: 'card' }, ...items.map(libraryRow)));
  }
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

/* Photos (each an item) or video files (chosen together: one video's versions, one item) into the Library. */
async function addToLibrary(files) {
  const say = (t) => { libBusy = t; render(); };
  const videos = files.filter((f) => /\.(mp4|m4v)$/i.test(f.name) || f.type === 'video/mp4'), photos = files.filter((f) => !videos.includes(f));
  const nameOf = (f) => f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
  try {
    for (const [i, f] of photos.entries()) await photoItem(f, nameOf(f), 'site', (t) => say(photos.length > 1 ? `Photo ${i + 1} of ${photos.length}: ${t}` : t));
    if (videos.length) {
      const { id } = await call('POST', 'library/new', { kind: 'video', grp: 'site', name: nameOf(videos[0]) });
      await videoItem(id, videos, { versions: [], frames: {} }, say);
    }
    toast('Added to the Library');
  } catch (e) { toast(e.message, true); }
  libBusy = ''; state.library = null; render();
}

function libraryRow(it) {
  const uses = strongest(it.uses);
  const live = uses.filter((u) => u.state !== 'history');
  const pastOnly = !live.length && uses.length > 0;
  const pic = it.thumb
    ? h('img', { src: `/media/${it.thumb}`, alt: '', loading: 'lazy' })
    : h('span', { class: 'lib-none', title: 'No picture to show' }, glyph(GLYPHS.photo, 28));
  const tick = pickTick(it.id, it.name);
  const saved = h('span', { class: 'lib-saved', title: 'Name saved', hidden: true }, glyph(GLYPHS.tick));
  const name = h('input', { type: 'text', class: 'lib-name', value: it.name, maxLength: 120, 'aria-label': 'Name',
    onkeydown: (ev) => { if (ev.key === 'Enter') ev.target.blur(); },
    onchange: async (ev) => {
      const v = ev.target.value.trim();
      if (!v) { ev.target.value = it.name; return; }
      try { await call('POST', 'library/name', { id: it.id, name: v }); it.name = v; saved.hidden = false; }
      catch (e) { toast(e.message, true); ev.target.value = it.name; }
    } });
  const copied = h('span', { class: 'lib-saved', title: 'Copied', hidden: true }, glyph(GLYPHS.tick, 14));
  const codeChip = h('button', { class: 'lib-code', title: `Its folder in storage: media/${it.id}/ (tap to copy the code)`,
    onclick: () => { navigator.clipboard?.writeText(it.id).then(() => { copied.hidden = false; setTimeout(() => { copied.hidden = true; }, 1500); }); } }, it.id);
  const bin = h('button', { class: 'lib-bin danger', disabled: live.length > 0,
    title: live.length ? `In use: ${[...new Set(live.map((u) => u.label))].join(', ')}` : 'Delete for good',
    'aria-label': 'Delete for good', onclick: () => deleteForGood(it, pastOnly) }, glyph(GLYPHS.bin));
  return h('div', { class: 'lib-item' },
    h('div', { class: 'painting lib-head' },
      tick,
      h(it.large ? 'button' : 'span', { class: 'lib-pic', ...(it.large ? { title: 'See it large', 'aria-label': `See ${it.name} large`, onclick: () => showItems([it]) } : {}) },
        pic, it.kind === 'video' ? h('span', { class: 'lib-video', title: 'Video' }, glyph(GLYPHS.play, 14)) : null),
      h('div', { class: 'what' },
        h('div', { class: 'row lib-top' }, name, saved),
        h('span', { class: 'd' }, codeChip, copied, uses.length ? useMarks(uses, it.name)
          : h('span', { class: 'badge gone', title: 'Nothing uses it' }, 'Unused'))),
      bin),
    h('div', { class: 'lib-parts' }, ...it.parts.map((p) => partLine(it, p))));
}

/* A tick box to compare: an item (key its code) or one of its renditions (key <code>/<part>); three at most. */
function pickTick(key, what) {
  const picked = libPicked.has(key), full = !picked && libPicked.size >= 3;
  return h('label', { class: 'lib-tick' + (picked ? ' on' : ''), title: full ? 'Three are ticked already: untick one to compare this' : picked ? 'Ticked to compare' : 'Tick two or three to compare them side by side' },
    h('input', { type: 'checkbox', checked: picked, disabled: full, 'aria-label': `Compare ${what}`,
      onchange: (ev) => { if (ev.target.checked) libPicked.add(key); else libPicked.delete(key); render(); } }));
}
/* The ticked things, as { it, part } (part null for a whole item). */
function pickedList() {
  return [...libPicked].map((key) => {
    const [code, part] = key.split('/');
    const it = state.library.items.find((x) => x.id === code);
    return it && (!part || it.parts.some((p) => p.part === part)) ? { it, part: part || null, key } : null;
  }).filter(Boolean);
}

/* A part of an item, on a line of its own: what it is, as a symbol and its size, its weight, its users' marks,
   and a bin when nothing (not even History) uses it. */
function partLine(it, p) {
  let icon, what;
  if (p.part === 'original') { icon = glyph(GLYPHS.photo, 16); what = `Original${p.w ? `, ${p.w} × ${p.h}` : ''}${p.ext ? ` (${p.ext.toUpperCase()})` : ''}`; }
  else if (/^r\d+$/.test(p.part)) {
    const n = p.sizes || p.files, day = p.made ? new Date(p.made).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
    icon = glyph(GLYPHS.sizes, 16);
    what = `${p.part}: ${n} size${n === 1 ? '' : 's'}${p.w ? `, up to ${p.w} × ${p.h}` : ''}${day ? `, ${day}` : ''}`;
  }
  else if (/^\d+x\d+/.test(p.part)) { icon = shapeOf(p, it.parts); what = `${p.w} × ${p.h}${p.seconds ? `, ${p.seconds} seconds` : ''}`; }
  else if (/^(wide|tall)-/.test(p.part)) { icon = glyph(GLYPHS.frames, 16); what = `First and last frames, ${p.part.startsWith('tall') ? 'upright' : 'wide'}`; }
  else { icon = glyph(GLYPHS.photo, 16); what = `${p.files} other file${p.files === 1 ? '' : 's'}`; }
  const uses = strongest(p.uses);
  const ren = /^r\d+$/.test(p.part) && it.data && it.data.renditions && it.data.renditions[p.part];
  return h('div', { class: 'lib-part', title: `${p.part}${p.files > 1 ? `/ (${p.files} files)` : ''}` },
    ren ? pickTick(`${it.id}/${p.part}`, `${it.name}, ${p.part}`) : h('span', { class: 'lib-tick-space' }),
    h('span', { class: 'lib-part-icon' }, icon), h('span', { class: 'lib-part-what' }, what),
    h('span', { class: 'lib-part-uses' }, ...useMarks(uses, it.name).map((m) => { m.lastChild && m.lastChild.nodeType === 3 && m.lastChild.remove(); return m; })),
    h('span', { class: 'lib-size' }, MB(p.bytes)),
    p.part !== 'original' && !p.uses.length && it.parts.length > 1
      ? h('button', { class: 'lib-bin small danger', title: 'Delete this part for good', 'aria-label': 'Delete this part for good',
        onclick: () => deletePart(it, p) }, glyph(GLYPHS.bin, 14))
      : h('span', { class: 'lib-bin-space' }));
}
/* A video version as a small outline of its shape, sized against the item's largest. */
function shapeOf(p, parts) {
  const top = Math.max(...parts.filter((x) => x.w).map((x) => Math.max(x.w, x.h)), 1);
  const long = 6 + 12 * Math.max(p.w, p.h) / top, ratio = Math.min(p.w, p.h) / Math.max(p.w, p.h);
  const [w, hh] = p.h > p.w ? [long * ratio, long] : [long, long * ratio];
  return h('span', { class: 'lib-ver', title: p.h > p.w ? 'For phones held upright' : 'For wide screens', style: `width:${w.toFixed(1)}px;height:${hh.toFixed(1)}px` });
}

function deletePart(it, p) {
  if (!confirm(`Delete this part of "${it.name}" for good (${MB(p.bytes)})? This can't be undone.`)) return;
  act(async () => { const out = await call('POST', 'library/delete', { id: it.id, part: p.part }); state.library = null; return out; }, 'Deleted for good');
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
