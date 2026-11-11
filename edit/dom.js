/* The editor's building blocks for the page: finding and making elements, its symbols, and the message at the
   bottom. Page elements are built with textContent, never from strings of HTML, so nothing typed in can become
   part of the page. Imports nothing. */

export const $ = (s) => document.querySelector(s);
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k instanceof Node ? k : String(k));
  return el;
}

/* The editor's symbols: one path each, drawn in the text's colour. */
export const glyph = (d, size = 18) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 20 20'); svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '1.5'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
  svg.append(p);
  return svg;
};
export const GLYPHS = {
  bin: 'M3.5 5.5h13M8 5.5V3.5h4v2M5 5.5l1 11h8l1-11M8.5 8.5v5.5M11.5 8.5v5.5',
  tick: 'M4 10.5l4 4L16 6',
  star: 'M10 2.8l2.2 4.6 5 .6-3.7 3.4 1 5-4.5-2.5-4.5 2.5 1-5L2.8 8l5-.6z',             // Featured (filled when so)
  eye: 'M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10zM10 7.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8z',   // on the site
  hidden: 'M2.5 8.5c2 2.7 4.6 4.1 7.5 4.1s5.5-1.4 7.5-4.1M5.2 11.4l-1.5 1.9M10 12.6v2.4M14.8 11.4l1.5 1.9',       // a closed eye: hidden
  play: 'M7 5v10l8-5z',
  photo: 'M3 4.5h14v11H3zM3 13l4-4 3.5 3.5L13 10l4 4M13 7.5h.01',
  sizes: 'M2.5 9.5h7v7h-7zM11.5 5.5h6v6h-6zM11.5 14h3v2.5h-3z',                        // a few sizes of one picture
  frames: 'M3 4.5h14v11H3zM7 4.5v11M13 4.5v11',                                     // a strip of frames
  add: 'M10 4v12M4 10h12',
  compare: 'M2.5 4.5h6.5v11H2.5zM11 4.5h6.5v11H11',                                 // two side by side
  blink: 'M4 3.5h9v9H4zM7 7.5h9v9H7',                                                 // one over the other
  swap: 'M4 7h12l-3-3M16 13H4l3 3',                                                    // arrows both ways
  fit: 'M8 8 2.5 2.5M2.5 7V2.5H7M12 8l5.5-5.5M13 2.5h4.5V7M8 12l-5.5 5.5M2.5 13v4.5H7M12 12l5.5 5.5M17.5 13v4.5H13',
  pause: 'M7 4.5v11M13 4.5v11',
  close: 'M5 5l10 10M15 5L5 15',
  live: 'M10 6.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',                                // published
  draft: 'M4 16l1-4 8-8 3 3-8 8zM11.5 5.5l3 3',                                        // a pencil: in a draft
  past: 'M3.5 10a6.5 6.5 0 1 0 2-4.7M3.5 3.5v3h3M10 6.5V10l2.5 1.5',                    // a clock turning back: History
};

let toastTimer;
export function toast(text, error) {
  const t = $('#toast');
  t.textContent = text; t.className = 'show' + (error ? ' error' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = ''; }, error ? 6000 : 2500);
}

export const MB = (b) => `${(b / 1048576).toFixed(1)} megabytes`;
