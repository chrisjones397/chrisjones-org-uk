/* The Gallery view: add a painting (at the top), and change the genres and their paintings; both are dragged by
   their grips to rearrange them (drag.js). */

import { h } from './dom.js';
import { state, byId, liveOf, isHidden, genres, paintingsIn } from './state.js';
import { save, discard } from './server.js';
import { HINT } from './render.js';
import { badge, hideButton } from './widgets.js';
import { addForm, pickGenre } from './add.js';
import { paintingRow, movePainting } from './painting.js';
import { grip, KINDS } from './drag.js';

export function galleryView() {
  const out = [h('h1', {}, 'Gallery'), h('p', { class: 'hint' }, HINT)];
  const secs = genres();
  out.push(h('h2', {}, 'Add a painting'));
  out.push(addForm(secs));
  out.push(h('h2', {}, 'Genres'));
  out.push(h('div', { class: 'actions top' }, h('button', { onclick: addSection }, 'Add a genre')));
  const cards = h('div', { class: 'genres' });
  secs.forEach((s) => {
    const se = byId(s.id);
    const items = paintingsIn(s.id);
    const card = h('div', { class: 'card' + (isHidden(se) ? ' hidden' : ''), 'data-genre': s.id });
    card.append(h('div', { class: 'row head' },
      grip('genre', s.id, 'this genre'),
      h('input', { type: 'text', class: 'grow', value: s.title, 'aria-label': 'Genre name', 'data-k': `${s.id}:title`, onchange: (ev) => {
        save([{ id: s.id, kind: 'genre', data: { title: ev.target.value, order: s.order, hidden: s.hidden } }], null, `${s.id}:title`);
      } }),
      badge(se),
      hideButton(se, 'this genre and its paintings'),
      h('button', { class: 'danger', title: items.some((e) => e.draft != null) ? 'Move or remove its paintings first' : 'Remove this genre',
        disabled: items.some((e) => e.draft != null),
        onclick: () => { if (confirm(`Remove the genre "${s.title}"?`)) save([{ id: s.id, kind: 'genre', data: null }], 'Genre removed in the draft'); } }, 'Remove'),
    ));
    // its paintings: a list they can be dragged within, into and out of
    const list = h('div', { class: 'paintings', 'data-genre': s.id });
    if (!items.some((e) => e.draft != null)) list.append(h('p', { class: 'hint empty' }, 'No paintings in this genre: drag one here.'));
    items.forEach((e) => list.append(...paintingRow(e, secs)));
    card.append(list);
    cards.append(card);
  });
  out.push(cards);
  // genres deleted in the draft but still live
  for (const e of state.entries.filter((x) => x.kind === 'genre' && x.draft == null)) {
    out.push(h('div', { class: 'card row' }, h('span', { class: 'grow muted' }, `${liveOf(e).title} (removed in the draft)`), badge(e),
      h('button', { onclick: () => discard([e.id]) }, 'Keep it')));
  }

  return out;
}

/* Dragging a genre (drag.js): it takes its place among the others, which are renumbered from the top. Built when
   its turn in the save queue comes, from the latest state. */
function moveGenre(id, place) {
  save(() => {
    const secs = genres(), list = secs.filter((s) => s.id !== id), me = secs.find((s) => s.id === id);
    if (!me) return null;
    list.splice(Math.max(0, Math.min(list.length, place(secs.indexOf(me)))), 0, me);
    return list.map((s, n) => ({ ...s, order: n })).filter((s) => secs.find((x) => x.id === s.id).order !== s.order)
      .map(({ id: i, title, order, hidden }) => ({ id: i, kind: 'genre', data: { title, order, hidden } }));
  }, null, `${id}:move`);
}
KINDS.genre = {
  item: '.card[data-genre]', list: '.genres', fold: 'drag-genres',
  drop: (id, list, index) => moveGenre(id, () => index),
  step: (id, dir) => moveGenre(id, (i) => i + dir),
};
KINDS.painting = {
  item: '.painting[data-entry]', list: '.paintings', zone: (list) => list.closest('.card'),
  tail: (item) => (item.nextElementSibling && item.nextElementSibling.matches('.edit') ? [item.nextElementSibling] : []),
  drop: (id, list, index) => movePainting(id, () => ({ genre: list.dataset.genre, index })),
  step: (id, dir) => movePainting(id, ({ genre, index, size }) => {
    if (index + dir >= 0 && index + dir < size) return { genre, index: index + dir };
    // past either end of its genre: into the next genre up (at its end) or down (at its start)
    const secs = genres(), g = secs[secs.findIndex((s) => s.id === genre) + dir];
    return g ? { genre: g.id, index: dir < 0 ? Infinity : 0 } : null;
  }),
};

function addSection() {
  const title = (prompt('Name of the new genre') || '').trim();
  if (!title) return;
  const id = 's-' + Math.random().toString(36).slice(2, 10);
  pickGenre(id);
  save([{ id, kind: 'genre', data: { title, order: genres().length } }], `"${title}" added at the bottom`);
}
