/* The face section: sea, whirlwind, head and photo, driven by scrolling. Needs the files in this folder. */
import * as THREE from './vendor/three.module.min.js';
const here = name => new URL(name, import.meta.url).href;   // files sit next to this script

/* ================= Settings you might want to tweak ================= */
const SEA_TIME     = 4.5;   // calm sea before anything lifts
const SEA_Y        = -1.0;  // height of the sea below the head
const HAZE         = 6;     // distance over which the sea fades into the grey
const WAVE_HEIGHT  = 0.03;  // small waves
const WHIRL_SPREAD = 2.2;   // the sea lifts from the centre outwards over this many seconds
const WHIRL_TIME   = 4.8;   // each point's journey from the sea to the head
const WHIRL_TURNS  = 1.4;   // gentle
const WHIRL_LIFT   = 0.45;
const HOLD         = 0.5;   // pause once the head has formed
const SETTLE       = 0.5;   // pause after the movement, before building
const BUILD_TIME   = 15.5;   // the wave travels from the nose to the furthest edge and the last stage finishes
const STAGE_GAP    = 0.30;  // how far behind each stage follows the one before (fraction of the head)
const BAND         = 0.20;  // width of each soft transition band
const LAND         = 0.28;  // how long (in the same units) a triangle takes to fly in and land
const FLY          = 0.35;  // how far triangles fly in from
const FRAME_FILL   = 0.82;  // sets the camera's distance, and so how strong the perspective is
const SHIFT_TALL   = 0.08;  // when stacked, the head sits this far left of centre (fraction of the width), facing into the space
const MOVE_SLOW    = 2.0;   // the measured head movement plays this many times slower than it was filmed
const BUILD_LEAD   = 1.0;   // the triangles start arriving this many seconds after the movement starts
const PLAY         = 0.85;  // the animation plays over this much of the section's scroll; the rest holds the finished head
const R_SWIRL      = 1.2;   // points this close to the head make the full turns; further ones curl more gently

/* ================= Helpers ================= */
const clamp01 = v => Math.min(Math.max(v, 0), 1);
const smooth = v => v * v * (3 - 2 * v);
const lerp = (a, b, v) => a + (b - a) * v;
const ramp = (t, a, d) => clamp01((t - a) / d);

/* ================= Data ================= */
const meta = await (await fetch(here('face-model.json'))).json();
const buf = await (await fetch(here('face-model.bin'))).arrayBuffer();
const arr = name => { const [o, n, dt] = meta.offsets[name]; return dt === '<f4' ? new Float32Array(buf, o, n) : new Uint16Array(buf, o, n); };
const SHAPE = arr('shape'), SEA = arr('sea'), MATS = arr('mats');
const N = meta.n, NF = meta.frames, FPS = meta.fps, ASPECT = meta.aspect;
const NOSE = new THREE.Vector3(...meta.nose);
const params = new URLSearchParams(location.search);
const frozen = params.has('t') ? parseFloat(params.get('t')) : null;

/* Timeline */
const T_WHIRL  = SEA_TIME;
const T_ARRIVE = T_WHIRL + WHIRL_SPREAD + WHIRL_TIME;
const T_MOVE   = T_ARRIVE + HOLD;
const T_MOVED  = T_MOVE + (NF - 1) / FPS * MOVE_SLOW;
const T_BUILD  = T_MOVE + BUILD_LEAD;                     // triangles land on the moving head
const HAIR_GROW = 0.60;  // how long hair outside the head takes to grow out from its roots to its tips
const SPEED    = (1 + 3 * STAGE_GAP + BAND + HAIR_GROW + 0.05) / BUILD_TIME;   // how fast the wave travels
const PHOTO_START = Math.max(3 * STAGE_GAP, SPEED * (T_MOVED + SETTLE - T_BUILD)); // the real photo waits for the final pose
const W_MAX    = PHOTO_START + 1 + BAND + HAIR_GROW + 0.05;   // wave position when everything is done
const T_DONE   = T_BUILD + W_MAX / SPEED + 0.8;

/* ================= Scene and camera ================= */
const stage = document.querySelector('.face-stage');
const bgCss = getComputedStyle(document.body).backgroundColor;                 // the page's own grey
const BG = new THREE.Color(bgCss);
const bgRGB = (bgCss.match(/[\d.]+/g) || [100, 100, 100]).slice(0, 3).map(v => v / 255);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: frozen !== null });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(BG, 1);
stage.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const FOV = 22;
const camera = new THREE.PerspectiveCamera(FOV, innerWidth / innerHeight, 0.05, 200);
const tnF = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
const winW = () => stage.clientWidth, winH = () => stage.clientHeight;

