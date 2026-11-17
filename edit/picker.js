/* The Library's items as tiles to pick from: the one way a picture gets into a page (step 4, slice 3: the
   Library is the only upload). Used by the Gallery (a painting's photo), a painting's darkroom (Replace
   photo…) and a section's background. Every Library picture, here and in the Library's rows, is one size. */

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
