/* The Gallery view: add a painting (at the top), and change the genres and their paintings. */

import { h } from './dom.js';
import { state, byId, liveOf, isHidden, sections, paintingsIn } from './state.js';
import { save, discard } from './server.js';
import { HINT } from './render.js';
import { badge, hideButton } from './widgets.js';
import { addForm, pickGenre } from './add.js';
import { paintingRow } from './painting.js';

export function galleryView() {
  const out = [h('h1', {}, 'Gallery'), h('p', { class: 'hint' }, HINT)];
  const secs = sections();
  out.push(h('h2', {}, 'Add a painting'));
  out.push(addForm(secs));
  out.push(h('h2', {}, 'Genres'));
  out.push(h('div', { class: 'actions top' }, h('button', { onclick: addSection }, 'Add a genre')));
  secs.forEach((s, si) => {
    const se = byId(s.id);
    const items = paintingsIn(s.id);
    const card = h('div', { class: 'card' + (isHidden(se) ? ' hidden' : '') });
    card.append(h('div', { class: 'row' },
      h('input', { type: 'text', class: 'grow', value: s.title, 'aria-label': 'Genre name', 'data-k': `${s.id}:title`, onchange: (ev) => {
        save([{ id: s.id, kind: 'section', data: { title: ev.target.value, order: s.order, hidden: s.hidden } }], null, `${s.id}:title`);
      } }),
      badge(se),
      hideButton(se, 'this genre and its paintings'),
      h('span', { class: 'move' },
        h('button', { title: 'Move genre up', disabled: si === 0, onclick: () => moveSection(secs, si, -1) }, '↑'),
        h('button', { title: 'Move genre down', disabled: si === secs.length - 1, onclick: () => moveSection(secs, si, 1) }, '↓')),
      h('button', { class: 'danger', title: items.some((e) => e.draft != null) ? 'Move or remove its paintings first' : 'Remove this genre',
        disabled: items.some((e) => e.draft != null),
        onclick: () => { if (confirm(`Remove the genre "${s.title}"?`)) save([{ id: s.id, kind: 'section', data: null }], 'Genre removed in the draft'); } }, 'Remove'),
    ));
    if (!items.length) card.append(h('p', { class: 'hint' }, 'No paintings in this genre.'));
    items.forEach((e, i) => card.append(...paintingRow(e, items, i, secs)));
    out.push(card);
  });
  // genres deleted in the draft but still live
  for (const e of state.entries.filter((x) => x.kind === 'section' && x.draft == null)) {
    out.push(h('div', { class: 'card row' }, h('span', { class: 'grow muted' }, `${liveOf(e).title} (removed in the draft)`), badge(e),
      h('button', { onclick: () => discard([e.id]) }, 'Keep it')));
  }

  return out;
}

function moveSection(secs, i, dir) {
  const list = secs.slice(); [list[i], list[i + dir]] = [list[i + dir], list[i]];
  save(list.map((s, n) => ({ ...s, order: n })).filter((s, n) => secs.find((x) => x.id === s.id).order !== n)
    .map(({ id, title, order, hidden }) => ({ id, kind: 'section', data: { title, order, hidden } })), 'Moved');
}
function addSection() {
  const title = (prompt('Name of the new genre') || '').trim();
  if (!title) return;
  const id = 's-' + Math.random().toString(36).slice(2, 10);
  pickGenre(id);
  save([{ id, kind: 'section', data: { title, order: sections().length } }], `"${title}" added at the bottom`);
}