/* ================= Layout: where the head and the profile text go =================
   Everything is worked out from the head's real outline in the final photo (not the photo's frame,
   which has a lot of empty grey round it), and from the page's content edges (those of the gallery).
   Side by side: the head keeps its height and the text column narrows first; only when the text
   would be too narrow does the head shrink, and if it would get too small the two stack.
   Stacked: the head and the text form one group, text just under the chin, centred in the window. */
const siteHeader = document.querySelector('.header'), wordsEl = document.querySelector('.face-words');
const sectionEl = document.querySelector('.face-section');
const FILL = 0.88;          // how much of the free height the head fills
const MIN_TEXT = 300;       // narrowest the text column may be, side by side (px)
const MIN_HEAD = 0.62;      // stack rather than let the side-by-side head drop below this share of its full size
const headBox = await (async () => {                    // the head's outline in the photo, from its transparency
  const im = new Image(); im.src = here('final-alpha.png'); await im.decode();
  const W = 240, H = Math.round(W * im.naturalHeight / im.naturalWidth);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'); g.drawImage(im, 0, 0, W, H);
  const d = g.getImageData(0, 0, W, H).data;
  let x0 = W, x1 = 0, y0 = H, y1 = 0;
  const rowLeft = new Array(H).fill(W);                 // leftmost part of the head on each row
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4] > 127) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (x < rowLeft[y]) rowLeft[y] = x;
  }
  // leftmost point over the bottom part of the outline (the V-neck), from the bottom up, in plane units
  const vLeft = [];
  let m = W; for (let y = y1; y >= y0; y--) { m = Math.min(m, rowLeft[y]); vLeft.push(m / W - 0.5); }
  // in the photo plane's units: 1 wide, ASPECT tall, centred on the camera's line of sight
  return { left: x0 / W - 0.5, right: (x1 + 1) / W - 0.5, top: ASPECT / 2 - y0 / H * ASPECT, bottom: ASPECT / 2 - (y1 + 1) / H * ASPECT,
           vLeftAt: f => vLeft[Math.min(vLeft.length - 1, Math.max(0, Math.round(f * (vLeft.length - 1))))] };
})();
const headW = headBox.right - headBox.left, headH = headBox.top - headBox.bottom, headRatio = headW / headH;
function pageEdge(w) {                                  // the gallery paintings' edges: its padding plus 1em
  const pad = w >= 900 ? Math.max(120, (w - 1200) / 2 + 120) : w > 720 ? 24 : w > 540 ? 10 : 12;
  return pad + 16;
}
const CAM_D = (ASPECT / 2) / tnF / FRAME_FILL;          // fixed: only sets how strong the perspective is
function layout(w, h) {
  const top = (siteHeader ? Number(siteHeader.dataset.compactHeight) || siteHeader.offsetHeight : 0) + 0.04 * h;
  const bottom = h - 0.04 * h, free = bottom - top;
  const E = pageEdge(w), L = E, R = w - E, C = R - L;
  let stacked = false, Hpx = FILL * free, textW;
  if (wordsEl) {
    const gap = Math.max(40, 0.04 * w);
    textW = Math.min(0.45 * C, C - Hpx * headRatio - gap);
    if (textW < MIN_TEXT) { textW = MIN_TEXT; Hpx = (C - gap - MIN_TEXT) / headRatio; }
    stacked = Hpx < MIN_HEAD * FILL * free;
  }
  let cx, cy, words = null;
  sectionEl && sectionEl.classList.toggle('face-stacked', stacked);
  if (!wordsEl) { cx = w / 2; cy = (top + bottom) / 2; }
  else if (!stacked) {
    const gap = Math.max(40, 0.04 * w);
    wordsEl.style.width = textW + 'px';
    const tH = wordsEl.offsetHeight;
    cx = L + (C - textW - gap) / 2; cy = (top + bottom) / 2;
    words = { left: R - textW, top: Math.max(top, cy - tH / 2), width: textW };
  } else {
    wordsEl.style.width = C + 'px';
    const tH = wordsEl.offsetHeight, gap = 0.03 * h;
    // the short heading can sit beside the narrow point of the V-neck, so the text starts right under the chin
    const h2 = wordsEl.firstElementChild;
    let tuck = 0, headingW = Infinity;
    if (h2) {
      const r = document.createRange(); r.selectNodeContents(h2); headingW = r.getBoundingClientRect().width;
      tuck = h2.offsetHeight + parseFloat(getComputedStyle(h2).marginBottom || 0);
    }
    const place = t => {
      const H2 = Math.max(0.15 * h, Math.min(FILL * (free - tH - gap + t), 0.92 * C / headRatio));
      const g0 = top + Math.max(0, (free - (H2 + gap + tH - t)) / 2);
      return { H2, g0, x: w / 2 - SHIFT_TALL * w };
    };
    let p = place(tuck);
    const sc = p.H2 / headH, Xm = (headBox.left + headBox.right) / 2;
    const vLeftPx = p.x + (headBox.vLeftAt((tuck + gap) / p.H2) - Xm) * sc;   // where the neck is, beside the heading
    if (!(L + headingW + 0.04 * w < vLeftPx)) { tuck = 0; p = place(0); }       // no room beside the neck: keep it below
    Hpx = p.H2; cx = p.x; cy = p.g0 + Hpx / 2;
    words = { left: L, top: p.g0 + Hpx + gap - tuck, width: C };
  }
  // the lens that puts the head's outline exactly there: its height sets the zoom, its centre the shift
  const scale = Hpx / headH, tn = (h / 2) / (scale * CAM_D);
  const Xc = (headBox.left + headBox.right) / 2, Yc = (headBox.top + headBox.bottom) / 2;
  return { tn, sx: w / 2 + Xc * scale - cx, sy: h / 2 - Yc * scale - cy, words };
}
function applyWords(o) {
  if (!o || !wordsEl) return;
  Object.assign(wordsEl.style, { left: o.left + 'px', top: o.top + 'px', width: o.width + 'px', right: 'auto', bottom: 'auto', transform: 'none' });
}
const L0LAY = layout(winW(), winH()); applyWords(L0LAY.words);
const VIEW_ASPECT = winW() / winH(), VIEW_SHIFT = L0LAY.sx / winW(), VIEW_TN = L0LAY.tn;
const VIEW_LIFT = Math.max(L0LAY.sy, 0) / winH();
let fitting = false;
function fit() {
  if (fitting) return; fitting = true;
  const w = winW(), h = winH();
  renderer.setSize(w, h);
  camera.aspect = w / h;
  // the camera never moves; the lens is chosen so the finished head lands in its place in the layout
  const lay = layout(w, h); applyWords(lay.words);
  camera.fov = 2 * THREE.MathUtils.radToDeg(Math.atan(lay.tn));
  camera.setViewOffset(w, h, lay.sx, lay.sy, w, h);
  camera.updateProjectionMatrix();
  pointMat.uniforms.uScale.value = h / 900 * Math.min(devicePixelRatio, 2);
  if (tShown >= 0) frame(tShown);
  fitting = false;
}

