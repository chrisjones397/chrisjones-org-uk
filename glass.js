/* Thick-glass header. Wherever a picture passes under the header (the opening video, the floating gallery, the
   Get in touch photo) the header draws that part of the picture itself: frosted exactly like the normal header
   (saturate 140%, blur 10px, its own tint), plus a rounded glass edge along the bottom that bends the picture
   just beyond it. Where there's no picture under it (plain grey, the profile's head animation) it fades into the
   normal CSS frost, which is also what browsers without WebGL 2 get.

   Each picture is a "source": a video, an image or a canvas, the box it shows in, and how it's fitted into that
   box (object-fit: cover, with its object-position). The header is short, so at most two sources are ever under
   it at once (where one section meets the next); the shader takes two.
   The floating gallery is drawn by gallery.js on its own canvas; after each frame it draws while it's under the
   header, it sends a "glass-frame" event with that canvas, and a shrunken copy is taken here (the glass only
   ever shows it blurred). The video's frames are copied the same way while it plays under the header. */
(function () {
  const BEVEL = 28;        // height of the rounded glass edge, in CSS pixels
  const STRENGTH = 1.7;    // how far the edge bends the picture (times the bevel height)
  const BLUR = 10;         // matches backdrop-filter: blur(10px)
  const SATURATE = 1.4;    // matches saturate(140%)
  const EASE = 160;        // CSS pixels over which the bending eases off as the pictures run out below the header

  const header = document.querySelector('.header');
  if (!header) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'glass-canvas';
  canvas.style.opacity = '0';                        // invisible until it has drawn something
  canvas.setAttribute('aria-hidden', 'true');
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false });
  if (!gl) return;                                   // no WebGL 2: keep the CSS frost
  header.prepend(canvas);

  const vs = `#version 300 es
    in vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;
  const fs = `#version 300 es
    precision highp float;
    uniform sampler2D img0, img1;
    uniform int n;           // how many pictures are under the header (0 to 2)
    uniform vec4 box0, box1;     // each picture's visible box (x, y, w, h), CSS px from the header's top left
    uniform vec4 place0, place1; // where the whole picture lies (it's cropped to cover its box)
    uniform float lod0, lod1;    // texture detail level for the blur
    uniform float shade0, shade1;// any darkening laid over the picture on the page
    uniform vec2 res;        // header size, CSS px
    uniform float dpr;
    uniform float bend;      // 0 to 1
    uniform vec3 bg;         // page colour, for anything under the header that isn't a picture
    uniform float bevel, strength, blur, sat, tint; uniform vec3 tintRGB;
    out vec4 o;
    bool inside(vec2 q, vec4 b) { return q.x >= b.x && q.y >= b.y && q.x <= b.x + b.z && q.y <= b.y + b.w; }
    vec3 pick(vec2 q) {                                        // q: a point, CSS px from the header's top left
      if (n > 0 && inside(q, box0)) return textureLod(img0, (q - place0.xy) / place0.zw, lod0).rgb * (1.0 - shade0);
      if (n > 1 && inside(q, box1)) return textureLod(img1, (q - place1.xy) / place1.zw, lod1).rgb * (1.0 - shade1);
      return bg;
    }
    void main() {
      vec2 q = vec2(gl_FragCoord.x, res.y * dpr - gl_FragCoord.y) / dpr;
      // the rounded bottom edge: looking through it you see the picture from just beyond the edge, squeezed in
      float t = clamp((res.y - q.y) / bevel, 0.0, 1.0);        // 0 at the edge, 1 where the flat glass starts
      float k = (1.0 - t) * (1.0 - t);
      q.y += bend * strength * bevel * k;
      // frost: a soft blur the same size as the CSS one
      vec3 c = vec3(0.0); float wsum = 0.0;
      for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
        vec2 d = vec2(float(i), float(j)) * (blur * 0.5);
        float w = exp(-dot(d, d) / (2.0 * blur * blur));
        c += pick(q + d) * w; wsum += w;
      }
      c /= wsum;
      // saturate(140%), as CSS defines it
      mat3 S = mat3(0.213 + 0.787 * sat, 0.213 - 0.213 * sat, 0.213 - 0.213 * sat,
                    0.715 - 0.715 * sat, 0.715 + 0.285 * sat, 0.715 - 0.715 * sat,
                    0.072 - 0.072 * sat, 0.072 - 0.072 * sat, 0.072 + 0.928 * sat);
      c = clamp(S * c, 0.0, 1.0);
      c = mix(c, tintRGB, tint);                                // the header's own tint colour
      // a faint highlight along the glass edge
      c += bend * (0.16 * pow(1.0 - t, 6.0) + 0.05 * k);
      o = vec4(min(c, 1.0), 1.0);
    }`;
  function sh(type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog); gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = {};
  for (const n of ['img0', 'img1', 'n', 'box0', 'box1', 'place0', 'place1', 'lod0', 'lod1', 'shade0', 'shade1',
                   'res', 'dpr', 'bend', 'bg', 'bevel', 'strength', 'blur', 'sat', 'tint', 'tintRGB'])
    U[n] = gl.getUniformLocation(prog, n);
  const bgRGB = (getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g) || [100, 100, 100]).slice(0, 3).map(v => v / 255);
  gl.uniform3f(U.bg, ...bgRGB);
  gl.uniform1f(U.bevel, BEVEL); gl.uniform1f(U.strength, STRENGTH); gl.uniform1f(U.blur, BLUR);
  gl.uniform1f(U.sat, SATURATE); gl.uniform1i(U.img0, 0); gl.uniform1i(U.img1, 1);
  {   // the tint matches the header's CSS background colour, whatever it is set to
    const v = (getComputedStyle(header).backgroundColor.match(/[\d.]+/g) || [255, 255, 255, 0.4]).map(Number);
    gl.uniform3f(U.tintRGB, v[0] / 255, v[1] / 255, v[2] / 255); gl.uniform1f(U.tint, v.length > 3 ? v[3] : 1);
  }

  // ---- The pictures ----
  const sources = [];
  // el: the picture (video, img or canvas); area: the section it's cut off by; fit: its object-position as
  // fractions; shade: darkening laid over it on the page; live: whether it's showing at the moment
  function source(el, area, fit = [0.5, 0.5], shade = 0, live = () => true) {
    const s = { el, area, fit, shade, live, tex: null, natW: 0, natH: 0, texW: 0 };
    sources.push(s);
    return s;
  }
  const headerHit = (s) => {
    const r = s.el.getBoundingClientRect(), h = header.getBoundingClientRect();
    return r.bottom > h.top && r.top < h.bottom + EASE;
  };
  function upload(s, src, w, h, tw) {                // src: a picture, or a shrunken copy of a frame
    if (!s.tex) {
      s.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, s.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, s.tex);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.generateMipmap(gl.TEXTURE_2D);
    s.natW = w; s.natH = h; s.texW = tw || w;
    request();
  }
  function picture(s, url) {
    const im = new Image();
    im.onload = () => upload(s, im, im.naturalWidth, im.naturalHeight);
    im.src = url;
  }
  // A moving picture's frame, shrunk first to about half its size on screen (copying a whole 4K video frame,
  // or a full-size canvas, to the graphics card every frame made scrolling judder)
  function frame(s, src, vw, vh) {
    if (!vw || !vh) return;
    const b = s.el.getBoundingClientRect();
    const shown = Math.max(b.width / vw, b.height / vh) * vw;           // the picture's width on screen, CSS px
    const sw = Math.min(vw, Math.max(256, Math.ceil(shown / 2))), sh_ = Math.round(vh * sw / vw);
    if (sw >= vw) { upload(s, src, vw, vh); return; }
    if (!s.small) { s.small = document.createElement('canvas'); s.sctx = s.small.getContext('2d'); }
    if (s.small.width !== sw || s.small.height !== sh_) { s.small.width = sw; s.small.height = sh_; }
    s.sctx.drawImage(src, 0, 0, sw, sh_);
    upload(s, s.small, vw, vh, sw);
  }

  // The opening video (or picture): its poster first, then each new frame while it plays under the header
  const hero = document.querySelector('.hero video, .hero img');
  if (hero && hero.tagName === 'VIDEO') {
    const s = source(hero, hero.closest('.hero'));
    if (hero.poster) picture(s, hero.poster);
    const grab = () => { if (hero.readyState >= 2) frame(s, hero, hero.videoWidth, hero.videoHeight); };
    const rvfc = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
    function onFrame() {
      if (headerHit(s)) grab();
      if (rvfc) hero.requestVideoFrameCallback(onFrame);
      else if (!hero.paused && !hero.ended) requestAnimationFrame(onFrame);
    }
    if (rvfc) hero.requestVideoFrameCallback(onFrame);
    else hero.addEventListener('play', () => requestAnimationFrame(onFrame));
    hero.addEventListener('loadeddata', grab);
    hero.addEventListener('seeked', grab);
    hero.addEventListener('ended', grab);           // the finished painting stays under the glass
  } else if (hero) {
    const s = source(hero, hero.closest('.hero'));
    const go = () => picture(s, hero.currentSrc || hero.src);
    if (hero.complete && hero.naturalWidth) go(); else hero.addEventListener('load', go, { once: true });
  }

  // The floating gallery: each frame gallery.js draws under the header (only once the gallery is showing)
  let gallery = null;
  addEventListener('glass-frame', (e) => {
    const c = e.detail;
    if (!gallery) gallery = source(c, c.closest('section') || c, [0.5, 0.5], 0, () => !!c.closest('.gallery-live'));
    frame(gallery, c, c.width, c.height);
  });

  // The Get in touch photo, with the light shade laid over it on the page
  const contact = document.querySelector('.contact-pic');
  if (contact) {
    const cs = getComputedStyle(contact);
    const pos = cs.objectPosition.split(' ').map((v) => (v.endsWith('%') ? parseFloat(v) / 100 : 0.5));
    const veil = getComputedStyle(contact.closest('.contact'), '::after').backgroundColor.match(/[\d.]+/g);
    const s = source(contact, contact.closest('.contact'), pos, veil && veil.length > 3 ? +veil[3] : 0);
    const go = () => picture(s, contact.currentSrc || contact.src);
    if (contact.complete && contact.naturalWidth) go(); else contact.addEventListener('load', go, { once: true });
  }

  // ---- Drawing the header ----
  let queued = false;
  function draw() {
    queued = false;
    const hr = header.getBoundingClientRect();
    // each picture's visible part (cut off by its section, as the parallax moves it within it), top to bottom
    const shown = [];
    for (const s of sources) {
      if (!s.tex || !s.live()) continue;
      const b = s.el.getBoundingClientRect(), a = s.area.getBoundingClientRect();
      const top = Math.max(b.top, a.top), bottom = Math.min(b.bottom, a.bottom);
      if (bottom > top) shown.push({ s, b, top, bottom });
    }
    shown.sort((x, y) => x.top - y.top);
    const under = shown.filter((v) => v.bottom > hr.top && v.top < hr.bottom).slice(0, 2);
    // how much of the header has a picture under it decides the fade into the CSS frost...
    let covered = 0;
    for (const v of under) covered += Math.min(v.bottom, hr.bottom) - Math.max(v.top, hr.top);
    const show = Math.min(Math.max(covered / hr.height, 0), 1);
    // ...and how far the pictures carry on, unbroken, below the header decides the bending
    let reach = hr.bottom;
    for (const v of shown) if (v.top <= reach + 1 && v.bottom > reach) reach = v.bottom;
    const bend = Math.min(Math.max((reach - hr.bottom) / EASE, 0), 1);
    canvas.style.opacity = show.toFixed(3);
    header.classList.toggle('glass-on', show >= 1);                    // the CSS frost isn't needed underneath
    if (show <= 0) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(hr.width * dpr), h = Math.round(hr.height * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.uniform2f(U.res, hr.width, hr.height);
    gl.uniform1f(U.dpr, dpr);
    gl.uniform1f(U.bend, bend);
    gl.uniform1i(U.n, under.length);
    under.forEach((v, i) => {
      const { s, b } = v;
      // the picture is cropped to cover its box (object-fit: cover), placed by its object-position
      const k = Math.max(b.width / s.natW, b.height / s.natH), pw = s.natW * k, ph = s.natH * k;
      gl.uniform4f(U['box' + i], b.left - hr.left, v.top - hr.top, b.width, v.bottom - v.top);
      gl.uniform4f(U['place' + i], b.left - hr.left + (b.width - pw) * s.fit[0], b.top - hr.top + (b.height - ph) * s.fit[1], pw, ph);
      gl.uniform1f(U['lod' + i], Math.max(0, Math.log2(s.texW / pw * BLUR * 0.5)));
      gl.uniform1f(U['shade' + i], s.shade);
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, s.tex);
    });
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  function request() { if (!queued) { queued = true; requestAnimationFrame(draw); } }
  addEventListener('scroll', request, { passive: true });
  addEventListener('resize', request);
  new ResizeObserver(request).observe(header);
})();
