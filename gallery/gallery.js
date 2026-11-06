/* The floating wall: the home page's gallery section. The paintings hang down a tall wall of quiet grey, at
   different depths, each at a size that follows (softly) its real size, in the order of paintings.yaml.

   There is nothing to switch on and nothing takes over the page: ordinary scrolling (a mouse's wheel, a
   trackpad, a finger, the keys or the scrollbar) carries you down the wall, so every way of moving through the
   site works here exactly as it does everywhere else. The section is as tall as the wall needs; the view of
   it stays in place while the page scrolls through it, and the paintings rise past. Paintings at the middle
   depth move exactly with the page (on a phone, with your finger); nearer ones move a little faster and
   further ones a little slower, which is what makes them seem to hang in space. They drift gently, and the
   view shifts a little with the mouse. Pointing at a painting names it in the caption; clicking or tapping it
   brings it forward to the middle of the view, and clicking it again sends it back (its name in the caption
   still leads to its own page). Otherwise the caption
   names the painting nearest the middle of the view.

   The list of paintings and the settings from paintings.yaml are written into the page by tools/build_site.py
   (the "gallery-data" block). Visitors who have asked for reduced motion, or whose browser has no WebGL, get
   the few paintings hung around the words that are already in the page. */
import * as THREE from '../face/vendor/three.module.min.js';

const { settings, paintings: data } = JSON.parse(document.getElementById('gallery-data').textContent);
// The arrangement, from paintings.yaml's gallery: settings (all 1 as first built). Adding ?tune to the page's
// address shows sliders for trying them out live; see tuner() at the end.
const DEFAULTS = { size: 1, spacing: 1, spread: 1, depth: 1, drift: 1 };
const P = { ...DEFAULTS };
for (const k in P) if (typeof settings[k] === 'number') P[k] = settings[k];
const TUNE = /[?&]tune\b/.test(location.search);
if (TUNE) try { Object.assign(P, JSON.parse(localStorage.getItem('gallery-tune') || '{}')); } catch (e) {}
const SIZE = 3.6;           // a 60 x 90 cm painting is about 2.9 high; smaller ones less, but not in proportion
const D0 = 12;              // paintings this far away move exactly with the page
const MID = 13, RANGE = 8;  // they hang from 9 to 17 away (RANGE times the depth setting)
const BG = 0x646464;        // the page colour, rgb(100, 100, 100)

const stage = document.getElementById('float-stage');
const BASE = (stage && stage.dataset.base) ?? '';           // the way from this page to the site's top folder
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

function webgl() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); }
  catch (e) { return false; }
}
if (stage && data.length && !reduce && webgl()) start();

// A painting's height in the space. Its real size counts, but softened (by a square root), so an A5 sketch
// isn't dwarfed by a 60 x 90 canvas: real sizes 1 : 0.24 become about 1 : 0.5 here.
function heightOf(p) {
  const [hc, wc] = p.cm || [];
  if (hc && wc) {
    const big = Math.sqrt(60 * 90), mine = Math.sqrt(hc * wc);
    return SIZE * Math.sqrt(mine / big) * (hc / mine);
  }
  return SIZE * 0.75 * Math.sqrt(p.h / p.w);           // no size given: a middling one, shaped like the picture
}

