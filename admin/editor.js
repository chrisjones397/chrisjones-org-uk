/* The editor page (admin/index.html). Three views:
     #gallery  add a painting (at the top), and change the genres and paintings
     #content  change the page's words, section by section. Every change is saved as a draft
               at once; the preview (the site at this address) shows drafts in place.
     #review   every unpublished change, each with a tick: publish the ticked ones, or all, or discard them.
     #history  each publication, and every earlier version of anything, which can be brought back as a draft.
   It talks to editor.js on the server through /admin/api/. Page elements are built with textContent, never
   from strings of HTML, so nothing typed in can become part of the page. */

import { SOURCE_MAX, scaled, resized, whiteBalanced, fullView, cropSize, squaredUp, guessCorners, turnOf, describeTurn, wholePhoto, labelled, ordered, FRAME } from './darkroom.js';

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
  { name: 'Hero', heading: 't-hero-title', paras: 't-hero' },
  { name: 'Gallery', heading: 't-gallery-title', extra: [['t-gallery-button', 'Button']], paras: 't-gallery' },
  { name: 'Contact', heading: 't-contact-title', paras: 't-contact' },
  { name: 'Profile', heading: 't-profile-title', paras: 't-profile' },
  { name: 'Footer', paras: 't-footer' },
];
const TEXTS = PAGE.flatMap((p) => [
  ...(p.heading ? [[p.heading, `${p.name} heading`]] : []), ...(p.extra || []).map(([id, n]) => [id, `${p.name} ${n.toLowerCase()}`]),
  [p.paras, `${p.name} paragraphs`]]);
const WIDTHS = [300, 480, 768, 1024, 1536, 2560], PREVIEW = 1200;

// ---- talking to the server ---------------------------------------------------------------------------------

/* fetch, giving up after ms (a dropped phone signal can otherwise leave a request, and a disabled button,
   waiting for ever). */
async function fetchFor(url, opts, ms) {
  try { return await fetch(url, { ...opts, signal: AbortSignal.timeout(ms) }); }
  catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') throw new Error('No answer from the server: check the signal and try again');
    throw new Error('Couldn\'t reach the server: check the signal and try again');
  }
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
  return e.id === 'settings-gallery' ? 'Gallery settings' : 'Gallery invitation';
};

// ---- the views ---------------------------------------------------------------------------------------------

function view() { return (location.hash.slice(1) || 'gallery'); }
window.addEventListener('hashchange', () => { if (view() === 'history') historyData = null; render(); });

