/* Drawing the page. The editor has one view at a time, named by the address's # (gallery, content, library,
   review, history, and darkroom/<item code>/<recipe>, which is opened from the Library and the Gallery rather
   than the header); render() draws it afresh from the state after anything changes. The views register
   themselves in `views` (editor.js does it), so this module needn't know them. */

import { $ } from './dom.js';
import { state, changed } from './state.js';
import { placeMarks } from './marks.js';

export const views = {};            // name -> a function giving that view's elements

export function view() { return (location.hash.slice(1).split('/')[0] || 'gallery'); }
/* What follows the view's name in the address (darkroom/<item>/<recipe>: [item, recipe]). */
export function viewArgs() { return location.hash.slice(1).split('/').slice(1).map(decodeURIComponent); }
/* Where the darkroom was opened from, for its back arrow: the view before it. */
export const nav = { cameFrom: '' };
window.addEventListener('hashchange', (ev) => {
  const was = new URL(ev.oldURL).hash;
  if (view() === 'darkroom' && !was.startsWith('#darkroom')) nav.cameFrom = was || '#library';
  if (view() === 'history') state.history = null;
  if (view() === 'library') state.library = null;
  render();
});

export function render() {
  const n = state.entries.filter(changed).length;
  $('#count').hidden = !n; $('#count').textContent = n;
  document.querySelectorAll('.bar a[data-view]').forEach((a) => a.classList.toggle('on', a.dataset.view === view()));
  const main = $('#main');
  document.body.dataset.view = view();          // a view may use more of the page's width (the Library)
  const y = scrollY;
  // The field being typed in (marked data-k) keeps its focus, caret and text across the re-render.
  const a = document.activeElement, k = a && a.dataset && a.dataset.k;
  const typed = k && 'value' in a && a.type !== 'checkbox' && a.type !== 'radio' ? a.value : null;
  let sel = null; try { sel = [a.selectionStart, a.selectionEnd]; } catch { /* not a text field */ }
  main.replaceChildren(...(views[view()] || views.gallery)());
  if (view() !== 'history') scrollTo(0, y);
  if (k) {
    const b = main.querySelector(`[data-k="${CSS.escape(k)}"]`);
    if (b) {
      if (typed != null && b.value !== typed) b.value = typed;
      b.focus({ preventScroll: true });
      if (sel && sel[0] != null) try { b.setSelectionRange(...sel); } catch { /* not a text field */ }
    }
  }
  placeMarks();
}

export const HINT = 'Every change saves itself as a draft straight away (a tick shows it). Visitors see it only once you publish it under Review. The eye is the opposite of publishing: it hides something from visitors, or shows it again, at once.';
