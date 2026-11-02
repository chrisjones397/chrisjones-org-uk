/* The floating gallery: the paintings hang at different depths in a quiet grey space, and scrolling (or swiping,
   or the arrow keys) carries you forward through them. Each painting appears once, in the order of paintings.yaml.
   Moving the pointer shifts the view a little (parallax); the paintings drift gently; ones far ahead fade into the
   grey. Clicking a painting opens its page.

   The list of paintings is written into the page by tools/build_site.py (the "gallery-data" block). Visitors who
   have asked for reduced motion, or whose browser has no WebGL, get the plain grid that is already in the page.
   The way the movement eases (target position, chased each frame) follows the Infinite Canvas demo by
   Edoardo Lunardi for Codrops (MIT licence), rewritten here without React. */
import * as THREE from '../face/vendor/three.module.min.js';

const SPACING = 7;          // distance between one painting and the next, front to back
const HEIGHT = 3.4;         // height of a landscape painting (portraits are a little taller, the featured one larger)
const START = 12;           // how far in front of the first painting the visitor starts
const STOP = 4;             // how far in front of the last painting the journey ends
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

  // Each painting's place: alternately left and right of the way through, at a steady spacing in depth,
  // with a little fixed (seeded) variety so it doesn't look like a corridor
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const geometry = new THREE.PlaneGeometry(1, 1);
  const planes = data.map((p, i) => {
    const wide = p.wide;
    const side = i % 2 ? 1 : -1;                    // alternately left and right, leaving the way through clear
    const h = wide ? HEIGHT * 1.35 : (p.h > p.w ? HEIGHT * 1.2 : HEIGHT);
    const material = new THREE.MeshBasicMaterial({ color: 0x7a7a7a, transparent: true, opacity: 0, fog: true });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData = { p, side, h, w: h * p.w / p.h, jx: rand() - 0.5, jy: rand() - 0.5, phase: rand() * 6.28, z: -i * SPACING };
    scene.add(mesh);
    return mesh;
  });
  const lastZ = -(data.length - 1) * SPACING;
  const travel = START - (lastZ + STOP);           // the whole journey, start to end

  // Sizes and spread follow the window's shape. On a wide screen the paintings stand either side of a clear
  // way through; on a tall, narrow one (a phone) they're nearly centred, and each dissolves as you reach it.
  let scale = 1, spread = 3.2, narrow = false;
  function layout() {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 9;   // half the view's height, 9 units away
    const halfW = halfH * camera.aspect;
    narrow = camera.aspect < 0.9;
    scale = Math.min(1, halfW / 3);
    spread = Math.min(3.2, halfW * 0.5);
    for (const m of planes) {
      const u = m.userData;
      m.scale.set(u.w * scale, u.h * scale, 1);
      u.x = narrow ? u.side * 0.25 * scale + u.jx * 0.3 * scale
                   : u.side * Math.max(spread * (1 + u.jx * 0.35), (u.w * scale) / 2 + 0.5);   // inner edge clear of the path
      u.y = u.jy * 1.4 * scale;
    }
  }
  layout();
  addEventListener('resize', layout);

  // The pictures: one size per painting, about what this screen needs; nearest first
  const want = Math.min(stage.clientWidth * renderer.getPixelRatio() * 0.6, 1536);
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

  // Moving: everything sets a target; each frame the view covers part of the way there
  let target = 0, pos = 0, mx = 0, my = 0, px = 0, py = 0, moved = false;
  const go = (d) => {
    target = Math.min(Math.max(target + d, 0), travel);
    if (!moved && Math.abs(d) > 0) { moved = true; stage.classList.add('moved'); }
  };
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    go((e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY) * 0.012);
  }, { passive: false });

  let drag = null;
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('a, button')) return;                // the links over the canvas work as normal
    drag = { y: e.clientY, x: e.clientX, travelled: 0, id: e.pointerId };
  });
  addEventListener('pointermove', (e) => {
    mx = (e.clientX / innerWidth) * 2 - 1;
    my = (e.clientY / innerHeight) * 2 - 1;
    if (drag && drag.id === e.pointerId) {
      const dy = drag.y - e.clientY;                          // dragging up carries you forward
      drag.travelled += Math.abs(dy) + Math.abs(drag.x - e.clientX);
      drag.y = e.clientY; drag.x = e.clientX;
      go(dy * (e.pointerType === 'touch' ? 0.045 : 0.03));
    } else {
      hover(e);
    }
  });
  addEventListener('pointerup', (e) => {
    if (drag && drag.id === e.pointerId && drag.travelled < 8) open(e);   // a tap or click, not a drag
    drag = null;
  });
  addEventListener('pointercancel', () => { drag = null; });

  addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('a, button, input')) return;
    const step = { ArrowDown: 1, PageDown: 1, ' ': 1, ArrowRight: 1, ArrowUp: -1, PageUp: -1, ArrowLeft: -1 }[e.key];
    if (step) { e.preventDefault(); go(step * SPACING); }
    if (e.key === 'Home') { e.preventDefault(); go(-travel); }
    if (e.key === 'End') { e.preventDefault(); go(travel); }
  });

  // Pointing at and opening a painting
  const ray = new THREE.Raycaster();
  const at = (e) => {
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = ray.intersectObjects(planes.filter((m) => m.material.opacity > 0.5))[0];
    return hit && hit.object.userData.p;
  };
  function hover(e) { renderer.domElement.style.cursor = at(e) ? 'pointer' : 'grab'; }
  function open(e) { const p = at(e); if (p) location.href = `../paintings/${p.name}/`; }

  // The caption: the painting you're approaching
  const cap = document.getElementById('float-caption');
  const capTitle = cap.querySelector('.t'), capDetails = cap.querySelector('.d'), count = document.getElementById('float-count');
  let shown = null;
  function caption(camZ) {
    let best = null, bestD = Infinity;
    for (const m of planes) {
      const d = camZ - m.userData.z;
      if (d > 3 && d < bestD) { bestD = d; best = m; }      // the next one you have not yet reached
    }
    if (!best && planes.length) best = planes[planes.length - 1];
    if (best !== shown) {
      shown = best;
      cap.classList.remove('on');
      setTimeout(() => {
        if (shown !== best) return;
        capTitle.textContent = best.userData.p.title;
        capDetails.textContent = best.userData.p.details || '';
        count.textContent = `${planes.indexOf(best) + 1} / ${planes.length}`;
        cap.classList.add('on');
      }, 180);
    }
  }

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const t = clock.getElapsedTime();
    pos += (target - pos) * EASE;
    px += (mx - px) * 0.05; py += (my - py) * 0.05;
    const camZ = START - pos;
    camera.position.set(px * 0.6 * scale, -py * 0.4 * scale, camZ);
    camera.lookAt(px * 0.15, -py * 0.1, camZ - 10);
    for (const m of planes) {
      const u = m.userData;
      const d = camZ - u.z;                                  // how far ahead of the visitor
      m.position.set(u.x, u.y + Math.sin(t * 0.45 + u.phase) * 0.07 * scale, u.z);
      m.rotation.z = Math.sin(t * 0.3 + u.phase) * 0.008;
      m.rotation.y = -u.side * 0.06;
      const o = narrow ? Math.min(Math.max((d - 2) / 3, 0), 1)       // dissolves as you reach it
                       : Math.min(Math.max((d - 1) / 2.5, 0), 1);    // fades as it slips past
      m.material.opacity += (o - m.material.opacity) * 0.2;
      m.visible = m.material.opacity > 0.01;
    }
    caption(camZ);
    renderer.render(scene, camera);
  });
}
