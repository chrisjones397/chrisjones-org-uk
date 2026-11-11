/* Getting files into storage (R2), as Library items: a photo's original and the sizes made from it, a painting's
   picture as its photo's next rendition, a video's versions and their first and last frames. Everything is made
   here in the browser (edit/darkroom.js does the pixels) and stored through /edit/api/upload. */

import { upright } from '/paths.js';
import { SOURCE_MAX, scaled, resized } from './darkroom.js';
import { MB } from './dom.js';
import { fetchFor, call } from './server.js';

export const WIDTHS = [300, 480, 768, 1024, 1536, 2560], PREVIEW = 1200;

/* Sections with bg can have a photo or video behind them (entries bg-<section>; BACKGROUNDS in editor.js, the
   server, must list the same). They fill the window, so their sizes go up to a 4K screen's width. */
const BG_WIDTHS = [768, 1024, 1536, 2560, 3840];
/* A video's first and last frames (paths.js: once per shape): shown while it loads, where it rests, and to
   visitors who ask for reduced motion. Up to 2560 across and a little more compressed than photos: the video
   itself takes over on larger screens, and a painted frame at 3840 was 3 to 4 megabytes. */
const FRAME_WIDTHS = [768, 1024, 1536, 2560], FRAME_QUALITY = 0.8;

/* A photo as a new Library item (or the item it already is, if the same photo is stored): kept as uploaded, with a
   set of sizes made from it (BG_WIDTHS). Returns what a background uses of it. */
export async function photoItem(file, name, grp, say) {
  const src = await photoOf(file, say);
  const { id } = await keepOriginal(file, name, null, say, grp);
  const { part } = await call('GET', `library/next?id=${id}&part=r`);
  const widths = await storeSizes(`media/${id}/${part}/`, src, say);
  const top = widths[widths.length - 1], hh = Math.round(src.height * top / src.width);
  await call('POST', 'library/data', { id, data: { renditions: { [part]: { widths, w: top, h: hh, ext: 'jpg' } } } });
  return { media: id, rendition: part, w: top, h: hh, widths };
}

/* Video files into a Library item (id): each checked (videoFacts), uploaded as made (<w>x<h>.mp4), and frames
   kept for each shape from its largest version (withFrames). have: what the background had ({ versions, frames }).
   Returns { versions, frames, notes }; the item's record gets the new versions and frames too. */
export async function videoItem(id, files, have, say) {
  const added = [], notes = [], grabbed = new Map();
  const best = {};    // shape -> the largest so far, whose frames are kept (a 4K frame is about 45 megabytes in memory)
  for (const v of have.versions) if (!best[upright(v)] || v.w > best[upright(v)].w) best[upright(v)] = v;
  for (const [i, file] of files.entries()) {
    const tell = files.length > 1 ? (t) => say(`Video ${i + 1} of ${files.length}: ${t}`) : say;
    const facts = await videoFacts(file, tell);
    const shape = upright(facts), was = best[shape];
    if (!was || facts.w > was.w) { if (was && 'first' in was) { was.first = was.last = null; } best[shape] = facts; }
    else { facts.first = facts.last = null; }
    added.push({ file, facts });
    notes.push(...facts.notes.map((n) => (files.length > 1 ? `${facts.w} × ${facts.h}: ${n}` : n)));
  }
  const versions = [...have.versions], fresh = [];
  for (const [i, { file, facts }] of added.entries()) {
    const { part } = await call('GET', `library/next?id=${id}&part=${facts.w}x${facts.h}`);
    say(`Uploading ${files.length > 1 ? `video ${i + 1} of ${files.length}` : 'the video'} (${MB(file.size)})…`);
    await put(`media/${id}/${part}.mp4`, file, 'video/mp4', 15 * 60000);
    const v = { file: part, w: facts.w, h: facts.h, bytes: file.size, seconds: Math.round(facts.seconds * 100) / 100 };
    grabbed.set(v, facts);
    versions.push(v); fresh.push(v);
  }
  const frames = await withFrames(id, versions, have.frames || {}, (v) => grabbed.get(v), say);
  await call('POST', 'library/data', { id, data: { versions: fresh, frames } });
  return { versions, frames, notes };
}

/* Frames for each shape the versions have ({ wide, tall }: dir, widths, from), taken from its largest version
   (paths.js): kept if they already came from it, otherwise made from what was just read from a new file
   (grabbed), or read back from the stored video, under the next free folder (wide-2...). */
export async function withFrames(id, versions, frames, grabbed, say) {
  const out = {};
  for (const [shape, up] of [['wide', false], ['tall', true]]) {
    const top = versions.filter((v) => upright(v) === up).sort((a, b) => b.w - a.w)[0];
    if (!top) continue;
    if (frames[shape] && frames[shape].from === top.file) { out[shape] = frames[shape]; continue; }
    const got = grabbed(top);
    const src = got && got.first ? got : await framesOf(`/media/${id}/${top.file}.mp4`, say);
    const { part: dir } = await call('GET', `library/next?id=${id}&part=${shape}`);
    const widths = await storeSizes(`media/${id}/${dir}/first-`, src.first, say, 'first frame', FRAME_WIDTHS, FRAME_QUALITY);
    await storeSizes(`media/${id}/${dir}/last-`, src.last, say, 'last frame', FRAME_WIDTHS, FRAME_QUALITY);
    out[shape] = { dir, widths, from: top.file };
  }
  return out;
}

