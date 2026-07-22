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

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return;

  var N = 420;
  var SPARKS = 100;
  var w = 0, h = 0, dpr = 1;
  var raf = 0, running = false, inView = true, pageVisible = !document.hidden;
  var fibers = [];
  var sparks = [];
  var t0 = performance.now();
  var compare = /(?:^|[?&])compare=1(?:&|$)/.test(location.search);
  var refImg = null;
  if (compare) { refImg = new Image(); refImg.src = '/waterfall-hero.png'; }

  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }

  function geom() {
    return {
      cx: w * 0.5,
      bend: 0.58,
      col: Math.min(w, h) * 0.062
    };
  }

  function makeFiber() {
    var g = (Math.random() + Math.random() + Math.random() + Math.random()) / 4;
    var side = g * 2 - 1;
    // pack denser toward core (reference look)
    var sign = side < 0 ? -1 : 1;
    side = sign * Math.pow(Math.abs(side), 0.7);
    if (Math.random() < 0.35) side *= 0.55;
    var core = Math.abs(side) < 0.18;
    return {
      side: side,
      phase: Math.random(),
      speed: rand(core ? 0.7 : 0.3, core ? 1.45 : 0.95),
      width: rand(core ? 0.7 : 0.25, core ? 1.6 : 0.85),
      alpha: rand(core ? 0.55 : 0.18, core ? 1 : 0.65),
      white: core && Math.random() < 0.7,
      cyan: Math.random() < 0.7,
      len: rand(0.07, core ? 0.2 : 0.12),
      seed: Math.random() * 100
    };
  }

  function makeSpark() {
    return {
      side: rand(-1.2, 1.2),
      p: rand(0, 1),
      r: rand(0.4, 2),
      phase: rand(0, Math.PI * 2),
      tw: rand(1.2, 3.8),
      a: rand(0.2, 0.85),
      speed: rand(0.12, 0.35)
    };
  }

  /** Continuous path: p 0 at top → 1 at foreground edge. */
  function point(side, p, time, G) {
    var bend = G.bend;
    var cx = G.cx;
    var col = G.col;
    var sway = Math.sin(time * 0.35 + side * 7 + p * 2) * col * 0.05;

    if (p <= bend) {
      var t = p / bend;
      var x = cx + sway + side * col * (0.72 + t * 0.5);
      var y = t * h * bend;
      return { x: x, y: y, depth: 0.15 + t * 0.3 };
    }

    var u = (p - bend) / (1 - bend);
    var rush = Math.pow(u, 1.5);
    var leave = smooth(clamp(u / 0.28, 0, 1));
    // peel then fan — matches reference curve into floor
    var peel = Math.sin(leave * Math.PI) * side * col * 0.55;
    var spread = col * 1.2 + rush * w * 0.7;
    var x = cx + sway * (1 - rush) + side * (col * (1 - leave) + spread * leave) + peel;
    var y = h * bend + rush * (h - h * bend) * 0.99;
    return { x: x, y: y, depth: 0.45 + rush * 0.55 };
  }

  function color(f, bright, depth) {
    var a = clamp(f.alpha * bright * (0.5 + depth * 0.55), 0, 1);
    if (f.white && bright > 0.55) return 'rgba(255,255,255,' + Math.min(1, a + 0.15) + ')';
    if (f.cyan) return 'rgba(0,229,255,' + a + ')';
    return 'rgba(0,120,255,' + a + ')';
  }

  function resize() {
    var rect = root.getBoundingClientRect();
    w = Math.max(1, Math.floor(rect.width));
    h = Math.max(1, Math.floor(rect.height));
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fibers = [];
    for (var i = 0; i < N; i++) fibers.push(makeFiber());
    sparks = [];
    for (var j = 0; j < SPARKS; j++) sparks.push(makeSpark());
  }

  function atmosphere(G) {
    ctx.globalCompositeOperation = 'lighter';
    var cx = G.cx;
    var by = h * G.bend;

    // soft vertical haze
    var g1 = ctx.createRadialGradient(cx, by * 0.5, 0, cx, by * 0.5, Math.max(G.col * 6, h * 0.4));
    g1.addColorStop(0, 'rgba(0,180,255,0.32)');
    g1.addColorStop(0.3, 'rgba(0,110,230,0.14)');
    g1.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g1;
    ctx.fillRect(cx - w * 0.28, 0, w * 0.56, by + h * 0.06);

    // hot white core strip
    var g2 = ctx.createLinearGradient(cx, by * 0.1, cx, by);
    g2.addColorStop(0, 'rgba(255,255,255,0)');
    g2.addColorStop(0.35, 'rgba(255,255,255,0.35)');
    g2.addColorStop(0.85, 'rgba(255,255,255,0.7)');
    g2.addColorStop(1, 'rgba(255,255,255,0.85)');
    ctx.fillStyle = g2;
    ctx.beginPath();
    ctx.moveTo(cx - G.col * 0.55, by * 0.12);
    ctx.lineTo(cx + G.col * 0.55, by * 0.12);
    ctx.lineTo(cx + G.col * 0.85, by);
    ctx.lineTo(cx - G.col * 0.85, by);
    ctx.closePath();
    ctx.fill();

    // impact
    var g3 = ctx.createRadialGradient(cx, by, 0, cx, by, Math.min(w, h) * 0.4);
    g3.addColorStop(0, 'rgba(255,255,255,0.9)');
    g3.addColorStop(0.08, 'rgba(210,245,255,0.55)');
    g3.addColorStop(0.25, 'rgba(0,210,255,0.28)');
    g3.addColorStop(0.55, 'rgba(0,80,200,0.08)');
    g3.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g3;
    ctx.fillRect(0, by - h * 0.12, w, h * 0.45);

    // floor wash
    var g4 = ctx.createRadialGradient(cx, h * 0.92, 0, cx, by, w * 0.8);
    g4.addColorStop(0, 'rgba(0,170,255,0.16)');
    g4.addColorStop(0.5, 'rgba(0,70,160,0.05)');
    g4.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g4;
    ctx.fillRect(0, by, w, h - by);

    ctx.globalCompositeOperation = 'source-over';
  }

  function drawFibers(time, G) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    var steps = 36;

    for (var i = 0; i < fibers.length; i++) {
      var f = fibers[i];
      var head = (f.phase + time * f.speed) % 1;

      // persistent fiber (dense curtain)
      ctx.beginPath();
      for (var s = 0; s <= steps; s++) {
        var pt = point(f.side, s / steps, time, G);
        if (s === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color(f, 0.55, 0.45);
      ctx.lineWidth = f.width * 0.65;
      ctx.stroke();

      // brighter pulse traveling down → into foreground
      for (var s2 = 0; s2 < steps; s2++) {
        var p0 = s2 / steps;
        var p1 = (s2 + 1) / steps;
        var d = Math.min(
          Math.abs(p0 - head),
          Math.abs(p0 - head + 1),
          Math.abs(p0 - head - 1)
        );
        var bright = 1 - clamp(d / f.len, 0, 1);
        bright = bright * bright;
        if (bright < 0.08) continue;
        var a = point(f.side, p0, time, G);
        var b = point(f.side, p1, time, G);
        var depth = (a.depth + b.depth) * 0.5;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = color(f, 0.45 + bright * 0.7, depth);
        ctx.lineWidth = f.width * (0.7 + depth * 1.5) * (0.7 + bright * 0.7);
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  function drawSparks(time, G) {
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < sparks.length; i++) {
      var s = sparks[i];
      s.p += s.speed * 0.016;
      if (s.p > 1.05) { s.p = rand(-0.05, 0.1); s.side = rand(-1.2, 1.2); }
      var pt = point(s.side, clamp(s.p, 0, 0.999), time, G);
      var tw = 0.35 + 0.65 * Math.sin(time * s.tw + s.phase);
      ctx.globalAlpha = s.a * tw * (0.35 + pt.depth);
      ctx.fillStyle = tw > 0.78 ? '#ffffff' : '#00e5ff';
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, s.r * (0.65 + pt.depth * 0.7), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  function draw(time) {
    var G = geom();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    atmosphere(G);
    drawFibers(time, G);
    drawSparks(time, G);

    var vig = ctx.createRadialGradient(G.cx, h * 0.4, h * 0.1, G.cx, h * 0.5, h * 0.95);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(0.7, 'rgba(0,0,0,0.2)');
    vig.addColorStop(1, 'rgba(0,0,0,0.75)');
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

const CHROME_SCRIPT = `
(function () {
  var chrome = document.getElementById('site-chrome');
  var hero = document.querySelector('.waterfall-hero');
  if (!chrome || !hero) return;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var shown = false;
  function threshold() { return Math.max(120, hero.offsetHeight * 0.4); }
  function update() {
    var next = (window.scrollY || document.documentElement.scrollTop) >= threshold();
    if (next === shown) return;
    shown = next;
    chrome.classList.toggle('is-visible', shown);
    chrome.setAttribute('aria-hidden', shown ? 'false' : 'true');
  }
  if (reduced) chrome.classList.add('site-chrome--instant');
  update();
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
})();
`;

export const WaterfallHero: FC<{ children?: Child }> = (props) => (
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
            <div class="waterfall-hero__fade" />
        </div>
        <div class="waterfall-hero__content">{props.children}</div>
        {/* eslint-disable-next-line */}
        <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />
        {/* eslint-disable-next-line */}
        <script dangerouslySetInnerHTML={{ __html: CHROME_SCRIPT }} />
    </section>
);
