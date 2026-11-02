/* The floating gallery: the paintings hang scattered through a quiet grey space, spread side to side, up and
   down, and in depth. Scrolling (or swiping up, or the arrow keys) carries you forward through them; dragging
   (or swiping sideways) looks around. The space has edges, so you can't get lost, and each painting appears
   once, roughly in the order of paintings.yaml from front to back. The paintings drift gently, the view shifts
   a little with the pointer, and distant ones fade into the grey. Clicking a painting opens its page.

   The list of paintings is written into the page by tools/build_site.py (the "gallery-data" block). Visitors who
   have asked for reduced motion, or whose browser has no WebGL, get the plain grid that is already in the page.
   The eased movement (a target position, chased each frame) and the scattering in three dimensions follow the
   Infinite Canvas demo by Edoardo Lunardi for Codrops (MIT licence), rewritten here without React. */
import * as THREE from '../face/vendor/three.module.min.js';

const SPACING = 6;          // distance in depth from one painting to the next
const HEIGHT = 2.6;         // height of a landscape painting (portraits a little taller, the featured one larger)
const START = 12;           // how far in front of the first painting the visitor starts
const STOP = 5;             // how far in front of the last painting the journey ends
const EASE = 0.075;         // share of the remaining distance covered each frame (lower: more glide)
const BG = 0x646464;        // the page colour, rgb(100, 100, 100)

const data = JSON.parse(document.getElementById('gallery-data').textContent);
const stage = document.getElementById('float-stage');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

function webgl() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); }
  catch (e) { return false; }
}
if (stage && data.length && !reduce && webgl()) start();

