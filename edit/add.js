/* Adding a painting (at the top of the Gallery view), and hanging one from the Library or the darkroom. The
   Gallery only arranges paintings (step 4 slice 4): a painting's picture is one already prepared in the darkroom
   (a recipe's newest rendition), chosen from tiles; nothing is uploaded or processed here. Hanging makes the
   painting at once, as a draft, at the end of a genre, titled after the picture, and opens its Edit form for
   the rest (title, medium, size, year). */

import { h, toast, glyph, GLYPHS } from './dom.js';
import { state, current, genres, paintingsIn } from './state.js';
import { save, loadLibrary } from './server.js';
import { render } from './render.js';
import { preparedPictures, preparedTiles } from './picker.js';
import { openPainting } from './painting.js';

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

let newGenre = null;                // a genre just added, for the next painting to go into
export function pickGenre(id) { newGenre = id; }

/* Hang a prepared picture (a rendition) in the Gallery: a new painting, as a draft, then to its Edit form. */
export async function hang(r, title) {
  const secs = genres();
  const genre = newGenre && secs.some((g) => g.id === newGenre) ? newGenre : secs.length ? secs[0].id : null;
  if (!genre) { toast('Add a genre in the Gallery first', true); return; }
  title = (title || 'Untitled').trim();
  const name = nameFor(title), id = `p-${name}`;
  const out = await save([{ id, kind: 'artwork', data: { name, title, genre, order: paintingsIn(genre).length, wide: false, rendition: r.id } }],
    `"${title}" hung in the Gallery as a draft: give it its details`);
  if (!out) return;
  openPainting(id);
  location.hash = '#gallery';
  setTimeout(() => { const el = document.querySelector(`[data-entry="${CSS.escape(id)}"]`); if (el) el.scrollIntoView({ block: 'center' }); }, 150);
}

let picking = false;                // whether the prepared pictures' tiles are open

export function addForm() {
  if (!state.media) {
    return h('p', { class: 'hint' }, 'Adding paintings needs image storage (R2), which isn\'t switched on yet for this site. Everything else here works.');
  }
  const out = [h('div', { class: 'actions top' },
    h('button', { class: 'icon-btn', 'aria-expanded': String(picking), title: 'Add a painting: choose its picture from those prepared in the darkroom', 'aria-label': 'Add a painting',
      onclick: () => { picking = !picking; render(); } }, glyph(GLYPHS.add), glyph(GLYPHS.frame)),
    h('a', { class: 'icon-btn muted', href: '#library', title: 'Photos are uploaded, and prepared in the darkroom, from the Library: go there', 'aria-label': 'To the Library' }, glyph(GLYPHS.upload)))];
  if (picking) {
    if (!state.library) { loadLibrary(); out.push(h('p', { class: 'hint' }, 'Loading the Library…')); }
    else {
      const list = preparedPictures(state.library.items);
      out.push(list.length
        ? preparedTiles(list, (x) => { picking = false; hang(x.r, x.recipe.label || x.it.name); })
        : h('p', { class: 'hint' }, 'Nothing prepared yet: in the Library, open a photo in the darkroom first.'));
    }
  }
  return h('div', {}, ...out);
}