function start() {
  const section = stage.closest('section');

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setClearColor(BG);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.prepend(renderer.domElement);
  renderer.domElement.setAttribute('aria-hidden', 'true');

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(BG, 14, 32);         // the furthest paintings soften a little into the grey
  // The camera looks straight ahead and never turns, so every painting is drawn square, with no tilt or
  // keystoning; scrolling only ever slides the view down.
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 80);
  const viewTan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));

  // Each painting's depth and side, with a little variety from a fixed seed, so it's the same every visit.
  // Depths step round the range by the golden ratio, so neighbours are never at the same depth.
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const geometry = new THREE.PlaneGeometry(1, 1);
  const planes = data.map((p, i) => {
    const h = heightOf(p);
    const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, fog: true });
    const mesh = new THREE.Mesh(geometry, material);
    const f = (0.35 + i * 0.618034 + (rand() - 0.5) * 0.15) % 1;
    mesh.userData = { p, h, w: h * p.w / p.h, f, jitter: rand(), phase: rand() * 6.28 };
    scene.add(mesh);
    return mesh;
  });

  // Laying out the wall for this window. Down, each painting follows the last with room for both (more room on
  // a phone, where they're one above another rather than side by side). Across, each is placed to keep the
  // wall balanced as you see it: of the places it could go, it takes the one that best evens out the weight
  // (how big the paintings look) on the left and right of those around it, so big and small ones mix on both
  // sides rather than gathering on one. Overlapping is welcome, but only clearly: next to a neighbour it will
  // pass on screen, a painting either keeps a clear gap or overlaps by a good part of its width, never just
  // grazes it, and its edges never quite line up with the neighbour's, as that looks unintended. It also
  // avoids hiding most of a neighbour, and sitting straight below the one before. The section is then made as
  // tall as the journey.
  let H = 0, W = 0, perPx = 0, travelPx = 0, scale = 1;
  function layout() {
    W = stage.clientWidth; H = stage.clientHeight;
    if (!W || !H) return;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    const viewH0 = 2 * D0 * viewTan;                           // the view's height at the middle depth
    perPx = viewH0 / H;                                         // ...so one pixel of scrolling is this far
    const narrow = camera.aspect < 0.9;
    scale = Math.min(1, (D0 * viewTan * camera.aspect) / 4) * P.size;
    let y = 0, lastH = 0;
    const placed = [];
    planes.forEach((m, i) => {
      const u = m.userData;
      u.d = Math.max(MID + (u.f - 0.5) * RANGE * P.depth, 4);
      const sw = u.w * scale, sh = u.h * scale;
      m.scale.set(sw, sh, 1);
      const seen = sh * D0 / u.d;                               // its height as it looks, at the middle depth
      // the first hangs with its top just below the heading (30% down the view); each after it below the last
      if (!i) y = 0.2 * viewH0 - seen / 2;
      else y -= (narrow ? 1.25 : 0.9) * P.spacing * (lastH + seen) / 2;
      lastH = seen;
      u.cy = i ? y : y * u.d / D0;      // where the view is when it's in the middle
      u.y = u.cy;
      // Across, worked out as it looks (at the middle depth), then put at its own depth
      const seenW = sw * D0 / u.d, half = D0 * viewTan * camera.aspect;
      const room = Math.max(half * 0.95 - seenW / 2, 0);
      const reach = Math.min(room * (narrow ? 0.7 : 1) * P.spread, room);
      let best = 0, bestScore = Infinity;
      for (let c = -1; c <= 1.0001; c += 0.05) {
        const sx = c * reach;
        let mass = seenW * seen * sx, total = seenW * seen, cover = 0, awkward = 0;
        for (const q of placed) {
          const dy = Math.abs(q.cy - y);
          if (dy < viewH0 * 0.6) { mass += q.a * q.sx; total += q.a; }
          // neighbours that pass each other on screen (depths differ, so they slide past one another)
          if (dy < (q.h + seen) / 2 + viewH0 * 0.3) {
            const gap = Math.abs(q.sx - sx) - (q.w + seenW) / 2;          // across: + a gap, - an overlap
            const narrowest = Math.min(q.w, seenW);
            if (gap > -0.25 * narrowest && gap < 0.06 * half) awkward += 1;   // grazing, or edges meeting
            const lefts = Math.abs((q.sx - q.w / 2) - (sx - seenW / 2)), rights = Math.abs((q.sx + q.w / 2) - (sx + seenW / 2));
            if (gap < 0 && Math.min(lefts, rights) < 0.04 * half) awkward += 1;  // edges lined up
          }
          const ox = Math.max(0, (q.w + seenW) / 2 - Math.abs(q.sx - sx)), oy = Math.max(0, (q.h + seen) / 2 - dy);
          cover += Math.max(0, (ox * oy) / Math.min(q.a, seenW * seen) - 0.45);   // only hiding most of one counts
        }
        const prev = placed[placed.length - 1];
        const under = prev ? Math.max(0, 0.3 - Math.abs(prev.sx - sx) / (half || 1)) : 0;
        const score = Math.abs(mass / total) / (half || 1) + 3 * awkward + 2 * cover + under + 0.08 * Math.abs(c - (u.jitter * 2 - 1));
        if (score < bestScore) { bestScore = score; best = sx; }
      }
      placed.push({ sx: best, cy: y, w: seenW, h: seen, a: seenW * seen });
      u.x = best * u.d / D0;
    });
    const end = planes[planes.length - 1].userData.cy;
    travelPx = Math.ceil(-end / perPx);                         // until the last painting is in the middle
    section.style.height = `${H + travelPx}px`;
  }
  layout();
  let lastW = innerWidth;
  // A phone's browser bars showing or hiding change the window's height while scrolling; that mustn't stretch
  // the wall under the visitor's finger, so only a change of width (or the stage's size) lays it out again.
  addEventListener('resize', () => { if (innerWidth !== lastW) { lastW = innerWidth; layout(); } });
  if (window.ResizeObserver) new ResizeObserver(() => { if (stage.clientWidth !== W || stage.clientHeight !== H) layout(); }).observe(stage);

  // The pictures: one size per painting, about what this screen needs
  const want = Math.min(stage.clientWidth * renderer.getPixelRatio() * 0.6, 1536);
  const loader = new THREE.TextureLoader();
  planes.forEach((m) => {
    const p = m.userData.p;
    const w = p.widths.find((x) => x >= want) || p.widths[p.widths.length - 1];
    loader.load(`${BASE}img/${p.name}-${w}.webp`, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      m.material.map = tex;
      m.material.needsUpdate = true;
      m.userData.ready = true;
    });
  });

  // How far down the wall the page has scrolled, in pixels: 0 at the section's top, travelPx at its end
  const progress = () => Math.min(Math.max(-section.getBoundingClientRect().top, 0), travelPx);

  // Back from a painting's own page by the menu's Gallery link: the wall opens with that painting in the middle
  try {
    const name = sessionStorage.getItem('gallery-focus');
    sessionStorage.removeItem('gallery-focus');
    const m = name && location.hash === '#paintings' && planes.find((x) => x.userData.p.name === name);
    if (m) {
      const go = () => scrollTo({ top: section.getBoundingClientRect().top + scrollY - m.userData.cy / perPx, behavior: 'instant' });
      if (document.readyState === 'complete') setTimeout(go, 50); else addEventListener('load', () => setTimeout(go, 50));
    }
  } catch (e) { /* no storage: the wall opens at its start */ }

  // Pointing at a painting names it; clicking (or tapping) it brings it forward to the middle of the view,
  // the others dimming behind it. Clicking it again, clicking elsewhere, pressing Escape or scrolling on sends
  // it back to its place.
  let focus = null, leaving = [], focusAt = 0;
  const unfocus = () => { if (focus) { leaving.push(focus); focus = null; } };
  addEventListener('keydown', (e) => { if (e.key === 'Escape') unfocus(); });
  addEventListener('scroll', () => { if (focus && Math.abs(scrollY - focusAt) > 40) unfocus(); }, { passive: true });
  const ray = new THREE.Raycaster();
  let pointed = null, mx = 0, px = 0;
  const at = (x, y) => {
    const r = renderer.domElement.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
    ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), camera);
    const hit = ray.intersectObjects(planes.filter((m) => m.visible && m.material.opacity > 0.1))[0];
    return hit ? hit.object : null;
  };
  let lastPointer = null;
  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    mx = (e.clientX / innerWidth) * 2 - 1;
    lastPointer = [e.clientX, e.clientY];
  }, { passive: true });
  stage.addEventListener('pointerleave', () => { lastPointer = null; pointed = null; });
  stage.addEventListener('click', (e) => {
    if (e.target.closest('a, button')) return;                  // the caption's links work as normal
    const m = at(e.clientX, e.clientY);
    const again = m && m === focus;
    unfocus();
    if (m && !again) { focus = m; m.userData.k = m.userData.k || 0; leaving = leaving.filter((x) => x !== m); focusAt = scrollY; }
  });

  // The caption: the painting under the pointer, or else the one nearest the middle of the view
  const cap = document.getElementById('float-caption');
  const capTitle = cap.querySelector('.t'), capDetails = cap.querySelector('.d');
  let shown = null;
  function caption(camY) {
    let best = focus || pointed, bestS = Infinity;
    if (!best) for (const m of planes) {
      const u = m.userData, s = Math.abs(u.cy - camY);
      if (s < bestS && s < D0 * viewTan * 0.8) { bestS = s; best = m; }
    }
    if (best === shown) return;
    shown = best;
    cap.classList.remove('on');
    setTimeout(() => {
      if (shown !== best || !best) return;
      capTitle.textContent = best.userData.p.title;
      capTitle.href = `${BASE}paintings/${best.userData.p.name}/`;
      capDetails.textContent = best.userData.p.details || '';
      cap.classList.add('on');
    }, 180);
  }

  const clock = new THREE.Clock();
  let first = true, lastT = 0;
  const ease = (k) => k * k * (3 - 2 * k);
  renderer.setAnimationLoop(() => {
    const r = stage.getBoundingClientRect();
    if (!first && (r.bottom < 0 || r.top > innerHeight)) return;   // out of sight: nothing to draw
    const t = clock.getElapsedTime(), dt = Math.min(t - lastT, 0.05); lastT = t;
    px += (mx - px) * 0.05;
    const camY = -progress() * perPx;
    camera.position.set(px * 0.35 * scale, camY, 0);
    for (const m of planes) {
      const u = m.userData;
      let x = u.x, y = u.y + Math.sin(t * 0.45 + u.phase) * 0.06 * scale * P.drift, z = -u.d;   // drifting, never turning
      // brought forward: to the middle of the view, near enough to fill most of it
      if (m === focus) u.k = Math.min((u.k || 0) + dt * 2.2, 1);
      else if (u.k) u.k = Math.max(u.k - dt * 2.2, 0);
      if (u.k) {
        const near = Math.max(m.scale.y / (0.72 * 2 * viewTan), m.scale.x / (0.82 * 2 * viewTan * camera.aspect), 2);
        const e = ease(u.k);
        x += (camera.position.x - x) * e; y += (camY - y) * e; z += (-near - z) * e;
      }
      m.position.set(x, y, z);
      m.renderOrder = u.k ? 1 : 0;
      const o = !u.ready ? 0 : focus && m !== focus ? 0.25 : 1;
      m.material.opacity += (o - m.material.opacity) * 0.08;
      m.visible = m.material.opacity > 0.01;
    }
    pointed = lastPointer ? at(...lastPointer) : null;
    renderer.domElement.style.cursor = pointed ? (pointed === focus ? 'zoom-out' : 'zoom-in') : '';
    caption(camY);
    renderer.render(scene, camera);
    if (first && planes.every((m) => m.userData.ready)) { first = false; section.classList.add('gallery-live'); }
  });

  if (TUNE) tuner(layout);
}

