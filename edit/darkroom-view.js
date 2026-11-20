/* The darkroom view (step 4 slice 4): a place of its own for preparing any photo for the site, whatever the
   picture is then used for (a painting, a background, later a foreground). Opened from a photo's row in the
   Library, or from a painting's Edit form in the Gallery, at #darkroom/<item code>/<recipe>, where <recipe> is a
   recipe's id, or flat or scene for a new one. Its back arrow returns to where it was opened from.

   It shows the photo's recipes as tiles (each with its newest picture), and two tiles to start a new one:
   squaring up a flat thing (a painting, a drawing: corners and proportions), or straightening and cropping a
   scene. The recipe chosen opens in the darkroom form (picture.js). It makes recipes and their renditions; using
   a picture is done elsewhere (the Gallery, a section's background), or from here with "Hang it in the Gallery".

   One saving rule, here too: once the choices have rested for a moment (REST), the picture's sizes are made and
   stored as the recipe's next rendition (a new recipe: its first, the recipe made with it). Whatever showed the
   recipe's picture until then (any painting's or background's draft naming it) is pointed at the new one, as a
   draft, so the change reaches visitors only once it's published. A rendition made earlier in this same sitting,
   which nothing else can be using, is deleted once replaced, so trying things out doesn't fill the Library;
   going back to the choices it opened with names its own rendition again, making nothing. */

import { sizeFor } from '/paths.js';
import { h, toast, glyph, GLYPHS } from './dom.js';
import { state, draftOf } from './state.js';
import { marks, placeMarks } from './marks.js';
import { render, viewArgs, view, nav } from './render.js';
import { call, save, loadLibrary, libraryReady } from './server.js';
import { originalOf, storeImages } from './uploads.js';
import { libraryTiles, newestFirst } from './picker.js';
import { darkroom } from './picture.js';
import { strongest, useMarks } from './uses.js';
import { hang } from './add.js';

const REST = 1200;
const sessions = new Map();          // '<item>/<recipe id, or flat or scene for a new one>' -> its session, while in the darkroom
const KINDS = { flat: ['square', 'Square up', 'A flat thing (a painting, a drawing, a print): put its four corners on its corners, and it comes out square, to known proportions if you have them'],
  scene: ['level', 'Straighten', 'A scene (a room, a view): turn it level and crop it'] };

