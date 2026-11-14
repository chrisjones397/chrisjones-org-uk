/* A painting brought forward over the grid (the gallery page's grid view). Clicking a painting in the grid shows it
   as large as the screen allows, over everything, the header included, with its title and details below, and
   puts its address, /gallery/<name>/, in the address bar (nothing reloads). Arrows (the keys, the symbols, or a
   swipe sideways) step to the painting before or after; the cross, Escape, a click beside the painting or Back
   send it back to the grid, scrolled to where that painting is. Opened at a painting's address in the grid view,
   the page starts with that painting brought forward.
   It's a <dialog> shown with showModal(): the browser's own way of putting something over the whole page, keeping
   the keyboard inside it and giving focus back afterwards. Nothing here runs in the floating view (gallery.js
   brings paintings forward there). */
(function () {
  const root = document.documentElement;
  const grid = document.querySelector('.gallery-page .wrapper');
  if (!grid || !window.HTMLDialogElement) return;
  const SITE = 'Christopher Jones - Fine Art';
  const PAGE_TITLE = document.title.startsWith('Gallery') ? document.title : `Gallery - ${SITE}`;
  const pathName = () => (location.pathname.match(/^\/gallery\/([a-z0-9-]+)\/$/) || [])[1] || null;
  const items = () => [...grid.querySelectorAll(':scope > div[id^="p-"]')];
  const floating = () => root.classList.contains('gallery-3d');

  const icon = (d) => `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" focusable="false" fill="none" `
    + `stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6"><path d="${d}"/></svg>`;
  const box = document.createElement('dialog');
  box.className = 'focus';
  box.setAttribute('aria-label', 'Painting');
  box.innerHTML = `
    <figure class="focus-stage">
      <img class="focus-img" alt="" decoding="async">
      <figcaption class="focus-caption"><p class="t"></p><p class="d"></p></figcaption>
    </figure>
    <button type="button" class="nav-link nav-icon focus-close" title="Back to the gallery" aria-label="Back to the gallery">${icon('M6 6l12 12M18 6L6 18')}</button>
    <button type="button" class="nav-link nav-icon focus-prev" title="The painting before" aria-label="The painting before">${icon('M15 5l-7 7 7 7')}</button>
    <button type="button" class="nav-link nav-icon focus-next" title="The painting after" aria-label="The painting after">${icon('M9 5l7 7-7 7')}</button>`;
  document.body.append(box);
  const img = box.querySelector('.focus-img');
  const title = box.querySelector('.focus-caption .t');
  const details = box.querySelector('.focus-caption .d');
  let current = null, pushed = false;

  // The painting, from its square in the grid. Its size on screen is set here, from its proportions and the room
  // the styles leave, so nothing moves while its file arrives. The file is fetched at that size (the grid's set of
  // sizes) and swapped in only once it's ready; until then the grid's own copy stands in, if it has one. The
  // paintings either side are fetched too, so stepping with the arrows is usually instant.
  const ready = new Map();                          // painting's id -> its picture, fetched (or on its way)
  function size(item) {
    const from = item.querySelector('img');
    const w = +from.getAttribute('width') || 1, h = +from.getAttribute('height') || 1;
    const stage = box.querySelector('.focus-stage'), cs = getComputedStyle(stage);
    const roomW = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const roomH = parseFloat(getComputedStyle(img).maxHeight) || innerHeight - 120;
    const k = Math.min(roomW / w, roomH / h);
    return { w: Math.floor(w * k), h: Math.floor(h * k) };
  }
  function fetchFor(item, at) {
    const from = item.querySelector('img');
    let got = ready.get(item.id);
    if (!got || got.width < at.w) {               // a larger size than fetched before (the window grew): fetch again
      const pic = new Image();
      pic.sizes = `${at.w}px`;
      pic.srcset = from.getAttribute('srcset') || '';
      pic.src = from.getAttribute('src');
      got = { width: at.w, pic, done: pic.decode().then(() => pic.currentSrc || pic.src, () => null) };
      ready.set(item.id, got);
    }
    return got.done;
  }
  function show(item) {
    current = item;
    const from = item.querySelector('img');
    const ps = item.querySelectorAll(':scope > p');
    title.textContent = ps[0] ? ps[0].textContent : '';
    details.textContent = ps[1] ? ps[1].textContent : '';
    img.alt = from.alt;
    const at = size(item);
    img.style.width = `${at.w}px`; img.style.height = `${at.h}px`;
    let swapped = false;
    fetchFor(item, at).then((url) => { if (url && current === item) { swapped = true; img.src = url; } });
    // not already here: the grid's copy at once (blurred a moment, but the right size), or nothing until it arrives
    queueMicrotask(() => {
      if (swapped || current !== item) return;
      if (from.complete && from.naturalWidth) img.src = from.currentSrc || from.src;
      else img.removeAttribute('src');
    });
    const list = items(), i = list.indexOf(item);
    box.querySelector('.focus-prev').hidden = i <= 0;
    box.querySelector('.focus-next').hidden = i >= list.length - 1;
    for (const n of [list[i + 1], list[i - 1]]) if (n) fetchFor(n, size(n));
    document.title = `${title.textContent} - ${SITE}`;
  }
  addEventListener('resize', () => { if (box.open && current) show(current); });
  const address = (item) => `/gallery/${item.id.slice(2)}/`;

  function open(item, how) {          // how: 'push' (clicked), 'replace' (stepping), or nothing (from the address)
    if (!item) return;
    if (!box.open) { box.showModal(); box.classList.add('on'); }
    show(item);
    if (how === 'push') { history.pushState({ focus: item.id }, '', address(item)); pushed = true; }
    else if (how === 'replace') history.replaceState(history.state, '', address(item));
  }
  function step(by) {
    const list = items(), at = list.indexOf(current) + by;
    if (current && at >= 0 && at < list.length) open(list[at], 'replace');
  }
  // Sending it back: the grid is left where that painting is, and the address goes back to the gallery's
  function shut() {
    if (!box.open) return;
    box.classList.remove('on');
    box.close();
  }
  box.addEventListener('close', () => {
    const was = current;
    current = null;
    document.title = PAGE_TITLE;
    if (pathName()) {
      if (pushed) { pushed = false; history.back(); }
      else history.replaceState(null, '', '/gallery/');
    }
    if (was) {
      const r = was.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) was.scrollIntoView({ block: 'center', behavior: 'instant' });
      const link = was.querySelector('a');
      if (link) link.focus({ preventScroll: true });
    }
  });

  grid.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a || floating() || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;   // new tabs as usual
    const item = a.closest('div[id^="p-"]');
    if (!item) return;
    e.preventDefault();
    open(item, 'push');
  });
  box.querySelector('.focus-close').addEventListener('click', shut);
  box.querySelector('.focus-prev').addEventListener('click', () => step(-1));
  box.querySelector('.focus-next').addEventListener('click', () => step(1));
  box.addEventListener('click', (e) => { if (e.target === box || e.target.classList.contains('focus-stage')) shut(); });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  });
  // A swipe sideways steps (one finger, mostly sideways); two fingers are left to zoom
  let sx = null, sy = 0;
  box.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; } else sx = null;
  }, { passive: true });
  box.addEventListener('touchend', (e) => {
    if (sx === null || e.changedTouches.length !== 1) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    sx = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > 1.5 * Math.abs(dy)) step(dx < 0 ? 1 : -1);
  });

  // Back and Forward, and opening at a painting's address, in the grid view
  function follow() {
    if (floating()) { if (box.open) shut(); return; }
    const name = pathName();
    const item = name && document.getElementById(`p-${name}`);
    if (item) {
      if (!box.open) item.scrollIntoView({ block: 'center', behavior: 'instant' });
      pushed = false;
      open(item);
    } else if (box.open) { pushed = false; shut(); }
  }
  addEventListener('popstate', follow);
  addEventListener('gallery-view', follow);       // the floating view gave way to the grid, or the switch was used
  follow();
})();
