import type { Child, FC } from 'hono/jsx';

const SCRIPT = `
(function () {
  var root = document.querySelector('.waterfall-hero');
  var canvas = document.getElementById('waterfall-canvas');
  if (!root || !canvas || !(canvas instanceof HTMLCanvasElement)) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var ctx = canvas.getContext('2d');
  if (!ctx) return;

  var STREAKS = 64;
  var PARTICLES = 36;
  var FLOOR = 14;
  var COLORS = ['#ffffff', '#00e5ff', '#0099ff', '#0077ff'];

  var w = 0;
  var h = 0;
  var dpr = 1;
  var raf = 0;
  var running = false;
  var inView = true;
  var pageVisible = !document.hidden;
  var streaks = [];
  var particles = [];
  var floors = [];

  function rand(a, b) { return a + Math.random() * (b - a); }

  function makeStreak() {
    var side = Math.random();
    var xNorm = side < 0.72
      ? rand(0.38, 0.62)
      : rand(0.22, 0.78);
    var core = Math.abs(xNorm - 0.5) < 0.06;
    return {
      x: xNorm,
      y: rand(-0.2, 1.05),
      len: rand(0.04, core ? 0.16 : 0.1) * h,
      speed: rand(core ? 0.55 : 0.28, core ? 1.35 : 0.75) * h,
      width: rand(core ? 1.2 : 0.5, core ? 2.4 : 1.2),
      alpha: rand(core ? 0.35 : 0.12, core ? 0.85 : 0.45),
      color: COLORS[(Math.random() * (core ? 2 : COLORS.length)) | 0]
    };
  }

  function makeParticle() {
    return {
      x: rand(0, 1),
      y: rand(0, 1),
      r: rand(0.6, 1.8),
      tw: rand(0.4, 2.2),
      phase: rand(0, Math.PI * 2),
      alpha: rand(0.15, 0.7)
    };
  }

  function makeFloor() {
    return {
      x: rand(0.2, 0.8),
      y: rand(0.78, 0.94),
      len: rand(0.02, 0.08),
      speed: rand(0.015, 0.05),
      alpha: rand(0.1, 0.4),
      color: COLORS[1 + ((Math.random() * 2) | 0)]
    };
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

    streaks = [];
    for (var i = 0; i < STREAKS; i++) streaks.push(makeStreak());
    particles = [];
    for (var j = 0; j < PARTICLES; j++) particles.push(makeParticle());
    floors = [];
    for (var k = 0; k < FLOOR; k++) floors.push(makeFloor());
  }

  function draw(dt) {
    ctx.clearRect(0, 0, w, h);

    for (var i = 0; i < streaks.length; i++) {
      var s = streaks[i];
      s.y += s.speed * dt;
      if (s.y - s.len > h) {
        streaks[i] = makeStreak();
        streaks[i].y = -streaks[i].len;
        continue;
      }
      var x = s.x * w;
      var g = ctx.createLinearGradient(x, s.y - s.len, x, s.y);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.35, s.color);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.globalAlpha = s.alpha;
      ctx.strokeStyle = g;
      ctx.lineWidth = s.width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, s.y - s.len);
      ctx.lineTo(x, s.y);
      ctx.stroke();
    }

    for (var f = 0; f < floors.length; f++) {
      var fl = floors[f];
      fl.x += (fl.x < 0.5 ? -1 : 1) * fl.speed * dt;
      if (fl.x < 0.05 || fl.x > 0.95) {
        floors[f] = makeFloor();
        continue;
      }
      var fx = fl.x * w;
      var fy = fl.y * h;
      var flen = fl.len * w;
      ctx.globalAlpha = fl.alpha;
      ctx.strokeStyle = fl.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(fx - flen, fy);
      ctx.lineTo(fx + flen, fy);
      ctx.stroke();
    }

    var t = performance.now() / 1000;
    for (var p = 0; p < particles.length; p++) {
      var pt = particles[p];
      var a = pt.alpha * (0.45 + 0.55 * Math.sin(t * pt.tw + pt.phase));
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = COLORS[(p % 3) + 0];
      ctx.beginPath();
      ctx.arc(pt.x * w, pt.y * h, pt.r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
  }

  var last = 0;
  function frame(now) {
    if (!running) return;
    var dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    draw(dt);
    raf = requestAnimationFrame(frame);
  }

  function sync() {
    var should = inView && pageVisible;
    if (should && !running) {
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    } else if (!should && running) {
      running = false;
      cancelAnimationFrame(raf);
    }
  }

  resize();
  window.addEventListener('resize', resize);

  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      inView = entries[0] && entries[0].isIntersecting;
      sync();
    }, { threshold: 0.05 });
    io.observe(root);
  }

  document.addEventListener('visibilitychange', function () {
    pageVisible = !document.hidden;
    sync();
  });

  sync();
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
            <img
                class="waterfall-hero__img"
                src="/waterfall-hero.png"
                alt=""
                width={574}
                height={1024}
                decoding="async"
                fetchpriority="high"
            />
            <div class="waterfall-hero__veil" />
            <canvas
                id="waterfall-canvas"
                class="waterfall-hero__canvas"
            />
            <div class="waterfall-hero__fade" />
        </div>
        <div class="waterfall-hero__content">{props.children}</div>
        {/* eslint-disable-next-line */}
        <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />
    </section>
);
