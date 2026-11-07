/* Preparing a photo of a painting in the browser before it's uploaded (used by admin/editor.js):
     1. white balance: none; "paper all round" (the build's method, for drawings on white paper); or from spots
        picked on the photo that should be white or neutral grey (one spot evens out the colour; two or more
        also follow the light's fall-off across the photo);
     2. crop: four corners dragged onto the painting's corners, and the picture squared up (perspective
        corrected), optionally to the shape of the size given in its details.
   The choices are kept with the painting (its "process"), as fractions of the untouched original's width and
   height, so the same images can be made again from the original. Nothing here talks to the server. */

export const SOURCE_MAX = 4096;     // the working copy's longer side (Safari limits a canvas to about 16.7 million pixels)
export const SPOT = 0.01;           // a picked spot is a square this fraction of the photo's longer side, either way

export const canvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });

/* The picture (an image or a canvas) drawn at width w on a canvas, halving in steps for a smooth result. */
export function scaled(src, w) {
  let sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height;
  w = Math.max(1, Math.round(w));
  const th = Math.max(1, Math.round(sh * w / sw));
  while (sw / 2 >= w * 1.0001) {
    const c = canvas(Math.round(sw / 2), Math.round(sh / 2));
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, c.width, c.height);
    src = c; sw = c.width; sh = c.height;
  }
  const c = canvas(w, th);
  const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, w, th);
  return c;
}

/* A JPEG of the picture at width w. (Safari can't write WebP from a page, so uploads are JPEG.) */
export function resized(src, w) {
  const c = scaled(src, w);
  return new Promise((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error('Couldn\'t make an image size'))), 'image/jpeg', 0.88));
}

const copy = (c) => { const d = canvas(c.width, c.height); d.getContext('2d').drawImage(c, 0, 0); return d; };
const pixels = (c) => c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;

/* The median of each colour in a box of an image's pixels (so smudges and specks don't count). */
function median(px, w, x0, y0, x1, y1) {
  const hist = [0, 1, 2].map(() => new Uint32Array(256));
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * w + x) * 4; hist[0][px[i]]++; hist[1][px[i + 1]]++; hist[2][px[i + 2]]++;
  }
  const half = (x1 - x0) * (y1 - y0) / 2;
  return hist.map((counts) => { let t = 0, v = 0; while (v < 255 && (t += counts[v]) < half) v++; return Math.max(1, v); });
}

/* Divide every pixel by the paper's colour where it is. paperAt(i, j) gives the paper's colour at the centre of
   cell (i, j) of an n x n grid over the picture; the gains in between are spread smoothly (bilinear, like the
   build's resize). Changes the canvas in place. */
const N = 16;
function applyPaper(c, paperAt) {
  const W = c.width, H = c.height, n = N, gain = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const p = paperAt(i, j);
    for (let k = 0; k < 3; k++) gain[(j * n + i) * 3 + k] = 255 / Math.max(p[k], 1);
  }
  const where = (x, len) => { const g = Math.min(n - 1, Math.max(0, (x + 0.5) * n / len - 0.5)); const a = Math.min(n - 2, Math.floor(g)); return [a, g - a]; };
  const colA = new Int32Array(W), colT = new Float32Array(W);
  for (let x = 0; x < W; x++) { const [a, t] = where(x, W); colA[x] = a; colT[x] = t; }
  const ctx = c.getContext('2d'), im = ctx.getImageData(0, 0, W, H), d = im.data, row = new Float32Array(n * 3);
  for (let y = 0; y < H; y++) {
    const [a, t] = where(y, H);
    for (let q = 0; q < n * 3; q++) row[q] = gain[a * n * 3 + q] * (1 - t) + gain[(a + 1) * n * 3 + q] * t;
    let i = y * W * 4;
    for (let x = 0; x < W; x++, i += 4) {
      const o = colA[x] * 3, s = colT[x];
      d[i] = d[i] * (row[o] * (1 - s) + row[o + 3] * s);          // the array rounds, and stops at 255
      d[i + 1] = d[i + 1] * (row[o + 1] * (1 - s) + row[o + 4] * s);
      d[i + 2] = d[i + 2] * (row[o + 2] * (1 - s) + row[o + 5] * s);
    }
  }
  ctx.putImageData(im, 0, 0);
}

/* "Paper all round": build_site.py's white_paper(). The paper's colour is read all round the outer edges (a band
   2% of the shorter side deep, in 16 lengths along each side, on a copy 512 pixels across) and filled in
   smoothly inside (a Coons patch: each point blends the four sides by how near it is to them). */
