/* Getting files into storage and the Library (library.js on the server; docs/entities.md, section 2).
   Everything is made here in the browser (edit/darkroom.js does the pixels). A file is stored under the SHA-256
   digest of its bytes, worked out here and checked by storage itself; bytes already stored are never sent again.
   Then the Library is told what the files are: an item's original, or a rendition's files (a picture's sizes and
   link preview; a video's versions and first and last frames). */

import { upright, fileUrl } from '/paths.js';
import { SOURCE_MAX, scaled, resized } from './darkroom.js';
import { MB } from './dom.js';
import { fetchFor, call, known } from './server.js';

export const WIDTHS = [300, 480, 768, 1024, 1536, 2560], PREVIEW = 1200;

/* Sections with bg can have a photo or video behind them (entries bg-<section>; BACKGROUNDS in editor.js, the
   server, must list the same). They fill the window, so their sizes go up to a 4K screen's width. */
const BG_WIDTHS = [768, 1024, 1536, 2560, 3840];
/* A video's first and last frames (once per shape): shown while it loads, where it rests, and to visitors who
   ask for reduced motion. Up to 2560 across and a little more compressed than photos: the video itself takes
   over on larger screens, and a painted frame at 3840 was 3 to 4 megabytes. */
const FRAME_WIDTHS = [768, 1024, 1536, 2560], FRAME_QUALITY = 0.8;

/* The SHA-256 digest of a file's bytes, as 64 hex digits: its name in storage. */
async function digestOf(blob) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* Store a file under its digest, unless those bytes are stored already; returns the digest. more: a video's
   size and length (&w=&h=&seconds=), which the server can't read for itself. */
async function putFile(blob, type, more = '', ms = 120000) {
  const digest = await digestOf(blob);
  if ((await call('GET', `file?digest=${digest}`)).have) return digest;
  const r = await fetchFor(`/edit/api/file?digest=${digest}${more}`, { method: 'PUT', headers: { 'content-type': type }, body: blob }, ms);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Upload failed (${r.status})`);
  return digest;
}

/* Is this photo already in the Library? { file, digest, have (its bytes are stored), item (the code of the item
   it is the original of, or null), name (that item's) }. */
export async function storedFor(file) {
  const digest = await digestOf(file);
  return { file, digest, ...(await call('GET', `file?digest=${digest}`)) };
}

/* Keep a photo as a Library item (its original), unless the same photo already is one, for this painting or
   another: then that item is used. known: storedFor's answer, if already asked. name: the new item's name in
   the Library. thumb: the digest of its small picture, if one was made. Returns { id: the item's code, shared:
   whether it was already an item, name, scene: the id of its newest rendition made as it is, if it has one }. */
export async function keepOriginal(file, name, known_, say, thumb) {
  let k = known_ && known_.file === file ? known_ : null;
  if (!k) { say('Checking whether this photo is already stored…'); k = await storedFor(file); }
  if (!k.have) {
    say('Keeping the original…');
    const r = await fetchFor(`/edit/api/file?digest=${k.digest}`, { method: 'PUT', headers: { 'content-type': file.type || 'image/jpeg' }, body: file }, 120000);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Upload failed (${r.status})`);
  }
  return call('POST', 'library/new', { kind: 'photo', name, originals: [k.digest], ...(thumb ? { thumb } : {}) });
}

/* A photo into the Library (step 4, slice 3: the Library is the only upload): only its original is kept, as
   uploaded, with one small picture of it (THUMB pixels across) for the Library's rows and the pickers' tiles.
   Nothing else is made: its sizes come later, from a recipe (a painting squared up in the darkroom, or a site
   picture as it is: sceneRendition). The same photo again is the item it already is. Returns keepOriginal's
   answer. */
const THUMB = 480;
export async function libraryPhoto(file, name, say) {
  const src = await photoOf(file, say);
  say('Making its small picture…');
  const thumb = await putFile(await resized(src, Math.min(src.width, THUMB), 0.8), 'image/jpeg');
  return keepOriginal(file, name, null, say, thumb);
}

/* A photo item's original, read back from storage (only the signed-in editor can). */
export async function originalOf(item) {
  const got = await fetchFor(`/edit/api/original?item=${item}`, {}, 120000);
  if (!got.ok) throw new Error((await got.json().catch(() => ({}))).error || `Couldn't fetch the original (${got.status})`);
  return got.blob();
}

/* A site picture from a photo item: a rendition of sizes (BG_WIDTHS) made from its original as it is (recipe
   kind scene: no settings yet). Returns the rendition. */
export async function sceneRendition(item, say) {
  say('Fetching the original…');
  const src = await photoOf(await originalOf(item), say);
  const files = await storeSizes(src, say);
  const { rendition } = await call('POST', 'library/rendition', { item, kind: 'scene', files });
  return known(rendition);
}

/* A photo into the Library as it is (a photograph, not a painting: no white balance or corners): its original,
   and a rendition of sizes (BG_WIDTHS) made from it. If the same photo is already there with such a rendition,
   that one is used. Returns { rendition: its id }. */
export async function photoItem(file, name, say) {
  const src = await photoOf(file, say);
  const { id, scene } = await keepOriginal(file, name, null, say);
  if (scene) return { rendition: scene };
  const files = await storeSizes(src, say);
  const { rendition } = await call('POST', 'library/rendition', { item: id, kind: 'scene', files });
  return { rendition: known(rendition).id };
}

/* Video files into the Library: each checked (videoFacts) and stored as made; a new item (id null), or more
   versions of an existing one. have: the rendition the versions are added to (its versions and frames are kept),
   or null. Then a new rendition: every version, with first and last frames for each shape (withFrames).
   Returns { rendition (as media.js describes it), notes }. */
