/* A photo's size in pixels, read from the start of its file, without decoding it (the free plan gives a Worker
   10 ms of CPU, far too little to decode a photo; reading a header takes well under one). For the Library's
   originals (library.js), which are stored untouched, so their size is whatever the camera or phone wrote.

   Sizes are as the photo is seen: a JPEG whose EXIF says it is turned a quarter (orientation 5 to 8), or a HEIC
   with a quarter-turn (irot), has its width and height swapped, as browsers show it.
   JPEG, PNG, WebP, HEIC/HEIF/AVIF; anything else (TIFF) gives null. */

export const HEAD_BYTES = 512 * 1024;   // enough for any header seen, even after a large EXIF thumbnail

export function dimensions(buf) {
  const u = new Uint8Array(buf);
  if (u.length < 30) return null;
  const be16 = (i) => (u[i] << 8) | u[i + 1];
  const be32 = (i) => ((u[i] << 24) >>> 0) + (u[i + 1] << 16) + (u[i + 2] << 8) + u[i + 3];
  const le16 = (i) => u[i] | (u[i + 1] << 8);
  const le24 = (i) => u[i] | (u[i + 1] << 8) | (u[i + 2] << 16);
  const text = (i, n) => String.fromCharCode(...u.subarray(i, i + n));

  if (u[0] === 0x89 && text(1, 3) === 'PNG') return { w: be32(16), h: be32(20) };

  if (text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') {
    const kind = text(12, 4);
    if (kind === 'VP8 ') return { w: le16(26) & 0x3fff, h: le16(28) & 0x3fff };
    if (kind === 'VP8L') return { w: 1 + (((u[22] & 0x3f) << 8) | u[21]), h: 1 + (((u[24] & 0x0f) << 10) | (u[23] << 2) | ((u[22] & 0xc0) >> 6)) };
    if (kind === 'VP8X') return { w: 1 + le24(24), h: 1 + le24(27) };
    return null;
  }

  if (u[0] === 0xff && u[1] === 0xd8) {
    let turned = false;
    for (let i = 2; i + 9 < u.length;) {
      if (u[i] !== 0xff) return null;
      const m = u[i + 1];
      if (m === 0xff) { i++; continue; }                        // fill byte
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      const len = be16(i + 2);
      if (m === 0xe1 && text(i + 4, 6) === 'Exif\0\0') turned = quarterTurn(u, i + 10, i + 2 + len);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(m)) {
        const h = be16(i + 5), w = be16(i + 7);
        return turned ? { w: h, h: w } : { w, h };
      }
      i += 2 + len;
    }
    return null;
  }

  if (text(4, 4) === 'ftyp') {
    // HEIC, HEIF, AVIF: the image spatial extents (ispe) boxes; the largest is the whole picture (the others are
    // tiles or thumbnails); irot turns it in quarters.
    let best = null, turned = false;
    for (let j = 8; j + 16 < u.length; j++) {
      if (u[j] === 0x69 && u[j + 1] === 0x73 && u[j + 2] === 0x70 && u[j + 3] === 0x65) {          // ispe
        const w = be32(j + 8), h = be32(j + 12);
        if (w && h && (!best || w * h > best.w * best.h)) best = { w, h };
      } else if (u[j] === 0x69 && u[j + 1] === 0x72 && u[j + 2] === 0x6f && u[j + 3] === 0x74) {   // irot
        turned = (u[j + 4] & 3) % 2 === 1;
      } else if (u[j] === 0x6d && u[j + 1] === 0x64 && u[j + 2] === 0x61 && u[j + 3] === 0x74) {   // mdat: the picture data
        break;
      }
    }
    return best && (turned ? { w: best.h, h: best.w } : best);
  }
  return null;
}

/* Whether a JPEG's EXIF orientation (tag 0x0112 in its first directory) turns it a quarter: 5 to 8. */
function quarterTurn(u, t, end) {
  if (t + 8 > end) return false;
  const le = u[t] === 0x49;                                     // 'II' little-endian, 'MM' big
  const r16 = (i) => (le ? u[i] | (u[i + 1] << 8) : (u[i] << 8) | u[i + 1]);
  const r32 = (i) => (le ? (u[i] | (u[i + 1] << 8) | (u[i + 2] << 16)) + u[i + 3] * 16777216 : u[i] * 16777216 + ((u[i + 1] << 16) | (u[i + 2] << 8) | u[i + 3]));
  const ifd = t + r32(t + 4);
  if (ifd + 2 > end) return false;
  const n = r16(ifd);
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > end) break;
    if (r16(e) === 0x0112) { const o = r16(e + 8); return o >= 5 && o <= 8; }
  }
  return false;
}