function paperAllRound(c) {
  const W = c.width, H = c.height, n = N;
  const small = scaled(c, Math.max(1, Math.round(W * 512 / Math.max(W, H))));
  const sw = small.width, sh = small.height, px = pixels(small);
  const b = Math.max(3, Math.round(Math.min(sw, sh) * 0.02));
  const cuts = (len) => Array.from({ length: n }, (_, i) => [Math.floor(len * i / n), Math.floor(len * (i + 1) / n)]);
  const xs = cuts(sw), ys = cuts(sh);
  const top = xs.map(([a, z]) => median(px, sw, a, 0, z, b)), bottom = xs.map(([a, z]) => median(px, sw, a, sh - b, z, sh));
  const left = ys.map(([a, z]) => median(px, sw, 0, a, b, z)), right = ys.map(([a, z]) => median(px, sw, sw - b, a, sw, z));
  const avg = (p, q) => p.map((v, k) => (v + q[k]) / 2);
  const c00 = avg(top[0], left[0]), c10 = avg(top[n - 1], right[0]), c01 = avg(bottom[0], left[n - 1]), c11 = avg(bottom[n - 1], right[n - 1]);
  const paperAt = (i, j) => {
    const u = (i + 0.5) / n, v = (j + 0.5) / n;
    return [0, 1, 2].map((k) => (1 - v) * top[i][k] + v * bottom[i][k] + (1 - u) * left[j][k] + u * right[j][k]
      - ((1 - u) * (1 - v) * c00[k] + u * (1 - v) * c10[k] + (1 - u) * v * c01[k] + u * v * c11[k]));
  };
  const rgb = (p) => p.map(Math.round).join(', ');
  return { paperAt, note: `Paper read as RGB ${rgb(c00)} (top left) to ${rgb(c11)} (bottom right), made white.` };
}

/* Picked spots: each spot's colour (the median of a small square) is what white looks like there. One spot: that
   colour everywhere. Two: it changes evenly along the line between them (and stays as it is beyond them). Three
   or more: the flat slope that fits them best (least squares), kept within the range of the spots' colours so it
   never runs away beyond them. */
function paperFromSpots(c, spots) {
  const W = c.width, H = c.height, px = pixels(c), r = Math.max(2, Math.round(SPOT * Math.max(W, H)));
  const P = spots.map(([u, v]) => {
    const x = Math.round(u * W), y = Math.round(v * H);
    const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r), x1 = Math.min(W, x + r + 1), y1 = Math.min(H, y + r + 1);
    return { x: u * W, y: v * H, c: median(px, W, x0, y0, x1, y1) };
  });
  const lo = [0, 1, 2].map((k) => Math.min(...P.map((p) => p.c[k]))), hi = [0, 1, 2].map((k) => Math.max(...P.map((p) => p.c[k])));
  let at;                                                     // at(x, y) -> colour, x and y in pixels
  const line = (a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy || 1;
    return (x, y) => { const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (y - a.y) * dy) / L)); return a.c.map((v, k) => v + t * (b.c[k] - v)); };
  };
  const farthest = () => {
    let best = [P[0], P[1]], d = -1;
    for (const a of P) for (const b of P) { const e = (a.x - b.x) ** 2 + (a.y - b.y) ** 2; if (e > d) { d = e; best = [a, b]; } }
    return best;
  };
  if (P.length === 1) at = () => P[0].c;
  else if (P.length === 2) at = line(P[0], P[1]);
  else {
    // Least squares for colour = a + b x + c y, with x and y measured from the spots' centre (for good arithmetic).
    const mx = P.reduce((s, p) => s + p.x, 0) / P.length, my = P.reduce((s, p) => s + p.y, 0) / P.length;
    let sxx = 0, sxy = 0, syy = 0;
    for (const p of P) { const x = p.x - mx, y = p.y - my; sxx += x * x; sxy += x * y; syy += y * y; }
    const det = sxx * syy - sxy * sxy;
    if (det <= 1e-9 * (sxx + syy) ** 2) at = line(...farthest());                       // all in a line
    else {
      const fit = [0, 1, 2].map((k) => {
        const mean = P.reduce((s, p) => s + p.c[k], 0) / P.length;
        let sxv = 0, syv = 0;
        for (const p of P) { sxv += (p.x - mx) * (p.c[k] - mean); syv += (p.y - my) * (p.c[k] - mean); }
        return [mean, (syy * sxv - sxy * syv) / det, (sxx * syv - sxy * sxv) / det];
      });
      at = (x, y) => fit.map(([a, b, cc], k) => Math.min(hi[k], Math.max(lo[k], a + b * (x - mx) + cc * (y - my))));
    }
  }
  const paperAt = (i, j) => at((i + 0.5) / N * W, (j + 0.5) / N * H);
  const avg = P.map((p) => p.c).reduce((s, c) => s.map((v, k) => v + c[k] / P.length), [0, 0, 0]);
  return { paperAt, note: `White read from ${P.length} ${P.length === 1 ? 'spot' : 'spots'}, on average RGB ${avg.map(Math.round).join(', ')}, made white.` };
}

