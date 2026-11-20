/* A painting (an artwork) in the Gallery view: its row, its Edit form (each field saves itself), its star, and
   its picture (chosen from those prepared in the darkroom, which is a view of its own). */

import { detailsLine } from '/paths.js';
import { h, glyph, GLYPHS } from './dom.js';
import { state, byId, draftOf, changed, current, isHidden, paintingsIn, thumb, picOf, pictureAt } from './state.js';
import { save, discard, beforeDiscard, loadLibrary } from './server.js';
import { render } from './render.js';
import { badge, hideButton } from './widgets.js';
import { detailsFields, detailsOf, carry, sizeNote } from './details.js';
import { preparedPictures, preparedTiles } from './picker.js';
import { grip } from './drag.js';

const open = new Set();             // paintings whose edit form is open
const editFields = new Map();       // painting id -> its Edit form's fields, while open

/* Discarding a painting's changes: an open Edit form starts again from the published version. */
beforeDiscard.add((ids) => { for (const id of ids) editFields.delete(id); });

/* Open a painting's Edit form (the Library's uses marks lead here). */
export function openPainting(id) { open.add(id); }

export function paintingRow(e, secs) {
  const d = current(e);
  const gone = e.draft == null;
  const row = h('div', { class: 'painting' + (gone ? ' deleted' : '') + (isHidden(e) ? ' hidden' : ''), 'data-entry': e.id },
    gone ? h('span', { class: 'grip-space' }) : grip('painting', e.id, 'this painting'),
    h('img', { src: thumb(d), alt: '', loading: 'lazy' }),
    h('div', { class: 'what' }, h('span', { class: 't' }, d.title),
      h('span', { class: 'd' }, detailsLine(d) || ' ', sizeNote(d))),
    badge(e),
    gone ? h('button', { onclick: () => discard([e.id]) }, 'Keep it')
      : h('span', { class: 'move' },
        starButton(e),
        hideButton(e, 'this painting'),
        h('button', { onclick: () => { if (open.has(e.id)) closeEdit(e.id); else open.add(e.id); render(); } }, open.has(e.id) ? 'Close' : 'Edit')));
  if (gone || !open.has(e.id)) { editFields.delete(e.id); return [row]; }

  /* One saving rule: each field saves the painting as a draft as soon as it's changed (a tick beside it), and a
     change to the picture is made and stored by itself (pictureChanged, below). No Save button. */
  const f = {}, k = (name) => `${e.id}:${name}`;
  const form = h('div', { class: 'edit' },
    h('label', {}, 'Title'), f.title = h('input', { type: 'text', value: d.title }),
    ...detailsFields(f, d),
    h('label', {}, 'Genre'), f.genre = h('select', {}, ...secs.map((s) => h('option', { value: s.id, selected: s.id === d.genre }, s.title))),
    h('label', { class: 'tick' }, f.wide = h('input', { type: 'checkbox', checked: d.wide }), 'Wide: spans the whole width of the list'),
    ...pictureFields(e, d),
    h('p', { class: 'hint' }, `Address: /gallery/${d.name}/ (stays the same if the title changes)`),
    h('div', { class: 'actions' },
      // never published: undoing would take it away altogether, which is what Remove (with its question) is for
      changed(e) && e.published != null ? h('button', { onclick: () => discard([e.id]) }, 'Undo changes') : null,
      h('button', { class: 'danger', title: 'Take it out of the gallery: its photo stays in the Library',
        onclick: () => { if (confirm(`Remove "${d.title}" from the gallery? Its photo stays in the Library, and it stays on the site until you publish.`)) { closeEdit(e.id); save([{ id: e.id, kind: 'artwork', data: null }], 'Removed in the draft'); } } }, 'Remove')));
  for (const [name, el] of [['title', f.title], ['medium', f.medium], ['height', f.height], ['width', f.width], ['year', f.year],
    ['genre', f.genre], ['wide', f.wide], ['measured', f.measured], ['estimated', f.estimated], ['shown', f.shown]]) {
    el.dataset.k = k(name);
    el.addEventListener('change', () => savePainting(e.id, f, k(name)));
  }
  const pic = picOf(d);
  if (pic && (!d.cm || d.estimated)) f.ratio = pic.w / pic.h;   // not measured: the side not typed follows its picture's proportions
  carry(editFields.get(e.id), f);
  editFields.set(e.id, f);
  return [row, form];
}

/* The star: Featured. A featured painting hangs on the home page's wall (and stands in there for visitors without
   3D); the gallery page always has every painting. A change like any other: saved as a draft at once, published
   from Review. */
function starButton(e) {
  const on = !!current(e).featured, key = `${e.id}:featured`;
  return h('button', { class: 'star' + (on ? ' on' : ''), 'data-k': key, 'aria-pressed': String(on),
    title: on ? 'Featured, on the home page: tap to keep it to the gallery page only' : 'Gallery page only: tap to feature it on the home page too',
    'aria-label': on ? 'Stop featuring it' : 'Feature it on the home page',
    onclick: () => save(() => {
      const x = byId(e.id);
      if (!x || x.draft == null) return null;
      const { featured, ...rest } = draftOf(x);
      return [{ id: e.id, kind: 'artwork', data: featured ? rest : { ...rest, featured: true } }];
    }, null, key) }, glyph(GLYPHS.star));
}

/* Save a painting's Edit form: built when its turn in the queue comes, from the latest draft and the form's fields,
   keeping the picture as the draft has it (the picture saves itself). */