export async function videoItem(id, name, files, have, say) {
  const added = [], notes = [];
  const best = {};    // shape -> the largest so far, whose frames are kept (a 4K frame is about 45 megabytes in memory)
  for (const v of (have ? have.versions : [])) if (!best[upright(v)] || v.w > best[upright(v)].w) best[upright(v)] = v;
  for (const [i, file] of files.entries()) {
    const tell = files.length > 1 ? (t) => say(`Video ${i + 1} of ${files.length}: ${t}`) : say;
    const facts = await videoFacts(file, tell);
    const shape = upright(facts), was = best[shape];
    if (!was || facts.w > was.w) { if (was && 'first' in was) { was.first = was.last = null; } best[shape] = facts; }
    else { facts.first = facts.last = null; }
    added.push({ file, facts });
    notes.push(...facts.notes.map((n) => (files.length > 1 ? `${facts.w} × ${facts.h}: ${n}` : n)));
  }
  const versions = have ? have.versions.map((v) => ({ digest: v.digest, w: v.w, h: v.h })) : [], grabbed = new Map(), fresh = [];
  for (const [i, { file, facts }] of added.entries()) {
    say(`Uploading ${files.length > 1 ? `video ${i + 1} of ${files.length}` : 'the video'} (${MB(file.size)})…`);
    const digest = await putFile(file, 'video/mp4', `&w=${facts.w}&h=${facts.h}&seconds=${facts.seconds}`, 15 * 60000);
    if (versions.some((v) => v.digest === digest)) continue;       // the very same file again
    grabbed.set(digest, facts);
    versions.push({ digest, w: facts.w, h: facts.h }); fresh.push(digest);
  }
  if (!id) id = (await call('POST', 'library/new', { kind: 'video', name, originals: fresh })).id;
  else for (const digest of fresh) await call('POST', 'library/original', { id, digest });
  return { rendition: await videoRendition(id, versions, have, (v) => grabbed.get(v.digest), say), notes };
}

/* A new rendition of a video item: these versions ([{ digest, w, h }]), with frames for each shape they have. */
export async function videoRendition(id, versions, have, grabbed, say) {
  const frames = await withFrames(versions, have, grabbed, say);
  const { rendition } = await call('POST', 'library/rendition', { item: id, kind: 'video', ...(have ? { recipe: have.recipe } : {}),
    files: [...versions.map((v) => ({ digest: v.digest, role: 'version' })), ...frames] });
  return known(rendition);
}

/* First and last frames for each shape the versions have, as a rendition's files ([{ digest, role, shape }]),
   taken from that shape's largest version: kept from the rendition before (have) if its frames came from that
   same version, otherwise made from what was just read from a new file (grabbed), or read back from the stored
   video. */
async function withFrames(versions, have, grabbed, say) {
  const out = [];
  for (const [shape, up] of [['wide', false], ['tall', true]]) {
    const top = versions.filter((v) => upright(v) === up).sort((a, b) => b.w - a.w)[0];
    if (!top) continue;
    const was = have && have.versions.filter((v) => upright(v) === up).sort((a, b) => b.w - a.w)[0];
    const kept = was && was.digest === top.digest ? have.files.filter((f) => (f.role === 'first' || f.role === 'last') && f.shape === shape) : [];
    if (kept.length) { out.push(...kept.map((f) => ({ digest: f.digest, role: f.role, shape }))); continue; }
    const got = grabbed(top);
    const src = got && got.first ? got : await framesOf(fileUrl({ digest: top.digest, type: 'video/mp4' }), say);
    for (const role of ['first', 'last']) {
      out.push(...(await storeSizes(src[role], say, `${role} frame`, FRAME_WIDTHS, FRAME_QUALITY)).map((f) => ({ digest: f.digest, role, shape })));
    }
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

/* Make JPEG sizes of a picture (BG_WIDTHS, or list; never larger than the picture) and store them; returns them
   as a rendition's files: [{ digest, role: 'size' }]. */
async function storeSizes(src, say, what = 'sizes', list = BG_WIDTHS, quality) {
  const widths = [...new Set(list.filter((w) => w < src.width).concat(Math.min(src.width, list[list.length - 1])))];
  const out = [];
  for (const [n, w] of widths.entries()) {
    say(`Making and uploading the ${what}: ${n + 1} of ${widths.length}`);
    out.push({ digest: await putFile(await resized(src, w, quality), 'image/jpeg'), role: 'size' });
  }
  return out;
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

/* Make every size of a painting's picture from the darkroom's result, store them, and record them as a new
   rendition of the photo's Library item (id): the next one of `recipe` (the recipe re-edited, taking these
   settings), or the first of a new recipe (recipe null; label tells it apart when several things are made from
   one photo). A new rendition each time, so the earlier pictures stay for History. Returns the rendition. */
export async function storeImages(id, recipe, { out, W }, settings, label, say) {
  const widths = [...new Set(WIDTHS.filter((w) => w < W).concat(Math.min(W, WIDTHS[WIDTHS.length - 1])))];
  const jobs = widths.map((w) => ['size', w]).concat([['preview', Math.min(PREVIEW, W)]]);
  const files = [];
  for (const [n, [role, w]] of jobs.entries()) {
    say(`Making and uploading image sizes: ${n + 1} of ${jobs.length}`);
    files.push({ digest: await putFile(await resized(out, Math.min(w, out.width)), 'image/jpeg'), role });
  }
  const { rendition } = await call('POST', 'library/rendition', { item: id, ...(recipe ? { recipe } : { kind: 'flat', label }), settings, files });
  return known(rendition);
}
