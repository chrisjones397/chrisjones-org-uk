/* A section's background (in the Content view): a photo or a video chosen from the Library, its focus and shade. */

import { sizeFor, framesFor } from '/paths.js';
import { h, toast, glyph, GLYPHS, MB } from './dom.js';
import { state, byId, changed, current, isHidden, picOf } from './state.js';
import { save, discard, loadLibrary } from './server.js';
import { render } from './render.js';
import { badge, hideButton } from './widgets.js';
import { sceneRendition } from './uploads.js';
import { libraryTiles, newestFirst } from './picker.js';

/* A section's background: a photo or a video, shown as it is now (the photo, or the video's last frame), with
   its focus (the point kept in view when the screen's shape crops it: tap the picture to move it), how a phone held
   upright and a wide screen would crop it, and the shade (how much it's darkened, so the words over it read).
   The background's document names a rendition of a Library item, chosen from the Library's tiles (nothing is
   uploaded here: the Library is the only place files come in, step 4 slice 3):
   A photo: its site picture, a set of sizes made from it as it is (a photograph, not a painting: no white
   balance or corners). A photo that has none yet gets one made on the spot when it's chosen (sceneRendition).
   A video: its newest set of versions (sizes for wide screens, one made for phones held upright) with first
   and last frames; versions are added and left out on the video's row in the Library. How it plays (once, or
   on a loop) and what visitors who ask for reduced motion or less data see instead (its last frame, or a slow
   fade from the first frame to the last) are the section's choices. */
const bgBusy = {};                    // section -> what it's doing, while a site picture is being made
const lastStill = (r) => {
  const f = framesFor(r, r.versions.filter((x) => x.h <= x.w)[0] || r.versions[0]);
  return f && f.last.length ? sizeFor(f.last, 1024).url : '';
};