export function darkroomView() {
  const [code, which] = viewArgs();
  const back = h('button', { class: 'icon-btn', title: 'Back to where you were', 'aria-label': 'Back', onclick: leave }, glyph(GLYPHS.back, 20));
  if (!state.library) { loadLibrary(); return [h('h1', { class: 'row' }, back, 'Darkroom'), h('p', { class: 'muted' }, 'Loading…')]; }
  const it = state.library.items.find((x) => x.id === code);
  if (!it || it.kind !== 'photo') return [h('h1', { class: 'row' }, back, 'Darkroom'), h('p', { class: 'hint' }, it ? 'The darkroom is for photos.' : 'That isn\'t in the Library (any more).')];
  const recipes = it.recipes.filter((c) => c.kind !== 'video');
  const chosen = which === 'flat' || which === 'scene' ? which : recipes.find((c) => String(c.id) === which)
    || (sessions.get(`${it.id}/${which}`) ? { id: which, kind: sessions.get(`${it.id}/${which}`).kind, pending: true } : null);   // just made, the Library not yet read again

  const tile = (key, pic, symbol, name, title) => h('button', { type: 'button', class: 'lib-pick' + ((chosen && (chosen.id ?? chosen) == key) ? ' on' : ''), title,
    onclick: () => { location.hash = `#darkroom/${it.id}/${key}`; } },
  pic ? h('img', { src: pic, alt: '' }) : h('span', { class: 'lib-pick-none' }, glyph(GLYPHS[symbol], 28)),
  pic ? h('span', { class: 'lib-pick-mark' }, glyph(GLYPHS[symbol], 12)) : null,
  h('span', { class: 'lib-pick-name' }, name));
  const out = [
    h('h1', { class: 'row dr-title' }, back, it.thumb ? h('img', { class: 'dr-item', src: it.thumb, alt: '' }) : null,
      h('span', { class: 'grow' }, it.name), h('span', { class: 'muted dr-word' }, 'Darkroom')),
    h('div', { class: 'lib-picker dr-recipes' },
      ...recipes.map((c, i) => {
        const r = c.renditions[c.renditions.length - 1];
        return tile(c.id, r && r.sizes.length ? r.sizes[0].url : null, KINDS[c.kind][0], c.label || `Recipe ${i + 1}`,
          `${c.kind === 'flat' ? 'Squared up' : Object.keys(c.settings).length ? 'Straightened and cropped' : 'As it is'}${r ? `, r${r.n}` : ''}: open it`);
      }),
      ...Object.entries(KINDS).map(([k, [symbol, name, title]]) => tile(k, null, symbol, `New: ${name.toLowerCase()}`, `New: ${title}`)))];
  if (!chosen) {
    out.push(h('p', { class: 'hint' }, recipes.length ? 'Open a recipe to change it, or start a new one.' : 'Choose how to prepare this photo.'));
    return out;
  }
  const kind = typeof chosen === 'string' ? chosen : chosen.kind;
  const key = `${it.id}/${typeof chosen === 'string' ? chosen : chosen.id}`;
  let s = sessions.get(key);
  if (!s) { s = start(it, typeof chosen === 'string' ? null : chosen, kind); sessions.set(key, s); }
  const recipe = s.recipe && it.recipes.find((c) => c.id === s.recipe);
  const uses = recipe ? strongest(recipe.renditions.flatMap((r) => r.uses)) : [];
  const current = recipe && recipe.renditions.find((r) => r.id === s.current);
  out.push(h('div', { class: 'card dr-card' },
    h('div', { class: 'row dr-about' },
      h('span', { class: 'lib-part-icon', title: KINDS[kind][1] }, glyph(GLYPHS[KINDS[kind][0]], 18)),
      h('input', { type: 'text', class: 'grow', maxLength: 120, value: recipe ? recipe.label : s.label, placeholder: 'A label, to tell it apart (optional)',
        'aria-label': 'Its label', 'data-k': `dr:${key}:label`, title: 'A label, to tell several things made from one photo apart',
        onkeydown: (ev) => { if (ev.key === 'Enter') ev.target.blur(); }, onchange: (ev) => relabel(s, recipe, ev.target) }),
      h('span', { class: 'lib-marks' }, ...useMarks(uses, '')),
      current ? h('button', { class: 'icon-btn', title: 'Hang it in the Gallery: a new painting with this picture', 'aria-label': 'Hang it in the Gallery',
        onclick: () => { flush(); hang(current, recipe.label || it.name); } }, glyph(GLYPHS.add), glyph(GLYPHS.frame)) : null),
    s.dr.el));
  return out;
}

/* A session: the darkroom form for one recipe of one photo, and what it has stored this sitting. */
function start(it, c, kind) {
  const s = { item: it.id, kind, recipe: c ? c.id : null, label: '', made: new Set(), timer: null, running: false, again: false, kept: null };
  const r = c && c.renditions[c.renditions.length - 1];
  s.opened = s.current = r ? r.id : null;
  s.saved = r ? 'opened' : null;              // a new recipe saves itself as soon as its photo is read
  const suggest = () => {                      // paintings showing this recipe's pictures, measured
    const mine = new Set(c ? c.renditions.map((x) => x.id) : []);
    return state.entries.filter((e) => e.kind === 'artwork' && e.draft != null && mine.has(draftOf(e).rendition))
      .map(draftOf).filter((d) => d.cm && !d.estimated).map((d) => ({ label: d.title, shape: d.cm }));
  };
  const common = { kind, suggest: suggest(), onChange: () => { clearTimeout(s.timer); s.timer = setTimeout(() => { s.timer = null; store(s); }, REST); },
    library: async (use) => libraryTiles(newestFirst((await libraryReady()).items.filter((x) => x.kind === 'photo' && x.id !== it.id)), use),
    original: originalOf };
  if (r) {
    const { white_paper: paper, ...choices } = c.settings || {};
    const process = choices.white || choices.angle != null || choices.crop ? choices : null, white = paper ? 'paper' : 'none';
    s.paper = !!paper;
    s.dr = darkroom({ ...common, previous: sizeFor(r.sizes, 1024).url, saved: process || { white },
      start: process ? { process } : { white, guess: false }, fetch: async () => ({ blob: await originalOf(it.id) }) });
  } else {
    s.dr = darkroom(common);
    s.dr.say('Fetching the photo from the Library…');
    originalOf(it.id).then((blob) => s.dr.load(blob)).catch((e) => { s.dr.say(''); toast(e.message, true); });
  }
  return s;
}

