/* The site's content, from the database, put into its pages.

   The pages themselves are the hand-written files (index.html, gallery/list/index.html, 404.html). What visitors
   see of the paintings and the marked page text now comes from the content database (D1, binding DB; tables
   in db/schema.sql), so this fills those parts in on the way out, with Cloudflare's HTMLRewriter:
     - the floating gallery's data (<script id="gallery-data">) and the paintings hung around the invitation;
     - text marked data-text="key" (replaced) and data-paragraphs="key" (its <p>s replaced);
     - the list page's grid;
     - the site's header, one copy for every page (templates/header.html, bundled into the Worker as text), in
       place of <header data-partial="header">, with an icon for each ticked contact link (links.js);
     - the contact section's links (data-links), from the same entry.
   mode 'published' is what visitors see; mode 'draft' is the editor's preview (admin.chrisjones.org.uk).

   Where paintings' and backgrounds' files are: paths.js (one folder in R2 per Library item, served by
   worker.js at /media/<code>/...). */

import header from './templates/header.html';   // .html files are imported as text (Wrangler's default rules)
import { ticked, icon } from './links.js';
import { paintingAt, paintingPattern, photoAt, versionAt, framesFor } from './paths.js';

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
  let links = null;
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
    else if (r.kind === 'links') links = d;
  }
  const byOrder = (a, b) => a.order - b.order || a.title.localeCompare(b.title);
  sections.sort(byOrder);
  const sec = Object.fromEntries(sections.map((s) => [s.id, s]));
  for (const p of paintings.sort(byOrder)) if (sec[p.section]) sec[p.section].paintings.push(p);
  const ordered = sections.flatMap((s) => s.paintings);
  const byName = Object.fromEntries(ordered.map((p) => [p.name, p]));
  return { mode, sections, paintings: ordered, byName, texts, settings, backgrounds, links, changes };
}

export const stem = (p) => p.file || p.name;
const file = (p, w, prefix = '') => `${prefix}${paintingAt(p, w)}`;

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
   density) than the next smaller version has. Each source carries its shape's first and last frames (data-first,
   data-last; frames.js), and the poster starts as the largest landscape version's first frame; backgrounds.js swaps in
   the frames of the version chosen, starts it, and gives visitors who ask for reduced motion or less data the
   still (calm: last frame, or a fade from first to last) instead. */
const srcsetOf = (urlAt, widths) => widths.map((w) => `${urlAt(w)} ${w}w`).join(', ');
const near = (widths, want) => widths.find((w) => w >= want) || widths[widths.length - 1];
function bgTag(b) {
  const pos = `object-position: ${(b.focus[0] * 100).toFixed(1)}% ${(b.focus[1] * 100).toFixed(1)}%`;
  if (b.type !== 'video') {
    const widths = b.widths;
    return `<img class="section-bg" src="${photoAt(b, near(widths, 1536))}" srcset="${srcsetOf((w) => photoAt(b, w), widths)}" sizes="100vw"`
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
  const frames = (v) => {     // its shape's frames (paths.js), at about the version's own width
    const f = framesFor(b, v), w = near(f.widths, Math.min(v.w, 1920));
    return ` data-first="${f.first(w)}" data-last="${f.last(w)}"`
      + ` data-first-set="${srcsetOf(f.first, f.widths)}" data-last-set="${srcsetOf(f.last, f.widths)}"`;
  };
  const sources = [...portrait.map((v, i) => [v, media(portrait, i, true)]), ...landscape.map((v, i) => [v, media(landscape, i, false)])]
    .map(([v, m]) => `\n        <source src="${versionAt(b, v)}" type="video/mp4"${m ? ` media="${m}"` : ''}${frames(v)}>`).join('');
  const lead = framesFor(b, landscape[0] || portrait[0]);
  return `<video class="section-bg" poster="${lead.first(near(lead.widths, 1536))}" muted playsinline preload="metadata"`
    + ` disablepictureinpicture disableremoteplayback x-webkit-airplay="deny" aria-hidden="true"`
    + ` data-play="${b.play}" data-calm="${b.calm}" style="${pos}">${sources}\n      </video>`
    + '<script>window.bgVideo && bgVideo(document.currentScript.previousElementSibling)</script>';
}

/* The contact links (entry 'links', links.js): in the contact section a line each, with its icon and username, and
   in the header an icon each. The email address isn't written out in the page, so address-collecting robots don't
   find it: data-addr holds it backwards, and index.html's script turns it round, shows it and copies it when
   clicked (the header's email icon copies it too). */
const backwards = (s) => [...s].reverse().join('');
function contactLinks(links) {
  return ticked(links || {}).map(([s, u]) => (s.key === 'email'
    ? `\n          <p class="footer-email contact-line"><span id="footer-email" role="button" tabindex="0" title="Copy email address" data-addr="${esc(backwards(u))}"></span>`
      + '<span class="copied-tip footer-tip" id="footer-copied" role="status" aria-live="polite">Email address copied</span></p>'
    : `\n          <p class="contact-line"><a href="${esc(s.url(u))}" target="_blank" rel="noopener" aria-label="${esc(`${s.name}: ${u}`)}">${icon(s.key)}${shown(s.shown(u))}</a></p>`)).join('') + '\n        ';
}
function headerLinks(links) {
  return ticked(links || {}).map(([s, u]) => (s.key === 'email'
    ? `\n          <a href="/#contact" class="nav-link nav-icon" id="header-email" aria-label="Copy email address" title="Copy email address">${icon(s.key, 20)}</a>`
    : `\n          <a href="${esc(s.url(u))}" target="_blank" rel="noopener" class="nav-link nav-icon" aria-label="${esc(`${s.name}: ${u}`)}" title="${esc(s.name)}">${icon(s.key, 20)}</a>`)).join('') + '\n        ';
}

/* The picture for link previews (og:image) of the home page: the opening's background, the photo or the video's
   last frame (the picture a visitor's eye ends on), at the size nearest above 1200 pixels across, the width link
   previews are drawn at. Null when the opening has none. */
export function homePreview(c) {
  const b = c.backgrounds && c.backgrounds.hero;
  if (!b) return null;
  if (b.type !== 'video') { const w = near(b.widths, 1200); return { src: photoAt(b, w), w, h: Math.round(b.h * w / b.w) }; }
  const v = b.versions.filter((x) => x.h <= x.w).sort((x, y) => y.w - x.w)[0] || b.versions[0];
  const f = framesFor(b, v), w = near(f.widths, 1200);
  return { src: f.last(w), w, h: Math.round(v.h * w / v.w) };
}

export function galleryData(c) {
  const items = c.paintings.map((p) => {
    const m = SIZE_RE.exec(p.details || '');
    return { name: p.name, title: p.title, details: p.details, wide: p.wide, w: p.w, h: p.h, widths: p.widths,
      cm: p.cm || (m ? [parseFloat(m[1]), parseFloat(m[2])] : null),     // the size as entered, or read from older details lines
      at: paintingPattern(p) };
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
      if (part != null) el.replace(part.replace(/(<li class="nav-icons">)[\s\S]*?(<\/li>)/, (_, a, b) => a + headerLinks(c.links) + b), { html: true });
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
    .on('[data-links]', { element(el) { el.setInnerContent(contactLinks(c.links), { html: true }); } })
    .on('[data-paragraphs]', { element(el) {
      const t = c.texts[el.getAttribute('data-paragraphs')];
      if (t == null) return;
      const paras = t.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
      el.append(paras.map((x) => `\n          <p>${esc(x)}</p>`).join('') + '\n        ', { html: true });
    } });
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