/* The white-balanced copy of the working picture, and a line saying what was read. */
export function whiteBalanced(src, white, spots) {
  if (white === 'none' || (white === 'picks' && !spots.length)) return { canvas: src, note: '' };
  const c = copy(src);
  const { paperAt, note } = white === 'paper' ? paperAllRound(c) : paperFromSpots(c, spots);
  applyPaper(c, paperAt);
  return { canvas: c, note };
}

// ---- cropping with perspective correction ------------------------------------------------------------------

/* Four points in the order top left, top right, bottom right, bottom left, whatever order they were placed in. */
export function ordered(pts) {
  const cx = pts.reduce((s, p) => s + p[0], 0) / 4, cy = pts.reduce((s, p) => s + p[1], 0) / 4;
  const round = pts.slice().sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  const first = round.reduce((best, p, i) => (p[0] + p[1] < round[best][0] + round[best][1] ? i : best), 0);
  return [0, 1, 2, 3].map((i) => round[(first + i) % 4]);       // clockwise on screen, from the top left
}

/* "Oil on canvas, 60 x 90 cm, 2020" -> [60, 90] (height, width), or null. */
export function sizeIn(details) {
  const m = /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*cm/i.exec(details || '');
  return m && +m[1] > 0 && +m[2] > 0 ? [+m[1], +m[2]] : null;
}

/* The squared-up picture's width and height in the corners' pixels: the average lengths of opposite sides, or,
   given the painting's size, the same area in its shape. */
export function cropSize(q, shape) {
  const len = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  let w = (len(q[0], q[1]) + len(q[3], q[2])) / 2, h = (len(q[0], q[3]) + len(q[1], q[2])) / 2;
  if (shape) { const s = Math.sqrt(w * h / (shape[0] * shape[1])); w = shape[1] * s; h = shape[0] * s; }
  return [w, h];
}

/* The picture inside the four corners q (in src's pixels, from top left clockwise), squared up into a w x h
   canvas. The square is mapped onto the corners by a projective (perspective) map, and each new pixel takes the
   colour at its point in the photo, blended from the four pixels round it. */
export function squaredUp(src, q, w, h) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let g = 0, k = 0;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    const den = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / den; k = (dx1 * dy3 - dx3 * dy1) / den;
  }
  const a = x1 - x0 + g * x1, b = x3 - x0 + k * x3, c = x0, d = y1 - y0 + g * y1, e = y3 - y0 + k * y3, f = y0;
  const SW = src.width, SH = src.height, s = pixels(src);
  const out = canvas(w, h), ctx = out.getContext('2d'), im = ctx.createImageData(w, h), o = im.data;
  for (let Y = 0; Y < h; Y++) {
    const v = (Y + 0.5) / h;
    for (let X = 0; X < w; X++) {
      const u = (X + 0.5) / w, z = g * u + k * v + 1;
      const sx = Math.min(SW - 1.001, Math.max(0, (a * u + b * v + c) / z - 0.5));
      const sy = Math.min(SH - 1.001, Math.max(0, (d * u + e * v + f) / z - 0.5));
      const ix = sx | 0, iy = sy | 0, tx = sx - ix, ty = sy - iy;
      const p = (iy * SW + ix) * 4, p2 = p + SW * 4, oi = (Y * w + X) * 4;
      for (let ch = 0; ch < 3; ch++) {
        o[oi + ch] = (s[p + ch] * (1 - tx) + s[p + 4 + ch] * tx) * (1 - ty) + (s[p2 + ch] * (1 - tx) + s[p2 + 4 + ch] * tx) * ty;
      }
      o[oi + 3] = 255;
    }
  }
  ctx.putImageData(im, 0, 0);
  return out;
}

// ---- the full-size view: picking spots and placing corners ------------------------------------------------

/* Opens the picture full screen, to zoom into (pinch, or pinch on a trackpad, or the + and - buttons) and move
   about (drag, or scroll). mode 'spots': tap a spot to add it, tap it again to take it away. mode 'corners': drag
   the four corners onto the painting's corners; a magnifier shows the spot under the finger. Resolves with the
   new spots or corners (fractions of the picture), or null if cancelled. */
