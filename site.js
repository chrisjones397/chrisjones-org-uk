/* The site's content, from the database, put into its pages.

   The pages themselves are still the hand-written files (index.html, gallery/list/index.html). What visitors
   see of the paintings and the marked page text now comes from the content database (D1, binding DB; tables
   in db/schema.sql), so this fills those parts in on the way out, with Cloudflare's HTMLRewriter:
     - the floating gallery's data (<script id="gallery-data">) and the paintings hung around the invitation;
     - text marked data-text="key" (replaced) and data-paragraphs="key" (its <p>s replaced);
     - the list page's grid.
   mode 'published' is what visitors see; mode 'draft' is the editor's preview (admin.chrisjones.org.uk).

   A painting's images are <base><name>-<width>.<ext>, from the site's top folder:
     base "img/",          ext "webp": made by tools/build_site.py from masters/, in the site's files;
     base "media/p/<id>/", ext "jpg":  uploaded through the editor, kept in R2 and served by worker.js. */

const INVITE_COUNT = 5;
const SIZES_GRID = '(max-width: 540px) 100vw, (max-width: 899px) 50vw, 33vw';
const SIZES_WIDE = '(max-width: 1200px) 100vw, 1200px';
const SIZE_RE = /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*cm/;   // "60 x 90 cm": height x width

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Text on the page: escaped, with hyphens inside words kept from breaking onto two lines (as build_site.py)
const shown = (s) => esc(s).replace(/(?<=\w)-(?=\w)/g, '&#8209;');
export function slug(title) {
  return title.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ')
    .replace(/[#,.'’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/* Everything one version of the site shows: sections in order, each with its paintings in order. */
export async function load(env, mode) {
  const { results } = await env.DB.prepare('SELECT id, kind, draft, published FROM entries').all();
  const pick = (r) => (mode === 'draft' ? r.draft : r.published);
  const sections = [], paintings = [], texts = {}, settings = {};
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
  }
  const byOrder = (a, b) => a.order - b.order || a.title.localeCompare(b.title);
  sections.sort(byOrder);
  const sec = Object.fromEntries(sections.map((s) => [s.id, s]));
  for (const p of paintings.sort(byOrder)) if (sec[p.section]) sec[p.section].paintings.push(p);
  const ordered = sections.flatMap((s) => s.paintings);
  const byName = Object.fromEntries(ordered.map((p) => [p.name, p]));
  return { mode, sections, paintings: ordered, byName, texts, settings, changes };
}

const file = (p, w, prefix = '') => `${prefix}${p.base}${p.name}-${w}.${p.ext}`;

function imgTag(p, prefix, sizes, indent) {
  const srcset = p.widths.map((w) => `${file(p, w, prefix)} ${w}w`).join(`,\n${indent}        `);
  const srcW = p.widths.find((w) => w >= 480) || p.widths[p.widths.length - 1];
  return `<img src="${file(p, srcW, prefix)}"\n${indent}     srcset="${srcset}"\n${indent}     sizes="${sizes}"\n`
    + `${indent}     width="${p.w}" height="${p.h}" alt="${esc(p.title)}" loading="lazy">`;
}

export function galleryData(c) {
  const items = c.paintings.map((p) => {
    const m = SIZE_RE.exec(p.details || '');
    return { name: p.name, title: p.title, details: p.details, wide: p.wide, w: p.w, h: p.h, widths: p.widths,
      cm: m ? [parseFloat(m[1]), parseFloat(m[2])] : null, base: p.base, ext: p.ext };
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
  return new HTMLRewriter()
    .on('[data-text]', { element(el) {
      const t = c.texts[el.getAttribute('data-text')];
      if (t != null) el.setInnerContent(t);
    } })
    .on('[data-paragraphs] p', { element(el) { el.remove(); } })
    .on('[data-paragraphs]', { element(el) {
      const t = c.texts[el.getAttribute('data-paragraphs')];
      if (t == null) return;
      const paras = t.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
      el.append(paras.map((x) => `\n          <p>${esc(x)}</p>`).join('') + '\n        ', { html: true });
    } });
}

export function homeRewriter(c) {
  return rewriter(c)
    .on('script#gallery-data', { element(el) { el.setInnerContent(galleryData(c), { html: true }); } })
    .on('.invite-wall', { element(el) { el.setInnerContent(inviteHtml(c), { html: true }); } });
}

export function listRewriter(c) {
  return rewriter(c).on('.list-page .wrapper', { element(el) { el.setInnerContent(listHtml(c, '../../'), { html: true }); } });
}
