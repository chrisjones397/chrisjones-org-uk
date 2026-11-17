/* A painting (an artwork) in the Gallery view: its row, its Edit form (each field saves itself), its star, and
   its picture, which is reopened in the darkroom and stores itself as a new rendition of its recipe. */

import { detailsLine } from '/paths.js';
import { h, toast, glyph, GLYPHS } from './dom.js';
import { state, byId, draftOf, changed, current, isHidden, paintingsIn, thumb, picOf, pictureAt } from './state.js';
import { call, save, discard, beforeDiscard, libraryReady } from './server.js';
import { render } from './render.js';
import { badge, hideButton } from './widgets.js';
import { detailsFields, detailsOf, carry, sizeNote } from './details.js';
import { darkroom } from './picture.js';
import { storeImages, originalOf } from './uploads.js';
import { libraryTiles, newestFirst } from './picker.js';

const open = new Set();             // paintings whose edit form is open
const editFields = new Map();       // painting id -> its Edit form's fields, while open

/* Discarding a painting's changes: an open Edit form starts again from the published version. */
beforeDiscard.add((ids) => {
  for (const id of ids) {
    const re = reopened.get(id);
    if (re) clearTimeout(re.timer);
    reopened.delete(id); editFields.delete(id);
  }
});

/* Open a painting's Edit form (the Library's uses marks lead here). */
export function openPainting(id) { open.add(id); }

export function paintingRow(e, items, i, secs) {
  const d = current(e);
  const gone = e.draft == null;
  const row = h('div', { class: 'painting' + (gone ? ' deleted' : '') + (isHidden(e) ? ' hidden' : ''), 'data-entry': e.id },
    h('img', { src: thumb(d), alt: '', loading: 'lazy' }),
    h('div', { class: 'what' }, h('span', { class: 't' }, d.title),
      h('span', { class: 'd' }, detailsLine(d) || ' ', sizeNote(d))),
    badge(e),
    gone ? h('button', { onclick: () => discard([e.id]) }, 'Keep it')
      : h('span', { class: 'move' },
        starButton(e),
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
    h('label', {}, 'Genre'), f.genre = h('select', {}, ...secs.map((s) => h('option', { value: s.id, selected: s.id === d.genre }, s.title))),
    h('label', { class: 'tick' }, f.wide = h('input', { type: 'checkbox', checked: d.wide }), 'Wide: spans the whole width of the list'),
    ...pictureFields(e, d, f),
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
    if (det.error) throw new Error(det.error);
    if (!title) throw new Error('Give it a title');
    const moved = f.genre.value !== d.genre;
    const { estimated, size_shown, ...rest } = d;    // put back from the form (detailsOf)
    return [{ id, kind: 'artwork', data: { ...rest, title, ...det, wide: f.wide.checked, genre: f.genre.value,
      order: moved ? paintingsIn(f.genre.value).length : d.order } }];
  }, null, key);
}

/* Closing a painting's Edit form: a picture change still waiting to be stored is stored now. */
function closeEdit(id) {
  const re = reopened.get(id);
  if (re && re.timer) { clearTimeout(re.timer); re.timer = null; storePicture(id, re); }
  open.delete(id); reopened.delete(id); editFields.delete(id);
}

/* A painting's picture saves itself too: once the darkroom's choices have rested for a moment (PICTURE_REST), its
   sizes are made and stored as its recipe's next rendition (the recipe taking the new settings) and the draft
   names it. A rendition made for an earlier change in this same sitting, which nothing else can be using, is
   deleted once replaced, so trying things out doesn't fill the Library. Going back to the choices it opened with
   (Back to saved) names its own rendition again, making nothing. A replaced photo (another Library item) gets
   one recipe of its own, however many changes follow. */