/* A photo (File or Blob) read into a working copy, at most SOURCE_MAX pixels along its longer side. */
async function photoOf(blob, say) {
  say('Reading the photo…');
  const img = new Image();
  img.src = URL.createObjectURL(blob);
  try { await img.decode(); } catch { throw new Error('This browser can\'t read that photo. On a Mac, Chrome can\'t open HEIC: use Safari, or export it as JPEG.'); }
  const W = img.naturalWidth, H = img.naturalHeight, k = Math.min(1, SOURCE_MAX / Math.max(W, H));
  const src = scaled(img, Math.round(W * k));
  URL.revokeObjectURL(img.src);
  return src;
}

/* Make JPEG sizes of a picture (BG_WIDTHS, or list; never larger than the picture) and store them as
   <prefix><width>.jpg (e.g. media/<code>/r1/1536.jpg); returns the widths. */
async function storeSizes(prefix, src, say, what = 'sizes', list = BG_WIDTHS, quality) {
  const widths = [...new Set(list.filter((w) => w < src.width).concat(Math.min(src.width, list[list.length - 1])))];
  let n = 0;
  for (const w of widths) {
    say(`Making and uploading the ${what}: ${++n} of ${widths.length}`);
    try { await put(`${prefix}${w}.jpg`, await resized(src, w, quality), 'image/jpeg'); }
    catch (e) { if (!/already exists/.test(e.message)) throw e; }   // a version's frames made before: the same picture
  }
  return widths;
}

/* Check a video before it's uploaded, and take its first and last frames. Refuses only what won't do: not an MP4,
   or a video this browser can't play. Everything else is guidance (notes), shown under the versions:
   - the codec, from the file's own description (its moov box): H.264 (avc1) plays in every browser; HEVC (hvc1,
     hev1) not in Firefox nor on many Windows and Android devices; AV1 not on older Apple devices;
   - whether its index (moov) comes before the picture data (mdat), so it can start playing before it has all
     arrived ("fast start", "optimise for web"; ffmpeg -movflags +faststart);
   - a sound track, which is never heard (backgrounds play muted) and only adds weight;
   - its length (over 5 seconds needs the pause control, which the site has; past 30, most visitors have moved on);
   - its weight for its size: megabits a second against a guide (1 + 3.5 per 4K screen's worth of pixels; the
     forest video's versions are 0.9 to 4.3), and over 20 megabytes in all. */
async function videoFacts(file, say) {
  say('Checking the video…');
  if (!/\.(mp4|m4v)$/i.test(file.name) && file.type !== 'video/mp4') throw new Error('Choose an MP4 video (H.264 is the one every browser plays).');
  if (file.size > 95 * 1048576) throw new Error(`That video is ${MB(file.size)}: it must be under 95 megabytes (and far less is better for visitors).`);
  const notes = [];
  const boxes = [];
  for (let at = 0; at < file.size && boxes.length < 64;) {
    const b = new DataView(await file.slice(at, at + 16).arrayBuffer());
    if (b.byteLength < 8) break;
    let size = b.getUint32(0);
    const type = String.fromCharCode(b.getUint8(4), b.getUint8(5), b.getUint8(6), b.getUint8(7));
    if (size === 1 && b.byteLength >= 16) size = Number(b.getBigUint64(8));
    else if (size === 0) size = file.size - at;
    if (size < 8) break;
    boxes.push({ type, at, size });
    at += size;
  }
  const moov = boxes.find((b) => b.type === 'moov'), mdat = boxes.find((b) => b.type === 'mdat');
  if (!moov) throw new Error('That doesn\'t look like an MP4 video.');
  const desc = new TextDecoder('latin1').decode(await file.slice(moov.at, moov.at + Math.min(moov.size, 32 * 1048576)).arrayBuffer());
  const codec = ['avc1', 'avc3', 'hvc1', 'hev1', 'av01', 'vp09'].find((c) => desc.includes(c));
  const CODECS = { hvc1: 'HEVC (H.265)', hev1: 'HEVC (H.265)', av01: 'AV1', vp09: 'VP9' };
  if (codec && !codec.startsWith('avc')) notes.push(`It's ${CODECS[codec]}, which some browsers and devices can't play: export it as H.264 so everyone sees it.`);
  if (mdat && mdat.at < moov.at) notes.push('Its index is at the end of the file, so it can\'t start until it has all arrived: export it with "optimise for web" (or "fast start").');
  if (desc.includes('soun')) notes.push('It has a sound track, which is never heard (backgrounds play muted): leaving it out makes the file smaller.');

  const url = URL.createObjectURL(file);
  try {
    const { w, h: hh, seconds, first, last } = await framesOf(url, say);
    const rate = file.size * 8 / seconds / 1e6, guide = 1 + 3.5 * (w * hh) / (3840 * 2160);
    if (seconds > 30) notes.push(`It runs ${Math.round(seconds)} seconds: most visitors will have moved on well before the end.`);
    if (rate > guide * 1.25) notes.push(`It's ${rate.toFixed(1)} megabits a second; about ${guide.toFixed(1)} would do for its size, so it's heavier than it needs to be.`);
    if (file.size > 20 * 1048576) notes.push(`It's ${MB(file.size)}: heavy for a background, especially on a phone's data.`);
    if (Math.max(w, hh) < 1920) notes.push(`At ${w} × ${hh} it will look soft on large screens: fine as a small version, alongside a larger one.`);
    if (!notes.length) notes.push('Checked: it plays everywhere, starts quickly and is a sensible weight for its size.');
    return { w, h: hh, seconds, first, last, notes };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* A video's size, length, and first and last frames (as canvases at full size), from a file's object URL or a
   stored video's address (the editor's own, so the frames can be read). */
async function framesOf(src, say) {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto';
  const event = (name, ms = 60000) => new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error('This browser can\'t play that video: export it as MP4 with H.264.')), ms);
    v.addEventListener(name, () => { clearTimeout(t); ok(); }, { once: true });
    v.addEventListener('error', () => { clearTimeout(t); no(new Error('This browser can\'t play that video: export it as MP4 with H.264.')); }, { once: true });
  });
  const loaded = event('loadeddata');
  v.src = src;
  await loaded;
  const w = v.videoWidth, hh = v.videoHeight, seconds = v.duration;
  if (!w || !hh || !isFinite(seconds)) throw new Error('This browser can\'t read that video\'s size or length.');
  const grab = async (t) => {
    say('Taking its first and last frames…');
    const seeked = event('seeked');
    v.currentTime = t; await seeked;
    const c = document.createElement('canvas'); c.width = w; c.height = hh;
    c.getContext('2d').drawImage(v, 0, 0, w, hh);
    return c;
  };
  const first = await grab(0);
  const last = await grab(Math.max(0, seconds - 0.05));
  v.removeAttribute('src'); v.load();
  return { w, h: hh, seconds, first, last };
}

