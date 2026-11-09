/* The site's content, from the database, put into its pages.

   The pages themselves are the hand-written files (index.html, gallery/list/index.html, 404.html). What visitors
   see of the paintings and the marked page text now comes from the content database (D1, binding DB; tables
   in db/schema.sql), so this fills those parts in on the way out, with Cloudflare's HTMLRewriter:
     - the floating gallery's data (<script id="gallery-data">) and the paintings hung around the invitation;
     - text marked data-text="key" (replaced) and data-paragraphs="key" (its <p>s replaced);
     - the list page's grid;
     - the site's header, one copy for every page (templates/header.html, bundled into the Worker as text), in
       place of <header data-partial="header">.
   mode 'published' is what visitors see; mode 'draft' is the editor's preview (admin.chrisjones.org.uk).

   A painting's images are <base><file>-<width>.<ext> (and <base><file>-preview.jpg), from the site's top
   folder, where <file> is the painting's name, or name-v2, -v3... when a name's files already exist in R2:
     base "media/images/", ext "jpg" (uploaded through the editor) or "webp" (paintings moved out of git,
     Nov 2026): in R2, served by worker.js.
   R2 holds images/ (what the site shows) and originals/ (each painting's photo as uploaded, never served). */

import header from './templates/header.html';   // .html files are imported as text (Wrangler's default rules)