/* Measured positions are positions in the photo; pull each in by its depth so the final camera
   sees it exactly where it is in the photo. */
function toCameraView(a, n) {
  for (let i = 0; i < n; i++) { const k = (CAM_D - a[i * 3 + 2]) / CAM_D; a[i * 3] *= k; a[i * 3 + 1] *= k; }
  return a;
}
const tmpM = new THREE.Matrix4();
/* The head moves as measured; the neck bends, and the base of the neck stays where it ends up,
   just as a real neck does when you turn your head. */
const NECK_TOP = meta.neck.top, NECK_BOTTOM = meta.neck.bottom;
const restM = new THREE.Matrix4().fromArray(MATS, (NF - 1) * 16).elements;   // the final pose
const poseNow = new THREE.Matrix4(), restInv = new THREE.Matrix4().fromArray(restM).invert();
function frameMatrix(fr, m) {
  const f = Math.min(Math.max(fr, 0), NF - 1), k = Math.floor(f), w = f - k, k2 = Math.min(k + 1, NF - 1);
  const e = m.elements;
  for (let j = 0; j < 16; j++) e[j] = lerp(MATS[k * 16 + j], MATS[k2 * 16 + j], w);
  return m;
}
function posed(fr, out, shape = SHAPE, n = N) {
  const f = Math.min(Math.max(fr, 0), NF - 1), k = Math.floor(f), w = f - k, k2 = Math.min(k + 1, NF - 1);
  const e = tmpM.elements;
  for (let j = 0; j < 16; j++) e[j] = lerp(MATS[k * 16 + j], MATS[k2 * 16 + j], w);
  for (let i = 0; i < n; i++) {
    const x = shape[i * 3], y = shape[i * 3 + 1], z = shape[i * 3 + 2];
    const h = 1 - smooth(clamp01((y - NECK_TOP) / (NECK_BOTTOM - NECK_TOP)));   // 1 for the head, 0 at the neck base
    const ax = e[0] * x + e[4] * y + e[8] * z + e[12], ay = e[1] * x + e[5] * y + e[9] * z + e[13], az = e[2] * x + e[6] * y + e[10] * z + e[14];
    const bx = restM[0] * x + restM[4] * y + restM[8] * z + restM[12], by = restM[1] * x + restM[5] * y + restM[9] * z + restM[13], bz = restM[2] * x + restM[6] * y + restM[10] * z + restM[14];
    out[i * 3] = lerp(bx, ax, h); out[i * 3 + 1] = lerp(by, ay, h); out[i * 3 + 2] = lerp(bz, az, h);
  }
  return toCameraView(out, n);
}
const firstPose = posed(0, new Float32Array(N * 3));
let axX = 0, axZ = 0;
for (let i = 0; i < N; i++) { axX += firstPose[i * 3]; axZ += firstPose[i * 3 + 2]; }
axX /= N; axZ /= N;