/* Make every size of a painting's picture from the result and store them as the next set of sizes of its photo's
   Library item (id): media/<code>/r<n>/<width>.jpg and preview.jpg; returns the painting's image fields. A new
   set each time, so the earlier pictures stay for History. */
export async function storeImages(id, { out, W, H }, say) {
  const { part } = await call('GET', `library/next?id=${id}&part=r`);
  const widths = [...new Set(WIDTHS.filter((w) => w < W).concat(Math.min(W, WIDTHS[WIDTHS.length - 1])))];
  const jobs = widths.map((w) => [`${w}.jpg`, w]).concat([['preview.jpg', Math.min(PREVIEW, W)]]);
  let done = 0;
  for (const [fname, w] of jobs) {
    say(`Making and uploading image sizes: ${++done} of ${jobs.length}`);
    await put(`media/${id}/${part}/${fname}`, await resized(out, Math.min(w, out.width)), 'image/jpeg');
  }
  await call('POST', 'library/data', { id, data: { renditions: { [part]: { widths, w: W, h: H, ext: 'jpg' } } } });
  return { w: W, h: H, widths, media: id, rendition: part, ext: 'jpg',
    preview: { src: `media/${id}/${part}/preview.jpg`, w: Math.min(PREVIEW, W), h: Math.round(H * Math.min(PREVIEW, W) / W) } };
}

async function put(key, blob, type, ms = 120000) {
  const r = await fetchFor(`/edit/api/upload?key=${encodeURIComponent(key)}`, { method: 'PUT', headers: { 'content-type': type }, body: blob }, ms);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Upload failed (${r.status})`);
  return r.json();
}

/* Keep a photo as a Library item (its original.<ext>), unless the same photo is already one (found by its content,
   the first 12 hex digits of its SHA-256), for this painting or another: then that item is used. known: storedFor's
   answer, if already asked. name: the item's name in the Library. Returns { key: media/<code> (a painting's process
   record names its original so), id: the code, shared: whether it was already stored }. */
export async function storedFor(file) {
  const hex = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  const hash = hex.slice(0, 12);
  const { key } = await call('GET', `stored?hash=${hash}`);
  return { file, hash, key };
}
export async function keepOriginal(file, name, known, say, grp = 'painting') {
  if (!known) { say('Checking whether this photo is already stored…'); known = await storedFor(file); }
  const { hash, key: have } = known;
  if (have) return { key: have, id: have.slice(6), shared: true };
  const ext = (file.name.match(/\.([a-z0-9]+)$/i) || [0, 'jpg'])[1].toLowerCase().replace(/^jpeg$/, 'jpg');
  const { id } = await call('POST', 'library/new', { kind: 'photo', grp, name, hash });
  say('Keeping the original…');
  await put(`media/${id}/original.${ext}`, file, file.type || 'image/jpeg');
  return { key: `media/${id}`, id, shared: false };
}
