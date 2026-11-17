/* Adding a painting (at the top of the Gallery view): its photo is chosen from the Library (the only place files
   come in; the Library's brush on a photo's row comes here too), its picture is made from that original in the
   browser and stored as a rendition of the photo's Library item, then the artwork, naming that rendition, is
   saved as a draft. */

import { h, toast, glyph, GLYPHS } from './dom.js';
import { state, current, paintingsIn } from './state.js';
import { call, loadLibrary } from './server.js';
import { render } from './render.js';
import { detailsFields, detailsOf, carry } from './details.js';
import { originalOf, storeImages } from './uploads.js';
import { libraryTiles, newestFirst } from './picker.js';
import { darkroom } from './picture.js';

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

let adding = null;                  // { item, dr }: the Library photo chosen and its darkroom, kept while the page re-renders
let picking = false;                // whether the Library's tiles are open

/* Start a painting from a Library photo: its original is read back from storage into the darkroom. */
function begin(it) {
  picking = false;
  const dr = darkroom();
  adding = { item: it, dr };
  dr.say('Fetching the photo from the Library…');
  (async () => {
    try {
      const blob = await originalOf(it.id);
      if (adding && adding.dr === dr) await dr.load(blob);
    } catch (e) { if (adding && adding.dr === dr) { dr.say(''); toast(e.message, true); } }
  })();
}
/* From the Library: "Make a painting" on a photo's row. */
export function paintFrom(it) { begin(it); location.hash = '#gallery'; setTimeout(() => scrollTo(0, 0), 120); }   // once the Gallery is drawn

export function addForm(secs) {
  if (!state.media) {
    return h('p', { class: 'hint' }, 'Adding paintings needs image storage (R2), which isn\'t switched on yet for this site. Everything else here works.');
  }
  if (!adding) {
    const out = [h('div', { class: 'actions top' },
      h('button', { class: 'icon-btn', 'aria-expanded': String(picking), title: 'Add a painting: choose its photo from the Library', 'aria-label': 'Add a painting from the Library',
        onclick: () => { picking = !picking; render(); } }, glyph(GLYPHS.add), glyph(GLYPHS.brush)),
      h('a', { class: 'icon-btn muted', href: '#library', title: 'Photos are uploaded in the Library: go there', 'aria-label': 'Upload in the Library' }, glyph(GLYPHS.upload)))];
    if (picking) {
      if (!state.library) { loadLibrary(); out.push(h('p', { class: 'hint' }, 'Loading the Library…')); }
      else {
        const photos = newestFirst(state.library.items.filter((it) => it.kind === 'photo'));
        out.push(photos.length
          ? libraryTiles(photos, (it) => { begin(it); render(); },
            (it) => (it.painting ? h('span', { class: 'lib-pick-mark', title: 'Already a painting (it can be another too)' }, glyph(GLYPHS.brush, 12)) : null))
          : h('p', { class: 'hint' }, 'The Library has no photos yet: upload one there first.'));
      }
    }
    return h('div', {}, ...out);
  }
  const f = {};
  const { dr, item } = adding;
  const form = h('div', { class: 'card' },
    h('div', { class: 'add-from' },
      h('span', { class: 'lib-thumb' }, item.thumb ? h('img', { src: item.thumb, alt: '' }) : glyph(GLYPHS.photo, 28)),
      h('span', { class: 'grow', title: 'Its photo, from the Library' }, item.name),
      h('button', { class: 'icon-btn', title: 'Choose a different photo, or none', 'aria-label': 'Choose a different photo',
        onclick: () => { adding = null; picking = true; render(); } }, glyph(GLYPHS.close, 16))),
    dr.el,
    h('label', {}, 'Title'), f.title = h('input', { type: 'text', autocomplete: 'off', value: item.name }),
    ...detailsFields(f, {}, () => dr.sizeChanged()),
    h('label', {}, 'Genre'), f.genre = h('select', {}, ...secs.map((s) => h('option', { value: s.id }, s.title))),
    h('label', { class: 'tick' }, f.wide = h('input', { type: 'checkbox' }), 'Wide'),
    h('div', { class: 'actions' }, f.go = h('button', { class: 'main', onclick: add }, 'Add as a draft')),
    f.progress = h('div', { id: 'upload-progress' }));
  carry(dr.fields, f);
  dr.fields = f;
  if (newGenre && [...f.genre.options].some((o) => o.value === newGenre)) { f.genre.value = newGenre; newGenre = null; }
  dr.attach(f);

  async function add() {
    if (!dr.ready) return toast('The photo isn\'t ready yet', true);
    const title = f.title.value.trim();
    if (!title) return toast('Give it a title', true);
    if (!f.genre.value) return toast('Add a genre first', true);
    const det = detailsOf(f);
    if (det.error) return toast(det.error, true);
    f.go.disabled = true;
    try {
      const name = nameFor(title);
      const say = (t) => { f.progress.textContent = t; };
      // each painting made from a photo is a recipe of its own, told apart in the Library by the painting's title
      const pic = await storeImages(item.id, null, dr.result(), dr.record(), title, say);
      const data = { name, title, ...det, genre: f.genre.value, order: paintingsIn(f.genre.value).length, wide: f.wide.checked,
        rendition: pic.id };
      await call('POST', 'save', { items: [{ id: `p-${name}`, kind: 'artwork', data }] });
      try { localStorage.setItem('editor-medium', det.medium); localStorage.setItem('editor-height', String(det.cm[0])); } catch { /* private browsing */ }
      adding = null; state.library = null;          // a fresh start, and the Library's rows to be read again
      toast(`"${title}" added as a draft`);
      render();
    } catch (e) {
      toast(e.message, true); f.progress.textContent = '';
    } finally { f.go.disabled = false; }
  }
  return form;
}
