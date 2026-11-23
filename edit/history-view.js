/* The History view: each publication, and every earlier version of anything, which can be brought back as a draft. */

import { h, toast, glyph, GLYPHS } from './dom.js';
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
  const binned = new Set();          // a bin on each removed thing's newest version only (releases come newest first)
  for (const r of state.history.releases) {
    const when = new Date(r.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    out.push(h('div', { class: 'card' },
      h('div', {}, h('b', {}, when), h('span', { class: 'muted' }, `  ${r.by || ''}`)),
      r.note ? h('div', { class: 'muted' }, r.note) : null,
      ...r.revisions.map((v) => {
        const d = parse(v.data), p = parse(v.previous);
        const what = d || p || {};
        const name = v.kind === 'artwork' ? what.title : v.kind === 'genre' ? `Genre: ${what.title}` : label({ id: v.entry_id, kind: v.kind, draft: v.data, published: v.previous });
        const kind = !p ? 'new' : !d ? 'gone' : unhidden(v.data) === unhidden(v.previous) ? (d.hidden ? 'hiding' : 'showing') : 'changed';
        const mine = byId(v.entry_id);
        // Bring back a removal = undo it (what it was before); "as now" when the draft already is that
        const back = kind === 'gone' ? v.previous : v.data;
        const same = mine && mine.draft === back;
        // gone from the editor altogether (its removal published): it can be deleted for good from here
        const bin = !mine && !binned.has(v.entry_id) && (binned.add(v.entry_id), true);
        return h('div', { class: 'row', style: 'margin-top:0.4rem' },
          h('span', { class: 'grow' }, name, ' ', h('span', { class: `badge ${kind}` }, { new: 'Added', gone: 'Removed', hiding: 'Hidden', showing: 'Shown again' }[kind] || 'Changed')),
          same ? h('span', { class: 'muted' }, 'as now') : h('button', { title: kind === 'gone' ? 'Put it back as it was before it was removed, as a draft (publish it under Review)' : 'Put this version back as a draft (publish it under Review)',
            onclick: () => act(() => call('POST', 'restore', { revision: v.id }), 'Brought back as a draft: publish it under Review') }, 'Bring back'),
          bin ? h('button', { class: 'lib-bin danger', title: 'Delete for good: every version of it leaves History, with the pictures only those versions used (the photo stays in the Library)',
            'aria-label': `Delete ${name} for good`, onclick: () => forget(v.entry_id, name) }, glyph(GLYPHS.bin)) : h('span', { class: 'lib-bin-space' }));
      })));
  }
  return out;
}

/* Delete a removed thing for good (library.js forget): it can't be undone, so it asks first. */
function forget(entry, name) {
  if (!confirm(`Delete "${name}" for good?\n\nEvery version of it leaves History, so it can never be brought back, and any picture that only those versions used is deleted from storage. The photo it came from stays in the Library.`)) return;
  act(() => call('POST', 'history/forget', { entry }), (out) => {
    state.history = null; state.library = null;
    return `Deleted for good: ${out.versions} version${out.versions === 1 ? '' : 's'}${out.renditions ? `, ${out.renditions} picture${out.renditions === 1 ? '' : 's'}` : ''}${out.files ? `, ${out.files} file${out.files === 1 ? '' : 's'} from storage` : ''}`;
  });
}
