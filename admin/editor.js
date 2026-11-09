/* The editor page (admin/index.html). Its views:
     #gallery  add a painting (at the top), and change the genres and paintings
     #content  change the page's words, section by section. Every change is saved as a draft
               at once; the preview (the site at this address) shows drafts in place.
     #library  every file in storage (Site pictures, Paintings): what uses each, its name, Delete for good
     #review   every unpublished change, each with a tick: publish the ticked ones, or all, or discard them.
     #history  each publication, and every earlier version of anything, which can be brought back as a draft.
   It talks to editor.js on the server through /admin/api/. Page elements are built with textContent, never
   from strings of HTML, so nothing typed in can become part of the page. */

import { SITES, tidy, ok, icon } from '/links.js';
import { SOURCE_MAX, scaled, resized, whiteBalanced, findPaper, fullView, cropSize, squaredUp, guessCorners, turnOf, describeTurn, wholePhoto, labelled, ordered, FRAME } from './darkroom.js';

const $ = (s) => document.querySelector(s);
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k instanceof Node ? k : String(k));
  return el;
}

let entries = [], media = false, who = '';
const open = new Set();             // paintings whose edit form is open
/* The page's sections, each with its heading, any other words, and its paragraphs (one text entry per section,
   paragraphs separated by a blank line; site.js puts them into the page's data-paragraphs="key" block). */
const PAGE = [
  { name: 'Hero', heading: 't-hero-title', paras: 't-hero', bg: 'hero' },
  { name: 'Gallery', heading: 't-gallery-title', extra: [['t-gallery-button', 'Button']], paras: 't-gallery' },
  { name: 'Contact', heading: 't-contact-title', paras: 't-contact', bg: 'contact', links: true },
  { name: 'Profile', heading: 't-profile-title', paras: 't-profile' },
  { name: 'Footer', paras: 't-footer', bg: 'footer' },
];
const TEXTS = PAGE.flatMap((p) => [
  ...(p.heading ? [[p.heading, `${p.name} heading`]] : []), ...(p.extra || []).map(([id, n]) => [id, `${p.name} ${n.toLowerCase()}`]),
  [p.paras, `${p.name} paragraphs`]]);
const WIDTHS = [300, 480, 768, 1024, 1536, 2560], PREVIEW = 1200;
/* Sections with bg can have a photo or video behind them (entries bg-<section>; BACKGROUNDS in editor.js, the
   server, must list the same). They fill the window, so their sizes go up to a 4K screen's width. */
const BG_WIDTHS = [768, 1024, 1536, 2560, 3840];

// ---- talking to the server ---------------------------------------------------------------------------------

/* fetch, giving up after ms (a dropped phone signal can otherwise leave a request, and a disabled button,
   waiting for ever).
   X-Requested-With asks Cloudflare Access to answer 401 when its session has run out, rather than sending the
   request off to its sign-in page (docs: Access, session management, AJAX); worker.js answers 401 too when it
   rejects the token. Either way the sign-in bar appears, with a link that signs in afresh in a new tab, so
   whatever is typed here stays put: sign in there, come back and try again. */
async function fetchFor(url, opts = {}, ms) {
  let r;
  try {
    r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), 'x-requested-with': 'XMLHttpRequest' },
      signal: AbortSignal.timeout(ms) });
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') throw new Error('No answer from the server: check the signal and try again');
    throw new Error('Couldn\'t reach the server: check the signal and try again');
  }
  $('#signin').hidden = r.status !== 401;
  if (r.status === 401) throw new Error('Your sign-in has run out: sign in again, then try once more');
  return r;
}
async function call(method, path, body) {
  const r = await fetchFor(`/admin/api/${path}`, {
    method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
  }, 30000);
  const data = await r.json().catch(() => ({ error: `The server answered ${r.status}` }));
  if (!r.ok) throw new Error(data.error || `The server answered ${r.status}`);
  if (data.entries) entries = data.entries;
  return data;
}
async function act(fn, done) {
  try { const out = await fn(); if (done) toast(typeof done === 'function' ? done(out) : done); render(); return out; }
  catch (e) { toast(e.message, true); render(); }
}
const save = (items, msg = 'Saved as a draft') => act(() => call('POST', 'save', { items }), msg);

let toastTimer;
function toast(text, error) {
  const t = $('#toast');
  t.textContent = text; t.className = 'show' + (error ? ' error' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = ''; }, error ? 6000 : 2500);
}

// ---- reading the entries -----------------------------------------------------------------------------------

const parse = (v) => (v == null ? null : JSON.parse(v));
const draftOf = (e) => parse(e.draft), liveOf = (e) => parse(e.published);
const byId = (id) => entries.find((e) => e.id === id);
const changed = (e) => e.draft !== e.published;
const status = (e) => (!changed(e) ? null : e.published == null ? 'new' : e.draft == null ? 'gone' : 'changed');
const STATUS = { new: 'New', changed: 'Changed', gone: 'Deleted' };
const badge = (e) => { const s = status(e); return s ? h('span', { class: `badge ${s}` }, STATUS[s]) : null; };
const current = (e) => draftOf(e) || liveOf(e);
const sections = () => entries.filter((e) => e.kind === 'section' && e.draft != null)
  .map((e) => ({ id: e.id, ...draftOf(e) })).sort((a, b) => a.order - b.order);
const paintingsIn = (sid) => entries.filter((e) => e.kind === 'painting' && current(e).section === sid)
  .sort((a, b) => current(a).order - current(b).order);
