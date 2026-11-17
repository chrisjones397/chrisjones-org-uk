/* What uses a Library item or one of its parts, as marks: on the site, hidden, in a draft, or only in History. */


import { h, glyph, GLYPHS } from './dom.js';
import { openPainting } from './painting.js';

export const STATES = { published: ['live', 'On the site'], hidden: ['hidden', 'Published, but hidden from visitors'], draft: ['draft', 'In a draft'], history: ['past', 'Only in History'] };
const RANK = { published: 0, hidden: 1, draft: 2, history: 3 };

/* One mark per thing using it, at its strongest (on the site, in a draft, or only in History). */
export function strongest(list) {
  const by = new Map();
  for (const u of list) if (!by.has(u.entry) || RANK[u.state] < RANK[by.get(u.entry).state]) by.set(u.entry, u);
  return [...by.values()].sort((a, b) => RANK[a.state] - RANK[b.state]);
}
/* Each mark is a link to where the thing is used: a painting's Edit form in the Gallery (opened), a section's
   background under Content, or History. */
const placeOf = (u) => (u.state === 'history' ? '#history' : u.entry.startsWith('bg-') ? '#content' : '#gallery');
function goTo(u) {
  if (u.state === 'history') return;
  if (u.entry.startsWith('p-')) openPainting(u.entry);
  setTimeout(() => {                                // once the view has been drawn
    const el = document.querySelector(`[data-entry="${CSS.escape(u.entry)}"]`);
    if (el) el.scrollIntoView({ block: 'center' });
  }, 120);
}
export const useMarks = (uses, name) => uses.map((u) => h('a', { class: `lib-use ${u.state}`, href: placeOf(u), onclick: () => goTo(u),
  title: `${u.label === name ? STATES[u.state][1] : `${u.label}: ${STATES[u.state][1].toLowerCase()}`} (go to it)` },
  glyph(GLYPHS[STATES[u.state][0]], 13), u.label === name ? null : u.label));
