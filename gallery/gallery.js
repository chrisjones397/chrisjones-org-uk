/* The floating wall: the home page's gallery section. The paintings hang down a tall wall of quiet grey, at
   different depths, each at a size that follows (softly) its real size, in the gallery's order.

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

   The list of paintings and the settings come from the database: worker.js writes them into the page
   (the "gallery-data" block; site.js galleryData). Visitors who have asked for reduced motion, or whose browser has no WebGL, get
   the few paintings hung around the words that are already in the page. */
import * as THREE from '../face/vendor/three.module.min.js';

const { settings, paintings: data } = JSON.parse(document.getElementById('gallery-data').textContent);
// The arrangement, from the database's gallery settings (entry settings-gallery; all 1 as first built). Adding ?tune to the page's
// address shows sliders for trying them out live; see tuner() at the end.
const DEFAULTS = { size: 1, spacing: 1, spread: 1, depth: 1, nearness: 0.5, drift: 1, seed: 1 };
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

  // Each painting's depth, with a little variety from a fixed seed, so it's the same every visit. Two things
  // decide it, mixed by the nearness setting: a step round the range by the golden ratio, so neighbours are
  // never at the same depth; and the painting's real size, smaller ones nearer, larger ones further back. Only
  // partly mixed, larger paintings still look larger (fully, at 1, they would all look about the same size).
  const areas = data.map((p) => heightOf(p) ** 2 * p.w / p.h);
  const order = areas.map((a, i) => [a, i]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
  const rank = []; order.forEach((i, k) => { rank[i] = data.length > 1 ? k / (data.length - 1) : 0.5; });
  // The seed setting picks which of many equally good arrangements you get: change it for a different shuffle.
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  function shuffle() {
    seed = 7 + Math.round(P.seed) * 7919;
    for (let k = 0; k < 5; k++) rand();
    const start = rand();
    planes.forEach((m, i) => {
      const u = m.userData;
      u.f = (start + i * 0.618034 + (rand() - 0.5) * 0.15) % 1;
      u.jitter = rand();
      u.phase = rand() * 6.28;
    });
  }
  const geometry = new THREE.PlaneGeometry(1, 1);
  const planes = data.map((p, i) => {
    const h = heightOf(p);
    const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, fog: true });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData = { p, h, w: h * p.w / p.h, r: rank[i] };
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
    shuffle();
    let y = 0, lastH = 0;
    const placed = [];
    planes.forEach((m, i) => {
      const u = m.userData;
      const mix = Math.min(Math.max(P.nearness, 0), 1);
      u.d = Math.max(MID + ((1 - mix) * u.f + mix * u.r - 0.5) * RANGE * P.depth, 4);
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
        const score = Math.abs(mass / total) / (half || 1) + 3 * awkward + 2 * cover + under + 0.25 * Math.abs(c - (u.jitter * 2 - 1));
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

  // The pictures: one size per painting, about what this screen needs on the wall; when one is brought
  // forward, a larger size is fetched for it (once) and swapped in when it arrives, so the close view is sharp
  const want = Math.min(stage.clientWidth * renderer.getPixelRatio() * 0.6, 1536);
  const loader = new THREE.TextureLoader();
  function picture(m, wanted, then) {
    const p = m.userData.p;
    const w = p.widths.find((x) => x >= wanted) || p.widths[p.widths.length - 1];
    if (w <= (m.userData.loaded || 0)) return;
    m.userData.loaded = w;
    const src = `${BASE}${p.base}${p.file || p.name}-${w}.${p.ext}`;   // base and ext: see site.js
    loader.load(src, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      const old = m.material.map;
      m.material.map = tex;
      m.material.needsUpdate = true;
      m.userData.src = src;
      if (old) old.dispose();
      if (then) then();
    });
  }
  // How far down the wall the page has scrolled, in pixels: 0 at the section's top, travelPx at its end
  const progress = () => Math.min(Math.max(-section.getBoundingClientRect().top, 0), travelPx);

  // A painting's address. Bringing a painting forward puts its address, /paintings/<name>/, in the address bar
  // (without loading anything), and the browser's Back sends it back again. That address, opened from a link,
  // is this same page with that painting brought forward (worker.js serves it, with a <base href="/"> so the
  // page's files are found). So a painting's address always shows the same thing, and nothing reloads.
  const SITE_TITLE = 'Christopher Jones - Fine Art';
  const homeURL = new URL('./', document.baseURI).href;
  const pageURL = (m) => new URL(`paintings/${m.userData.p.name}/`, document.baseURI).href;
  const named = (name) => planes.find((x) => x.userData.p.name === name) || null;
  let focus = null, leaving = [], focusAt = 0, pushed = false;
  const opened = location.href.split('#')[0] !== homeURL && named((location.pathname.match(/\/paintings\/([a-z0-9-]+)\/?$/) || [])[1]);
  if (opened) {
    // Opened at a painting's address: the wall is put where that painting hangs, and it's brought forward
    const opening = section.getBoundingClientRect().top + scrollY + Math.max(-opened.userData.cy / perPx, 0);
    const place = () => {
      scrollTo({ top: opening, behavior: 'instant' });
      if (window.snapHere) window.snapHere();                 // the page putting itself there isn't scrolling
      focusAt = scrollY;
    };
    let touched = false;
    for (const ev of ['wheel', 'touchstart', 'keydown', 'pointerdown']) addEventListener(ev, () => { touched = true; }, { once: true, passive: true });
    place();
    addEventListener('load', () => { if (!touched) place(); }, { once: true });   // once more, in case anything moved it
    history.replaceState({ painting: opened.userData.p.name }, '', location.href);
  }

  // The pictures nearest where the page opens are fetched first, and each appears as soon as it arrives
  const startY = -progress() * perPx;
  [...planes].sort((a, b) => Math.abs(a.userData.cy - startY) - Math.abs(b.userData.cy - startY))
    .forEach((m) => picture(m, want, () => { m.userData.ready = true; }));
  const sharpen = (m) => {
    const fill = Math.max(stage.clientWidth * 0.82, stage.clientHeight * 0.72 * m.userData.p.w / m.userData.p.h);
    picture(m, fill * renderer.getPixelRatio(), null);
  };


  // Pointing at a painting names it; clicking (or tapping) it brings it forward to the middle of the view,
  // the others dimming behind it, and its address goes in the address bar. Clicking it again, clicking
  // elsewhere, pressing Escape, scrolling on or the browser's Back sends it back to its place.
  function forward(m) {                       // brought forward (the address is dealt with by open and close)
    if (focus === m) return;
    if (focus) leaving.push(focus);
    focus = m;
    leaving = leaving.filter((x) => x !== m);
    m.userData.k = m.userData.k || 0;
    focusAt = scrollY;
    sharpen(m);
    section.classList.add('painting-forward');   // the heading steps back with the other paintings
    document.title = `${m.userData.p.title} - ${SITE_TITLE}`;
  }
  function backward() {
    if (!focus) return;
    leaving.push(focus);
    focus = null;
    section.classList.remove('painting-forward');
    document.title = SITE_TITLE;
  }
  function open(m) {
    forward(m);
    const state = { painting: m.userData.p.name };
    if (pushed) { history.replaceState(state, '', pageURL(m)); return; }
    // Coming back to the home page's entry in the history mustn't move the page (it hasn't moved since), so
    // that entry is told not to restore its scroll position, until we're back on it
    history.scrollRestoration = 'manual';
    history.pushState(state, '', pageURL(m));
    history.scrollRestoration = 'auto';
    pushed = true;
  }
  function close() {
    if (!focus) return;
    backward();
    if (pushed) { pushed = false; history.back(); }          // as the browser's Back would
    else history.replaceState(null, '', homeURL);           // opened at its address: there's no entry to go back to
  }
  addEventListener('popstate', (e) => {
    history.scrollRestoration = 'auto';
    const m = e.state && named(e.state.painting);
    if (m) { forward(m); pushed = true; } else { backward(); pushed = false; }
  });
  if (opened) { forward(opened); opened.userData.k = 1; }

  addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  addEventListener('scroll', () => { if (focus && Math.abs(scrollY - focusAt) > 40) close(); }, { passive: true });
  // The menu's links (Gallery, Contact, Profile) and the name go to places on this page. While a painting's
  // address is showing they'd otherwise load the home page afresh, so they're followed here instead.
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || location.href.split('#')[0] === homeURL) return;
    const to = new URL(a.href);
    if (to.href.split('#')[0] !== homeURL || a.target) return;
    const place = to.hash.length > 1 ? document.querySelector(to.hash) : null;
    if (to.hash.length > 1 && !place) return;
    e.preventDefault();
    backward();
    pushed = false;
    history.replaceState(null, '', to.href);
    if (place) place.scrollIntoView({ behavior: 'smooth' }); else scrollTo({ top: 0, behavior: 'smooth' });
  }, true);

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
    if (e.target.closest('a, button')) return;                  // the caption's links are dealt with below
    const m = at(e.clientX, e.clientY);
    if (m && m !== focus) open(m); else close();
  });

  // The paintings are drawn, not images in the page, so the browser's own menu (right-click: open or save the
  // image) would only find a passing snapshot of the drawing. So an invisible copy of the real picture lies
  // over the painting under the pointer, and that menu finds the painting itself.
  const real = document.createElement('img');
  real.alt = '';
  real.draggable = false;
  real.setAttribute('aria-hidden', 'true');
  real.style.cssText = 'position:absolute;opacity:0;display:none;z-index:1;';
  renderer.domElement.after(real);
  const corner = new THREE.Vector3();
  function cover(m) {
    if (!m || !m.userData.src) { real.style.display = 'none'; return; }
    m.updateMatrixWorld();
    camera.updateMatrixWorld();
    const r = renderer.domElement.getBoundingClientRect(), s = stage.getBoundingClientRect();
    const xy = [[-0.5, 0.5], [0.5, -0.5]].map(([x, y]) => {
      corner.set(x, y, 0).applyMatrix4(m.matrixWorld).project(camera);
      return [r.left - s.left + (corner.x + 1) / 2 * r.width, r.top - s.top + (1 - corner.y) / 2 * r.height];
    });
    if (real.getAttribute('src') !== m.userData.src) real.src = m.userData.src;
    Object.assign(real.style, { display: 'block', left: `${xy[0][0]}px`, top: `${xy[0][1]}px`,
      width: `${xy[1][0] - xy[0][0]}px`, height: `${xy[1][1] - xy[0][1]}px`, cursor: renderer.domElement.style.cursor });
  }

  // The caption: the painting under the pointer, or else the one nearest the middle of the view
  const cap = document.getElementById('float-caption');
  const capTitle = cap.querySelector('.t'), capDetails = cap.querySelector('.d');
  let shown = null;
  // the name in the caption is the painting's address: following it brings the painting forward (or, already
  // forward, sends it back), here, rather than loading anything
  capTitle.addEventListener('click', (e) => { e.preventDefault(); if (shown) { if (shown === focus) close(); else open(shown); } });
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
      capTitle.href = pageURL(best);
      capDetails.textContent = best.userData.p.details || '';
      cap.classList.add('on');
    }, 180);
  }

  const glassHeader = document.querySelector('.header');
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
      // a painting brought forward is drawn over everything: on a narrow screen a wide one has to stand further
      // back to fit across, which can be behind a small painting hanging near
      const front = u.k > 0.02;
      m.renderOrder = front ? 1 : 0;
      if (m.material.depthTest === front) { m.material.depthTest = !front; m.material.needsUpdate = true; }
      const o = !u.ready ? 0 : focus && m !== focus ? 0.25 : 1;
      m.material.opacity += (o - m.material.opacity) * 0.08;
      m.visible = m.material.opacity > 0.01;
    }
    pointed = lastPointer ? at(...lastPointer) : null;
    renderer.domElement.style.cursor = pointed ? (pointed === focus ? 'zoom-out' : 'zoom-in') : '';
    cover(pointed);
    caption(camY);
    renderer.render(scene, camera);
    // the header's thick glass (glass.js) shows whatever passes under it: hand it this frame while it's there
    // (straight after drawing, while the frame can still be copied)
    if (glassHeader && r.top < glassHeader.getBoundingClientRect().bottom) dispatchEvent(new CustomEvent('glass-frame', { detail: renderer.domElement }));
    // the gallery shows as soon as the paintings in view have arrived (or after a moment, whatever has); the
    // rest fade in as they come
    if (first && (t > 1.5 || planes.every((m) => m.userData.ready || Math.abs(m.userData.cy - camY) > D0 * viewTan * 2))) {
      first = false; section.classList.add('gallery-live');
    }
  });

  if (TUNE) tuner(layout);
}

