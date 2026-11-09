/* The editor page (admin/index.html). Its views:
     #gallery  add a painting (at the top), and change the genres and paintings
     #content  change the page's words, section by section.
   One saving rule (step 1d): every change saves itself as a draft at once, everywhere (paintings too: there is no
   Save button), and a tick on the right of what was changed says so (mark(), below). Nothing reaches visitors
   until it's published under Review; the preview (the site at this address) shows drafts in place.
   Three distinct ways to take something away: Hide (off the site, kept here: an eye), Remove (out of the page;
   its photo stays in the Library), and Delete for good (in the Library, only when nothing uses it).
     #library  every file in storage (Site pictures, Paintings): what uses each, its name, Delete for good
     #review   every unpublished change, each with a tick: publish the ticked ones, or all, or discard them.
     #history  each publication, and every earlier version of anything, which can be brought back as a draft.
   It talks to editor.js on the server through /admin/api/. Page elements are built with textContent, never
   from strings of HTML, so nothing typed in can become part of the page. */

import { SITES, tidy, ok, icon } from '/links.js';
import { paintingAt, photoAt, framesFor, upright } from '/paths.js';
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
/* A video's first and last frames (paths.js: once per shape): shown while it loads, where it rests, and to
   visitors who ask for reduced motion. Up to 2560 across and a little more compressed than photos: the video
   itself takes over on larger screens, and a painted frame at 3840 was 3 to 4 megabytes. */
const FRAME_WIDTHS = [768, 1024, 1536, 2560], FRAME_QUALITY = 0.8;

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
/* Saving a draft. Saves run one after another (a queue), so two never cross and the later always wins. items: the
   entries, or a function giving them when their turn comes (so they're built from the latest state; null to skip).
   key: what was changed (the data-k of its field or button): it gets a tick instead of a message. Resolves with
   the server's answer, or undefined if it failed (the message says why). */
let queue = Promise.resolve(), saving = 0;
function save(items, msg = 'Saved as a draft', key) {
  saving++;
  const job = queue.then(() => act(async () => {
    const list = typeof items === 'function' ? items() : items;
    if (!list || !list.length) return null;
    const out = await call('POST', 'save', { items: list });
    if (key) marks.set(key, [Date.now(), SAVED]);
    return out;
  }, key ? null : msg)).finally(() => { saving--; });
  queue = job;
  return job;
}
window.addEventListener('beforeunload', (ev) => { if (saving) { ev.preventDefault(); ev.returnValue = ''; } });

/* The saved tick: on the right of a text field, or just after anything else (a tick box, a choice, a button),
   for a few seconds after it saved, with a tooltip; plainly not a button. Marks survive re-renders (render()
   puts each back on the element with that data-k, part-way through its fade). */
const marks = new Map(), MARK_MS = 3500, SAVED = 'Saved as a draft: visitors see it once it\'s published (Review)';
function placeMarks() {
  const now = Date.now();
  for (const [key, [at, tip]] of marks) {
    const age = now - at;
    if (age > MARK_MS) { marks.delete(key); continue; }
    const el = document.querySelector(`[data-k="${CSS.escape(key)}"]`);
    if (!el) continue;
    const delay = `-${age}ms`;
    if (el.matches('input[type=text], input[type=number], input[type=email], input:not([type]), textarea')) {
      el.classList.add('saved'); el.style.animationDelay = delay;
      el.title = tip;
      setTimeout(() => { el.classList.remove('saved'); el.removeAttribute('title'); }, MARK_MS - age);
    } else {
      const t = h('span', { class: 'mark', title: tip, style: `animation-delay: ${delay}` }, glyph(GLYPHS.tick, 16));
      if (el.tagName === 'LABEL') el.append(t); else (el.closest('label') || el).after(t);
      setTimeout(() => t.remove(), MARK_MS - age);
    }
  }
}

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
/* A change that only hides or shows something again is called that, not just "Changed". */
const unhidden = (v) => { const o = JSON.parse(v); delete o.hidden; return JSON.stringify(o); };
const status = (e) => (!changed(e) ? null : e.published == null ? 'new' : e.draft == null ? 'gone'
  : unhidden(e.draft) === unhidden(e.published) ? (draftOf(e).hidden ? 'hiding' : 'showing') : 'changed');
const STATUS = { new: 'New', changed: 'Changed', gone: 'Removed', hiding: 'Hidden', showing: 'Shown again' };
/* Hidden: what visitors see (hiding acts at once, slice 4b); a draft that hides (left from before 4b) counts too. */
const isHidden = (e) => !!(e && ((e.published && liveOf(e).hidden) || (e.draft && draftOf(e).hidden)));
/* Hide or show again, at once (an eye: open while on the site, closed while hidden): the opposite of Publish, so it
   takes effect straight away, as a release in History, and other waiting changes stay waiting. Nothing to hide on a
   thing never published, so no eye there. */
function hideButton(e, what) {
  if (!e || e.published == null) return null;
  const hid = isHidden(e), key = `${e.id}:hide`;
  return h('button', { class: 'eye' + (hid ? ' off' : ''), 'data-k': key, 'aria-pressed': String(hid),
    title: hid ? `Hidden from visitors: tap to show ${what} again, straight away` : `On the site: tap to hide ${what} straight away (it stays here)`,
    'aria-label': hid ? `Show ${what} again` : `Hide ${what}`,
    onclick: () => hideNow(e.id, !hid, key) }, glyph(hid ? GLYPHS.hidden : GLYPHS.eye));
}
function hideNow(id, hidden, key) {
  saving++;
  const job = queue.then(() => act(async () => {
    const out = await call('POST', 'hide', { id, hidden });
    marks.set(key, [Date.now(), hidden ? 'Hidden: off the site now (History can bring it back)' : 'Shown again: on the site now']);
    historyData = null;
    return out;
  })).finally(() => { saving--; });
  queue = job;
  return job;
}
const badge = (e) => { const s = status(e); return s ? h('span', { class: `badge ${s}` }, STATUS[s]) : null; };
const current = (e) => draftOf(e) || liveOf(e);
const sections = () => entries.filter((e) => e.kind === 'section' && e.draft != null)
  .map((e) => ({ id: e.id, ...draftOf(e) })).sort((a, b) => a.order - b.order);
const paintingsIn = (sid) => entries.filter((e) => e.kind === 'painting' && current(e).section === sid)
  .sort((a, b) => current(a).order - current(b).order);
const thumb = (d) => `/${paintingAt(d, d.widths[0])}`;
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
  // The field being typed in (marked data-k) keeps its focus, caret and text across the re-render.
  const a = document.activeElement, k = a && a.dataset && a.dataset.k;
  const typed = k && 'value' in a && a.type !== 'checkbox' && a.type !== 'radio' ? a.value : null;
  let sel = null; try { sel = [a.selectionStart, a.selectionEnd]; } catch { /* not a text field */ }
  main.replaceChildren(...({ gallery: galleryView, content: contentView, library: libraryView, review: reviewView, history: historyView }[view()] || galleryView)());
  if (view() !== 'history') scrollTo(0, y);
  if (k) {
    const b = main.querySelector(`[data-k="${CSS.escape(k)}"]`);
    if (b) {
      if (typed != null && b.value !== typed) b.value = typed;
      b.focus({ preventScroll: true });
      if (sel && sel[0] != null) try { b.setSelectionRange(...sel); } catch { /* not a text field */ }
    }
  }
  placeMarks();
}

