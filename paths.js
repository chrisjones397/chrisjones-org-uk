/* Where files are, and what a rendition's files are for: one copy of the rule, used by the server (media.js,
   site.js, worker.js), the editor page (the modules in edit/) and, through the gallery data, the floating gallery.
   Published, like links.js.

   Storage (docs/entities.md, section 5; step 4, slice 2): a file is known only by the SHA-256 digest of its
   bytes. That is its key in R2 and its address, /media/<digest>.<ext>; the extension is only for browsers and
   people. No name and no folder: names live in the database (the Library item), and what a file is for is said
   by the rendition it belongs to (table rendition_file: its role, width and shape).
   Because an address can never mean different bytes, visitors' copies never go stale. */

/* The extension a file's address ends in, from its content type. */
export const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif',
  'image/tiff': 'tif', 'video/mp4': 'mp4' };
export const extOf = (type) => EXT[type] || 'bin';

/* A file's address: f has digest and type. */
export const fileUrl = (f) => `/media/${f.digest}.${extOf(f.type)}`;

/* A video version (or anything with w and h) held upright. */
export const upright = (v) => v.h > v.w;

/* A rendition's files, arranged by what they are for. files: [{ digest, type, role, width, shape, w, h, bytes,
   seconds }] (media.js reads them). Gives:
     sizes     a picture at each width, smallest first: [{ width, url }]
     preview   the picture for link previews: { url, w, h }, or null
     versions  a video's versions, largest first: [{ url, digest, w, h, bytes, seconds }]
     frames    a video's first and last frames for each shape it has:
               { wide: { first: [{ width, url }], last: [...] }, tall: {...} } */
export function arranged(files) {
  const byWidth = (a, b) => a.width - b.width;
  const pic = (f) => ({ width: f.width, url: fileUrl(f) });
  const out = { sizes: files.filter((f) => f.role === 'size').sort(byWidth).map(pic), preview: null, versions: [], frames: {} };
  const pv = files.find((f) => f.role === 'preview');
  if (pv) out.preview = { url: fileUrl(pv), w: pv.w || pv.width, h: pv.h || 0 };
  out.versions = files.filter((f) => f.role === 'version').sort((a, b) => b.w * b.h - a.w * a.h)
    .map((f) => ({ url: fileUrl(f), digest: f.digest, w: f.w, h: f.h, bytes: f.bytes, seconds: f.seconds }));
  for (const f of files.filter((x) => x.role === 'first' || x.role === 'last').sort(byWidth)) {
    const shape = out.frames[f.shape || 'wide'] ||= { first: [], last: [] };
    shape[f.role].push(pic(f));
  }
  return out;
}

/* The size at or just above a wanted width (the largest if none is that wide). list: [{ width, url }]. */
export const sizeFor = (list, want) => list.find((s) => s.width >= want) || list[list.length - 1];

/* The frames for a video version: its own shape's, or the other shape's if it has none. */
export const framesFor = (r, v) => r.frames[upright(v) ? 'tall' : 'wide'] || r.frames.wide || r.frames.tall;

/* A Library item's code: 8 hex digits. A file's digest: 64. */
export const CODE = /^[0-9a-f]{8}$/;
export const DIGEST = /^[0-9a-f]{64}$/;

/* An artwork's details line as visitors see it, made from its medium, size and year whenever it's shown (never
   stored): "Oil on canvas, 60 x 90 cm, 2020". The size appears when it's measured, or when size_shown says so;
   a shown estimate is followed by "(est.)". */
export function detailsLine(d) {
  const estimated = !!d.cm && !!d.estimated;
  const shown = !!d.cm && (d.size_shown == null ? !estimated : !!d.size_shown);
  const size = d.cm && shown && `${d.cm[0]} x ${d.cm[1]} cm${estimated ? ' (est.)' : ''}`;
  return [d.medium, size, d.year].filter(Boolean).join(', ');
}
