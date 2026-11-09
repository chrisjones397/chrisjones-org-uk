/* The site's server code. Most of the site is served straight from the files; Cloudflare runs this first
   (run_worker_first in wrangler.jsonc) only for the pages that show content from the database, the uploaded
   images and the editor, and otherwise only for addresses where there's no file (not_found_handling "none"):
   old addresses sent on, and the "page not found" page.

   Two kinds of address reach it:
   - The site (chrisjones.org.uk, www, and dev.chrisjones.org.uk): visitors see the published content.
   - The editor (admin.chrisjones.org.uk, and admin-dev.chrisjones.org.uk for dev): the whole site again, but
     showing the drafts, with a bar for getting to the editor (/admin/), where content is changed, reviewed
     and published. Cloudflare Access guards all of it; editor.js checks the sign-in again.

   Pages filled in from the database (site.js does the filling):
     /                    the home page
     /paintings/<name>/   the home page with that painting brought forward in the floating gallery: one page
                          and one view however you arrive. Its title and link-preview details are the painting's,
                          with <base href="/"> so the page's own files are found from the top folder.
     /gallery/list/       every painting as a plain grid
     anything else        templates/404.html, with status 404
   Every page gets the site's header (templates/header.html) as it's served. Old addresses: /gallery/ (once the
   floating gallery's own page) goes to the home page's gallery section.
   Files kept in R2 (binding MEDIA): /media/<code>/<file> (the Library's layout, paths.js): only what's published,
   except to the editor. Videos are sent in pieces when asked (range requests: 206 Partial Content), which is how
   browsers play video, and Safari insists on it. */

import { load, rewriter, homeRewriter, listRewriter, homePreview, esc } from './site.js';
import { signedIn, api } from './editor.js';
import notFoundPage from './templates/404.html';   // .html files are imported as text (Wrangler's default rules)

const SITE = 'Christopher Jones - Fine Art';
const LIVE_HOSTS = ['chrisjones.org.uk', 'www.chrisjones.org.uk'];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const editor = url.hostname.startsWith('admin') || (env.DEV_USER && url.hostname === 'localhost' && url.port === '8788');
    const path = url.pathname;

    if (path.startsWith('/media/')) {
      // The Library's layout (paths.js): /media/<code>/<file> is R2's media/<code>/<file>
      const item = /^\/media\/([0-9a-f]{8})\/((?:(?:r|wide-|tall-)\d{1,3}\/)?([a-z0-9-]+)\.([a-z0-9]{1,5}))$/.exec(decodeURIComponent(path));
      return item ? libraryFile(request, env, ctx, url, editor, item) : notFound(env, url);
    }

    if (editor) {
      const who = await signedIn(request, env, url);
      if (!who) return signInAgain(request, url);
      if (path === '/admin') return Response.redirect(`${url.origin}/admin/`, 301);
      if (path.startsWith('/admin/api/')) return api(request, env, url, who);
      if (path.startsWith('/admin/')) {
        const page = await env.ASSETS.fetch(new URL(path === '/admin/' ? '/admin/index.html' : path, url));
        const h = new Headers(page.headers);
        h.set('cache-control', 'no-store');
        return new Response(page.body, { status: page.status, headers: h });
      }
    } else if (path === '/admin' || path.startsWith('/admin/')) {
      return notFound(env, url);
    }
    if (path === '/gallery' || path === '/gallery/' || path === '/gallery/index.html') {
      return Response.redirect(`${url.origin}/#paintings`, 301);
    }

    const mode = editor ? 'draft' : 'published';
    if (path === '/' || path === '/index.html') return home(env, url, mode, editor);
    if (path === '/gallery/list' || path === '/gallery/list/index.html') return Response.redirect(`${url.origin}/gallery/list/`, 301);
    if (path === '/gallery/list/') return listPage(env, url, mode, editor);
    const m = path.match(/^\/paintings\/([a-z0-9-]+)\/?$/);
    if (m) {
      if (!path.endsWith('/')) return Response.redirect(`${url.origin}${path}/${url.search}`, 301);
      return home(env, url, mode, editor, m[1]);
    }
    // Reached only where there's no file (or under the run_worker_first addresses above): try the files once more
    const res = await env.ASSETS.fetch(request);
    return res.status === 404 ? notFound(env, url, mode) : res;
  },
};