/* Sea: each point's place comes from its longitude and latitude on the head, so neighbours stay neighbours */
const seaX = new Float32Array(N), seaZ = new Float32Array(N), delay = new Float32Array(N), phi = new Float32Array(N);
const SEA_NEAR_D = Math.abs(SEA_Y) / (VIEW_TN * (1 + 2 * VIEW_LIFT) * 1.15);   // nearest sea sits just below the bottom of the window
const SEA_FAR_D = 45;
let maxR = 0;
const WC = CAM_D - SEA_NEAR_D - 1.5;                          // where on the sea the whirlwind forms
for (let i = 0; i < N; i++) {
  const D = SEA_NEAR_D * Math.pow(SEA_FAR_D / SEA_NEAR_D, Math.pow((SEA[i * 2 + 1] + 1) / 2, 1.1));
  const halfW = VIEW_TN * VIEW_ASPECT * D;                       // wide enough to reach past both sides of the window
  seaX[i] = (SEA[i * 2] * 1.45 + 2 * VIEW_SHIFT) * halfW;
  seaZ[i] = CAM_D - D;
  maxR = Math.max(maxR, Math.hypot(seaX[i] - axX, seaZ[i] - WC));
}
const PHI_ALL = WHIRL_TURNS * Math.PI * 2;
for (let i = 0; i < N; i++) {
  delay[i] = WHIRL_SPREAD * Math.hypot(seaX[i] - axX, seaZ[i] - WC) / maxR;
  phi[i] = PHI_ALL * Math.min(1, R_SWIRL / Math.hypot(seaX[i] - axX, seaZ[i] - axZ));   // far points don't sweep wide arcs
}
let waveClock = 0;                                           // keeps the waves moving gently while the page rests
function waveY(x, z, t) {
  t += waveClock;
  return SEA_Y + WAVE_HEIGHT * (Math.sin(x * 2.1 + t * 0.9) * 0.6 + Math.sin(z * 1.3 - t * 1.1) * 0.8 + Math.sin((x + z) * 3.7 + t * 1.7) * 0.25);
}
function pointPositions(t, out) {
  if (t >= T_ARRIVE) { if (t >= T_MOVE) posed((t - T_MOVE) * FPS / MOVE_SLOW, out); else out.set(firstPose); return; }
  for (let i = 0; i < N; i++) {
    const PHI = phi[i], ca = Math.cos(-PHI), sa = Math.sin(-PHI);
    const k = i * 3, s = clamp01((t - T_WHIRL - delay[i]) / WHIRL_TIME);
    const sx = seaX[i], sz = seaZ[i], sy = waveY(sx, sz, t);
    if (s <= 0) { out[k] = sx; out[k + 1] = sy; out[k + 2] = sz; continue; }
    const sm = smooth(s), c = 1 - Math.pow(1 - sm, 2.0);            // eases off the water from rest
    const e = smooth(clamp01((s - 0.3) / 0.7));                    // the turning starts once it has lifted
    const tx = firstPose[k] - axX, tz = firstPose[k + 2] - axZ;
    const rx = tx * ca - tz * sa, rz = tx * sa + tz * ca;
    const bx = lerp(sx - axX, rx, c), bz = lerp(sz - axZ, rz, c);
    const a = PHI * e, cb = Math.cos(a), sb = Math.sin(a);
    out[k] = bx * cb - bz * sb + axX;
    out[k + 2] = bx * sb + bz * cb + axZ;
    out[k + 1] = lerp(sy, firstPose[k + 1], smooth(c)) + WHIRL_LIFT * Math.pow(Math.sin(Math.PI * s), 2) * (1 - c * 0.5);
  }
}

/* Camera: fixed in one place for the whole animation, framed on the finished head */
camera.position.set(0, 0, CAM_D); camera.lookAt(0, 0, 0);

