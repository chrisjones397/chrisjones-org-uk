/* Background videos (a section's video, put in by site.js bgTag). Loaded in the page's <head>, so it's ready when each video arrives: a one-line script right
   after each <video> calls bgVideo(video) at once, before the browser starts fetching it in earnest.

   - The browser takes the first <source> whose media query matches (portrait versions for screens held upright,
     then by the pixels the screen shows across). The poster (shown while it loads) becomes that version's own
     first frame, so a phone held upright never flashes a landscape picture.
   - Visitors who have asked their device to reduce motion, or (Chrome, Edge, Android) to save data, never get the
     video: they get its last frame, or a slow fade from the first frame to the last (the section's choice, calm).
   - Otherwise it plays, muted (as browsers require for playing by itself), once (stopping on its last frame) or
     on a loop.
   - The header's pause button (pause.js) pauses it where it is, and plays it on from there. A page opened while
     paused shows its last frame, the picture it would come to rest on, until play is pressed; it then plays
     from the start. A video counts as moving (so the button shows) until it has played once and stopped. */
(function () {
  function calm() {
    return matchMedia('(prefers-reduced-motion: reduce)').matches || !!(navigator.connection && navigator.connection.saveData);
  }
  function chosen(v) {
    for (const s of v.querySelectorAll('source')) if (!s.media || matchMedia(s.media).matches) return s;
    return null;
  }
  function still(v, url, set) {
    const img = document.createElement('img');
    img.className = 'section-bg';
    img.alt = '';
    img.style.cssText = v.style.cssText;
    if (set) { img.sizes = '100vw'; img.srcset = set; }
    img.src = url;
    return img;
  }
  let count = 0;
  window.bgVideo = function (v) {
    if (!v || v.tagName !== 'VIDEO') return;
    const s = chosen(v);
    if (s && s.dataset.first) v.poster = s.dataset.first;
    if (calm()) {
      v.removeAttribute('autoplay');
      v.preload = 'none';
      const last = s && still(v, s.dataset.last, s.dataset.lastSet);
      if (s && v.dataset.calm === 'fade') {
        const first = still(v, s.dataset.first, s.dataset.firstSet);
        last.classList.add('bg-fade');
        v.replaceWith(first);
        first.after(last);
        const show = () => requestAnimationFrame(() => last.classList.add('in'));
        Promise.all([first.decode(), last.decode()]).then(() => setTimeout(show, 600), show);
      } else if (last) {
        v.replaceWith(last);
      }
      return;
    }
    v.loop = v.dataset.play === 'loop';
    const p = window.pauser, name = 'video ' + (++count);
    if (p) {
      p.moving(name, true);
      v.addEventListener('ended', () => p.moving(name, false));
      p.watch((paused) => {
        if (paused) v.pause();
        else if (!v.ended) { if (s && s.dataset.first) v.poster = s.dataset.first; v.play().catch(() => {}); }
      });
    }
    if (p && p.paused) {
      v.removeAttribute('autoplay');
      v.preload = 'metadata';
      if (s && s.dataset.last) v.poster = s.dataset.last;
    } else {
      v.preload = 'auto';
      v.autoplay = true;
      v.play().catch(() => {});    // muted, so allowed; if a browser refuses, the poster stays
    }
    /* Firefox on iPhone switches the player's controls on by itself as the video starts; switch them straight
       back off whenever that happens */
    const noControls = () => { if (v.controls || v.hasAttribute('controls')) { v.controls = false; v.removeAttribute('controls'); } };
    noControls();
    new MutationObserver(noControls).observe(v, { attributes: true, attributeFilter: ['controls'] });
    ['loadedmetadata', 'canplay', 'play', 'playing'].forEach((e) => v.addEventListener(e, noControls));
  };
})();