/* Store the picture as the darkroom's choices have it (see the top). */
async function store(s) {
  if (s.running) { s.again = true; return; }
  const dr = s.dr;
  if (!dr.ready) return;
  const want = s.opened == null || dr.changed() ? JSON.stringify(dr.record()) + (dr.replacement ? `|${dr.replacement.item}` : '') : 'opened';
  if (want === s.saved) return;
  s.running = true;
  const say = (t) => dr.say(t);
  try {
    let target = s.opened;
    if (want !== 'opened') {
      const settings = { ...dr.record(), ...(s.paper && s.kind === 'flat' ? { white_paper: true } : {}) };
      let at = s;                                        // where the new rendition goes: { item, recipe }
      if (dr.replacement) {
        const item = dr.replacement.item;
        if (!s.kept || s.kept.item !== item) s.kept = { item, recipe: item === s.item ? s.recipe : null };
        at = s.kept;
      }
      const made = await storeImages(at.item, at.recipe, dr.result(), settings, { kind: s.kind, label: s.label }, say);
      if (at === s && s.recipe == null) {                // a new recipe: the address names it from now on
        s.recipe = made.recipe;
        sessions.set(`${s.item}/${made.recipe}`, s);
        if (view() === 'darkroom' && viewArgs()[0] === s.item) history.replaceState(null, '', `#darkroom/${s.item}/${made.recipe}`);
      }
      at.recipe = made.recipe;
      target = made.id; s.made.add(made.id);
    }
    const was = s.current;
    if (was != null && target !== was) {                // whatever showed the recipe's picture shows the new one, as a draft
      const users = state.entries.filter((e) => e.draft != null && draftOf(e).rendition === was);
      if (users.length) await save(users.map((e) => ({ id: e.id, kind: e.kind, data: { ...draftOf(e), rendition: target } })), null);
      if (s.made.has(was)) { s.made.delete(was); await call('POST', 'library/delete', { rendition: was }).catch(() => { /* still used: it stays */ }); }
    }
    s.current = target; s.saved = want;
    say(want === 'opened' ? '' : 'Saved: the new picture is in the Library, and anything showing it has it as a draft.');
    loadLibrary();
  } catch (err) {
    say(''); toast(err.message, true);
  } finally {
    s.running = false;
    if (s.again) { s.again = false; store(s); }
  }
}

/* A recipe's label saves itself; a new recipe's goes with its first picture. */
async function relabel(s, recipe, input) {
  const v = input.value.trim();
  if (!recipe) { s.label = v; return; }
  if (v === recipe.label) return;
  try {
    await call('POST', 'library/recipe', { id: recipe.id, label: v });
    recipe.label = v;
    marks.set(input.dataset.k, [Date.now(), 'Saved: the Library keeps it straight away']); placeMarks();
  } catch (e) { toast(e.message, true); input.value = recipe.label; }
}

/* Leaving: a picture still waiting to be stored is stored now; the sessions go (opened again, they start afresh
   from what the Library then has). */
function flush() {
  for (const s of new Set(sessions.values())) if (s.timer) { clearTimeout(s.timer); s.timer = null; store(s); }
}
function leave() { location.hash = nav.cameFrom || '#library'; }
window.addEventListener('hashchange', () => {
  if (view() === 'darkroom') return;
  flush(); sessions.clear();
});
