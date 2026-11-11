/* Where each painting hangs on the floating wall (gallery.js draws them). Plain arithmetic with no drawing in it,
   so it can be checked on its own (node, with made-up window sizes).

   Everything is worked out as it looks: positions and sizes at the middle depth (D0), where a painting moves
   exactly with the page. A painting at depth d hangs at height y; when the view is at height c, it shows at
   (y - c) * D0 / d. Across, it never moves (sx), but down the screen nearer ones move faster than further ones,
   so two paintings slide past one another as the page scrolls. So whether two paintings graze or cover each
   other isn't one moment's question: each pair is judged over the whole stretch of scrolling while both are in
   view, at 24 moments along it.

   Down, each painting follows the last with room for both (more room on a phone, where they're one above
   another rather than side by side), and may be given a little more room still if that's the only way to hang
   it well. Across, each takes the place that best: keeps the wall balanced as you see it (the weight, how big
   the paintings look, evened out left and right of those around it); never grazes a neighbour, in either
   direction (overlaps are welcome, but only clear ones; a near miss, or a sliver of overlap, looks unintended;
   the longer it lasts while scrolling, the worse); never hides most of a further painting behind a nearer one
   for long; doesn't line its edges up with a neighbour's; doesn't sit straight below the one before. */

export function arrange(items, P, view) {
  const { aspect, D0, MID, RANGE, viewH0 } = view;
  const half = viewH0 / 2 * aspect;                                  // half the view's width, at D0
  const narrow = aspect < 0.9;
  const scale = Math.min(1, half / 4) * P.size;
  const mix = Math.min(Math.max(P.nearness, 0), 1);
  const placed = [], out = [];
  let y = 0, lastH = 0;
  items.forEach((u, i) => {
    const d = Math.max(MID + ((1 - mix) * u.f + mix * u.r - 0.5) * RANGE * P.depth, 4);
    const sw = u.w * scale, sh = u.h * scale;
    const seen = sh * D0 / d, seenW = sw * D0 / d;
    const room = Math.max(half * 0.95 - seenW / 2, 0);
    const reach = Math.min(room * (narrow ? 0.7 : 1) * P.spread, room);
    // the first hangs with its top just below the heading; each after it below the last
    const step = i ? (narrow ? 1.25 : 0.9) * P.spacing * (lastH + seen) / 2 : 0;
    const y0 = i ? y - step : 0.2 * viewH0 - seen / 2;
    let best = null;
    for (const more of i ? [0, 0.2, 0.4, 0.7] : [0]) {
      const yy = y0 - more * step;
      // the first is the one exception: it's placed as it looks when the section arrives (c = 0), not at its depth
      const wy = i ? yy : yy * d / D0;
      for (let k = -1; k <= 1.0001; k += 0.05) {
        const sx = k * reach;
        const me = { sx, y: wy, d, w: seenW, h: seen };
        let mass = seenW * seen * sx, total = seenW * seen, bad = 0;
        for (const q of placed) {
          if (Math.abs(q.y - wy) < viewH0 * 0.6) { mass += q.w * q.h * q.sx; total += q.w * q.h; }
          bad += pair(me, q, { D0, viewH0, half });
        }
        const prev = placed[placed.length - 1];
        const under = prev ? Math.max(0, 0.3 - Math.abs(prev.sx - sx) / (half || 1)) : 0;
        const score = Math.abs(mass / total) / (half || 1) + bad + under
          + 0.25 * Math.abs(k - (u.jitter * 2 - 1)) + 1.5 * more;
        if (!best || score < best.score) best = { score, me, yy };
      }
    }
    placed.push(best.me);
    y = best.yy; lastH = seen;
    out.push({ d, sw, sh, x: best.me.sx * d / D0, y: best.me.y, cy: best.me.y, score: best.score });
  });
  return { scale, items: out, end: out.length ? out[out.length - 1].cy : 0 };
}

/* How badly two paintings sit together, over the scrolling while both are in view: the share of that time they
   graze (3 for all of it), plus the share of it the nearer hides more than half of the further (4 for all of
   it), plus 1 if their edges line up across while they overlap. Also used to check a whole wall. */
export function pair(a, b, view, detail) {
  const { D0, viewH0, half } = view;
  const sy = (p, c) => (p.y - c) * D0 / p.d;
  // the stretch of view heights c while each is at least partly in view
  const span = (p) => { const r = (viewH0 + p.h) / 2 * p.d / D0; return [p.y - r, p.y + r]; };
  const [a0, a1] = span(a), [b0, b1] = span(b);
  const lo = Math.max(a0, b0), hi = Math.min(a1, b1);
  if (hi <= lo) return detail ? { graze: 0, cover: 0, lined: 0, bad: 0 } : 0;
  const gx = Math.abs(a.sx - b.sx) - (a.w + b.w) / 2;              // across: + a gap, - an overlap (never changes)
  const nx = gx / Math.min(a.w, b.w);
  const ox = Math.max(0, -gx);
  const further = a.d > b.d ? a : b;
  let graze = 0, cover = 0;
  const N = 24;
  for (let s = 0; s < N; s++) {
    const c = lo + (hi - lo) * (s + 0.5) / N;
    const gy = Math.abs(sy(a, c) - sy(b, c)) - (a.h + b.h) / 2;     // down: + a gap, - an overlap
    const ny = gy / Math.min(a.h, b.h);
    const gap = Math.max(gx, gy);
    // grazing: a near miss (a gap under 4% of the view's width), or overlapping by under a fifth in one direction
    if ((gap >= 0 && gap < 0.04 * half) || (gap < 0 && Math.max(nx, ny) > -0.2)) graze++;
    const oy = Math.max(0, -gy);
    if (ox * oy / (further.w * further.h) > 0.5) cover++;
  }
  graze /= N; cover /= N;
  let lined = 0;
  if (gx < 0) {
    const lefts = Math.abs((a.sx - a.w / 2) - (b.sx - b.w / 2)), rights = Math.abs((a.sx + a.w / 2) - (b.sx + b.w / 2));
    if (Math.min(lefts, rights) < 0.04 * half) lined = 1;
  }
  const bad = 3 * graze + 4 * cover + lined;
  return detail ? { graze, cover, lined, bad } : bad;
}