export function backgroundBox(key) {
  const id = `bg-${key}`, e = byId(id), d = e && current(e);
  const r = picOf(d), isVideo = !!r && r.kind === 'video';       // the rendition it shows
  const box = h('div', { class: 'box bg-box' + (isHidden(e) ? ' hidden' : ''), 'data-entry': id }, h('div', { class: 'row' },
    h('label', { class: 'grow' }, 'Background ', e ? badge(e) : null),
    d ? hideButton(e, 'this background') : null));
  if (!state.media) return box.append(h('p', { class: 'hint' }, 'Needs file storage (R2), which isn\'t switched on for this site.')), box;
  const busy = !!bgBusy[key];
  const status = h('p', { class: 'hint bg-status' }, bgBusy[key] || '');
  // the box is drawn afresh while a site picture is being made, so its progress goes to whichever copy is on the page
  const say = (t) => { bgBusy[key] = t; const el = document.querySelector(`[data-entry="${id}"] .bg-status`); if (el) el.textContent = t; };
  // a new picture or video in a hidden background stays hidden until shown again
  const store = (data, msg, mk) => save([{ id, kind: 'background', data: data && { ...data, hidden: !!(d && d.hidden) } }], msg, mk);

  if (d && r) {
    const src = isVideo ? lastStill(r) : sizeFor(r.sizes, 1024).url;
    const pos = `${(d.focus[0] * 100).toFixed(1)}% ${(d.focus[1] * 100).toFixed(1)}%`;
    const frames = ['phone', 'wide'].map((k) => h('div', { class: `bg-frame ${k}`, title: k === 'phone' ? 'On a phone held upright' : 'On a wide screen',
      style: `background-image: url("${src}"); background-position: ${pos}; filter: brightness(${1 - d.shade})` }));
    box.append(
      h('div', { class: 'bg-pick', 'data-k': `${id}:focus`, title: 'Tap the part to keep in view', onclick: (ev) => {
        const r = ev.currentTarget.getBoundingClientRect();
        const focus = [(ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000);
        store({ ...d, focus }, null, `${id}:focus`);
      } }, h('img', { src, alt: '' }), h('span', { class: 'bg-focus', style: `left: ${d.focus[0] * 100}%; top: ${d.focus[1] * 100}%` })),
      h('p', { class: 'hint' }, isVideo ? 'The video\'s last frame. ' : '', 'Tap the part to keep in view. How it would be cropped:'),
      h('div', { class: 'bg-frames' }, ...frames.map((f) => h('figure', {}, f, h('figcaption', {}, f.title)))),
      h('label', {}, `Shade: ${Math.round(d.shade * 100)}%`),
      h('input', { type: 'range', min: 0, max: 60, step: 1, value: Math.round(d.shade * 100), 'data-k': `${id}:shade`,
        oninput: (ev) => { frames.forEach((f) => { f.style.filter = `brightness(${1 - ev.target.value / 100})`; });
          ev.target.previousSibling.textContent = `Shade: ${ev.target.value}%`; },
        onchange: (ev) => store({ ...d, shade: ev.target.value / 100 }, null, `${id}:shade`) }));
    if (isVideo) {
      const choice = (label, field, options) => h('label', {}, label, h('select', { 'data-k': `${id}:${field}`, onchange: (ev) => store({ ...d, [field]: ev.target.value }, null, `${id}:${field}`) },
        ...options.map(([v, t]) => h('option', { value: v, selected: d[field] === v }, t))));
      box.append(
        choice('Plays', 'play', [['once', 'Once, stopping on its last frame'], ['loop', 'On a loop']]),
        choice('For visitors who ask for reduced motion or less data', 'calm', [['last', 'Its last frame'], ['fade', 'A slow fade from its first frame to its last']]),
        h('label', {}, 'Versions (the browser picks one for each screen)'),
        ...versionRows(r).map(([, text]) => h('div', { class: 'row bg-version' }, h('span', { class: 'grow' }, text))),
        h('p', { class: 'hint' }, 'Versions are added and left out on the video\'s row in the ', h('a', { href: '#library' }, 'Library'), '.'));
    } else {
      box.append(h('p', { class: 'hint' }, `Photo, ${r.w} × ${r.h} pixels.`));
    }
  } else {
    box.append(h('p', { class: 'hint' }, e ? 'Removed in the draft: once published, the section has no background (the picture stays in the Library).' : 'None: the section shows the page\'s grey.'));
  }
  if (bgPicking.has(key)) box.append(libraryPicker(choose));
  box.append(status, h('div', { class: 'actions' },
    h('button', { class: 'icon-btn', disabled: busy, 'aria-expanded': String(bgPicking.has(key)), title: d ? 'Choose a different photo or video from the Library' : 'Choose a photo or video from the Library',
      'aria-label': 'Choose from the Library', onclick: () => { bgPicking.has(key) ? bgPicking.delete(key) : bgPicking.add(key); render(); } }, glyph(GLYPHS.photo), glyph(GLYPHS.swap, 14)),
    h('a', { class: 'icon-btn muted', href: '#library', title: 'Photos and videos are uploaded in the Library: go there', 'aria-label': 'Upload in the Library' }, glyph(GLYPHS.upload)),
    d ? h('button', { class: 'danger', disabled: busy, title: 'Take it out of this section: the picture stays in the Library',
      onclick: () => confirm('Remove this section\'s background? The picture stays in the Library.') && store(null, 'Removed in the draft') }, 'Remove') : null,
    e && changed(e) ? h('button', { disabled: busy, onclick: () => discard([id]) }, 'Undo change') : null));
  return box;

  /* A Library item chosen: its newest site picture or set of versions becomes the background (in the draft),
     keeping the focus and shade; a photo with no site picture yet has one made first, here. */
  async function choose(it) {
    bgPicking.delete(key);
    try {
      let b = backgroundFrom(it, d);
      if (!b) {
        if (it.kind !== 'photo') throw new Error('That video has no versions to show');
        bgBusy[key] = 'Making its sizes…'; render();
        const made = await sceneRendition(it.id, say);
        state.library = null;
        b = { rendition: made.id, focus: d ? d.focus : [0.5, 0.5], shade: d ? d.shade : 0.12 };
      }
      delete bgBusy[key];
      await store(b, 'Saved as a draft: tap the picture to choose the part to keep in view');
    } catch (err) { delete bgBusy[key]; toast(err.message, true); render(); }
  }
}
const bgPicking = new Set();          // sections whose Library picker is open

/* The Library's photos and videos, as tiles. */
function libraryPicker(use) {
  if (!state.library) { loadLibrary(); return h('p', { class: 'hint' }, 'Loading the Library…'); }
  const items = newestFirst(state.library.items);
  if (!items.length) return h('p', { class: 'hint' }, 'The Library has nothing yet: upload a photo or a video there first.');
  return libraryTiles(items, use,
    (it) => (it.kind === 'photo' && !it.site ? h('span', { class: 'lib-pick-mark', title: 'Its sizes will be made when you choose it' }, glyph(GLYPHS.crop, 12)) : null));
}
/* What choosing an item would make the background: its newest site picture (a photo) or set of versions (a
   video), keeping the focus and shade; null if it has none yet. */
function backgroundFrom(it, d) {
  const keep = { focus: d ? d.focus : [0.5, 0.5], shade: d ? d.shade : 0.12 };
  const rens = it.recipes.filter((c) => c.kind !== 'flat').flatMap((c) => c.renditions);
  const r = rens.sort((x, y) => y.id - x.id).find((x) => (it.kind === 'video' ? x.versions.length : x.sizes.length));
  if (!r) return null;
  return it.kind === 'video' ? { rendition: r.id, ...keep, play: d && d.play ? d.play : 'once', calm: d && d.calm ? d.calm : 'last' }
    : { rendition: r.id, ...keep };
}

/* Each version, described: its size, weight and which screens get it (the same rule as site.js bgTag). */
function versionRows(r) {
  const desc = (g) => g.sort((x, y) => y.w - x.w);
  const upright = desc(r.versions.filter((v) => v.h > v.w)), level = desc(r.versions.filter((v) => v.h <= v.w));
  const rows = (g, who) => g.map((v, i) => [v, `${v.w} × ${v.h}, ${v.seconds} seconds, ${MB(v.bytes)} `
    + `(${(v.bytes * 8 / v.seconds / 1e6).toFixed(1)} megabits a second): for ${who}`
    + `${g[i + 1] ? ` showing more than ${g[i + 1].w} pixels across` : g.length > 1 ? ', the rest' : ''}`]);
  return [...rows(upright, 'phones held upright'), ...rows(level, upright.length ? 'screens held level' : 'all screens')];
}