const thumb = (d) => `/${d.base}${d.file || d.name}-${d.widths[0]}.${d.ext}`;
const label = (e) => {
  const d = current(e) || {};
  if (e.kind === 'painting') return d.title;
  if (e.kind === 'section') return `Genre: ${d.title}`;
  if (e.kind === 'text') return (TEXTS.find((t) => t[0] === e.id) || [0, e.id])[1].replace(/ \(.*/, '');
  if (e.kind === 'links') return 'Contact links';
  if (e.kind === 'background') return `${(PAGE.find((p) => p.bg === e.id.slice(3)) || { name: e.id.slice(3) }).name} background picture`;
  return e.id === 'settings-gallery' ? 'Gallery settings' : 'Gallery invitation';
};

// ---- the views ---------------------------------------------------------------------------------------------

function view() { return (location.hash.slice(1) || 'gallery'); }
window.addEventListener('hashchange', () => {
  if (view() === 'history') historyData = null;
  if (view() === 'library') libraryData = null;
  render();
});

function render() {
  const n = entries.filter(changed).length;
  $('#count').hidden = !n; $('#count').textContent = n;
  document.querySelectorAll('.bar a[data-view]').forEach((a) => a.classList.toggle('on', a.dataset.view === view()));
  const main = $('#main');
  const y = scrollY;
  main.replaceChildren(...({ gallery: galleryView, content: contentView, library: libraryView, review: reviewView, history: historyView }[view()] || galleryView)());
  if (view() !== 'history') scrollTo(0, y);
}

const HINT = 'Changes are saved as drafts straight away. Visitors see them only once you publish them under Review.';

function galleryView() {
  const out = [h('h1', {}, 'Gallery'), h('p', { class: 'hint' }, HINT)];
  const secs = sections();
  out.push(h('h2', {}, 'Add a painting'));
  out.push(addForm(secs));
  out.push(h('h2', {}, 'Genres'));
  out.push(h('div', { class: 'actions top' }, h('button', { onclick: addSection }, 'Add a genre')));
  secs.forEach((s, si) => {
    const se = byId(s.id);
    const items = paintingsIn(s.id);
    const card = h('div', { class: 'card' });
    card.append(h('div', { class: 'row' },
      h('input', { type: 'text', class: 'grow', value: s.title, 'aria-label': 'Genre name', onchange: (ev) => {
        save([{ id: s.id, kind: 'section', data: { title: ev.target.value, order: s.order } }]);
      } }),
      badge(se),
      h('span', { class: 'move' },
        h('button', { title: 'Move genre up', disabled: si === 0, onclick: () => moveSection(secs, si, -1) }, '↑'),
        h('button', { title: 'Move genre down', disabled: si === secs.length - 1, onclick: () => moveSection(secs, si, 1) }, '↓')),
      h('button', { class: 'danger', title: 'Delete genre', disabled: items.some((e) => e.draft != null),
        onclick: () => { if (confirm(`Delete the genre "${s.title}"?`)) save([{ id: s.id, kind: 'section', data: null }], 'Genre deleted in the draft'); } }, 'Delete'),
    ));
    if (!items.length) card.append(h('p', { class: 'hint' }, 'No paintings in this genre.'));
    items.forEach((e, i) => card.append(...paintingRow(e, items, i, secs)));
    out.push(card);
  });
  // genres deleted in the draft but still live
  for (const e of entries.filter((x) => x.kind === 'section' && x.draft == null)) {
    out.push(h('div', { class: 'card row' }, h('span', { class: 'grow muted' }, `${liveOf(e).title} (deleted in the draft)`), badge(e),
      h('button', { onclick: () => discard([e.id]) }, 'Keep it')));
  }

  return out;
}

/* The page's words, a box for each section: its heading, then a box for each paragraph. */
const extraParas = {};               // section -> empty paragraph boxes added but not yet typed in
function contentView() {
  const out = [h('h1', {}, 'Content'), h('p', { class: 'hint' }, HINT)];
  for (const sec of PAGE) {
    const card = h('div', { class: 'card' }, h('h2', { class: 'card-title' }, sec.name));
    const field = (id, name) => {
      const e = byId(id), text = e ? (current(e) || {}).text || '' : '';
      return h('div', { class: 'box' }, h('label', {}, name, ' ', e ? badge(e) : null),
        h('input', { type: 'text', value: text, onchange: (ev) => save([{ id, kind: 'text', data: { text: ev.target.value } }]) }),
        e && changed(e) ? h('div', { class: 'actions' }, h('button', { onclick: () => discard([id]) }, 'Undo change')) : null);
    };
    if (sec.heading) card.append(field(sec.heading, 'Heading'));
    for (const [id, name] of sec.extra || []) card.append(field(id, name));
    if (sec.bg) card.append(backgroundBox(sec.bg));
    // Paragraphs: stored as one text, a blank line between paragraphs.
    const e = byId(sec.paras);
    const paras = (e ? (current(e) || {}).text || '' : '').split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
    const all = paras.concat(Array(extraParas[sec.paras] || 0).fill(''));
    const store = (list) => {
      extraParas[sec.paras] = list.filter((x) => !x.trim()).length;
      save([{ id: sec.paras, kind: 'text', data: { text: list.map((x) => x.trim().replace(/\n\s*\n/g, '\n')).filter(Boolean).join('\n\n') } }]);
    };
    all.forEach((text, i) => {
      const ta = h('textarea', { rows: Math.min(8, Math.max(2, Math.ceil(text.length / 60))), value: text,
        onchange: (ev) => { const list = all.slice(); list[i] = ev.target.value; store(list); } });
      card.append(h('div', { class: 'box' },
        h('div', { class: 'row' }, h('label', { class: 'grow' }, `Paragraph ${i + 1}`),
          h('span', { class: 'move' },
            h('button', { title: 'Move up', disabled: i === 0, onclick: () => { const l = all.slice(); [l[i - 1], l[i]] = [l[i], l[i - 1]]; store(l); } }, '↑'),
            h('button', { title: 'Move down', disabled: i === all.length - 1, onclick: () => { const l = all.slice(); [l[i + 1], l[i]] = [l[i], l[i + 1]]; store(l); } }, '↓')),
          h('button', { class: 'danger', title: 'Delete paragraph', onclick: () => {
            if (!text.trim()) { extraParas[sec.paras]--; render(); return; }
            if (confirm('Delete this paragraph?')) store(all.filter((_, j) => j !== i));
          } }, 'Delete')),
        ta));
    });
    card.append(h('div', { class: 'actions' },
      e ? badge(e) : null,
      e && changed(e) ? h('button', { onclick: () => { extraParas[sec.paras] = 0; discard([sec.paras]); } }, 'Undo paragraph changes') : null,
      h('button', { onclick: () => { extraParas[sec.paras] = (extraParas[sec.paras] || 0) + 1; render(); } }, 'Add a paragraph')));
    if (sec.links) card.append(linksBox());
    out.push(card);
  }
  return out;
}

/* The contact links (entry 'links', links.js): a tick and a username for each site; the ticked ones are shown in
   the contact section and as icons in the header, in this order, each linking to the address built from the
   username (shown beside it, to try). A pasted profile address is read for the username. A box ticked before
   its username is typed waits here until it is. */
const tickedEmpty = new Set();
function linksBox() {
  const e = byId('links'), d = (e && current(e)) || {};
  const store = (key, change) => {
    const next = {};
    for (const s of SITES) {
      const v = { ...(d[s.key] || { name: '', on: false }), ...(s.key === key ? change : {}) };
      if (v.name || v.on) next[s.key] = { name: v.name, on: !!v.on };
    }
    save([{ id: 'links', kind: 'links', data: next }]);
  };
  const box = h('div', { class: 'box links' }, h('label', {}, 'Links ', e ? badge(e) : null),
    h('p', { class: 'hint' }, 'Tick the ones to show, here and as icons in the header, and type the username (or paste the profile\'s address).'));
  for (const s of SITES) {
    const v = d[s.key] || { name: '', on: false };
    const on = v.on || tickedEmpty.has(s.key);
    const input = h('input', { type: s.key === 'email' ? 'email' : 'text', value: v.name, placeholder: s.sample,
      autocapitalize: 'off', autocomplete: 'off', spellcheck: false, 'aria-label': `${s.name} ${s.key === 'email' ? 'address' : 'username'}`,
      onchange: (ev) => {
        const name = tidy(s.key, ev.target.value);
        if (name && !ok(s.key, name)) { toast(`That doesn't look like ${s.key === 'email' ? 'an email address' : `a username for ${s.name}`}`, true); return; }
        if (!name && on) tickedEmpty.add(s.key);
        if (name) tickedEmpty.delete(s.key);
        store(s.key, { name, on: on && !!name });
      } });
    const tick = h('input', { type: 'checkbox', checked: on, onchange: (ev) => {
      if (ev.target.checked && !v.name) { tickedEmpty.add(s.key); render(); return; }
      tickedEmpty.delete(s.key);
      store(s.key, { on: ev.target.checked });
    } });
    const glyph = h('span', { class: 'link-icon' }); glyph.innerHTML = icon(s.key, 18);   // drawn by links.js, nothing typed in it
    const tryIt = v.name && ok(s.key, v.name) && s.key !== 'email'
      ? h('a', { href: s.url(v.name), target: '_blank', rel: 'noopener', class: 'muted link-try', title: 'Open it, to check' }, s.shown(v.name))
      : h('span', { class: 'link-try' });
    box.append(h('div', { class: 'row link-row' }, h('label', { class: 'link-name' }, tick, glyph, s.name), input, tryIt));
  }
  if (e && changed(e)) box.append(h('div', { class: 'actions' }, h('button', { onclick: () => { tickedEmpty.clear(); discard(['links']); } }, 'Undo link changes')));
  return box;
}

/* A section's background: a photo or a video, shown as it is now (the photo, or the video's last frame), with
   its focus (the point kept in view when the screen's shape crops it: tap the picture to move it), how a phone held
   upright and a wide screen would crop it, and the shade (how much it's darkened, so the words over it read).
   A photo: its original goes to R2's originals/ as a painting's does (keepOriginal) and its sizes are made here,
   from the photo as it is (it's a photograph, not a painting: no white balance or corners).
   A video: one or more versions (e.g. a large one for big screens, a small one for phones, one upright for phones
   held upright), each uploaded as made, after the checks in videoFacts(); its first and last frames are taken here
   and stored as pictures. How it plays (once, or on a loop) and what visitors who ask for reduced motion or less
   data see instead (its last frame, or a slow fade from the first frame to the last) are the section's choices. */
const bgBusy = {};                    // section -> what it's doing, while a photo or video is being stored
const bgNotes = {};                   // section -> the checks' findings for the video version last added
const MB = (b) => `${(b / 1048576).toFixed(1)} megabytes`;
const lastStill = (d) => {
  const v = d.versions.filter((x) => x.h <= x.w).sort((x, y) => y.w - x.w)[0] || d.versions[0];
  return `/media/images/${v.name}-last-${v.stills.find((w) => w >= 1024) || v.stills[v.stills.length - 1]}.jpg`;
};

function backgroundBox(key) {
  const id = `bg-${key}`, e = byId(id), d = e && current(e);
  const box = h('div', { class: 'box bg-box' }, h('label', {}, 'Background ', e ? badge(e) : null));
  if (!media) return box.append(h('p', { class: 'hint' }, 'Needs file storage (R2), which isn\'t switched on for this site.')), box;
  const busy = !!bgBusy[key];
  const status = h('p', { class: 'hint' }, bgBusy[key] || '');
  const say = (t) => { bgBusy[key] = t; status.textContent = t; };
  const store = (data, msg) => save([{ id, kind: 'background', data }], msg);
  const pickPhoto = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: () => pickPhoto.files[0] && run(() => addPhoto(pickPhoto.files[0])) });
  const pickVideo = h('input', { type: 'file', accept: 'video/mp4,.mp4,.m4v', hidden: true,
    onchange: () => pickVideo.files[0] && run(() => addVideo(pickVideo.files[0], d && d.type === 'video' ? d : null)) });

  if (d) {
    const src = d.type === 'video' ? lastStill(d)
      : `/media/images/${d.file}-${d.widths.find((w) => w >= 1024) || d.widths[d.widths.length - 1]}.jpg`;
    const pos = `${(d.focus[0] * 100).toFixed(1)}% ${(d.focus[1] * 100).toFixed(1)}%`;
    const frames = ['phone', 'wide'].map((k) => h('div', { class: `bg-frame ${k}`, title: k === 'phone' ? 'On a phone held upright' : 'On a wide screen',
      style: `background-image: url("${src}"); background-position: ${pos}; filter: brightness(${1 - d.shade})` }));
    box.append(
      h('div', { class: 'bg-pick', title: 'Tap the part to keep in view', onclick: (ev) => {
        const r = ev.currentTarget.getBoundingClientRect();
        const focus = [(ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000);
        store({ ...d, focus }, 'Focus saved as a draft');
      } }, h('img', { src, alt: '' }), h('span', { class: 'bg-focus', style: `left: ${d.focus[0] * 100}%; top: ${d.focus[1] * 100}%` })),
      h('p', { class: 'hint' }, d.type === 'video' ? 'The video\'s last frame. ' : '', 'Tap the part to keep in view. How it would be cropped:'),
      h('div', { class: 'bg-frames' }, ...frames.map((f) => h('figure', {}, f, h('figcaption', {}, f.title)))),
      h('label', {}, `Shade: ${Math.round(d.shade * 100)}%`),
      h('input', { type: 'range', min: 0, max: 60, step: 1, value: Math.round(d.shade * 100),
        oninput: (ev) => { frames.forEach((f) => { f.style.filter = `brightness(${1 - ev.target.value / 100})`; });
          ev.target.previousSibling.textContent = `Shade: ${ev.target.value}%`; },
        onchange: (ev) => store({ ...d, shade: ev.target.value / 100 }, 'Shade saved as a draft') }));
    if (d.type === 'video') {
      const choice = (label, field, options) => h('label', {}, label, h('select', { onchange: (ev) => store({ ...d, [field]: ev.target.value }, 'Saved as a draft') },
        ...options.map(([v, t]) => h('option', { value: v, selected: d[field] === v }, t))));
      box.append(
        choice('Plays', 'play', [['once', 'Once, stopping on its last frame'], ['loop', 'On a loop']]),
        choice('For visitors who ask for reduced motion or less data', 'calm', [['last', 'Its last frame'], ['fade', 'A slow fade from its first frame to its last']]),
        h('label', {}, 'Versions (the browser picks one for each screen)'),
        ...versionRows(d).map(([v, text]) => h('div', { class: 'row bg-version' }, h('span', { class: 'grow' }, text),
          d.versions.length > 1 ? h('button', { class: 'danger', disabled: busy, title: 'Remove this version',
            onclick: () => confirm('Remove this version?') && store({ ...d, versions: d.versions.filter((x) => x !== v) }, 'Version removed in the draft') }, 'Remove') : null)));
      if (bgNotes[key]) box.append(h('div', { class: 'bg-notes' }, ...bgNotes[key].map((n) => h('p', { class: 'hint' }, n))));
    } else {
      box.append(h('p', { class: 'hint' }, `Photo, ${d.w} × ${d.h} pixels.`));
    }
  } else {
    box.append(h('p', { class: 'hint' }, e ? 'Removed in the draft: once published, the section has no background.' : 'None: the section shows the page\'s grey.'));
  }
  box.append(pickPhoto, pickVideo, status, h('div', { class: 'actions' },
    h('button', { disabled: busy, onclick: () => pickPhoto.click() }, d && d.type === 'photo' ? 'Replace with a photo…' : 'Choose a photo…'),
    h('button', { disabled: busy, onclick: () => { addingFresh = true; pickVideo.click(); } }, d ? 'Replace with a video…' : 'Choose a video…'),
    d && d.type === 'video' ? h('button', { disabled: busy || d.versions.length >= 6, onclick: () => { addingFresh = false; pickVideo.click(); } }, 'Add a version…') : null,
    d ? h('button', { class: 'danger', disabled: busy, onclick: () => confirm('Remove this section\'s background?') && store(null, 'Removed in the draft') }, 'Remove') : null,
    e && changed(e) ? h('button', { disabled: busy, onclick: () => discard([id]) }, 'Undo change') : null));
  return box;

  async function run(job) {
    try { await job(); } catch (err) { toast(err.message, true); }
    delete bgBusy[key]; render();
  }
  async function addPhoto(file, extra = {}) {
    const src = await photoOf(file, say);
    const { key: original } = await keepOriginal(file, id, null, say);
    const { file: stem } = await call('GET', `free?name=${id}`);
    const widths = await storeSizes(stem, src, say);
    const top = widths[widths.length - 1];
    delete bgBusy[key];
    await store({ type: 'photo', file: stem, focus: extra.focus || [0.5, 0.5], shade: extra.shade ?? (d ? d.shade : 0.12),
      w: top, h: Math.round(src.height * top / src.width), widths, original }, 'Photo saved as a draft: tap it to choose the part to keep in view');
  }
  /* A video version: checked, uploaded as it is, its first and last frames stored as pictures. into: the
     section's video to add it to (Add a version…), or null for a new video (Choose / Replace with a video…). */
  async function addVideo(file, into) {
    if (addingFresh) into = null;
    const facts = await videoFacts(file, say);
    const stem = into ? into.file : (await call('GET', `free?name=${id}`)).file;
    const { file: name } = await call('GET', `free?name=${stem}-${facts.w}x${facts.h}`);
    say(`Uploading the video (${MB(file.size)})…`);
    await put(`videos/${name}.mp4`, file, 'video/mp4', 15 * 60000);
    const stills = await storeSizes(`${name}-first`, facts.first, say, 'first frame');
    await storeSizes(`${name}-last`, facts.last, say, 'last frame');
    const version = { name, w: facts.w, h: facts.h, bytes: file.size, seconds: facts.seconds, stills };
    bgNotes[key] = facts.notes;
    delete bgBusy[key];
    const base = into || { type: 'video', file: stem, focus: d ? d.focus : [0.5, 0.5], shade: d ? d.shade : 0, versions: [], play: 'once', calm: 'last' };
    await store({ ...base, type: 'video', versions: [...(base.versions || []), version] }, 'Video saved as a draft');
  }
}
let addingFresh = false;

