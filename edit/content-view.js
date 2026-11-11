/* The Content view: the page's words, section by section, with each section's background and the contact links. */

import { SITES, tidy, ok, icon } from '/links.js';
import { h, toast } from './dom.js';
import { byId, changed, current, PAGE } from './state.js';
import { save, discard } from './server.js';
import { render, HINT } from './render.js';
import { badge } from './widgets.js';
import { backgroundBox } from './background.js';

/* The page's words, a box for each section: its heading, then a box for each paragraph. */
const extraParas = {};               // section -> empty paragraph boxes added but not yet typed in
export function contentView() {
  const out = [h('h1', {}, 'Content'), h('p', { class: 'hint' }, HINT)];
  for (const sec of PAGE) {
    const card = h('div', { class: 'card' }, h('h2', { class: 'card-title' }, sec.name));
    const field = (id, name) => {
      const e = byId(id), text = e ? (current(e) || {}).text || '' : '';
      return h('div', { class: 'box' }, h('label', {}, name, ' ', e ? badge(e) : null),
        h('input', { type: 'text', value: text, 'data-k': id, onchange: (ev) => save([{ id, kind: 'text', data: { text: ev.target.value } }], null, id) }),
        e && changed(e) ? h('div', { class: 'actions' }, h('button', { onclick: () => discard([id]) }, 'Undo change')) : null);
    };
    if (sec.heading) card.append(field(sec.heading, 'Heading'));
    for (const [id, name] of sec.extra || []) card.append(field(id, name));
    if (sec.bg) card.append(backgroundBox(sec.bg));
    // Paragraphs: stored as one text, a blank line between paragraphs.
    const e = byId(sec.paras);
    const paras = (e ? (current(e) || {}).text || '' : '').split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
    const all = paras.concat(Array(extraParas[sec.paras] || 0).fill(''));
    const store = (list, key) => {
      extraParas[sec.paras] = list.filter((x) => !x.trim()).length;
      save([{ id: sec.paras, kind: 'text', data: { text: list.map((x) => x.trim().replace(/\n\s*\n/g, '\n')).filter(Boolean).join('\n\n') } }],
        'Saved as a draft', key);
    };
    all.forEach((text, i) => {
      const ta = h('textarea', { rows: Math.min(8, Math.max(2, Math.ceil(text.length / 60))), value: text, 'data-k': `${sec.paras}:${i}`,
        onchange: (ev) => { const list = all.slice(); list[i] = ev.target.value; store(list, `${sec.paras}:${i}`); } });
      card.append(h('div', { class: 'box' },
        h('div', { class: 'row' }, h('label', { class: 'grow' }, `Paragraph ${i + 1}`),
          h('span', { class: 'move' },
            h('button', { title: 'Move up', disabled: i === 0, onclick: () => { const l = all.slice(); [l[i - 1], l[i]] = [l[i], l[i - 1]]; store(l); } }, '↑'),
            h('button', { title: 'Move down', disabled: i === all.length - 1, onclick: () => { const l = all.slice(); [l[i + 1], l[i]] = [l[i], l[i + 1]]; store(l); } }, '↓')),
          h('button', { class: 'danger', title: 'Remove this paragraph', onclick: () => {
            if (!text.trim()) { extraParas[sec.paras]--; render(); return; }
            if (confirm('Remove this paragraph?')) store(all.filter((_, j) => j !== i));
          } }, 'Remove')),
        ta));
    });
    card.append(h('div', { class: 'actions' },
      e ? badge(e) : null,
      e && changed(e) ? h('button', { onclick: () => { extraParas[sec.paras] = 0; discard([sec.paras]); } }, 'Undo paragraph changes') : null,
      h('button', { onclick: () => { extraParas[sec.paras] = (extraParas[sec.paras] || 0) + 1; render(); } }, 'Add a paragraph')));
    if (sec.links) card.append(linksBox());
    out.push(card);
  }
  return out;
}

/* The contact links (entry 'links', links.js): a tick and a username for each site; the ticked ones are shown in
   the contact section and as icons in the header, in this order, each linking to the address built from the
   username (shown beside it, to try). A pasted profile address is read for the username. A box ticked before
   its username is typed waits here until it is. */
const tickedEmpty = new Set();
function linksBox() {
  const e = byId('links'), d = (e && current(e)) || {};
  const store = (key, change, mk) => {
    const next = {};
    for (const s of SITES) {
      const v = { ...(d[s.key] || { name: '', on: false }), ...(s.key === key ? change : {}) };
      if (v.name || v.on) next[s.key] = { name: v.name, on: !!v.on };
    }
    save([{ id: 'links', kind: 'links', data: next }], null, mk);
  };
  const box = h('div', { class: 'box links' }, h('label', {}, 'Links ', e ? badge(e) : null),
    h('p', { class: 'hint' }, 'Tick the ones to show, here and as icons in the header, and type the username (or paste the profile\'s address).'));
  for (const s of SITES) {
    const v = d[s.key] || { name: '', on: false };
    const on = v.on || tickedEmpty.has(s.key);
    const input = h('input', { type: s.key === 'email' ? 'email' : 'text', value: v.name, placeholder: s.sample,
      autocapitalize: 'off', autocomplete: 'off', spellcheck: false, 'aria-label': `${s.name} ${s.key === 'email' ? 'address' : 'username'}`, 'data-k': `links:${s.key}`,
      onchange: (ev) => {
        const name = tidy(s.key, ev.target.value);
        if (name && !ok(s.key, name)) { toast(`That doesn't look like ${s.key === 'email' ? 'an email address' : `a username for ${s.name}`}`, true); return; }
        if (!name && on) tickedEmpty.add(s.key);
        if (name) tickedEmpty.delete(s.key);
        store(s.key, { name, on: on && !!name }, `links:${s.key}`);
      } });
    const tick = h('input', { type: 'checkbox', checked: on, 'data-k': `links:${s.key}:on`, onchange: (ev) => {
      if (ev.target.checked && !v.name) { tickedEmpty.add(s.key); render(); return; }
      tickedEmpty.delete(s.key);
      store(s.key, { on: ev.target.checked }, `links:${s.key}:on`);
    } });
    const glyph = h('span', { class: 'link-icon' }); glyph.innerHTML = icon(s.key, 18);   // drawn by links.js, nothing typed in it
    const tryIt = v.name && ok(s.key, v.name) && s.key !== 'email'
      ? h('a', { href: s.url(v.name), target: '_blank', rel: 'noopener', class: 'muted link-try', title: 'Open it, to check' }, s.shown(v.name))
      : h('span', { class: 'link-try' });
    box.append(h('div', { class: 'row link-row' }, h('label', { class: 'link-name' }, tick, glyph, s.name), input, tryIt));
  }
  if (e && changed(e)) box.append(h('div', { class: 'actions' }, h('button', { onclick: () => { tickedEmpty.clear(); discard(['links']); } }, 'Undo link changes')));
  return box;
}