/* ================= Points ================= */
const ptPos = new Float32Array(N * 3);
const ptGeo = new THREE.BufferGeometry();
ptGeo.setAttribute('position', new THREE.BufferAttribute(ptPos, 3));
const pointMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: { uScale: { value: 1 }, uOpacity: { value: 1 }, uHaze: { value: HAZE },
              uW: { value: -1 }, uNose: { value: new THREE.Vector3() }, uMaxD: { value: 1 }, uDim: { value: 1 } },
  vertexShader: `
    uniform float uScale, uHaze, uW, uMaxD; uniform vec3 uNose; varying float vFade;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      float dist = -mv.z;
      vec4 clip = projectionMatrix * mv;
      vec2 ndc = clip.xy / clip.w;
      // fade into the grey with distance
      vFade = exp(-max(dist - 2.5, 0.0) / uHaze);
      float d = length((position - uNose) * vec3(1.0, 1.0, 0.5)) / uMaxD;
      vFade *= 1.0 - smoothstep(0.30, 0.46, uW - d);        // gives way once the triangles have landed here
      gl_PointSize = clamp(12.0 * uScale / dist, 1.1, 5.0);
      gl_Position = clip;
    }`,
  fragmentShader: `
    uniform float uOpacity, uDim; varying float vFade;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      float a = smoothstep(0.5, 0.2, d) * vFade * uOpacity * uDim;
      if (a < 0.01) discard;
      gl_FragColor = vec4(0.93, 0.95, 0.98, a);
    }`
});
scene.add(new THREE.Points(ptGeo, pointMat));

/* ================= The head: three levels of triangles, revealed by one wave from the nose ================= */
const loader = new THREE.TextureLoader();
const [texSharp, texSoft, photoTex, orderTex, alphaTex] = await Promise.all(['texture.jpg', 'texture-soft.jpg', 'final.jpg', 'reveal.png', 'final-alpha.png'].map(u => loader.loadAsync(here(u))));
for (const tx of [texSharp, texSoft, photoTex, orderTex, alphaTex]) tx.colorSpace = THREE.NoColorSpace;   // colours pass straight through

// the nose, and the furthest distance from it, in the final camera's view
const NOSEW = toCameraView(Float32Array.from([NOSE.x, NOSE.y, NOSE.z]), 1);
const nose3 = new THREE.Vector3(NOSEW[0], NOSEW[1], NOSEW[2]);
const W2 = toCameraView(Float32Array.from(arr('w2')), arr('w2').length / 3);
let MAXD = 0, hcx = 0, hcy = 0, hcz = 0;
for (let i = 0; i < W2.length / 3; i++) {
  MAXD = Math.max(MAXD, Math.hypot(W2[i * 3] - nose3.x, W2[i * 3 + 1] - nose3.y, (W2[i * 3 + 2] - nose3.z) * 0.5));
  hcx += W2[i * 3]; hcy += W2[i * 3 + 1]; hcz += W2[i * 3 + 2];
}
const headCentre = new THREE.Vector3(hcx, hcy, hcz).divideScalar(W2.length / 3);
pointMat.uniforms.uNose.value.copy(nose3); pointMat.uniforms.uMaxD.value = MAXD;

