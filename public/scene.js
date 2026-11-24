// Full-screen Feign-style scene. Layout math is the prototype's (BUILD-NOTE §3).
(function (root) {
  const POSES = ['idle', 'narrating', 'night', 'day', 'death'];
  const GREY = 'grayscale(.8) brightness(.92) contrast(.9)';
  const EASE = {
    inOut: t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
    outBack: t => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
    outCubic: t => 1 - Math.pow(1 - t, 3),
  };
  const clamp = v => Math.max(0, Math.min(1, v));

  function resolveCharacterId(id) {
    if (id === 'blob') return 'goz';
    return id || 'goz';
  }

  function resolveSceneId(manifest, id) {
    const scene = manifest && manifest.scenes && manifest.scenes[id];
    if (scene && scene.status === 'active' && scene.bg && scene.desktop && scene.phone) return id;
    return 'meydan';
  }

  function skinPassesAA(skin) {
    if (!skin || skin.passes_aa !== true) return false;
    const c = skin.contrast || {};
    return ['normal', 'speaking', 'dead', 'you'].every(k => typeof c[k] === 'number' && c[k] >= 4.5);
  }

  // Paid and failing skins stay in the catalog. Only a free skin that passes AA is rendered.
  function resolveFlagSkin(manifest, id) {
    const skins = (manifest && manifest.flag_skins && manifest.flag_skins.skins) || {};
    const s = skins[id];
    if (s && s.tier === 'free' && skinPassesAA(s)) return s.id;
    return 'standart';
  }

  function hashId(id) {
    let h = 2166136261;
    const s = String(id);
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  }

  function makeRng(seed) {
    let s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  }

  // Seats at equal arc length, gap behind Kâhin, local player nearest the front.
  function layoutSeats(manifest, opts) {
    const n = opts.n;
    const W = opts.width, H = opts.height;
    const cfg = manifest.scenes[opts.scene][opts.layout];
    const rules = manifest.layout_rules;
    const scale = n <= 8 ? rules.scale_by_n['<=8'] : n <= 12 ? rules.scale_by_n['<=12'] : rules.scale_by_n['>12'];
    const gapF = rules.gap_frac[opts.layout];
    const [cx, cy, rx0, ry0] = cfg.ring;
    const ph = cfg.player_h.map(v => v * scale[0]);
    let rx = rx0 * scale[1];
    const ry = ry0 * scale[2];
    const meIndex = ((opts.meIndex % n) + n) % n;

    const place = ringRx => {
      const SM = 2000;
      const pts = [];
      const cum = [0];
      for (let k = 0; k <= SM; k++) {
        const a = (-90 + 360 * k / SM) * Math.PI / 180;
        pts.push([Math.cos(a) * ringRx * W, Math.sin(a) * ry * H]);
        if (k) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
      }
      const L = cum[SM];
      const angs = [];
      const denom = Math.max(1, n - 1);
      for (let i = 0; i < n; i++) {
        const target = n === 1 ? L * 0.5 : L * gapF / 2 + i * (L * (1 - gapF)) / denom;
        let k = 0;
        while (k < SM && cum[k] < target) k++;
        angs.push(-90 + 360 * k / SM);
      }
      let best = 0;
      for (let i = 1; i < n; i++) if (Math.abs(angs[i] - 90) < Math.abs(angs[best] - 90)) best = i;
      const yTop = cy - ry, yBot = cy + ry;
      const seats = [];
      for (let j = 0; j < n; j++) {
        const aDeg = angs[j];
        const a = aDeg * Math.PI / 180;
        const x = (cx + ringRx * Math.cos(a)) * W;
        const y = (cy + ry * Math.sin(a)) * H;
        const f = (y / H - yTop) / (yBot - yTop || 1);
        const h = (ph[0] + (ph[1] - ph[0]) * f) * H;
        const imgH = h / 0.86;
        const imgW = imgH * 0.75;
        seats.push({
          playerIndex: (meIndex + (j - best) + n) % n,
          angle: aDeg, x, y, f, h, imgH, imgW,
        });
      }
      return seats;
    };

    // §3.7: other aspect ratios keep the ring centred and pull rx in until sprites clear 12px.
    let seats = place(rx);
    for (let guard = 0; guard < 8; guard++) {
      let over = 0;
      for (const s of seats) over = Math.max(over, 12 - (s.x - s.imgW / 2), (s.x + s.imgW / 2) - (W - 12));
      if (over <= 0.5) break;
      rx = Math.max(0.08, rx - over / W);
      seats = place(rx);
    }

    const [gx, gy, gh] = cfg.god;
    const godH = gh * H;
    const godImgH = godH / 0.9;
    return {
      seats, rx, ry, cx, cy, ph,
      god: { x: gx * W, y: gy * H, h: godH, imgH: godImgH, imgW: godImgH * 0.75 },
    };
  }

  const api = { layoutSeats, resolveCharacterId, resolveSceneId, skinPassesAA, resolveFlagSkin, EASE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document === 'undefined') return;

  const $ = id => document.getElementById(id);
  let manifest = null;
  let readyFn = null;
  const reduceMq = matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = reduceMq.matches;
  reduceMq.addEventListener?.('change', () => { reduced = reduceMq.matches; });
  let lowEnd = (navigator.hardwareConcurrency || 8) <= 4;

  let current = null;
  let P = [];
  let god = null;
  let builtKey = '';
  let builtLayout = '';
  let shown = false;
  let running = false;
  let raf = 0;
  let offset = 0;
  let hiddenAt = 0;
  let hasDay = false;
  let fadeSec = 1.8;
  let tod = 1, todTarget = 1, todFrom = 1, todTo = 1, todT = null, todArmed = false, todDelay = 0, todReady = false;
  let godPose = 'idle', godFrom = 'idle', godPoseT = -9;
  let redT = null;
  let lastNarr = '';
  let needFlags = false;
  let fpsFrames = 0, fpsT = 0;

  function now() {
    if (!offset) offset = performance.now();
    return (performance.now() - offset) / 1000;
  }
  const isPhone = () => matchMedia('(max-width: 800px)').matches;
  const charDef = id => manifest.players[resolveCharacterId(id)] || manifest.players.goz;
  const fileFor = (files, h) => (isPhone() || h <= 300) ? files.small : files.full;

  function load() {
    return fetch('/scene/scene-manifest.json').then(r => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    }).then(data => {
      manifest = data;
      const skins = {};
      for (const [id, skin] of Object.entries(data.flag_skins?.skins || {})) {
        if (skin.tier === 'free' && skinPassesAA(skin)) skins[id] = skin;
      }
      window.FLAG_SKINS = skins;
      preloadLobby();
      if (readyFn) readyFn();
    }).catch(() => {});
  }

  function whenReady(fn) { readyFn = fn; if (manifest) fn(); }
  function sceneOf(s) { return resolveSceneId(manifest, s && s.sceneId); }
  function wanted(s) {
    return !!(manifest && s && s.sceneId && s.phase !== 'lobby' && s.phase !== 'starting');
  }

  function lobbyPlate(sceneId) {
    if (!manifest) return null;
    const id = resolveSceneId(manifest, sceneId);
    const scene = manifest.scenes[id];
    const layout = isPhone() ? 'phone' : 'desktop';
    const bg = (scene.bg && (scene.bg[layout] || scene.bg.desktop)) || {};
    return { id, night: bg.night, kahin: fileFor(manifest.kahin.files.idle, isPhone() ? 200 : 420) };
  }

  let preloadedLayout = '';
  function preloadLobby() {
    if (!manifest) return;
    const layout = isPhone() ? 'phone' : 'desktop';
    if (preloadedLayout === layout) return;
    preloadedLayout = layout;
    for (const scene of Object.values(manifest.scenes)) {
      if (scene.status !== 'active' || !scene.bg || !scene.bg[layout]) continue;
      preload(scene.bg[layout].night);
      preload(scene.bg[layout].day);
    }
    const playerH = isPhone() ? 80 : 220;
    for (const p of Object.values(manifest.players)) preload(fileFor(p.files.idle, playerH));
    preload(fileFor(manifest.kahin.files.idle, isPhone() ? 160 : 390));
  }

  function hide() {
    if (!shown && !running) return;
    shown = false;
    running = false;
    cancelAnimationFrame(raf);
    raf = 0;
    const el = $('scene');
    if (el) { el.hidden = true; el.setAttribute('aria-hidden', 'true'); }
    const world = $('sceneWorld'), fx = $('sceneFx');
    if (world) world.replaceChildren();
    if (fx) fx.replaceChildren();
    P = [];
    god = null;
    builtKey = '';
    current = null;
    todReady = false;
    redT = null;
    lastNarr = '';
    offset = 0;
  }

  function show() {
    const el = $('scene');
    if (!el) return;
    el.hidden = false;
    el.setAttribute('aria-hidden', 'false');
    shown = true;
  }

  function preload(url) {
    if (!url) return;
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
  }

  function sync(s) {
    if (!wanted(s)) { hide(); return; }
    show();
    current = s;
    const layoutName = isPhone() ? 'phone' : 'desktop';
    const sceneId = sceneOf(s);
    const key = sceneId + '|' + s.players.map(p => p.id).join(',');
    if (key !== builtKey || layoutName !== builtLayout) build(s, layoutName, sceneId);
    applyGameState(s);
    ensureLoop();
  }

  function build(s, layoutName, sceneId) {
    sceneId = sceneId || sceneOf(s);
    const world = $('sceneWorld');
    const fx = $('sceneFx');
    world.replaceChildren();
    fx.replaceChildren();
    P = [];
    god = null;
    offset = performance.now();
    builtKey = sceneId + '|' + s.players.map(p => p.id).join(',');
    builtLayout = layoutName;
    redT = null;
    lastNarr = '';
    todReady = false;
    const scene = manifest.scenes[sceneId];
    const bg = scene.bg[layoutName] || scene.bg.desktop;
    hasDay = !!(bg && bg.day);
    const fadeMs = Number(scene.day_night && scene.day_night.duration_ms);
    fadeSec = fadeMs > 0 ? fadeMs / 1000 : 1.8;
    $('sceneBgNight').style.backgroundImage = `url("${bg.night}")`;
    $('sceneBgDay').style.backgroundImage = bg.day ? `url("${bg.day}")` : 'none';
    preload(bg.night);
    preload(bg.day);
    const meIndex = Math.max(0, s.players.findIndex(p => p.id === s.myId));
    const lay = layoutSeats(manifest, {
      scene: sceneId, layout: layoutName, n: s.players.length,
      width: innerWidth, height: innerHeight, meIndex,
    });
    s.players.forEach((row, index) => {
      const seat = lay.seats.find(se => se.playerIndex === index);
      P.push(createPlayer(row, index, seat));
    });
    createGod(lay.god);
    layout(s);
    const seen = new Set();
    for (const p of P) {
      if (seen.has(p.idleUrl)) continue;
      seen.add(p.idleUrl);
      preload(p.idleUrl);
    }
    preload(fileFor(manifest.kahin.files.idle, god.h));
    setTimeout(kickLazy, 40);
  }

  function kickLazy() {
    for (const p of P) {
      if (p.imgs.speaking && !p.imgs.speaking.getAttribute('src')) p.imgs.speaking.src = p.speakUrl;
      if (p.imgs.dead && !p.imgs.dead.getAttribute('src')) p.imgs.dead.src = p.deadUrl;
    }
    if (!god) return;
    for (const pose of POSES) {
      const im = god.imgs[pose];
      if (im && !im.getAttribute('src')) im.src = im.dataset.src;
    }
  }

  function createPlayer(row, index, seat) {
    const ch = charDef(row.characterId);
    const rng = makeRng(hashId(row.id) || 1);
    const ent = document.createElement('div');
    ent.className = 'ent';
    ent.dataset.id = row.id;
    ent.innerHTML = `<div class="glow"></div><div class="shadow"></div><div class="spr">
      <img class="s-idle" alt="" draggable="false" decoding="async">
      <img class="s-speaking" alt="" draggable="false" decoding="async" style="opacity:0">
      <img class="s-dead" alt="" draggable="false" decoding="async" style="opacity:0">
      <span class="cosmetic costume" hidden></span>
      <span class="cosmetic hat" hidden></span>
      <span class="cosmetic effect" hidden></span>
    </div>`;
    $('sceneWorld').appendChild(ent);
    const phone = isPhone();
    const flag = makeFlag(resolveFlagSkin(manifest, 'standart'), {
      name: row.name || '', accent: ch.accent || '#F2B544', you: false, phone,
      fs: phone ? 10 : 16, maxw: phone ? 66 : 176, pad: phone ? '3px 6px 7px' : null,
    });
    $('sceneWorld').appendChild(flag);
    const spr = ent.querySelector('.spr');
    const p = {
      id: row.id, index, char: ch, rng, ent, flag, spr,
      glow: ent.querySelector('.glow'),
      shadow: ent.querySelector('.shadow'),
      imgs: {
        idle: ent.querySelector('.s-idle'),
        speaking: ent.querySelector('.s-speaking'),
        dead: ent.querySelector('.s-dead'),
      },
      nm: flag.querySelector('.nm'),
      metaEl: flag.querySelector('.meta'),
      tab: flag.querySelector('.tab'),
      cloth: flag.querySelector('.cloth'),
      period: 2.4 + rng() * 0.9,
      phase: rng() * Math.PI * 2,
      nextF: 4 + rng() * 6,
      fT: -9, fType: 0,
      dead: false, deathT: null, speaking: false, booted: false, grey: false, shown: '',
      x: seat.x, y: seat.y, h: seat.h, imgH: seat.imgH, imgW: seat.imgW,
      idleUrl: '', speakUrl: '', deadUrl: '', drop: 0, pf: null,
    };
    return p;
  }

  function createGod(g) {
    const ent = document.createElement('div');
    ent.className = 'ent god';
    ent.innerHTML = `<div class="glow god-glow"></div><div class="shadow"></div><div class="spr god-spr">${
      POSES.map(pose => `<img class="g-${pose}" alt="" draggable="false" decoding="async" style="opacity:0">`).join('')
    }</div>`;
    $('sceneWorld').appendChild(ent);
    const imgs = {};
    for (const pose of POSES) imgs[pose] = ent.querySelector('.g-' + pose);
    god = {
      ent, imgs, h: g.h, x: g.x, y: g.y, imgH: g.imgH, imgW: g.imgW,
      spr: ent.querySelector('.spr'),
      glow: ent.querySelector('.glow'),
      shadow: ent.querySelector('.shadow'),
    };
    if (!reduced) god.spr.style.willChange = 'transform';
  }

  function layout(s) {
    const layoutName = isPhone() ? 'phone' : 'desktop';
    const meIndex = Math.max(0, s.players.findIndex(p => p.id === s.myId));
    const lay = layoutSeats(manifest, {
      scene: sceneOf(s), layout: layoutName, n: s.players.length,
      width: innerWidth, height: innerHeight, meIndex,
    });
    for (const p of P) {
      const seat = lay.seats.find(se => se.playerIndex === p.index);
      if (seat) placePlayer(p, seat);
    }
    placeGod(lay.god);
    $('sceneStage').style.transformOrigin = `${lay.god.x}px ${lay.god.y}px`;
    placeFlags();
  }

  function placePlayer(p, seat) {
    p.x = seat.x; p.y = seat.y; p.h = seat.h; p.imgH = seat.imgH; p.imgW = seat.imgW;
    p.idleUrl = fileFor(p.char.files.idle, p.h);
    p.speakUrl = fileFor(p.char.files.speaking, p.h);
    p.deadUrl = fileFor(p.char.files.dead, p.h);
    if (p.imgs.idle.getAttribute('src') !== p.idleUrl) p.imgs.idle.src = p.idleUrl;
    if (p.imgs.speaking.getAttribute('src') && p.imgs.speaking.getAttribute('src') !== p.speakUrl) p.imgs.speaking.src = p.speakUrl;
    if (p.imgs.dead.getAttribute('src') && p.imgs.dead.getAttribute('src') !== p.deadUrl) p.imgs.dead.src = p.deadUrl;
    const idleTop = p.char.anchors.idle.head_top[1];
    const deadTop = p.char.anchors.dead.head_top[1];
    p.drop = (deadTop - idleTop) * p.imgH;
    p.ent.style.left = seat.x + 'px';
    p.ent.style.top = seat.y + 'px';
    p.ent.style.zIndex = String(Math.round(seat.y));
    p.spr.style.width = seat.imgW + 'px';
    p.spr.style.height = seat.imgH + 'px';
    p.spr.style.left = (-seat.imgW / 2) + 'px';
    p.spr.style.top = (-0.96 * seat.imgH) + 'px';
    p.glow.style.width = (seat.h * 1.1) + 'px';
    p.glow.style.height = (seat.h * 0.5) + 'px';
    p.glow.style.top = (-seat.h * 0.05) + 'px';
    p.shadow.style.width = (seat.h * 0.62) + 'px';
    p.shadow.style.height = (seat.h * 0.16) + 'px';
    placeCosmetics(p, p.shown || 'idle');
  }

  function placeGod(g) {
    god.x = g.x; god.y = g.y; god.h = g.h; god.imgH = g.imgH; god.imgW = g.imgW;
    god.ent.style.left = g.x + 'px';
    god.ent.style.top = g.y + 'px';
    god.ent.style.zIndex = String(Math.round(g.y));
    god.spr.style.width = g.imgW + 'px';
    god.spr.style.height = g.imgH + 'px';
    god.spr.style.left = (-g.imgW / 2) + 'px';
    god.spr.style.top = (-0.97 * g.imgH) + 'px';
    god.glow.style.width = (g.h * 1.2) + 'px';
    god.glow.style.height = (g.h * 0.35) + 'px';
    god.glow.style.top = (-g.h * 0.02) + 'px';
    god.shadow.style.width = (g.h * 0.4) + 'px';
    god.shadow.style.height = (g.h * 0.08) + 'px';
    for (const pose of POSES) {
      const url = fileFor(manifest.kahin.files[pose], g.h);
      const im = god.imgs[pose];
      const canvas = manifest.kahin.anchors[pose] && manifest.kahin.anchors[pose].canvas;
      const kh = canvas ? canvas[1] / 1024 : 1;
      im.style.top = (-(kh - 1) * g.imgH) + 'px';
      im.style.height = (kh * g.imgH) + 'px';
      im.dataset.src = url;
      if (im.getAttribute('src') && im.getAttribute('src') !== url) im.src = url;
      else if ((pose === 'idle' || pose === godPose) && !im.getAttribute('src')) im.src = url;
    }
  }

  function placeCosmetics(p, state) {
    const a = p.char.anchors[state] || p.char.anchors.idle;
    const [hx, hy] = a.head_top;
    const [x0, y0, x1, y1] = a.bbox;
    const hat = p.spr.querySelector('.hat');
    hat.style.left = (hx * 100) + '%';
    hat.style.top = (hy * 100) + '%';
    hat.style.width = '18%';
    hat.style.height = '12%';
    for (const sel of ['.costume', '.effect']) {
      const el = p.spr.querySelector(sel);
      el.style.left = (x0 * 100) + '%';
      el.style.top = (y0 * 100) + '%';
      el.style.width = ((x1 - x0) * 100) + '%';
      el.style.height = ((y1 - y0) * 100) + '%';
    }
  }

  function placeFlags() {
    if (!current) return;
    const phone = isPhone();
    const gap = phone ? 3 : 6;
    for (const p of P) {
      const row = current.players.find(x => x.id === p.id);
      const name = row?.name || '';
      const you = p.id === current.myId;
      const st = p.dead ? 'dead' : p.speaking ? 'speaking' : 'idle';
      const head = (p.char.anchors[st] || p.char.anchors.idle).head_top[1];
      let fs = phone ? 10 : Math.min(17, Math.max(15, Math.round(p.h * 0.08)));
      if (!phone && name.length >= 11) fs = Math.max(14, fs - 1);
      const mw = phone ? (you ? 96 : 66) : Math.round(fs * 11);
      p.flag.style.fontSize = fs + 'px';
      p.flag.classList.toggle('you', you);
      p.tab.textContent = phone ? '★' : 'SEN';
      if (phone) p.flag.style.setProperty('--pad', '3px 6px 7px');
      else p.flag.style.removeProperty('--pad');
      p.cloth.style.maxWidth = mw + 'px';
      p.nm.textContent = name;
      p.flag.title = name;
      p.flagBase = p.y - (0.96 - head) * p.imgH - gap;
      p.flag.style.left = p.x + 'px';
      p.flag.style.top = p.flagBase + 'px';
      p.flag.style.zIndex = String(30000 + Math.round(p.y));
      const bits = [name];
      if (you) bits.push('sen');
      if (p.speaking) bits.push('konuşuyor');
      if (p.dead) bits.push('elendi');
      p.flag.setAttribute('aria-label', bits.join(', '));
    }
    const F = P.map(p => {
      const r = p.flag.getBoundingClientRect();
      return { p, r: { l: r.left, r: r.right, t: r.top, b: r.bottom }, off: 0 };
    }).sort((a, b) => b.p.y - a.p.y);
    let guard = 0;
    for (let i = 0; i < F.length; i++) {
      for (let j = 0; j < i; j++) {
        if (++guard > 4000) break;
        const A = F[i], B = F[j];
        const at = A.r.t - A.off, ab = A.r.b - A.off;
        const bt = B.r.t - B.off, bb = B.r.b - B.off;
        if (A.r.l < B.r.r - 2 && A.r.r > B.r.l + 2 && ab > bt - 2 && at < bb) {
          A.off += ab - bt + 3;
          j = -1;
        }
      }
    }
    for (const f of F) {
      f.p.flag.style.setProperty('--pl', (f.off + gap) + 'px');
      f.p.flag.style.top = (f.p.flagBase - f.off) + 'px';
    }
    // Keep the cloth on screen. The pole still runs back toward the head.
    for (const p of P) {
      const r = p.flag.getBoundingClientRect();
      let dx = 0, dy = 0;
      if (r.left < 2) dx = 2 - r.left;
      if (r.right > innerWidth - 2) dx -= r.right - (innerWidth - 2);
      if (r.top < 2) dy = 2 - r.top;
      if (dx) p.flag.style.left = (parseFloat(p.flag.style.left) + dx) + 'px';
      if (dy) p.flag.style.top = (parseFloat(p.flag.style.top) + dy) + 'px';
    }
  }

  function metaText(row, s) {
    const bits = [];
    if (row.mate && row.id !== s.myId) bits.push('Mafya');
    if (row.alive && row.silenced) bits.push('Susturuldu');
    if (row.alive && row.connected === false) bits.push('Bağlantı yok');
    const votes = s.vote?.counts?.[row.id];
    if (votes) bits.push(votes + ' oy');
    const role = row.role && s.roles?.[row.role];
    if (role && (s.phase === 'over' || row.id !== s.myId)) bits.push(role.icon + ' ' + role.name);
    return bits.join(' · ');
  }

  function deathLine(text) {
    return /oyundan çıktı|vurdu|götürdü/.test(text || '');
  }

  function phasePose(s) {
    const dead = deathLine(s.narrator);
    if (s.phase === 'night') return 'night';
    if (s.phase === 'morning') return dead ? 'death' : 'day';
    if (s.phase === 'revenge' || (dead && (s.phase === 'announce' || s.phase === 'coin'))) return 'death';
    if (s.phase === 'announce' || s.phase === 'roles' || s.phase === 'poll' || s.phase === 'coin' || s.phase === 'over' || s.phase === 'starting') return 'narrating';
    return 'idle';
  }

  function isNightPhase(phase) {
    return phase === 'lobby' || phase === 'starting' || phase === 'roles' || phase === 'night' || phase === 'over';
  }

  function applyGameState(s) {
    const speakId = (s.phase === 'speech' || s.phase === 'defense') && s.speaker ? s.speaker.id : null;
    let flagsDirty = false;
    for (const p of P) {
      const row = s.players.find(x => x.id === p.id);
      if (!row) continue;
      const meta = metaText(row, s);
      if (p.metaEl.textContent !== meta) { p.metaEl.textContent = meta; flagsDirty = true; }
      if (!row.alive && !p.dead && p.deathT == null) {
        if (p.booted && !reduced) {
          p.deathT = now();
          p.grey = false;
          armDeath();
        } else {
          p.dead = true;
          p.grey = false;
        }
        flagsDirty = true;
      } else if (row.alive && (p.dead || p.deathT != null)) {
        p.dead = false;
        p.deathT = null;
        p.grey = false;
        p.spr.style.filter = '';
        flagsDirty = true;
      }
      const speaking = speakId === p.id && row.alive && !p.dead && p.deathT == null;
      if (speaking !== p.speaking) { p.speaking = speaking; flagsDirty = true; }
      if ((speaking || p.dead) && p.booted) {
        if (speaking && !p.imgs.speaking.getAttribute('src')) p.imgs.speaking.src = p.speakUrl;
        if (p.dead && !p.imgs.dead.getAttribute('src')) p.imgs.dead.src = p.deadUrl;
      }
    }
    for (const p of P) p.booted = true;
    const narr = s.narrator || '';
    if (pBooted(s) && deathLine(narr) && narr !== lastNarr) armDeath();
    lastNarr = narr;
    setGod(phasePose(s));
    setTod(isNightPhase(s.phase) ? 1 : 0);
    if (flagsDirty) placeFlags();
  }

  function pBooted() { return P.some(p => p.booted); }

  function armDeath() {
    if (reduced) return;
    const t = now();
    if (redT != null && t - redT < 2.8) return;
    redT = t;
  }

  function setGod(pose) {
    if (pose === godPose) return;
    godFrom = godPose;
    godPose = pose;
    godPoseT = now();
    const im = god && god.imgs[pose];
    if (im && !im.getAttribute('src') && im.dataset.src) im.src = im.dataset.src;
  }

  function setTod(target) {
    if (!todReady) {
      tod = todTarget = target;
      todT = null;
      todArmed = false;
      todReady = true;
      paintSky(target);
      return;
    }
    if (target === todTarget) return;
    todTarget = target;
    todArmed = true;
    todDelay = now() + (reduced ? 0 : 0.4);
  }

  function todDur() { return reduced ? 0.3 : fadeSec; }

  function sampleN(t) {
    if (todT == null) return tod;
    const u = clamp((t - todT) / todDur());
    return todFrom + (todTo - todFrom) * EASE.inOut(u);
  }

  function paintSky(n) {
    $('sceneBgDay').style.opacity = hasDay ? String(1 - n) : '0';
    $('sceneTint').style.background = `rgba(30,45,120,${0.18 * Math.sin(Math.PI * n)})`;
    $('sceneVig').style.opacity = String(0.55 + 0.45 * n);
  }

  function showImg(p, img) {
    if (p.shown !== img) {
      p.shown = img;
      for (const k of ['idle', 'speaking', 'dead']) p.imgs[k].style.opacity = k === img ? '1' : '0';
      placeCosmetics(p, img);
    }
    if (img === 'speaking' && !p.imgs.speaking.getAttribute('src')) p.imgs.speaking.src = p.speakUrl;
    if (img === 'dead' && !p.imgs.dead.getAttribute('src')) p.imgs.dead.src = p.deadUrl;
  }

  function puffs(p, u) {
    if (lowEnd || reduced) {
      if (p.pf) for (const q of p.pf) q.d.style.opacity = '0';
      return;
    }
    if (!p.pf) {
      p.pf = [];
      for (let k = 0; k < 9; k++) {
        const d = document.createElement('div');
        d.className = 'puff';
        $('sceneFx').appendChild(d);
        p.pf.push({ d, a: p.rng() * Math.PI * 2, r: 0.4 + p.rng() * 0.6 });
      }
    }
    for (const q of p.pf) {
      const v = clamp((u - 0.15) / 0.9);
      const R = p.h * (0.15 + 0.55 * EASE.outCubic(v)) * q.r;
      const s = p.h * (0.18 + 0.25 * v);
      const o = v > 0 && v < 1 ? (1 - v) * 0.9 : 0;
      q.d.style.cssText = `left:${p.x + Math.cos(q.a) * R - s / 2}px;top:${p.y - p.h * 0.3 + Math.sin(q.a) * R * 0.6 - s / 2}px;width:${s}px;height:${s}px;opacity:${o}`;
    }
  }

  function paintPlayer(p, t) {
    const sp = p.speaking && !p.dead && p.deathT == null;
    const dying = p.deathT != null;
    if (reduced) {
      const img = (p.dead || dying) ? 'dead' : sp ? 'speaking' : 'idle';
      if ((p.dead || dying) && !p.grey) {
        p.dead = true;
        p.deathT = null;
        p.grey = true;
        p.spr.style.filter = GREY;
        needFlags = true;
      }
      showImg(p, p.dead ? 'dead' : img);
      const sig = (p.dead ? 'd' : '') + (sp ? 's' : '');
      if (p.held !== sig) {
        p.spr.style.transform = 'none';
        p.flag.style.transform = 'translate(-50%,-100%)' + (p.dead ? ' rotate(7deg)' : '');
        p.held = sig;
      }
      p.flag.classList.toggle('speaking', sp && !p.dead);
      p.flag.classList.toggle('dead', p.dead);
      if (p.glow) p.glow.style.opacity = '0';
      return;
    }
    p.held = false;
    let ty = 0, sx = 1, sy = 1, rot = 0, flip = 1, img = 'idle', filt = null, finished = false;
    if (!p.dead && !dying) {
      const b = Math.sin(t * Math.PI * 2 / p.period + p.phase);
      sy = 1 + 0.022 * b;
      sx = 1 - 0.012 * b;
      ty = -1.5 * ((b + 1) / 2) * (p.h / 150);
      if (!sp && t >= p.nextF) {
        p.fT = t;
        p.fType = Math.floor(p.rng() * 4);
        p.nextF = t + (lowEnd ? 8 + p.rng() * 6 : 4 + p.rng() * 6);
      }
      const u = t - p.fT;
      if (!sp) {
        if (p.fType === 0 && u < .5) {
          const q = u / .5;
          const hop = Math.sin(Math.PI * q);
          ty -= hop * p.h * 0.09;
          sy *= 1 + 0.06 * hop - (q > .85 ? 0.08 * (1 - q) / .15 : 0);
        }
        if (p.fType === 1 && u < 1.2) flip = (u > .15 && u < 1.05) ? -1 : 1;
        if (p.fType === 2 && u < .7) rot = Math.sin(u / .7 * Math.PI * 4) * 4 * (1 - u / .7);
        if (p.fType === 3 && u < .6) rot = -6 * Math.sin(Math.PI * u / .6);
      }
      if (sp) {
        const s = Math.abs(Math.sin(t * Math.PI * 2.4));
        ty -= s * p.h * 0.045;
        sy *= 1 + 0.04 * s;
        sx *= 1 - 0.02 * s;
      }
    }
    if (sp) img = 'speaking';
    if (p.dead) img = 'dead';
    if (dying) {
      const u = t - p.deathT;
      if (u < .18) {
        filt = `brightness(${1 + u / .18 * 1.6})`;
        img = 'idle';
      } else {
        img = 'dead';
        const q = clamp((u - .18) / .5);
        const land = EASE.outBack(q);
        sy = 0.75 + 0.25 * land;
        sx = 1.15 - 0.15 * land;
        const g = clamp((u - .7) / .8);
        filt = `grayscale(${.8 * g}) brightness(${1 - .08 * g}) contrast(${1 - .1 * g})`;
        if (u >= 1.5) {
          finished = true;
          p.dead = true;
          p.deathT = null;
          p.grey = true;
          filt = GREY;
          img = 'dead';
          sy = 1; sx = 1; ty = 0;
          needFlags = true;
        }
      }
      puffs(p, u);
    } else if (p.dead) {
      if (!p.grey) { p.spr.style.filter = GREY; p.grey = true; }
    } else if (p.spr.style.filter) {
      p.spr.style.filter = '';
    }
    showImg(p, img);
    if (filt != null) p.spr.style.filter = filt;
    if (p.dead && !dying) {
      if (!p.still) { p.spr.style.transform = 'none'; p.still = true; }
    } else {
      p.still = false;
      p.spr.style.transform = `translateY(${ty}px) rotate(${rot}deg) scale(${sx * flip},${sy})`;
    }
    p.spr.style.willChange = (sp || (dying && !finished)) ? 'transform' : '';
    p.glow.style.opacity = sp ? String(0.65 + 0.35 * Math.sin(t * Math.PI * 2 * 0.8)) : '0';
    const deadVis = p.dead || (dying && !finished && t - p.deathT > 0.4);
    const drop = dying && !finished ? p.drop * EASE.outCubic(clamp((t - p.deathT - 0.18) / 0.5)) : 0;
    const fty = (p.dead && !dying ? 0 : (sp ? ty : ty * 0.6)) + drop;
    const skew = sp ? `skewX(${Math.sin(t * Math.PI * 2 * 1.1) * 3}deg)` : '';
    const deadRot = deadVis ? 'rotate(7deg) translateY(4px)' : '';
    p.flag.classList.toggle('speaking', sp);
    p.flag.classList.toggle('dead', deadVis);
    p.flag.style.transform = `translate(-50%,-100%) translateY(${fty}px) ${skew} ${deadRot}`;
  }

  function paintGod(t) {
    if (!god) return;
    const pose = (redT != null && t - redT < 2.6 && !reduced) ? 'death' : godPose;
    if (pose !== godPose && pose === 'death') {
      /* vignette holds the death plate without forgetting the phase pose */
    }
    const shown = pose;
    const u = t - godPoseT;
    const fade = shown === godPose ? clamp(u / 0.2) : 1;
    for (const name of POSES) {
      const im = god.imgs[name];
      let o = 0;
      if (name === shown) o = shown === godPose ? fade : 1;
      else if (name === godFrom && shown === godPose) o = 1 - fade;
      im.style.opacity = String(o);
      if (o > 0 && !im.getAttribute('src') && im.dataset.src) im.src = im.dataset.src;
    }
    if (reduced) {
      god.spr.style.transform = 'none';
      god.glow.style.opacity = shown === 'death' ? '0' : '.55';
      return;
    }
    const gf = Math.sin(t * Math.PI * 2 / 4.2);
    let gty = -god.h * 0.02 * (gf + 1);
    let grot = 0;
    let gs = 1;
    if (shown === 'narrating') grot = Math.sin(t * Math.PI * 2 / 3) * 2;
    if (shown === godPose && u < .45) gs = 1 + 0.05 * Math.sin(Math.PI * u / .45);
    if (shown === 'night' || shown === 'day') gty -= god.h * 0.05 * EASE.outCubic(clamp((shown === godPose ? u : 1) / 0.6));
    god.spr.style.transform = `translateY(${gty}px) rotate(${grot}deg) scale(${gs})`;
    god.glow.style.opacity = shown === 'death' ? '0' : '.55';
  }

  function paintCamera(t) {
    const red = $('sceneRed'), stage = $('sceneStage');
    if (reduced || redT == null) {
      red.style.opacity = '0';
      stage.style.transform = '';
      return;
    }
    const u = t - redT;
    red.style.opacity = u < 2.6 ? String(Math.sin(Math.PI * clamp(u / 2.6)) * 0.9) : '0';
    const z = u < 2.8 ? 1 + 0.045 * Math.sin(Math.PI * clamp(u / 2.8)) : 1;
    stage.style.transform = z === 1 ? '' : `scale(${z})`;
  }

  function frame(ms) {
    if (!running) return;
    if (fpsT === 0) fpsT = ms;
    fpsFrames++;
    if (ms - fpsT > 800) {
      const fps = fpsFrames * 1000 / (ms - fpsT);
      if (fpsFrames > 8 && fps < 45) lowEnd = true;
      fpsFrames = 0;
      fpsT = ms;
    }
    const t = now();
    if (todArmed && t >= todDelay) {
      todFrom = sampleN(t);
      todTo = todTarget;
      todT = t;
      todArmed = false;
    }
    paintSky(sampleN(t));
    if (todT != null && t - todT >= todDur()) { tod = todTo; todT = null; }
    needFlags = false;
    for (const p of P) paintPlayer(p, t);
    if (needFlags) placeFlags();
    paintGod(t);
    paintCamera(t);
    raf = requestAnimationFrame(frame);
  }

  function ensureLoop() {
    if (running) return;
    running = true;
    if (!offset) offset = performance.now();
    raf = requestAnimationFrame(frame);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = performance.now();
      cancelAnimationFrame(raf);
      raf = 0;
    } else if (running) {
      offset += performance.now() - hiddenAt;
      raf = requestAnimationFrame(frame);
    }
  });

  addEventListener('resize', () => {
    preloadLobby();
    if (!current || !shown) return;
    const layoutName = isPhone() ? 'phone' : 'desktop';
    if (layoutName !== builtLayout) build(current, layoutName);
    else layout(current);
    applyGameState(current);
  });

  document.fonts?.ready.then(() => { if (current && shown) placeFlags(); });

  root.Scene = { load, whenReady, wanted, sync, hide, preloadLobby, lobbyPlate, layoutSeats, resolveCharacterId, resolveSceneId, resolveFlagSkin };
  load();
})(typeof window !== 'undefined' ? window : globalThis);
