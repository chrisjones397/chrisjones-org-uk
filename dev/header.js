/* Phones: the header starts full size, then slims down to the logo bar once you scroll down,
   and opens out again as soon as you scroll back up (or reach the top). Computers are unaffected. */
(function () {
  const header = document.querySelector('.header');
  if (!header) return;
  const phone = matchMedia('(max-width: 720px)');
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
    const y = scrollY;
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