export function fullView(img, mode, start) {
  return new Promise((resolve) => {
    const W = img.width, H = img.height;
    let pts = (start && start.length ? start : mode === 'corners'
      ? [[0.08, 0.08], [0.92, 0.08], [0.92, 0.92], [0.08, 0.92]] : []).map((p) => [p[0] * W, p[1] * H]);
    const el = (tag, props, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
    const hint = mode === 'corners'
      ? 'Drag each corner onto a corner of the painting. Pinch or use + and − to zoom in for accuracy.'
      : 'Tap spots that should be white or neutral grey (a white wall, card or paper). Tap a spot again to remove it. Two or more spots apart also even out the light.';
    const cv = el('canvas', { className: 'dr-canvas' }), loupe = el('canvas', { className: 'dr-loupe', width: 300, height: 300 });
    const count = el('span', { className: 'dr-count' });
    const btn = (text, fn, cls = '') => el('button', { type: 'button', className: cls, onclick: fn }, text);
    const box = el('div', { className: 'darkroom' },
      el('div', { className: 'dr-bar' },
        el('p', { className: 'dr-hint' }, hint),
        el('div', { className: 'dr-buttons' },
          btn('−', () => zoomBy(1 / 1.6)), btn('+', () => zoomBy(1.6)), btn('Fit', () => { fit(); draw(); }),
          mode === 'corners' ? btn('Reset', () => { pts = [[0.08, 0.08], [0.92, 0.08], [0.92, 0.92], [0.08, 0.92]].map((p) => [p[0] * W, p[1] * H]); draw(); })
            : btn('Clear', () => { pts = []; draw(); }),
          count, btn('Cancel', () => close(null)),
          btn('Done', () => close(mode === 'corners' ? ordered(pts) : pts), 'main'))),
      cv, loupe);
    document.body.append(box);
    document.body.style.overflow = 'hidden';
    const ctx = cv.getContext('2d'), lctx = loupe.getContext('2d');
    let s = 1, tx = 0, ty = 0, cw = 0, ch = 0, dpr = 1;
    const spotR = Math.max(2, SPOT * Math.max(W, H));

    function size() {
      dpr = window.devicePixelRatio || 1;
      cw = cv.clientWidth; ch = cv.clientHeight;
      cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
    }
    function fit() { s = Math.min(cw / W, ch / H) * 0.94; tx = (cw - W * s) / 2; ty = (ch - H * s) / 2; }
    const toScreen = ([x, y]) => [tx + x * s, ty + y * s];
    const toImage = (x, y) => [(x - tx) / s, (y - ty) / s];
    function zoomAt(f, x, y) {
      const ns = Math.min(Math.max(s * f, Math.min(cw / W, ch / H) * 0.5), 16);
      tx = x - (x - tx) * ns / s; ty = y - (y - ty) * ns / s; s = ns; draw();
    }
    const zoomBy = (f) => zoomAt(f, cw / 2, ch / 2);

    function draw() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cw, ch);
      ctx.imageSmoothingEnabled = s < 2; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, tx, ty, W * s, H * s);
      ctx.lineWidth = 1.5;
      if (mode === 'corners') {
        const q = ordered(pts).map(toScreen);
        ctx.beginPath(); ctx.rect(0, 0, cw, ch);
        ctx.moveTo(...q[0]); q.slice(1).forEach((p) => ctx.lineTo(...p)); ctx.closePath();
        ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fill('evenodd');
        ctx.beginPath(); ctx.moveTo(...q[0]); q.slice(1).forEach((p) => ctx.lineTo(...p)); ctx.closePath();
        ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.stroke(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.stroke();
        for (const p of pts.map(toScreen)) {
          ctx.beginPath(); ctx.arc(p[0], p[1], 11, 0, 7); ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fill();
          ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.stroke(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
        }
        count.textContent = '';
      } else {
        pts.forEach((p, i) => {
          const [x, y] = toScreen(p), r = Math.max(6, spotR * s);
          ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.strokeRect(x - r, y - r, 2 * r, 2 * r);
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(x - r, y - r, 2 * r, 2 * r);
          ctx.font = '600 13px -apple-system, sans-serif'; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
          ctx.strokeText(String(i + 1), x + r + 4, y - r); ctx.fillText(String(i + 1), x + r + 4, y - r);
        });
        count.textContent = pts.length ? `${pts.length} ${pts.length === 1 ? 'spot' : 'spots'}` : 'No spots yet';
      }
    }

    function showLoupe(p, fx, fy) {
      const L = 150, m = Math.max(4, s * 4);                    // magnifier: L css pixels across, m screen pixels per photo pixel
      loupe.style.display = 'block';
      const above = fy > L + 40;
      loupe.style.left = `${Math.min(cw - L - 8, Math.max(8, fx - L / 2))}px`;
      loupe.style.top = `${cv.offsetTop + (above ? fy - L - 40 : fy + 40)}px`;
      lctx.setTransform(300 / L, 0, 0, 300 / L, 0, 0);
      lctx.fillStyle = '#000'; lctx.fillRect(0, 0, L, L);
      lctx.imageSmoothingEnabled = false;
      const half = L / 2 / m;
      lctx.drawImage(img, p[0] - half, p[1] - half, 2 * half, 2 * half, 0, 0, L, L);
      lctx.strokeStyle = '#fff'; lctx.lineWidth = 1;
      lctx.beginPath(); lctx.moveTo(L / 2, 0); lctx.lineTo(L / 2, L); lctx.moveTo(0, L / 2); lctx.lineTo(L, L / 2); lctx.stroke();
    }

    const down = new Map();
    let drag = null, pinch = null, tap = null;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      const p = pos(e); down.set(e.pointerId, p);
      if (down.size === 2) {
        const [a, b] = [...down.values()];
        pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
        drag = null; tap = null; loupe.style.display = 'none'; return;
      }
      if (down.size > 2) return;
      tap = { p, t: performance.now() };
      if (mode === 'corners') {
        const near = pts.map((q, i) => [Math.hypot(...toScreen(q).map((v, k) => v - p[k])), i]).sort((a, b) => a[0] - b[0])[0];
        if (near[0] < 30) {
          const q = toScreen(pts[near[1]]);
          drag = { i: near[1], off: [q[0] - p[0], q[1] - p[1]] }; tap = null; showLoupe(pts[near[1]], q[0], q[1]); return;
        }
      }
      drag = { pan: p };
    });
    cv.addEventListener('pointermove', (e) => {
      if (!down.has(e.pointerId)) return;
      const p = pos(e); down.set(e.pointerId, p);
      if (pinch && down.size === 2) {
        const [a, b] = [...down.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        tx += m[0] - pinch.m[0]; ty += m[1] - pinch.m[1];
        zoomAt(d / pinch.d, m[0], m[1]); pinch = { d, m }; return;
      }
      if (tap && Math.hypot(p[0] - tap.p[0], p[1] - tap.p[1]) > 8) tap = null;
      if (!drag) return;
      if (drag.pan) { tx += p[0] - drag.pan[0]; ty += p[1] - drag.pan[1]; drag.pan = p; draw(); return; }
      const sx = p[0] + drag.off[0], sy = p[1] + drag.off[1];
      const q = toImage(sx, sy); pts[drag.i] = [Math.min(W, Math.max(0, q[0])), Math.min(H, Math.max(0, q[1]))];
      draw(); showLoupe(pts[drag.i], sx, sy);
    });
    const up = (e) => {
      if (!down.has(e.pointerId)) return;
      down.delete(e.pointerId);
      if (down.size < 2) pinch = null;
      if (down.size === 0) {
        if (tap && mode === 'spots' && performance.now() - tap.t < 500) {
          const near = pts.findIndex((q) => { const [x, y] = toScreen(q); return Math.max(Math.abs(x - tap.p[0]), Math.abs(y - tap.p[1])) < Math.max(14, spotR * s); });
          if (near >= 0) pts.splice(near, 1);
          else { const q = toImage(...tap.p); if (q[0] >= 0 && q[1] >= 0 && q[0] <= W && q[1] <= H) pts.push(q); }
          draw();
        }
        drag = null; tap = null; loupe.style.display = 'none';
      }
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = pos(e);
      if (e.ctrlKey) zoomAt(Math.exp(-e.deltaY * 0.01), p[0], p[1]);     // a pinch on a trackpad
      else { tx -= e.deltaX; ty -= e.deltaY; draw(); }
    }, { passive: false });
    const key = (e) => { if (e.key === 'Escape') close(null); };
    const onResize = () => { size(); fit(); draw(); };
    window.addEventListener('keydown', key); window.addEventListener('resize', onResize);

    function close(result) {
      window.removeEventListener('keydown', key); window.removeEventListener('resize', onResize);
      document.body.style.overflow = ''; box.remove();
      resolve(result && result.map(([x, y]) => [x / W, y / H]));
    }
    size(); fit(); draw();
  });
}
