/* The darkroom as a form: the steps that make a painting's picture from a photo (edit/darkroom.js does the
   pixels and the full-screen views). */

import { SOURCE_MAX, scaled, whiteBalanced, findPaper, fullView, cropSize, squaredUp, guessCorners, turnOf, describeTurn, wholePhoto, labelled, ordered, FRAME } from './darkroom.js';
import { h, toast } from './dom.js';
import { detailsOf } from './details.js';
import { WIDTHS } from './uploads.js';

/* The steps that make a painting's picture from a photo: white balance, then corners and shape, each a section
   that opens with a tap and shows a summary line while closed, under the photo and the result side by side. Used
   by the add form (sections open once a photo is chosen) and by a painting's Edit form (opts below), where the
   sections start closed with the saved choices summarised, and opening one fetches the original from R2. Then the
   photo is shown small, with the previous and the new results side by side, large; pressing and holding the new
   one shows the previous in its place. The saved choices stay in view as ghosts: a faint mark on each slider,
   faint corners and spots in the full-screen views, and "Back to saved". Its element is kept across re-renders
   of the page; the form it sits in gives it the details fields (height, width, measured or not) with attach().
   opts, for reopening: previous (address of the painting's current picture), saved (its choices, as summarised
   before the original is read), start (load()'s options for those choices) and fetch (resolves with the
   original's { blob, original key }).
   Reopening also offers "Replace photo…", for a better photo or a higher-resolution copy: if its proportions match
   the old original's (the same photo), the corners and white spots carry over (they're fractions of the photo);
   otherwise only the sliders are kept, the corners are guessed afresh and the spots cleared. It says which. The
   new photo is stored as an original with the picture (replacement; storePicture); "Back to saved" returns to the
   old photo and its choices, and their pictures.
   opts.onChange, for reopening: called whenever the result has been made afresh (the form stores it once it rests). */