/* The "page not found" page, with the header and the footer's text, and status 404. */
async function notFound(env, url, mode = 'published') {
  const c = await load(env, mode);
  const page = new Response(notFoundPage, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  return respond(rewriter(c).transform(page), mode === 'draft', 404);
}

/* On the editor's address, Access let a request through but its token didn't pass signedIn(): issued under an
   old team name (as after the team rename, Nov 2026), or for another application. Access won't ask again while
   its own cookie on this address lasts, so a page request clears that cookie and comes straight back: Access
   then starts a fresh sign-in by itself (silently, if the sign-in address still has a good session). A marker
   cookie, kept for a minute, means a second failure shows a page instead of going round again, so a mistake in
   the settings (ACCESS_TEAM, ACCESS_AUD) can't loop. Requests from the editor's script (the API, images) get a
   401, which admin/editor.js turns into a "Sign in again" link, so nothing typed is lost. */
const RETRY = 'signin_retry';
function signInAgain(request, url) {
  const page = request.method === 'GET' && !url.pathname.startsWith('/admin/api/') && !url.pathname.startsWith('/media/')
    && request.headers.get('x-requested-with') !== 'XMLHttpRequest';
  if (!page) {
    return new Response(JSON.stringify({ error: 'Your sign-in has run out: sign in again', signin: true }), {
      status: 401, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  }
  const h = new Headers({ 'cache-control': 'no-store' });
  if (new RegExp(`(?:^|;\\s*)${RETRY}=1`).test(request.headers.get('cookie') || '')) {
    h.set('content-type', 'text/html; charset=utf-8');
    h.append('set-cookie', `${RETRY}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`);
    return new Response(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<title>Sign in - ${SITE}</title><style>body{margin:0;padding:3rem 1.5rem;background:#1a1a1a;color:#eee;
font:16px/1.5 -apple-system,BlinkMacSystemFont,"Helvetica Neue",Helvetica,Arial,sans-serif}main{max-width:32rem;margin:0 auto}
a{color:#fff;text-decoration:none;border:1px solid #888;border-radius:6px;padding:0.45rem 0.8rem;display:inline-block}
a:hover{text-shadow:0 0 8px #fff8e0}</style></head><body><main><h1 style="font-weight:300">Couldn't sign you in</h1>
<p>Signing in again didn't help, so the editor's sign-in settings may need checking.</p>
<p><a href="/cdn-cgi/access/logout">Sign out completely</a></p>
<p style="color:#9a9a9a">Then come back to this address to sign in afresh.</p></main></body></html>`, { status: 403, headers: h });
  }
  h.set('location', url.pathname + url.search);
  h.append('set-cookie', 'CF_Authorization=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax');
  h.append('set-cookie', `${RETRY}=1; Path=/; Max-Age=60; Secure; HttpOnly; SameSite=Lax`);
  return new Response(null, { status: 302, headers: h });
}

function respond(res, editor, status = 200) {
  const h = new Headers(res.headers);
  h.delete('etag');
  h.set('content-type', 'text/html; charset=utf-8');
  h.set('cache-control', editor ? 'no-store' : 'no-cache');
  return new Response(res.body, { status, headers: h });
}

/* Everything except the live site says so to search engines; the editor's pages also get its bar. */
function finish(rw, c, url, editor) {
  if (!LIVE_HOSTS.includes(url.hostname)) {
    rw.on('head', { element(el) { el.append('<meta name="robots" content="noindex, nofollow">', { html: true }); } });
  }
  if (editor) rw.on('body', { element(el) { el.append(bar(c), { html: true }); } });
  return rw;
}

async function home(env, url, mode, editor, name) {
  const c = await load(env, mode);
  const p = name && c.byName[name];
  if (name && !p) return notFound(env, url, mode);
  const page = await env.ASSETS.fetch(new URL('/', url));
  const rw = finish(homeRewriter(c), c, url, editor);
  // The picture in link previews: the painting shown, or else the opening's background (site.js homePreview).
  const pic = p ? { src: `/${p.preview.src}`, w: p.preview.w, h: p.preview.h } : homePreview(c);
  if (pic) {
    rw.on('head', { element(el) {
      el.append(`<meta property="og:image" content="${esc(url.origin + pic.src)}">`
        + `<meta property="og:image:width" content="${pic.w}"><meta property="og:image:height" content="${pic.h}">`, { html: true });
    } });
  }
  if (p) {
    const here = `${url.origin}/paintings/${p.name}/`;
    const set = (value) => ({ element(el) { el.setAttribute('content', value); } });
    rw.on('head', { element(el) {
      el.prepend('<base href="/">', { html: true });
      el.append(`<link rel="canonical" href="${esc(here)}">`, { html: true });
    } })
      .on('title', { element(el) { el.setInnerContent(`${p.title} - ${SITE}`); } })
      .on('meta[name="description"]', set(`${p.title}, by Christopher Jones.`))
      .on('meta[property="og:title"]', set(p.title))
      .on('meta[property="og:description"]', set(p.details ? `${p.details}, by Christopher Jones` : 'By Christopher Jones'))
      .on('meta[property="og:url"]', set(here));
  }
  return respond(rw.transform(page), editor);
}

async function listPage(env, url, mode, editor) {
  const c = await load(env, mode);
  const page = await env.ASSETS.fetch(new URL('/gallery/list/index.html', url));
  return respond(finish(listRewriter(c), c, url, editor).transform(page), editor);
}

/* The editor's bar on its preview of the site: what you're looking at, and the way to the editor. */
function bar(c) {
  const n = c.changes;
  const changes = n ? `${n} change${n === 1 ? '' : 's'} to publish` : 'all published';
  return `
<div id="cms-bar" style="position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483647;display:flex;gap:12px;align-items:center;
  padding:7px 14px;max-width:calc(100vw - 20px);border-radius:999px;background:rgba(20,20,20,0.88);color:#eee;font:13px/1.3 -apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;
  box-shadow:0 2px 12px rgba(0,0,0,0.4);white-space:nowrap;text-shadow:none">
  <span style="color:#f5c66b">Draft</span><span style="color:#aaa">${changes}</span>
  <a href="/admin/" style="color:#fff;text-decoration:none">Edit</a>
  ${n ? '<a href="/admin/#review" style="color:#fff;text-decoration:none">Review</a>' : ''}
</div>`;
}

/* A file in a Library item's folder. Visitors get it only if something published and not hidden uses the item
   (its code is the entry's media), and never its original. (A file already cached stays cached until it's
   deleted for good, which purges it; hiding is meant to be undone, and the page no longer links to it.) The signed-in editor gets everything. */
async function libraryFile(request, env, ctx, url, editor, [, code, path, base, ext]) {
  if (!env.MEDIA) return notFound(env, url);
  const key = `media/${code}/${path}`;
  const isVideo = ext === 'mp4';
  if (!editor) {
    if (base === 'original' && !path.includes('/')) return notFound(env, url);
    if (!isVideo) { const hit = await caches.default.match(request); if (hit) return hit; }
    const ok = await env.DB.prepare(`SELECT 1 FROM entries WHERE kind IN ('painting', 'background')
        AND published IS NOT NULL AND json_extract(published, '$.media') = ?
        AND json_extract(published, '$.hidden') IS NULL LIMIT 1`).bind(code).first();
    if (!ok) return notFound(env, url);
  } else if (!(await signedIn(request, env, url))) {
    return signInAgain(request, url);
  }
  const caching = editor ? 'private, max-age=3600' : 'public, max-age=31536000, immutable';
  if (isVideo) return video(request, env, key, caching);
  const obj = await env.MEDIA.get(key);
  if (!obj) return notFound(env, url);
  const type = { jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', png: 'image/png' }[ext] || obj.httpMetadata?.contentType || 'application/octet-stream';
  const res = new Response(obj.body, { headers: { 'content-type': type, etag: obj.httpEtag, 'cache-control': caching } });
  if (!editor) ctx.waitUntil(caches.default.put(request, res.clone()));
  return res;
}

async function video(request, env, key, caching) {
  const head = await env.MEDIA.head(key);
  if (!head) return new Response('Not found', { status: 404 });
  const size = head.size;
  const h = new Headers({ 'content-type': 'video/mp4', etag: head.httpEtag, 'cache-control': caching, 'accept-ranges': 'bytes' });
  // One range, "bytes=start-end", "bytes=start-" or "bytes=-last"; anything else gets the whole file
  const m = /^bytes=(\d*)-(\d*)$/.exec((request.headers.get('range') || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) {
    const obj = await env.MEDIA.get(key);
    h.set('content-length', size);
    return new Response(obj.body, { headers: h });
  }
  let offset, end;
  if (m[1] === '') { offset = Math.max(0, size - Number(m[2])); end = size - 1; }
  else { offset = Number(m[1]); end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1); }
  if (offset >= size || end < offset) {
    h.set('content-range', `bytes */${size}`);
    return new Response(null, { status: 416, headers: h });
  }
  const obj = await env.MEDIA.get(key, { range: { offset, length: end - offset + 1 } });
  h.set('content-range', `bytes ${offset}-${end}/${size}`);
  h.set('content-length', end - offset + 1);
  return new Response(obj.body, { status: 206, headers: h });
}