const HINT = 'Every change saves itself as a draft straight away (a tick shows it). Visitors see it only once you publish it under Review. The eye is the opposite of publishing: it hides something from visitors, or shows it again, at once.';

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
    const card = h('div', { class: 'card' + (isHidden(se) ? ' hidden' : '') });
    card.append(h('div', { class: 'row' },
      h('input', { type: 'text', class: 'grow', value: s.title, 'aria-label': 'Genre name', 'data-k': `${s.id}:title`, onchange: (ev) => {
        save([{ id: s.id, kind: 'section', data: { title: ev.target.value, order: s.order, hidden: s.hidden } }], null, `${s.id}:title`);
      } }),
      badge(se),
      hideButton(se, 'this genre and its paintings'),
      h('span', { class: 'move' },
        h('button', { title: 'Move genre up', disabled: si === 0, onclick: () => moveSection(secs, si, -1) }, '↑'),
        h('button', { title: 'Move genre down', disabled: si === secs.length - 1, onclick: () => moveSection(secs, si, 1) }, '↓')),
      h('button', { class: 'danger', title: items.some((e) => e.draft != null) ? 'Move or remove its paintings first' : 'Remove this genre',
        disabled: items.some((e) => e.draft != null),
        onclick: () => { if (confirm(`Remove the genre "${s.title}"?`)) save([{ id: s.id, kind: 'section', data: null }], 'Genre removed in the draft'); } }, 'Remove'),
    ));
    if (!items.length) card.append(h('p', { class: 'hint' }, 'No paintings in this genre.'));
    items.forEach((e, i) => card.append(...paintingRow(e, items, i, secs)));
    out.push(card);
  });
  // genres deleted in the draft but still live
  for (const e of entries.filter((x) => x.kind === 'section' && x.draft == null)) {
    out.push(h('div', { class: 'card row' }, h('span', { class: 'grow muted' }, `${liveOf(e).title} (removed in the draft)`), badge(e),
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
        h('input', { type: 'text', value: text, 'data-k': id, onchange: (ev) => save([{ id, kind: 'text', data: { text: ev.target.value } }], null, id) }),
        e && changed(e) ? h('div', { class: 'actions' }, h('button', { onclick: () => discard([id]) }, 'Undo change')) : null);
    };
    if (sec.heading) card.append(field(sec.heading, 'Heading'));
    for (const [id, name] of sec.extra || []) card.append(field(id, name));
    if (sec.bg) card.append(backgroundBox(sec.bg));
    // Paragraphs: stored as one text, a blank line between paragraphs.
    const e = byId(sec.paras);
    const paras = (e ? (current(e) || {}).text || '' : '').split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
    const all = paras.concat(Array(extraParas[sec.paras] || 0).fill(''));
    const store = (list, key) => {
      extraParas[sec.paras] = list.filter((x) => !x.trim()).length;
      save([{ id: sec.paras, kind: 'text', data: { text: list.map((x) => x.trim().replace(/\n\s*\n/g, '\n')).filter(Boolean).join('\n\n') } }],
        'Saved as a draft', key);
    };
    all.forEach((text, i) => {
      const ta = h('textarea', { rows: Math.min(8, Math.max(2, Math.ceil(text.length / 60))), value: text, 'data-k': `${sec.paras}:${i}`,
        onchange: (ev) => { const list = all.slice(); list[i] = ev.target.value; store(list, `${sec.paras}:${i}`); } });
      card.append(h('div', { class: 'box' },
        h('div', { class: 'row' }, h('label', { class: 'grow' }, `Paragraph ${i + 1}`),
          h('span', { class: 'move' },
            h('button', { title: 'Move up', disabled: i === 0, onclick: () => { const l = all.slice(); [l[i - 1], l[i]] = [l[i], l[i - 1]]; store(l); } }, '↑'),
            h('button', { title: 'Move down', disabled: i === all.length - 1, onclick: () => { const l = all.slice(); [l[i + 1], l[i]] = [l[i], l[i + 1]]; store(l); } }, '↓')),
          h('button', { class: 'danger', title: 'Remove this paragraph', onclick: () => {
            if (!text.trim()) { extraParas[sec.paras]--; render(); return; }
            if (confirm('Remove this paragraph?')) store(all.filter((_, j) => j !== i));
          } }, 'Remove')),
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
  const store = (key, change, mk) => {
    const next = {};
    for (const s of SITES) {
      const v = { ...(d[s.key] || { name: '', on: false }), ...(s.key === key ? change : {}) };
      if (v.name || v.on) next[s.key] = { name: v.name, on: !!v.on };
    }
    save([{ id: 'links', kind: 'links', data: next }], null, mk);
  };
  const box = h('div', { class: 'box links' }, h('label', {}, 'Links ', e ? badge(e) : null),
    h('p', { class: 'hint' }, 'Tick the ones to show, here and as icons in the header, and type the username (or paste the profile\'s address).'));
  for (const s of SITES) {
    const v = d[s.key] || { name: '', on: false };
    const on = v.on || tickedEmpty.has(s.key);
    const input = h('input', { type: s.key === 'email' ? 'email' : 'text', value: v.name, placeholder: s.sample,
      autocapitalize: 'off', autocomplete: 'off', spellcheck: false, 'aria-label': `${s.name} ${s.key === 'email' ? 'address' : 'username'}`, 'data-k': `links:${s.key}`,
      onchange: (ev) => {
        const name = tidy(s.key, ev.target.value);
        if (name && !ok(s.key, name)) { toast(`That doesn't look like ${s.key === 'email' ? 'an email address' : `a username for ${s.name}`}`, true); return; }
        if (!name && on) tickedEmpty.add(s.key);
        if (name) tickedEmpty.delete(s.key);
        store(s.key, { name, on: on && !!name }, `links:${s.key}`);
      } });
    const tick = h('input', { type: 'checkbox', checked: on, 'data-k': `links:${s.key}:on`, onchange: (ev) => {
      if (ev.target.checked && !v.name) { tickedEmpty.add(s.key); render(); return; }
      tickedEmpty.delete(s.key);
      store(s.key, { on: ev.target.checked }, `links:${s.key}:on`);
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
   Either is a Library item (photoItem, videoItem below; also chosen from the Library with "From the Library…"):
   A photo: kept as uploaded, with one set of sizes made from it as it is (a photograph, not a painting: no white
   balance or corners).
   A video: one or more versions (sizes for wide screens, one made for phones held upright), each uploaded as
   made, after the checks in videoFacts(); first and last frames are taken here, once per shape, and stored as
   pictures. How it plays (once, or on a loop) and what visitors who ask for reduced motion or less
   data see instead (its last frame, or a slow fade from the first frame to the last) are the section's choices. */
const bgBusy = {};                    // section -> what it's doing, while a photo or video is being stored
const bgNotes = {};                   // section -> the checks' findings for the video version last added
const MB = (b) => `${(b / 1048576).toFixed(1)} megabytes`;
const lastStill = (d) => {
  const f = framesFor(d, d.versions.filter((x) => x.h <= x.w).sort((x, y) => y.w - x.w)[0] || d.versions[0]);
  return f.last(f.widths.find((w) => w >= 1024) || f.widths[f.widths.length - 1]);
};

function backgroundBox(key) {
  const id = `bg-${key}`, e = byId(id), d = e && current(e);
  const box = h('div', { class: 'box bg-box' + (isHidden(e) ? ' hidden' : '') }, h('div', { class: 'row' },
    h('label', { class: 'grow' }, 'Background ', e ? badge(e) : null),
    d ? hideButton(e, 'this background') : null));
  if (!media) return box.append(h('p', { class: 'hint' }, 'Needs file storage (R2), which isn\'t switched on for this site.')), box;
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
    onchange: () => pickVideo.files.length && run(() => addVideo([...pickVideo.files], d && d.type === 'video' ? d : null)) });

  if (d) {
    const src = d.type === 'video' ? lastStill(d) : photoAt(d, d.widths.find((w) => w >= 1024) || d.widths[d.widths.length - 1]);
    const pos = `${(d.focus[0] * 100).toFixed(1)}% ${(d.focus[1] * 100).toFixed(1)}%`;
    const frames = ['phone', 'wide'].map((k) => h('div', { class: `bg-frame ${k}`, title: k === 'phone' ? 'On a phone held upright' : 'On a wide screen',
      style: `background-image: url("${src}"); background-position: ${pos}; filter: brightness(${1 - d.shade})` }));
    box.append(
      h('div', { class: 'bg-pick', 'data-k': `${id}:focus`, title: 'Tap the part to keep in view', onclick: (ev) => {
        const r = ev.currentTarget.getBoundingClientRect();
        const focus = [(ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000);
        store({ ...d, focus }, null, `${id}:focus`);
      } }, h('img', { src, alt: '' }), h('span', { class: 'bg-focus', style: `left: ${d.focus[0] * 100}%; top: ${d.focus[1] * 100}%` })),
      h('p', { class: 'hint' }, d.type === 'video' ? 'The video\'s last frame. ' : '', 'Tap the part to keep in view. How it would be cropped:'),
      h('div', { class: 'bg-frames' }, ...frames.map((f) => h('figure', {}, f, h('figcaption', {}, f.title)))),
      h('label', {}, `Shade: ${Math.round(d.shade * 100)}%`),
      h('input', { type: 'range', min: 0, max: 60, step: 1, value: Math.round(d.shade * 100), 'data-k': `${id}:shade`,
        oninput: (ev) => { frames.forEach((f) => { f.style.filter = `brightness(${1 - ev.target.value / 100})`; });
          ev.target.previousSibling.textContent = `Shade: ${ev.target.value}%`; },
        onchange: (ev) => store({ ...d, shade: ev.target.value / 100 }, null, `${id}:shade`) }));
    if (d.type === 'video') {
      const choice = (label, field, options) => h('label', {}, label, h('select', { 'data-k': `${id}:${field}`, onchange: (ev) => store({ ...d, [field]: ev.target.value }, null, `${id}:${field}`) },
        ...options.map(([v, t]) => h('option', { value: v, selected: d[field] === v }, t))));
      box.append(
        choice('Plays', 'play', [['once', 'Once, stopping on its last frame'], ['loop', 'On a loop']]),
        choice('For visitors who ask for reduced motion or less data', 'calm', [['last', 'Its last frame'], ['fade', 'A slow fade from its first frame to its last']]),
        h('label', {}, 'Versions (the browser picks one for each screen)'),
        ...versionRows(d).map(([v, text]) => h('div', { class: 'row bg-version' }, h('span', { class: 'grow' }, text),
          d.versions.length > 1 ? h('button', { class: 'danger', disabled: busy, title: 'Remove this version',
            onclick: () => confirm('Remove this version?') && run(() => removeVersion(v)) }, 'Remove') : null)));
      if (bgNotes[key]) box.append(h('div', { class: 'bg-notes' }, ...bgNotes[key].map((n) => h('p', { class: 'hint' }, n))));
    } else {
      box.append(h('p', { class: 'hint' }, `Photo, ${d.w} × ${d.h} pixels.`));
    }
  } else {
    box.append(h('p', { class: 'hint' }, e ? 'Removed in the draft: once published, the section has no background (the picture stays in the Library).' : 'None: the section shows the page\'s grey.'));
  }
  if (bgPicking.has(key)) box.append(libraryPicker(d, (data) => { bgPicking.delete(key); store(data, 'Saved as a draft'); }));
  box.append(pickPhoto, pickVideo, status, h('div', { class: 'actions' },
    h('button', { disabled: busy, title: 'Choose a photo or video already in the Library',
      onclick: () => { bgPicking.has(key) ? bgPicking.delete(key) : bgPicking.add(key); render(); } }, bgPicking.has(key) ? 'Close the Library' : 'From the Library…'),
    h('button', { disabled: busy, onclick: () => pickPhoto.click() }, d && d.type === 'photo' ? 'Replace with a photo…' : 'Choose a photo…'),
    h('button', { disabled: busy, title: 'One video, or several versions of it at once (sizes for wide screens, one made for phones held upright)',
      onclick: () => { addingFresh = true; pickVideo.click(); } }, d ? 'Replace with a video…' : 'Choose a video…'),
    d && d.type === 'video' ? h('button', { disabled: busy || d.versions.length >= 6, title: 'Another size of this video, or one made for phones held upright',
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
    const pic = await photoItem(file, label, 'site', say);
    delete bgBusy[key];
    await store({ type: 'photo', ...pic, focus: [0.5, 0.5], shade: d ? d.shade : 0.12 }, 'Photo saved as a draft: tap it to choose the part to keep in view');
  }
  /* One or more versions of a video. into: the section's video to add them to (Add a version…), or null for a new
     video (Choose / Replace with a video…), a new Library item. */
  async function addVideo(files, into) {
    if (addingFresh) into = null;
    const id = into ? into.media : (await call('POST', 'library/new', { kind: 'video', grp: 'site', name: `${label} video` })).id;
    const got = await videoItem(id, files, into || { versions: [], frames: {} }, say);
    bgNotes[key] = got.notes;
    delete bgBusy[key];
    const base = into || { focus: d ? d.focus : [0.5, 0.5], shade: d ? d.shade : 0, play: 'once', calm: 'last' };
    await store({ ...base, type: 'video', media: id, versions: got.versions, frames: got.frames },
      files.length > 1 ? `${files.length} versions saved as a draft` : 'Video saved as a draft');
  }
  /* Take a version out of the background (the file stays in the Library); if its shape's frames came from it,
     they're made again from the next largest of that shape. */
  async function removeVersion(v) {
    const versions = d.versions.filter((x) => x !== v);
    const frames = await withFrames(d.media, versions, d.frames, () => null, say);
    delete bgBusy[key];
    await store({ ...d, versions, frames }, 'Version removed in the draft');
  }
}
let addingFresh = false;
const bgPicking = new Set();          // sections whose Library picker is open

/* The Library's site pictures that can be a background: photos with a set of sizes, and videos with frames for
   every shape they have. Tapping one makes it the background (in the draft), keeping the focus and shade. */
function libraryPicker(d, use) {
  if (!libraryData) { loadLibrary(); return h('p', { class: 'hint' }, 'Loading the Library…'); }
  const fit = libraryData.items.filter((it) => it.grp === 'site' && it.catalogued).map((it) => [it, backgroundFrom(it, d)]).filter(([, b]) => b);
  if (!fit.length) return h('p', { class: 'hint' }, 'The Library has no site pictures yet: add some there, or choose a photo or video here.');
  return h('div', { class: 'lib-picker' }, ...fit.map(([it, b]) => h('button', { class: 'lib-pick', title: it.name, onclick: () => use(b) },
    it.thumb ? h('img', { src: `/media/${it.thumb}`, alt: '' }) : glyph(GLYPHS.photo, 28),
    it.kind === 'video' ? h('span', { class: 'lib-video' }, glyph(GLYPHS.play, 12)) : null,
    h('span', { class: 'lib-pick-name' }, it.name))));
}
function backgroundFrom(it, d) {
  const keep = { focus: d ? d.focus : [0.5, 0.5], shade: d ? d.shade : 0.12 };
  const have = new Set(it.parts.map((p) => p.part)), data = it.data || {};
  if (it.kind === 'photo') {
    const r = Object.entries(data.renditions || {}).filter(([k, x]) => have.has(k) && x.ext === 'jpg').sort((a, b) => Number(b[0].slice(1)) - Number(a[0].slice(1)))[0];
    return r && { type: 'photo', media: it.id, rendition: r[0], ...keep, w: r[1].w, h: r[1].h, widths: r[1].widths };
  }
  const versions = (data.versions || []).filter((v) => have.has(v.file));
  const frames = {};
  for (const [shape, up] of [['wide', false], ['tall', true]]) {
    if (!versions.some((v) => upright(v) === up)) continue;
    const f = (data.frames || {})[shape];
    if (!f || !have.has(f.dir)) return null;
    frames[shape] = f;
  }
  if (!versions.length) return null;
  return { type: 'video', media: it.id, ...keep, versions, frames,
    play: d && d.type === 'video' ? d.play : 'once', calm: d && d.type === 'video' ? d.calm : 'last' };
}

/* A photo as a new Library item (or the item it already is, if the same photo is stored): kept as uploaded, with a
   set of sizes made from it (BG_WIDTHS). Returns what a background uses of it. */
async function photoItem(file, name, grp, say) {
  const src = await photoOf(file, say);
  const { id } = await keepOriginal(file, name, null, say, grp);
  const { part } = await call('GET', `library/next?id=${id}&part=r`);
  const widths = await storeSizes(`media/${id}/${part}/`, src, say);
  const top = widths[widths.length - 1], hh = Math.round(src.height * top / src.width);
  await call('POST', 'library/data', { id, data: { renditions: { [part]: { widths, w: top, h: hh, ext: 'jpg' } } } });
  return { media: id, rendition: part, w: top, h: hh, widths };
}

/* Video files into a Library item (id): each checked (videoFacts), uploaded as made (<w>x<h>.mp4), and frames
   kept for each shape from its largest version (withFrames). have: what the background had ({ versions, frames }).
   Returns { versions, frames, notes }; the item's record gets the new versions and frames too. */
async function videoItem(id, files, have, say) {
  const added = [], notes = [], grabbed = new Map();
  const best = {};    // shape -> the largest so far, whose frames are kept (a 4K frame is about 45 megabytes in memory)
  for (const v of have.versions) if (!best[upright(v)] || v.w > best[upright(v)].w) best[upright(v)] = v;
  for (const [i, file] of files.entries()) {
    const tell = files.length > 1 ? (t) => say(`Video ${i + 1} of ${files.length}: ${t}`) : say;
    const facts = await videoFacts(file, tell);
    const shape = upright(facts), was = best[shape];
    if (!was || facts.w > was.w) { if (was && 'first' in was) { was.first = was.last = null; } best[shape] = facts; }
    else { facts.first = facts.last = null; }
    added.push({ file, facts });
    notes.push(...facts.notes.map((n) => (files.length > 1 ? `${facts.w} × ${facts.h}: ${n}` : n)));
  }
  const versions = [...have.versions], fresh = [];
  for (const [i, { file, facts }] of added.entries()) {
    const { part } = await call('GET', `library/next?id=${id}&part=${facts.w}x${facts.h}`);
    say(`Uploading ${files.length > 1 ? `video ${i + 1} of ${files.length}` : 'the video'} (${MB(file.size)})…`);
    await put(`media/${id}/${part}.mp4`, file, 'video/mp4', 15 * 60000);
    const v = { file: part, w: facts.w, h: facts.h, bytes: file.size, seconds: Math.round(facts.seconds * 100) / 100 };
    grabbed.set(v, facts);
    versions.push(v); fresh.push(v);
  }
  const frames = await withFrames(id, versions, have.frames || {}, (v) => grabbed.get(v), say);
  await call('POST', 'library/data', { id, data: { versions: fresh, frames } });
  return { versions, frames, notes };
}

/* Frames for each shape the versions have ({ wide, tall }: dir, widths, from), taken from its largest version
   (paths.js): kept if they already came from it, otherwise made from what was just read from a new file
   (grabbed), or read back from the stored video, under the next free folder (wide-2...). */
async function withFrames(id, versions, frames, grabbed, say) {
  const out = {};
  for (const [shape, up] of [['wide', false], ['tall', true]]) {
    const top = versions.filter((v) => upright(v) === up).sort((a, b) => b.w - a.w)[0];
    if (!top) continue;
    if (frames[shape] && frames[shape].from === top.file) { out[shape] = frames[shape]; continue; }
    const got = grabbed(top);
    const src = got && got.first ? got : await framesOf(`/media/${id}/${top.file}.mp4`, say);
    const { part: dir } = await call('GET', `library/next?id=${id}&part=${shape}`);
    const widths = await storeSizes(`media/${id}/${dir}/first-`, src.first, say, 'first frame', FRAME_WIDTHS, FRAME_QUALITY);
    await storeSizes(`media/${id}/${dir}/last-`, src.last, say, 'last frame', FRAME_WIDTHS, FRAME_QUALITY);
    out[shape] = { dir, widths, from: top.file };
  }
  return out;
}

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

/* Make JPEG sizes of a picture (BG_WIDTHS, or list; never larger than the picture) and store them as
   <prefix><width>.jpg (e.g. media/<code>/r1/1536.jpg); returns the widths. */
async function storeSizes(prefix, src, say, what = 'sizes', list = BG_WIDTHS, quality) {
  const widths = [...new Set(list.filter((w) => w < src.width).concat(Math.min(src.width, list[list.length - 1])))];
  let n = 0;
  for (const w of widths) {
    say(`Making and uploading the ${what}: ${++n} of ${widths.length}`);
    try { await put(`${prefix}${w}.jpg`, await resized(src, w, quality), 'image/jpeg'); }
    catch (e) { if (!/already exists/.test(e.message)) throw e; }   // a version's frames made before: the same picture
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

  const url = URL.createObjectURL(file);
  try {
    const { w, h: hh, seconds, first, last } = await framesOf(url, say);
    const rate = file.size * 8 / seconds / 1e6, guide = 1 + 3.5 * (w * hh) / (3840 * 2160);
    if (seconds > 30) notes.push(`It runs ${Math.round(seconds)} seconds: most visitors will have moved on well before the end.`);
    if (rate > guide * 1.25) notes.push(`It's ${rate.toFixed(1)} megabits a second; about ${guide.toFixed(1)} would do for its size, so it's heavier than it needs to be.`);
    if (file.size > 20 * 1048576) notes.push(`It's ${MB(file.size)}: heavy for a background, especially on a phone's data.`);
    if (Math.max(w, hh) < 1920) notes.push(`At ${w} × ${hh} it will look soft on large screens: fine as a small version, alongside a larger one.`);
    if (!notes.length) notes.push('Checked: it plays everywhere, starts quickly and is a sensible weight for its size.');
    return { w, h: hh, seconds, first, last, notes };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* A video's size, length, and first and last frames (as canvases at full size), from a file's object URL or a
   stored video's address (the editor's own, so the frames can be read). */
async function framesOf(src, say) {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto';
  const event = (name, ms = 60000) => new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error('This browser can\'t play that video: export it as MP4 with H.264.')), ms);
    v.addEventListener(name, () => { clearTimeout(t); ok(); }, { once: true });
    v.addEventListener('error', () => { clearTimeout(t); no(new Error('This browser can\'t play that video: export it as MP4 with H.264.')); }, { once: true });
  });
  const loaded = event('loadeddata');
  v.src = src;
  await loaded;
  const w = v.videoWidth, hh = v.videoHeight, seconds = v.duration;
  if (!w || !hh || !isFinite(seconds)) throw new Error('This browser can\'t read that video\'s size or length.');
  const grab = async (t) => {
    say('Taking its first and last frames…');
    const seeked = event('seeked');
    v.currentTime = t; await seeked;
    const c = document.createElement('canvas'); c.width = w; c.height = hh;
    c.getContext('2d').drawImage(v, 0, 0, w, hh);
    return c;
  };
  const first = await grab(0);
  const last = await grab(Math.max(0, seconds - 0.05));
  v.removeAttribute('src'); v.load();
  return { w, h: hh, seconds, first, last };
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
  const row = h('div', { class: 'painting' + (gone ? ' deleted' : '') + (isHidden(e) ? ' hidden' : '') },
    h('img', { src: thumb(d), alt: '', loading: 'lazy' }),
    h('div', { class: 'what' }, h('span', { class: 't' }, d.title),
      h('span', { class: 'd' }, d.details || ' ', sizeNote(d))),
    badge(e),
    gone ? h('button', { onclick: () => discard([e.id]) }, 'Keep it')
      : h('span', { class: 'move' },
        hideButton(e, 'this painting'),
        h('button', { title: 'Move up', disabled: i === 0, onclick: () => movePainting(items, i, -1) }, '↑'),
        h('button', { title: 'Move down', disabled: i === items.length - 1, onclick: () => movePainting(items, i, 1) }, '↓'),
        h('button', { onclick: () => { if (open.has(e.id)) closeEdit(e.id); else open.add(e.id); render(); } }, open.has(e.id) ? 'Close' : 'Edit')));
  if (gone || !open.has(e.id)) { editFields.delete(e.id); return [row]; }

  /* One saving rule: each field saves the painting as a draft as soon as it's changed (a tick beside it), and a
     change to the picture is made and stored by itself (pictureChanged, below). No Save button. */
  const f = {}, k = (name) => `${e.id}:${name}`;
  const form = h('div', { class: 'edit' },
    h('label', {}, 'Title'), f.title = h('input', { type: 'text', value: d.title }),
    ...detailsFields(f, d, () => { const re = reopened.get(e.id); if (re) re.dr.sizeChanged(); }),
    h('label', {}, 'Genre'), f.section = h('select', {}, ...secs.map((s) => h('option', { value: s.id, selected: s.id === d.section }, s.title))),
    h('label', { class: 'tick' }, f.wide = h('input', { type: 'checkbox', checked: d.wide }), 'Wide: spans the whole width of the list'),
    ...pictureFields(e, d, f),
    h('p', { class: 'hint' }, `Address: /paintings/${d.name}/ (stays the same if the title changes)`),
    h('div', { class: 'actions' },
      // never published: undoing would take it away altogether, which is what Remove (with its question) is for
      changed(e) && e.published != null ? h('button', { onclick: () => discard([e.id]) }, 'Undo changes') : null,
      h('button', { class: 'danger', title: 'Take it out of the gallery: its photo stays in the Library',
        onclick: () => { if (confirm(`Remove "${d.title}" from the gallery? Its photo stays in the Library, and it stays on the site until you publish.`)) { closeEdit(e.id); save([{ id: e.id, kind: 'painting', data: null }], 'Removed in the draft'); } } }, 'Remove')));
  for (const [name, el] of [['title', f.title], ['medium', f.medium], ['height', f.height], ['width', f.width], ['year', f.year],
    ['section', f.section], ['wide', f.wide], ['measured', f.measured], ['estimated', f.estimated], ['shown', f.shown]]) {
    el.dataset.k = k(name);
    el.addEventListener('change', () => savePainting(e.id, f, k(name)));
  }
  carry(editFields.get(e.id), f);
  editFields.set(e.id, f);
  return [row, form];
}

/* Save a painting's Edit form: built when its turn in the queue comes, from the latest draft and the form's fields,
   keeping the picture as the draft has it (the picture saves itself). */
function savePainting(id, f, key) {
  return save(() => {
    const e = byId(id);
    if (!e || e.draft == null) return null;
    const d = draftOf(e), det = detailsOf(f), title = f.title.value.trim();
    if (det.error) throw new Error(det.error);
    if (!title) throw new Error('Give it a title');
    const moved = f.section.value !== d.section;
    const { estimated, size_shown, ...rest } = d;    // put back from the form (detailsOf)
    return [{ id, kind: 'painting', data: { ...rest, title, ...det, wide: f.wide.checked, section: f.section.value,
      order: moved ? paintingsIn(f.section.value).length : d.order } }];
  }, null, key);
}

/* Closing a painting's Edit form: a picture change still waiting to be stored is stored now. */
function closeEdit(id) {
  const re = reopened.get(id);
  if (re && re.timer) { clearTimeout(re.timer); re.timer = null; storePicture(id, re); }
  open.delete(id); reopened.delete(id); editFields.delete(id);
}

/* A painting's picture saves itself too: once the darkroom's choices have rested for a moment (PICTURE_REST), its
   sizes are made and stored as the photo's next set (r2, r3...) and the draft points at them. A set made for an
   earlier change in this same sitting, which nothing else can be using, is deleted once replaced, so trying things
   out doesn't fill the Library. Going back to the choices it opened with (Back to saved) puts back its own
   pictures, making nothing. A replaced photo is kept as a Library item once, however many changes follow. */
const PICTURE_REST = 1200;
function pictureChanged(id, re) {
  clearTimeout(re.timer);
  re.timer = setTimeout(() => { re.timer = null; storePicture(id, re); }, PICTURE_REST);
}
async function storePicture(id, re) {
  if (re.running) { re.again = true; return; }
  const dr = re.dr;
  if (!dr.ready) return;
  const want = dr.changed() ? JSON.stringify(dr.record('')) + (dr.replacement ? `|${dr.replacement.name}|${dr.replacement.size}` : '') : 'opened';
  if (want === re.saved) return;
  re.running = true;
  const say = (t) => dr.say(t);
  try {
    let pic = re.opened;
    if (want !== 'opened') {
      let orig = dr.original;
      if (dr.replacement) {
        if (!re.kept || re.kept.file !== dr.replacement) {
          const e = byId(id);
          re.kept = { file: dr.replacement, key: (await keepOriginal(dr.replacement, e ? current(e).title : 'Painting', null, say)).key };
        }
        orig = re.kept.key;
      }
      pic = { ...(await storeImages(orig.slice(6), dr.result(), say)), white_paper: dr.white === 'paper', process: dr.record(orig) };
      re.made.add(`${pic.media}/${pic.rendition}`);
    }
    let before = null;
    const out = await save(() => {
      const e = byId(id);
      if (!e || e.draft == null) return null;
      before = draftOf(e);
      const { process, ...rest } = before;             // an older painting opened with no process record
      return [{ id, kind: 'painting', data: { ...rest, ...pic } }];
    }, null, `${id}:picture`);
    if (!out) return;
    re.saved = want;
    say('');
    const old = before && `${before.media}/${before.rendition}`;
    if (old && re.made.has(old) && old !== `${pic.media}/${pic.rendition}`) {
      re.made.delete(old);
      call('POST', 'library/delete', { id: before.media, part: before.rendition }).catch(() => { /* still used: it stays */ });
    }
  } catch (err) {
    say(''); toast(err.message, true);
  } finally {
    re.running = false;
    if (re.again) { re.again = false; storePicture(id, re); }
  }
}

/* Reopening a painting's picture: its darkroom starts with the saved choices summarised, and opening a section
   reads the original back from R2 and starts from those choices (or, for paintings moved from git, which have
   none: the whole photo, with the paper's white balance if it's a drawing on white paper). */
const reopened = new Map();         // painting id -> { dr }, while its Edit form is open
const pictureOf = (d) => {          // the painting's current picture, at a size fit for comparing
  const w = d.widths.find((x) => x >= 1024) || d.widths[d.widths.length - 1];
  return `/${paintingAt(d, w)}`;
};
function pictureFields(e, d, f) {
  if (!media) return [];
  let re = reopened.get(e.id);
  if (!re) {
    const white = d.white_paper ? 'paper' : 'none';
    re = { saved: 'opened', made: new Set(), timer: null,
      opened: { w: d.w, h: d.h, widths: d.widths, media: d.media, rendition: d.rendition, ext: d.ext, preview: d.preview,
        white_paper: !!d.white_paper, ...(d.process ? { process: d.process } : {}) } };
    re.dr = darkroom({
      onChange: () => pictureChanged(e.id, re),
      previous: pictureOf(d),
      saved: d.process || { white },
      start: d.process ? { process: d.process } : { white, guess: false },
      fetch: async () => {
        const key = d.process ? d.process.original : `media/${d.media}`;
        const r = await fetchFor(`/admin/api/original?key=${encodeURIComponent(key)}`, {}, 120000);
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Couldn't fetch the original (${r.status})`);
        return { original: r.headers.get('x-original') || key, blob: await r.blob() };
      },
    });
    reopened.set(e.id, re);
  }
  re.dr.attach(f);
  return [h('label', { 'data-k': `${e.id}:picture` }, 'Picture'), re.dr.el];
}

function moveSection(secs, i, dir) {
  const list = secs.slice(); [list[i], list[i + dir]] = [list[i + dir], list[i]];
  save(list.map((s, n) => ({ ...s, order: n })).filter((s, n) => secs.find((x) => x.id === s.id).order !== n)
    .map(({ id, title, order, hidden }) => ({ id, kind: 'section', data: { title, order, hidden } })), 'Moved');
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
const discard = (ids) => {
  for (const id of ids) {                         // an open Edit form starts again from the published version
    const re = reopened.get(id);
    if (re) clearTimeout(re.timer);
    reopened.delete(id); editFields.delete(id);
  }
  return act(() => call('POST', 'discard', { ids }), 'Back to the published version');
};

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
   new photo is stored as an original with the picture (replacement; storePicture); "Back to saved" returns to the
   old photo and its choices, and their pictures.
   opts.onChange, for reopening: called whenever the result has been made afresh (the form stores it once it rests). */
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
            g.brightGhost = h('span', { class: 'ghost', hidden: true, title: 'As it was when opened' })),
          h('label', {}, 'Keep the light\'s warmth ', g.warmOut = h('span', { class: 'muted' })),
          slider(g.warm = h('input', { type: 'range', min: 0, max: 100, step: 1, value: 0, oninput: () => slid() }),
            g.warmGhost = h('span', { class: 'ghost', hidden: true, title: 'As it was when opened' }))))),
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
      g.back = h('button', { type: 'button', hidden: true, title: 'Put every choice back as it was when you opened it (and the photo, if replaced)', onclick: () => backToSaved() }, 'Back to as it was')),
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
          ? `Same proportions as the old photo${kept.length ? `: kept ${and(kept)}` : ''}. It's stored, as a draft, straight away.`
          : `Different proportions from the old photo: ${sliders.brightness != null ? 'kept the sliders, ' : ''}guessed the corners afresh${had ? ' and cleared the white spots' : ''}. It's stored, as a draft, straight away.`;
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
    if (opts.onChange) opts.onChange();             // reopened: the painting's form stores the picture once it rests
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

/* Make every size of a painting's picture from the result and store them as the next set of sizes of its photo's
   Library item (id): media/<code>/r<n>/<width>.jpg and preview.jpg; returns the painting's image fields. A new
   set each time, so the earlier pictures stay for History. */
async function storeImages(id, { out, W, H }, say) {
  const { part } = await call('GET', `library/next?id=${id}&part=r`);
  const widths = [...new Set(WIDTHS.filter((w) => w < W).concat(Math.min(W, WIDTHS[WIDTHS.length - 1])))];
  const jobs = widths.map((w) => [`${w}.jpg`, w]).concat([['preview.jpg', Math.min(PREVIEW, W)]]);
  let done = 0;
  for (const [fname, w] of jobs) {
    say(`Making and uploading image sizes: ${++done} of ${jobs.length}`);
    await put(`media/${id}/${part}/${fname}`, await resized(out, Math.min(w, out.width)), 'image/jpeg');
  }
  await call('POST', 'library/data', { id, data: { renditions: { [part]: { widths, w: W, h: H, ext: 'jpg' } } } });
  return { w: W, h: H, widths, media: id, rendition: part, ext: 'jpg',
    preview: { src: `media/${id}/${part}/preview.jpg`, w: Math.min(PREVIEW, W), h: Math.round(H * Math.min(PREVIEW, W) / W) } };
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
      const { key: original, id: item, shared } = await keepOriginal(file, title, dr.known && dr.known.file === file ? dr.known : null, (t) => { f.progress.textContent = t; });
      const pic = await storeImages(item, dr.result(), (t) => { f.progress.textContent = t; });
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

/* Keep a photo as a Library item (its original.<ext>), unless the same photo is already one (found by its content,
   the first 12 hex digits of its SHA-256), for this painting or another: then that item is used. known: storedFor's
   answer, if already asked. name: the item's name in the Library. Returns { key: media/<code> (a painting's process
   record names its original so), id: the code, shared: whether it was already stored }. */
async function storedFor(file) {
  const hex = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  const hash = hex.slice(0, 12);
  const { key } = await call('GET', `stored?hash=${hash}`);
  return { file, hash, key };
}
async function keepOriginal(file, name, known, say, grp = 'painting') {
  if (!known) { say('Checking whether this photo is already stored…'); known = await storedFor(file); }
  const { hash, key: have } = known;
  if (have) return { key: have, id: have.slice(6), shared: true };
  const ext = (file.name.match(/\.([a-z0-9]+)$/i) || [0, 'jpg'])[1].toLowerCase().replace(/^jpeg$/, 'jpg');
  const { id } = await call('POST', 'library/new', { kind: 'photo', grp, name, hash });
  say('Keeping the original…');
  await put(`media/${id}/original.${ext}`, file, file.type || 'image/jpeg');
  return { key: `media/${id}`, id, shared: false };
}

// ---- review and publish ------------------------------------------------------------------------------------

const ticked = new Set();
let ticksFor = '';

const FIELDS = { type: 'Kind', versions: 'Versions', play: 'Plays', calm: 'For reduced motion', file: 'Files', focus: 'Kept in view', shade: 'Shade', title: 'Title', medium: 'Medium', cm: 'Size', year: 'Year', estimated: 'Not measured', size_shown: 'Size shown', section: 'Genre', order: 'Position', wide: 'Wide', white_paper: 'White paper', text: 'Text', hidden: 'Hidden from visitors', media: 'Picture', rendition: 'Picture' };
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
  if (status(e) === 'hiding' || status(e) === 'showing') return [];      // the badge says it all
  // the details line is made from medium, size and year, so it isn't listed as a change of its own; a new picture
  // is one line (its sizes, preview and process change with it)
  const pic = ['media', 'rendition', 'w', 'h', 'widths', 'ext', 'preview', 'process', 'white_paper'];
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !(k === 'details' && 'cm' in b)
    && JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  const out = [];
  if (e.kind === 'painting' && keys.some((k) => pic.includes(k))) out.push(h('div', {}, h('b', {}, 'Picture: '), 'made afresh'));
  for (const k of keys) {
    if (e.kind === 'painting' && pic.includes(k)) continue;
    if (k === 'hidden') { out.push(h('div', {}, h('b', {}, b.hidden ? 'Hidden from visitors' : 'Shown again'))); continue; }
    out.push(h('div', {}, h('b', {}, `${FIELDS[k] || k}: `), h('del', {}, show(k, a[k])), ' → ', h('ins', {}, show(k, b[k]))));
  }
  return out;
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
        const kind = !p ? 'new' : !d ? 'gone' : unhidden(v.data) === unhidden(v.previous) ? (d.hidden ? 'hiding' : 'showing') : 'changed';
        const mine = byId(v.entry_id);
        const same = mine && mine.draft === v.data;
        return h('div', { class: 'row', style: 'margin-top:0.4rem' },
          h('span', { class: 'grow' }, name, ' ', h('span', { class: `badge ${kind}` }, { new: 'Added', gone: 'Removed', hiding: 'Hidden', showing: 'Shown again' }[kind] || 'Changed')),
          same ? h('span', { class: 'muted' }, 'as now') : h('button', { onclick: () => act(() => call('POST', 'restore', { revision: v.id }), 'Brought back as a draft') }, 'Bring back'));
      })));
  }
  return out;
}