const PARTIALS = { header };
const INVITE_COUNT = 5;
const SIZES_GRID = '(max-width: 540px) 100vw, (max-width: 899px) 50vw, 33vw';
const SIZES_WIDE = '(max-width: 1200px) 100vw, 1200px';
const SIZE_RE = /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*cm/;   // "60 x 90 cm": height x width

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Text on the page: escaped, with hyphens inside words kept from breaking onto two lines 
const shown = (s) => esc(s).replace(/(?<=\w)-(?=\w)/g, '&#8209;');
export function slug(title) {
  return title.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ')
    .replace(/[#,.'’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/* Everything one version of the site shows: sections in order, each with its paintings in order. */
export async function load(env, mode) {
  const { results } = await env.DB.prepare('SELECT id, kind, draft, published FROM entries').all();
  const pick = (r) => (mode === 'draft' ? r.draft : r.published);
  const sections = [], paintings = [], texts = {}, settings = {}, backgrounds = {};
  let changes = 0;
  for (const r of results) {
    if (r.draft !== r.published) changes++;
    const raw = pick(r);
    if (raw == null) continue;
    const d = JSON.parse(raw);
    if (r.kind === 'section') sections.push({ id: r.id, ...d, paintings: [] });
    else if (r.kind === 'painting') paintings.push({ id: r.id, ...d });
    else if (r.kind === 'text') texts[r.id.slice(2)] = d.text;
    else if (r.kind === 'settings') settings[r.id.slice(9)] = d;
    else if (r.kind === 'background') backgrounds[r.id.slice(3)] = d;
  }
  const byOrder = (a, b) => a.order - b.order || a.title.localeCompare(b.title);
  sections.sort(byOrder);
  const sec = Object.fromEntries(sections.map((s) => [s.id, s]));
  for (const p of paintings.sort(byOrder)) if (sec[p.section]) sec[p.section].paintings.push(p);
  const ordered = sections.flatMap((s) => s.paintings);
  const byName = Object.fromEntries(ordered.map((p) => [p.name, p]));
  return { mode, sections, paintings: ordered, byName, texts, settings, backgrounds, changes };
}

export const stem = (p) => p.file || p.name;
const file = (p, w, prefix = '') => `${prefix}${p.base}${stem(p)}-${w}.${p.ext}`;

function imgTag(p, prefix, sizes, indent) {
  const srcset = p.widths.map((w) => `${file(p, w, prefix)} ${w}w`).join(`,\n${indent}        `);
  const srcW = p.widths.find((w) => w >= 480) || p.widths[p.widths.length - 1];
  return `<img src="${file(p, srcW, prefix)}"\n${indent}     srcset="${srcset}"\n${indent}     sizes="${sizes}"\n`
    + `${indent}     width="${p.w}" height="${p.h}" alt="${esc(p.title)}" loading="lazy">`;
}

/* A section's background (entry bg-<section>), a photo or a video, put in as the section's first child, so the
   parallax (motion.js) and the header's glass (glass.js) find it. Its focus is where the screen's shape crops it;
   --shade darkens it so the words over it read.
   A video's versions are <source>s, the browser taking the first that matches: portrait versions first, for
   screens held upright, then by width, each needing a screen that shows more pixels across (window width x pixel
   density) than the next smaller version has. Each source carries its own first and last frames (data-first,
   data-last), and the poster starts as the largest landscape version's first frame; backgrounds.js swaps in
   the frames of the version chosen, starts it, and gives visitors who ask for reduced motion or less data the
   still (calm: last frame, or a fade from first to last) instead. */
const at = (name, w) => `/media/images/${name}-${w}.jpg`;
const srcsetOf = (name, widths) => widths.map((w) => `${at(name, w)} ${w}w`).join(', ');
const near = (widths, want) => widths.find((w) => w >= want) || widths[widths.length - 1];
function bgTag(b) {
  const pos = `object-position: ${(b.focus[0] * 100).toFixed(1)}% ${(b.focus[1] * 100).toFixed(1)}%`;
  if (b.type !== 'video') {
    const widths = b.widths;
    return `<img class="section-bg" src="${at(b.file, near(widths, 1536))}" srcset="${srcsetOf(b.file, widths)}" sizes="100vw"`
      + ` width="${b.w}" height="${b.h}" alt="" loading="lazy" decoding="async" style="${pos}">`;
  }
  const portrait = b.versions.filter((v) => v.h > v.w).sort((x, y) => y.w - x.w);
  const landscape = b.versions.filter((v) => v.h <= v.w).sort((x, y) => y.w - x.w);
  const needs = (n) => [1, 2, 3].map((d) => `(min-width: ${Math.floor(n / d) + 1}px)${d > 1 ? ` and (min-resolution: ${d}dppx)` : ''}`);
  const media = (group, i, upright) => {
    const next = group[i + 1];
    const wide = next ? needs(next.w) : null;
    if (upright) return wide ? wide.map((q) => `(orientation: portrait) and ${q}`).join(', ') : '(orientation: portrait)';
    return wide ? wide.join(', ') : null;
  };
  const frames = (v) => ` data-first="${at(`${v.name}-first`, near(v.stills, Math.min(v.w, 1920)))}"`
    + ` data-last="${at(`${v.name}-last`, near(v.stills, Math.min(v.w, 1920)))}"`
    + ` data-first-set="${srcsetOf(`${v.name}-first`, v.stills)}" data-last-set="${srcsetOf(`${v.name}-last`, v.stills)}"`;
  const sources = [...portrait.map((v, i) => [v, media(portrait, i, true)]), ...landscape.map((v, i) => [v, media(landscape, i, false)])]
    .map(([v, m]) => `\n        <source src="/media/videos/${v.name}.mp4" type="video/mp4"${m ? ` media="${m}"` : ''}${frames(v)}>`).join('');
  const lead = landscape[0] || portrait[0];
  return `<video class="section-bg" poster="${at(`${lead.name}-first`, near(lead.stills, 1536))}" muted playsinline preload="metadata"`
    + ` disablepictureinpicture disableremoteplayback x-webkit-airplay="deny" aria-hidden="true"`
    + ` data-play="${b.play}" data-calm="${b.calm}" style="${pos}">${sources}\n      </video>`
    + '<script>window.bgVideo && bgVideo(document.currentScript.previousElementSibling)</script>';
}

export function galleryData(c) {
  const items = c.paintings.map((p) => {
    const m = SIZE_RE.exec(p.details || '');
    return { name: p.name, title: p.title, details: p.details, wide: p.wide, w: p.w, h: p.h, widths: p.widths,
      cm: p.cm || (m ? [parseFloat(m[1]), parseFloat(m[2])] : null),     // the size as entered, or read from older details lines
      base: p.base, file: stem(p), ext: p.ext };
  });
  // inside <script>, so no "<" may appear as itself
  return JSON.stringify({ settings: c.settings.gallery || {}, paintings: items }).replace(/</g, '\\u003c');
}

function inviteHtml(c) {
  const wanted = ((c.settings.invitation || {}).paintings || []).map((n) => c.byName[n]).filter(Boolean);
  const chosen = (wanted.length ? wanted : c.paintings).slice(0, INVITE_COUNT);
  const ind = '          ';
  return chosen.map((p) => `\n        <a class="invite-pic" href="paintings/${p.name}/" tabindex="-1">`
    + `\n${ind}${imgTag(p, '', '(max-width: 700px) 40vw, 24vw', ind)}\n        </a>`).join('') + '\n      ';
}

function listHtml(c, prefix) {
  return c.sections.filter((s) => s.paintings.length).map((s) => {
    const head = `\n          <div class="entire"><h3 id="${slug(s.title)}">${shown(s.title)}</h3></div>\n`;
    return head + s.paintings.map((p) => {
      const kind = p.wide ? 'entire' : (p.h > p.w ? 'portrait' : 'landscape');
      const details = p.details ? `\n            <p>${shown(p.details)}</p>` : '';
      return `          <div class="${kind}">\n            <a href="${prefix}paintings/${p.name}/">\n              `
        + `${imgTag(p, prefix, p.wide ? SIZES_WIDE : SIZES_GRID, '              ')}\n            </a>\n`
        + `            <p>${shown(p.title)}</p>${details}\n          </div>\n`;
    }).join('');
  }).join('') + '      ';
}

/* The rewriter for any page: the marked text, plus whatever extra handlers the page needs. */
export function rewriter(c) {
  const r = new HTMLRewriter()
    .on('[data-partial]', { element(el) {
      const part = PARTIALS[el.getAttribute('data-partial')];
      if (part != null) el.replace(part, { html: true });
    } })
    .on('[data-text]', { element(el) {
      const t = c.texts[el.getAttribute('data-text')];
      if (t != null) el.setInnerContent(t);
    } })
    .on('[data-background]', { element(el) {
      const b = c.backgrounds && c.backgrounds[el.getAttribute('data-background')];
      if (!b) return;
      const cls = el.getAttribute('class') || '';
      if (!/(^|\s)has-bg(\s|$)/.test(cls)) el.setAttribute('class', `${cls} has-bg`.trim());
      el.setAttribute('style', `--shade: ${b.shade}`);
      el.prepend(bgTag(b), { html: true });
    } })
    .on('[data-paragraphs]', { element(el) {
      const t = c.texts[el.getAttribute('data-paragraphs')];
      if (t == null) return;
      const paras = t.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
      el.append(paras.map((x) => `\n          <p>${esc(x)}</p>`).join('') + '\n        ', { html: true });
    } });
  // A section's own stand-in (index.html: a picture, or a video and its script) goes only when the database has one.
  for (const key of Object.keys(c.backgrounds || {})) {
    if (/^[a-z0-9-]+$/.test(key)) r.on(`[data-background="${key}"] > [data-stand-in]`, { element(el) { el.remove(); } });
  }
  // A block's own paragraphs are replaced only when the database has text for it; otherwise the page's stay.
  for (const key of Object.keys(c.texts)) {
    if (/^[a-z0-9-]+$/.test(key)) r.on(`[data-paragraphs="${key}"] p`, { element(el) { el.remove(); } });
  }
  return r;
}

export function homeRewriter(c) {
  return rewriter(c)
    .on('script#gallery-data', { element(el) { el.setInnerContent(galleryData(c), { html: true }); } })
    .on('.invite-wall', { element(el) { el.setInnerContent(inviteHtml(c), { html: true }); } });
}

export function listRewriter(c) {
  return rewriter(c).on('.list-page .wrapper', { element(el) { el.setInnerContent(listHtml(c, '/'), { html: true }); } });
}
