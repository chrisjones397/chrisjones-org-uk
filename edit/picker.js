/* The Library's items, or the pictures prepared from them, as tiles to pick from: the one way a picture gets
   into a page (the Library is the only upload; the darkroom prepares). Used by the Gallery (a painting's
   picture), the darkroom (Replace photo…) and a section's background. Every Library picture, here and in the
   Library's rows, is one size. */

import { h, glyph, GLYPHS } from './dom.js';

export const newestFirst = (items) => items.slice().sort((a, b) => b.added.localeCompare(a.added));

/* items: Library items (library.js survey); onPick(item); mark(item): a small symbol on a tile's corner, or null. */
export function libraryTiles(items, onPick, mark) {
  return h('div', { class: 'lib-picker' }, ...items.map((it) => h('button', { type: 'button', class: 'lib-pick', title: it.name, onclick: () => onPick(it) },
    it.thumb ? h('img', { src: it.thumb, alt: '', loading: 'lazy' }) : h('span', { class: 'lib-pick-none' }, glyph(GLYPHS.photo, 28)),
    it.kind === 'video' ? h('span', { class: 'lib-video' }, glyph(GLYPHS.play, 12)) : null,
    mark ? mark(it) : null,
    h('span', { class: 'lib-pick-name' }, it.name))));
}

/* Every prepared picture: each recipe's newest rendition (a picture, not a video's), newest first, as
   [{ it, recipe, r }]. Older renditions are its history, kept for History, not offered. */
export function preparedPictures(items) {
  const out = [];
  for (const it of items) for (const c of it.recipes) {
    if (c.kind === 'video' || !c.renditions.length) continue;
    const r = c.renditions[c.renditions.length - 1];
    if (r.sizes.length) out.push({ it, recipe: c, r });
  }
  return out.sort((a, b) => b.r.id - a.r.id);
}
/* A prepared picture's name: its item's, and its recipe's label when it has one. */
export const preparedName = ({ it, recipe }) => (recipe.label ? `${it.name}: ${recipe.label}` : it.name);
/* As tiles: each shows the picture itself, with a mark saying how it was prepared (squared up, or straightened
   and cropped). onPick({ it, recipe, r }); chosen: the rendition id now in use, outlined. */
export function preparedTiles(list, onPick, chosen) {
  return h('div', { class: 'lib-picker' }, ...list.map((x) => h('button', { type: 'button', class: 'lib-pick' + (x.r.id === chosen ? ' on' : ''),
    title: `${preparedName(x)} (${x.recipe.kind === 'flat' ? 'squared up' : 'straightened and cropped'})`, onclick: () => onPick(x) },
    h('img', { src: x.r.sizes[0].url, alt: '', loading: 'lazy' }),
    h('span', { class: 'lib-pick-mark', title: x.recipe.kind === 'flat' ? 'Squared up' : 'Straightened and cropped' }, glyph(GLYPHS[x.recipe.kind === 'flat' ? 'square' : 'level'], 12)),
    h('span', { class: 'lib-pick-name' }, preparedName(x)))));
}
