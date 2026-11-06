/* The floating wall: the home page's gallery section. The paintings hang down a tall wall of quiet grey, at
   different depths, each at a size that follows (softly) its real size, in the order of paintings.yaml.

   There is nothing to switch on and nothing takes over the page: ordinary scrolling (a mouse's wheel, a
   trackpad, a finger, the keys or the scrollbar) carries you down the wall, so every way of moving through the
   site works here exactly as it does everywhere else. The section is as tall as the wall needs; the view of
   it stays in place while the page scrolls through it, and the paintings rise past. Paintings at the middle
   depth move exactly with the page (on a phone, with your finger); nearer ones move a little faster and
   further ones a little slower, which is what makes them seem to hang in space. They drift gently, and the
   view shifts a little with the mouse. Pointing at a painting names it in the caption; clicking or tapping it
   opens its page. Otherwise the caption names the painting nearest the middle of the view.

   The list of paintings and the settings from paintings.yaml are written into the page by tools/build_site.py
   (the "gallery-data" block). Visitors who have asked for reduced motion, or whose browser has no WebGL, get
   the few paintings hung around the words that are already in the page. */
import * as THREE from '../face/vendor/three.module.min.js';

const { settings, paintings: data } = JSON.parse(document.getElementById('gallery-data').textContent);
const SPREAD = settings.spread ?? 1;     // how widely they're scattered side to side (1: across most of the view)
const SIZE = 3.6;           // a 60 x 90 cm painting is about 2.9 high; smaller ones less, but not in proportion
const D0 = 12;              // paintings this far away move exactly with the page
const NEAR = 9, FAR = 17;   // the range of depths they hang at
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
    mesh.userData = { p, h, w: h * p.w / p.h, d: NEAR + (FAR - NEAR) * f, side: i % 2 ? 1 : -1,
                      reach: 0.35 + 0.65 * rand(), phase: rand() * 6.28 };
    scene.add(mesh);
    return mesh;
  });

  // Laying out the wall for this window: across, the paintings alternate sides on a computer and keep near
  // the middle on a phone; down, each follows the last with room for both, more room on a phone, where
  // they're one above another rather than side by side. The section is then made as tall as the journey.
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
    scale = Math.min(1, (D0 * viewTan * camera.aspect) / 4);
    let y = -(narrow ? 0.62 : 0.3) * viewH0, lastH = 0;          // the first starts below the heading
    planes.forEach((m, i) => {
      const u = m.userData;
      const sw = u.w * scale, sh = u.h * scale;
      m.scale.set(sw, sh, 1);
      const seen = sh * D0 / u.d;                               // its height as it looks, at the middle depth
      if (i) y -= (narrow ? 1.25 : 0.9) * (lastH + seen) / 2;
      lastH = seen;
      u.y = u.cy = y;                   // the view is level with it (it's in the middle) when the page is here
      const halfW = u.d * viewTan * camera.aspect;              // half the view's width at its depth
      const room = Math.max(halfW * 0.94 - sw / 2, 0);
      u.x = u.side * room * u.reach * (narrow ? 0.45 : 1) * SPREAD;
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

  // Pointing at and opening a painting
  const ray = new THREE.Raycaster();
  let pointed = null, mx = 0, px = 0;
  const at = (x, y) => {
    const r = renderer.domElement.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
    ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), camera);
    const hit = ray.intersectObjects(planes.filter((m) => m.visible && m.material.opacity > 0.5))[0];
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
    if (m) location.href = `${BASE}paintings/${m.userData.p.name}/`;
  });

  // The caption: the painting under the pointer, or else the one nearest the middle of the view
  const cap = document.getElementById('float-caption');
  const capTitle = cap.querySelector('.t'), capDetails = cap.querySelector('.d');
  let shown = null;
  function caption(camY) {
    let best = pointed, bestS = Infinity;
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
  let first = true;
  renderer.setAnimationLoop(() => {
    const r = stage.getBoundingClientRect();
    if (!first && (r.bottom < 0 || r.top > innerHeight)) return;   // out of sight: nothing to draw
    const t = clock.getElapsedTime();
    px += (mx - px) * 0.05;
    const camY = -progress() * perPx;
    camera.position.set(px * 0.35 * scale, camY, 0);
    for (const m of planes) {
      const u = m.userData;
      m.position.set(u.x, u.y + Math.sin(t * 0.45 + u.phase) * 0.06 * scale, -u.d);   // drifting, never turning
      const o = u.ready ? 1 : 0;
      m.material.opacity += (o - m.material.opacity) * 0.08;
      m.visible = m.material.opacity > 0.01;
    }
    pointed = lastPointer ? at(...lastPointer) : null;
    renderer.domElement.style.cursor = pointed ? 'pointer' : '';
    caption(camY);
    renderer.render(scene, camera);
    if (first && planes.every((m) => m.userData.ready)) { first = false; section.classList.add('gallery-live'); }
  });
}
