/* A painting's medium, size and year: the fields shared by the add form and a painting's Edit form. */

import { h } from './dom.js';
import { state, current } from './state.js';

/* The painting's medium, size in centimetres and year, as separate fields (the server makes the details line
   from them). d: the painting's data, or {} for a new one, which starts with the last medium and height used.
   What drives what (Christopher's decision, Nov 2026): a measured size is the dog. Measured: the height and width
   are as typed and fix the picture's shape when it's squared up. Not measured (estimated: true in the data):
   the shape comes from the photo, and the size only sets the scale: the side last typed is kept and the other
   follows the picture's proportions (f.ratio, width over height, set by the darkroom), greyed. Whether visitors
   see the size is a separate tick (size_shown), on by default when measured, off when not. */
export function detailsFields(f, d, onSize) {
  const media = [...new Set(state.entries.filter((e) => e.kind === 'painting' && current(e)).map((e) => current(e).medium).filter(Boolean))].sort();
  const listId = `media-${Math.random().toString(36).slice(2, 8)}`;
  const remembered = (k, dflt) => { try { return localStorage.getItem(k) || dflt; } catch { return dflt; } };
  const isNew = !d.title;
  const typed = (side) => () => {
    if (f.estimated.checked) { f.scaleBy = side; f[side].classList.remove('suggested'); f.follow(); }
    if (onSize) onSize();
  };
  const num = (value, label, side) => h('label', { class: 'num' }, label,
    h('input', { type: 'number', inputmode: 'decimal', min: '0.1', step: '0.1', value, oninput: typed(side) }));
  const group = `how-${Math.random().toString(36).slice(2, 8)}`;
  const how = () => {                                // Measured / Not measured chosen
    if (!f.shownTouched) f.shown.checked = !f.estimated.checked;
    if (f.estimated.checked) f.follow(); else { f.height.classList.remove('suggested'); f.width.classList.remove('suggested'); }
    if (onSize) onSize();
  };
  const unmeasured = isNew || !!d.estimated;
  const out = [
    h('label', {}, 'Medium'),
    f.medium = h('input', { type: 'text', autocomplete: 'off', list: listId,
      value: d.medium ?? (isNew ? remembered('editor-medium', '') : '') }),
    h('datalist', { id: listId }, ...media.map((m) => h('option', { value: m }))),
    h('div', { class: 'row size' },
      f.hBox = num(d.cm ? d.cm[0] : isNew ? remembered('editor-height', '60') : '', 'Height (cm)', 'height'),
      f.wBox = num(d.cm ? d.cm[1] : '', 'Width (cm)', 'width'),
      f.yBox = h('label', { class: 'num' }, 'Year', h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off',
        value: d.year ?? (isNew ? String(new Date().getFullYear()) : '') }))),
    h('div', { class: 'row how' },
      h('label', { class: 'tick', title: 'The height and width are as measured, and the picture is squared up to exactly that shape' },
        f.measured = h('input', { type: 'radio', name: group, checked: !unmeasured, onchange: how }), 'Measured'),
      h('label', { class: 'tick', title: 'The shape comes from the photo; the size you type only sets the scale, and the other side follows' },
        f.estimated = h('input', { type: 'radio', name: group, checked: unmeasured, onchange: how }), 'Not measured')),
    h('label', { class: 'tick' }, f.shown = h('input', { type: 'checkbox', checked: d.size_shown ?? !unmeasured,
      onchange: () => { f.shownTouched = true; } }), 'Show the size to visitors'),
  ];
  f.height = f.hBox.querySelector('input'); f.width = f.wBox.querySelector('input'); f.year = f.yBox.querySelector('input');
  f.scaleBy = 'height'; f.shownTouched = d.size_shown != null;
  f.ratio = d.cm ? d.cm[1] / d.cm[0] : null;
  /* Not measured: work out the side not typed from the one that was. */
  f.follow = () => {
    if (!f.estimated.checked || !(f.ratio > 0)) return;
    const [from, to] = f.scaleBy === 'width' ? [f.width, f.height] : [f.height, f.width];
    const v = parseFloat(from.value);
    if (!(v > 0)) return;
    to.value = String(Math.round((f.scaleBy === 'width' ? v / f.ratio : v * f.ratio) * 10) / 10);
    to.classList.add('suggested'); from.classList.remove('suggested');
  };
  if (unmeasured && !isNew) f.width.classList.add('suggested');
  return out;
}
/* The fields' values, or an error message. */
export function detailsOf(f) {
  const hgt = parseFloat(f.height.value), wid = parseFloat(f.width.value);
  if (!(hgt > 0) || !(wid > 0)) return { error: 'Give the height and width in centimetres' };
  return { medium: f.medium.value.trim(), cm: [Math.round(hgt * 10) / 10, Math.round(wid * 10) / 10], year: f.year.value.trim(),
    ...(f.estimated.checked ? { estimated: true } : {}), size_shown: f.shown.checked };
}

/* Forms are rebuilt whenever the page re-renders (after any save, e.g. adding a genre mid-way), so what has been
   typed into an open form is carried over from its previous copy: the add form's on its darkroom (dr.fields),
   each open Edit form's in painting.js editFields. */
export function carry(from, to) {
  if (!from) return;
  for (const k of ['title', 'medium', 'height', 'width', 'year']) if (from[k] && to[k]) to[k].value = from[k].value;
  for (const k of ['measured', 'estimated', 'shown', 'wide']) if (from[k] && to[k]) to[k].checked = from[k].checked;
  for (const k of ['height', 'width']) if (from[k] && to[k]) to[k].classList.toggle('suggested', from[k].classList.contains('suggested'));
  for (const k of ['scaleBy', 'shownTouched', 'ratio']) if (k in from) to[k] = from[k];
  if (from.section && to.section && [...to.section.options].some((o) => o.value === from.section.value)) to.section.value = from.section.value;
}

/* For the editor's rows: the size when the details line doesn't say all there is to know about it. */
export function sizeNote(d) {
  if (!d.cm) return null;
  const shown = d.size_shown ?? !d.estimated;
  if (shown) return null;                          // the details line has it ("about" when not measured)
  return h('span', { class: 'muted' }, ` (${d.estimated ? 'not measured' : 'measured'}: ${d.cm[0]} × ${d.cm[1]} cm${shown ? '' : ', hidden from visitors'})`);
}
