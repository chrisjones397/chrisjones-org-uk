/* Comparing Library items or renditions, over the page: side by side, or blinking between two. */

import { h, glyph, GLYPHS, MB } from './dom.js';
import { STATES, strongest } from './uses.js';

/* One item large, or two or three side by side, over the page: each picture as big as fits, with what tells them
   apart underneath: the original's pixels, its weight, when it was added, its name and code. The best (most pixels)
   is marked when comparing. Tap the backdrop, the cross or Escape to close. */
export function showItems(list) {
  list = list.map((x) => (x.it ? x : { it: x, part: null }));
  const renOf = (x) => x.part && x.it.data.renditions[x.part];
  // pixels: a rendition's largest size; an item's original
  const px = (x) => { const r = renOf(x); if (r) return r.w * r.h; const o = x.it.data && x.it.data.original; return o && o.w ? o.w * o.h : 0; };
  const most = list.length > 1 ? Math.max(...list.map(px)) : 0;
  const when = (t) => (t ? new Date(t).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'not known');
  const largeOf = (x) => { const r = renOf(x); return r ? `${x.it.id}/${x.part}/${Math.max(...r.widths)}.${r.ext || 'jpg'}` : x.it.large; };
  const best = (x) => (most && px(x) === most ? { class: 'lib-best', title: 'The most pixels of these' } : {});
  const facts = (x) => {
    const it = x.it, r = renOf(x);
    const lines = [h('div', { class: 'lib-cmp-name' }, it.name, x.part ? h('span', { class: 'muted' }, ` · ${x.part}`) : null), h('div', { class: 'lib-cmp-code' }, it.id)];
    if (r) {
      const p = it.parts.find((q) => q.part === x.part), u = strongest(p.uses)[0];
      lines.push(h('div', best(x), glyph(GLYPHS.sizes, 13), ` ${r.widths.length} sizes, up to ${r.w} × ${r.h}`));
      lines.push(h('div', {}, MB(p.bytes)));
      lines.push(h('div', {}, u ? glyph(GLYPHS[STATES[u.state][0]], 13) : null, ` ${u ? STATES[u.state][1] : 'Unused'}`));
      lines.push(h('div', {}, glyph(GLYPHS.past, 13), ` ${when(p.made)}`));
      return h('div', { class: 'lib-cmp-facts' }, ...lines);
    }
    const o = it.data && it.data.original, orig = it.parts.find((p) => p.part === 'original');
    if (it.kind === 'video') {
      for (const v of it.parts.filter((p) => /^\d+x\d+/.test(p.part))) lines.push(h('div', {}, glyph(GLYPHS.play, 13), ` ${v.w} × ${v.h}${v.seconds ? `, ${v.seconds} s` : ''}, ${MB(v.bytes)}`));
    } else {
      lines.push(h('div', best(x), glyph(GLYPHS.photo, 13), o && o.w ? ` ${o.w} × ${o.h} (${(o.w * o.h / 1e6).toFixed(1)} megapixels)` : ' size not known'));
      if (orig) lines.push(h('div', {}, `Original ${MB(orig.bytes)}${orig.ext ? ` ${orig.ext.toUpperCase()}` : ''}`));
    }
    lines.push(h('div', {}, glyph(GLYPHS.past, 13), ` ${when(it.added)}`));
    return h('div', { class: 'lib-cmp-facts' }, ...lines);
  };
  const close = () => { box.remove(); removeEventListener('keydown', onKey); };
  const onKey = (ev) => { if (ev.key === 'Escape') close(); };
  const box = h('div', { class: 'lib-overlay', role: 'dialog', 'aria-label': list.length > 1 ? 'Compare' : list[0].it.name,
    onclick: (ev) => { if (ev.target === box || ev.target.classList.contains('lib-cmp')) close(); } },
    h('button', { class: 'lib-close', title: 'Close', 'aria-label': 'Close', onclick: close }, glyph(GLYPHS.close, 20)),
    list.length === 2 ? h('button', { class: 'lib-mode', title: 'Blink between the two instead', 'aria-label': 'Blink between the two',
      onclick: () => { close(); blinkView(list); } }, glyph(GLYPHS.blink, 20)) : null,
    h('div', { class: `lib-cmp n${list.length}` }, ...list.map((x) => h('figure', {},
      largeOf(x) ? h('img', { src: `/media/${largeOf(x)}`, alt: x.it.name }) : h('span', { class: 'lib-none' }, glyph(GLYPHS.photo, 40)),
      facts(x)))));
  document.body.append(box);
  addEventListener('keydown', onKey);
}

/* Two things blinked in one place (Christopher's way of comparing renditions): both drawn in the same box, one
   shown at a time. Tap the picture, the ⇄ button, Space or an arrow key to swap; ▶ swaps on its own every 0.7
   seconds. Zoom with a pinch, a trackpad pinch, the mouse wheel or + and −, and drag to look round: both move
   together, so the same part of each is seen. The two labels in the corner (a coloured dot and a name each, the
   one showing bright) stay put whatever the zoom. Largest size of each, so detail can be checked. */
