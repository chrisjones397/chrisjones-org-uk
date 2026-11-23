/* The Review view: every unpublished change, each with a tick: publish the ticked ones, or all, or discard them. */

import { SITES } from '/links.js';
import { h, glyph, GLYPHS } from './dom.js';
import { state, byId, changed, current, draftOf, liveOf, status, label, picOf, pictureAt } from './state.js';
import { call, act, discard } from './server.js';
import { render } from './render.js';
import { badge } from './widgets.js';
import { cropFrames } from './background.js';

const ticked = new Set();
let ticksFor = '';

const FIELDS = { play: 'Plays', calm: 'For reduced motion or less data', focus: 'Kept in view', shade: 'Shade', title: 'Title', medium: 'Medium', cm: 'Size', year: 'Year', estimated: 'Not measured', size_shown: 'Size shown', genre: 'Genre', order: 'Position', wide: 'Wide', text: 'Text', featured: 'Featured', hidden: 'Hidden from visitors', rendition: 'Picture' };
function diffs(e) {
  const a = liveOf(e), b = draftOf(e);
  if (status(e) === 'hiding' || status(e) === 'showing') return [];      // the badge says it all
  // a background is judged by eye: as visitors see it now beside as it would be, on a phone and a wide screen
  const out = e.kind === 'background' ? [beforeAfter(bgLook(a), bgLook(b), 'bg')] : [];
  if (!a || !b) return out;
  if (e.kind === 'links') {
    const show = (v) => (!v || !v.name ? '(none)' : `${v.name}${v.on ? '' : ' (not shown)'}`);
    return SITES.filter((s) => JSON.stringify(a[s.key]) !== JSON.stringify(b[s.key])).map((s) =>
      h('div', {}, h('b', {}, `${s.name}: `), h('del', {}, show(a[s.key])), ' → ', h('ins', {}, show(b[s.key]))));
  }
  const show = (k, v) => (v == null || v === '' ? '(none)' : k === 'genre' ? ((byId(v) && current(byId(v)).title) || v)
    : k === 'cm' ? `${v[0]} × ${v[1]} cm` : k === 'shade' ? `${Math.round(v * 100)}%`
    : k === 'play' ? { once: 'once, stopping on its last frame', loop: 'on a loop' }[v] || v
    : k === 'calm' ? { last: 'its last frame', fade: 'a slow fade from first frame to last' }[v] || v
    : typeof v === 'boolean' ? (v ? 'yes' : 'no') : k === 'order' ? `${v + 1}` : String(v));
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  for (const k of keys) {
    // the document names a rendition (an id, which means nothing to read): say what kind of change it is
    if (k === 'rendition') {
      if (e.kind === 'artwork') out.push(beforeAfter(artLook(a), artLook(b)));
      out.push(h('div', {}, h('b', {}, 'Picture: '), pictureChange(a, b)));
      continue;
    }
    if (k === 'focus') { out.push(h('div', {}, h('b', {}, 'Kept in view: '), 'moved')); continue; }
    if (k === 'hidden') { out.push(h('div', {}, h('b', {}, b.hidden ? 'Hidden from visitors' : 'Shown again'))); continue; }
    out.push(h('div', {}, h('b', {}, `${FIELDS[k] || k}: `), h('del', {}, show(k, a[k])), ' → ', h('ins', {}, show(k, b[k]))));
  }
  return out;
}

