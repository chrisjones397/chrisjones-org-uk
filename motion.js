/* Eased text: the opening title drifts down a little as you scroll, and the Gallery heading, its mirror image
   across the line between the two sections, drifts up the same amount; and the profile text rises and
   fades into its place as its section arrives, the heading first and each paragraph a beat later.
   Each follows the scroll a moment late and settles with a slight spring. Nothing moves for
   visitors who have asked their device to reduce motion, nor while the header's pause button is on (pause.js):
   the text then sits in its place and scrolls with the page. */
(function () {
  const DELAY = 0.15;       // seconds the text waits before following the scroll (wide screens)
  const DELAY_TALL = 0.08;  // the same on phones, where scrolling is quicker
  const STAGGER = 0.12;     // extra wait for each following piece of profile text
  const STIFFNESS = 120;    // higher: springier and quicker
  const DAMPING = 14;       // lower: more overshoot (22 would be none at all)
  const TITLE_DRIFT = 0.18; // how far the title drifts, as a fraction of the picture's height scrolled past:
                            // at most 18% of the window, so it stays inside its section (it sits 22% up)
  const RISE = 0.35;        // the profile text starts this fraction of its section's distance below its place
  const FADE = 0.22;        // ...and is fully visible once it is within this fraction of the window height

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  // the window height, ignoring the changes when a phone's browser bars show or hide during scrolling
  let VW = innerWidth, VH = innerHeight;
  addEventListener('resize', () => { if (innerWidth !== VW) { VW = innerWidth; VH = innerHeight; } });
  const isTall = () => VW < VH;

  const pieces = [];
  const title = document.querySelector('.hero-words') || document.querySelector('.hero-title'), hero = document.querySelector('.hero');   // the title with any paragraphs under it
  if (title && hero) pieces.push({ el: title, wait: 0, fade: false,
    target: () => TITLE_DRIFT * Math.max(-hero.getBoundingClientRect().top, 0) });
  const heading = document.querySelector('.gallery-3d .invite-title'), gallery = document.querySelector('.invite');
  const header = document.querySelector('.header');
  if (heading && gallery) pieces.push({ el: heading, wait: 0, fade: false,
    // in its place while the gallery is still below the window; as the line between the sections rises to the
    // top of the window, the heading rises towards it, just as the opening title sinks towards it. It comes
    // to rest as far below the header as the title ends above the bottom of the window (the header covers the
    // top of the window, where nothing covers the bottom), so it rises less by the header's height.
    target: () => {
      const s = VH - Math.min(Math.max(gallery.getBoundingClientRect().top, 0), VH);
      return (header ? header.offsetHeight / VH : 0) * s - TITLE_DRIFT * s;
    } });
  const stage = document.querySelector('.face-stage'), words = document.querySelector('.face-words');
  if (stage && words) [...words.children].forEach((el, i) => pieces.push({ el, wait: STAGGER * i, fade: true,
    target: () => RISE * Math.max(stage.getBoundingClientRect().top, 0) }));
  if (!pieces.length) return;

  const history = [];                      // recent [time, targets], so each piece can follow late
  const maxWait = () => (isTall() ? DELAY_TALL : DELAY) + STAGGER * pieces.length;
  function lateTargets(now) {
    history.push([now, pieces.map(p => p.target())]);
    while (history.length > 2 && history[1][0] <= now - maxWait()) history.shift();
    const base = isTall() ? DELAY_TALL : DELAY;
    return pieces.map((p, i) => {
      const when = now - base - p.wait;
      let k = history.length - 1;
      while (k > 0 && history[k][0] > when) k--;
      return history[k][1][i];
    });
  }
  function show(p) {
    p.el.style.translate = `0 ${p.x.toFixed(2)}px`;
    if (p.fade) p.el.style.opacity = Math.min(Math.max(1 - p.x / (FADE * VH), 0), 1).toFixed(3);
  }
  const still = () => window.pauser && pauser.paused;
  // in its place at once: paused (nothing moves), or just played again (jump to where it should be, no spring)
  function place() { history.length = 0; for (const p of pieces) { p.x = still() ? 0 : p.target(); p.v = 0; show(p); } }
  place();
  let last = 0, running = false;

  function step(ms) {
    if (still()) { running = false; return; }
    const now = ms / 1000, dt = Math.min(now - last, 1 / 30); last = now;
    const goal = lateTargets(now);
    let busy = false;
    pieces.forEach((p, i) => {
      const a = -STIFFNESS * (p.x - goal[i]) - DAMPING * p.v;   // a spring pulling towards where it should be
      p.v += a * dt; p.x += p.v * dt;
      if (Math.abs(p.x - goal[i]) > 0.1 || Math.abs(p.v) > 0.1 || Math.abs(p.target() - goal[i]) > 0.1) busy = true;
      show(p);
    });
    if (busy) requestAnimationFrame(step); else running = false;
  }
  function wake() {
    if (still()) return;
    if (!running) { running = true; last = performance.now() / 1000; requestAnimationFrame(step); }
  }
  addEventListener('scroll', wake, { passive: true });
  addEventListener('resize', wake);
  if (window.pauser) pauser.watch(() => { place(); wake(); });
  wake();
})();

/* Parallax: the sections' backgrounds (the opening's, the contact section's: .section-bg) move more slowly than the page as you
   scroll, as if they were further away. Nothing moves for visitors who have asked their device to reduce motion,
   nor while the header's pause button is on (pause.js). */