export function blinkView(pair) {
  pair = pair.map((x) => (x.it ? x : { it: x, part: null }));
  const renOf = (x) => {
    const rs = (x.it.data && x.it.data.renditions) || {};
    const part = x.part || Object.keys(rs).sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)))[0];
    return part && rs[part] ? { part, ...rs[part] } : null;
  };
  const srcOf = (x) => { const r = renOf(x); return r ? `/media/${x.it.id}/${r.part}/${Math.max(...r.widths)}.${r.ext || 'jpg'}` : x.it.large && `/media/${x.it.large}`; };
  const sizeOf = (x) => { const r = renOf(x); return r ? `${r.w} × ${r.h}` : ''; };
  let shown = 0, s = 1, tx = 0, ty = 0, timer = null;
  const imgs = pair.map((x, i) => h('img', { src: srcOf(x), alt: x.it.name, draggable: false, class: i ? 'off' : '' }));
  const inner = h('div', { class: 'blink-inner' }, ...imgs);
  const stage = h('div', { class: 'blink-stage' }, inner);
  const labels = pair.map((x, i) => h('div', { class: `blink-label k${i}` + (i ? '' : ' on') },
    h('span', { class: 'dot' }), h('span', {}, x.it.name, x.part ? h('b', {}, ` ${x.part}`) : null), h('span', { class: 'muted' }, ` ${sizeOf(x)}`)));
  const draw = () => { inner.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`; };
  const show = (i) => { shown = i; imgs.forEach((im, k) => im.classList.toggle('off', k !== i)); labels.forEach((l, k) => l.classList.toggle('on', k === i)); };
  const swap = () => show(1 - shown);
  const clamp = () => {
    const W = stage.clientWidth, H = stage.clientHeight;
    s = Math.min(12, Math.max(1, s));
    tx = Math.min(0, Math.max(W - W * s, tx)); ty = Math.min(0, Math.max(H - H * s, ty));
    draw();
  };
  const zoomAt = (f, cx, cy) => { const r = stage.getBoundingClientRect(), x = cx - r.left, y = cy - r.top, n = Math.min(12, Math.max(1, s * f)); tx = x - (x - tx) * n / s; ty = y - (y - ty) * n / s; s = n; clamp(); };
  const zoomMid = (f) => { const r = stage.getBoundingClientRect(); zoomAt(f, r.left + r.width / 2, r.top + r.height / 2); };
  const fit = () => { s = 1; tx = 0; ty = 0; draw(); };
  stage.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    if (ev.ctrlKey || s === 1) zoomAt(Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.002)), ev.clientX, ev.clientY);
    else { tx -= ev.deltaX; ty -= ev.deltaY; clamp(); }
  }, { passive: false });
  // pointers: one drags (a tap without moving swaps), two pinch
  const ptrs = new Map(); let moved = false, pinch = null;
  stage.addEventListener('pointerdown', (ev) => { stage.setPointerCapture(ev.pointerId); ptrs.set(ev.pointerId, [ev.clientX, ev.clientY]); moved = ptrs.size > 1 ? true : false; pinch = null; });
  stage.addEventListener('pointermove', (ev) => {
    const was = ptrs.get(ev.pointerId); if (!was) return;
    const now = [ev.clientX, ev.clientY];
    if (ptrs.size === 1) {
      if (Math.hypot(now[0] - was[0], now[1] - was[1]) > 4 || moved) { moved = true; tx += now[0] - was[0]; ty += now[1] - was[1]; clamp(); ptrs.set(ev.pointerId, now); }
      return;
    }
    ptrs.set(ev.pointerId, now);
    const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (pinch) { zoomAt(d / pinch.d, m[0], m[1]); tx += m[0] - pinch.m[0]; ty += m[1] - pinch.m[1]; clamp(); }
    pinch = { d, m };
  });
  const up = (ev) => { if (!ptrs.has(ev.pointerId)) return; ptrs.delete(ev.pointerId); if (!ptrs.size && !moved && ev.type === 'pointerup') swap(); if (ptrs.size < 2) pinch = null; };
  stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
  const play = h('button', { title: 'Blink on its own (tap again to stop)', 'aria-label': 'Blink on its own', onclick: () => toggleAuto() }, glyph(GLYPHS.play, 18));
  const toggleAuto = () => {
    if (timer) { clearInterval(timer); timer = null; play.replaceChildren(glyph(GLYPHS.play, 18)); return; }
    timer = setInterval(swap, 700); play.replaceChildren(glyph(GLYPHS.pause, 18));
  };
  const close = () => { if (timer) clearInterval(timer); box.remove(); removeEventListener('keydown', onKey); removeEventListener('resize', clamp); };
  const onKey = (ev) => {
    if (ev.key === 'Escape') close();
    else if (ev.key === ' ' || ev.key.startsWith('Arrow')) { ev.preventDefault(); swap(); }
    else if (ev.key === '+' || ev.key === '=') zoomMid(1.4);
    else if (ev.key === '-') zoomMid(1 / 1.4);
    else if (ev.key === '0') fit();
  };
  const box = h('div', { class: 'lib-overlay blink', role: 'dialog', 'aria-label': 'Blink between the two' },
    h('div', { class: 'blink-labels' }, ...labels),
    h('button', { class: 'lib-close', title: 'Close', 'aria-label': 'Close', onclick: close }, glyph(GLYPHS.close, 20)),
    stage,
    h('div', { class: 'blink-bar' },
      h('button', { title: 'Swap (or tap the picture, or Space)', 'aria-label': 'Swap', onclick: swap }, glyph(GLYPHS.swap, 18)),
      play,
      h('button', { title: 'Zoom out', 'aria-label': 'Zoom out', onclick: () => zoomMid(1 / 1.6) }, '−'),
      h('button', { title: 'Zoom in (or pinch, or the mouse wheel)', 'aria-label': 'Zoom in', onclick: () => zoomMid(1.6) }, '+'),
      h('button', { title: 'Whole picture', 'aria-label': 'Whole picture', onclick: fit }, glyph(GLYPHS.fit, 18)),
      h('button', { title: 'Side by side instead', 'aria-label': 'Side by side', onclick: () => { close(); showItems(pair); } }, glyph(GLYPHS.compare, 18))));
  document.body.append(box);
  addEventListener('keydown', onKey); addEventListener('resize', clamp);
}
