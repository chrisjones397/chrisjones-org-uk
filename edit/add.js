/* Adding a painting (the form at the top of the Gallery view): its picture is made in the browser and stored as
   a rendition of its photo's Library item, then the artwork, naming that rendition, is saved as a draft. */

import { h, toast } from './dom.js';
import { state, current, paintingsIn, picOf } from './state.js';
import { call } from './server.js';
import { render } from './render.js';
import { detailsFields, detailsOf, carry } from './details.js';
import { darkroom } from './picture.js';
import { storeImages, storedFor, keepOriginal } from './uploads.js';

function slug(t) {
  return t.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ')
    .replace(/[#,.'’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
const taken = () => new Set(state.entries.filter((e) => e.kind === 'artwork').map((e) => current(e).name));
function nameFor(title) {
  const base = slug(title) || 'painting', used = taken();
  let n = base, i = 2;
  while (used.has(n)) n = `${base}-${i++}`;
  return n;
}

let newGenre = null;                // a genre just added, for the add form to pick
export function pickGenre(id) { newGenre = id; }

let adding = null;   // the add form's darkroom, kept while the page re-renders
export function addForm(secs) {
  if (!state.media) {
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
    h('label', {}, 'Genre'), f.genre = h('select', {}, ...secs.map((s) => h('option', { value: s.id }, s.title))),
    h('label', { class: 'tick' }, f.wide = h('input', { type: 'checkbox' }), 'Wide'),
    h('div', { class: 'actions' }, f.go = h('button', { class: 'main', onclick: add }, 'Add as a draft')),
    f.progress = h('div', { id: 'upload-progress' }));
  carry(dr.fields, f);
  dr.fields = f;
  if (newGenre && [...f.genre.options].some((o) => o.value === newGenre)) { f.genre.value = newGenre; newGenre = null; }
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
      if (!known.item) { dr.note.textContent = 'A new photo: it will be uploaded when you add the painting.'; return; }
      const users = state.entries.filter((e) => e.kind === 'artwork' && current(e) && (picOf(current(e)) || {}).item === known.item)
        .map((e) => `"${current(e).title}"`);
      dr.note.textContent = `Already stored${users.length ? ` (used by ${users.join(', ')})` : ''}: it won't be uploaded again.`;
    } catch { if (dr.file === file) dr.note.textContent = ''; }   // add() checks again
  }

  async function add() {
    const file = dr.file;
    if (!file || !dr.ready) return toast('Choose a photo first', true);
    const title = f.title.value.trim();
    if (!title) return toast('Give it a title', true);
    if (!f.genre.value) return toast('Add a genre first', true);
    const det = detailsOf(f);
    if (det.error) return toast(det.error, true);
    f.go.disabled = true;
    try {
      const name = nameFor(title);
      const say = (t) => { f.progress.textContent = t; };
      const { id: item, shared } = await keepOriginal(file, title, dr.known, say);
      // a second painting from a photo already stored is a recipe of its own, told apart by the painting's title
      const pic = await storeImages(item, null, dr.result(), dr.record(), shared ? title : '', say);
      const data = { name, title, ...det, genre: f.genre.value, order: paintingsIn(f.genre.value).length, wide: f.wide.checked,
        rendition: pic.id };
      await call('POST', 'save', { items: [{ id: `p-${name}`, kind: 'artwork', data }] });
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
