/* What uses a Library item or one of its parts, as marks: on the site, hidden, in a draft, or only in History. */

import { h, glyph, GLYPHS } from './dom.js';

export const STATES = { published: ['live', 'On the site'], hidden: ['hidden', 'Published, but hidden from visitors'], draft: ['draft', 'In a draft'], history: ['past', 'Only in History'] };
const RANK = { published: 0, hidden: 1, draft: 2, history: 3 };

/* One mark per thing using it, at its strongest (on the site, in a draft, or only in History). */
export function strongest(list) {
  const by = new Map();
  for (const u of list) if (!by.has(u.entry) || RANK[u.state] < RANK[by.get(u.entry).state]) by.set(u.entry, u);
  return [...by.values()].sort((a, b) => RANK[a.state] - RANK[b.state]);
}
export const useMarks = (uses, name) => uses.map((u) => h('span', { class: `lib-use ${u.state}`, title: u.label === name ? STATES[u.state][1] : `${u.label}: ${STATES[u.state][1].toLowerCase()}` },
  glyph(GLYPHS[STATES[u.state][0]], 13), u.label === name ? null : u.label));