function render() {
  const n = entries.filter(changed).length;
  $('#count').hidden = !n; $('#count').textContent = n;
  document.querySelectorAll('.bar a[data-view]').forEach((a) => a.classList.toggle('on', a.dataset.view === view()));
  const main = $('#main');
  const y = scrollY;
  main.replaceChildren(...({ gallery: galleryView, content: contentView, review: reviewView, history: historyView }[view()] || galleryView)());
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
    out.push(card);
  }
  return out;
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
            pic = { ...(await storeImages(stem, re.dr.result(), (t) => re.dr.say(t))),
              white_paper: re.dr.white === 'paper', process: re.dr.record(re.dr.original) };
          } catch (err) { f.go.disabled = false; re.dr.say(''); return toast(err.message, true); }
        }
        const data = { ...rest, title: f.title.value, ...det, wide: f.wide.checked,
          section: f.section.value, order: moved ? paintingsIn(f.section.value).length : d.order, ...pic };
        open.delete(e.id); reopened.delete(e.id);
        save([{ id: e.id, kind: 'painting', data }], pic.file ? 'Saved, with the new picture' : undefined);
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
   original's { blob, original key }). */
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
          g.white = h('select', { class: 'grow', onchange: () => { if (!p) return; if (g.white.value === 'picks' && !p.spots.length) pickSpots(); else update(); } },
            h('option', { value: 'none' }, 'None: as photographed'),
            h('option', { value: 'paper' }, 'Paper all round: a drawing on white paper'),
            h('option', { value: 'picks' }, 'From white I pick on the photo')),
          g.spotsBtn = h('button', { type: 'button', onclick: () => pickSpots() }, 'Pick white…')),
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
      g.back = h('button', { type: 'button', hidden: true, title: 'Put every choice back as it was saved', onclick: () => { if (p) { apply(startWith); update(); } } }, 'Back to saved')));
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
    if (!reopen || p || fetching) return;
    fetching = (async () => {
      g.status.textContent = 'Fetching the original…';
      try {
        const got = await opts.fetch();
        original = got.original;
        if (!(await load(got.blob, opts.start))) throw new Error('This browser can\'t read the original');
      } catch (err) {
        g.status.textContent = ''; g.whiteBox.open = g.cornerBox.open = false; toast(err.message, true);
      } finally { fetching = null; }
    })();
  }

  /* Read a photo (a File, or the original's Blob from R2). With a process record, its choices are put back as
     they were; without one, it starts from the best guess at the painting's corners. */
  async function load(blob, start = {}) {
    p = null; baseline = ''; saved = null;
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
    p = { W, H, src: scaled(img, Math.round(W * k)), spots: [], corners: null, white: null };
    URL.revokeObjectURL(img.src);
    p.guess = guessCorners(p.src);
    startWith = start;
    apply(start);
    g.whiteBody.disabled = g.cornerBody.disabled = false;
    g.steps.hidden = false;
    if (!reopen) g.whiteBox.open = g.cornerBox.open = true;          // adding: both open
    await update();
    baseline = JSON.stringify(record(''));
    if (reopen) { saved = JSON.parse(baseline); ghosts(); }
    g.back.hidden = true;
    return true;
  }
  /* Put the controls to the choices load() was given. */
  function apply({ process, white = 'none', guess = true } = {}) {
    if (process) {
      g.white.value = process.white; p.spots = (process.spots || []).map((q) => q.slice());
      g.bright.value = Math.round((process.brightness ?? 1) * 100); g.warm.value = Math.round((process.warmth ?? 0) * 100);
      p.corners = process.corners ? process.corners.map((q) => q.slice()) : null;
      g.shape.checked = !!process.shape || !process.corners;      // as it was made
    } else {
      g.white.value = white; p.spots = []; g.bright.value = 100; g.warm.value = 0; g.shape.checked = true;
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
    const r = await fullView(p.src, 'spots', p.spots, null, saved && saved.spots);
    if (r) p.spots = r;
    if (!p.spots.length && g.white.value === 'picks') g.white.value = 'none';
    update();
  }
  async function setCorners() {
    if (!p) return;
    await busy('Getting the full-size view ready…');
    const r = await fullView(balanced().canvas, 'corners', p.corners, p.guess, saved && saved.corners);
    if (r) {
      const t = turnOf(r);
      p.corners = wholePhoto(r) && !t.r && !t.m ? null : r;          // the whole photo, as it is: nothing to do
    }
    update();
  }
  function balanced() {
    const key = `${g.white.value}|${JSON.stringify(p.spots)}|${g.bright.value}|${g.warm.value}`;
    if (!p.white || p.white.key !== key) p.white = { key, ...whiteBalanced(p.src, g.white.value, p.spots, how()) };
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
    g.spotsBtn.hidden = g.white.value !== 'picks';
    g.sliders.hidden = g.white.value === 'none' || (g.white.value === 'picks' && !p.spots.length);
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
    if (saved) g.back.hidden = JSON.stringify(now) === baseline;
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
    return { original, white: g.white.value,
      ...(g.white.value === 'picks' ? { spots: p.spots } : {}),
      ...(g.white.value !== 'none' ? how() : {}),
      ...(p.corners ? { corners: p.corners } : {}), ...(shape ? { shape } : {}) };
  }
  return {
    el, load, record, shapeLine,
    attach(f) { F = f; },
    sizeChanged() { if (p) later(update); else shapeLine(); },
    get ready() { return !!(p && p.out); },
    get white() { return g.white.value; },
    get original() { return original; },
    result() { return { out: p.out, W: p.outW, H: p.outH }; },
    changed() { return !!p && JSON.stringify(record('')) !== baseline; },   // since it was loaded
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

async function put(key, blob, type) {
  const r = await fetchFor(`/admin/api/upload?key=${encodeURIComponent(key)}`, { method: 'PUT', headers: { 'content-type': type }, body: blob }, 120000);
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

const FIELDS = { title: 'Title', medium: 'Medium', cm: 'Size', year: 'Year', estimated: 'Not measured', size_shown: 'Size shown', section: 'Genre', order: 'Position', wide: 'Wide', white_paper: 'White paper', text: 'Text' };
function diffs(e) {
  const a = liveOf(e), b = draftOf(e);
  if (!a || !b) return [];
  const show = (k, v) => (v == null || v === '' ? '(none)' : k === 'section' ? ((byId(v) && current(byId(v)).title) || v)
    : k === 'cm' ? `${v[0]} × ${v[1]} cm` : typeof v === 'boolean' ? (v ? 'yes' : 'no') : k === 'order' ? `${v + 1}` : String(v));
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

// ---- start -------------------------------------------------------------------------------------------------

call('GET', 'state').then((d) => { media = d.media; who = d.who; render(); })
  .catch((e) => { $('#main').replaceChildren(h('p', {}, `Couldn't load the content: ${e.message}`)); });
