/* A painting in the Gallery view: its row, its Edit form (each field saves itself), its star, and its picture,
   which is reopened in the darkroom and stores itself. */

import { paintingAt } from '/paths.js';
import { h, toast, glyph, GLYPHS } from './dom.js';
import { state, byId, draftOf, changed, current, isHidden, paintingsIn, thumb } from './state.js';
import { fetchFor, call, save, discard, beforeDiscard } from './server.js';
import { render } from './render.js';
import { badge, hideButton } from './widgets.js';
import { detailsFields, detailsOf, carry, sizeNote } from './details.js';
import { darkroom } from './picture.js';
import { storeImages, keepOriginal } from './uploads.js';

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

export function paintingRow(e, items, i, secs) {
  const d = current(e);
  const gone = e.draft == null;
  const row = h('div', { class: 'painting' + (gone ? ' deleted' : '') + (isHidden(e) ? ' hidden' : '') },
    h('img', { src: thumb(d), alt: '', loading: 'lazy' }),
    h('div', { class: 'what' }, h('span', { class: 't' }, d.title),
      h('span', { class: 'd' }, d.details || ' ', sizeNote(d))),
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
    h('label', {}, 'Genre'), f.section = h('select', {}, ...secs.map((s) => h('option', { value: s.id, selected: s.id === d.section }, s.title))),
    h('label', { class: 'tick' }, f.wide = h('input', { type: 'checkbox', checked: d.wide }), 'Wide: spans the whole width of the list'),
    ...pictureFields(e, d, f),
    h('p', { class: 'hint' }, `Address: /gallery/${d.name}/ (stays the same if the title changes)`),
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
      return [{ id: e.id, kind: 'painting', data: featured ? rest : { ...rest, featured: true } }];
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
      pic = { ...(await storeImages(orig.slice(6), dr.result(), say)), process: dr.record(orig) };
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
   none: the whole photo, with "Find the paper"'s spots if it's a drawing on white paper, white_paper). */
const reopened = new Map();         // painting id -> { dr }, while its Edit form is open
const pictureOf = (d) => {          // the painting's current picture, at a size fit for comparing
  const w = d.widths.find((x) => x >= 1024) || d.widths[d.widths.length - 1];
  return `/${paintingAt(d, w)}`;
};
function pictureFields(e, d, f) {
  if (!state.media) return [];
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
        const r = await fetchFor(`/edit/api/original?key=${encodeURIComponent(key)}`, {}, 120000);
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Couldn't fetch the original (${r.status})`);
        return { original: r.headers.get('x-original') || key, blob: await r.blob() };
      },
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
  list.forEach((e, n) => { const d = draftOf(e); if (d.order !== n) changes.push({ id: e.id, kind: 'painting', data: { ...d, order: n } }); });
  save(changes, 'Moved');
}
