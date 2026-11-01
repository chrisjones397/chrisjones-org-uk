/* Eased text: the opening title drifts down a little as you scroll, and the profile text rises and
   fades into its place as its section arrives, the heading first and each paragraph a beat later.
   Each follows the scroll a moment late and settles with a slight spring. Nothing moves for
   visitors who have asked their device to reduce motion. */
(function () {
  const DELAY = 0.15;       // seconds the text waits before following the scroll (wide screens)
  const DELAY_TALL = 0.08;  // the same on phones, where scrolling is quicker
  const STAGGER = 0.12;     // extra wait for each following piece of profile text
  const STIFFNESS = 120;    // higher: springier and quicker
  const DAMPING = 14;       // lower: more overshoot (22 would be none at all)
  const TITLE_DRIFT = 0.30; // how far the title drifts, as a fraction of the picture's height scrolled past
  const TITLE_DRIFT_TALL = 0.55;
  const RISE = 0.35;        // the profile text starts this fraction of its section's distance below its place
  const FADE = 0.22;        // ...and is fully visible once it is within this fraction of the window height

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  // the window height, ignoring the changes when a phone's browser bars show or hide during scrolling
  let VW = innerWidth, VH = innerHeight;
  addEventListener('resize', () => { if (innerWidth !== VW) { VW = innerWidth; VH = innerHeight; } });
  const isTall = () => VW < VH;

  const pieces = [];
  const title = document.querySelector('.hero-title'), hero = document.querySelector('.hero');
  if (title && hero) pieces.push({ el: title, wait: 0, fade: false,
    target: () => (isTall() ? TITLE_DRIFT_TALL : TITLE_DRIFT) * Math.max(-hero.getBoundingClientRect().top, 0) });
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
  for (const p of pieces) { p.x = p.target(); p.v = 0; show(p); }
  let last = 0, running = false;

  function step(ms) {
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
    if (!running) { running = true; last = performance.now() / 1000; requestAnimationFrame(step); }
  }
  addEventListener('scroll', wake, { passive: true });
  addEventListener('resize', wake);
  wake();
})();