/* Each version, described: its size, weight and which screens get it (the same rule as site.js bgTag). */
function versionRows(d) {
  const desc = (g) => g.sort((x, y) => y.w - x.w);
  const upright = desc(d.versions.filter((v) => v.h > v.w)), level = desc(d.versions.filter((v) => v.h <= v.w));
  const rows = (g, who) => g.map((v, i) => [v, `${v.w} × ${v.h}, ${v.seconds} seconds, ${MB(v.bytes)} `
    + `(${(v.bytes * 8 / v.seconds / 1e6).toFixed(1)} megabits a second): for ${who}`
    + `${g[i + 1] ? ` showing more than ${g[i + 1].w} pixels across` : g.length > 1 ? ', the rest' : ''}`]);
  return [...rows(upright, 'phones held upright'), ...rows(level, upright.length ? 'screens held level' : 'all screens')];
}

/* A photo (File or Blob) read into a working copy, at most SOURCE_MAX pixels along its longer side. */
async function photoOf(blob, say) {
  say('Reading the photo…');
  const img = new Image();
  img.src = URL.createObjectURL(blob);
  try { await img.decode(); } catch { throw new Error('This browser can\'t read that photo. On a Mac, Chrome can\'t open HEIC: use Safari, or export it as JPEG.'); }
  const W = img.naturalWidth, H = img.naturalHeight, k = Math.min(1, SOURCE_MAX / Math.max(W, H));
  const src = scaled(img, Math.round(W * k));
  URL.revokeObjectURL(img.src);
  return src;
}

/* Make a background's JPEG sizes (BG_WIDTHS, never larger than the picture) and store them as
   images/<stem>-<width>.jpg; returns the widths. */
async function storeSizes(stem, src, say, what = 'sizes') {
  const widths = [...new Set(BG_WIDTHS.filter((w) => w < src.width).concat(Math.min(src.width, BG_WIDTHS[BG_WIDTHS.length - 1])))];
  let n = 0;
  for (const w of widths) {
    say(`Making and uploading the ${what}: ${++n} of ${widths.length}`);
    await put(`images/${stem}-${w}.jpg`, await resized(src, w), 'image/jpeg');
  }
  return widths;
}

/* Check a video before it's uploaded, and take its first and last frames. Refuses only what won't do: not an MP4,
   or a video this browser can't play. Everything else is guidance (notes), shown under the versions:
   - the codec, from the file's own description (its moov box): H.264 (avc1) plays in every browser; HEVC (hvc1,
     hev1) not in Firefox nor on many Windows and Android devices; AV1 not on older Apple devices;
   - whether its index (moov) comes before the picture data (mdat), so it can start playing before it has all
     arrived ("fast start", "optimise for web"; ffmpeg -movflags +faststart);
   - a sound track, which is never heard (backgrounds play muted) and only adds weight;
   - its length (over 5 seconds needs the pause control, which the site has; past 30, most visitors have moved on);
   - its weight for its size: megabits a second against a guide (1 + 3.5 per 4K screen's worth of pixels; the
     forest video's versions are 0.9 to 4.3), and over 20 megabytes in all. */
async function videoFacts(file, say) {
  say('Checking the video…');
  if (!/\.(mp4|m4v)$/i.test(file.name) && file.type !== 'video/mp4') throw new Error('Choose an MP4 video (H.264 is the one every browser plays).');
  if (file.size > 95 * 1048576) throw new Error(`That video is ${MB(file.size)}: it must be under 95 megabytes (and far less is better for visitors).`);
  const notes = [];
  const boxes = [];
  for (let at = 0; at < file.size && boxes.length < 64;) {
    const b = new DataView(await file.slice(at, at + 16).arrayBuffer());
    if (b.byteLength < 8) break;
    let size = b.getUint32(0);
    const type = String.fromCharCode(b.getUint8(4), b.getUint8(5), b.getUint8(6), b.getUint8(7));
    if (size === 1 && b.byteLength >= 16) size = Number(b.getBigUint64(8));
    else if (size === 0) size = file.size - at;
    if (size < 8) break;
    boxes.push({ type, at, size });
    at += size;
  }
  const moov = boxes.find((b) => b.type === 'moov'), mdat = boxes.find((b) => b.type === 'mdat');
  if (!moov) throw new Error('That doesn\'t look like an MP4 video.');
  const desc = new TextDecoder('latin1').decode(await file.slice(moov.at, moov.at + Math.min(moov.size, 32 * 1048576)).arrayBuffer());
  const codec = ['avc1', 'avc3', 'hvc1', 'hev1', 'av01', 'vp09'].find((c) => desc.includes(c));
  const CODECS = { hvc1: 'HEVC (H.265)', hev1: 'HEVC (H.265)', av01: 'AV1', vp09: 'VP9' };
  if (codec && !codec.startsWith('avc')) notes.push(`It's ${CODECS[codec]}, which some browsers and devices can't play: export it as H.264 so everyone sees it.`);
  if (mdat && mdat.at < moov.at) notes.push('Its index is at the end of the file, so it can\'t start until it has all arrived: export it with "optimise for web" (or "fast start").');
  if (desc.includes('soun')) notes.push('It has a sound track, which is never heard (backgrounds play muted): leaving it out makes the file smaller.');

  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto';
  v.src = URL.createObjectURL(file);
  const event = (name, ms = 20000) => new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error('This browser can\'t play that video: export it as MP4 with H.264.')), ms);
    v.addEventListener(name, () => { clearTimeout(t); ok(); }, { once: true });
    v.addEventListener('error', () => { clearTimeout(t); no(new Error('This browser can\'t play that video: export it as MP4 with H.264.')); }, { once: true });
  });
  try {
    await event('loadeddata');
    const w = v.videoWidth, hh = v.videoHeight, seconds = v.duration;
    if (!w || !hh || !isFinite(seconds)) throw new Error('This browser can\'t read that video\'s size or length.');
    const grab = async (t) => {
      say('Taking its first and last frames…');
      v.currentTime = t; await event('seeked');
      const c = document.createElement('canvas'); c.width = w; c.height = hh;
      c.getContext('2d').drawImage(v, 0, 0, w, hh);
      return c;
    };
    const first = await grab(0);
    const last = await grab(Math.max(0, seconds - 0.05));
    const rate = file.size * 8 / seconds / 1e6, guide = 1 + 3.5 * (w * hh) / (3840 * 2160);
    if (seconds > 30) notes.push(`It runs ${Math.round(seconds)} seconds: most visitors will have moved on well before the end.`);
    if (rate > guide * 1.25) notes.push(`It's ${rate.toFixed(1)} megabits a second; about ${guide.toFixed(1)} would do for its size, so it's heavier than it needs to be.`);
    if (file.size > 20 * 1048576) notes.push(`It's ${MB(file.size)}: heavy for a background, especially on a phone's data.`);
    if (Math.max(w, hh) < 1920) notes.push(`At ${w} × ${hh} it will look soft on large screens: fine as a small version, alongside a larger one.`);
    if (!notes.length) notes.push('Checked: it plays everywhere, starts quickly and is a sensible weight for its size.');
    return { w, h: hh, seconds, first, last, notes };
  } finally {
    URL.revokeObjectURL(v.src);
  }
}

/* The painting's medium, size in centimetres and year, as separate fields (the server makes the details line
   from them). d: the painting's data, or {} for a new one, which starts with the last medium and height used.
   What drives what (Christopher's decision, Nov 2026): a measured size is the dog. Measured: the height and width
   are as typed and fix the picture's shape when it's squared up. Not measured (estimated: true in the data):
   the shape comes from the photo, and the size only sets the scale: the side last typed is kept and the other
   follows the picture's proportions (f.ratio, width over height, set by the darkroom), greyed. Whether visitors
   see the size is a separate tick (size_shown), on by default when measured, off when not. */
