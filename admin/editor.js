/* The editor page (admin/index.html). Three views:
     #content  change the page text, sections and paintings; add a painting. Every change is saved as a draft
               at once; the preview (the site at this address) shows drafts in place.
     #review   every unpublished change, each with a tick: publish the ticked ones, or all, or discard them.
     #history  each publication, and every earlier version of anything, which can be brought back as a draft.
   It talks to editor.js on the server through /admin/api/. Page elements are built with textContent, never
   from strings of HTML, so nothing typed in can become part of the page. */

import { SOURCE_MAX, scaled, resized, whiteBalanced, fullView, sizeIn, cropSize, squaredUp } from './darkroom.js';

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
const TEXTS = [
  ['t-hero-title', 'Opening title'], ['t-gallery-title', 'Gallery heading'], ['t-gallery-button', 'Gallery button'],
  ['t-contact-title', 'Contact heading'], ['t-profile-title', 'Profile heading'],
  ['t-profile', 'Profile text (a blank line between paragraphs)', true],
];
const WIDTHS = [300, 480, 768, 1024, 1536, 2560], PREVIEW = 1200;

// ---- talking to the server ---------------------------------------------------------------------------------

async function call(method, path, body) {
  const r = await fetch(`/admin/api/${path}`, {
    method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
  });
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
  if (e.kind === 'section') return `Section: ${d.title}`;
  if (e.kind === 'text') return (TEXTS.find((t) => t[0] === e.id) || [0, e.id])[1].replace(/ \(.*/, '');
  return e.id === 'settings-gallery' ? 'Gallery settings' : 'Gallery invitation';
};

// ---- the views ---------------------------------------------------------------------------------------------

function view() { return (location.hash.slice(1) || 'content'); }
window.addEventListener('hashchange', () => { if (view() === 'history') historyData = null; render(); });

function render() {
  const n = entries.filter(changed).length;
  $('#count').hidden = !n; $('#count').textContent = n;
  document.querySelectorAll('.bar a[data-view]').forEach((a) => a.classList.toggle('on', a.dataset.view === view()));
  const main = $('#main');
  const y = scrollY;
  main.replaceChildren(...({ content: contentView, review: reviewView, history: historyView }[view()] || contentView)());
  if (view() !== 'history') scrollTo(0, y);
}

function contentView() {
  const out = [h('h1', {}, 'Content'),
    h('p', { class: 'hint' }, 'Changes are saved as drafts straight away. Visitors see them only once you publish them under Review.')];

  out.push(h('h2', {}, 'Page text'));
  for (const [id, name, long] of TEXTS) {
    const e = byId(id);
    if (!e) continue;
    const d = current(e);
    const field = h(long ? 'textarea' : 'input', { type: long ? null : 'text', value: d.text, onchange: (ev) => {
      save([{ id, kind: 'text', data: { text: ev.target.value } }]);
    } });
    out.push(h('div', {}, h('label', {}, name, ' ', badge(e)), field,
      changed(e) ? h('div', { class: 'actions' }, h('button', { onclick: () => discard([id]) }, 'Undo change')) : null));
  }

  out.push(h('h2', {}, 'Paintings'));
  const secs = sections();
  secs.forEach((s, si) => {
    const se = byId(s.id);
    const items = paintingsIn(s.id);
    const card = h('div', { class: 'card' });
    card.append(h('div', { class: 'row' },
      h('input', { type: 'text', class: 'grow', value: s.title, 'aria-label': 'Section title', onchange: (ev) => {
        save([{ id: s.id, kind: 'section', data: { title: ev.target.value, order: s.order } }]);
      } }),
      badge(se),
      h('span', { class: 'move' },
        h('button', { title: 'Move section up', disabled: si === 0, onclick: () => moveSection(secs, si, -1) }, '↑'),
        h('button', { title: 'Move section down', disabled: si === secs.length - 1, onclick: () => moveSection(secs, si, 1) }, '↓')),
      h('button', { class: 'danger', title: 'Delete section', disabled: items.some((e) => e.draft != null),
        onclick: () => { if (confirm(`Delete the section "${s.title}"?`)) save([{ id: s.id, kind: 'section', data: null }], 'Section deleted in the draft'); } }, 'Delete'),
    ));
    if (!items.length) card.append(h('p', { class: 'hint' }, 'No paintings in this section.'));
    items.forEach((e, i) => card.append(...paintingRow(e, items, i, secs)));
    out.push(card);
  });
  // sections deleted in the draft but still live
  for (const e of entries.filter((x) => x.kind === 'section' && x.draft == null)) {
    out.push(h('div', { class: 'card row' }, h('span', { class: 'grow muted' }, `${liveOf(e).title} (deleted in the draft)`), badge(e),
      h('button', { onclick: () => discard([e.id]) }, 'Keep it')));
  }
  out.push(h('div', { class: 'actions' }, h('button', { onclick: addSection }, 'Add a section')));

  out.push(h('h2', {}, 'Add a painting'));
  out.push(addForm(secs));

  return out;
}

function paintingRow(e, items, i, secs) {
  const d = current(e);
  const gone = e.draft == null;
  const row = h('div', { class: 'painting' + (gone ? ' deleted' : '') },
    h('img', { src: thumb(d), alt: '', loading: 'lazy' }),
    h('div', { class: 'what' }, h('span', { class: 't' }, d.title), h('span', { class: 'd' }, d.details || ' ')),
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
    h('label', {}, 'Details (medium, height x width cm, year)'), f.details = h('input', { type: 'text', value: d.details }),
    h('label', {}, 'Section'), f.section = h('select', {}, ...secs.map((s) => h('option', { value: s.id, selected: s.id === d.section }, s.title))),
    h('label', { class: 'tick' }, f.wide = h('input', { type: 'checkbox', checked: d.wide }), 'Wide: spans the whole width of the list'),
    h('p', { class: 'hint' }, `Address: /paintings/${d.name}/ (stays the same if the title changes)`),
    h('div', { class: 'actions' },
      h('button', { class: 'main', onclick: () => {
        const moved = f.section.value !== d.section;
        const data = { ...d, title: f.title.value, details: f.details.value, wide: f.wide.checked,
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
  const title = (prompt('Name of the new section') || '').trim();
  if (!title) return;
  const id = 's-' + Math.random().toString(36).slice(2, 10);
  save([{ id, kind: 'section', data: { title, order: sections().length } }], 'Section added');
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
        f.wholeBtn = h('button', { type: 'button', onclick: () => { pending.corners = null; update(); } }, 'Whole photo')),
      f.shapeRow = h('label', { class: 'tick' }, f.shape = h('input', { type: 'checkbox', checked: true, onchange: () => update() }),
        f.shapeText = h('span', {})),
      f.compare = h('div', { class: 'compare', title: 'Tap to make bigger or smaller', onclick: () => f.compare.classList.toggle('big') })),
    h('label', {}, 'Title'), f.title = h('input', { type: 'text', autocomplete: 'off' }),
    h('label', {}, 'Details (medium, height x width cm, year)'), f.details = h('input', { type: 'text', autocomplete: 'off',
      value: localStorage.getItem('editor-medium') || '', oninput: () => { if (pending && pending.corners) later(update); else shapeLine(); } }),
    h('label', {}, 'Section'), f.section = h('select', {}, ...secs.map((s) => h('option', { value: s.id }, s.title))),
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
    const r = await fullView(balanced().canvas, 'corners', pending.corners);
    if (r) pending.corners = r;
    update();
  }

  function balanced() {
    const p = pending, key = `${f.white.value}|${JSON.stringify(p.spots)}|${f.bright.value}|${f.warm.value}`;
    if (!p.white || p.white.key !== key) p.white = { key, ...whiteBalanced(p.src, f.white.value, p.spots, how()) };
    return p.white;
  }
  function shapeLine() {
    const size = sizeIn(f.details.value);
    f.shapeRow.hidden = !(pending && pending.corners && size);
    if (size) f.shapeText.textContent = `Squared up to the shape of the size in the details: ${size[0]} × ${size[1]} centimetres`;
    return f.shape.checked ? size : null;
  }
  const busy = (text) => { f.progress.textContent = text; return new Promise((ok) => requestAnimationFrame(() => setTimeout(ok, 30))); };

  /* Make the picture that will be uploaded from the choices, and show it beside the photo. */
  async function update() {
    const p = pending;
    if (!p) return;
    f.spotsBtn.hidden = f.white.value !== 'picks';
    f.sliders.hidden = f.white.value === 'none' || (f.white.value === 'picks' && !p.spots.length);
    f.spotsBtn.textContent = p.spots.length ? `Change white (${p.spots.length} ${p.spots.length === 1 ? 'spot' : 'spots'})…` : 'Pick white…';
    f.wholeBtn.hidden = !p.corners;
    f.cornersNote.textContent = p.corners ? 'Set: squared up' : 'Whole photo';
    const shape = shapeLine();
    await busy('Working…');
    const { canvas: wb, note } = balanced();
    let out, W = p.W, H = p.H;
    if (p.corners) {
      const q = p.corners.map(([u, v]) => [u * wb.width, v * wb.height]);
      const [cw, chh] = cropSize(q, shape), k = wb.width / p.W;      // k: working copy's pixels per original pixel
      W = Math.round(cw / k); H = Math.round(chh / k);                 // the cropped picture at the original's resolution
      const ow = Math.min(W, WIDTHS[WIDTHS.length - 1]);
      out = squaredUp(wb, q, ow, Math.max(1, Math.round(H * ow / W)));
    } else {
      out = scaled(wb, Math.min(W, WIDTHS[WIDTHS.length - 1]));
    }
    Object.assign(p, { out, outW: W, outH: H });
    const shot = (c) => { const s = scaled(c, Math.min(c.width, 1000)); s.className = 'shot'; return s; };
    const changed = f.white.value !== 'none' && p.white.canvas !== p.src || p.corners;
    f.compare.replaceChildren(...(changed
      ? [h('figure', {}, shot(p.src), h('figcaption', {}, 'Before')), h('figure', {}, shot(out), h('figcaption', {}, 'After: this is what will be added'))]
      : [h('figure', {}, shot(out), h('figcaption', {}, 'As it will be added'))]));
    f.compare.classList.toggle('one', !changed);
    f.progress.textContent = `${W} × ${H} pixels.${note ? ' ' + note : ''}`;
  }

  async function add() {
    if (!pending || !pending.out) return toast('Choose a photo first', true);
    const title = f.title.value.trim();
    if (!title) return toast('Give it a title', true);
    if (!f.section.value) return toast('Add a section first', true);
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
      const shape = pending.corners ? shapeLine() : null;
      const process = { original: `originals/${stemName}.${ext}`, white: f.white.value,
        ...(f.white.value === 'picks' ? { spots: pending.spots } : {}),
        ...(f.white.value !== 'none' ? how() : {}),
        ...(pending.corners ? { corners: pending.corners } : {}), ...(shape ? { shape } : {}) };
      const data = { name, title, details: f.details.value, section: f.section.value, order, wide: f.wide.checked,
        white_paper: f.white.value === 'paper', w: W, h: H, widths, base, ext: 'jpg',
        preview: { src: `${base}${stemName}-preview.jpg`, w: Math.min(PREVIEW, W), h: Math.round(H * Math.min(PREVIEW, W) / W) },
        file: stemName, process };
      await call('POST', 'save', { items: [{ id: `p-${name}`, kind: 'painting', data }] });
      try { localStorage.setItem('editor-medium', f.details.value.replace(/,[^,]*\d.*$/, '')); } catch { /* private browsing */ }
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
  const r = await fetch(`/admin/api/upload?key=${encodeURIComponent(key)}`, { method: 'PUT', headers: { 'content-type': type }, body: blob });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Upload failed (${r.status})`);
}

// ---- review and publish ------------------------------------------------------------------------------------

const ticked = new Set();
let ticksFor = '';

const FIELDS = { title: 'Title', details: 'Details', section: 'Section', order: 'Position', wide: 'Wide', white_paper: 'White paper', text: 'Text' };
function diffs(e) {
  const a = liveOf(e), b = draftOf(e);
  if (!a || !b) return [];
  const show = (k, v) => (k === 'section' ? ((byId(v) && current(byId(v)).title) || v) : typeof v === 'boolean' ? (v ? 'yes' : 'no') : k === 'order' ? `${v + 1}` : String(v));
  return Object.keys(b).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map((k) =>
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
        const name = v.kind === 'painting' ? what.title : v.kind === 'section' ? `Section: ${what.title}` : label({ id: v.entry_id, kind: v.kind, draft: v.data, published: v.previous });
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