(function () {
  const PARALLAX = 0.4;     // 0: scrolls with the page; 1: stays still in the window
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const items = [...document.querySelectorAll('.hero, .parallax')]
    .map((sec) => ({ sec, pics: [...sec.querySelectorAll(':scope > .section-bg')] }))
    .filter((i) => i.pics.length);
  let queued = false;
  function update() {
    queued = false;
    for (const { sec, pics } of items) {
      const r = sec.getBoundingClientRect();
      if (r.bottom < -50 || r.top > innerHeight + 50) continue;   // off screen: nothing to see
      for (const pic of pics) pic.style.transform = `translate3d(0, ${(-r.top * PARALLAX).toFixed(1)}px, 0)`;
    }
  }
  // The gallery invitation's paintings each drift at their own pace, as if hung at different depths.
  const DEPTHS = [0.25, -0.18, 0.12, 0.35, -0.08];
  const wall = document.querySelector('.invite');
  const hung = wall ? [...wall.querySelectorAll('.invite-pic')] : [];
  function updateWall() {
    const r = wall.getBoundingClientRect();
    if (r.bottom < -50 || r.top > innerHeight + 50) return;
    hung.forEach((el, k) => { el.style.transform = `translate3d(0, ${(-r.top * DEPTHS[k % DEPTHS.length]).toFixed(1)}px, 0)`; });
  }
  const still = () => window.pauser && pauser.paused;
  const all = () => { if (still()) return; update(); if (hung.length) updateWall(); };
  if (window.pauser) pauser.watch((paused) => {
    if (!paused) { all(); return; }
    for (const { pics } of items) for (const pic of pics) pic.style.transform = '';
    for (const el of hung) el.style.transform = '';
  });
  addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(all); } }, { passive: true });
  addEventListener('resize', all);
  all();
})();

/* Snapping, with the visitor rather than against them. Once a scroll comes to rest, the page may glide on to
   the next resting place in the direction it was going: never back the other way. The resting places are the
   top of each full-window section (the opening, contact). The gallery and the profile are taller than the
   window: going down, the page settles at their start, going up at their end, and within them scrolling is
   free, so they're never taken over, and leaving them is never pulled back.
   It only glides on once the visitor has scrolled at least 15% of the window into the next section (that much
   of it is showing); short of that, the page stays where it was left.
   Any wheel, touch or key during a glide hands control straight back to the visitor. */
(function () {
  const sections = [...document.querySelectorAll('.hero, .invite, .contact, .face-section')];
  if (!sections.length) return;
  const REST = 100;          // milliseconds without scrolling before the page counts as at rest
  const INTO = 0.15;         // how far into the next section (a fraction of the window) before it glides on
  const MIN = 0.45, MAX = 1.1;   // glide time in seconds, for the shortest and a full window's distance
  const instant = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const top = (el) => el.getBoundingClientRect().top + scrollY;
  let lastY = scrollY, restY = scrollY, dir = 0, timer = 0, gliding = 0, active = false, touching = false;

  function target(y, d) {
    const end = document.documentElement.scrollHeight - innerHeight;
    const stops = [], free = [];          // stops: [position, which way it's arrived at (0: either)]
    for (const el of sections) {
      const t = Math.min(top(el), end);
      if (el.offsetHeight > innerHeight * 1.5) {
        const e = Math.min(t + el.offsetHeight - innerHeight, end);
        stops.push([t, 1], [e, -1]); free.push([t, e]);
      } else stops.push([t, 0]);
    }
    if (stops.some(([p]) => Math.abs(p - y) < 2)) return null;       // already in place
    if (free.some(([t, e]) => y >= t && y <= e)) return null;     // in the profile: free
    const ahead = stops.filter(([p]) => (d > 0 ? p > y : p < y)).sort((a, b) => d * (a[0] - b[0]));
    if (!ahead.length) return null;
    const [p, way] = ahead[0];
    if (Math.abs(p - y) > (1 - INTO) * innerHeight) return null;    // not yet far enough into it
    return !way || way === d ? p : null;
  }
  // Eases in and out (smootherstep), so the glide starts and lands gently rather than all at once.
  const ease = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  function glide(to) {
    const from = scrollY, dist = to - from;
    if (Math.abs(dist) < 2) return;
    if (instant) { scrollTo({ top: to, behavior: 'instant' }); return; }
    const dur = 1000 * (MIN + (MAX - MIN) * Math.min(1, Math.abs(dist) / innerHeight));
    const t0 = performance.now(), id = ++gliding;
    active = true;
    (function step(now) {
      if (id !== gliding) return;                  // the visitor took over (stop() has cleared active)
      const t = Math.min(1, (now - t0) / dur);
      scrollTo({ top: from + dist * ease(t), behavior: 'instant' });
      lastY = scrollY;
      if (t < 1) requestAnimationFrame(step); else { gliding++; active = false; restY = scrollY; }
    })(t0);
  }
  function stop() { if (active) restY = scrollY; gliding++; active = false; }                   // ends any glide in progress
  // the page putting itself somewhere (coming back to it) isn't the visitor scrolling: settle there, no glide
  window.snapHere = () => { stop(); clearTimeout(timer); lastY = restY = scrollY; dir = 0; };
  function settle() {
    if (touching || active || !dir) return;
    const to = target(scrollY, dir);
    if (to !== null) glide(to); else restY = scrollY;
  }
  addEventListener('scroll', () => {
    const y = scrollY;
    if (y !== lastY) { dir = Math.sign(y - lastY); lastY = y; }
    clearTimeout(timer); timer = setTimeout(settle, REST);
  }, { passive: true });
  for (const ev of ['wheel', 'keydown', 'mousedown']) addEventListener(ev, stop, { passive: true });
  addEventListener('touchstart', () => { touching = true; stop(); }, { passive: true });
  addEventListener('touchend', () => { touching = false; clearTimeout(timer); timer = setTimeout(settle, REST); }, { passive: true });
  addEventListener('touchcancel', () => { touching = false; }, { passive: true });
})();
