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
  out.push(h('div', { class: 'actions' }, h('button', { onclick: addSection }, 'Add a genre')));

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
   from them). d: the painting's data, or {} for a new one, which starts with the last medium and height used. */
function detailsFields(f, d, onSize) {
  const media = [...new Set(entries.filter((e) => e.kind === 'painting' && current(e)).map((e) => current(e).medium).filter(Boolean))].sort();
  const listId = `media-${Math.random().toString(36).slice(2, 8)}`;
  const old = !d.cm && d.details ? /^(.*?),\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*cm(?:,\s*(.*))?$/i.exec(d.details) : null;
  const remembered = (k, dflt) => { try { return localStorage.getItem(k) || dflt; } catch { return dflt; } };
  const isNew = !d.title;
  const num = (value, label) => h('label', { class: 'num' }, label,
    h('input', { type: 'number', inputmode: 'decimal', min: '0.1', step: '0.1', value, oninput: onSize }));
  const out = [
    h('label', {}, 'Medium'),
    f.medium = h('input', { type: 'text', autocomplete: 'off', list: listId,
      value: d.medium ?? (old ? old[1] : isNew ? remembered('editor-medium', '') : d.details || '') }),
    h('datalist', { id: listId }, ...media.map((m) => h('option', { value: m }))),
    h('div', { class: 'row size' },
      f.hBox = num(d.cm ? d.cm[0] : old ? old[2] : isNew ? remembered('editor-height', '60') : '', 'Height (cm)'),
      f.wBox = num(d.cm ? d.cm[1] : old ? old[3] : '', 'Width (cm)'),
      f.yBox = h('label', { class: 'num' }, 'Year', h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off',
        value: d.year ?? (old ? old[4] || '' : isNew ? String(new Date().getFullYear()) : '') }))),
    h('label', { class: 'tick' }, f.estimated = h('input', { type: 'checkbox', checked: !!d.estimated, onchange: onSize }),
      'Size estimated: used for the shape and the gallery, not shown to visitors until measured'),
  ];
  f.height = f.hBox.querySelector('input'); f.width = f.wBox.querySelector('input'); f.year = f.yBox.querySelector('input');
  return out;
}
/* The fields' values, or an error message. */
function detailsOf(f) {
  const hgt = parseFloat(f.height.value), wid = parseFloat(f.width.value);
  if (!(hgt > 0) || !(wid > 0)) return { error: 'Give the height and width in centimetres' };
  return { medium: f.medium.value.trim(), cm: [Math.round(hgt * 10) / 10, Math.round(wid * 10) / 10], year: f.year.value.trim(),
    ...(f.estimated.checked ? { estimated: true } : {}) };
}

