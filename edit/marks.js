import { h, glyph, GLYPHS } from './dom.js';

/* The saved tick: on the right of a text field, or just after anything else (a tick box, a choice, a button),
   for a few seconds after it saved, with a tooltip; plainly not a button. Marks survive re-renders (render()
   puts each back on the element with that data-k, part-way through its fade). */
export const marks = new Map(), MARK_MS = 3500, SAVED = 'Saved as a draft: visitors see it once it\'s published (Review)';
export function placeMarks() {
  const now = Date.now();
  for (const [key, [at, tip]] of marks) {
    const age = now - at;
    if (age > MARK_MS) { marks.delete(key); continue; }
    const el = document.querySelector(`[data-k="${CSS.escape(key)}"]`);
    if (!el) continue;
    const delay = `-${age}ms`;
    if (el.matches('input[type=text], input[type=number], input[type=email], input:not([type]), textarea')) {
      el.classList.add('saved'); el.style.animationDelay = delay;
      el.title = tip;
      setTimeout(() => { el.classList.remove('saved'); el.removeAttribute('title'); }, MARK_MS - age);
    } else {
      // The tick takes no room, so nothing moves when it appears: it sits on the top right corner of the button or
      // label that was changed (a tick box's label runs the width of the row, so its tick is at the row's right).
      const t = h('span', { class: 'mark', title: tip, style: `animation-delay: ${delay}` }, glyph(GLYPHS.tick, 16));
      const host = el.tagName === 'LABEL' || el.tagName === 'BUTTON' ? el : el.closest('label');
      if (host) { host.classList.add('marked'); host.append(t); } else { t.classList.add('beside'); el.after(t); }
      setTimeout(() => t.remove(), MARK_MS - age);
    }
  }
}
