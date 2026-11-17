// Background atmosphere on a canvas: drifting fog, rain at night, floating dust by day.
const FX = (() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cv = document.getElementById('fx');
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, mode = 'night';
  const fog = Array.from({ length: 7 }, (_, i) => ({ x: Math.random(), y: .55 + Math.random() * .45, r: .25 + Math.random() * .3, v: (Math.random() - .5) * .00012 + (i % 2 ? .00006 : -.00006) }));
  const rain = Array.from({ length: 140 }, () => ({ x: Math.random(), y: Math.random(), l: .015 + Math.random() * .03, v: .012 + Math.random() * .01 }));
  const dust = Array.from({ length: 60 }, () => ({ x: Math.random(), y: Math.random(), r: .6 + Math.random() * 1.8, v: (Math.random() - .5) * .0004, w: Math.random() * 6 }));

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    W = cv.width = innerWidth * dpr; H = cv.height = innerHeight * dpr;
  }
  addEventListener('resize', resize);
  resize();

  function frame(t) {
    ctx.clearRect(0, 0, W, H);
    const night = mode === 'night';
    for (const f of fog) {
      f.x += f.v; if (f.x < -.4) f.x = 1.4; if (f.x > 1.4) f.x = -.4;
      const g = ctx.createRadialGradient(f.x * W, f.y * H, 0, f.x * W, f.y * H, f.r * W);
      g.addColorStop(0, night ? 'rgba(120,140,180,.09)' : 'rgba(255,220,170,.10)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    if (night) {
      ctx.strokeStyle = 'rgba(170,190,230,.22)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (const r of rain) {
        r.y += r.v; r.x -= r.v * .15;
        if (r.y > 1) { r.y = -r.l; r.x = Math.random() * 1.1; }
        ctx.moveTo(r.x * W, r.y * H); ctx.lineTo((r.x - r.l * .15) * W, (r.y + r.l) * H);
      }
      ctx.stroke();
    } else {
      for (const d of dust) {
        d.y -= .00025; d.x += d.v + Math.sin(t / 1600 + d.w) * .0002;
        if (d.y < 0) { d.y = 1; d.x = Math.random(); }
        ctx.fillStyle = 'rgba(255,214,140,.35)';
        ctx.beginPath(); ctx.arc(d.x * W, d.y * H, d.r * (W / 1200), 0, 7); ctx.fill();
      }
    }
    requestAnimationFrame(frame);
  }
  if (!reduce) requestAnimationFrame(frame);
  return { mode: m => { mode = m; } };
})();