// ---- the library -------------------------------------------------------------------------------------------

/* Every item in storage (library.js on the server), as Site pictures and Paintings. Each row: its picture, its name
   (the Library's own: saved as soon as it's changed, with a tick), its code (its folder in R2, media/<code>/: tap to
   copy), what uses it, then a line for each part (the original, each set of sizes, each video version, each set of
   frames) with its weight, and a bin for a part nothing uses. The bin on the right deletes the whole item, only
   when no draft or published page uses it. Photos and videos for the site can be added here; paintings come in
   through the Gallery (their pictures are prepared in the darkroom). */
let libraryData = null, libBusy = '';
const libPicked = new Set();   // items ticked to compare (two or three)
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
  eye: 'M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10zM10 7.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8z',   // on the site
  hidden: 'M2.5 8.5c2 2.7 4.6 4.1 7.5 4.1s5.5-1.4 7.5-4.1M5.2 11.4l-1.5 1.9M10 12.6v2.4M14.8 11.4l1.5 1.9',       // a closed eye: hidden
  play: 'M7 5v10l8-5z',
  photo: 'M3 4.5h14v11H3zM3 13l4-4 3.5 3.5L13 10l4 4M13 7.5h.01',
  sizes: 'M2.5 9.5h7v7h-7zM11.5 5.5h6v6h-6zM11.5 14h3v2.5h-3z',                        // a few sizes of one picture
  frames: 'M3 4.5h14v11H3zM7 4.5v11M13 4.5v11',                                     // a strip of frames
  add: 'M10 4v12M4 10h12',
  compare: 'M2.5 4.5h6.5v11H2.5zM11 4.5h6.5v11H11',                                 // two side by side
  close: 'M5 5l10 10M15 5L5 15',
  live: 'M10 6.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',                                // published
  draft: 'M4 16l1-4 8-8 3 3-8 8zM11.5 5.5l3 3',                                        // a pencil: in a draft
  past: 'M3.5 10a6.5 6.5 0 1 0 2-4.7M3.5 3.5v3h3M10 6.5V10l2.5 1.5',                    // a clock turning back: History
};
const STATES = { published: ['live', 'On the site'], hidden: ['hidden', 'Published, but hidden from visitors'], draft: ['draft', 'In a draft'], history: ['past', 'Only in History'] };
const RANK = { published: 0, hidden: 1, draft: 2, history: 3 };