const PICTURE_REST = 1200;
function pictureChanged(id, re) {
  clearTimeout(re.timer);
  re.timer = setTimeout(() => { re.timer = null; storePicture(id, re); }, PICTURE_REST);
}
async function storePicture(id, re) {
  if (re.running) { re.again = true; return; }
  const dr = re.dr;
  if (!dr.ready) return;
  const want = dr.changed() ? JSON.stringify(dr.record()) + (dr.replacement ? `|${dr.replacement.item}` : '') : 'opened';
  if (want === re.saved) return;
  re.running = true;
  const say = (t) => dr.say(t);
  try {
    let pic = re.opened;
    if (want !== 'opened') {
      const e = byId(id), title = e ? current(e).title : 'Painting';
      const settings = { ...dr.record(), ...(re.paper ? { white_paper: true } : {}) };
      let at = re;                                       // where the new rendition goes: { item, recipe }
      if (dr.replacement) {
        const item = dr.replacement.item;
        if (!re.kept || re.kept.item !== item) re.kept = { item, recipe: item === re.item ? re.recipe : null };
        at = re.kept;
      }
      const made = await storeImages(at.item, at.recipe, dr.result(), settings, title, say);   // the title labels a new recipe
      at.recipe = made.recipe;
      pic = { rendition: made.id };
      re.made.add(made.id);
    }
    let before = null;
    const out = await save(() => {
      const e = byId(id);
      if (!e || e.draft == null) return null;
      before = draftOf(e);
      return [{ id, kind: 'artwork', data: { ...before, ...pic } }];
    }, null, `${id}:picture`);
    if (!out) return;
    re.saved = want;
    say('');
    const old = before && before.rendition;
    if (old && re.made.has(old) && old !== pic.rendition) {
      re.made.delete(old);
      call('POST', 'library/delete', { rendition: old }).catch(() => { /* still used: it stays */ });
    }
  } catch (err) {
    say(''); toast(err.message, true);
  } finally {
    re.running = false;
    if (re.again) { re.again = false; storePicture(id, re); }
  }
}

/* Reopening a painting's picture: its darkroom starts with the saved choices summarised (its rendition's
   settings), and opening a section reads the item's original back from storage and starts from those choices
   (or, for paintings moved from git, which have none: the whole photo, with "Find the paper"'s spots if it's a
   drawing on white paper, white_paper). */
const reopened = new Map();         // painting id -> { dr }, while its Edit form is open
function pictureFields(e, d, f) {
  const r = picOf(d);
  if (!state.media || !r) return [];
  let re = reopened.get(e.id);
  if (!re) {
    const { white_paper: paper, ...choices } = r.settings || {};
    const process = choices.white ? choices : null, white = paper ? 'paper' : 'none';
    re = { saved: 'opened', made: new Set(), timer: null, opened: { rendition: d.rendition }, item: r.item, recipe: r.recipe, paper: !!paper };
    re.dr = darkroom({
      onChange: () => pictureChanged(e.id, re),
      previous: pictureAt(d, 1024),                  // the painting's current picture, at a size fit for comparing
      saved: process || { white },
      start: process ? { process } : { white, guess: false },
      fetch: async () => ({ blob: await originalOf(r.item) }),
      library: async (use) => libraryTiles(newestFirst((await libraryReady()).items.filter((it) => it.kind === 'photo')), use),
      original: originalOf,
    });
    reopened.set(e.id, re);
  }
  re.dr.attach(f);
  return [h('label', { 'data-k': `${e.id}:picture` }, 'Picture'), re.dr.el];
}

function movePainting(items, i, dir) {
  const list = items.filter((e) => e.draft != null);
  const a = list.indexOf(items[i]);
  let b = a + dir;
  if (b < 0 || b >= list.length) return;
  [list[a], list[b]] = [list[b], list[a]];
  const changes = [];
  list.forEach((e, n) => { const d = draftOf(e); if (d.order !== n) changes.push({ id: e.id, kind: 'artwork', data: { ...d, order: n } }); });
  save(changes, 'Moved');
}