const fieldsetOf = (...kids) => h('fieldset', { class: 'step-body', disabled: true }, ...kids);
function whiteText(r) {
  const n = (r.spots || []).length;
  if (!r.white || r.white === 'none' || (r.white === 'picks' && !n)) return 'None: as photographed';
  const b = Math.round((r.brightness ?? 1) * 100), w = Math.round((r.warmth ?? 0) * 100);
  return (r.white === 'paper' ? 'The paper made white' : `From ${n} white ${n === 1 ? 'spot' : 'spots'}`)
    + (b !== 100 ? `, white at ${b}%` : '') + (w ? `, keeping ${w}% of the warmth` : '');
}
function cornersText(r) {
  const cropped = !!(r.corners && !wholePhoto(r.corners)), turned = r.corners ? describeTurn(turnOf(r.corners)) : '';
  return (cropped ? 'Cropped and squared up' : 'Whole photo') + (turned ? `, ${turned}` : '')
    + (cropped ? (r.shape ? `, to ${r.shape[0]} × ${r.shape[1]} cm` : ', shape from the photo') : '');
}
export function darkroom(opts = {}) {
  const reopen = !!opts.fetch;
  const g = {};
  let F = {}, p = null, baseline = '', saved = null, startWith = {}, original = null, fetching = null;
  let replacement = null, oldBlob = null, ghost = null;     // ghost: the saved choices that still apply to the photo shown
  let timer;
  const later = (fn, ms = 500) => { clearTimeout(timer); timer = setTimeout(fn, ms); };
  const how = () => ({ brightness: +g.bright.value / 100, warmth: +g.warm.value / 100 });
  const slider = (input, ghost) => h('div', { class: 'slider' }, input, ghost);
  const step = (title, sum, body) => {
    const d = h('details', { class: 'step', ontoggle: () => { if (d.open) need(); } },
      h('summary', {}, h('span', { class: 'step-title' }, title), sum), body);
    return d;
  };
  const el = h('div', { class: 'dr-form' },
    g.compare = h('div', { class: 'compare', hidden: true, title: 'Tap to make bigger or smaller', onclick: () => g.compare.classList.toggle('big') }),
    g.steps = h('div', { class: 'steps', hidden: !reopen },
      g.whiteBox = step('White balance', g.whiteSum = h('span', { class: 'step-sum muted' }), g.whiteBody = fieldsetOf(
        h('div', { class: 'row' },
          h('span', { class: 'grow' }),
          h('button', { type: 'button', title: 'Place white spots round the margins of a drawing on white paper', onclick: () => findSpots() }, 'Find the paper'),
          g.spotsBtn = h('button', { type: 'button', onclick: () => pickSpots() }, 'Pick white…')),
        g.sliders = h('div', { class: 'sliders' },
          h('label', {}, 'Brightness of the white ', g.brightOut = h('span', { class: 'muted' })),
          slider(g.bright = h('input', { type: 'range', min: 50, max: 100, step: 1, value: 100, oninput: () => slid() }),
            g.brightGhost = h('span', { class: 'ghost', hidden: true, title: 'As it was when opened' })),
          h('label', {}, 'Keep the light\'s warmth ', g.warmOut = h('span', { class: 'muted' })),
          slider(g.warm = h('input', { type: 'range', min: 0, max: 100, step: 1, value: 0, oninput: () => slid() }),
            g.warmGhost = h('span', { class: 'ghost', hidden: true, title: 'As it was when opened' }))))),
      g.cornerBox = step('Corners', g.cornerSum = h('span', { class: 'step-sum muted' }), g.cornerBody = fieldsetOf(
        h('div', { class: 'row' },
          g.cornersNote = h('span', { class: 'grow muted' }),
          h('button', { type: 'button', onclick: () => setCorners() }, 'Set corners…'),
          g.wholeBtn = h('button', { type: 'button', onclick: () => {
            if (!p) return;
            const t = turnOf(p.corners);                                  // keep which way up, take in the whole photo
            p.corners = t.r || t.m ? labelled(ordered(FRAME), t.r, t.m) : null; update();
          } }, 'Whole photo')),
        g.shapeRow = h('label', { class: 'tick' }, g.shape = h('input', { type: 'checkbox', checked: true, onchange: () => update() }),
          g.shapeTick = h('span', {})),
        g.shapeText = h('p', { class: 'hint shape-note' })))),
    h('div', { class: 'row dr-foot' },
      g.status = h('p', { class: 'hint grow' }),
      g.pickFile = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: () => replace(g.pickFile.files[0]) }),
      g.replaceBtn = h('button', { type: 'button', hidden: !reopen, title: 'Use a better photo, or a higher-resolution copy, of this painting', onclick: () => g.pickFile.click() }, 'Replace photo…'),
      g.back = h('button', { type: 'button', hidden: true, title: 'Put every choice back as it was when you opened it (and the photo, if replaced)', onclick: () => backToSaved() }, 'Back to as it was')),
    g.replaceNote = h('p', { class: 'hint stored-note' }));
  function slid() {
    g.brightOut.textContent = `${g.bright.value}%: ${+g.bright.value === 100 ? 'pure white' : 'a light grey'}`;
    g.warmOut.textContent = `${g.warm.value}%${+g.warm.value === 0 ? ': cast fully removed' : ''}`;
    later(update, 250);
  }
  slid(); clearTimeout(timer);

  /* The painting's picture as it is now (reopening), in a figure. */
  const previous = () => h('img', { class: 'shot', src: opts.previous, alt: '', draggable: false });
  if (reopen) {
    g.whiteSum.textContent = whiteText(opts.saved); g.cornerSum.textContent = cornersText(opts.saved);
    g.compare.hidden = false; g.compare.classList.add('one');
    g.compare.append(h('figure', {}, previous(), h('figcaption', {}, 'As it is now')));
  }

  /* Reopening: the first section opened fetches the original and reads it. */
  function need() {
    if (!reopen || p || fetching) return fetching;
    fetching = (async () => {
      g.status.textContent = 'Fetching the original…';
      try {
        const got = await opts.fetch();
        original = got.original; oldBlob = got.blob;
        if (!(await load(got.blob, opts.start))) throw new Error('This browser can\'t read the original');
      } catch (err) {
        g.status.textContent = ''; g.whiteBox.open = g.cornerBox.open = false; toast(err.message, true);
      } finally { fetching = null; }
    })();
    return fetching;
  }

  /* Replace the photo (see above). The old original is read first, if it hasn't been, to compare proportions. */
  async function replace(file) {
    g.pickFile.value = '';
    if (!file) return;
    g.replaceBtn.disabled = true;
    try {
      if (!p && !replacement) await need();
      const before = p ? { W: p.W, H: p.H, rec: record('') } : null;
      const was = before ? before.rec : (opts.start.process || { white: opts.saved.white });
      const sliders = was.white && was.white !== 'none' ? { brightness: was.brightness ?? 1, warmth: was.warmth ?? 0 } : {};
      let same = false;
      const ok = await load(file, (q) => {
        same = !!before && Math.abs(Math.log((q.W / q.H) / (before.W / before.H))) < 0.005;   // within half a per cent
        return same ? { process: was } : { ...sliders, guess: true };
      }, true);
      if (!ok) {                                           // unreadable: back to what was there
        if (oldBlob) { replacement = null; await load(oldBlob, opts.start); }
        return;
      }
      replacement = file;
      ghost = same ? saved : saved && { brightness: saved.brightness, warmth: saved.warmth };
      const had = (was.spots || []).length, hadCrop = !!(was.corners && !wholePhoto(was.corners));
      const kept = [hadCrop && 'the corners', had && 'the white spots', sliders.brightness != null && 'the sliders'].filter(Boolean);
      const and = (a) => a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}` : a[0];
      g.replaceNote.textContent = !before
        ? 'The old photo couldn\'t be read, so nothing was compared: the corners are a fresh guess.'
        : same
          ? `Same proportions as the old photo${kept.length ? `: kept ${and(kept)}` : ''}. It's stored, as a draft, straight away.`
          : `Different proportions from the old photo: ${sliders.brightness != null ? 'kept the sliders, ' : ''}guessed the corners afresh${had ? ' and cleared the white spots' : ''}. It's stored, as a draft, straight away.`;
      await update();
    } finally { g.replaceBtn.disabled = false; }
  }
  async function backToSaved() {
    if (!p) return;
    if (!replacement) { apply(startWith); update(); return; }
    if (!oldBlob) return;
    replacement = null; g.replaceNote.textContent = '';
    await load(oldBlob, opts.start);
  }

  /* Read a photo (a File, or the original's Blob from R2). With a process record, its choices are put back as
     they were; without one, it starts from the best guess at the painting's corners. */
  async function load(blob, start = {}, replacing = false) {
    p = null;
    if (!replacing) { baseline = ''; saved = null; ghost = null; replacement = null; g.replaceNote.textContent = ''; }
    if (!reopen) g.steps.hidden = true;
    g.status.textContent = 'Reading the photo…';
    const img = new Image();
    img.src = URL.createObjectURL(blob);
    try { await img.decode(); } catch {
      g.status.textContent = 'This browser can\'t read that photo. On a Mac, Chrome can\'t open HEIC: use Safari, or export it as JPEG.';
      return false;
    }
    const W = img.naturalWidth, H = img.naturalHeight, k = Math.min(1, SOURCE_MAX / Math.max(W, H));
    // One working copy, at most SOURCE_MAX pixels along its longer side: everything is made from it.
    p = { W, H, src: scaled(img, Math.round(W * k)), spots: [], corners: null, white: null };
    URL.revokeObjectURL(img.src);
    p.guess = guessCorners(p.src);
    const choices = typeof start === 'function' ? start(p) : start;
    if (!replacing) startWith = choices;
    apply(choices);
    g.whiteBody.disabled = g.cornerBody.disabled = false;
    g.steps.hidden = false;
    if (!reopen) g.whiteBox.open = g.cornerBox.open = true;          // adding: both open
    await update();
    if (replacing) return true;                                      // the saved choices stay as they were
    baseline = JSON.stringify(record(''));
    if (reopen) { saved = ghost = JSON.parse(baseline); ghosts(); }
    g.back.hidden = true;
    return true;
  }
  /* Put the controls to the choices load() was given. */
  function apply({ process, white = 'none', guess = true, brightness = 1, warmth = 0 } = {}) {
    if (process) {
      p.spots = process.white === 'picks' ? (process.spots || []).map((q) => q.slice()) : [];
      g.bright.value = Math.round((process.brightness ?? 1) * 100); g.warm.value = Math.round((process.warmth ?? 0) * 100);
      p.corners = process.corners ? process.corners.map((q) => q.slice()) : null;
      g.shape.checked = !!process.shape || !process.corners;      // as it was made
    } else {
      g.shape.checked = true;
      g.bright.value = Math.round(brightness * 100); g.warm.value = Math.round(warmth * 100);
      p.corners = guess && p.guess && !wholePhoto(p.guess) ? p.guess : null;   // a new photo: start from the guess
      p.spots = white === 'paper' ? findPaper(p.src, p.corners) : [];       // a drawing on white paper: find the paper
    }
    slid(); clearTimeout(timer);
  }
  /* Faint marks on the sliders where the saved choices have them (the range's thumb is about 16 pixels wide). */
  function ghosts() {
    const mark = (ghost, input, v) => {
      const f = (v - +input.min) / (+input.max - +input.min);
      ghost.style.left = `calc(8px + (100% - 16px) * ${f})`; ghost.hidden = false;
    };
    mark(g.brightGhost, g.bright, Math.round((saved.brightness ?? 1) * 100));
    mark(g.warmGhost, g.warm, Math.round((saved.warmth ?? 0) * 100));
  }

  async function pickSpots() {
    if (!p) return;
    const r = await fullView(p.src, 'spots', p.spots, null, ghost && ghost.spots, () => findPaper(p.src, p.corners));
    if (r) p.spots = r;                               // done: the spots decide (none = no white balance)
    update();
  }
  /* Spots round the painting's margins, for a drawing on white paper (darkroom.js findPaper). */
  function findSpots() {
    if (!p) return;
    p.spots = findPaper(p.src, p.corners);
    update();
  }
  /* The white balance follows from the spots: none without any. */
  const white = () => (p && p.spots.length ? 'picks' : 'none');
  async function setCorners() {
    if (!p) return;
    await busy('Getting the full-size view ready…');
    const r = await fullView(balanced().canvas, 'corners', p.corners, p.guess, ghost && ghost.corners);
    if (r) {
      const t = turnOf(r);
      p.corners = wholePhoto(r) && !t.r && !t.m ? null : r;          // the whole photo, as it is: nothing to do
    }
    update();
  }
  function balanced() {
    const key = `${white()}|${JSON.stringify(p.spots)}|${g.bright.value}|${g.warm.value}`;
    if (!p.white || p.white.key !== key) p.white = { key, ...whiteBalanced(p.src, white(), p.spots, how()) };
    return p.white;
  }
  const cropped = () => !!(p && p.corners && !wholePhoto(p.corners));
  /* The shape the picture is squared up to: the measured size's (if measured and ticked: the tick shows only when
     measured), or none, when the photo's perspective decides. The size is kept to a tenth of a centimetre, so a
     10 x 5.5 painting is squared up as 10 x 5.5, never rounded to whole centimetres. */
  function shapeLine() {
    const det = F.height ? detailsOf(F) : { error: 1 }, size = det.error ? null : det.cm;
    const measured = !!(F.estimated && !F.estimated.checked && size);
    g.shapeRow.hidden = !(p && cropped() && measured);
    if (measured) g.shapeTick.textContent = `Square up to its measured proportions, ${size[0]} × ${size[1]} centimetres`;
    const use = measured && g.shape.checked && cropped();
    g.shapeText.textContent = !p || !cropped() || use ? '' : 'Shape: from the photo\'s perspective';
    return use ? size : null;
  }
  const busy = (text) => { g.status.textContent = text; return new Promise((ok) => requestAnimationFrame(() => setTimeout(ok, 30))); };

  /* Pressing and holding the new result shows the previous one in its place (a blink comparison); a short tap
     still makes the pictures bigger or smaller. */
  function holdable(shot) {
    const NEW = 'New: press and hold to see the previous', cap = h('figcaption', {}, NEW);
    const over = h('img', { class: 'over', src: opts.previous, alt: '', draggable: false, hidden: true });
    const wrap = h('div', { class: 'hold', title: 'Press and hold to see the previous picture here' }, shot, over);
    let t = null, held = false;
    wrap.addEventListener('pointerdown', () => {
      held = false; clearTimeout(t);
      t = setTimeout(() => { held = true; over.hidden = false; cap.textContent = 'Previous: let go to see the new one'; }, 180);
    });
    const end = () => { clearTimeout(t); over.hidden = true; cap.textContent = NEW; };
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) wrap.addEventListener(ev, end);
    wrap.addEventListener('click', (e) => { if (held) { e.stopPropagation(); held = false; } });   // a hold isn't a tap
    wrap.addEventListener('contextmenu', (e) => e.preventDefault());
    return h('figure', {}, wrap, cap);
  }

  /* Make the picture that will be uploaded from the choices, and show it beside the photo. */
  async function update() {
    if (!p) return;
    g.sliders.hidden = white() === 'none';
    g.spotsBtn.textContent = p.spots.length ? `Change white (${p.spots.length} ${p.spots.length === 1 ? 'spot' : 'spots'})…` : 'Pick white…';
    g.wholeBtn.hidden = !cropped();
    const turned = p.corners ? describeTurn(turnOf(p.corners)) : '';
    g.cornersNote.textContent = (cropped() ? 'Cropped and squared up' : 'Whole photo') + (turned ? `, ${turned}` : '');
    // The picture's proportions as the photo has them (after cropping and turning): when the size isn't measured,
    // the side not typed follows them (F.follow, in detailsFields).
    if (F.follow) {
      let ratio = p.W / p.H;
      if (p.corners) { const [a, b] = cropSize(p.corners.map(([u, v]) => [u * p.W, v * p.H]), null, [p.W / 2, p.H / 2]); ratio = a / b; }
      F.ratio = ratio; F.follow();
    }
    const shape = shapeLine();
    const now = record('');
    g.whiteSum.textContent = whiteText(now); g.cornerSum.textContent = cornersText(now);
    g.back.hidden = replacement ? !oldBlob : !saved || JSON.stringify(now) === baseline;
    await busy('Working…');
    const { canvas: wb, note } = balanced();
    let out, W = p.W, H = p.H;
    if (p.corners) {
      const q = p.corners.map(([u, v]) => [u * wb.width, v * wb.height]);
      const [cw, chh] = cropSize(q, shape, [wb.width / 2, wb.height / 2]), k = wb.width / p.W;      // k: working copy's pixels per original pixel
      W = Math.round(cw / k); H = Math.round(chh / k);                 // the cropped picture at the original's resolution
      const ow = Math.min(W, WIDTHS[WIDTHS.length - 1]);
      out = squaredUp(wb, q, ow, Math.max(1, Math.round(H * ow / W)));
    } else {
      out = scaled(wb, Math.min(W, WIDTHS[WIDTHS.length - 1]));
    }
    Object.assign(p, { out, outW: W, outH: H });
    const shot = (c, quad) => {
      const s = scaled(c, Math.min(c.width, reopen ? 1200 : 800)); s.className = 'shot';
      if (quad) {                                                    // the corners, outlined on the photo
        const x = s.getContext('2d'), q = quad.map(([u, v]) => [u * s.width, v * s.height]);
        x.beginPath(); x.moveTo(...q[0]); q.slice(1).forEach((pt) => x.lineTo(...pt)); x.closePath();
        x.lineWidth = Math.max(2, s.width / 300); x.strokeStyle = 'rgba(0,0,0,0.6)'; x.stroke();
        x.lineWidth /= 2; x.strokeStyle = '#fff'; x.stroke();
        x.beginPath(); x.moveTo(...q[3]); x.lineTo(...q[2]); x.lineWidth *= 2; x.strokeStyle = '#f5c66b'; x.stroke();   // the bottom
      }
      return s;
    };
    g.compare.hidden = false; g.compare.classList.remove('one');
    if (reopen) {
      g.compare.classList.add('reopen');
      g.compare.replaceChildren(h('figure', { class: 'photo' }, shot(p.src, p.corners), h('figcaption', {}, 'Photo')),
        h('figure', {}, previous(), h('figcaption', {}, 'Previous')), holdable(shot(out)));
    } else {
      g.compare.replaceChildren(h('figure', {}, shot(p.src, p.corners), h('figcaption', {}, 'Before')),
        h('figure', {}, shot(out), h('figcaption', {}, 'After: this is what will be used')));
    }
    g.status.textContent = `${W} × ${H} pixels.${note ? ' ' + note : ''}`;
    if (opts.onChange) opts.onChange();             // reopened: the painting's form stores the picture once it rests
  }

  /* The choices, as saved with the painting (editor.js processOf on the server). */
  function record(original) {
    const shape = shapeLine();
    const w = white();
    return { original, white: w,
      ...(w === 'picks' ? { spots: p.spots } : {}),
      ...(w !== 'none' ? how() : {}),
      ...(p.corners ? { corners: p.corners } : {}), ...(shape ? { shape } : {}) };
  }
  return {
    el, load, record, shapeLine,
    attach(f) { F = f; },
    sizeChanged() { if (p) later(update); else shapeLine(); },
    get ready() { return !!(p && p.out); },
    get white() { return white(); },
    get original() { return original; },
    get replacement() { return replacement; },        // a new photo, to be stored as the original on saving
    result() { return { out: p.out, W: p.outW, H: p.outH }; },
    changed() { return !!p && (!!replacement || JSON.stringify(record('')) !== baseline); },   // since it was loaded
    say(text) { g.status.textContent = text; },
  };
}