/* Two pictures with an arrow between: what visitors see now (an open eye), and what they'd see once published (a pencil). */
function beforeAfter(before, after, cls = '') {
  const side = (g, t, what) => h('figure', { class: 'rv-side' }, what, h('figcaption', { title: t }, glyph(GLYPHS[g], 14), ' ', t));
  return h('div', { class: `rv-pair ${cls}` }, side('live', 'On the site now', before),
    h('span', { class: 'rv-arrow', 'aria-hidden': 'true' }, '→'), side('draft', 'Once published', after));
}
const nothing = (t, cls = '') => h('div', { class: `rv-none ${cls}` }, t);
const bgLook = (d) => {
  const r = picOf(d);
  return !d ? nothing('No background') : r ? h('div', { class: 'bg-frames rv' }, ...cropFrames(d, r)) : nothing('Picture not found');
};
const artLook = (d) => { const src = pictureAt(d, 300); return src ? h('img', { class: 'rv-art', src, alt: '' }) : nothing('No picture', 'art'); };

/* What sort of new picture it is: another photo or video altogether, the same one prepared afresh, or the same
   video with other versions. Names come from the Library when it has been opened. */
function pictureChange(a, b) {
  const ra = picOf(a), rb = picOf(b);
  if (!ra || !rb) return 'a different one';
  const kind = (r) => (r.kind === 'video' ? 'video' : 'photo');
  const it = state.library && state.library.items.find((x) => x.id === rb.item);
  const named = it && it.name ? ` (${it.name})` : '';
  if (ra.item !== rb.item) return kind(ra) === kind(rb) ? `a different ${kind(rb)}${named}` : `a ${kind(rb)}${named} instead of a ${kind(ra)}`;
  if (rb.kind === 'video') {
    const n = (r) => `${r.versions.length} version${r.versions.length === 1 ? '' : 's'}`;
    return `the same video, with other versions (${n(ra)} → ${n(rb)})`;
  }
  return ra.recipe === rb.recipe ? 'the same photo, prepared afresh in the darkroom' : 'another picture prepared from the same photo';
}

export function reviewView() {
  const list = state.entries.filter(changed).sort((a, b) => (a.draft_at || '').localeCompare(b.draft_at || ''));
  const key = list.map((e) => e.id + e.draft_at).join();
  if (key !== ticksFor) { ticked.clear(); list.forEach((e) => ticked.add(e.id)); ticksFor = key; }
  const out = [h('h1', {}, 'Review and publish'),
    h('p', { class: 'hint' }, 'Everything below is saved as a draft and visible in the preview, but not yet to visitors. Untick anything you want to hold back.')];
  if (!list.length) return out.concat(h('p', {}, 'Everything is published.'));
  for (const e of list) {
    const box = h('input', { type: 'checkbox', checked: ticked.has(e.id), onchange: (ev) => { ev.target.checked ? ticked.add(e.id) : ticked.delete(e.id); render(); } });
    out.push(h('div', { class: 'card' },
      h('label', { class: 'change' }, box, h('span', {}, label(e), ' ', badge(e),
        h('span', { class: 'muted' }, e.draft_by ? `  ${e.draft_by}` : ''))),
      h('div', { class: 'diff' }, ...diffs(e))));
  }
  const note = h('input', { type: 'text', placeholder: 'A note for the history (optional)' });
  const n = list.filter((e) => ticked.has(e.id)).length;
  out.push(h('label', {}, 'Note'), note,
    h('div', { class: 'actions' },
      h('button', { class: 'main', disabled: !n, onclick: () => publish([...ticked], note.value) }, `Publish ticked (${n})`),
      h('button', { onclick: () => publish(null, note.value) }, `Publish all (${list.length})`),
      h('button', { class: 'danger', disabled: !n, onclick: () => { if (confirm(`Discard ${n} change${n === 1 ? '' : 's'}? They go back to what visitors see now.`)) discard([...ticked]); } }, 'Discard ticked')));
  return out;
}

function publish(ids, note) {
  act(() => call('POST', 'publish', { ids, note }), (out) => {
    const extra = out.added.length ? ` (with ${out.added.map((id) => label(byId(id) || { id, kind: '' })).join(', ')}, which ${out.added.length === 1 ? 'it needs' : 'they need'})` : '';
    return `Published ${out.published.length} change${out.published.length === 1 ? '' : 's'}${extra}`;
  });
}
