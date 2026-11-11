/* The History view: each publication, and every earlier version of anything, which can be brought back as a draft. */

import { h, toast } from './dom.js';
import { state, parse, byId, unhidden, label } from './state.js';
import { call, act } from './server.js';
import { render } from './render.js';

export function historyView() {
  if (!state.history) {
    call('GET', 'history').then((d) => { state.history = d; render(); }).catch((e) => toast(e.message, true));
    return [h('h1', {}, 'History'), h('p', { class: 'muted' }, 'Loading…')];
  }
  const out = [h('h1', {}, 'History'),
    h('p', { class: 'hint' }, 'Each time something was published. "Bring back" puts that version into the draft; publish it to make it live again.')];
  for (const r of state.history.releases) {
    const when = new Date(r.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    out.push(h('div', { class: 'card' },
      h('div', {}, h('b', {}, when), h('span', { class: 'muted' }, `  ${r.by || ''}`)),
      r.note ? h('div', { class: 'muted' }, r.note) : null,
      ...r.revisions.map((v) => {
        const d = parse(v.data), p = parse(v.previous);
        const what = d || p || {};
        const name = v.kind === 'painting' ? what.title : v.kind === 'section' ? `Genre: ${what.title}` : label({ id: v.entry_id, kind: v.kind, draft: v.data, published: v.previous });
        const kind = !p ? 'new' : !d ? 'gone' : unhidden(v.data) === unhidden(v.previous) ? (d.hidden ? 'hiding' : 'showing') : 'changed';
        const mine = byId(v.entry_id);
        // Bring back a removal = undo it (what it was before); "as now" when the draft already is that
        const back = kind === 'gone' ? v.previous : v.data;
        const same = mine && mine.draft === back;
        return h('div', { class: 'row', style: 'margin-top:0.4rem' },
          h('span', { class: 'grow' }, name, ' ', h('span', { class: `badge ${kind}` }, { new: 'Added', gone: 'Removed', hiding: 'Hidden', showing: 'Shown again' }[kind] || 'Changed')),
          same ? h('span', { class: 'muted' }, 'as now') : h('button', { title: kind === 'gone' ? 'Put it back as it was before it was removed, as a draft (publish it under Review)' : 'Put this version back as a draft (publish it under Review)',
            onclick: () => act(() => call('POST', 'restore', { revision: v.id }), 'Brought back as a draft: publish it under Review') }, 'Bring back'));
      })));
  }
  return out;
}