function detailsFields(f, d, onSize) {
  const media = [...new Set(entries.filter((e) => e.kind === 'painting' && current(e)).map((e) => current(e).medium).filter(Boolean))].sort();
  const listId = `media-${Math.random().toString(36).slice(2, 8)}`;
  const old = !d.cm && d.details ? /^(.*?),\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*cm(?:,\s*(.*))?$/i.exec(d.details) : null;
  const remembered = (k, dflt) => { try { return localStorage.getItem(k) || dflt; } catch { return dflt; } };
  const isNew = !d.title;
  const typed = (side) => () => {
    if (f.estimated.checked) { f.scaleBy = side; f[side].classList.remove('suggested'); f.follow(); }
    if (onSize) onSize();
  };
  const num = (value, label, side) => h('label', { class: 'num' }, label,
    h('input', { type: 'number', inputmode: 'decimal', min: '0.1', step: '0.1', value, oninput: typed(side) }));
  const group = `how-${Math.random().toString(36).slice(2, 8)}`;
  const how = () => {                                // Measured / Not measured chosen
    if (!f.shownTouched) f.shown.checked = !f.estimated.checked;
    if (f.estimated.checked) f.follow(); else { f.height.classList.remove('suggested'); f.width.classList.remove('suggested'); }
    if (onSize) onSize();
  };
  const unmeasured = isNew || !!d.estimated;
  const out = [
    h('label', {}, 'Medium'),
    f.medium = h('input', { type: 'text', autocomplete: 'off', list: listId,
      value: d.medium ?? (old ? old[1] : isNew ? remembered('editor-medium', '') : d.details || '') }),
    h('datalist', { id: listId }, ...media.map((m) => h('option', { value: m }))),
    h('div', { class: 'row size' },
      f.hBox = num(d.cm ? d.cm[0] : old ? old[2] : isNew ? remembered('editor-height', '60') : '', 'Height (cm)', 'height'),
      f.wBox = num(d.cm ? d.cm[1] : old ? old[3] : '', 'Width (cm)', 'width'),
      f.yBox = h('label', { class: 'num' }, 'Year', h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off',
        value: d.year ?? (old ? old[4] || '' : isNew ? String(new Date().getFullYear()) : '') }))),
    h('div', { class: 'row how' },
      h('label', { class: 'tick', title: 'The height and width are as measured, and the picture is squared up to exactly that shape' },
        f.measured = h('input', { type: 'radio', name: group, checked: !unmeasured, onchange: how }), 'Measured'),
      h('label', { class: 'tick', title: 'The shape comes from the photo; the size you type only sets the scale, and the other side follows' },
        f.estimated = h('input', { type: 'radio', name: group, checked: unmeasured, onchange: how }), 'Not measured')),
    h('label', { class: 'tick' }, f.shown = h('input', { type: 'checkbox', checked: d.size_shown ?? !unmeasured,
      onchange: () => { f.shownTouched = true; } }), 'Show the size to visitors'),
  ];
  f.height = f.hBox.querySelector('input'); f.width = f.wBox.querySelector('input'); f.year = f.yBox.querySelector('input');
  f.scaleBy = 'height'; f.shownTouched = d.size_shown != null;
  f.ratio = d.cm ? d.cm[1] / d.cm[0] : null;
  /* Not measured: work out the side not typed from the one that was. */
  f.follow = () => {
    if (!f.estimated.checked || !(f.ratio > 0)) return;
    const [from, to] = f.scaleBy === 'width' ? [f.width, f.height] : [f.height, f.width];
    const v = parseFloat(from.value);
    if (!(v > 0)) return;
    to.value = String(Math.round((f.scaleBy === 'width' ? v / f.ratio : v * f.ratio) * 10) / 10);
    to.classList.add('suggested'); from.classList.remove('suggested');
  };
  if (unmeasured && !isNew) f.width.classList.add('suggested');
  return out;
}
/* The fields' values, or an error message. */
function detailsOf(f) {
  const hgt = parseFloat(f.height.value), wid = parseFloat(f.width.value);
  if (!(hgt > 0) || !(wid > 0)) return { error: 'Give the height and width in centimetres' };
  return { medium: f.medium.value.trim(), cm: [Math.round(hgt * 10) / 10, Math.round(wid * 10) / 10], year: f.year.value.trim(),
    ...(f.estimated.checked ? { estimated: true } : {}), size_shown: f.shown.checked };
}

/* Forms are rebuilt whenever the page re-renders (after any save, e.g. adding a genre mid-way), so what has been
   typed into an open form is carried over from its previous copy: the add form's on its darkroom (dr.fields),
   each open Edit form's in editFields. */
const editFields = new Map();       // painting id -> its Edit form's fields, while open
let newGenre = null;                // a genre just added, for the add form to pick
function carry(from, to) {
  if (!from) return;
  for (const k of ['title', 'medium', 'height', 'width', 'year']) if (from[k] && to[k]) to[k].value = from[k].value;
  for (const k of ['measured', 'estimated', 'shown', 'wide']) if (from[k] && to[k]) to[k].checked = from[k].checked;
  for (const k of ['height', 'width']) if (from[k] && to[k]) to[k].classList.toggle('suggested', from[k].classList.contains('suggested'));
  for (const k of ['scaleBy', 'shownTouched', 'ratio']) if (k in from) to[k] = from[k];
  if (from.section && to.section && [...to.section.options].some((o) => o.value === from.section.value)) to.section.value = from.section.value;
}

/* For the editor's rows: the size when the details line doesn't say all there is to know about it. */
function sizeNote(d) {
  if (!d.cm) return null;
  const shown = d.size_shown ?? !d.estimated;
  if (shown) return null;                          // the details line has it ("about" when not measured)
  return h('span', { class: 'muted' }, ` (${d.estimated ? 'not measured' : 'measured'}: ${d.cm[0]} × ${d.cm[1]} cm${shown ? '' : ', hidden from visitors'})`);
}

function paintingRow(e, items, i, secs) {
  const d = current(e);
  const gone = e.draft == null;
  const row = h('div', { class: 'painting' + (gone ? ' deleted' : '') },
    h('img', { src: thumb(d), alt: '', loading: 'lazy' }),
    h('div', { class: 'what' }, h('span', { class: 't' }, d.title),
      h('span', { class: 'd' }, d.details || ' ', sizeNote(d))),
    badge(e),
    gone ? h('button', { onclick: () => discard([e.id]) }, 'Keep it')
      : h('span', { class: 'move' },
        h('button', { title: 'Move up', disabled: i === 0, onclick: () => movePainting(items, i, -1) }, '↑'),
        h('button', { title: 'Move down', disabled: i === items.length - 1, onclick: () => movePainting(items, i, 1) }, '↓'),
        h('button', { onclick: () => { if (open.has(e.id)) { open.delete(e.id); reopened.delete(e.id); } else open.add(e.id); render(); } }, open.has(e.id) ? 'Close' : 'Edit')));
  if (gone || !open.has(e.id)) { editFields.delete(e.id); return [row]; }

  const f = {};
  const form = h('div', { class: 'edit' },
    h('label', {}, 'Title'), f.title = h('input', { type: 'text', value: d.title }),
    ...detailsFields(f, d, () => { const re = reopened.get(e.id); if (re) re.dr.sizeChanged(); }),
    h('label', {}, 'Genre'), f.section = h('select', {}, ...secs.map((s) => h('option', { value: s.id, selected: s.id === d.section }, s.title))),
    h('label', { class: 'tick' }, f.wide = h('input', { type: 'checkbox', checked: d.wide }), 'Wide: spans the whole width of the list'),
    ...pictureFields(e, d, f),
    h('p', { class: 'hint' }, `Address: /paintings/${d.name}/ (stays the same if the title changes)`),
    h('div', { class: 'actions' },
      f.go = h('button', { class: 'main', onclick: async () => {
        const moved = f.section.value !== d.section, det = detailsOf(f);
        if (det.error) return toast(det.error, true);
        const { estimated, size_shown, ...rest } = d;    // put back from the form (detailsOf)
        const re = reopened.get(e.id);
        let pic = {};
        if (re && re.dr.changed()) {                     // new image sizes under a new file name; the old ones stay for History
          if (!re.dr.ready) return toast('The picture is still being made', true);
          f.go.disabled = true;
          try {
            const { file: stem } = await call('GET', `free?name=${encodeURIComponent(d.name)}`);
            let orig = re.dr.original;                   // a replaced photo becomes the original (if not already stored)
            if (re.dr.replacement) orig = (await keepOriginal(re.dr.replacement, d.name, null, (t) => re.dr.say(t))).key;
            pic = { ...(await storeImages(stem, re.dr.result(), (t) => re.dr.say(t))),
              white_paper: re.dr.white === 'paper', process: re.dr.record(orig) };
          } catch (err) { f.go.disabled = false; re.dr.say(''); return toast(err.message, true); }
        }
        const data = { ...rest, title: f.title.value, ...det, wide: f.wide.checked,
          section: f.section.value, order: moved ? paintingsIn(f.section.value).length : d.order, ...pic };
        open.delete(e.id); reopened.delete(e.id);
        save([{ id: e.id, kind: 'painting', data }], pic.file ? (re && re.dr.replacement ? 'Saved, with the new photo' : 'Saved, with the new picture') : undefined);
      } }, 'Save draft'),
      changed(e) ? h('button', { onclick: () => discard([e.id]) }, 'Undo changes') : null,
      h('button', { class: 'danger', onclick: () => { if (confirm(`Delete "${d.title}"? It stays on the site until you publish.`)) { open.delete(e.id); save([{ id: e.id, kind: 'painting', data: null }], 'Deleted in the draft'); } } }, 'Delete')));
  carry(editFields.get(e.id), f);
  editFields.set(e.id, f);
  return [row, form];
}

/* Reopening a painting's picture: its darkroom starts with the saved choices summarised, and opening a section
   reads the original back from R2 and starts from those choices (or, for paintings moved from git, which have
   none: the whole photo, with the paper's white balance if it's a drawing on white paper). */
const reopened = new Map();         // painting id -> { dr }, while its Edit form is open
const pictureOf = (d) => {          // the painting's current picture, at a size fit for comparing
  const w = d.widths.find((x) => x >= 1024) || d.widths[d.widths.length - 1];
  return `/${d.base}${d.file || d.name}-${w}.${d.ext}`;
};
function pictureFields(e, d, f) {
  if (!media) return [];
  let re = reopened.get(e.id);
  if (!re) {
    const white = d.white_paper ? 'paper' : 'none';
    re = { dr: darkroom({
      previous: pictureOf(d),
      saved: d.process || { white },
      start: d.process ? { process: d.process } : { white, guess: false },
      fetch: async () => {
        const key = d.process ? d.process.original : `originals/${d.file || d.name}`;
        const r = await fetchFor(`/admin/api/original?key=${encodeURIComponent(key)}`, {}, 120000);
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Couldn't fetch the original (${r.status})`);
        return { original: r.headers.get('x-original') || key, blob: await r.blob() };
      },
    }) };
    reopened.set(e.id, re);
  }
  re.dr.attach(f);
  return [h('label', {}, 'Picture'), re.dr.el];
}