let seedT = 11;
const rndT = () => (seedT = (seedT * 16807) % 2147483647) / 2147483647;
const STAGE_START = { 0: 0, 1: STAGE_GAP, 2: 2 * STAGE_GAP };
function levelMesh(level, mode) {
  const W = toCameraView(Float32Array.from(arr('w' + level)), arr('w' + level).length / 3);
  const UV = arr('uv' + level), F = arr('f' + level), nT = F.length / 3;
  const pos = new Float32Array(nT * 9), uv = new Float32Array(nT * 6), cuv = new Float32Array(nT * 6);
  const bary = new Float32Array(nT * 9), cen = new Float32Array(nT * 9), del = new Float32Array(nT * 3);
  const fly = new Float32Array(nT * 9), spin = new Float32Array(nT * 12);
  const c = new THREE.Vector3(), dir = new THREE.Vector3(), ax = new THREE.Vector3();
  for (let f = 0; f < nT; f++) {
    const id = [F[f * 3], F[f * 3 + 1], F[f * 3 + 2]];
    let cu = 0, cvv = 0; c.set(0, 0, 0);
    for (const v of id) { c.x += W[v * 3] / 3; c.y += W[v * 3 + 1] / 3; c.z += W[v * 3 + 2] / 3; cu += UV[v * 2] / 3; cvv += UV[v * 2 + 1] / 3; }
    const dl = Math.hypot(c.x - nose3.x, c.y - nose3.y, (c.z - nose3.z) * 0.5) / MAXD;
    // each coarse triangle flies in from outside the head, tumbling a little
    dir.subVectors(c, headCentre).normalize().multiplyScalar(FLY * (0.7 + 0.6 * rndT()));
    dir.z += FLY * 0.6;
    ax.set(rndT() - 0.5, rndT() - 0.5, rndT() - 0.5).normalize();
    const ang = (0.8 + rndT()) * Math.PI * (rndT() < 0.5 ? -1 : 1);
    for (let j = 0; j < 3; j++) {
      const v = id[j], o = f * 3 + j;
      pos[o * 3] = W[v * 3]; pos[o * 3 + 1] = W[v * 3 + 1]; pos[o * 3 + 2] = W[v * 3 + 2];
      uv[o * 2] = UV[v * 2]; uv[o * 2 + 1] = UV[v * 2 + 1];
      cuv[o * 2] = cu; cuv[o * 2 + 1] = cvv;
      bary[o * 3 + j] = 1;
      cen[o * 3] = c.x; cen[o * 3 + 1] = c.y; cen[o * 3 + 2] = c.z;
      del[o] = dl;
      fly[o * 3] = dir.x; fly[o * 3 + 1] = dir.y; fly[o * 3 + 2] = dir.z;
      spin[o * 4] = ax.x; spin[o * 4 + 1] = ax.y; spin[o * 4 + 2] = ax.z; spin[o * 4 + 3] = ang;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aCuv', new THREE.BufferAttribute(cuv, 2));
  g.setAttribute('aBary', new THREE.BufferAttribute(bary, 3));
  g.setAttribute('aCentre', new THREE.BufferAttribute(cen, 3));
  g.setAttribute('aDelay', new THREE.BufferAttribute(del, 1));
  g.setAttribute('aFly', new THREE.BufferAttribute(fly, 3));
  g.setAttribute('aSpin', new THREE.BufferAttribute(spin, 4));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: true, side: THREE.BackSide,
    polygonOffset: level > 0, polygonOffsetFactor: -level, polygonOffsetUnits: -4 * level,
    defines: { MODE: mode, FLYIN: level === 0 ? 1 : 0 },
    uniforms: { uW: { value: -1 }, uStart: { value: STAGE_START[level] }, uBand: { value: BAND }, uLand: { value: LAND },
                uNose: { value: nose3 }, uMaxD: { value: MAXD }, uEdges: { value: level === 0 ? 0.5 : 0.22 },
                uM: { value: new THREE.Matrix4() }, uRinv: { value: restInv }, uCamD: { value: CAM_D },
                uNeckTop: { value: NECK_TOP }, uNeckBottom: { value: NECK_BOTTOM },
                map: { value: mode === 0 ? texSoft : texSharp }, mapSoft: { value: texSoft }, alphaMap: { value: alphaTex } },
    vertexShader: `
      attribute vec3 aBary, aCentre, aFly; attribute vec4 aSpin; attribute vec2 aCuv; attribute float aDelay;
      uniform float uW, uStart, uLand, uCamD, uNeckTop, uNeckBottom; uniform mat4 uM, uRinv;
      varying vec3 vBary, vView, vPos; varying vec2 vUv, vCuv; varying float vLand;
      // the final-pose point, moved to where the head is now (the neck base stays put), as the wireframe is
      vec3 poseNow(vec3 q) {
        vec3 raw = vec3(q.xy / ((uCamD - q.z) / uCamD), q.z);            // undo the camera pre-warp
        vec4 s = uRinv * vec4(raw, 1.0);                                 // back to the measured head shape
        float h = 1.0 - smoothstep(0.0, 1.0, clamp((s.y - uNeckTop) / (uNeckBottom - uNeckTop), 0.0, 1.0));
        vec3 a = mix(raw, (uM * s).xyz, h);
        return vec3(a.xy * ((uCamD - a.z) / uCamD), a.z);                // pre-warp again
      }
      vec3 rotate(vec3 v, vec3 a, float t) { return v * cos(t) + cross(a, v) * sin(t) + a * dot(a, v) * (1.0 - cos(t)); }
      void main() {
        vec3 p = position;
        #if FLYIN
          // fly in and land: starts out beyond the head, tumbling and small, and settles exactly in place
          float g = clamp((uW - aDelay) / uLand, 0.0, 1.0);
          float k = 1.0 - pow(1.0 - g, 3.0);
          vec3 local = rotate(position - aCentre, aSpin.xyz, aSpin.w * (1.0 - k)) * mix(0.25, 1.0, k);
          p = aCentre + local + aFly * pow(1.0 - k, 2.0);
          vLand = g;
        #else
          vLand = 1.0;
        #endif
        vBary = aBary; vUv = uv; vCuv = aCuv; vPos = position;
        p = poseNow(p);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vView = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uW, uStart, uBand, uMaxD, uEdges; uniform vec3 uNose; uniform sampler2D map, mapSoft, alphaMap;
      varying vec3 vBary, vView, vPos; varying vec2 vUv, vCuv; varying float vLand;
      void main() {
        if (texture2D(alphaMap, vUv).r < 0.5) discard;                    // only inside the photo's outline
        float d = length((vPos - uNose) * vec3(1.0, 1.0, 0.5)) / uMaxD;   // this spot's distance from the nose
        #if FLYIN
          if (vLand <= 0.0) discard;
          float a = smoothstep(0.0, 0.35, vLand);
        #else
          float a = smoothstep(0.0, uBand, uW - uStart - d);                 // the wave has reached this spot
          if (a <= 0.0) discard;
        #endif
        #if MODE == 0
          vec3 nrm = normalize(cross(dFdx(vView), dFdy(vView)));
          float diff = max(dot(nrm, normalize(vec3(-0.35, 0.45, 0.82))), 0.0);
          vec3 col = texture2D(map, vCuv).rgb * (0.84 + 0.22 * diff);       // one colour per triangle
        #else
          float sharp = smoothstep(0.0, uBand * 1.6, uW - uStart - uBand * 0.4 - d);
          vec3 col = mix(texture2D(mapSoft, vUv).rgb, texture2D(map, vUv).rgb, sharp);
        #endif
        #if MODE == 0
          vec3 bd = fwidth(vBary);
          vec3 w3 = smoothstep(vec3(0.0), bd * 1.2, vBary);
          float edge = 1.0 - min(min(w3.x, w3.y), w3.z);
          col = mix(col, col * 0.6 + 0.4, edge * uEdges);
        #endif
        gl_FragColor = vec4(col, a);
      }`
  });
  const mesh = new THREE.Mesh(g, m); mesh.visible = false; scene.add(mesh);
  return mesh;
}
const L0 = levelMesh(0, 0), L1 = levelMesh(1, 0), L2 = levelMesh(2, 1);
L0.renderOrder = 1; L1.renderOrder = 2; L2.renderOrder = 3;
for (const L of [L1, L2]) L.material.depthFunc = THREE.LessEqualDepth;

