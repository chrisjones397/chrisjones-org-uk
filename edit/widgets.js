/* Small things several views show: the badge saying how an entry differs from what's published, and the eye. */

import { h, glyph, GLYPHS } from './dom.js';
import { status, STATUS, isHidden } from './state.js';
import { hideNow } from './server.js';

/* Hide or show again, at once (an eye: open while on the site, closed while hidden): the opposite of Publish, so it
   takes effect straight away, as a release in History, and other waiting changes stay waiting. Nothing to hide on a
   thing never published, so no eye there. */
export function hideButton(e, what) {
  if (!e || e.published == null) return null;
  const hid = isHidden(e), key = `${e.id}:hide`;
  return h('button', { class: 'eye' + (hid ? ' off' : ''), 'data-k': key, 'aria-pressed': String(hid),
    title: hid ? `Hidden from visitors: tap to show ${what} again, straight away` : `On the site: tap to hide ${what} straight away (it stays here)`,
    'aria-label': hid ? `Show ${what} again` : `Hide ${what}`,
    onclick: () => hideNow(e.id, !hid, key) }, glyph(hid ? GLYPHS.hidden : GLYPHS.eye));
}
export const badge = (e) => { const s = status(e); return s ? h('span', { class: `badge ${s}` }, STATUS[s]) : null; };
