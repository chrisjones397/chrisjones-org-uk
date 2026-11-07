/* The editor page (admin/index.html). Three views:
     #content  change the page text, sections and paintings; add a painting. Every change is saved as a draft
               at once; the preview (the site at this address) shows drafts in place.
     #review   every unpublished change, each with a tick: publish the ticked ones, or all, or discard them.
     #history  each publication, and every earlier version of anything, which can be brought back as a draft.
   It talks to editor.js on the server through /admin/api/. Page elements are built with textContent, never
   from strings of HTML, so nothing typed in can become part of the page. */

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
    h('label', { class: 'tick' }, f.white = h('input', { type: 'checkbox', checked: d.white_paper }), 'Drawing on white paper'),
    h('p', { class: 'hint' }, `Address: /paintings/${d.name}/ (stays the same if the title changes)`),
    h('div', { class: 'actions' },
      h('button', { class: 'main', onclick: () => {
        const moved = f.section.value !== d.section;
        const data = { ...d, title: f.title.value, details: f.details.value, wide: f.wide.checked, white_paper: f.white.checked,
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

let pending = null;   // the chosen photo, decoded
function addForm(secs) {
  if (!media) {
    return h('p', { class: 'hint' }, 'Adding paintings needs image storage (R2), which isn\'t switched on yet for this site. Everything else here works.');
  }
  const f = {};
  const form = h('div', { class: 'card' },
    h('label', {}, 'Photo, cropped to the painting'), f.file = h('input', { type: 'file', accept: 'image/*', onchange: pick }),
    h('label', {}, 'Title'), f.title = h('input', { type: 'text', autocomplete: 'off' }),
    h('label', {}, 'Details (medium, height x width cm, year)'), f.details = h('input', { type: 'text', autocomplete: 'off', value: localStorage.getItem('editor-medium') || '' }),
    h('label', {}, 'Section'), f.section = h('select', {}, ...secs.map((s) => h('option', { value: s.id }, s.title))),
    h('label', { class: 'tick' }, f.wide = h('input', { type: 'checkbox' }), 'Wide'),
    h('label', { class: 'tick' }, f.white = h('input', { type: 'checkbox', onchange: () => compare() }), 'Drawing on white paper: make the paper white'),
    f.compare = h('div', { class: 'compare', hidden: true, title: 'Tap to make bigger or smaller', onclick: () => f.compare.classList.toggle('big') }),
    h('div', { class: 'actions' }, f.go = h('button', { class: 'main', onclick: add }, 'Add as a draft')),
    f.progress = h('div', { id: 'upload-progress' }));

  async function pick() {
    pending = null;
    const file = f.file.files[0];
    if (!file) return;
    f.progress.textContent = 'Reading the photo…';
    const img = new Image();
    img.src = URL.createObjectURL(file);
    try { await img.decode(); } catch {
      f.progress.textContent = 'This browser can\'t read that photo. On a Mac, Chrome can\'t open HEIC: use Safari, or export it as JPEG.';
      return;
    }
    const W = img.naturalWidth, H = img.naturalHeight;
    // Everything is made from one copy at the largest size the site uses (a whole phone photo can be bigger
    // than Safari allows a canvas to be).
    pending = { file, img, W, H, base: scaled(img, Math.min(W, WIDTHS[WIDTHS.length - 1])), fixed: null, note: '' };
    if (!f.title.value) f.title.value = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
    compare();
  }

  /* The photo as it will be used: with "white paper" ticked, before and after side by side. */
  function compare() {
    f.compare.replaceChildren();
    f.compare.hidden = !pending;
    if (!pending) return;
    const p = pending, size = `${p.W} × ${p.H} pixels`;
    if (!f.white.checked) {
      f.compare.classList.add('one');
      f.compare.append(h('figure', {}, show(p.base), h('figcaption', {}, 'As it will be added')));
      f.progress.textContent = size;
      return;
    }
    if (!p.fixed) {
      p.fixed = scaled(p.base, p.base.width);
      const r = whitePaper(p.fixed);
      p.note = `Paper read as RGB ${r.from.join(', ')} (top left) to ${r.to.join(', ')} (bottom right), made white.`;
    }
    f.compare.classList.remove('one');
    f.compare.append(h('figure', {}, show(p.base), h('figcaption', {}, 'Before')),
      h('figure', {}, show(p.fixed), h('figcaption', {}, 'After: this is what will be added')));
    f.progress.textContent = `${size}. ${p.note}`;
  }
  const show = (c) => { const s = scaled(c, Math.min(c.width, 1000)); s.className = 'shot'; return s; };

  async function add() {
    if (!pending) return toast('Choose a photo first', true);
    const title = f.title.value.trim();
    if (!title) return toast('Give it a title', true);
    if (!f.section.value) return toast('Add a section first', true);
    f.go.disabled = true;
    try {
      const { file, W, H } = pending;
      const img = f.white.checked ? pending.fixed : pending.base;
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
        await put(`images/${fname}`, await resized(img, w), 'image/jpeg');
      }
      const order = paintingsIn(f.section.value).length;
      const data = { name, title, details: f.details.value, section: f.section.value, order, wide: f.wide.checked,
        white_paper: f.white.checked, w: W, h: H, widths, base, ext: 'jpg',
        preview: { src: `${base}${stemName}-preview.jpg`, w: Math.min(PREVIEW, W), h: Math.round(H * Math.min(PREVIEW, W) / W) },
        file: stemName };
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

/* The picture (an image or a canvas) drawn at width w on a canvas, halving in steps for a smooth result. */
function scaled(src, w) {
  let sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height;
  const th = Math.max(1, Math.round(sh * w / sw));
  while (sw / 2 >= w * 1.0001) {
    const c = h('canvas', { width: Math.round(sw / 2), height: Math.round(sh / 2) });
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, c.width, c.height);
    src = c; sw = c.width; sh = c.height;
  }
  const c = h('canvas', { width: w, height: th });
  const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, w, th);
  return c;
}

/* A JPEG of the picture at width w. (Safari can't write WebP from a page, so uploads are JPEG.) */
function resized(src, w) {
  const c = scaled(src, w);
  return new Promise((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error('Couldn\'t make an image size'))), 'image/jpeg', 0.88));
}

/* A drawing on white paper, white balanced in place so the paper comes out pure white everywhere: the same
   method as build_site.py's white_paper(). The paper's colour is read all round the outer edges (a band 2% of
   the shorter side deep, in 16 lengths along each side, on a copy 512 pixels across; the median of each, so
   smudges don't count). Phone photos are lit unevenly, so the paper's colour inside is filled in smoothly from
   the edges (a Coons patch: each point blends the four sides by how near it is to them), and every pixel is
   divided by the paper's colour where it is. That takes out the light's colour cast, its greyness and its
   fall-off across the sheet together. Returns the paper's colour at the top left and bottom right corners. */
function whitePaper(c) {
  const W = c.width, H = c.height, n = 16;
  const small = scaled(c, Math.max(1, Math.round(W * 512 / Math.max(W, H))));
  const sw = small.width, sh = small.height, px = small.getContext('2d').getImageData(0, 0, sw, sh).data;
  const b = Math.max(3, Math.round(Math.min(sw, sh) * 0.02));
  const median = (x0, y0, x1, y1) => {
    const hist = [0, 1, 2].map(() => new Uint32Array(256));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * sw + x) * 4; hist[0][px[i]]++; hist[1][px[i + 1]]++; hist[2][px[i + 2]]++;
    }
    const half = (x1 - x0) * (y1 - y0) / 2;
    return hist.map((counts) => { let t = 0, v = 0; while (v < 255 && (t += counts[v]) < half) v++; return Math.max(1, v); });
  };
  const cuts = (len) => Array.from({ length: n }, (_, i) => [Math.floor(len * i / n), Math.floor(len * (i + 1) / n)]);
  const xs = cuts(sw), ys = cuts(sh);
  const top = xs.map(([a, z]) => median(a, 0, z, b)), bottom = xs.map(([a, z]) => median(a, sh - b, z, sh));
  const left = ys.map(([a, z]) => median(0, a, b, z)), right = ys.map(([a, z]) => median(sw - b, a, sw, z));
  const avg = (p, q) => p.map((v, k) => (v + q[k]) / 2);
  const c00 = avg(top[0], left[0]), c10 = avg(top[n - 1], right[0]), c01 = avg(bottom[0], left[n - 1]), c11 = avg(bottom[n - 1], right[n - 1]);
  const gain = new Float32Array(n * n * 3);          // 255 / the paper's colour, at the centre of each of n x n cells
  for (let j = 0; j < n; j++) {
    const v = (j + 0.5) / n;
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      for (let k = 0; k < 3; k++) {
        const paper = (1 - v) * top[i][k] + v * bottom[i][k] + (1 - u) * left[j][k] + u * right[j][k]
          - ((1 - u) * (1 - v) * c00[k] + u * (1 - v) * c10[k] + (1 - u) * v * c01[k] + u * v * c11[k]);
        gain[(j * n + i) * 3 + k] = 255 / Math.max(paper, 1);
      }
    }
  }
  // Spread the gains smoothly over the whole picture (bilinear, like the build's resize) and apply them.
  const where = (x, len) => { const g = Math.min(n - 1, Math.max(0, (x + 0.5) * n / len - 0.5)); const a = Math.min(n - 2, Math.floor(g)); return [a, g - a]; };
  const colA = new Int32Array(W), colT = new Float32Array(W);
  for (let x = 0; x < W; x++) { const [a, t] = where(x, W); colA[x] = a; colT[x] = t; }
  const ctx = c.getContext('2d'), im = ctx.getImageData(0, 0, W, H), d = im.data, row = new Float32Array(n * 3);
  for (let y = 0; y < H; y++) {
    const [a, t] = where(y, H);
    for (let q = 0; q < n * 3; q++) row[q] = gain[a * n * 3 + q] * (1 - t) + gain[(a + 1) * n * 3 + q] * t;
    let i = y * W * 4;
    for (let x = 0; x < W; x++, i += 4) {
      const o = colA[x] * 3, s = colT[x];
      d[i] = d[i] * (row[o] * (1 - s) + row[o + 3] * s);
      d[i + 1] = d[i + 1] * (row[o + 1] * (1 - s) + row[o + 4] * s);
      d[i + 2] = d[i + 2] * (row[o + 2] * (1 - s) + row[o + 5] * s);
    }
  }
  ctx.putImageData(im, 0, 0);
  return { from: c00.map(Math.round), to: c11.map(Math.round) };
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
