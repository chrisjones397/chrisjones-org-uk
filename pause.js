/* The pause control (WCAG 2.2.2, Pause, Stop, Hide): the header's pause button (templates/header.html) stills
   everything that moves by itself, the background videos, the gallery's drift and the profile's sea, and also
   the scroll-linked movement, the parallax and the drifting and rising text, so the page simply scrolls.
   The choice is remembered across the site and on later visits (localStorage), and applies from the first
   moment of the next page, since this runs in the <head> before anything starts.

   The button is always in the header, on every page, as it's a setting for the whole site (14 Nov 2026: it
   used to show only while something moved, which made the header's symbols shift). It's lit while something on
   the page moves by itself, dimmed otherwise: each such thing tells this script with pauser.moving(name, true or
   false) (a video that has played once and stopped no longer moves).

   For the other scripts:
     pauser.paused          true while paused
     pauser.watch(fn)       fn(paused) whenever it changes
     pauser.moving(name, on)
*/
(function () {
  const KEY = 'paused';
  let paused = false;
  try { paused = localStorage.getItem(KEY) === '1'; } catch (e) { /* storage blocked: start playing */ }
  const watchers = [], movers = new Set();
  const root = document.documentElement;
  root.classList.toggle('paused', paused);

  let button = null;
  function show() {
    if (!button) button = document.getElementById('pause-motion');
    if (!button) return;
    button.classList.toggle('still', !movers.size);      // nothing moving here just now: dimmed, still works
    button.setAttribute('aria-pressed', String(paused));
    const label = paused ? 'Play moving pictures' : 'Pause moving pictures';
    button.setAttribute('aria-label', label);
    button.title = label;
  }
  function set(p) {
    if (p === paused) return;
    paused = p;
    try { if (p) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch (e) { /* not remembered */ }
    root.classList.toggle('paused', p);
    show();
    for (const fn of watchers) { try { fn(p); } catch (e) { console.error(e); } }
  }
  window.pauser = {
    get paused() { return paused; },
    watch(fn) { watchers.push(fn); },
    moving(name, on) { if (on) movers.add(name); else movers.delete(name); show(); },
  };
  // the header arrives with the page (worker.js puts it in), after this script: wire the button once it's there
  function wire() {
    show();
    if (button) button.addEventListener('click', () => set(!paused));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
  // paused in another tab of the site: follow it here too
  addEventListener('storage', (e) => { if (e.key === KEY) set(e.newValue === '1'); });
})();
