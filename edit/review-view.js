/* The Review view: every unpublished change, each with a tick: publish the ticked ones, or all, or discard them. */

import { SITES } from '/links.js';
import { h } from './dom.js';
import { state, byId, changed, current, draftOf, liveOf, status, label } from './state.js';
import { call, act, discard } from './server.js';
import { render } from './render.js';
import { badge } from './widgets.js';

const ticked = new Set();
let ticksFor = '';

const FIELDS = { type: 'Kind', versions: 'Versions', play: 'Plays', calm: 'For reduced motion', file: 'Files', focus: 'Kept in view', shade: 'Shade', title: 'Title', medium: 'Medium', cm: 'Size', year: 'Year', estimated: 'Not measured', size_shown: 'Size shown', section: 'Genre', order: 'Position', wide: 'Wide', white_paper: 'White paper', text: 'Text', featured: 'Featured', hidden: 'Hidden from visitors', media: 'Picture', rendition: 'Picture' };
function diffs(e) {
  const a = liveOf(e), b = draftOf(e);
  if (!a || !b) return [];
  if (e.kind === 'links') {
    const show = (v) => (!v || !v.name ? '(none)' : `${v.name}${v.on ? '' : ' (not shown)'}`);
    return SITES.filter((s) => JSON.stringify(a[s.key]) !== JSON.stringify(b[s.key])).map((s) =>
      h('div', {}, h('b', {}, `${s.name}: `), h('del', {}, show(a[s.key])), ' → ', h('ins', {}, show(b[s.key]))));
  }
  const show = (k, v) => (v == null || v === '' ? '(none)' : k === 'section' ? ((byId(v) && current(byId(v)).title) || v)
    : k === 'cm' ? `${v[0]} × ${v[1]} cm` : k === 'focus' ? `${Math.round(v[0] * 100)}% across, ${Math.round(v[1] * 100)}% down`
    : k === 'shade' ? `${Math.round(v * 100)}%` : k === 'versions' ? v.map((x) => `${x.w} × ${x.h}`).join(', ') : typeof v === 'boolean' ? (v ? 'yes' : 'no') : k === 'order' ? `${v + 1}` : String(v));
  if (status(e) === 'hiding' || status(e) === 'showing') return [];      // the badge says it all
  // the details line is made from medium, size and year, so it isn't listed as a change of its own; a new picture
  // is one line (its sizes, preview and process change with it)
  const pic = ['media', 'rendition', 'w', 'h', 'widths', 'ext', 'preview', 'process', 'white_paper'];
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !(k === 'details' && 'cm' in b)
    && JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  const out = [];
  if (e.kind === 'painting' && keys.some((k) => pic.includes(k))) out.push(h('div', {}, h('b', {}, 'Picture: '), 'made afresh'));
  for (const k of keys) {
    if (e.kind === 'painting' && pic.includes(k)) continue;
    if (k === 'hidden') { out.push(h('div', {}, h('b', {}, b.hidden ? 'Hidden from visitors' : 'Shown again'))); continue; }
    out.push(h('div', {}, h('b', {}, `${FIELDS[k] || k}: `), h('del', {}, show(k, a[k])), ' → ', h('ins', {}, show(k, b[k]))));
  }
  return out;
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
