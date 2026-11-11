/* Talking to the server (editor.js and library.js there, through /edit/api/), and the one saving rule: every
   change saves itself as a draft at once, in a queue. */

import { $, toast } from './dom.js';
import { state } from './state.js';
import { marks, SAVED } from './marks.js';
import { render } from './render.js';

/* fetch, giving up after ms (a dropped phone signal can otherwise leave a request, and a disabled button,
   waiting for ever).
   X-Requested-With asks Cloudflare Access to answer 401 when its session has run out, rather than sending the
   request off to its sign-in page (docs: Access, session management, AJAX); worker.js answers 401 too when it
   rejects the token. Either way the sign-in bar appears, with a link that signs in afresh in a new tab, so
   whatever is typed here stays put: sign in there, come back and try again. */
export async function fetchFor(url, opts = {}, ms) {
  let r;
  try {
    r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), 'x-requested-with': 'XMLHttpRequest' },
      signal: AbortSignal.timeout(ms) });
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') throw new Error('No answer from the server: check the signal and try again');
    throw new Error('Couldn\'t reach the server: check the signal and try again');
  }
  $('#signin').hidden = r.status !== 401;
  if (r.status === 401) throw new Error('Your sign-in has run out: sign in again, then try once more');
  return r;
}
export async function call(method, path, body) {
  const r = await fetchFor(`/edit/api/${path}`, {
    method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
  }, 30000);
  const data = await r.json().catch(() => ({ error: `The server answered ${r.status}` }));
  if (!r.ok) throw new Error(data.error || `The server answered ${r.status}`);
  if (data.entries) state.entries = data.entries;
  return data;
}
export async function act(fn, done) {
  try { const out = await fn(); if (done) toast(typeof done === 'function' ? done(out) : done); render(); return out; }
  catch (e) { toast(e.message, true); render(); }
}
/* Saving a draft. Saves run one after another (a queue), so two never cross and the later always wins. items: the
   entries, or a function giving them when their turn comes (so they're built from the latest state; null to skip).
   key: what was changed (the data-k of its field or button): it gets a tick instead of a message. Resolves with
   the server's answer, or undefined if it failed (the message says why). */
let queue = Promise.resolve(), saving = 0;
export function save(items, msg = 'Saved as a draft', key) {
  saving++;
  const job = queue.then(() => act(async () => {
    const list = typeof items === 'function' ? items() : items;
    if (!list || !list.length) return null;
    const out = await call('POST', 'save', { items: list });
    if (key) marks.set(key, [Date.now(), SAVED]);
    return out;
  }, key ? null : msg)).finally(() => { saving--; });
  queue = job;
  return job;
}
window.addEventListener('beforeunload', (ev) => { if (saving) { ev.preventDefault(); ev.returnValue = ''; } });

/* Hide or show again, at once: the opposite of Publish, so it takes effect straight away, as a release in History,
   and other waiting changes stay waiting (widgets.js hideButton). */
export function hideNow(id, hidden, key) {
  saving++;
  const job = queue.then(() => act(async () => {
    const out = await call('POST', 'hide', { id, hidden });
    marks.set(key, [Date.now(), hidden ? 'Hidden: off the site now (History can bring it back)' : 'Shown again: on the site now']);
    state.history = null;
    return out;
  })).finally(() => { saving--; });
  queue = job;
  return job;
}

/* Back to the published version. Anything holding on to what's being discarded (an open Edit form) lets go
   first: it adds a function to beforeDiscard, called with the ids. */
export const beforeDiscard = new Set();
export const discard = (ids) => {
  for (const fn of beforeDiscard) fn(ids);
  return act(() => call('POST', 'discard', { ids }), 'Back to the published version');
};

export function loadLibrary() {
  return call('GET', 'library').then((d) => { state.library = d; render(); }).catch((e) => toast(e.message, true));
}