function moveSection(secs, i, dir) {
  const list = secs.slice(); [list[i], list[i + dir]] = [list[i + dir], list[i]];
  save(list.map((s, n) => ({ ...s, order: n })).filter((s, n) => secs.find((x) => x.id === s.id).order !== n)
    .map(({ id, title, order }) => ({ id, kind: 'section', data: { title, order } })), 'Moved');
}
function movePainting(items, i, dir) {
  const list = items.filter((e) => e.draft != null);
  const a = list.indexOf(items[i]);
  let b = a + dir;
  if (b < 0 || b >= list.length) return;
  [list[a], list[b]] = [list[b], list[a]];
  const changes = [];
  list.forEach((e, n) => { const d = draftOf(e); if (d.order !== n) changes.push({ id: e.id, kind: 'painting', data: { ...d, order: n } }); });
  save(changes, 'Moved');
}
function addSection() {
  const title = (prompt('Name of the new genre') || '').trim();
  if (!title) return;
  const id = 's-' + Math.random().toString(36).slice(2, 10);
  newGenre = id;
  save([{ id, kind: 'section', data: { title, order: sections().length } }], `"${title}" added at the bottom`);
}
const discard = (ids) => act(() => call('POST', 'discard', { ids }), 'Back to the published version');

// ---- adding a painting: images are made in the browser and stored in R2 -------------------------------------