// The tuning panel (only with ?tune in the address): a slider for each setting, applied as you move it. The
// values are remembered in this browser while tuning; "Copy" puts them on the clipboard, to be put into the
// database's gallery settings; "Reset" goes back to what the database says.
function tuner(relayout) {
  const box = document.createElement('div');
  box.className = 'gallery-tuner';
  box.style.cssText = 'position:fixed;z-index:2000;top:calc(var(--header-height,80px) + 12px);right:12px;width:min(300px,calc(100vw - 24px));' +
    'padding:14px 16px;border-radius:12px;background:rgba(40,40,40,0.85);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);' +
    'color:#fff;font:14px/1.3 Inter,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,0.35)';
  const labels = { size: 'Size', spacing: 'Spacing down', spread: 'Spread across', depth: 'Depth', nearness: 'Small ones nearer', drift: 'Drift', seed: 'Shuffle' };
  const ranges = { size: [0.4, 3], spacing: [0.2, 2.5], spread: [0, 2.5], depth: [0, 2.5], nearness: [0, 1], drift: [0, 3], seed: [1, 60] };
  const saved = { ...DEFAULTS };
  for (const k in saved) if (typeof settings[k] === 'number') saved[k] = settings[k];
  const rows = {};
  const save = () => { try { localStorage.setItem('gallery-tune', JSON.stringify(P)); } catch (e) {} };
  for (const k of Object.keys(labels)) {
    const row = document.createElement('label');
    row.style.cssText = 'display:grid;grid-template-columns:9.5em 1fr 2.6em;align-items:center;gap:8px;margin:6px 0';
    const name = document.createElement('span'); name.textContent = labels[k];
    const input = document.createElement('input');
    Object.assign(input, { type: 'range', min: ranges[k][0], max: ranges[k][1], step: k === 'seed' ? 1 : 0.05, value: P[k] });
    input.style.width = '100%';
    const out = document.createElement('span'); out.style.textAlign = 'right';
    const show = () => { out.textContent = k === 'seed' ? String(Math.round(P[k])) : (+P[k]).toFixed(2); };
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