function loadLibrary() {
  return call('GET', 'library').then((d) => { libraryData = d; render(); }).catch((e) => toast(e.message, true));
}

function libraryView() {
  if (!libraryData) { loadLibrary(); return [h('h1', {}, 'Library'), h('p', { class: 'muted' }, 'Loading…')]; }
  const out = [h('h1', {}, 'Library')];
  const pick = h('input', { type: 'file', accept: 'image/*,video/mp4,.mp4,.m4v', multiple: true, hidden: true,
    onchange: () => pick.files.length && addToLibrary([...pick.files]) });
  for (const [grp, title] of [['site', 'Site pictures'], ['painting', 'Paintings']]) {
    const items = libraryData.items.filter((it) => it.grp === grp).sort((a, b) => b.added.localeCompare(a.added));
    const total = items.reduce((n, it) => n + it.bytes, 0);
    out.push(h('h2', { class: 'row' }, title, h('span', { class: 'muted', style: 'font-size:0.85rem' }, `${items.length} · ${MB(total)}`),
      grp === 'site' ? h('button', { class: 'lib-add', disabled: !!libBusy, title: 'Add photos, or the versions of one video, to the Library', 'aria-label': 'Add to the Library',
        onclick: () => pick.click() }, glyph(GLYPHS.add)) : null));
    if (grp === 'site') out.push(pick, libBusy ? h('p', { class: 'hint' }, libBusy) : null);
    if (items.length) out.push(h('div', { class: 'card' }, ...items.map(libraryRow)));
  }
  for (const id of libPicked) if (!libraryData.items.some((it) => it.id === id)) libPicked.delete(id);
  if (libPicked.size) {
    const chosen = libraryData.items.filter((it) => libPicked.has(it.id));
    out.push(h('div', { class: 'lib-comparebar' },
      h('button', { class: 'lib-compare', disabled: chosen.length < 2, title: chosen.length < 2 ? 'Tick one or two more to compare' : 'Compare side by side',
        'aria-label': 'Compare side by side', onclick: () => showItems(chosen) }, glyph(GLYPHS.compare, 20), h('span', {}, String(chosen.length))),
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
  libBusy = ''; libraryData = null; render();
}

function libraryRow(it) {
  const uses = strongest(it.uses);
  const live = uses.filter((u) => u.state !== 'history');
  const pastOnly = !live.length && uses.length > 0;
  const pic = it.thumb
    ? h('img', { src: `/media/${it.thumb}`, alt: '', loading: 'lazy' })
    : h('span', { class: 'lib-none', title: 'No picture to show' }, glyph(GLYPHS.photo, 28));
  const picked = libPicked.has(it.id), full = !picked && libPicked.size >= 3;
  const tick = h('label', { class: 'lib-tick' + (picked ? ' on' : ''), title: full ? 'Three are ticked already: untick one to compare this' : picked ? 'Ticked to compare' : 'Tick two or three to compare them side by side' },
    h('input', { type: 'checkbox', checked: picked, disabled: full, 'aria-label': `Compare ${it.name}`,
      onchange: (ev) => { if (ev.target.checked) libPicked.add(it.id); else libPicked.delete(it.id); render(); } }));
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

/* One mark per thing using it, at its strongest (on the site, in a draft, or only in History). */
function strongest(list) {
  const by = new Map();
  for (const u of list) if (!by.has(u.entry) || RANK[u.state] < RANK[by.get(u.entry).state]) by.set(u.entry, u);
  return [...by.values()].sort((a, b) => RANK[a.state] - RANK[b.state]);
}
const useMarks = (uses, name) => uses.map((u) => h('span', { class: `lib-use ${u.state}`, title: u.label === name ? STATES[u.state][1] : `${u.label}: ${STATES[u.state][1].toLowerCase()}` },
  glyph(GLYPHS[STATES[u.state][0]], 13), u.label === name ? null : u.label));

/* A part of an item, on a line of its own: what it is, as a symbol and its size, its weight, its users' marks,
   and a bin when nothing (not even History) uses it. */
function partLine(it, p) {
  let icon, what;
  if (p.part === 'original') { icon = glyph(GLYPHS.photo, 16); what = `Original${p.w ? `, ${p.w} × ${p.h}` : ''}${p.ext ? ` (${p.ext.toUpperCase()})` : ''}`; }
  else if (/^r\d+$/.test(p.part)) { icon = glyph(GLYPHS.sizes, 16); what = `${p.sizes || p.files} sizes${p.w ? `, up to ${p.w} × ${p.h}` : ''}`; }
  else if (/^\d+x\d+/.test(p.part)) { icon = shapeOf(p, it.parts); what = `${p.w} × ${p.h}${p.seconds ? `, ${p.seconds} seconds` : ''}`; }
  else if (/^(wide|tall)-/.test(p.part)) { icon = glyph(GLYPHS.frames, 16); what = `First and last frames, ${p.part.startsWith('tall') ? 'upright' : 'wide'}`; }
  else { icon = glyph(GLYPHS.photo, 16); what = `${p.files} other file${p.files === 1 ? '' : 's'}`; }
  const uses = strongest(p.uses);
  return h('div', { class: 'lib-part', title: `${p.part}${p.files > 1 ? `/ (${p.files} files)` : ''}` },
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

/* One item large, or two or three side by side, over the page: each picture as big as fits, with what tells them
   apart underneath: the original's pixels, its weight, when it was added, its name and code. The best (most pixels)
   is marked when comparing. Tap the backdrop, the cross or Escape to close. */
function showItems(list) {
  const px = (it) => { const o = it.data && it.data.original; return o && o.w ? o.w * o.h : 0; };
  const most = list.length > 1 ? Math.max(...list.map(px)) : 0;
  const when = (t) => (t ? new Date(t).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'not known');
  const facts = (it) => {
    const o = it.data && it.data.original, orig = it.parts.find((p) => p.part === 'original');
    const lines = [h('div', { class: 'lib-cmp-name' }, it.name), h('div', { class: 'lib-cmp-code' }, it.id)];
    if (it.kind === 'video') {
      for (const v of it.parts.filter((p) => /^\d+x\d+/.test(p.part))) lines.push(h('div', {}, glyph(GLYPHS.play, 13), ` ${v.w} × ${v.h}${v.seconds ? `, ${v.seconds} s` : ''}, ${MB(v.bytes)}`));
    } else {
      lines.push(h('div', { class: most && px(it) === most ? 'lib-best' : '', title: most && px(it) === most ? 'The most pixels of these' : '' },
        glyph(GLYPHS.photo, 13), o && o.w ? ` ${o.w} × ${o.h} (${(o.w * o.h / 1e6).toFixed(1)} megapixels)` : ' size not known'));
      if (orig) lines.push(h('div', {}, `Original ${MB(orig.bytes)}${orig.ext ? ` ${orig.ext.toUpperCase()}` : ''}`));
    }
    lines.push(h('div', {}, glyph(GLYPHS.past, 13), ` ${when(it.added)}`));
    return h('div', { class: 'lib-cmp-facts' }, ...lines);
  };
  const close = () => { box.remove(); removeEventListener('keydown', onKey); };
  const onKey = (ev) => { if (ev.key === 'Escape') close(); };
  const box = h('div', { class: 'lib-overlay', role: 'dialog', 'aria-label': list.length > 1 ? 'Compare' : list[0].name,
    onclick: (ev) => { if (ev.target === box || ev.target.classList.contains('lib-cmp')) close(); } },
    h('button', { class: 'lib-close', title: 'Close', 'aria-label': 'Close', onclick: close }, glyph(GLYPHS.close, 20)),
    h('div', { class: `lib-cmp n${list.length}` }, ...list.map((it) => h('figure', {},
      it.large ? h('img', { src: `/media/${it.large}`, alt: it.name }) : h('span', { class: 'lib-none' }, glyph(GLYPHS.photo, 40)),
      facts(it)))));
  document.body.append(box);
  addEventListener('keydown', onKey);
}

function deletePart(it, p) {
  if (!confirm(`Delete this part of "${it.name}" for good (${MB(p.bytes)})? This can't be undone.`)) return;
  act(async () => { const out = await call('POST', 'library/delete', { id: it.id, part: p.part }); libraryData = null; return out; }, 'Deleted for good');
}

function deleteForGood(it, pastOnly) {
  const versions = new Set(it.uses.map((u) => u.revision)).size;
  const sure = pastOnly
    ? `Delete "${it.name}" for good?\n\nIts ${it.files} file${it.files === 1 ? '' : 's'} (${MB(it.bytes)}) go from storage, and the ${versions} version${versions === 1 ? '' : 's'} in History that use it go from History. This can't be undone.`
    : `Delete "${it.name}" for good?\n\nIts ${it.files} file${it.files === 1 ? '' : 's'} (${MB(it.bytes)}) go from storage. This can't be undone.`;
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