function slug(t) {
  return t.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ')
    .replace(/[#,.'’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
const taken = () => new Set(entries.filter((e) => e.kind === 'painting').map((e) => current(e).name));
function nameFor(title) {
  const base = slug(title) || 'painting', used = taken();
  let n = base, i = 2;
  while (used.has(n)) n = `${base}-${i++}`;
  return n;
}

/* The steps that make a painting's picture from a photo: white balance, then corners and shape, each a section
   that opens with a tap and shows a summary line while closed, under the photo and the result side by side. Used
   by the add form (sections open once a photo is chosen) and by a painting's Edit form (opts below), where the
   sections start closed with the saved choices summarised, and opening one fetches the original from R2. Then the
   photo is shown small, with the previous and the new results side by side, large; pressing and holding the new
   one shows the previous in its place. The saved choices stay in view as ghosts: a faint mark on each slider,
   faint corners and spots in the full-screen views, and "Back to saved". Its element is kept across re-renders
   of the page; the form it sits in gives it the details fields (height, width, measured or not) with attach().
   opts, for reopening: previous (address of the painting's current picture), saved (its choices, as summarised
   before the original is read), start (load()'s options for those choices) and fetch (resolves with the
   original's { blob, original key }).
   Reopening also offers "Replace photo…", for a better photo or a higher-resolution copy: if its proportions match
   the old original's (the same photo), the corners and white spots carry over (they're fractions of the photo);
   otherwise only the sliders are kept, the corners are guessed afresh and the spots cleared. It says which. The
   new photo is stored as an original when the painting is saved (replacement); "Back to saved" returns to the
   old photo and its choices. */
const fieldsetOf = (...kids) => h('fieldset', { class: 'step-body', disabled: true }, ...kids);
function whiteText(r) {
  const n = (r.spots || []).length;
  if (!r.white || r.white === 'none' || (r.white === 'picks' && !n)) return 'None: as photographed';
  const b = Math.round((r.brightness ?? 1) * 100), w = Math.round((r.warmth ?? 0) * 100);
  return (r.white === 'paper' ? 'Paper all round' : `From ${n} white ${n === 1 ? 'spot' : 'spots'}`)
    + (b !== 100 ? `, white at ${b}%` : '') + (w ? `, keeping ${w}% of the warmth` : '');
}
function cornersText(r) {
  const cropped = !!(r.corners && !wholePhoto(r.corners)), turned = r.corners ? describeTurn(turnOf(r.corners)) : '';
  return (cropped ? 'Cropped and squared up' : 'Whole photo') + (turned ? `, ${turned}` : '')
    + (cropped ? (r.shape ? `, to ${r.shape[0]} × ${r.shape[1]} cm` : ', shape from the photo') : '');
}
function darkroom(opts = {}) {
  const reopen = !!opts.fetch;
  const g = {};
  let F = {}, p = null, baseline = '', saved = null, startWith = {}, original = null, fetching = null;
  let replacement = null, oldBlob = null, ghost = null;     // ghost: the saved choices that still apply to the photo shown
  let timer;
  const later = (fn, ms = 500) => { clearTimeout(timer); timer = setTimeout(fn, ms); };
  const how = () => ({ brightness: +g.bright.value / 100, warmth: +g.warm.value / 100 });
  const slider = (input, ghost) => h('div', { class: 'slider' }, input, ghost);
  const step = (title, sum, body) => {
    const d = h('details', { class: 'step', ontoggle: () => { if (d.open) need(); } },
      h('summary', {}, h('span', { class: 'step-title' }, title), sum), body);
    return d;
  };
  const el = h('div', { class: 'dr-form' },
    g.compare = h('div', { class: 'compare', hidden: true, title: 'Tap to make bigger or smaller', onclick: () => g.compare.classList.toggle('big') }),
    g.steps = h('div', { class: 'steps', hidden: !reopen },
      g.whiteBox = step('White balance', g.whiteSum = h('span', { class: 'step-sum muted' }), g.whiteBody = fieldsetOf(
        h('div', { class: 'row' },
          h('span', { class: 'grow' }),
          h('button', { type: 'button', title: 'Place white spots round the margins of a drawing on white paper', onclick: () => findSpots() }, 'Find the paper'),
          g.spotsBtn = h('button', { type: 'button', onclick: () => pickSpots() }, 'Pick white…')),
        g.legacyNote = h('p', { class: 'hint', hidden: true }, 'Made with the older "paper all round" method. Finding the paper or picking white replaces it, and the picture may change slightly.'),
        g.sliders = h('div', { class: 'sliders' },
          h('label', {}, 'Brightness of the white ', g.brightOut = h('span', { class: 'muted' })),
          slider(g.bright = h('input', { type: 'range', min: 50, max: 100, step: 1, value: 100, oninput: () => slid() }),
            g.brightGhost = h('span', { class: 'ghost', hidden: true, title: 'As saved' })),
          h('label', {}, 'Keep the light\'s warmth ', g.warmOut = h('span', { class: 'muted' })),
          slider(g.warm = h('input', { type: 'range', min: 0, max: 100, step: 1, value: 0, oninput: () => slid() }),
            g.warmGhost = h('span', { class: 'ghost', hidden: true, title: 'As saved' }))))),
      g.cornerBox = step('Corners', g.cornerSum = h('span', { class: 'step-sum muted' }), g.cornerBody = fieldsetOf(
        h('div', { class: 'row' },
          g.cornersNote = h('span', { class: 'grow muted' }),
          h('button', { type: 'button', onclick: () => setCorners() }, 'Set corners…'),
          g.wholeBtn = h('button', { type: 'button', onclick: () => {
            if (!p) return;
            const t = turnOf(p.corners);                                  // keep which way up, take in the whole photo
            p.corners = t.r || t.m ? labelled(ordered(FRAME), t.r, t.m) : null; update();
          } }, 'Whole photo')),
        g.shapeRow = h('label', { class: 'tick' }, g.shape = h('input', { type: 'checkbox', checked: true, onchange: () => update() }),
          g.shapeTick = h('span', {})),
        g.shapeText = h('p', { class: 'hint shape-note' })))),
    h('div', { class: 'row dr-foot' },
      g.status = h('p', { class: 'hint grow' }),
      g.pickFile = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: () => replace(g.pickFile.files[0]) }),
      g.replaceBtn = h('button', { type: 'button', hidden: !reopen, title: 'Use a better photo, or a higher-resolution copy, of this painting', onclick: () => g.pickFile.click() }, 'Replace photo…'),
      g.back = h('button', { type: 'button', hidden: true, title: 'Put every choice back as it was saved (and the saved photo, if replaced)', onclick: () => backToSaved() }, 'Back to saved')),
    g.replaceNote = h('p', { class: 'hint stored-note' }));
  function slid() {
    g.brightOut.textContent = `${g.bright.value}%: ${+g.bright.value === 100 ? 'pure white' : 'a light grey'}`;
    g.warmOut.textContent = `${g.warm.value}%${+g.warm.value === 0 ? ': cast fully removed' : ''}`;
    later(update, 250);
  }
  slid(); clearTimeout(timer);

  /* The painting's picture as it is now (reopening), in a figure. */
  const previous = () => h('img', { class: 'shot', src: opts.previous, alt: '', draggable: false });
  if (reopen) {
    g.whiteSum.textContent = whiteText(opts.saved); g.cornerSum.textContent = cornersText(opts.saved);
    g.compare.hidden = false; g.compare.classList.add('one');
    g.compare.append(h('figure', {}, previous(), h('figcaption', {}, 'As it is now')));
  }

  /* Reopening: the first section opened fetches the original and reads it. */
  function need() {
    if (!reopen || p || fetching) return fetching;
    fetching = (async () => {
      g.status.textContent = 'Fetching the original…';
      try {
        const got = await opts.fetch();
        original = got.original; oldBlob = got.blob;
        if (!(await load(got.blob, opts.start))) throw new Error('This browser can\'t read the original');
      } catch (err) {
        g.status.textContent = ''; g.whiteBox.open = g.cornerBox.open = false; toast(err.message, true);
      } finally { fetching = null; }
    })();
    return fetching;
  }

  /* Replace the photo (see above). The old original is read first, if it hasn't been, to compare proportions. */
  async function replace(file) {
    g.pickFile.value = '';
    if (!file) return;
    g.replaceBtn.disabled = true;
    try {
      if (!p && !replacement) await need();
      const before = p ? { W: p.W, H: p.H, rec: record('') } : null;
      const was = before ? before.rec : (opts.start.process || { white: opts.saved.white });
      const sliders = was.white && was.white !== 'none' ? { brightness: was.brightness ?? 1, warmth: was.warmth ?? 0 } : {};
      let same = false;
      const ok = await load(file, (q) => {
        same = !!before && Math.abs(Math.log((q.W / q.H) / (before.W / before.H))) < 0.005;   // within half a per cent
        return same ? { process: was } : { ...sliders, guess: true };
      }, true);
      if (!ok) {                                           // unreadable: back to what was there
        if (oldBlob) { replacement = null; await load(oldBlob, opts.start); }
        return;
      }
      replacement = file;
      ghost = same ? saved : saved && { brightness: saved.brightness, warmth: saved.warmth };
      const had = (was.spots || []).length, hadCrop = !!(was.corners && !wholePhoto(was.corners));
      const kept = [hadCrop && 'the corners', had && 'the white spots', sliders.brightness != null && 'the sliders'].filter(Boolean);
      const and = (a) => a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}` : a[0];
      g.replaceNote.textContent = !before
        ? 'The old photo couldn\'t be read, so nothing was compared: the corners are a fresh guess.'
        : same
          ? `Same proportions as the old photo${kept.length ? `: kept ${and(kept)}` : ''}. It's stored when you save.`
          : `Different proportions from the old photo: ${sliders.brightness != null ? 'kept the sliders, ' : ''}guessed the corners afresh${had ? ' and cleared the white spots' : ''}. It's stored when you save.`;
      await update();
    } finally { g.replaceBtn.disabled = false; }
  }
  async function backToSaved() {
    if (!p) return;
    if (!replacement) { apply(startWith); update(); return; }
    if (!oldBlob) return;
    replacement = null; g.replaceNote.textContent = '';
    await load(oldBlob, opts.start);
  }

  /* Read a photo (a File, or the original's Blob from R2). With a process record, its choices are put back as
     they were; without one, it starts from the best guess at the painting's corners. */
  async function load(blob, start = {}, replacing = false) {
    p = null;
    if (!replacing) { baseline = ''; saved = null; ghost = null; replacement = null; g.replaceNote.textContent = ''; }
    if (!reopen) g.steps.hidden = true;
    g.status.textContent = 'Reading the photo…';
    const img = new Image();
    img.src = URL.createObjectURL(blob);
    try { await img.decode(); } catch {
      g.status.textContent = 'This browser can\'t read that photo. On a Mac, Chrome can\'t open HEIC: use Safari, or export it as JPEG.';
      return false;
    }
    const W = img.naturalWidth, H = img.naturalHeight, k = Math.min(1, SOURCE_MAX / Math.max(W, H));
    // One working copy, at most SOURCE_MAX pixels along its longer side: everything is made from it.
    p = { W, H, src: scaled(img, Math.round(W * k)), spots: [], corners: null, white: null, paper: false };
    URL.revokeObjectURL(img.src);
    p.guess = guessCorners(p.src);
    const choices = typeof start === 'function' ? start(p) : start;
    if (!replacing) startWith = choices;
    apply(choices);
    g.whiteBody.disabled = g.cornerBody.disabled = false;
    g.steps.hidden = false;
    if (!reopen) g.whiteBox.open = g.cornerBox.open = true;          // adding: both open
    await update();
    if (replacing) return true;                                      // the saved choices stay as they were
    baseline = JSON.stringify(record(''));
    if (reopen) { saved = ghost = JSON.parse(baseline); ghosts(); }
    g.back.hidden = true;
    return true;
  }
  /* Put the controls to the choices load() was given. */
  function apply({ process, white = 'none', guess = true, brightness = 1, warmth = 0 } = {}) {
    if (process) {
      p.paper = process.white === 'paper'; p.spots = process.white === 'picks' ? (process.spots || []).map((q) => q.slice()) : [];
      g.bright.value = Math.round((process.brightness ?? 1) * 100); g.warm.value = Math.round((process.warmth ?? 0) * 100);
      p.corners = process.corners ? process.corners.map((q) => q.slice()) : null;
      g.shape.checked = !!process.shape || !process.corners;      // as it was made
    } else {
      p.paper = white === 'paper'; p.spots = []; g.shape.checked = true;
      g.bright.value = Math.round(brightness * 100); g.warm.value = Math.round(warmth * 100);
      p.corners = guess && p.guess && !wholePhoto(p.guess) ? p.guess : null;   // a new photo: start from the guess
    }
    slid(); clearTimeout(timer);
  }
  /* Faint marks on the sliders where the saved choices have them (the range's thumb is about 16 pixels wide). */
  function ghosts() {
    const mark = (ghost, input, v) => {
      const f = (v - +input.min) / (+input.max - +input.min);
      ghost.style.left = `calc(8px + (100% - 16px) * ${f})`; ghost.hidden = false;
    };
    mark(g.brightGhost, g.bright, Math.round((saved.brightness ?? 1) * 100));
    mark(g.warmGhost, g.warm, Math.round((saved.warmth ?? 0) * 100));
  }

  async function pickSpots() {
    if (!p) return;
    const r = await fullView(p.src, 'spots', p.spots, null, ghost && ghost.spots, () => findPaper(p.src, p.corners));
    if (r) { p.spots = r; p.paper = false; }          // done: the spots decide (none = no white balance)
    update();
  }
  /* Spots round the painting's margins, for a drawing on white paper (darkroom.js findPaper). */
  function findSpots() {
    if (!p) return;
    p.spots = findPaper(p.src, p.corners); p.paper = false;
    update();
  }
  /* The white balance follows from the spots: none without any. 'paper' only for an older record made with
     "paper all round", until spots replace it. */
  const white = () => (p && p.spots.length ? 'picks' : p && p.paper ? 'paper' : 'none');
  async function setCorners() {
    if (!p) return;
    await busy('Getting the full-size view ready…');
    const r = await fullView(balanced().canvas, 'corners', p.corners, p.guess, ghost && ghost.corners);
    if (r) {
      const t = turnOf(r);
      p.corners = wholePhoto(r) && !t.r && !t.m ? null : r;          // the whole photo, as it is: nothing to do
    }
    update();
  }
  function balanced() {
    const key = `${white()}|${JSON.stringify(p.spots)}|${g.bright.value}|${g.warm.value}`;
    if (!p.white || p.white.key !== key) p.white = { key, ...whiteBalanced(p.src, white(), p.spots, how()) };
    return p.white;
  }
  const cropped = () => !!(p && p.corners && !wholePhoto(p.corners));
  /* The shape the picture is squared up to: the measured size's (if measured and ticked: the tick shows only when
     measured), or none, when the photo's perspective decides. The size is kept to a tenth of a centimetre, so a
     10 x 5.5 painting is squared up as 10 x 5.5, never rounded to whole centimetres. */
  function shapeLine() {
    const det = F.height ? detailsOf(F) : { error: 1 }, size = det.error ? null : det.cm;
    const measured = !!(F.estimated && !F.estimated.checked && size);
    g.shapeRow.hidden = !(p && cropped() && measured);
    if (measured) g.shapeTick.textContent = `Square up to its measured proportions, ${size[0]} × ${size[1]} centimetres`;
    const use = measured && g.shape.checked && cropped();
    g.shapeText.textContent = !p || !cropped() || use ? '' : 'Shape: from the photo\'s perspective';
    return use ? size : null;
  }
  const busy = (text) => { g.status.textContent = text; return new Promise((ok) => requestAnimationFrame(() => setTimeout(ok, 30))); };

  /* Pressing and holding the new result shows the previous one in its place (a blink comparison); a short tap
     still makes the pictures bigger or smaller. */
  function holdable(shot) {
    const NEW = 'New: press and hold to see the previous', cap = h('figcaption', {}, NEW);
    const over = h('img', { class: 'over', src: opts.previous, alt: '', draggable: false, hidden: true });
    const wrap = h('div', { class: 'hold', title: 'Press and hold to see the previous picture here' }, shot, over);
    let t = null, held = false;
    wrap.addEventListener('pointerdown', () => {
      held = false; clearTimeout(t);
      t = setTimeout(() => { held = true; over.hidden = false; cap.textContent = 'Previous: let go to see the new one'; }, 180);
    });
    const end = () => { clearTimeout(t); over.hidden = true; cap.textContent = NEW; };
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) wrap.addEventListener(ev, end);
    wrap.addEventListener('click', (e) => { if (held) { e.stopPropagation(); held = false; } });   // a hold isn't a tap
    wrap.addEventListener('contextmenu', (e) => e.preventDefault());
    return h('figure', {}, wrap, cap);
  }

  /* Make the picture that will be uploaded from the choices, and show it beside the photo. */
  async function update() {
    if (!p) return;
    g.sliders.hidden = white() === 'none';
    g.legacyNote.hidden = white() !== 'paper';
    g.spotsBtn.textContent = p.spots.length ? `Change white (${p.spots.length} ${p.spots.length === 1 ? 'spot' : 'spots'})…` : 'Pick white…';
    g.wholeBtn.hidden = !cropped();
    const turned = p.corners ? describeTurn(turnOf(p.corners)) : '';
    g.cornersNote.textContent = (cropped() ? 'Cropped and squared up' : 'Whole photo') + (turned ? `, ${turned}` : '');
    // The picture's proportions as the photo has them (after cropping and turning): when the size isn't measured,
    // the side not typed follows them (F.follow, in detailsFields).
    if (F.follow) {
      let ratio = p.W / p.H;
      if (p.corners) { const [a, b] = cropSize(p.corners.map(([u, v]) => [u * p.W, v * p.H]), null, [p.W / 2, p.H / 2]); ratio = a / b; }
      F.ratio = ratio; F.follow();
    }
    const shape = shapeLine();
    const now = record('');
    g.whiteSum.textContent = whiteText(now); g.cornerSum.textContent = cornersText(now);
    g.back.hidden = replacement ? !oldBlob : !saved || JSON.stringify(now) === baseline;
    await busy('Working…');
    const { canvas: wb, note } = balanced();
    let out, W = p.W, H = p.H;
    if (p.corners) {
      const q = p.corners.map(([u, v]) => [u * wb.width, v * wb.height]);
      const [cw, chh] = cropSize(q, shape, [wb.width / 2, wb.height / 2]), k = wb.width / p.W;      // k: working copy's pixels per original pixel
      W = Math.round(cw / k); H = Math.round(chh / k);                 // the cropped picture at the original's resolution
      const ow = Math.min(W, WIDTHS[WIDTHS.length - 1]);
      out = squaredUp(wb, q, ow, Math.max(1, Math.round(H * ow / W)));
    } else {
      out = scaled(wb, Math.min(W, WIDTHS[WIDTHS.length - 1]));
    }
    Object.assign(p, { out, outW: W, outH: H });
    const shot = (c, quad) => {
      const s = scaled(c, Math.min(c.width, reopen ? 1200 : 800)); s.className = 'shot';
      if (quad) {                                                    // the corners, outlined on the photo
        const x = s.getContext('2d'), q = quad.map(([u, v]) => [u * s.width, v * s.height]);
        x.beginPath(); x.moveTo(...q[0]); q.slice(1).forEach((pt) => x.lineTo(...pt)); x.closePath();
        x.lineWidth = Math.max(2, s.width / 300); x.strokeStyle = 'rgba(0,0,0,0.6)'; x.stroke();
        x.lineWidth /= 2; x.strokeStyle = '#fff'; x.stroke();
        x.beginPath(); x.moveTo(...q[3]); x.lineTo(...q[2]); x.lineWidth *= 2; x.strokeStyle = '#f5c66b'; x.stroke();   // the bottom
      }
      return s;
    };
    g.compare.hidden = false; g.compare.classList.remove('one');
    if (reopen) {
      g.compare.classList.add('reopen');
      g.compare.replaceChildren(h('figure', { class: 'photo' }, shot(p.src, p.corners), h('figcaption', {}, 'Photo')),
        h('figure', {}, previous(), h('figcaption', {}, 'Previous')), holdable(shot(out)));
    } else {
      g.compare.replaceChildren(h('figure', {}, shot(p.src, p.corners), h('figcaption', {}, 'Before')),
        h('figure', {}, shot(out), h('figcaption', {}, 'After: this is what will be used')));
    }
    g.status.textContent = `${W} × ${H} pixels.${note ? ' ' + note : ''}`;
  }

  /* The choices, as saved with the painting (editor.js processOf on the server). */
  function record(original) {
    const shape = shapeLine();
    const w = white();
    return { original, white: w,
      ...(w === 'picks' ? { spots: p.spots } : {}),
      ...(w !== 'none' ? how() : {}),
      ...(p.corners ? { corners: p.corners } : {}), ...(shape ? { shape } : {}) };
  }
  return {
    el, load, record, shapeLine,
    attach(f) { F = f; },
    sizeChanged() { if (p) later(update); else shapeLine(); },
    get ready() { return !!(p && p.out); },
    get white() { return white(); },
    get original() { return original; },
    get replacement() { return replacement; },        // a new photo, to be stored as the original on saving
    result() { return { out: p.out, W: p.outW, H: p.outH }; },
    changed() { return !!p && (!!replacement || JSON.stringify(record('')) !== baseline); },   // since it was loaded
    say(text) { g.status.textContent = text; },
  };
}

