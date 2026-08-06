import type { Child, FC } from 'hono/jsx';

/**
 * Full procedural waterfall of light.
 * Append ?compare=1 to overlay the reference PNG at 32% for visual QA.
 */
const SCRIPT = `
(function () {
  var root = document.querySelector('.waterfall-hero');
  var canvas = document.getElementById('waterfall-canvas');
  if (!root || !canvas || !(canvas instanceof HTMLCanvasElement)) return;
  // Size to the oversized bg layer (not the hero) so parallax never exposes a hard edge.
  var host = root.querySelector('.waterfall-hero__bg') || root;

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return;

  var N = 560;
  var STREAKS = 520;
  var RIPPLES = 170;
  var SPARKS = 130;
  var SCENE_SCALE = 0.68;
  var w = 0, h = 0, dpr = 1;
  var raf = 0, running = false, inView = true, pageVisible = !document.hidden;
  var fibers = [], streaks = [], ripples = [], sparks = [];
  var t0 = performance.now();
  var compare = /(?:^|[?&])compare=1(?:&|$)/.test(location.search);
  var refImg = null;
  if (compare) { refImg = new Image(); refImg.src = '/waterfall-hero.png'; }

  // offscreen scene + bloom mip chain (downscale/upscale = cheap gaussian-ish blur)
  var off = document.createElement('canvas');
  var octx = off.getContext('2d');
  var mip1 = document.createElement('canvas');
  var m1 = mip1.getContext('2d');
  var mip2 = document.createElement('canvas');
  var m2 = mip2.getContext('2d');
  if (!octx || !m1 || !m2) return;

  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }

  function geom(sw, sh) {
    return {
      cx: sw * 0.5,
      height: sh,
      floorY: sh * 0.71,           // where the bell meets the ground plane
      bellY: sh * 0.49,            // where fibers start peeling outward
      col: Math.min(sw, sh) * 0.055,
      bellW: sw * 0.22             // half-width of the bell footprint
    };
  }

  function makeFiber() {
    var g = (Math.random() + Math.random() + Math.random() + Math.random()) / 4;
    var side = g * 2 - 1;
    var sign = side < 0 ? -1 : 1;
    side = sign * Math.pow(Math.abs(side), 0.72);
    if (Math.random() < 0.3) side *= 0.5;
    var core = Math.abs(side) < 0.16;
    return {
      side: side,
      fan: rand(0.8, 1.5),
      phase: Math.random(),
      speed: rand(core ? 0.6 : 0.28, core ? 1.3 : 0.85),
      width: rand(core ? 0.6 : 0.22, core ? 1.35 : 0.7),
      alpha: rand(core ? 0.5 : 0.14, core ? 0.95 : 0.5),
      white: core ? Math.random() < 0.75 : Math.random() < 0.08,
      hot: Math.random() < 0.55,
      len: rand(0.08, core ? 0.22 : 0.14)
    };
  }

  function makeStreak() {
    var g = (Math.random() + Math.random()) / 2;
    var sx = (g * 2 - 1);
    sx = (sx < 0 ? -1 : 1) * Math.pow(Math.abs(sx), 0.8);
    return {
      sx: sx,
      q: Math.random(),
      speed: rand(0.06, 0.24),
      len: rand(0.025, 0.1),
      width: rand(0.22, 0.85),
      alpha: rand(0.08, 0.42),
      white: Math.random() < 0.13
    };
  }

  function makeRipple() {
    return {
      sx: rand(-1, 1),
      q: Math.pow(Math.random(), 1.65),
      span: rand(0.008, 0.04),
      width: rand(0.18, 0.72),
      alpha: rand(0.08, 0.36),
      phase: rand(0, Math.PI * 2),
      tw: rand(0.7, 2.1),
      white: Math.random() < 0.12
    };
  }

  function makeSpark() {
    return {
      sx: rand(-1, 1),
      q: Math.random(),
      r: rand(0.4, 1.7),
      phase: rand(0, Math.PI * 2),
      tw: rand(1.2, 3.6),
      a: rand(0.25, 0.9),
      speed: rand(0.05, 0.16),
      high: Math.random() < 0.22
    };
  }

  /** Fiber path: p 0 top → 0.58 column → 1 trumpet bell. */
  function point(f, p, time, G) {
    var cx = G.cx, col = G.col;
    var sway = Math.sin(time * 0.3 + f.side * 6 + p * 2.2) * col * 0.045;
    var land = (f.side < 0 ? -1 : 1) * Math.pow(Math.abs(f.side), 0.72) * G.bellW * f.fan;

    if (p <= 0.58) {
      var t = p / 0.58;
      return {
        x: cx + sway + f.side * col * (0.82 + t * 0.28),
        y: t * G.bellY,
        depth: 0.12 + t * 0.28
      };
    }
    var u = (p - 0.58) / 0.42;
    var flare = Math.pow(u, 2.65);
    var drop = 1 - Math.pow(1 - u, 2.45);
    var xc = f.side * col * 1.1;
    return {
      x: cx + sway * (1 - u) + xc + (land - xc) * flare,
      y: G.bellY + drop * (G.floorY - G.bellY),
      depth: 0.4 + u * 0.25
    };
  }

  /** Floor streak position: q 0 at horizon → 1 at bottom edge. */
  function floorPt(sx, q, G, sw) {
    var qq = clamp(q, 0.001, 1);
    return {
      x: G.cx + sx * (G.bellW * 0.82 + sw * 0.58 * Math.pow(qq, 1.18)),
      y: G.floorY + Math.pow(qq, 1.7) * (G.height - G.floorY) * 1.04,
      depth: 0.3 + qq * 0.7
    };
  }

  function fiberColor(f, bright, depth) {
    var a = clamp(f.alpha * bright * (0.45 + depth * 0.55), 0, 1);
    if (f.white && bright > 0.5) return 'rgba(255,255,255,' + Math.min(1, a + 0.2) + ')';
    if (f.hot) return 'rgba(120,190,255,' + a + ')';
    return 'rgba(40,110,245,' + a + ')';
  }

  function resize() {
    // clientWidth/Height = layout box before transform (bg is taller than the hero)
    w = Math.max(1, host.clientWidth || Math.floor(root.getBoundingClientRect().width));
    h = Math.max(1, host.clientHeight || Math.floor(root.getBoundingClientRect().height));
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    // Fill the host via CSS inset — do not pin pixel size to the hero viewport
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    off.width = Math.max(1, Math.floor(w * SCENE_SCALE));
    off.height = Math.max(1, Math.floor(h * SCENE_SCALE));
    mip1.width = Math.max(1, Math.floor(off.width / 3));
    mip1.height = Math.max(1, Math.floor(off.height / 3));
    mip2.width = Math.max(1, Math.floor(off.width / 6));
    mip2.height = Math.max(1, Math.floor(off.height / 6));
    fibers = [];
    for (var i = 0; i < N; i++) fibers.push(makeFiber());
    streaks = [];
    for (var j = 0; j < STREAKS; j++) streaks.push(makeStreak());
    ripples = [];
    for (var r = 0; r < RIPPLES; r++) ripples.push(makeRipple());
    sparks = [];
    for (var k = 0; k < SPARKS; k++) sparks.push(makeSpark());
  }

  function atmosphere(c, G, sw, sh) {
    c.globalCompositeOperation = 'lighter';
    var cx = G.cx;

    // vertical haze around the column — full-canvas fill so no seams
    var g1 = c.createRadialGradient(cx, G.floorY * 0.42, 0, cx, G.floorY * 0.42, sh * 0.55);
    g1.addColorStop(0, 'rgba(40,120,255,0.1)');
    g1.addColorStop(0.35, 'rgba(20,70,200,0.035)');
    g1.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g1;
    c.fillRect(0, 0, sw, sh);

    // hot white core running the full column height
    var g2 = c.createLinearGradient(cx - G.col * 0.7, 0, cx + G.col * 0.7, 0);
    g2.addColorStop(0, 'rgba(255,255,255,0)');
    g2.addColorStop(0.5, 'rgba(255,255,255,0.3)');
    g2.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g2;
    c.fillRect(cx - G.col * 0.7, 0, G.col * 1.4, G.floorY);

    // brighter toward the base — tall squashed ellipse hugging the column, no rect seams
    c.save();
    c.translate(cx, G.floorY * 0.78);
    c.scale(0.32, 1);
    var g5 = c.createRadialGradient(0, 0, 0, 0, 0, G.floorY * 0.62);
    g5.addColorStop(0, 'rgba(235,245,255,0.32)');
    g5.addColorStop(0.5, 'rgba(190,225,255,0.1)');
    g5.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g5;
    c.fillRect(-sw * 4, -sh, sw * 8, sh * 2);
    c.restore();

    // impact glow at the base, stretched into the reference's broad landing lip
    c.save();
    c.translate(cx, G.floorY);
    c.scale(1.65, 0.72);
    var g3 = c.createRadialGradient(0, 0, 0, 0, 0, Math.min(sw, sh) * 0.34);
    g3.addColorStop(0, 'rgba(255,255,255,0.55)');
    g3.addColorStop(0.12, 'rgba(220,240,255,0.32)');
    g3.addColorStop(0.3, 'rgba(110,180,255,0.15)');
    g3.addColorStop(0.62, 'rgba(30,90,220,0.05)');
    g3.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g3;
    c.fillRect(-sw, -sh, sw * 2, sh * 2);
    c.restore();

    // bright horizontal landing ridge where the curtain rolls onto the floor
    c.save();
    c.translate(cx, G.floorY);
    c.scale(1, 0.11);
    var g6 = c.createRadialGradient(0, 0, 0, 0, 0, G.bellW * 1.22);
    g6.addColorStop(0, 'rgba(255,255,255,0.72)');
    g6.addColorStop(0.24, 'rgba(220,245,255,0.48)');
    g6.addColorStop(0.6, 'rgba(80,160,255,0.22)');
    g6.addColorStop(1, 'rgba(0,50,180,0)');
    c.fillStyle = g6;
    c.fillRect(-sw, -sh, sw * 2, sh * 2);
    c.restore();

    // floor wash — squashed radial for the lit ground plane
    c.save();
    c.translate(cx, G.floorY + (sh - G.floorY) * 0.35);
    c.scale(1, 0.32);
    var g4 = c.createRadialGradient(0, 0, 0, 0, 0, sw * 0.75);
    g4.addColorStop(0, 'rgba(90,160,255,0.2)');
    g4.addColorStop(0.45, 'rgba(30,90,210,0.08)');
    g4.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g4;
    c.fillRect(-sw, -sh, sw * 2, sh * 2);
    c.restore();

    c.globalCompositeOperation = 'source-over';
  }

  function drawFibers(c, time, G) {
    c.globalCompositeOperation = 'lighter';
    c.lineCap = 'round';
    c.lineJoin = 'round';
    var steps = 42;

    for (var i = 0; i < fibers.length; i++) {
      var f = fibers[i];
      var head = (f.phase + time * f.speed) % 1;

      // persistent fiber — the dense curtain
      c.beginPath();
      for (var s = 0; s <= steps; s++) {
        var pt = point(f, s / steps, time, G);
        if (s === 0) c.moveTo(pt.x, pt.y); else c.lineTo(pt.x, pt.y);
      }
      c.globalAlpha = 1;
      c.strokeStyle = fiberColor(f, 0.5, 0.45);
      c.lineWidth = f.width * 0.6;
      c.stroke();

      // pulse traveling down and out into the foreground
      for (var s2 = 0; s2 < steps; s2++) {
        var p0 = s2 / steps;
        var d = Math.min(Math.abs(p0 - head), Math.abs(p0 - head + 1), Math.abs(p0 - head - 1));
        var bright = 1 - clamp(d / f.len, 0, 1);
        bright = bright * bright;
        if (bright < 0.08) continue;
        var a = point(f, p0, time, G);
        var b = point(f, (s2 + 1) / steps, time, G);
        var depth = (a.depth + b.depth) * 0.5;
        c.beginPath();
        c.moveTo(a.x, a.y);
        c.lineTo(b.x, b.y);
        c.strokeStyle = fiberColor(f, 0.45 + bright * 0.7, depth);
        c.lineWidth = f.width * (0.6 + depth * 1.4) * (0.7 + bright * 0.7);
        c.stroke();
      }
    }
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
  }

  function drawStreaks(c, time, G, sw) {
    c.globalCompositeOperation = 'lighter';
    c.lineCap = 'round';
    for (var i = 0; i < streaks.length; i++) {
      var s = streaks[i];
      var q = (s.q + time * s.speed) % 1.1;
      if (q > 1) continue;
      var a = floorPt(s.sx, q, G, sw);
      var b = floorPt(s.sx, Math.min(1, q + s.len), G, sw);
      var fade = smooth(q / 0.12) * (1 - smooth((q - 0.85) / 0.15));
      c.globalAlpha = s.alpha * fade * (0.35 + a.depth * 0.65);
      c.strokeStyle = s.white ? 'rgba(235,245,255,0.95)' : 'rgba(90,160,255,0.9)';
      c.lineWidth = s.width * (0.4 + a.depth * 1.6);
      c.beginPath();
      c.moveTo(a.x, a.y);
      c.lineTo(b.x, b.y);
      c.stroke();
    }
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
  }

  function drawRipples(c, time, G, sw) {
    c.globalCompositeOperation = 'lighter';
    c.lineCap = 'round';
    for (var i = 0; i < ripples.length; i++) {
      var r = ripples[i];
      var q = clamp(r.q + Math.sin(time * 0.18 + r.phase) * 0.006, 0, 1);
      var p = floorPt(r.sx, q, G, sw);
      var half = sw * r.span * (0.25 + q * 1.4);
      var fade = smooth(q / 0.04) * (1 - smooth((q - 0.92) / 0.08));
      var twinkle = 0.55 + Math.sin(time * r.tw + r.phase) * 0.45;
      c.globalAlpha = r.alpha * fade * (0.45 + twinkle * 0.55);
      c.strokeStyle = r.white ? 'rgba(240,250,255,0.95)' : 'rgba(85,155,255,0.85)';
      c.lineWidth = r.width * (0.5 + q * 1.3);
      c.beginPath();
      c.moveTo(p.x - half, p.y);
      c.lineTo(p.x + half, p.y + r.sx * q * 0.8);
      c.stroke();
    }
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
  }

  function drawSparks(c, time, G, sw) {
    c.globalCompositeOperation = 'lighter';
    for (var i = 0; i < sparks.length; i++) {
      var s = sparks[i];
      var q = (s.q + time * s.speed) % 1;
      var pt;
      if (s.high) {
        pt = { x: G.cx + s.sx * G.col * 3, y: q * G.floorY, depth: 0.3 };
      } else {
        pt = floorPt(s.sx, q, G, sw);
        pt.y -= rand(0, 1) < 0 ? 0 : Math.sin(s.phase) * 4 + 5;
      }
      var tw = 0.35 + 0.65 * Math.sin(time * s.tw + s.phase);
      if (tw < 0.15) continue;
      c.globalAlpha = clamp(s.a * tw * (0.3 + pt.depth * 0.7), 0, 1);
      c.fillStyle = tw > 0.8 ? '#ffffff' : '#9cc8ff';
      c.beginPath();
      c.arc(pt.x, pt.y, s.r * (0.5 + pt.depth * 0.8), 0, Math.PI * 2);
      c.fill();
    }
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
  }

  function draw(time) {
    var sw = off.width, sh = off.height;
    var G = geom(sw, sh);

    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.globalCompositeOperation = 'source-over';
    octx.globalAlpha = 1;
    octx.fillStyle = '#010204';
    octx.fillRect(0, 0, sw, sh);

    atmosphere(octx, G, sw, sh);
    drawFibers(octx, time, G);
    drawStreaks(octx, time, G, sw);
    drawRipples(octx, time, G, sw);
    drawSparks(octx, time, G, sw);

    // bloom mips
    m1.imageSmoothingEnabled = true;
    m1.clearRect(0, 0, mip1.width, mip1.height);
    m1.drawImage(off, 0, 0, mip1.width, mip1.height);
    m2.imageSmoothingEnabled = true;
    m2.clearRect(0, 0, mip2.width, mip2.height);
    m2.drawImage(mip1, 0, 0, mip2.width, mip2.height);

    // composite: sharp scene + two soft bloom passes
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(off, 0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.32;
    ctx.drawImage(mip1, 0, 0, w, h);
    ctx.globalAlpha = 0.16;
    ctx.drawImage(mip2, 0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    var vig = ctx.createRadialGradient(w * 0.5, h * 0.45, h * 0.15, w * 0.5, h * 0.5, h * 1.05);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(0.72, 'rgba(0,0,0,0.16)');
    vig.addColorStop(1, 'rgba(0,0,0,0.7)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);

    if (compare && refImg && refImg.complete && refImg.naturalWidth) {
      ctx.globalAlpha = 0.32;
      var ir = refImg.naturalWidth / refImg.naturalHeight;
      var cr = w / h;
      var dw, dh;
      if (cr > ir) { dh = h; dw = h * ir; } else { dw = w; dh = w / ir; }
      ctx.drawImage(refImg, (w - dw) / 2, (h - dh) / 2, dw, dh);
      ctx.globalAlpha = 1;
    }
  }

  function frame(now) {
    if (!running) return;
    draw(reduced ? 0.4 : (now - t0) / 1000);
    if (!reduced) raf = requestAnimationFrame(frame);
  }

  function sync() {
    var should = inView && pageVisible;
    if (should && !running) { running = true; raf = requestAnimationFrame(frame); }
    else if (!should && running) { running = false; cancelAnimationFrame(raf); }
  }

  resize();
  if (reduced) draw(0.4);
  window.addEventListener('resize', function () { resize(); if (reduced) draw(0.4); });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (e) {
      inView = !!(e[0] && e[0].isIntersecting); sync();
    }, { threshold: 0.05 }).observe(root);
  }
  document.addEventListener('visibilitychange', function () {
    pageVisible = !document.hidden; sync();
  });
  sync();
})();
`;

