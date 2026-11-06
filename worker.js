/* The site's one piece of server code. Cloudflare runs it (see wrangler.jsonc) only for a painting's address,
   /paintings/<name>/, and for the admin page, /admin/ (handed to admin.js); everything else is served
   straight from the files.

   A painting's address is the home page with that painting brought forward in the floating gallery: the same
   page and the same view however you arrive, whether by enlarging the painting in the gallery (gallery.js then
   puts its address in the address bar, without loading anything) or by opening a link someone has shared.
   So for those addresses this sends the home page itself, with three things changed on the way:
     - its title and link-preview details (the painting's name and preview image), so a shared link shows the
       right painting in messages and search results;
     - a <base href="/">, so the page's own files (styles, scripts, pictures) are found from the site's top
       folder rather than from /paintings/<name>/;
     - a canonical link to the painting's address.
   The paintings' names, titles and preview images come from gallery/paintings.json, which
   tools/build_site.py writes from paintings.yaml. An unknown name gets the site's 404 page; an old name that's
   listed as renamed is sent on to the new one. */

import { admin } from './admin.js';

const SITE = 'Christopher Jones - Fine Art';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) return admin(request, env, url);
    const m = url.pathname.match(/^\/paintings\/([a-z0-9-]+)\/?$/);
    if (!m) return env.ASSETS.fetch(request);
    if (!url.pathname.endsWith('/')) return Response.redirect(`${url.origin}${url.pathname}/${url.search}`, 301);

    const list = await (await env.ASSETS.fetch(new URL('/gallery/paintings.json', url))).json();
    const name = m[1];
    if (list.renamed && list.renamed[name]) {
      return Response.redirect(`${url.origin}/paintings/${list.renamed[name]}/`, 301);
    }
    const p = list.paintings[name];
    if (!p) return env.ASSETS.fetch(request);                 // not a painting: the 404 page

    const home = await env.ASSETS.fetch(new URL('/', url));
    const here = `${url.origin}/paintings/${name}/`;
    const set = (value) => ({ element(el) { el.setAttribute('content', value); } });
    return new HTMLRewriter()
      .on('head', { element(el) {
        el.prepend('<base href="/">', { html: true });
        el.append(`<link rel="canonical" href="${here}">`, { html: true });
      } })
      .on('title', { element(el) { el.setInnerContent(`${p.title} - ${SITE}`); } })
      .on('meta[name="description"]', set(`${p.title}, by Christopher Jones.`))
      .on('meta[property="og:title"]', set(p.title))
      .on('meta[property="og:description"]', set(p.details ? `${p.details}, by Christopher Jones` : 'By Christopher Jones'))
      .on('meta[property="og:url"]', set(here))
      .on('meta[property="og:image"]', set(`${url.origin}/${p.image}`))
      .on('meta[property="og:image:width"]', set(String(p.width)))
      .on('meta[property="og:image:height"]', set(String(p.height)))
      .transform(new Response(home.body, { status: 200, headers: home.headers }));
  },
};