/* Make every size of a painting's picture from the result and store them in R2 as images/<stem>-<width>.jpg and
   -preview.jpg; returns the painting's image fields. Never overwrites: stem is a free name (GET free). */
async function storeImages(stem, { out, W, H }, say) {
  const base = 'media/images/';
  const widths = [...new Set(WIDTHS.filter((w) => w < W).concat(Math.min(W, WIDTHS[WIDTHS.length - 1])))];
  const jobs = widths.map((w) => [`${stem}-${w}.jpg`, w]).concat([[`${stem}-preview.jpg`, Math.min(PREVIEW, W)]]);
  let done = 0;
  for (const [fname, w] of jobs) {
    say(`Making and uploading image sizes: ${++done} of ${jobs.length}`);
    await put(`images/${fname}`, await resized(out, Math.min(w, out.width)), 'image/jpeg');
  }
  return { w: W, h: H, widths, base, ext: 'jpg', file: stem,
    preview: { src: `${base}${stem}-preview.jpg`, w: Math.min(PREVIEW, W), h: Math.round(H * Math.min(PREVIEW, W) / W) } };
}

let adding = null;   // the add form's darkroom, kept while the page re-renders
function addForm(secs) {
  if (!media) {
    return h('p', { class: 'hint' }, 'Adding paintings needs image storage (R2), which isn\'t switched on yet for this site. Everything else here works.');
  }
  const f = {};
  const dr = adding || (adding = darkroom());
  const form = h('div', { class: 'card' },
    h('label', {}, 'Photo of the painting'), f.file = h('input', { type: 'file', accept: 'image/*', onchange: pick }),
    dr.note || (dr.note = h('p', { class: 'hint stored-note' })),
    dr.el,
    h('label', {}, 'Title'), f.title = h('input', { type: 'text', autocomplete: 'off' }),
    ...detailsFields(f, {}, () => dr.sizeChanged()),
    h('label', {}, 'Genre'), f.section = h('select', {}, ...secs.map((s) => h('option', { value: s.id }, s.title))),
    h('label', { class: 'tick' }, f.wide = h('input', { type: 'checkbox' }), 'Wide'),
    h('div', { class: 'actions' }, f.go = h('button', { class: 'main', onclick: add }, 'Add as a draft')),
    f.progress = h('div', { id: 'upload-progress' }));
  carry(dr.fields, f);
  dr.fields = f;
  if (newGenre && [...f.section.options].some((o) => o.value === newGenre)) { f.section.value = newGenre; newGenre = null; }
  if (dr.file) {                                     // show the chosen photo's name again (add() uses dr.file)
    try { const t = new DataTransfer(); t.items.add(dr.file); f.file.files = t.files; } catch { /* older browsers */ }
  }
  dr.attach(f);

  async function pick() {
    const file = dr.file = f.file.files[0] || null;
    dr.known = null; dr.note.textContent = '';
    if (!file) return;
    if (!f.title.value) f.title.value = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
    lookUp(file);                                    // alongside preparing the picture
    await dr.load(file);
  }

  /* Say straight away whether this photo is already stored (and for which paintings), so it won't be uploaded
     again; add() reuses the answer. */
  async function lookUp(file) {
    dr.note.textContent = 'Checking whether this photo is already stored…';
    try {
      const known = await storedFor(file);
      if (dr.file !== file) return;                  // another photo was chosen meanwhile
      dr.known = known;
      if (!known.key) { dr.note.textContent = 'A new photo: it will be uploaded when you add the painting.'; return; }
      const users = entries.filter((e) => e.kind === 'painting' && current(e) && current(e).process
        && current(e).process.original === known.key).map((e) => `"${current(e).title}"`);
      dr.note.textContent = `Already stored${users.length ? ` (used by ${users.join(', ')})` : ''}: it won't be uploaded again.`;
    } catch { if (dr.file === file) dr.note.textContent = ''; }   // add() checks again
  }

  async function add() {
    const file = dr.file;
    if (!file || !dr.ready) return toast('Choose a photo first', true);
    const title = f.title.value.trim();
    if (!title) return toast('Give it a title', true);
    if (!f.section.value) return toast('Add a genre first', true);
    const det = detailsOf(f);
    if (det.error) return toast(det.error, true);
    f.go.disabled = true;
    try {
      const name = nameFor(title);
      const { file: stem } = await call('GET', `free?name=${encodeURIComponent(name)}`);
      const { key: original, shared } = await keepOriginal(file, name, dr.known && dr.known.file === file ? dr.known : null, (t) => { f.progress.textContent = t; });
      const pic = await storeImages(stem, dr.result(), (t) => { f.progress.textContent = t; });
      const data = { name, title, ...det, section: f.section.value, order: paintingsIn(f.section.value).length, wide: f.wide.checked,
        white_paper: dr.white === 'paper', ...pic, process: dr.record(original) };
      await call('POST', 'save', { items: [{ id: `p-${name}`, kind: 'painting', data }] });
      try { localStorage.setItem('editor-medium', det.medium); localStorage.setItem('editor-height', String(det.cm[0])); } catch { /* private browsing */ }
      adding = null;                                 // a fresh form, and a fresh note
      toast(`"${title}" added as a draft${shared ? ', sharing a photo already stored' : ''}`);
      render();
    } catch (e) {
      toast(e.message, true); f.progress.textContent = '';
    } finally { f.go.disabled = false; }
  }
  return form;
}

