/* Phones: the header starts full size, then slims down to the logo bar once you scroll down,
   and opens out again as soon as you scroll back up (or reach the top). Phones held sideways (short windows):
   the header slides right out of the way instead (site.css), as every pixel of height counts there.
   Computers are unaffected. */
(function () {
  const header = document.querySelector('.header');
  if (!header) return;
  const phone = matchMedia('(max-width: 720px), (orientation: landscape) and (max-height: 540px)');
  const TOP = 40;      // within this many pixels of the top, the header is always full size
  const UP = 12;       // scrolling up by this much opens it again

  // tell other scripts (the profile animation) how tall the slim header is, so the head can be framed below it
  function measure() {
    if (!phone.matches) { delete header.dataset.compactHeight; return; }
    const was = header.classList.contains('compact');
    header.classList.add('compact', 'no-anim');
    header.dataset.compactHeight = header.offsetHeight;
    if (!was) header.classList.remove('compact');
    void header.offsetHeight;                       // apply the change before switching animation back on
    header.classList.remove('no-anim');
  }
  let lastY = scrollY, queued = false;
  function update() {
    queued = false;
    // ignore the bounce past the top or bottom of the page (iPhone), which would look like scrolling back
    const y = Math.min(Math.max(scrollY, 0), Math.max(document.documentElement.scrollHeight - innerHeight, 0));
    if (!phone.matches || y < TOP) header.classList.remove('compact');
    else if (y > lastY) header.classList.add('compact');
    else if (y < lastY - UP) header.classList.remove('compact');
    else return;                                     // small upward wobble: keep the last position for comparison
    lastY = y;
  }
  addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
  phone.addEventListener('change', () => { measure(); update(); });
  measure(); update();
})();

/* The gallery's view switch (in the header partial): two symbols just under the header, right-aligned under the
   menu's last symbol, measured here (--switch-right) so they line up on every layout, the stacked phone header
   included. They follow the header as it slims, being inside it.
   - Gallery page: always shown, the current view lit; choosing one switches in place (html class gallery-3d, set
     first by the page's head script) and is remembered in this browser.
   - Home page: shown while the gallery section is in view, leading to the whole gallery in either view.
   Hidden where there's no floating view to choose (class no-float: no WebGL, or reduced motion asked for). */
(function () {
  const header = document.querySelector('.header');
  const sw = header && header.querySelector('.view-switch');
  const nav = header && header.querySelector('.nav-list');
  if (!sw || !nav) return;
  const root = document.documentElement;
  const place = () => header.style.setProperty('--switch-right', `${header.getBoundingClientRect().right - nav.getBoundingClientRect().right}px`);
  place();
  addEventListener('resize', place);
  addEventListener('load', place);
  if (window.ResizeObserver) {          // icons appearing (the pause button), or the scrollbar arriving, move it
    const ro = new ResizeObserver(place);
    ro.observe(nav); ro.observe(header);
  }
  const gallery = document.querySelector('.gallery-page');
  const home = document.getElementById('gallery');
  const lit = () => {
    const now = root.classList.contains('gallery-3d') ? 'floating' : 'grid';
    for (const a of sw.querySelectorAll('a')) {
      if (a.dataset.view === now) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
  };
  const show = (on) => { sw.hidden = !on || root.classList.contains('no-float'); };
  if (gallery) {
    lit(); show(true);
    sw.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-view]');
      if (!a) return;
      e.preventDefault();
      const floating = a.dataset.view === 'floating';
      if (floating === root.classList.contains('gallery-3d')) return;
      try { localStorage.setItem('gallery-view', a.dataset.view); } catch (err) { /* not kept: fine */ }
      root.classList.toggle('gallery-3d', floating);
      if (/^\/gallery\/[a-z0-9-]+\/$/.test(location.pathname)) history.replaceState(null, '', '/gallery/');
      scrollTo({ top: 0, behavior: 'instant' });
      lit();
      dispatchEvent(new CustomEvent('gallery-view'));
    });
    addEventListener('gallery-view', () => { lit(); show(true); });
  }
  if (!gallery && home && window.IntersectionObserver) {
    new IntersectionObserver(([en]) => show(en.isIntersecting), { rootMargin: '-40% 0px -40% 0px' }).observe(home);   // across the window's middle
  }
})();