/**
 * Homepage scroll UI: chrome reveal, hero copy fade, and lerped parallax.
 * (CSS scroll() timelines bind to <html> here because overflow-x: clip makes
 * it a scroll container with no overflow — body scrolls, so CSS never moves.)
 */
const HERO_SCROLL_SCRIPT = `
(function () {
  var chrome = document.getElementById('site-chrome');
  var hero = document.querySelector('.waterfall-hero');
  if (!chrome || !hero) return;
  var bg = hero.querySelector('.waterfall-hero__bg');
  var title = hero.querySelector('.waterfall-hero__title');
  var copy = hero.querySelector('.waterfall-hero__copy');
  var stage = hero.querySelector('.waterfall-hero__stage');
  if (!bg || !title || !copy || !stage) return;

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Chrome scrub window, in px of scroll. Deliberately short and viewport
  // independent: the bar starts arriving almost immediately and is fully
  // there well inside the first flick.
  var REVEAL_START = 24;
  var REVEAL_END = 180;
  var chromeP = -1;
  var BG_RATE = 0.5;
  var TITLE_RATE = -0.22;
  var COPY_RATE = -0.12;
  var SMOOTH = 14;
  var bgY = 0, titleY = 0, copyY = 0, stageOp = 1;
  var bgT = 0, titleT = 0, copyT = 0, stageOpT = 1;
  var raf = 0;
  var last = performance.now();
  // Cached so the scroll handler never forces a layout.
  var heroH = 1;
  var thr = 120;

  function measure() {
    heroH = hero.offsetHeight || 1;
    thr = Math.max(120, heroH * 0.4);
  }

  function paint() {
    if (!reduced) {
      bg.style.transform = 'translate3d(0,' + bgY.toFixed(2) + 'px,0) scale(1.12)';
      title.style.transform = 'translate3d(0,' + titleY.toFixed(2) + 'px,0)';
      copy.style.transform = 'translate3d(0,' + copyY.toFixed(2) + 'px,0)';
    }
    stage.style.opacity = stageOp.toFixed(3);
    stage.style.pointerEvents = stageOp < 0.05 ? 'none' : '';
  }

  function frame(now) {
    raf = 0;
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    var k = reduced ? 1 : (1 - Math.exp(-SMOOTH * dt));
    if (!reduced) {
      bgY += (bgT - bgY) * k;
      titleY += (titleT - titleY) * k;
      copyY += (copyT - copyY) * k;
      if (Math.abs(bgT - bgY) < 0.05) bgY = bgT;
      if (Math.abs(titleT - titleY) < 0.05) titleY = titleT;
      if (Math.abs(copyT - copyY) < 0.05) copyY = copyT;
    }
    stageOp += (stageOpT - stageOp) * k;
    if (Math.abs(stageOpT - stageOp) < 0.004) stageOp = stageOpT;
    paint();
    var moving = (!reduced && (bgY !== bgT || titleY !== titleT || copyY !== copyT))
      || stageOp !== stageOpT;
    if (moving) raf = requestAnimationFrame(frame);
  }

  function readScroll() {
    var y = window.scrollY || document.documentElement.scrollTop || 0;
    var h = heroH;

    // Chrome scrubs 0..1 across a short, fixed window near the top of the page.
    var p = (y - REVEAL_START) / (REVEAL_END - REVEAL_START);
    p = p < 0 ? 0 : p > 1 ? 1 : p;
    p = Math.round(p * 1000) / 1000;
    if (p !== chromeP) {
      chromeP = p;
      chrome.style.setProperty('--chrome-scroll', String(p));
      chrome.classList.toggle('is-visible', p >= 0.5);
    }

    var fadeStart = thr * 0.35;
    if (y <= fadeStart) stageOpT = 1;
    else if (y >= thr) stageOpT = 0;
    else stageOpT = 1 - (y - fadeStart) / (thr - fadeStart);

    if (!reduced) {
      if (y <= 0) { bgT = 0; titleT = 0; copyT = 0; }
      else if (y > h) { bgT = h * BG_RATE; titleT = h * TITLE_RATE; copyT = h * COPY_RATE; }
      else {
        bgT = y * BG_RATE;
        titleT = y * TITLE_RATE;
        copyT = y * COPY_RATE;
      }
    }

    if (!raf) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }

  measure();
  paint();
  readScroll();
  window.addEventListener('scroll', readScroll, { passive: true });
  window.addEventListener('resize', function () { measure(); readScroll(); });
  window.addEventListener('load', function () { measure(); readScroll(); });
})();
`;

export const WaterfallHero: FC<{
    title?: Child;
    children?: Child;
}> = (props) => (
    <section
        class="waterfall-hero"
        aria-label="Hero"
    >
        <div
            class="waterfall-hero__bg"
            aria-hidden="true"
        >
            <canvas
                id="waterfall-canvas"
                class="waterfall-hero__canvas"
            />
            <div class="waterfall-hero__veil" />
        </div>
        {/*
          Title must not sit inside a z-index stacking context, or mix-blend
          samples a transparent layer instead of the waterfall canvas.
        */}
        <div class="waterfall-hero__stage">
            {props.title}
            <div class="waterfall-hero__copy">{props.children}</div>
        </div>
        <div
            class="waterfall-hero__fade"
            aria-hidden="true"
        />
        {/* eslint-disable-next-line */}
        <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />
        {/* eslint-disable-next-line */}
        <script dangerouslySetInnerHTML={{ __html: HERO_SCROLL_SCRIPT }} />
    </section>
);