async function put(key, blob, type, ms = 120000) {
  const r = await fetchFor(`/admin/api/upload?key=${encodeURIComponent(key)}`, { method: 'PUT', headers: { 'content-type': type }, body: blob }, ms);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Upload failed (${r.status})`);
  return r.json();
}

/* Store a photo as an original, named by its content (originals/<hash>-<name>.<ext>, see stored() in editor.js):
   if the same photo is already stored, for this painting or another, it isn't uploaded again and that one is
   used. known: storedFor's answer, if already asked. Returns the original's key (for the painting's process
   record) and whether it was already stored. */
async function storedFor(file) {
  const hex = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  const hash = hex.slice(0, 12);
  const { key } = await call('GET', `stored?hash=${hash}`);
  return { file, hash, key };
}
async function keepOriginal(file, name, known, say) {
  if (!known) { say('Checking whether this photo is already stored…'); known = await storedFor(file); }
  const { hash, key: have } = known;
  if (have) return { key: have, shared: true };
  const ext = (file.name.match(/\.([a-z0-9]+)$/i) || [0, 'jpg'])[1].toLowerCase().replace(/^jpeg$/, 'jpg');
  say('Keeping the original…');
  const r = await put(`originals/${hash}-${name.slice(0, 96)}.${ext}`, file, file.type || 'image/jpeg');
  return { key: r.key, shared: !!r.existed };
}

// ---- review and publish ------------------------------------------------------------------------------------

const ticked = new Set();
let ticksFor = '';

const FIELDS = { type: 'Kind', versions: 'Versions', play: 'Plays', calm: 'For reduced motion', file: 'Files', focus: 'Kept in view', shade: 'Shade', title: 'Title', medium: 'Medium', cm: 'Size', year: 'Year', estimated: 'Not measured', size_shown: 'Size shown', section: 'Genre', order: 'Position', wide: 'Wide', white_paper: 'White paper', text: 'Text' };
function diffs(e) {
  const a = liveOf(e), b = draftOf(e);
  if (!a || !b) return [];
  if (e.kind === 'links') {
    const show = (v) => (!v || !v.name ? '(none)' : `${v.name}${v.on ? '' : ' (not shown)'}`);
    return SITES.filter((s) => JSON.stringify(a[s.key]) !== JSON.stringify(b[s.key])).map((s) =>
      h('div', {}, h('b', {}, `${s.name}: `), h('del', {}, show(a[s.key])), ' → ', h('ins', {}, show(b[s.key]))));
  }
  const show = (k, v) => (v == null || v === '' ? '(none)' : k === 'section' ? ((byId(v) && current(byId(v)).title) || v)
    : k === 'cm' ? `${v[0]} × ${v[1]} cm` : k === 'focus' ? `${Math.round(v[0] * 100)}% across, ${Math.round(v[1] * 100)}% down`
    : k === 'shade' ? `${Math.round(v * 100)}%` : k === 'versions' ? v.map((x) => `${x.w} × ${x.h}`).join(', ') : typeof v === 'boolean' ? (v ? 'yes' : 'no') : k === 'order' ? `${v + 1}` : String(v));
  // the details line is made from medium, size and year, so it isn't listed as a change of its own
  return Object.keys(b).filter((k) => !(k === 'details' && 'cm' in b) && JSON.stringify(a[k]) !== JSON.stringify(b[k])).map((k) =>
    h('div', {}, h('b', {}, `${FIELDS[k] || k}: `), h('del', {}, show(k, a[k])), ' → ', h('ins', {}, show(k, b[k]))));
}

function reviewView() {
  const list = entries.filter(changed).sort((a, b) => (a.draft_at || '').localeCompare(b.draft_at || ''));
  const key = list.map((e) => e.id + e.draft_at).join();
  if (key !== ticksFor) { ticked.clear(); list.forEach((e) => ticked.add(e.id)); ticksFor = key; }
  const out = [h('h1', {}, 'Review and publish'),
    h('p', { class: 'hint' }, 'Everything below is saved as a draft and visible in the preview, but not yet to visitors. Untick anything you want to hold back.')];
  if (!list.length) return out.concat(h('p', {}, 'Everything is published.'));
  for (const e of list) {
    const box = h('input', { type: 'checkbox', checked: ticked.has(e.id), onchange: (ev) => { ev.target.checked ? ticked.add(e.id) : ticked.delete(e.id); render(); } });
    out.push(h('div', { class: 'card' },
      h('label', { class: 'change' }, box, h('span', {}, label(e), ' ', badge(e),
        h('span', { class: 'muted' }, e.draft_by ? `  ${e.draft_by}` : ''))),
      h('div', { class: 'diff' }, ...diffs(e))));
  }
  const note = h('input', { type: 'text', placeholder: 'A note for the history (optional)' });
  const n = list.filter((e) => ticked.has(e.id)).length;
  out.push(h('label', {}, 'Note'), note,
    h('div', { class: 'actions' },
      h('button', { class: 'main', disabled: !n, onclick: () => publish([...ticked], note.value) }, `Publish ticked (${n})`),
      h('button', { onclick: () => publish(null, note.value) }, `Publish all (${list.length})`),
      h('button', { class: 'danger', disabled: !n, onclick: () => { if (confirm(`Discard ${n} change${n === 1 ? '' : 's'}? They go back to what visitors see now.`)) discard([...ticked]); } }, 'Discard ticked')));
  return out;
}

function publish(ids, note) {
  act(() => call('POST', 'publish', { ids, note }), (out) => {
    const extra = out.added.length ? ` (with ${out.added.map((id) => label(byId(id) || { id, kind: '' })).join(', ')}, which ${out.added.length === 1 ? 'it needs' : 'they need'})` : '';
    return `Published ${out.published.length} change${out.published.length === 1 ? '' : 's'}${extra}`;
  });
}

// ---- history -----------------------------------------------------------------------------------------------

let historyData = null;
function historyView() {
  if (!historyData) {
    call('GET', 'history').then((d) => { historyData = d; render(); }).catch((e) => toast(e.message, true));
    return [h('h1', {}, 'History'), h('p', { class: 'muted' }, 'Loading…')];
  }
  const out = [h('h1', {}, 'History'),
    h('p', { class: 'hint' }, 'Each time something was published. "Bring back" puts that version into the draft; publish it to make it live again.')];
  for (const r of historyData.releases) {
    const when = new Date(r.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    out.push(h('div', { class: 'card' },
      h('div', {}, h('b', {}, when), h('span', { class: 'muted' }, `  ${r.by || ''}`)),
      r.note ? h('div', { class: 'muted' }, r.note) : null,
      ...r.revisions.map((v) => {
        const d = parse(v.data), p = parse(v.previous);
        const what = d || p || {};
        const name = v.kind === 'painting' ? what.title : v.kind === 'section' ? `Genre: ${what.title}` : label({ id: v.entry_id, kind: v.kind, draft: v.data, published: v.previous });
        const kind = !p ? 'new' : !d ? 'gone' : 'changed';
        const mine = byId(v.entry_id);
        const same = mine && mine.draft === v.data;
        return h('div', { class: 'row', style: 'margin-top:0.4rem' },
          h('span', { class: 'grow' }, name, ' ', h('span', { class: `badge ${kind}` }, kind === 'new' ? 'Added' : kind === 'gone' ? 'Deleted' : 'Changed')),
          same ? h('span', { class: 'muted' }, 'as now') : h('button', { onclick: () => act(() => call('POST', 'restore', { revision: v.id }), 'Brought back as a draft') }, 'Bring back'));
      })));
  }
  return out;
}

// ---- the library -------------------------------------------------------------------------------------------

/* Every file in storage (library.js on the server), as Site pictures and Paintings: each thing uploaded with what
   uses it. The name is the library's own (the stored files keep theirs for good), saved as soon as it's changed,
   with a tick to say so. Delete for good only when no draft or published page uses it. */
let libraryData = null;
const glyph = (d, size = 18) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 20 20'); svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '1.5'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
  svg.append(p);
  return svg;
};
const GLYPHS = {
  bin: 'M3.5 5.5h13M8 5.5V3.5h4v2M5 5.5l1 11h8l1-11M8.5 8.5v5.5M11.5 8.5v5.5',
  tick: 'M4 10.5l4 4L16 6',
  play: 'M7 5v10l8-5z',
  photo: 'M3 4.5h14v11H3zM3 13l4-4 3.5 3.5L13 10l4 4M13 7.5h.01',
  live: 'M10 6.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',                                // published
  draft: 'M4 16l1-4 8-8 3 3-8 8zM11.5 5.5l3 3',                                        // a pencil: in a draft
  past: 'M3.5 10a6.5 6.5 0 1 0 2-4.7M3.5 3.5v3h3M10 6.5V10l2.5 1.5',                    // a clock turning back: History
};
const STATES = { published: ['live', 'On the site'], draft: ['draft', 'In a draft'], history: ['past', 'Only in History'] };

function libraryView() {
  if (!libraryData) {
    call('GET', 'library').then((d) => { libraryData = d; render(); }).catch((e) => toast(e.message, true));
    return [h('h1', {}, 'Library'), h('p', { class: 'muted' }, 'Loading…')];
  }
  const out = [h('h1', {}, 'Library')];
  const groups = [['site', 'Site pictures'], ['painting', 'Paintings']];
  for (const [grp, title] of groups) {
    const items = libraryData.items.filter((it) => it.grp === grp).sort((a, b) => b.added.localeCompare(a.added));
    const total = items.reduce((s, it) => s + it.bytes, 0);
    out.push(h('h2', {}, title, h('span', { class: 'muted', style: 'font-size:0.85rem' }, `  ${items.length} · ${MB(total)}`)));
    if (items.length) out.push(h('div', { class: 'card' }, ...items.map(libraryRow)));
  }
  return out;
}

function libraryRow(it) {
  // what uses it: one mark per thing using it, its strongest state (on the site, in a draft, or only in History)
  const by = new Map();
  for (const u of it.uses) {
    const rank = { published: 0, draft: 1, history: 2 }[u.state];
    const key = u.entry;
    if (!by.has(key) || rank < by.get(key).rank) by.set(key, { label: u.label, state: u.state, rank });
  }
  const uses = [...by.values()].sort((a, b) => a.rank - b.rank);
  const live = uses.filter((u) => u.state !== 'history');
  const pastOnly = !live.length && uses.length > 0;
  const pic = it.thumb
    ? h('img', { src: `/media/${it.thumb}`, alt: '', loading: 'lazy' })
    : h('span', { class: 'lib-none', title: 'No picture to show' }, glyph(GLYPHS.photo, 28));
  const saved = h('span', { class: 'lib-saved', title: 'Name saved', hidden: true }, glyph(GLYPHS.tick));
  const name = h('input', { type: 'text', class: 'lib-name', value: it.name, maxLength: 120, 'aria-label': 'Name',
    onkeydown: (ev) => { if (ev.key === 'Enter') ev.target.blur(); },
    onchange: async (ev) => {
      const v = ev.target.value.trim();
      if (!v) { ev.target.value = it.name; return; }
      try { await call('POST', 'library/name', { id: it.id, name: v }); it.name = v; saved.hidden = false; }
      catch (e) { toast(e.message, true); ev.target.value = it.name; }
    } });
  const bin = h('button', { class: 'lib-bin danger', disabled: live.length > 0,
    title: live.length ? `In use: ${live.map((u) => u.label).join(', ')}` : 'Delete for good',
    'aria-label': 'Delete for good', onclick: () => deleteForGood(it, pastOnly) }, glyph(GLYPHS.bin));
  return h('div', { class: 'painting lib-item' },
    h('span', { class: 'lib-pic' }, pic, it.kind === 'video' ? h('span', { class: 'lib-video', title: 'Video' }, glyph(GLYPHS.play, 14)) : null),
    h('div', { class: 'what' },
      h('div', { class: 'row lib-top' }, name, saved),
      h('span', { class: 'd' },
        // the thing using it is named only when it isn't what the item is called (a painting's photo is named after it)
        uses.length ? uses.map((u) => h('span', { class: `lib-use ${u.state}`, title: u.label === it.name ? STATES[u.state][1] : `${u.label}: ${STATES[u.state][1].toLowerCase()}` },
          glyph(GLYPHS[STATES[u.state][0]], 13), u.label === it.name ? null : u.label))
          : h('span', { class: 'badge gone', title: 'Nothing uses it' }, 'Unused'),
        h('span', { class: 'lib-size', title: `${it.files.length} file${it.files.length === 1 ? '' : 's'}` }, MB(it.bytes)))),
    bin);
}

function deleteForGood(it, pastOnly) {
  const n = it.files.length;
  const versions = new Set(it.uses.map((u) => u.revision)).size;
  const sure = pastOnly
    ? `Delete "${it.name}" for good?\n\nIts ${n} file${n === 1 ? '' : 's'} (${MB(it.bytes)}) go from storage, and the ${versions} version${versions === 1 ? '' : 's'} in History that use it go from History. This can't be undone.`
    : `Delete "${it.name}" for good?\n\nIts ${n} file${n === 1 ? '' : 's'} (${MB(it.bytes)}) go from storage. This can't be undone.`;
  if (!confirm(sure)) return;
  act(async () => {
    const out = await call('POST', 'library/delete', { id: it.id, history: pastOnly });
    libraryData.items = libraryData.items.filter((x) => x.id !== it.id);
    historyData = null;
    return out;
  }, (out) => `Deleted for good${out.purged === 'this data centre only' ? ' (cached copies elsewhere may linger)' : ''}`);
}

// ---- start -------------------------------------------------------------------------------------------------

call('GET', 'state').then((d) => { media = d.media; who = d.who; render(); })
  .catch((e) => { $('#main').replaceChildren(h('p', {}, `Couldn't load the content: ${e.message}`)); });