/* The real photo arrives last, following the same wave, so the outer hair comes in at the end */
const photoMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, depthTest: false,
  uniforms: { map: { value: photoTex }, alphaMap: { value: alphaTex }, uBg: { value: new THREE.Vector3(...bgRGB) }, order: { value: orderTex }, uGrow: { value: HAIR_GROW }, uAspect: { value: ASPECT },
              uCentre: { value: new THREE.Vector2(headCentre.x, headCentre.y) },
              uW: { value: -1 }, uStart: { value: PHOTO_START }, uBand: { value: BAND },
              uNose: { value: nose3 }, uMaxD: { value: MAXD } },
  vertexShader: `varying vec3 vPos; varying vec2 vUv; void main(){ vUv = uv; vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D map, order, alphaMap; uniform vec3 uBg; uniform float uW, uStart, uBand, uMaxD, uGrow, uAspect; uniform vec3 uNose; uniform vec2 uCentre; varying vec3 vPos; varying vec2 vUv;
    void main(){
      // on the head: outwards from the nose; hair beyond the head: from where it leaves the head, roots first
      vec3 o = texture2D(order, vUv).rgb;
      vec2 root = vec2(o.r - 0.5, (o.g - 0.5) * uAspect);
      float dHead = length(root - uNose.xy) / uMaxD;
      // hair beyond the head sweeps round from about ten o'clock, both ways, roots slightly before tips
      vec2 dir = normalize(vPos.xy - uCentre + 1e-5);
      float ang = acos(clamp(dot(dir, vec2(-0.866, 0.5)), -1.0, 1.0)) / 3.14159;
      float dHair = 0.75 + ang * uGrow + o.b * 0.08;
      float d = mix(dHead, max(dHead, dHair), smoothstep(0.0, 0.06, o.b));
      float a = smoothstep(0.0, uBand, uW - uStart - d);
      if (a <= 0.0) discard;
      float pa = texture2D(alphaMap, vUv).r;
      gl_FragColor = vec4(texture2D(map, vUv).rgb + (uBg - vec3(100.0 / 255.0)) * (1.0 - pa), a);
    }`
});
const photo = new THREE.Mesh(new THREE.PlaneGeometry(1, ASPECT), photoMat);
photo.renderOrder = 10;
scene.add(photo);

/* ================= Mesh lines on the head ================= */
const SHAPE0 = arr('shape0'), N0 = meta.n0, E0 = arr('e0');
const nodePos = new Float32Array(N0 * 3), linePos = new Float32Array(E0.length * 3);
const lineGeo = new THREE.BufferGeometry(); lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
const lineMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: { uOpacity: { value: 0 }, uW: { value: -1 }, uNose: { value: nose3 }, uMaxD: { value: MAXD } },
  vertexShader: `uniform float uW, uMaxD; uniform vec3 uNose; varying float vA;
    void main(){ float d = length((position - uNose) * vec3(1.0, 1.0, 0.5)) / uMaxD;
      vA = 1.0 - smoothstep(0.30, 0.46, uW - d);      // stays until the triangle here has landed
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform float uOpacity; varying float vA; void main(){ gl_FragColor = vec4(0.94, 0.96, 0.99, uOpacity * vA); }`
});
const lines = new THREE.LineSegments(lineGeo, lineMat); lines.renderOrder = 0; scene.add(lines);
// an invisible solid copy of the coarse head, so lines and points on the far side are hidden
const occGeo = new THREE.BufferGeometry();
occGeo.setAttribute('position', new THREE.BufferAttribute(nodePos, 3));
occGeo.setIndex(Array.from(arr('f0')));
const occluder = new THREE.Mesh(occGeo, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, side: THREE.DoubleSide,
  polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 }));
