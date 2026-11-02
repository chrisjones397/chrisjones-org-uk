/* The floating gallery: the paintings hang scattered through a quiet grey space, side to side, up and down,
   and in depth, each at a size that follows (softly) its real size. The space has edges, so you can't get
   lost, and each painting appears once, roughly in the order of paintings.yaml from front to back.

   Looking around (panning): drag (mouse or finger), scroll on a trackpad, or the arrow keys.
   Moving through (depth): a mouse's scroll wheel, pinching (trackpad or touch screen), or + and - (also W and S).
   The paintings drift gently, always square to you; the view shifts a little with the pointer; distant ones
   fade into the grey. Clicking (or tapping) a painting brings it to the middle of the view at a good size;
   the caption's title opens its page.

   The list of paintings and the settings from paintings.yaml are written into the page by tools/build_site.py
   (the "gallery-data" block). Visitors who have asked for reduced motion, or whose browser has no WebGL, get
   the plain grid that is already in the page. The eased movement (a target position, chased each frame) and
   the scattering in three dimensions follow the Infinite Canvas demo by Edoardo Lunardi for Codrops (MIT
   licence), rewritten here without React.

   It runs in two places. On its own page (gallery/) it fills the window. On the home page it is a section
   (data-mode="section" on the stage): there it hangs still until the visitor chooses to fly, so the page
   scrolls past it as normal; "Enter the gallery" switches to flying (the gallery fills the window and takes
   the wheel, trackpad and touch), and "Back to the page" or Escape switches back. Either way, the view is
   remembered for the rest of the visit, so the gallery opens where the visitor left it. */
import * as THREE from '../face/vendor/three.module.min.js';

const { settings, paintings: data } = JSON.parse(document.getElementById('gallery-data').textContent);
const SPACING = settings.spacing ?? 6;   // distance in depth from one painting to the next
const SPREAD = settings.spread ?? 1;     // how widely they're scattered (1: across most of the view)
const EASE = settings.glide ?? 0.075;    // share of the remaining distance covered each frame (lower: more glide)
const SIZE = 3.6;           // a 60 x 90 cm painting is about 2.9 high; smaller ones less, but not in proportion
const START = 12;           // how far in front of the first painting the visitor starts
const STOP = 5;             // how far in front of the last painting the journey ends
const FADE_START = 1.1;     // a painting starts to fade this close (a 60 x 90 cm one then fills over 3 view heights)
const FADE_GONE = 0.35;     // ...and has gone at this distance, just before you pass through it
const PINCH = 0.15;         // depth per unit of trackpad pinch (and Ctrl + scroll wheel)
const WHEEL = 0.02;         // depth per unit of a mouse's scroll wheel (one notch is usually 100: 2 units)
const PINCH_TOUCH = 0.06;   // depth per pixel of pinch on a touch screen
const BG = 0x646464;        // the page colour, rgb(100, 100, 100)

const stage = document.getElementById('float-stage');
const SECTION = stage && stage.dataset.mode === 'section';
const BASE = (stage && stage.dataset.base) ?? '../';       // the way from this page to the site's top folder
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

