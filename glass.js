/* Thick-glass header over the opening image (a picture, or the painting video), or over the floating
   gallery's canvas (which announces itself with a "glass-source" event and a "glass-frame" after each frame).
   While the header sits over the forest, it draws that part of the picture itself: frosted exactly
   like the normal header (saturate 140%, blur 10px, 40% white), plus a rounded glass edge along the
   bottom that bends the picture. As the picture scrolls away the bending eases off and the drawing
   fades into the normal CSS frost, which is used everywhere else and in any browser without WebGL 2. */
(function () {
  const BEVEL = 28;        // height of the rounded glass edge, in CSS pixels
  const STRENGTH = 1.7;    // how far the edge bends the picture (times the bevel height)
  const BLUR = 10;         // matches backdrop-filter: blur(10px)
  const SATURATE = 1.4;    // matches saturate(140%)
  const EASE = 160;        // CSS pixels of scrolling over which the bending eases off

  const header = document.querySelector('.header');
  if (!header) return;
  const first = document.querySelector('.hero video, .hero img');
  if (first) init(first);
  else addEventListener('glass-source', (e) => init(e.detail), { once: true });

  function init(hero) {
  const isVideo = hero.tagName === 'VIDEO', isCanvas = hero.tagName === 'CANVAS';

  const canvas = document.createElement('canvas');
  canvas.className = 'glass-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false });
  if (!gl) return;                                   // no WebGL 2: keep the CSS frost
  header.prepend(canvas);

  const vs = `#version 300 es
    in vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;
  const fs = `#version 300 es
    precision highp float;
    uniform sampler2D img;
    uniform vec2 res;        // header size, CSS px
    uniform float dpr;
    uniform vec4 box;        // the picture's visible box in the window: x, y, w, h (CSS px)
    uniform vec4 place;      // where the whole picture lies (it is cropped to cover the box)
    uniform float lod;       // texture detail level for the blur
    uniform float bend;      // 0 to 1
    uniform vec3 bg;         // page colour, for anything under the header that isn't the picture
    uniform float bevel, strength, blur, sat, tint; uniform vec3 tintRGB;
    out vec4 o;
    vec3 pick(vec2 q) {                                        // q: a point in the window, CSS px
      if (q.x < box.x || q.y < box.y || q.x > box.x + box.z || q.y > box.y + box.w) return bg;
      return textureLod(img, (q - place.xy) / place.zw, lod).rgb;
    }
    void main() {
      vec2 q = vec2(gl_FragCoord.x, res.y * dpr - gl_FragCoord.y) / dpr;   // CSS px, from the header's top left
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
  const U = {}; for (const n of ['img', 'res', 'dpr', 'box', 'place', 'lod', 'bend', 'bg', 'bevel', 'strength', 'blur', 'sat', 'tint', 'tintRGB'])
    U[n] = gl.getUniformLocation(prog, n);
  const bgRGB = (getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g) || [100, 100, 100]).slice(0, 3).map(v => v / 255);
  gl.uniform3f(U.bg, ...bgRGB);
  gl.uniform1f(U.bevel, BEVEL); gl.uniform1f(U.strength, STRENGTH); gl.uniform1f(U.blur, BLUR);
  gl.uniform1f(U.sat, SATURATE); gl.uniform1i(U.img, 0);
  // the tint matches the header's CSS background colour, whatever it is set to
  function readTint() {
    const v = (getComputedStyle(header).backgroundColor.match(/[\d.]+/g) || [255, 255, 255, 0.4]).map(Number);
    gl.uniform3f(U.tintRGB, v[0] / 255, v[1] / 255, v[2] / 255); gl.uniform1f(U.tint, v.length > 3 ? v[3] : 1);
  }
  readTint();

  let tex = null, natW = 0, natH = 0, texW = 0, queued = false;
  function upload(src, w, h, tw) {                   // src: a picture, or the video's current frame; tw: its width as uploaded
    if (!tex) {
      tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.generateMipmap(gl.TEXTURE_2D);
    natW = w; natH = h; texW = tw || w;
    request();
  }
  function loadPicture(url) {
    const im = new Image();
    im.onload = () => { if (!isVideo || hero.readyState < 2) upload(im, im.naturalWidth, im.naturalHeight); };
    im.src = url;
  }
  const underHeader = () => hero.getBoundingClientRect().bottom > header.getBoundingClientRect().top;
  if (isCanvas) {
    // the gallery's canvas: after each frame it draws, copy a shrunken version (the glass only shows it blurred)
    const small = document.createElement('canvas'), sctx = small.getContext('2d');
    addEventListener('glass-frame', () => {
      const vw = hero.width, vh = hero.height;
      if (!vw || !vh) return;
      const sw = Math.min(vw, Math.max(256, Math.ceil(hero.getBoundingClientRect().width / 2))), sh_ = Math.round(vh * sw / vw);
      if (small.width !== sw || small.height !== sh_) { small.width = sw; small.height = sh_; }
      sctx.drawImage(hero, 0, 0, sw, sh_);
      upload(small, vw, vh, sw);
    });
  } else if (!isVideo) {
    if (hero.complete && hero.naturalWidth) loadPicture(hero.currentSrc || hero.src);
    else hero.addEventListener('load', () => loadPicture(hero.currentSrc || hero.src), { once: true });
  } else {
    // the video: start from its poster, then copy each new frame while it plays (only while the header is over it)
    if (hero.poster) loadPicture(hero.poster);
    // the glass only shows a blurred copy, so each frame is first shrunk to about half the picture's size on screen
    // (in CSS pixels): copying a whole 4K frame to the graphics card every frame made scrolling judder
    const small = document.createElement('canvas'), sctx = small.getContext('2d');
    const grab = () => {
      if (hero.readyState < 2 || !hero.videoWidth) return;
      const vw = hero.videoWidth, vh = hero.videoHeight, b = hero.getBoundingClientRect();
      const shown = Math.max(b.width / vw, b.height / vh) * vw;           // the picture's width on screen, CSS px
      const sw = Math.min(vw, Math.max(256, Math.ceil(shown / 2))), sh_ = Math.round(vh * sw / vw);
      if (sw >= vw) { upload(hero, vw, vh); return; }
      if (small.width !== sw || small.height !== sh_) { small.width = sw; small.height = sh_; }
      sctx.drawImage(hero, 0, 0, sw, sh_);
      upload(small, vw, vh, sw);
    };
    const rvfc = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
    function onFrame() {
      if (underHeader()) grab();
      if (rvfc) hero.requestVideoFrameCallback(onFrame);
      else if (!hero.paused && !hero.ended) requestAnimationFrame(onFrame);
    }
    if (rvfc) hero.requestVideoFrameCallback(onFrame);
    else hero.addEventListener('play', () => requestAnimationFrame(onFrame));
    hero.addEventListener('loadeddata', grab);
    hero.addEventListener('seeked', grab);
    hero.addEventListener('ended', grab);           // the finished painting stays under the glass
  }

  function draw() {
    queued = false;
    if (!tex) return;
    const hr = header.getBoundingClientRect(), b = hero.getBoundingClientRect();
    // the picture can be moved within its section (the parallax); only the part inside the section shows
    const c = (hero.closest('.hero') || hero).getBoundingClientRect();
    const vTop = Math.max(b.top, c.top), vBottom = Math.min(b.bottom, c.bottom);
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(hr.width * dpr), h = Math.round(hr.height * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    // how much of the picture is still under the header decides the bending and the fade
    const under = vBottom - hr.top;                                    // picture left under the header, px
    const bend = Math.min(Math.max((vBottom - hr.bottom) / EASE, 0), 1);
    const show = Math.min(Math.max(under / hr.height, 0), 1);
    canvas.style.opacity = show.toFixed(3);
    header.classList.toggle('glass-on', show >= 1);                    // the CSS frost isn't needed underneath
    if (show <= 0) return;
    // the picture is cropped to cover its box (object-fit: cover), centred
    const s = Math.max(b.width / natW, b.height / natH), pw = natW * s, ph = natH * s;
    gl.viewport(0, 0, w, h);
    gl.uniform2f(U.res, hr.width, hr.height);
    gl.uniform1f(U.dpr, dpr);
    gl.uniform4f(U.box, b.left - hr.left, vTop - hr.top, b.width, vBottom - vTop);
    gl.uniform4f(U.place, b.left - hr.left + (b.width - pw) / 2, b.top - hr.top + (b.height - ph) / 2, pw, ph);
    gl.uniform1f(U.lod, Math.max(0, Math.log2(texW / pw * BLUR * 0.5)));
    gl.uniform1f(U.bend, bend);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  function request() { if (!queued) { queued = true; requestAnimationFrame(draw); } }
  addEventListener('scroll', request, { passive: true });
  addEventListener('resize', request);
  new ResizeObserver(request).observe(header);
  }
})();