occluder.renderOrder = -1; scene.add(occluder);

/* ================= Each moment ================= */
const ndc = new THREE.Vector3();
function frame(t) {
  pointPositions(t, ptPos);
  ptGeo.attributes.position.needsUpdate = true;

  // one wave, travelling outwards from the nose; every stage follows it a little behind the last
  const W = t < T_BUILD ? -1 : Math.min(SPEED * (t - T_BUILD), W_MAX);  // steady speed
  // the triangles follow the head's movement: this frame's pose against the final one
  frameMatrix(t >= T_MOVE ? (t - T_MOVE) * FPS / MOVE_SLOW : 0, poseNow);
  for (const L of [L0, L1, L2]) L.material.uniforms.uM.value.copy(poseNow);
  for (const L of [L0, L1, L2]) { L.visible = t >= T_BUILD; L.material.uniforms.uW.value = W; }
  photoMat.uniforms.uW.value = W;
  pointMat.uniforms.uW.value = W;
  // the mesh: lines appear as the head forms and follow its movement; the points fade back behind them
  const meshIn = smooth(ramp(t, T_ARRIVE - 1.4, 1.6));
  if (meshIn > 0) {
    posed(t >= T_MOVE ? (t - T_MOVE) * FPS / MOVE_SLOW : 0, nodePos, SHAPE0, N0);
    for (let j = 0; j < E0.length; j++) { const v = E0[j]; linePos[j * 3] = nodePos[v * 3]; linePos[j * 3 + 1] = nodePos[v * 3 + 1]; linePos[j * 3 + 2] = nodePos[v * 3 + 2]; }
    lineGeo.attributes.position.needsUpdate = true;
    occGeo.attributes.position.needsUpdate = true; occGeo.computeBoundingSphere();
  }
  lines.visible = meshIn > 0;
  occluder.visible = meshIn > 0.5 && W < 1.2;
  lineMat.uniforms.uOpacity.value = 0.5 * meshIn;
  lineMat.uniforms.uW.value = W;
  pointMat.uniforms.uDim.value = 1 - 0.6 * meshIn;
  renderer.render(scene, camera);
  // for testing: how many points are near or past the frame edge
  let out = 0;
  for (let i = 0; i < N; i += 5) {
    ndc.set(ptPos[i * 3], ptPos[i * 3 + 1], ptPos[i * 3 + 2]).project(camera);
    if (ndc.z < 1 && (Math.abs(ndc.x) > 0.94 || Math.abs(ndc.y) > 0.94)) out++;
  }
  window.__edge = out;
}

const section = document.querySelector('.face-section');
let tShown = -1;
function scrollTime() {
  const r = section.getBoundingClientRect(), travel = section.offsetHeight - stage.offsetHeight;   // the stage's height doesn't change when Safari's bars show or hide
  return clamp01(clamp01(-r.top / travel) / PLAY) * T_DONE;
}
function tick(now) {
  const target = scrollTime();
  const next = tShown < 0 ? target : tShown + (target - tShown) * 0.12;
  const seaMoving = next < T_ARRIVE;                                   // the waves keep moving while the sea shows
  if (seaMoving) waveClock = now / 1000;
  if (seaMoving || Math.abs(next - tShown) > 1e-4) { tShown = next; frame(tShown); }
  requestAnimationFrame(tick);
}
let fitW = 0, fitH = 0;                                             // only re-fit when the stage really changes size
addEventListener('resize', () => { if (winW() !== fitW || winH() !== fitH) { fitW = winW(); fitH = winH(); fit(); } });
fitW = winW(); fitH = winH(); fit();
if (window.ResizeObserver) { const ro = new ResizeObserver(() => fit()); if (wordsEl) ro.observe(wordsEl); }
window.__T_DONE = T_DONE; window.__frame = t => { tShown = t; frame(t); };
window.__times = { T_WHIRL, T_ARRIVE, T_MOVE, T_MOVED, T_BUILD, T_DONE };
if (frozen !== null) window.__frame(frozen); else requestAnimationFrame(tick);
