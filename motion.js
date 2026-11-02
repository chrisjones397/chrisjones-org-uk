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

/* Parallax: the opening picture, and the contact section's picture, move more slowly than the page as you
   scroll, as if they were further away. Nothing moves for visitors who have asked their device to reduce motion. */
(function () {
  const PARALLAX = 0.4;     // 0: scrolls with the page; 1: stays still in the window
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const items = [...document.querySelectorAll('.hero, .parallax')]
    .map((sec) => ({ sec, pic: sec.querySelector(':scope > video, :scope > img, :scope > picture') }))
    .filter((i) => i.pic);
  if (!items.length) return;
  let queued = false;
  function update() {
    queued = false;
    for (const { sec, pic } of items) {
      const r = sec.getBoundingClientRect();
      if (r.bottom < -50 || r.top > innerHeight + 50) continue;   // off screen: nothing to see
      pic.style.transform = `translate3d(0, ${(-r.top * PARALLAX).toFixed(1)}px, 0)`;
    }
  }
  addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
  addEventListener('resize', update);
  update();
})();

/* Snapping: the full-window sections settle into place. Where you stop scrolling between the opening picture
   and the start of the profile, the page carries on in the direction you were scrolling (so one notch of a
   mouse wheel is enough to move on, and one back returns); likewise between the finished profile and the
   contact section. A tiny movement just settles back. Inside the profile animation (where scrolling is what turns the head and brings in
   the words) nothing snaps, so you can stop anywhere in it. Nothing snaps for visitors who have asked their
   device to reduce motion. */
(function () {
  const DURATION = 700;                         // milliseconds for the page to settle
  const ease = (t) => 1 - Math.pow(1 - t, 4);   // quick to start, gentle to finish
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const hero = document.querySelector('.hero'), face = document.querySelector('.face-section');
  const contact = document.getElementById('contact');
  if (!hero || !face || !contact) return;

  const top = (el) => el.getBoundingClientRect().top + scrollY;
  const NUDGE = 24;                              // pixels: less than this from where you started just settles back
  let restY = scrollY;                           // where the page last came to rest
  // where to go from y, or null to stay put
  function snapFor(y) {
    const faceStart = top(face);                                   // the profile animation's first moment
    const faceEnd = faceStart + face.offsetHeight - innerHeight;   // ...and its last (the finished head and words)
    const contactTop = top(contact);
    const moved = y - restY;
    const between = (a, b) => {
      if (!(y > a + 1 && y < b - 1)) return null;
      if (moved > NUDGE) return b;                                 // scrolling down: on to the next
      if (moved < -NUDGE) return a;                                // scrolling up: back to the previous
      return y - a < (b - a) / 2 ? a : b;                          // barely moved: whichever is nearer
    };
    if (y < faceStart) return between(0, faceStart);
    if (y > faceEnd && y < contactTop) return between(faceEnd, contactTop);
    return null;                                                   // inside the animation, or below the contact
  }

  let animating = null, touching = false, timer = 0;
  function settleTo(target) {
    const from = scrollY, t0 = performance.now();
    const run = (now) => {
      if (animating !== run) return;                               // cancelled by the visitor
      const k = Math.min((now - t0) / DURATION, 1);
      scrollTo({ top: from + (target - from) * ease(k), behavior: 'instant' });
      if (k < 1) requestAnimationFrame(run); else { animating = null; restY = target; }
    };
    animating = run;
    requestAnimationFrame(run);
  }
  function stopped() {
    if (animating || touching) return;
    const target = snapFor(scrollY);
    if (target !== null && Math.abs(target - scrollY) > 2) settleTo(target);
    else restY = scrollY;
  }
  // any new input from the visitor takes over at once
  const cancel = () => { animating = null; };
  addEventListener('wheel', cancel, { passive: true });
  addEventListener('keydown', cancel);
  addEventListener('touchstart', () => { touching = true; cancel(); }, { passive: true });
  addEventListener('touchend', () => { touching = false; clearTimeout(timer); timer = setTimeout(stopped, 180); }, { passive: true });
  // "scrolling has stopped": the browser's scrollend where it has one, otherwise a short pause in scrolling
  if ('onscrollend' in window) addEventListener('scrollend', () => { clearTimeout(timer); timer = setTimeout(stopped, 60); });
  else addEventListener('scroll', () => { if (!animating) { clearTimeout(timer); timer = setTimeout(stopped, 180); } }, { passive: true });
})();