function savePainting(id, f, key) {
  return save(() => {
    const e = byId(id);
    if (!e || e.draft == null) return null;
    const d = draftOf(e), det = detailsOf(f), title = f.title.value.trim();
    if (det.error && !(f.height.value.trim() && f.width.value.trim())) return null;   // one side typed: wait for the other
    if (det.error) throw new Error(det.error);
    if (!title) throw new Error('Give it a title');
    const moved = f.genre.value !== d.genre;
    const { estimated, size_shown, ...rest } = d;    // put back from the form (detailsOf)
    return [{ id, kind: 'artwork', data: { ...rest, title, ...det, wide: f.wide.checked, genre: f.genre.value,
      order: moved ? paintingsIn(f.genre.value).length : d.order } }];
  }, null, key);
}

/* Closing a painting's Edit form. */
function closeEdit(id) { open.delete(id); editFields.delete(id); picking.delete(id); }

/* A painting's picture: one prepared in the darkroom (step 4 slice 4: the Gallery arranges, the darkroom
   prepares). Shown as it is, with how it was prepared; a button to choose another prepared picture (tiles), and
   one to open its recipe in the darkroom, which brings back here a new picture as a draft. A mark when its
   proportions don't match the painting's measured size (more than 1.5 per cent out): squaring it up to that size
   is done in the darkroom, which offers the size. */
const picking = new Set();          // paintings whose picture tiles are open
function pictureFields(e, d) {
  const r = picOf(d);
  if (!state.media) return [];
  const key = `${e.id}:picture`;
  const off = r && d.cm && !d.estimated && Math.abs(Math.log((r.w / r.h) / (d.cm[1] / d.cm[0]))) > 0.015;
  const out = [h('label', { 'data-k': key }, 'Picture'),
    h('div', { class: 'row pic-row' },
      r ? h('img', { class: 'pic-now', src: pictureAt(d, 480), alt: '' }) : h('span', { class: 'lib-pick-none pic-now' }, glyph(GLYPHS.photo, 28)),
      h('div', { class: 'pic-about' },
        h('span', { class: 'muted' }, r ? `${r.kind === 'flat' ? 'Squared up' : 'Straightened and cropped'}${r.label ? ` (${r.label})` : ''}, ${r.w} × ${r.h} pixels` : 'Its picture isn\'t known here'),
        off ? h('span', { class: 'pic-off', title: `Its picture's proportions don't match its measured size, ${d.cm[0]} × ${d.cm[1]} centimetres: open it in the darkroom to square it up to that` },
          glyph(GLYPHS.square, 14), ' Not its measured proportions') : null,
        h('div', { class: 'row' },
          h('button', { class: 'icon-btn', 'aria-expanded': String(picking.has(e.id)), title: 'Choose a different picture, from those prepared in the darkroom', 'aria-label': 'Choose a different picture',
            onclick: () => { picking.has(e.id) ? picking.delete(e.id) : picking.add(e.id); render(); } }, glyph(GLYPHS.photo), glyph(GLYPHS.swap, 14)),
          r ? h('a', { class: 'icon-btn', href: `#darkroom/${r.item}/${r.recipe}`, title: 'Open its picture in the darkroom (white balance, corners, proportions); a new picture comes back here as a draft',
            'aria-label': 'Open in the darkroom' }, glyph(GLYPHS.darkroom)) : null)))];
  if (picking.has(e.id)) {
    if (!state.library) { loadLibrary(); out.push(h('p', { class: 'hint' }, 'Loading the Library…')); }
    else {
      out.push(preparedTiles(preparedPictures(state.library.items), (x) => {
        picking.delete(e.id);
        save(() => { const x0 = byId(e.id); return x0 && x0.draft != null ? [{ id: e.id, kind: 'artwork', data: { ...draftOf(x0), rendition: x.r.id } }] : null; }, null, key);
      }, d.rendition));
    }
  }
  return out;
}

/* Moving a painting (dragged, or by the arrow keys on its grip: drag.js): to(where it is now) gives where it goes,
   { genre, index } among that genre's other paintings (Infinity: the end), or null to stay. Built when its turn in
   the save queue comes, from the latest state; the genres it leaves and joins are renumbered from the top, and an
   open Edit form's genre follows it (so the form's next save doesn't send it back). */
export function movePainting(id, to) {
  save(() => {
    const e = byId(id);
    if (!e || e.draft == null) return null;
    const from = draftOf(e).genre, inFrom = paintingsIn(from).filter((x) => x.draft != null);
    const where = to({ genre: from, index: inFrom.indexOf(e), size: inFrom.length });
    if (!where) return null;
    const lists = new Map([[from, inFrom.filter((x) => x !== e)]]);
    if (!lists.has(where.genre)) lists.set(where.genre, paintingsIn(where.genre).filter((x) => x.draft != null && x !== e));
    const dest = lists.get(where.genre);
    dest.splice(Math.max(0, Math.min(dest.length, where.index)), 0, e);
    const f = editFields.get(id);
    if (f && f.genre) f.genre.value = where.genre;
    const changes = [];
    for (const [genre, list] of lists) list.forEach((x, n) => {
      const d = draftOf(x);
      if (d.order !== n || d.genre !== genre) changes.push({ id: x.id, kind: 'artwork', data: { ...d, genre, order: n } });
    });
    return changes;
  }, null, `${id}:move`);
}