function webgl() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); }
  catch (e) { return false; }
}
if (stage && data.length && !reduce && webgl()) {
  if (!SECTION || !window.IntersectionObserver) start();
  else {                                         // on the home page: only once the section is getting near
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); start(); } },
                                        { rootMargin: '100% 0px' });
    io.observe(stage);
  }
}

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
  const html = document.documentElement;
  if (!SECTION) html.classList.add('float-on');
  const section = SECTION ? stage.closest('section') : null;
  let flying = !SECTION;                         // on the home page, only once the visitor chooses to

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setClearColor(BG);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.prepend(renderer.domElement);
  renderer.domElement.setAttribute('aria-hidden', 'true');

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(BG, 10, 34);         // distant paintings fade into the grey
  // The camera always looks straight ahead and never turns, so every painting (which faces straight back)
  // is drawn square, with no tilt or keystoning; moving only ever slides the view.
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 80);

  // Each painting's place. Side to side and up and down they're spread round the way through by the golden
  // angle (so no two in a row sit in the same direction), never on the way through itself; in depth they
  // follow one another at a steady spacing. A fixed seed gives a little variety that is the same every visit.
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const geometry = new THREE.PlaneGeometry(1, 1);
  const planes = data.map((p, i) => {
    const h = heightOf(p);
    const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, fog: true });
    const mesh = new THREE.Mesh(geometry, material);
    const angle = 2.6 + i * 2.39996 + (rand() - 0.5) * 0.5;
    const reach = 0.6 + 0.4 * ((i * 0.618034) % 1);
    mesh.userData = { p, h, w: h * p.w / p.h, ax: Math.cos(angle) * reach, ay: Math.sin(angle) * reach,
                      phase: rand() * 6.28, z: -i * SPACING - rand() * 1.5 };
    scene.add(mesh);
    return mesh;
  });
  const lastZ = Math.min(...planes.map((m) => m.userData.z));
  const travel = START - (lastZ + STOP);           // the whole journey in depth, start to end

  // The spread and sizes follow the window's shape: wide on a computer, tall and narrow on a phone
  let scale = 1, rx = 5, ry = 3, limX = 6, limY = 4;
  function layout() {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 12;   // half the view, 12 units away
    const halfW = halfH * camera.aspect;
    scale = Math.min(1, halfW / 4);
    rx = halfW * 0.85 * SPREAD;
    ry = halfH * 0.7 * SPREAD;
    limX = 0; limY = 0;
    for (const m of planes) {
      const u = m.userData;
      m.scale.set(u.w * scale, u.h * scale, 1);
      u.x = u.ax * rx;
      u.y = u.ay * ry;
      // how far the view may pan: far enough to centre on the outermost edge of any painting, so even
      // right up close you can look along a painting to its very edges
      limX = Math.max(limX, Math.abs(u.x) + (u.w * scale) / 2);
      limY = Math.max(limY, Math.abs(u.y) + (u.h * scale) / 2);
    }
  }
  layout();
  addEventListener('resize', layout);
  if (window.ResizeObserver) new ResizeObserver(layout).observe(stage);

  // The pictures: first one size per painting, about what this screen needs at a distance; then, as you
  // come close enough to look at the brushwork, its largest copy (see sharpen(), in the frame loop)
  const want = Math.min(stage.clientWidth * renderer.getPixelRatio() * 0.5, 1536);
  const loader = new THREE.TextureLoader();
  const show = (m, url, then) => loader.load(url, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const old = m.material.map;
    m.material.map = tex;
    m.userData.ready = true;                      // from now on it may be seen (fading in)
    m.material.needsUpdate = true;
    if (old) old.dispose();
    if (then) then();
  });
  planes.forEach((m) => {
    const p = m.userData.p;
    const w = p.widths.find((x) => x >= want) || p.widths[p.widths.length - 1];
    m.userData.loadedWidth = w;
    show(m, `${BASE}img/${p.name}-${w}.webp`);
  });
  function sharpen(m, fill) {                     // fill: the painting's height, in view heights
    const u = m.userData, best = u.p.widths[u.p.widths.length - 1];
    if (fill < 0.9 || u.sharpening || u.loadedWidth >= best) return;
    u.sharpening = true;
    show(m, `${BASE}img/${u.p.name}-${best}.webp`, () => { u.loadedWidth = best; });
  }
  const viewTan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));

  // Moving: everything sets a target; each frame the view covers part of the way there.
  // depth: how far through; x, y: looking around, kept within the space's edges.
  const target = { depth: 0, x: 0, y: 0 }, now = { depth: 0, x: 0, y: 0 };
  // where the visitor left the gallery earlier in this visit (on either page)
  try {
    const v = JSON.parse(sessionStorage.getItem('gallery-view') || 'null');
    if (v) for (const k of ['depth', 'x', 'y']) if (Number.isFinite(v[k])) target[k] = now[k] = v[k];
    target.depth = now.depth = Math.min(Math.max(target.depth, 0), travel);
  } catch (e) { /* no storage: start at the beginning */ }
  let saveTimer = 0;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { sessionStorage.setItem('gallery-view', JSON.stringify(target)); } catch (e) {} }, 300);
  };
  let mx = 0, my = 0, px = 0, py = 0, moved = false;
  const clamp = (v, a) => Math.min(Math.max(v, -a), a);
  function go(dDepth, dx = 0, dy = 0) {
    target.depth = Math.min(Math.max(target.depth + dDepth, 0), travel);
    target.x = clamp(target.x + dx, limX);                      // as far as the outermost painting's edge
    target.y = clamp(target.y + dy, limY);
    if (!moved && (dDepth || dx || dy)) { moved = true; stage.classList.add('moved'); }
    save();
  }
  const perPixel = () => 12 / stage.clientHeight;             // a movement across the screen ~ the view's width

  // A trackpad and a mouse's scroll wheel both send "wheel" events, and browsers don't say which. They differ
  // in how they report it, though: a scroll wheel moves in lines (Firefox), or its old-style wheelDelta isn't
  // exactly -3 times its delta (Chrome, Safari, Edge), as a trackpad's always is. One gesture keeps the kind
  // it started with, so a trackpad's long glide after a flick isn't mistaken halfway through.
  let wheelKind = null, wheelAt = 0;
  function kindOf(e) {
    const t = performance.now();
    if (wheelKind && t - wheelAt < 300) { wheelAt = t; return wheelKind; }
    if (e.deltaMode !== 0) wheelKind = 'mouse';
    else if (e.wheelDeltaY) wheelKind = Math.abs(e.wheelDeltaY + 3 * e.deltaY) < 1.5 ? 'trackpad' : 'mouse';
    else if (e.wheelDeltaX) wheelKind = Math.abs(e.wheelDeltaX + 3 * e.deltaX) < 1.5 ? 'trackpad' : 'mouse';
    else wheelKind = 'trackpad';
    wheelAt = t;
    return wheelKind;
  }
  stage.addEventListener('wheel', (e) => {
    if (!flying) return;                                        // the page scrolls past as normal
    e.preventDefault();
    const k = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 800 : 1;   // lines or pages, in pixels
    if (e.ctrlKey) go(-e.deltaY * k * PINCH);                   // a trackpad pinch (or Ctrl + scroll wheel)
    else if (kindOf(e) === 'mouse') go(e.deltaY * k * WHEEL);    // a scroll wheel moves through: rolling down goes forward
    else go(0, e.deltaX * k * perPixel(), -e.deltaY * k * perPixel());   // a trackpad pans, like a page
  }, { passive: false });

  // Safari reports a trackpad pinch as a gesture rather than a Ctrl scroll
  let gestureScale = 1;
  stage.addEventListener('gesturestart', (e) => { if (!flying) return; e.preventDefault(); gestureScale = 1; });
  stage.addEventListener('gesturechange', (e) => {
    if (!flying) return;
    e.preventDefault();
    go((e.scale - gestureScale) * 60);
    gestureScale = e.scale;
  });

  // Dragging (mouse, or one finger) pans, as if the space were grabbed; two fingers pinch to move through
  const pointers = new Map();
  let drag = null, pinchDist = 0;
  const spanOf = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  stage.addEventListener('pointerdown', (e) => {
    if (!flying || e.target.closest('a, button')) return;                // the links over the canvas work as normal
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      drag = { travelled: 0 };
      if (e.pointerType !== 'touch') renderer.domElement.style.cursor = 'grabbing';
    } else if (pointers.size === 2) {
      pinchDist = spanOf();
      drag = null;                                              // a pinch is never a tap
    }
  });
  addEventListener('pointermove', (e) => {
    mx = (e.clientX / innerWidth) * 2 - 1;
    my = (e.clientY / innerHeight) * 2 - 1;
    const p = pointers.get(e.pointerId);
    if (!p) { if (flying) hover(e); return; }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 2) {
      const d = spanOf();
      go((d - pinchDist) * PINCH_TOUCH);                        // fingers apart: forward
      pinchDist = d;
    } else if (pointers.size === 1) {
      if (drag) drag.travelled += Math.abs(dx) + Math.abs(dy);
      go(0, -dx * perPixel(), dy * perPixel());
    }
  });
  const lift = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (drag && pointers.size === 0 && drag.travelled < 8 && e.type === 'pointerup') bring(e);  // a tap or click
    if (pointers.size === 0) drag = null;
    renderer.domElement.style.cursor = 'grab';
  };
  addEventListener('pointerup', lift);
  addEventListener('pointercancel', lift);

  addEventListener('keydown', (e) => {
    if (!flying) return;
    if (e.key === 'Escape' && SECTION) { e.preventDefault(); land(); return; }
    if (e.target.closest && e.target.closest('a, button, input')) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const move = {
      '+': [SPACING], '=': [SPACING], w: [SPACING], PageDown: [SPACING], ' ': [SPACING],
      '-': [-SPACING], _: [-SPACING], s: [-SPACING], PageUp: [-SPACING],
      ArrowLeft: [0, -1.5], a: [0, -1.5], ArrowRight: [0, 1.5], d: [0, 1.5],
      ArrowUp: [0, 0, 1.2], ArrowDown: [0, 0, -1.2],
      Home: [-travel], End: [travel],
    }[k];
    if (move) { e.preventDefault(); go(...move); }
  });

  // Pointing at and opening a painting
  const ray = new THREE.Raycaster();
  let pointed = null;
  const at = (e) => {
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = ray.intersectObjects(planes.filter((m) => m.visible && m.material.opacity > 0.5))[0];
    return hit ? hit.object : null;
  };
  function hover(e) {
    pointed = at(e);
    renderer.domElement.style.cursor = pointed ? 'pointer' : 'grab';
  }
  // Bringing a painting to the middle: the view glides until it's straight ahead, near enough to fill
  // about 60% of the view's height (but never so near that it starts to fade)
  function bring(e) {
    const m = at(e);
    if (!m) return;
    const u = m.userData;
    const near = Math.max((u.h * scale) / (2 * viewTan * 0.6), 1.5);
    target.depth = Math.min(Math.max(START - (u.z + near), 0), travel);
    target.x = u.x;
    target.y = u.y;
    if (!moved) { moved = true; stage.classList.add('moved'); }
    save();
  }

  // The caption: the painting under the pointer, or else the one nearest the middle of the view ahead
  const cap = document.getElementById('float-caption');
  const capTitle = cap.querySelector('.t'), capDetails = cap.querySelector('.d');
  let shown = null;
  function caption(cam) {
    let best = pointed, bestS = Infinity;
    if (!best) {
      for (const m of planes) {
        const u = m.userData, d = cam.z - u.z;
        if (d < 0.6 || d > 30) continue;
        const s = Math.hypot(u.x - cam.x, u.y - cam.y) / d + d * 0.02;
        if (s < bestS) { bestS = s; best = m; }
      }
    }
    if (best !== shown) {
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
  }

  // The header's thick glass (glass.js) draws what's under it from this canvas, one copy per frame
  if (!SECTION) dispatchEvent(new CustomEvent('glass-source', { detail: renderer.domElement }));
  const frameDone = new Event('glass-frame');

  const clock = new THREE.Clock();
  // On the home page: switching between scrolling the page and flying through the gallery
  let at0 = 0;                                   // where the page was, to return to it
  function fly() {
    if (flying) return;
    at0 = section.getBoundingClientRect().top + scrollY;
    scrollTo({ top: at0, behavior: 'instant' });  // the section exactly in place, for the way back
    flying = true;
    html.classList.add('flying');
    layout();
    const exit = stage.querySelector('.float-exit');
    if (exit) exit.focus({ preventScroll: true });
  }
  function land() {
    if (!flying) return;
    flying = false;
    pointers.clear(); drag = null; pointed = null;
    renderer.domElement.style.cursor = '';
    html.classList.remove('flying');
    layout();
    scrollTo({ top: at0, behavior: 'instant' });
    const enter = section.querySelector('.invite-button');
    if (enter) enter.focus({ preventScroll: true });
  }
  if (SECTION) {
    const enter = section.querySelector('.invite-button');
    if (enter) enter.addEventListener('click', (e) => { e.preventDefault(); fly(); });
    const exit = stage.querySelector('.float-exit');
    if (exit) exit.addEventListener('click', land);
    // a tap or click on the gallery itself goes in too (a swipe still scrolls the page)
    stage.addEventListener('click', (e) => { if (!flying && !e.target.closest('a, button')) fly(); });
  }

  let first = true;
  renderer.setAnimationLoop(() => {
    if (SECTION && !flying) {                    // still in the page: nothing to draw while it's out of sight
      const r = stage.getBoundingClientRect();
      if (!first && (r.bottom < 0 || r.top > innerHeight)) return;
    }
    const t = clock.getElapsedTime();
    for (const k of ['depth', 'x', 'y']) now[k] += (target[k] - now[k]) * EASE;
    px += (mx - px) * 0.05; py += (my - py) * 0.05;
    const cam = { x: now.x + px * 0.5 * scale, y: now.y - py * 0.35 * scale, z: START - now.depth };
    camera.position.set(cam.x, cam.y, cam.z);
    for (const m of planes) {
      const u = m.userData;
      const d = cam.z - u.z;                                   // how far ahead of the visitor
      m.position.set(u.x, u.y + Math.sin(t * 0.45 + u.phase) * 0.07 * scale, u.z);   // drifting, never turning
      // Fully solid until you're right up against it (it fills the view several times over), then a quick
      // eased fade over the last stretch, so you can look closely at the brushwork before it slips past
      const k = Math.min(Math.max((d - FADE_GONE) / (FADE_START - FADE_GONE), 0), 1);
      const o = u.ready ? k * k * (3 - 2 * k) : 0;
      if (m.material.map) sharpen(m, (u.h * scale) / (2 * viewTan * Math.max(d, 0.01)));
      m.material.opacity += (o - m.material.opacity) * 0.2;
      m.visible = m.material.opacity > 0.01;
    }
    if (pointed && !pointed.visible) pointed = null;
    caption(cam);
    renderer.render(scene, camera);
    if (first && planes.every((m) => m.userData.ready)) { first = false; if (section) section.classList.add('gallery-live'); }
    if (!SECTION) dispatchEvent(frameDone);
  });
}
