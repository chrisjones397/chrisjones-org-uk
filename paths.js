/* Where a painting's or a background's files are: one copy of the rule, used by the page (site.js), the editor
   page (admin/editor.js) and, through the gallery data, the floating gallery. Published, like links.js.

   The layout (step 1d, Nov 2026): one folder in R2 for each Library item, named by its code (8 hex digits, made
   when it's uploaded, never changed; the name shown is the Library's own, in D1). Served at /media/<code>/...
     a photo   original.<ext>            as uploaded (never shown to visitors)
               r1/, r2/...               each set of sizes made from it ("renditions": a painting reprocessed,
                                         or a second painting cut from the same photo, gets the next one):
                                         <width>.<ext> and, for paintings, preview.jpg (link previews)
     a video   <w>x<h>.mp4               each version of the one video (a set)
               wide-1/, tall-1/...       first-<width>.jpg and last-<width>.jpg, once per shape (frames.js),
                                         from that shape's largest version; remade under the next number
   An entry names the item (media) and what it uses of it, so what visitors see changes only when it's published.

   Older entries, from before the move into this layout, named files in images/, originals/ and videos/; they're
   read here too until both sites have moved (Library, "Move into the new layout"). */

import { holder, upright } from './frames.js';

/* A painting's image at width w, from the site's top folder (no leading /). */
export const paintingAt = (p, w) => (p.media
  ? `media/${p.media}/${p.rendition}/${w}.${p.ext}`
  : `${p.base}${p.file || p.name}-${w}.${p.ext}`);
/* The same as a pattern: [before, after] the width, for the floating gallery, which picks its own sizes. */
export const paintingPattern = (p) => (p.media
  ? [`media/${p.media}/${p.rendition}/`, `.${p.ext}`]
  : [`${p.base}${p.file || p.name}-`, `.${p.ext}`]);

/* A background photo at width w (from the top folder, with the leading /). */
export const photoAt = (b, w) => (b.media ? `/media/${b.media}/${b.rendition}/${w}.jpg` : `/media/images/${b.file}-${w}.jpg`);

/* A background video's version, and the frames (first and last) for it: { widths, first(w), last(w) }. */
export const versionAt = (b, v) => (b.media ? `/media/${b.media}/${v.file}.mp4` : `/media/videos/${v.name}.mp4`);
export function framesFor(b, v) {
  if (b.media) {
    const f = b.frames[upright(v) ? 'tall' : 'wide'] || b.frames.wide || b.frames.tall;
    return { widths: f.widths, first: (w) => `/media/${b.media}/${f.dir}/first-${w}.jpg`, last: (w) => `/media/${b.media}/${f.dir}/last-${w}.jpg` };
  }
  const f = holder(b.versions, v);
  return { widths: f.stills, first: (w) => `/media/images/${f.name}-first-${w}.jpg`, last: (w) => `/media/images/${f.name}-last-${w}.jpg` };
}

/* A Library item's code: 8 hex digits. */
export const CODE = /^[0-9a-f]{8}$/;
