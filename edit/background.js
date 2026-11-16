/* A section's background (in the Content view): a photo or a video, its focus and shade. */

import { sizeFor, framesFor } from '/paths.js';
import { h, toast, glyph, GLYPHS, MB } from './dom.js';
import { state, byId, changed, current, isHidden, picOf, PAGE } from './state.js';
import { save, discard, loadLibrary } from './server.js';
import { render } from './render.js';
import { badge, hideButton } from './widgets.js';
import { photoItem, videoItem, videoRendition } from './uploads.js';

/* A section's background: a photo or a video, shown as it is now (the photo, or the video's last frame), with
   its focus (the point kept in view when the screen's shape crops it: tap the picture to move it), how a phone held
   upright and a wide screen would crop it, and the shade (how much it's darkened, so the words over it read).
   The background's document names a rendition of a Library item (photoItem, videoItem in uploads.js; also chosen
   from the Library with "From the Library…"):
   A photo: kept as uploaded, with one set of sizes made from it as it is (a photograph, not a painting: no white
   balance or corners).
   A video: one or more versions (sizes for wide screens, one made for phones held upright), each uploaded as
   made, after the checks in videoFacts(); first and last frames are taken here, once per shape, and stored as
   pictures. How it plays (once, or on a loop) and what visitors who ask for reduced motion or less
   data see instead (its last frame, or a slow fade from the first frame to the last) are the section's choices. */
const bgBusy = {};                    // section -> what it's doing, while a photo or video is being stored
const bgNotes = {};                   // section -> the checks' findings for the video version last added
const lastStill = (r) => {
  const f = framesFor(r, r.versions.filter((x) => x.h <= x.w)[0] || r.versions[0]);
  return f && f.last.length ? sizeFor(f.last, 1024).url : '';
};

