/* The site's server code. Most of the site is served straight from the files; Cloudflare runs this first
   (run_worker_first in wrangler.jsonc) only for the pages that show content from the database, the uploaded
   images and the editor.

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
   Uploaded images: /media/p/<id>/<file>, from R2 (binding MEDIA). */

import { load, homeRewriter, listRewriter, esc } from './site.js';
import { signedIn, api } from './editor.js';

const SITE = 'Christopher Jones - Fine Art';
const LIVE_HOSTS = ['chrisjones.org.uk', 'www.chrisjones.org.uk'];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const editor = url.hostname.startsWith('admin') || (env.DEV_USER && url.hostname === 'localhost' && url.port === '8788');
    const path = url.pathname;

    if (path.startsWith('/media/')) return media(request, env, ctx, url);

    if (editor) {
      const who = await signedIn(request, env, url);
      if (!who) return new Response('Sign in required.', { status: 403 });
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

    const mode = editor ? 'draft' : 'published';
    if (path === '/' || path === '/index.html') return home(env, url, mode, editor);
    if (path === '/gallery/list' || path === '/gallery/list/index.html') return Response.redirect(`${url.origin}/gallery/list/`, 301);
    if (path === '/gallery/list/') return listPage(env, url, mode, editor);
    const m = path.match(/^\/paintings\/([a-z0-9-]+)\/?$/);
    if (m) {
      if (!path.endsWith('/')) return Response.redirect(`${url.origin}${path}/${url.search}`, 301);
      return home(env, url, mode, editor, m[1]);
    }
    return env.ASSETS.fetch(request);
  },
};

function notFound(env, url) {
  return env.ASSETS.fetch(new URL('/404.html', url)).then((r) => new Response(r.body, { status: 404, headers: r.headers }));
}

function respond(res, editor) {
  const h = new Headers(res.headers);
  h.delete('etag');
  h.set('content-type', 'text/html; charset=utf-8');
  h.set('cache-control', editor ? 'no-store' : 'no-cache');
  return new Response(res.body, { status: 200, headers: h });
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
  if (name && !p) return notFound(env, url);
  const page = await env.ASSETS.fetch(new URL('/', url));
  const rw = finish(homeRewriter(c), c, url, editor);
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
      .on('meta[property="og:url"]', set(here))
      .on('meta[property="og:image"]', set(`${url.origin}/${p.preview.src}`))
      .on('meta[property="og:image:width"]', set(String(p.preview.w)))
      .on('meta[property="og:image:height"]', set(String(p.preview.h)));
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

/* An uploaded image, from R2. Its address never changes once uploaded, so browsers and Cloudflare may keep it. */
async function media(request, env, ctx, url) {
  const key = decodeURIComponent(url.pathname.slice('/media/'.length));
  if (!env.MEDIA || !/^p\/[a-z0-9]{12}\/[a-z0-9-]+\.jpg$/.test(key)) return notFound(env, url);
  const cache = caches.default;
  const hit = await cache.match(request);
  if (hit) return hit;
  const obj = await env.MEDIA.get(key);
  if (!obj) return notFound(env, url);
  const res = new Response(obj.body, { headers: {
    'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable', etag: obj.httpEtag } });
  ctx.waitUntil(cache.put(request, res.clone()));
  return res;
}
