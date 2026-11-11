/* What the editor knows, shared by all its modules, and how to read it. Only server.js (and the start, in
   editor.js) writes to state; everything else reads it. */

import { paintingAt } from '/paths.js';

export const state = {
  entries: [],        // every entry (painting, genre, text, setting, background, links), draft and published
  media: false,       // whether file storage (R2) is switched on for this site
  who: '',            // who is signed in
  history: null,      // History's releases, once asked for (null: ask again)
  library: null,      // the Library's items, once asked for (null: ask again)
};

/* The page's sections, each with its heading, any other words, and its paragraphs (one text entry per section,
   paragraphs separated by a blank line; site.js puts them into the page's data-paragraphs="key" block). */
export const PAGE = [
  { name: 'Hero', heading: 't-hero-title', paras: 't-hero', bg: 'hero' },
  { name: 'Gallery', heading: 't-gallery-title', extra: [['t-gallery-button', 'Button']], paras: 't-gallery' },
  { name: 'Contact', heading: 't-contact-title', paras: 't-contact', bg: 'contact', links: true },
  { name: 'Profile', heading: 't-profile-title', paras: 't-profile' },
  { name: 'Footer', paras: 't-footer', bg: 'footer' },
];
export const TEXTS = PAGE.flatMap((p) => [
  ...(p.heading ? [[p.heading, `${p.name} heading`]] : []), ...(p.extra || []).map(([id, n]) => [id, `${p.name} ${n.toLowerCase()}`]),
  [p.paras, `${p.name} paragraphs`]]);

// ---- reading the entries -----------------------------------------------------------------------------------

export const parse = (v) => (v == null ? null : JSON.parse(v));
export const draftOf = (e) => parse(e.draft), liveOf = (e) => parse(e.published);
export const byId = (id) => state.entries.find((e) => e.id === id);
export const changed = (e) => e.draft !== e.published;
/* A change that only hides or shows something again is called that, not just "Changed". */
export const unhidden = (v) => { const o = JSON.parse(v); delete o.hidden; return JSON.stringify(o); };
export const status = (e) => (!changed(e) ? null : e.published == null ? 'new' : e.draft == null ? 'gone'
  : unhidden(e.draft) === unhidden(e.published) ? (draftOf(e).hidden ? 'hiding' : 'showing') : 'changed');
export const STATUS = { new: 'New', changed: 'Changed', gone: 'Removed', hiding: 'Hidden', showing: 'Shown again' };
/* Hidden: what visitors see (hiding acts at once, so the published version says). */
export const isHidden = (e) => !!(e && e.published && liveOf(e).hidden);
export const current = (e) => draftOf(e) || liveOf(e);
export const sections = () => state.entries.filter((e) => e.kind === 'section' && e.draft != null)
  .map((e) => ({ id: e.id, ...draftOf(e) })).sort((a, b) => a.order - b.order);
export const paintingsIn = (sid) => state.entries.filter((e) => e.kind === 'painting' && current(e).section === sid)
  .sort((a, b) => current(a).order - current(b).order);
export const thumb = (d) => `/${paintingAt(d, d.widths[0])}`;
export const label = (e) => {
  const d = current(e) || {};
  if (e.kind === 'painting') return d.title;
  if (e.kind === 'section') return `Genre: ${d.title}`;
  if (e.kind === 'text') return (TEXTS.find((t) => t[0] === e.id) || [0, e.id])[1].replace(/ \(.*/, '');
  if (e.kind === 'links') return 'Contact links';
  if (e.kind === 'background') return `${(PAGE.find((p) => p.bg === e.id.slice(3)) || { name: e.id.slice(3) }).name} background picture`;
  return e.id === 'settings-gallery' ? 'Gallery settings' : e.id;
};