// The tuning panel (only with ?tune in the address): a slider for each setting, applied as you move it. The
// values are remembered in this browser while tuning; "Copy" puts them on the clipboard in paintings.yaml's
// form, ready to go into its gallery: block; "Reset" goes back to what paintings.yaml says.
function tuner(relayout) {
  const box = document.createElement('div');
  box.className = 'gallery-tuner';
  box.style.cssText = 'position:fixed;z-index:2000;top:calc(var(--header-height,80px) + 12px);right:12px;width:min(300px,calc(100vw - 24px));' +
    'padding:14px 16px;border-radius:12px;background:rgba(40,40,40,0.85);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);' +
    'color:#fff;font:14px/1.3 Inter,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,0.35)';
  const labels = { size: 'Size', spacing: 'Spacing down', spread: 'Spread across', depth: 'Depth', drift: 'Drift' };
  const ranges = { size: [0.4, 3], spacing: [0.2, 2.5], spread: [0, 2.5], depth: [0, 2.5], drift: [0, 3] };
  const saved = { ...DEFAULTS };
  for (const k in saved) if (typeof settings[k] === 'number') saved[k] = settings[k];
  const rows = {};
  const save = () => { try { localStorage.setItem('gallery-tune', JSON.stringify(P)); } catch (e) {} };
  for (const k of Object.keys(labels)) {
    const row = document.createElement('label');
    row.style.cssText = 'display:grid;grid-template-columns:7.5em 1fr 2.6em;align-items:center;gap:8px;margin:6px 0';
    const name = document.createElement('span'); name.textContent = labels[k];
    const input = document.createElement('input');
    Object.assign(input, { type: 'range', min: ranges[k][0], max: ranges[k][1], step: 0.05, value: P[k] });
    input.style.width = '100%';
    const out = document.createElement('span'); out.style.textAlign = 'right';
    const show = () => { out.textContent = (+P[k]).toFixed(2); };
    input.addEventListener('input', () => { P[k] = +input.value; show(); relayout(); save(); });
    show();
    row.append(name, input, out);
    box.append(row);
    rows[k] = { input, show };
  }
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;gap:8px;margin-top:10px';
  const button = (text, fn) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = text;
    b.style.cssText = 'flex:1;font:inherit;color:#fff;padding:6px 0;border:1px solid rgba(255,255,255,0.7);border-radius:999px;background:rgba(255,255,255,0.1);cursor:pointer';
    b.addEventListener('click', fn);
    bar.append(b);
    return b;
  };
  const copy = button('Copy', async () => {
    const text = 'gallery:\n' + Object.keys(labels).map((k) => `  ${k}: ${+(+P[k]).toFixed(2)}`).join('\n') + '\n';
    try { await navigator.clipboard.writeText(text); copy.textContent = 'Copied'; }
    catch (e) { prompt('Copy these settings:', text.replace(/\n/g, ' ')); }
    setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
  });
  button('Reset', () => {
    Object.assign(P, saved);
    for (const k in rows) { rows[k].input.value = P[k]; rows[k].show(); }
    try { localStorage.removeItem('gallery-tune'); } catch (e) {}
    relayout();
  });
  box.append(bar);
  document.body.append(box);
}