function paintingRow(e, items, i, secs) {
  const d = current(e);
  const gone = e.draft == null;
  const row = h('div', { class: 'painting' + (gone ? ' deleted' : '') },
    h('img', { src: thumb(d), alt: '', loading: 'lazy' }),
    h('div', { class: 'what' }, h('span', { class: 't' }, d.title),
      h('span', { class: 'd' }, d.details || ' ', d.estimated ? h('span', { class: 'muted' }, ` (size estimated: ${d.cm[0]} × ${d.cm[1]} cm)`) : null)),
    badge(e),
    gone ? h('button', { onclick: () => discard([e.id]) }, 'Keep it')
      : h('span', { class: 'move' },
        h('button', { title: 'Move up', disabled: i === 0, onclick: () => movePainting(items, i, -1) }, '↑'),
        h('button', { title: 'Move down', disabled: i === items.length - 1, onclick: () => movePainting(items, i, 1) }, '↓'),
        h('button', { onclick: () => { open.has(e.id) ? open.delete(e.id) : open.add(e.id); render(); } }, open.has(e.id) ? 'Close' : 'Edit')));
  if (gone || !open.has(e.id)) return [row];

  const f = {};
  const form = h('div', { class: 'edit' },
    h('label', {}, 'Title'), f.title = h('input', { type: 'text', value: d.title }),
    ...detailsFields(f, d),
    h('label', {}, 'Genre'), f.section = h('select', {}, ...secs.map((s) => h('option', { value: s.id, selected: s.id === d.section }, s.title))),
    h('label', { class: 'tick' }, f.wide = h('input', { type: 'checkbox', checked: d.wide }), 'Wide: spans the whole width of the list'),
    h('p', { class: 'hint' }, `Address: /paintings/${d.name}/ (stays the same if the title changes)`),
    h('div', { class: 'actions' },
      h('button', { class: 'main', onclick: () => {
        const moved = f.section.value !== d.section, det = detailsOf(f);
        if (det.error) return toast(det.error, true);
        const { estimated, ...rest } = d;                // dropped unless still ticked
        const data = { ...rest, title: f.title.value, ...det, wide: f.wide.checked,
          section: f.section.value, order: moved ? paintingsIn(f.section.value).length : d.order };
        open.delete(e.id);
        save([{ id: e.id, kind: 'painting', data }]);
      } }, 'Save draft'),
      changed(e) ? h('button', { onclick: () => discard([e.id]) }, 'Undo changes') : null,
      h('button', { class: 'danger', onclick: () => { if (confirm(`Delete "${d.title}"? It stays on the site until you publish.`)) { open.delete(e.id); save([{ id: e.id, kind: 'painting', data: null }], 'Deleted in the draft'); } } }, 'Delete')));
  return [row, form];
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
  save([{ id, kind: 'section', data: { title, order: sections().length } }], 'Genre added');
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

let pending = null;   // the chosen photo, its working copy and the choices made for it
function addForm(secs) {
  if (!media) {
    return h('p', { class: 'hint' }, 'Adding paintings needs image storage (R2), which isn\'t switched on yet for this site. Everything else here works.');
  }
  const f = {};
  const form = h('div', { class: 'card' },
    h('label', {}, 'Photo of the painting'), f.file = h('input', { type: 'file', accept: 'image/*', onchange: pick }),
    f.steps = h('div', { class: 'steps', hidden: true },
      h('label', {}, 'White balance'),
      h('div', { class: 'row' },
        f.white = h('select', { class: 'grow', onchange: () => { if (f.white.value === 'picks' && !pending.spots.length) pickSpots(); else update(); } },
          h('option', { value: 'none' }, 'None: as photographed'),
          h('option', { value: 'paper' }, 'Paper all round: a drawing on white paper'),
          h('option', { value: 'picks' }, 'From white I pick on the photo')),
        f.spotsBtn = h('button', { type: 'button', onclick: () => pickSpots() }, 'Pick white…')),
      f.sliders = h('div', { class: 'sliders' },
        h('label', {}, 'Brightness of the white ', f.brightOut = h('span', { class: 'muted' })),
        f.bright = h('input', { type: 'range', min: 50, max: 100, step: 1, value: 100, oninput: () => slid() }),
        h('label', {}, 'Keep the light\'s warmth ', f.warmOut = h('span', { class: 'muted' })),
        f.warm = h('input', { type: 'range', min: 0, max: 100, step: 1, value: 0, oninput: () => slid() })),
      h('label', {}, 'Corners'),
      h('div', { class: 'row' },
        f.cornersNote = h('span', { class: 'grow muted' }),
        h('button', { type: 'button', onclick: () => setCorners() }, 'Set corners…'),
        f.wholeBtn = h('button', { type: 'button', onclick: () => {
          const t = turnOf(pending.corners);                            // keep which way up, take in the whole photo
          pending.corners = t.r || t.m ? labelled(ordered(FRAME), t.r, t.m) : null; update();
        } }, 'Whole photo')),
      f.shapeRow = h('label', { class: 'tick' }, f.shape = h('input', { type: 'checkbox', checked: true, onchange: () => update() }),
        f.shapeText = h('span', {})),
      f.compare = h('div', { class: 'compare', title: 'Tap to make bigger or smaller', onclick: () => f.compare.classList.toggle('big') })),
    h('label', {}, 'Title'), f.title = h('input', { type: 'text', autocomplete: 'off' }),
    ...detailsFields(f, {}, () => {
      if (document.activeElement === f.width && f.width.classList.contains('suggested')) {   // typed: measured, not a suggestion
        f.width.classList.remove('suggested'); f.estimated.checked = false;
      }
      if (pending) later(update); else shapeLine();
    }),
    h('label', {}, 'Genre'), f.section = h('select', {}, ...secs.map((s) => h('option', { value: s.id }, s.title))),
    h('label', { class: 'tick' }, f.wide = h('input', { type: 'checkbox' }), 'Wide'),
    h('div', { class: 'actions' }, f.go = h('button', { class: 'main', onclick: add }, 'Add as a draft')),
    f.progress = h('div', { id: 'upload-progress' }));
  let timer;
  const later = (fn, ms = 500) => { clearTimeout(timer); timer = setTimeout(fn, ms); };
  const how = () => ({ brightness: +f.bright.value / 100, warmth: +f.warm.value / 100 });
  function slid() {
    f.brightOut.textContent = `${f.bright.value}%: ${+f.bright.value === 100 ? 'pure white' : 'a light grey'}`;
    f.warmOut.textContent = `${f.warm.value}%${+f.warm.value === 0 ? ': cast fully removed' : ''}`;
    later(update, 250);
  }
  slid(); clearTimeout(timer);

  async function pick() {
    pending = null; f.steps.hidden = true;
    const file = f.file.files[0];
    if (!file) return;
    f.progress.textContent = 'Reading the photo…';
    const img = new Image();
    img.src = URL.createObjectURL(file);
    try { await img.decode(); } catch {
      f.progress.textContent = 'This browser can\'t read that photo. On a Mac, Chrome can\'t open HEIC: use Safari, or export it as JPEG.';
      return;
    }
    const W = img.naturalWidth, H = img.naturalHeight, k = Math.min(1, SOURCE_MAX / Math.max(W, H));
    // One working copy, at most SOURCE_MAX pixels along its longer side: everything is made from it.
    pending = { file, W, H, src: scaled(img, Math.round(W * k)), spots: [], corners: null, white: null };
    // Start from the best guess at the painting's corners, so the result shows straight away as it will be.
    pending.guess = guessCorners(pending.src);
    if (pending.guess && !wholePhoto(pending.guess)) pending.corners = pending.guess;
    f.white.value = 'none'; f.bright.value = 100; f.warm.value = 0; slid(); clearTimeout(timer);
    if (!f.title.value) f.title.value = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
    f.steps.hidden = false;
    update();
  }

  async function pickSpots() {
    const r = await fullView(pending.src, 'spots', pending.spots);
    if (r) pending.spots = r;
    if (!pending.spots.length && f.white.value === 'picks') f.white.value = 'none';
    update();
  }
  async function setCorners() {
    await busy('Getting the full-size view ready…');
    const r = await fullView(balanced().canvas, 'corners', pending.corners, pending.guess);
    if (r) {
      const t = turnOf(r);
      pending.corners = wholePhoto(r) && !t.r && !t.m ? null : r;    // the whole photo, as it is: nothing to do
    }
    update();
  }

  function balanced() {
    const p = pending, key = `${f.white.value}|${JSON.stringify(p.spots)}|${f.bright.value}|${f.warm.value}`;
    if (!p.white || p.white.key !== key) p.white = { key, ...whiteBalanced(p.src, f.white.value, p.spots, how()) };
    return p.white;
  }
  function shapeLine() {
    const det = detailsOf(f), size = det.error ? null : det.cm;
    f.shapeRow.hidden = !(pending && cropped() && size);
    if (size) f.shapeText.textContent = `Squared up to the shape of its size: ${size[0]} × ${size[1]} centimetres`;
    return f.shape.checked && cropped() ? size : null;
  }
  const cropped = () => !!(pending && pending.corners && !wholePhoto(pending.corners));
  const busy = (text) => { f.progress.textContent = text; return new Promise((ok) => requestAnimationFrame(() => setTimeout(ok, 30))); };

  /* Make the picture that will be uploaded from the choices, and show it beside the photo. */
  async function update() {
    const p = pending;
    if (!p) return;
    f.spotsBtn.hidden = f.white.value !== 'picks';
    f.sliders.hidden = f.white.value === 'none' || (f.white.value === 'picks' && !p.spots.length);
    f.spotsBtn.textContent = p.spots.length ? `Change white (${p.spots.length} ${p.spots.length === 1 ? 'spot' : 'spots'})…` : 'Pick white…';
    f.wholeBtn.hidden = !cropped();
    const turned = p.corners ? describeTurn(turnOf(p.corners)) : '';
    f.cornersNote.textContent = (cropped() ? 'Cropped and squared up' : 'Whole photo') + (turned ? `, ${turned}` : '');
    // Suggest the width from the height and the picture's proportions (after cropping and turning), unless a
    // width has been typed. A photo taken a little from one side can be a few per cent out, so it's a suggestion.
    const hgt = parseFloat(f.height.value);
    if (hgt > 0 && (!f.width.value || f.width.classList.contains('suggested'))) {
      let ratio = p.W / p.H;
      if (p.corners) { const [a, b] = cropSize(p.corners.map(([u, v]) => [u * p.W, v * p.H]), null, [p.W / 2, p.H / 2]); ratio = a / b; }
      f.width.value = String(Math.round(hgt * ratio)); f.width.classList.add('suggested'); f.estimated.checked = true;
    }
    const shape = shapeLine();
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
      const s = scaled(c, Math.min(c.width, 800)); s.className = 'shot';
      if (quad) {                                                    // the corners, outlined on the photo
        const x = s.getContext('2d'), q = quad.map(([u, v]) => [u * s.width, v * s.height]);
        x.beginPath(); x.moveTo(...q[0]); q.slice(1).forEach((pt) => x.lineTo(...pt)); x.closePath();
        x.lineWidth = Math.max(2, s.width / 300); x.strokeStyle = 'rgba(0,0,0,0.6)'; x.stroke();
        x.lineWidth /= 2; x.strokeStyle = '#fff'; x.stroke();
        x.beginPath(); x.moveTo(...q[3]); x.lineTo(...q[2]); x.lineWidth *= 2; x.strokeStyle = '#f5c66b'; x.stroke();   // the bottom
      }
      return s;
    };
    f.compare.replaceChildren(h('figure', {}, shot(p.src, p.corners), h('figcaption', {}, 'Before')),
      h('figure', {}, shot(out), h('figcaption', {}, 'After: this is what will be added')));
    f.compare.classList.remove('one');
    f.progress.textContent = `${W} × ${H} pixels.${note ? ' ' + note : ''}`;
  }

  async function add() {
    if (!pending || !pending.out) return toast('Choose a photo first', true);
    const title = f.title.value.trim();
    if (!title) return toast('Give it a title', true);
    if (!f.section.value) return toast('Add a genre first', true);
    const det = detailsOf(f);
    if (det.error) return toast(det.error, true);
    f.go.disabled = true;
    try {
      const { file, out, outW: W, outH: H } = pending;
      const name = nameFor(title);
      const { file: stemName } = await call('GET', `free?name=${encodeURIComponent(name)}`);
      const base = 'media/images/';
      const widths = [...new Set(WIDTHS.filter((w) => w < W).concat(Math.min(W, WIDTHS[WIDTHS.length - 1])))];
      const jobs = widths.map((w) => [`${stemName}-${w}.jpg`, w]).concat([[`${stemName}-preview.jpg`, Math.min(PREVIEW, W)]]);
      let done = 0;
      const ext = (file.name.match(/\.([a-z0-9]+)$/i) || [0, 'jpg'])[1].toLowerCase();
      f.progress.textContent = 'Keeping the original…';
      await put(`originals/${stemName}.${ext}`, file, file.type || 'image/jpeg');
      for (const [fname, w] of jobs) {
        f.progress.textContent = `Making and uploading image sizes: ${++done} of ${jobs.length}`;
        await put(`images/${fname}`, await resized(out, Math.min(w, out.width)), 'image/jpeg');
      }
      const order = paintingsIn(f.section.value).length;
      const shape = shapeLine();
      const process = { original: `originals/${stemName}.${ext}`, white: f.white.value,
        ...(f.white.value === 'picks' ? { spots: pending.spots } : {}),
        ...(f.white.value !== 'none' ? how() : {}),
        ...(pending.corners ? { corners: pending.corners } : {}), ...(shape ? { shape } : {}) };
      const data = { name, title, ...det, section: f.section.value, order, wide: f.wide.checked,
        white_paper: f.white.value === 'paper', w: W, h: H, widths, base, ext: 'jpg',
        preview: { src: `${base}${stemName}-preview.jpg`, w: Math.min(PREVIEW, W), h: Math.round(H * Math.min(PREVIEW, W) / W) },
        file: stemName, process };
      await call('POST', 'save', { items: [{ id: `p-${name}`, kind: 'painting', data }] });
      try { localStorage.setItem('editor-medium', det.medium); localStorage.setItem('editor-height', String(det.cm[0])); } catch { /* private browsing */ }
      pending = null;
      toast(`"${title}" added as a draft`);
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
}

// ---- review and publish ------------------------------------------------------------------------------------

const ticked = new Set();
let ticksFor = '';

const FIELDS = { title: 'Title', medium: 'Medium', cm: 'Size', year: 'Year', estimated: 'Size estimated', section: 'Genre', order: 'Position', wide: 'Wide', white_paper: 'White paper', text: 'Text' };
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