function start() {
  document.documentElement.classList.add('float-on');

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setClearColor(BG);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.prepend(renderer.domElement);
  renderer.domElement.setAttribute('aria-hidden', 'true');

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(BG, 10, 34);         // distant paintings fade into the grey
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 80);

  // Each painting's place. Side to side and up and down they're spread round the way through by the golden
  // angle (so no two in a row sit in the same direction), at varying distances from the middle; in depth they
  // follow one another at a steady spacing. A fixed seed gives a little variety that is the same every visit.
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const geometry = new THREE.PlaneGeometry(1, 1);
  const planes = data.map((p, i) => {
    const h = p.wide ? HEIGHT * 1.35 : (p.h > p.w ? HEIGHT * 1.2 : HEIGHT);
    const material = new THREE.MeshBasicMaterial({ color: 0x7a7a7a, transparent: true, opacity: 0, fog: true });
    const mesh = new THREE.Mesh(geometry, material);
    const angle = 2.6 + i * 2.39996 + (rand() - 0.5) * 0.5;
    const reach = 0.6 + 0.4 * ((i * 0.618034) % 1);   // never on the way through itself
    mesh.userData = { p, h, w: h * p.w / p.h, ax: Math.cos(angle) * reach, ay: Math.sin(angle) * reach,
                      phase: rand() * 6.28, z: -i * SPACING - rand() * 1.5 };
    scene.add(mesh);
    return mesh;
  });
  const lastZ = Math.min(...planes.map((m) => m.userData.z));
  const travel = START - (lastZ + STOP);           // the whole journey, start to end

  // The spread and sizes follow the window's shape: wide on a computer, tall and narrow on a phone
  let scale = 1, rx = 5, ry = 3;
  function layout() {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 12;   // half the view, 12 units away
    const halfW = halfH * camera.aspect;
    scale = Math.min(1, halfW / 4);
    rx = halfW * 0.85;
    ry = halfH * 0.7;
    for (const m of planes) {
      const u = m.userData;
      m.scale.set(u.w * scale, u.h * scale, 1);
      u.x = u.ax * rx;
      u.y = u.ay * ry;
    }
  }
  layout();
  addEventListener('resize', layout);

  // The pictures: one size per painting, about what this screen needs
  const want = Math.min(stage.clientWidth * renderer.getPixelRatio() * 0.5, 1536);
  const loader = new THREE.TextureLoader();
  planes.forEach((m) => {
    const p = m.userData.p;
    const w = p.widths.find((x) => x >= want) || p.widths[p.widths.length - 1];
    loader.load(`../img/${p.name}-${w}.webp`, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      m.material.map = tex;
      m.material.color.set(0xffffff);
      m.material.needsUpdate = true;
    });
  });

  // Moving: everything sets a target; each frame the view covers part of the way there.
  // depth: how far through; panX, panY: looking around, kept within the space's edges.
  const target = { depth: 0, x: 0, y: 0 }, now = { depth: 0, x: 0, y: 0 };
  let mx = 0, my = 0, px = 0, py = 0, moved = false;
  const clamp = (v, a) => Math.min(Math.max(v, -a), a);
  function go(dDepth, dx = 0, dy = 0) {
    target.depth = Math.min(Math.max(target.depth + dDepth, 0), travel);
    target.x = clamp(target.x + dx, rx * 0.85);
    target.y = clamp(target.y + dy, ry * 0.85);
    if (!moved && (dDepth || dx || dy)) { moved = true; stage.classList.add('moved'); }
  }
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const k = e.deltaMode === 1 ? 16 : 1;
    go(e.deltaY * k * 0.012, e.deltaX * k * 0.01);           // a trackpad's sideways scroll looks sideways
  }, { passive: false });

  // Dragging with a mouse looks around (the space moves with the pointer, as if grabbed).
  // On a touch screen, swiping up or down moves through and swiping sideways looks around.
  let drag = null;
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('a, button')) return;                // the links over the canvas work as normal
    drag = { y: e.clientY, x: e.clientX, travelled: 0, id: e.pointerId, touch: e.pointerType === 'touch' };
    if (!drag.touch) renderer.domElement.style.cursor = 'grabbing';
  });
  addEventListener('pointermove', (e) => {
    mx = (e.clientX / innerWidth) * 2 - 1;
    my = (e.clientY / innerHeight) * 2 - 1;
    if (drag && drag.id === e.pointerId) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.travelled += Math.abs(dx) + Math.abs(dy);
      drag.x = e.clientX; drag.y = e.clientY;
      const k = 12 / stage.clientHeight;                       // a drag across the screen ~ the view's width
      if (drag.touch) go(-dy * 0.045, -dx * k);
      else go(0, -dx * k, dy * k);
    } else {
      hover(e);
    }
  });
  addEventListener('pointerup', (e) => {
    if (drag && drag.id === e.pointerId && drag.travelled < 8) open(e);   // a tap or click, not a drag
    drag = null;
    renderer.domElement.style.cursor = 'grab';
  });
  addEventListener('pointercancel', () => { drag = null; });

  addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('a, button, input')) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const move = {
      ArrowDown: [SPACING], PageDown: [SPACING], ' ': [SPACING], w: [SPACING],
      ArrowUp: [-SPACING], PageUp: [-SPACING], s: [-SPACING],
      ArrowLeft: [0, -1.5], a: [0, -1.5], ArrowRight: [0, 1.5], d: [0, 1.5],
      e: [0, 0, 1.2], q: [0, 0, -1.2],
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
  function open(e) { const m = at(e); if (m) location.href = `../paintings/${m.userData.p.name}/`; }

  // The caption: the painting under the pointer, or else the one nearest the middle of the view ahead
  const cap = document.getElementById('float-caption');
  const capTitle = cap.querySelector('.t'), capDetails = cap.querySelector('.d');
  let shown = null;
  function caption(cam) {
    let best = pointed, bestS = Infinity;
    if (!best) {
      for (const m of planes) {
        const u = m.userData, d = cam.z - u.z;
        if (d < 2.5 || d > 30) continue;
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
        capDetails.textContent = best.userData.p.details || '';
        cap.classList.add('on');
      }, 180);
    }
  }

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const t = clock.getElapsedTime();
    for (const k of ['depth', 'x', 'y']) now[k] += (target[k] - now[k]) * EASE;
    px += (mx - px) * 0.05; py += (my - py) * 0.05;
    const cam = { x: now.x + px * 0.5 * scale, y: now.y - py * 0.35 * scale, z: START - now.depth };
    camera.position.set(cam.x, cam.y, cam.z);
    camera.lookAt(now.x + px * 0.12, now.y - py * 0.08, cam.z - 10);
    for (const m of planes) {
      const u = m.userData;
      const d = cam.z - u.z;                                   // how far ahead of the visitor
      m.position.set(u.x, u.y + Math.sin(t * 0.45 + u.phase) * 0.07 * scale, u.z);
      m.rotation.z = Math.sin(t * 0.3 + u.phase) * 0.008;
      m.rotation.y = -Math.sign(u.x - cam.x) * Math.min(Math.abs(u.x - cam.x) / 40, 0.08);   // turned slightly towards you
      const o = Math.min(Math.max((d - 2) / 3, 0), 1);         // fades as you reach it, gone before you pass
      m.material.opacity += (o - m.material.opacity) * 0.2;
      m.visible = m.material.opacity > 0.01;
    }
    if (pointed && !pointed.visible) pointed = null;
    caption(cam);
    renderer.render(scene, camera);
  });
}