export function backgroundBox(key) {
  const id = `bg-${key}`, e = byId(id), d = e && current(e);
  const r = picOf(d), isVideo = !!r && r.kind === 'video';       // the rendition it shows
  const box = h('div', { class: 'box bg-box' + (isHidden(e) ? ' hidden' : '') }, h('div', { class: 'row' },
    h('label', { class: 'grow' }, 'Background ', e ? badge(e) : null),
    d ? hideButton(e, 'this background') : null));
  if (!state.media) return box.append(h('p', { class: 'hint' }, 'Needs file storage (R2), which isn\'t switched on for this site.')), box;
  const busy = !!bgBusy[key];
  const status = h('p', { class: 'hint' }, bgBusy[key] || '');
  const say = (t) => { bgBusy[key] = t; status.textContent = t; };
  // a new picture or video in a hidden background stays hidden until shown again
  // the new Library item's name (declared before the return below: a const after it is never set)
  const label = `${(PAGE.find((p) => p.bg === key) || { name: key }).name} background`;
  const store = (data, msg, mk) => save([{ id, kind: 'background', data: data && { ...data, hidden: !!(d && d.hidden) } }], msg, mk);
  const pickPhoto = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: () => pickPhoto.files[0] && run(() => addPhoto(pickPhoto.files[0])) });
  // several files at once are one video's versions (a set: e.g. sizes for wide screens and one framed for phones)
  const pickVideo = h('input', { type: 'file', accept: 'video/mp4,.mp4,.m4v', hidden: true, multiple: true,
    onchange: () => pickVideo.files.length && run(() => addVideo([...pickVideo.files], isVideo ? r : null)) });

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
        ...versionRows(r).map(([v, text]) => h('div', { class: 'row bg-version' }, h('span', { class: 'grow' }, text),
          r.versions.length > 1 ? h('button', { class: 'danger', disabled: busy, title: 'Remove this version',
            onclick: () => confirm('Remove this version?') && run(() => removeVersion(v)) }, 'Remove') : null)));
      if (bgNotes[key]) box.append(h('div', { class: 'bg-notes' }, ...bgNotes[key].map((n) => h('p', { class: 'hint' }, n))));
    } else {
      box.append(h('p', { class: 'hint' }, `Photo, ${r.w} × ${r.h} pixels.`));
    }
  } else {
    box.append(h('p', { class: 'hint' }, e ? 'Removed in the draft: once published, the section has no background (the picture stays in the Library).' : 'None: the section shows the page\'s grey.'));
  }
  if (bgPicking.has(key)) box.append(libraryPicker(d, (data) => { bgPicking.delete(key); store(data, 'Saved as a draft'); }));
  box.append(pickPhoto, pickVideo, status, h('div', { class: 'actions' },
    h('button', { disabled: busy, title: 'Choose a photo or video already in the Library',
      onclick: () => { bgPicking.has(key) ? bgPicking.delete(key) : bgPicking.add(key); render(); } }, bgPicking.has(key) ? 'Close the Library' : 'From the Library…'),
    h('button', { disabled: busy, onclick: () => pickPhoto.click() }, d && !isVideo ? 'Replace with a photo…' : 'Choose a photo…'),
    h('button', { disabled: busy, title: 'One video, or several versions of it at once (sizes for wide screens, one made for phones held upright)',
      onclick: () => { addingFresh = true; pickVideo.click(); } }, d ? 'Replace with a video…' : 'Choose a video…'),
    isVideo ? h('button', { disabled: busy || r.versions.length >= 6, title: 'Another size of this video, or one made for phones held upright',
      onclick: () => { addingFresh = false; pickVideo.click(); } }, 'Add a version…') : null,
    d ? h('button', { class: 'danger', disabled: busy, title: 'Take it out of this section: the picture stays in the Library',
      onclick: () => confirm('Remove this section\'s background? The picture stays in the Library.') && store(null, 'Removed in the draft') }, 'Remove') : null,
    e && changed(e) ? h('button', { disabled: busy, onclick: () => discard([id]) }, 'Undo change') : null));
  return box;

  async function run(job) {
    try { await job(); } catch (err) { toast(err.message, true); }
    delete bgBusy[key]; render();
  }
  async function addPhoto(file) {
    const pic = await photoItem(file, label, say);
    delete bgBusy[key];
    await store({ rendition: pic.rendition, focus: [0.5, 0.5], shade: d ? d.shade : 0.12 }, 'Photo saved as a draft: tap it to choose the part to keep in view');
  }
  /* One or more versions of a video. into: the section's video rendition to add them to (Add a version…: a new
     rendition of the same item, with these as well), or null for a new video (Choose / Replace with a video…), a
     new Library item. */
  async function addVideo(files, into) {
    if (addingFresh) into = null;
    const got = await videoItem(into ? into.item : null, `${label} video`, files, into, say);
    bgNotes[key] = got.notes;
    delete bgBusy[key];
    const base = into ? d : { focus: d ? d.focus : [0.5, 0.5], shade: d ? d.shade : 0, play: 'once', calm: 'last' };
    await store({ ...base, rendition: got.rendition.id },
      files.length > 1 ? `${files.length} versions saved as a draft` : 'Video saved as a draft');
  }
  /* Take a version out of the background: a new rendition without it (the file stays in the Library, as one of the
     item's originals); if its shape's frames came from it, they're made again from the next largest of that shape. */
  async function removeVersion(v) {
    const made = await videoRendition(r.item, r.versions.filter((x) => x.digest !== v.digest), r, () => null, say);
    delete bgBusy[key];
    await store({ ...d, rendition: made.id }, 'Version removed in the draft');
  }
}
let addingFresh = false;
const bgPicking = new Set();          // sections whose Library picker is open

/* The Library's site pictures that can be a background: photos with a rendition made as they are, and videos.
   Tapping one makes its newest such rendition the background (in the draft), keeping the focus and shade. */
function libraryPicker(d, use) {
  if (!state.library) { loadLibrary(); return h('p', { class: 'hint' }, 'Loading the Library…'); }
  const fit = state.library.items.filter((it) => it.site).map((it) => [it, backgroundFrom(it, d)]).filter(([, b]) => b);
  if (!fit.length) return h('p', { class: 'hint' }, 'The Library has no site pictures yet: add some there, or choose a photo or video here.');
  return h('div', { class: 'lib-picker' }, ...fit.map(([it, b]) => h('button', { class: 'lib-pick', title: it.name, onclick: () => use(b) },
    it.thumb ? h('img', { src: it.thumb, alt: '' }) : glyph(GLYPHS.photo, 28),
    it.kind === 'video' ? h('span', { class: 'lib-video' }, glyph(GLYPHS.play, 12)) : null,
    h('span', { class: 'lib-pick-name' }, it.name))));
}
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
