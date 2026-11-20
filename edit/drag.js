/* Dragging to rearrange (step 4 slice 4 (b)): paintings within a genre and between genres, and the genres
   themselves. One grip per thing (six dots, on the left of its row), the same for mouse, trackpad, touch and
   keyboard:
   - pointer (Pointer Events, so one code path for all three): press the grip and move; the thing lifts and follows
     the finger or pointer up and down, a dashed gap shows where it will land, and the page scrolls itself near the
     window's top and bottom. Let go to drop it there; Escape puts it back. A press without moving does nothing.
     The grip alone starts a drag (touch-action: none on it), so the rest of the page scrolls by touch as ever.
   - keyboard: the grip is a button; arrow up and down move it one place (a painting crosses into the next genre at
     either end of its own).
   Dragging genres folds every genre down to its heading row while the drag lasts, so they're short enough to
   pass one another.
   The page isn't redrawn while something is lifted (render.js hold): a save answered meanwhile is drawn once it's
   dropped. A drop leaves the thing where it landed and saves, through the queue, from the latest state, so the
   view never flicks back before the server answers. */

import { h, glyph, GLYPHS } from './dom.js';
import { hold, render } from './render.js';

/* The kinds of thing that can be dragged, each saying where its things are and what a drop does:
     item   the selector of one draggable thing (the grip's closest ancestor matching it)
     list   the selector of the lists it can be dropped into (each a parent of items)
     zone   (optional) the element whose area counts as a list's, for choosing a list by the pointer's height
     tail   (optional) elements belonging after an item, hidden while it's lifted (a painting's open Edit form)
     fold   (optional) a class put on <body> while dragging (genres fold to their headings)
     drop(id, list, index)  it was let go in that list, at that place among the list's other (kept) items
     step(id, dir)          keyboard: one place up (-1) or down (1) */
export const KINDS = {};

export function grip(kind, id, what) {
  return h('button', { type: 'button', class: 'grip', 'data-drag': kind, 'data-id': id, 'data-k': `${id}:move`,
    title: `Drag to move ${what} (or arrow keys up and down)`, 'aria-label': `Move ${what}: arrow keys up and down`,
    onpointerdown: press,
    onkeydown: (ev) => {
      const dir = { ArrowUp: -1, ArrowDown: 1 }[ev.key];
      if (!dir || drag) return;
      ev.preventDefault();
      KINDS[kind].step(id, dir);
    } }, glyph(GLYPHS.grip));
}

/* Things marked .deleted (removed in the draft, still shown) are passed over: they have no place to keep. */
const kept = (list, kind, except) => [...list.children].filter((c) => c.matches(kind.item) && c !== except && !c.matches('.deleted'));

let drag = null;   // the drag under way: { g, kind, item, pid, x0, y0, y, on, gap, tails, off }

function press(ev) {
  if (drag || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
  const g = ev.currentTarget, kind = KINDS[g.dataset.drag], item = g.closest(kind.item);
  if (!item) return;
  ev.preventDefault();                       // no text selected, no long-press menu
  g.setPointerCapture(ev.pointerId);
  drag = { g, kind, item, pid: ev.pointerId, x0: ev.clientX, y0: ev.clientY, y: ev.clientY, on: false };
  g.addEventListener('pointermove', move);
  g.addEventListener('pointerup', letGo);
  g.addEventListener('pointercancel', cancel);
  addEventListener('keydown', escape);
}

function move(ev) {
  if (!drag || ev.pointerId !== drag.pid) return;
  drag.y = ev.clientY;
  if (!drag.on && Math.hypot(ev.clientX - drag.x0, ev.clientY - drag.y0) > 5) lift();
  if (drag.on) place();
}

function lift() {
  const { g, kind, item } = drag;
  hold(true);
  document.body.classList.add('dragging');
  if (kind.fold) document.body.classList.add(kind.fold);
  drag.tails = kind.tail ? kind.tail(item) : [];
  for (const t of drag.tails) t.hidden = true;
  const r = item.getBoundingClientRect(), gr = g.getBoundingClientRect();
  drag.gap = h('div', { class: 'drop-gap', style: `height: ${r.height}px` });
  item.before(drag.gap);
  drag.off = gr.top + gr.height / 2 - r.top;          // the grip stays under the finger or pointer
  Object.assign(item.style, { position: 'fixed', left: `${r.left}px`, width: `${r.width}px`, top: `${drag.y - drag.off}px`, margin: '0' });
  item.classList.add('lifted');
  drag.on = true;
  requestAnimationFrame(edges);
}

/* Where the gap goes: the list under the pointer (or the nearest), before the first kept item whose middle is
   below the pointer, else at the list's end. */
function place() {
  const { kind, item, gap, y } = drag;
  item.style.top = `${y - drag.off}px`;
  let best = null, bestD = Infinity;
  for (const list of document.querySelectorAll(kind.list)) {
    const r = (kind.zone ? kind.zone(list) : list).getBoundingClientRect();
    const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    if (d < bestD) { best = list; bestD = d; }
  }
  if (!best) return;
  const before = kept(best, kind, item).find((c) => { const r = c.getBoundingClientRect(); return r.top + r.height / 2 > y; });
  if (before) { if (gap.nextElementSibling !== before) before.before(gap); }
  else if (gap.parentElement !== best || gap.nextElementSibling) best.append(gap);
}

/* Near the window's top or bottom edge the page scrolls itself, faster the nearer the edge. */
function edges() {
  if (!drag || !drag.on) return;
  const edge = 80, y = drag.y, H = innerHeight;
  const v = y < edge ? -(edge - y) / 4 : y > H - edge ? (y - (H - edge)) / 4 : 0;
  if (v) { scrollBy(0, Math.round(v)); place(); }
  requestAnimationFrame(edges);
}

function letGo(ev) {
  if (!drag || ev.pointerId !== drag.pid) return;
  if (!drag.on) { finish(); return; }
  const { kind, item, gap } = drag, id = drag.g.dataset.id, list = gap.parentElement;
  let index = 0;
  for (const c of list.children) { if (c === gap) break; if (c.matches(kind.item) && c !== item && !c.matches('.deleted')) index++; }
  settle();
  gap.replaceWith(item);
  item.after(...drag.tails);
  finish();
  kind.drop(id, list, index);
  hold(false);
}

function cancel() { if (!drag) return; const was = drag.on; if (was) { settle(); drag.gap.remove(); } finish(); if (was) { hold(false); render(); } }
function escape(ev) { if (ev.key === 'Escape' && drag) { ev.preventDefault(); cancel(); } }

/* Back into the page's flow. */
function settle() {
  const { item, kind } = drag;
  item.classList.remove('lifted');
  for (const p of ['position', 'left', 'width', 'top', 'margin']) item.style.removeProperty(p);
  for (const t of drag.tails) t.hidden = false;
  document.body.classList.remove('dragging');
  if (kind.fold) document.body.classList.remove(kind.fold);
}

function finish() {
  const { g, pid } = drag;
  g.removeEventListener('pointermove', move);
  g.removeEventListener('pointerup', letGo);
  g.removeEventListener('pointercancel', cancel);
  removeEventListener('keydown', escape);
  try { g.releasePointerCapture(pid); } catch { /* already released */ }
  drag = null;
}
