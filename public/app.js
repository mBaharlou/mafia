const socket = io();
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SAVE_KEY = 'mafya-session';

let state = null, prevPhase = null, receivedAt = 0, guessRole = null, shooting = false, sacrificing = false, roleHidden = false, openRooms = [], leftRoom = false;
const voice = new Voice(socket);

// ---------- art ----------
$('skyline').innerHTML = ART.skyline();

// ---------- intro, sound, parallax ----------
$('enter').onclick = () => {
  SFX.start();
  SFX.play.reveal();
  $('splash').classList.add('out');
  setTimeout(() => $('splash').remove(), 900);
  if (matchMedia('(min-width: 901px)').matches) $('name').focus();
};
const sp = $('soundPanel');
$('sndOn').checked = SFX.settings.on; $('sndMusic').value = SFX.settings.music; $('sndFx').value = SFX.settings.fx;
$('sndOn').onchange = e => { SFX.start(); SFX.set('on', e.target.checked); syncSoundIcons(); };
$('sndMusic').oninput = e => SFX.set('music', +e.target.value);
$('sndFx').oninput = e => { SFX.set('fx', +e.target.value); SFX.play.click(); };
function syncSoundIcons() { document.querySelectorAll('.sound-btn').forEach(b => { b.textContent = SFX.settings.on ? '🔊' : '🔇'; }); }
syncSoundIcons();
document.querySelectorAll('.sound-btn').forEach(b => b.onclick = e => { e.stopPropagation(); sp.classList.toggle('hidden'); });
document.addEventListener('click', e => {
  if (!sp.contains(e.target)) sp.classList.add('hidden');
  if (e.target.closest('button')) SFX.play.click();
});
addEventListener('pointermove', e => {
  if ($('home').classList.contains('hidden')) return;
  document.body.style.setProperty('--px', (e.clientX / innerWidth - .5).toFixed(3));
  document.body.style.setProperty('--py', (e.clientY / innerHeight - .5).toFixed(3));
});

// ---------- main menu ----------
const CHAR_KEY = 'mafya-character';
let characters = [];
const characterById = new Map();
$('name').value = localStorage.getItem('mafya-name') || '';
const params = new URLSearchParams(location.search);
if (params.get('oda')) $('code').value = params.get('oda').toUpperCase();

function selectedCharacter() {
  return document.querySelector('#charGrid input[name="character"]:checked')?.value || '';
}
function myPick() {
  const name = $('name').value.trim();
  const characterId = selectedCharacter();
  if (!name) { $('homeError').textContent = 'Önce takma adını yaz 🙂'; $('name').focus(); return null; }
  if (!characterId) { $('homeError').textContent = 'Bir karakter seç.'; document.querySelector('#charGrid input')?.focus(); return null; }
  localStorage.setItem('mafya-name', name);
  localStorage.setItem(CHAR_KEY, characterId);
  $('homeError').textContent = '';
  return { name, characterId };
}
async function go(event, data) {
  const pick = myPick();
  if (!pick) return;
  await voice.startMic(); // asks for mic permission inside the click
  socket.emit(event, { ...data, ...pick });
}
$('charForm').onsubmit = e => e.preventDefault();
$('charGrid').addEventListener('change', e => {
  if (e.target?.name !== 'character' || !e.target.value) return;
  localStorage.setItem(CHAR_KEY, e.target.value);
  updatePreview();
  refreshJoinLock();
});

function bindCharacterImage(img) {
  const box = () => img.closest('.char-art, .layer-base, .char-summary-art, .char-hero') || img.parentElement;
  const fail = () => {
    const smaller = img.dataset.img128;
    if (smaller && img.getAttribute('src') !== smaller) { img.src = smaller; return; }
    box()?.classList.remove('has-img');
    img.remove();
  };
  const show = () => { if (img.naturalWidth > 0) box()?.classList.add('has-img'); else fail(); };
  img.addEventListener('load', show);
  img.addEventListener('error', fail);
  if (img.complete) show();
}
function charInitial(c) {
  return String(c?.placeholder?.initial || c?.name || '?').trim().charAt(0).toLocaleUpperCase('tr') || '?';
}
function accentOf(c) {
  return /^#[0-9A-Fa-f]{6}$/.test(c?.accent || '') ? c.accent : '#3A3F4B';
}
function stateFiles(c, state) {
  return c?.states?.[state] || c?.states?.default || c?.images || {};
}
function refreshJoinLock() {
  $('quickPlay').disabled = !($('name').value.trim() && selectedCharacter());
}
function updatePreview() {
  const c = characterOf(selectedCharacter());
  const summary = $('charSummary');
  if (!c) {
    summary.hidden = true;
    $('charHeroImg').removeAttribute('src');
    $('charHero').classList.remove('has-img');
    $('charHeroName').textContent = '';
    $('charHeroDesc').textContent = '';
    $('charHeroFallback').textContent = '';
    return;
  }
  const initial = charInitial(c);
  const desc = c.description_tr || c.description || '';
  summary.hidden = false;
  $('charSummaryName').textContent = c.name;
  $('charSummaryDesc').textContent = desc;
  $('charSummaryFallback').textContent = initial;
  const thumb = stateFiles(c, 'default')['256'] || c.images?.['256'] || '';
  const sumImg = $('charSummaryImg');
  if (thumb && sumImg.getAttribute('src') !== thumb) { sumImg.src = thumb; bindCharacterImage(sumImg); }
  $('charHeroName').textContent = c.name;
  $('charHeroDesc').textContent = desc;
  $('charHeroFallback').textContent = initial;
  if (!matchMedia('(min-width: 901px)').matches) return;
  const hero = stateFiles(c, 'default')['512'] || c.images?.['512'] || thumb;
  const heroImg = $('charHeroImg');
  if (hero && heroImg.getAttribute('src') !== hero) { heroImg.src = hero; bindCharacterImage(heroImg); }
}
function renderCharGrid() {
  const saved = localStorage.getItem(CHAR_KEY) || '';
  const known = characters.some(c => c.id === saved);
  $('charCount').textContent = `${characters.length} karakter`;
  $('charGrid').innerHTML = characters.map(c => {
    const initial = charInitial(c);
    const src = stateFiles(c, 'default')['256'] || c.images?.['256'] || '';
    return `<label class="char-tile" style="--accent:${accentOf(c)}">
      <input type="radio" name="character" value="${esc(c.id)}" ${known && c.id === saved ? 'checked' : ''} aria-label="${esc(c.name)}" aria-describedby="char-d-${esc(c.id)}">
      <span class="char-art" aria-hidden="true"><span class="char-fallback">${esc(initial)}</span>${src ? `<img alt="" width="256" height="256" decoding="async" src="${esc(src)}">` : ''}</span>
      <span class="char-label">${esc(c.name)}</span>
      <span class="char-acc" aria-hidden="true"></span>
    </label>`;
  }).join('');
  $('charDesc').innerHTML = characters.map(c => `<span class="sr-only" id="char-d-${esc(c.id)}">${esc(c.description_tr || c.description || '')}</span>`).join('');
  $('charGrid').querySelectorAll('img').forEach(bindCharacterImage);
  $('charStatus').textContent = 'Şapkalar ve kostümler yakında mağazada ✦';
  for (const c of characters) {
    const href = stateFiles(c, 'default')['256'];
    if (!href || document.querySelector(`link[data-preload="${href}"]`)) continue;
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = href;
    link.dataset.preload = href;
    document.head.appendChild(link);
  }
  updatePreview();
  refreshJoinLock();
}
$('name').addEventListener('input', refreshJoinLock);
matchMedia('(min-width: 901px)').addEventListener('change', updatePreview);
fetch('/characters/characters.json').then(r => {
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}).then(data => {
  characters = Array.isArray(data.characters) ? data.characters : [];
  characterById.clear();
  for (const c of characters) if (c?.id) characterById.set(c.id, c);
  renderCharGrid();
  if (state) render();
}).catch(() => { $('charStatus').textContent = 'Karakterler yüklenemedi. Sayfayı yenile.'; });
$('quickPlay').onclick = () => {
  const best = [...openRooms].filter(r => r.count < r.size).sort((a, b) => b.count - a.count)[0];
  best ? go('join', { code: best.code }) : go('create', { size: 9 });
};
document.querySelectorAll('.mode.go').forEach(b => b.onclick = () => go('create', { size: Number(b.dataset.size) }));
$('joinCode').onclick = () => go('join', { code: $('code').value.trim().toUpperCase() });
$('code').onkeydown = e => { if (e.key === 'Enter') $('joinCode').click(); };
$('name').onkeydown = e => { if (e.key === 'Enter') $('quickPlay').click(); };
$('roomList').onclick = e => { const c = e.target.closest('[data-join]')?.dataset.join; if (c) go('join', { code: c }); };
// "How to play" and "Roles" open from the menu bar and from the in-game HUD.
const closeModals = () => document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
document.querySelectorAll('[data-open]').forEach(b => b.onclick = () => {
  closeModals();
  const m = $(b.dataset.open);
  m.classList.remove('hidden');
  m.querySelector('.modal-box').scrollTop = 0;
});
document.querySelectorAll('.modal').forEach(m => {
  if (m.id === 'leaveModal') return;
  m.onclick = e => { if (e.target === m || e.target.closest('[data-close]')) closeModals(); };
});
addEventListener('keydown', e => {
  const leaveOpen = $('leaveModal') && !$('leaveModal').classList.contains('hidden');
  if (leaveOpen && e.key === 'Tab') {
    const items = [$('leaveStay'), $('leaveGo')];
    e.preventDefault();
    let i = items.indexOf(document.activeElement);
    i = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i + 1) % items.length;
    items[i].focus();
    return;
  }
  if (e.key !== 'Escape') return;
  if (leaveOpen) { e.preventDefault(); closeLeaveConfirm(); return; }
  closeModals();
});

fetch('/roles.json').then(r => r.json()).then(roles => {
  const card = r => `<div class="role-mini t-${r.team}"><span class="ic">${r.icon}</span><div><b>${esc(r.name)}</b>${esc(r.desc)}
    <div class="sizes">${[9, 12, 16].map(n => `<span class="${r.sizes.includes(n) ? 'on' : ''}">${n}</span>`).join('')}</div></div></div>`;
  const all = Object.values(roles);
  $('roleGridMafia').innerHTML = all.filter(r => r.team === 'mafia').map(card).join('');
  $('roleGridCity').innerHTML = all.filter(r => r.team === 'city').map(card).join('');
});

socket.on('rooms', ({ rooms, online }) => {
  openRooms = rooms;
  $('online').textContent = `${online} çevrimiçi`;  $('roomList').innerHTML = rooms.length
    ? rooms.map(r => `<div class="room-item"><span class="rc">${esc(r.code)}</span>
        <span class="seats-bar" title="${r.count}/${r.size}">${Array.from({ length: r.size }, (_, i) => `<i class="${i < r.count ? 'on' : ''}"></i>`).join('')}</span>
        <button class="btn-gold btn-sm" data-join="${esc(r.code)}">KATIL</button></div>`).join('')
    : '<div class="empty">Şu an açık masa yok. “Hemen Oyna” ile ilk masayı sen kur!</div>';
});
let toastTimer = null;
function showToast(msg) {
  const el = $('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 4200);
}
socket.on('err', msg => {
  if ($('room').classList.contains('hidden')) $('homeError').textContent = msg;
  else showToast(msg);
});
socket.on('joined', ({ code, token }) => {
  leftRoom = false;
  localStorage.setItem(SAVE_KEY, JSON.stringify({ code, token }));
  history.replaceState(null, '', '?oda=' + code);
  voice.startMic(); // no-op if already on; needed after a page reload
});
socket.on('connect', () => {
  const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
  if (saved) socket.emit('resume', saved);
});
socket.on('resumeFailed', () => { localStorage.removeItem(SAVE_KEY); showHome(); });
socket.on('state', s => {
  if (leftRoom) return;
  state = s; receivedAt = Date.now(); render(); prevPhase = s.phase;
  if (!gameActive()) closeLeaveConfirm();
});

function gameActive() {
  return !!state && state.phase !== 'lobby' && state.phase !== 'over';
}
function hideLeaveConfirm(restoreFocus) {
  const modal = $('leaveModal');
  if (!modal || modal.classList.contains('hidden')) return;
  modal.classList.add('hidden');
  if (restoreFocus) $('leave')?.focus();
}
function closeLeaveConfirm() { hideLeaveConfirm(true); }
function openLeaveConfirm() {
  const modal = $('leaveModal');
  modal.classList.remove('hidden');
  const stay = $('leaveStay');
  stay.focus();
  requestAnimationFrame(() => stay.focus());
}
function performLeave() {
  leftRoom = true;
  hideLeaveConfirm(false);
  socket.emit('leave');
  localStorage.removeItem(SAVE_KEY);
  history.replaceState(null, '', location.pathname);
  state = prevPhase = null;
  voice.closeAll();
  showHome();
}
$('leave').onclick = () => { if (gameActive()) openLeaveConfirm(); else performLeave(); };
$('leaveStay').onclick = () => closeLeaveConfirm();
$('leaveGo').onclick = () => performLeave();
$('leaveModal').onclick = e => { if (e.target === $('leaveModal')) closeLeaveConfirm(); };
addEventListener('beforeunload', e => {
  if (!gameActive()) return;
  e.preventDefault();
  e.returnValue = '';
});
function showHome() {
  $('home').classList.remove('hidden'); $('room').classList.add('hidden'); $('topnav').classList.remove('hidden');
  document.documentElement.dataset.phase = 'night'; FX.mode('night'); SFX.mode('night'); SFX.duck(false);
  document.body.classList.remove('scene-on', 'lobby-on');
  Scene.hide();
  $('sceneNarr').hidden = true;
}

// ---------- game room ----------
const PHASES = {
  lobby: ['Bekleme salonu', 'Masa doluyor'], starting: ['Hazırlan', 'Oyun başlıyor'], roles: ['Roller', 'Rolüne bak, kimseye söyleme'],
  speech: ['Gündüz', 'Konuşma turu'], defense: ['Savunma', 'Son sözler'], vote: ['Oylama', 'Kim çıksın?'], revote: ['Son oylama', 'Karar anı'],
  poll: ['Soru', 'Dışarıdakiler'], revenge: ['İntikam', 'Terörist son hamlesini yapıyor'], morning: ['Sabah', 'Masumlar uyanıyor'], announce: ['Duyuru', ''], coin: ['Yazı tura', 'Şans karar verecek'],
  night: ['Gece', 'Masumlar uyuyor'], over: ['Oyun bitti', ''],
};
const DARK = ['lobby', 'starting', 'roles', 'night', 'over'];
const nameOf = id => state.players.find(p => p.id === id)?.name || '?';

function render() {
  const s = state;
  $('home').classList.add('hidden');
  $('topnav').classList.add('hidden');
  $('room').classList.remove('hidden');
  const mode = DARK.includes(s.phase) ? 'night' : 'day';
  document.documentElement.dataset.phase = mode;
  FX.mode(mode);
  SFX.mode(mode);
  SFX.duck(s.audio.hear.length > 0 || s.audio.sendTo.length > 0); // keep voices clear
  $('roomCode').textContent = s.code;
  const [title, sub] = PHASES[s.phase];
  $('phaseLabel').textContent = s.phase === 'night' ? `Gece ${s.night}` : s.phase === 'speech' ? `Gün ${s.day}` : title;
  $('phaseSub').textContent = s.phase === 'speech' && s.day === 1 ? 'Tanışma turu' : s.phase === 'lobby' ? `${s.players.length}/${s.size} oyuncu` : sub;
  const text = s.narrator || (s.phase === 'lobby' ? `Oyuncular bekleniyor… (${s.players.length}/${s.size})` : '');
  const sub$ = $('narrator');
  if (sub$.textContent !== text) {
    if (prevPhase && /oyundan çıktı|vurdu|götürdü/.test(text)) SFX.play.death();
    sub$.textContent = text; sub$.classList.remove('pop'); void sub$.offsetWidth; sub$.classList.add('pop'); }
  paintLobby(s);
  const sceneOn = Scene.wanted(s);
  const lobbyOn = !sceneOn && (s.phase === 'lobby' || s.phase === 'starting');
  document.body.classList.toggle('scene-on', sceneOn);
  document.body.classList.toggle('lobby-on', lobbyOn);
  $('sceneNarr').hidden = !sceneOn;
  if (sceneOn) $('sceneNarr').textContent = text;
  if (sceneOn) Scene.sync(s);
  else Scene.hide();
  renderSeats(s);
  renderRole(s);
  renderAction(s);
  renderFeeds(s);
  cinematic(s);
  voice.update(s);
  tick();
}

function characterOf(id) { return characterById.get(id) || null; }

// 128 covers a seat up to 64 CSS px at 2×. Anything larger asks for 256. 512 stays on the select preview.
function seatCssPx() {
  if (window.innerWidth <= 680 || window.innerHeight <= 500) return 44;
  return parseFloat(getComputedStyle($('stage')).getPropertyValue('--portrait')) || 58;
}
function seatBucket(cssPx) {
  const dpr = window.devicePixelRatio || 1;
  return cssPx * dpr > 128 ? '256' : '128';
}
function avatarHtml(p, speaking) {
  const ch = characterOf(p.characterId);
  const pose = !p.alive ? 'dead' : speaking ? 'speaking' : 'default';
  const files = stateFiles(ch, pose);
  const img128 = files['128'] || '';
  const img256 = files['256'] || img128;
  const bucket = seatBucket(seatCssPx());
  const src = files[bucket] || img128 || img256;
  const initial = charInitial(ch) === '?' ? String(p.name || '?').trim().charAt(0).toLocaleUpperCase('tr') : charInitial(ch);
  const img = src
    ? `<img class="avatar-img" alt="" width="${bucket}" height="${bucket}" loading="lazy" decoding="async" src="${esc(src)}" data-img128="${esc(img128)}" data-img256="${esc(img256)}">`
    : '';
  // layer_order: seat_bg, base, costume, hat, effect, ui_ring. Costume, hat and effect stay empty.
  return `<div class="pic avatar disk" style="--accent:${accentOf(ch)}">
    <span class="layer layer-bg" aria-hidden="true"></span>
    <span class="layer layer-base">${img}<span class="avatar-fallback" aria-hidden="true">${esc(initial)}</span></span>
    <span class="layer layer-costume" hidden></span>
    <span class="layer layer-hat" hidden></span>
    <span class="layer layer-effect" hidden></span>
    <span class="layer layer-ring" aria-hidden="true"></span>
  </div>`;
}
function syncAvatarResolution() {
  const key = seatBucket(seatCssPx());
  document.querySelectorAll('#stage .avatar-img').forEach(img => {
    const next = img.dataset['img' + key];
    if (next && img.getAttribute('src') !== next) img.src = next;
  });
}

function renderSeats(s) {
  const stage = $('stage');
  if (Scene.wanted(s)) {
    stage.querySelectorAll('.seat').forEach(e => e.remove());
    return;
  }
  stage.querySelectorAll('.seat').forEach(e => e.remove());
  const n = s.size;
  stage.dataset.size = n;
  s.players.forEach(p => {
    const el = document.createElement('div');
    const speaking = s.speaker?.id === p.id;
    const role = p.role && s.roles[p.role];
    const votes = s.vote?.counts[p.id];
    const showRole = role && (s.phase === 'over' || p.id !== s.myId);
    el.className = 'seat' + (p.id === s.myId ? ' me' : '') + (!p.alive ? ' dead' : '') + (p.mate ? ' mate' : '') + (speaking ? ' speaking' : '') + (showRole ? ' revealed' : '');
    el.dataset.seat = String(p.seat);
    el.dataset.state = !p.alive ? 'dead' : speaking ? 'speaking' : 'alive';
    if (p.characterId) el.dataset.character = p.characterId;
    const pose = !p.alive ? ', elendi' : speaking ? ', konuşuyor' : '';
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', `${p.name}, ${characterOf(p.characterId)?.name || 'oyuncu'}${pose}`);
    if (showRole) el.style.setProperty('--role', role.team === 'mafia' ? 'var(--mafia)' : 'var(--city)');
    el.innerHTML = `
      <div class="portrait">${avatarHtml(p, speaking)}
        ${p.id === s.myId ? '<span class="you">SEN</span>' : ''}
        ${p.alive && p.silenced ? '<span class="badge">🤐</span>' : p.alive && !p.connected ? '<span class="badge" title="Bağlantı koptu">📵</span>' : ''}
        ${votes ? `<span class="badge votes">${votes}</span>` : ''}
        ${speaking ? '<span class="eq"><i></i><i></i><i></i><i></i></span>' : ''}
      </div>
      <div class="plate">${esc(p.name)}</div>
      ${showRole ? `<div class="tag" style="color:var(--${role.team === 'mafia' ? 'mafia' : 'city'})">${role.icon} ${esc(role.name)}</div>`
        : p.mate && p.id !== s.myId ? '<div class="tag" style="color:var(--mafia)">🩸 Mafya</div>' : ''}`;
    el.querySelectorAll('.avatar-img').forEach(bindCharacterImage);
    stage.appendChild(el);
  });
  layoutSeats();
}

// Lobby seats sit on the scene plate: a ring on a wide screen, a grid on a phone.
let layoutLock = false;
function lobbyPhone() {
  return matchMedia('(max-width: 800px)').matches || innerHeight <= 500;
}
function lobbySafe() {
  const W = innerWidth, H = innerHeight;
  if (lobbyPhone()) {
    const top = Math.min(148, Math.round(H * 0.18));
    const bottom = Math.min(236, Math.round(H * 0.30));
    return { x: 8, y: top, w: Math.max(140, W - 16), h: Math.max(200, H - top - bottom), phone: true };
  }
  const left = Math.min(380, Math.round(W * 0.2));
  const right = Math.min(380, Math.round(W * 0.2));
  const top = 108;
  const bottom = Math.min(270, Math.round(H * 0.26));
  return { x: left, y: top, w: Math.max(280, W - left - right), h: Math.max(280, H - top - bottom), phone: false };
}
function placeKahin(footX, footY, h) {
  const el = $('lobbyKahin');
  if (!el) return;
  el.hidden = false;
  const w = h * 0.75;
  el.style.height = h + 'px';
  el.style.width = w + 'px';
  el.style.left = (footX - w / 2) + 'px';
  el.style.top = (footY - h * 0.97) + 'px';
}
function rectsOverlap(a, b) {
  return Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
    && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
}
function kahinBody() {
  const el = $('lobbyKahin');
  if (!el || el.hidden) return null;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  // Idle sprite's opaque box, so heads can sit in the empty canvas margin.
  return {
    left: r.left + r.width * 0.24,
    right: r.left + r.width * 0.75,
    top: r.top + r.height * 0.07,
    bottom: r.top + r.height * 0.97,
    width: r.width,
  };
}
function seatsHit(seats) {
  const rects = seats.map(el => el.getBoundingClientRect());
  const kahin = kahinBody();
  const blocks = [...document.querySelectorAll('.hud, #action, #historyPanel')]
    .filter(el => !el.hidden && !el.classList.contains('hidden'))
    .map(el => el.getBoundingClientRect())
    .filter(r => r.width > 8 && r.height > 8);
  for (let i = 0; i < rects.length; i++) {
    const a = rects[i];
    if (a.width < 2) continue;
    if (a.left < 1 || a.top < 1 || a.right > innerWidth - 1 || a.bottom > innerHeight - 1) return true;
    if (kahin && rectsOverlap(a, kahin)) return true;
    if (blocks.some(b => rectsOverlap(a, b))) return true;
    for (let j = i + 1; j < rects.length; j++) if (rectsOverlap(a, rects[j])) return true;
  }
  return false;
}
function paintLobby(s) {
  const on = !!(s && (s.phase === 'lobby' || s.phase === 'starting'));
  const stage = $('stage');
  const bg = $('lobbyBg');
  const kahin = $('lobbyKahin');
  if (!on) {
    stage?.classList.remove('is-lobby');
    if (bg) bg.hidden = true;
    if (kahin) kahin.hidden = true;
    return;
  }
  stage.classList.add('is-lobby');
  const plate = Scene.lobbyPlate?.(s.sceneId);
  if (!plate || !bg || !kahin) return;
  if (bg.dataset.url !== plate.night) {
    bg.dataset.url = plate.night;
    bg.style.backgroundImage = `url("${plate.night}")`;
  }
  bg.hidden = false;
  const img = $('lobbyKahinImg');
  if (img && img.getAttribute('src') !== plate.kahin) img.src = plate.kahin;
  kahin.hidden = false;
}
function layoutSeats() {
  const stage = $('stage');
  if (!stage || layoutLock || $('room').classList.contains('hidden') || document.body.classList.contains('scene-on')) return;
  layoutLock = true;
  try {
    const seats = [...stage.querySelectorAll('.seat')];
    layoutPanels();
    if (!stage.classList.contains('is-lobby')) {
      stage.style.height = stage.style.minHeight = '';
      for (const seat of seats) seat.style.left = seat.style.top = '';
      return;
    }
    stage.style.height = innerHeight + 'px';
    stage.style.minHeight = innerHeight + 'px';
    if (lobbyPhone()) layoutLobbyGrid(stage, seats);
    else layoutLobbyRing(stage, seats);
  } finally {
    syncAvatarResolution();
    layoutLock = false;
  }
}
function layoutLobbyRing(stage, seats) {
  const box = lobbySafe();
  const n = seats.length;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h * 0.5;
  const portrait = n <= 1 ? 96 : n >= 16 ? 48 : n >= 8 ? 64 : 78;
  const plate = n >= 16 ? 96 : n >= 8 ? 118 : 136;
  const kahinH = Math.min(box.h * (n <= 1 ? 0.62 : 0.46), n >= 16 ? 300 : 420);
  const spread = n <= 1 ? 0.36 : n <= 4 ? 0.7 : 1;
  stage.style.setProperty('--portrait', portrait + 'px');
  stage.style.setProperty('--plate-w', plate + 'px');
  const seatH = portrait + 32;
  const rx = Math.max(120, (box.w / 2 - plate / 2 - 8) * spread);
  const ry = Math.max(96, (box.h / 2 - seatH / 2 - 6) * spread);
  const gap = n >= 12 ? 0.2 : 0.26;
  placeKahin(cx, cy + 6, kahinH);
  seats.forEach((seat, i) => {
    const a = n <= 1 ? Math.PI / 2 : (-Math.PI / 2 + Math.PI * gap) + (2 * Math.PI * (1 - gap)) * (i / Math.max(1, n - 1));
    seat.style.left = (cx + rx * Math.cos(a)) + 'px';
    seat.style.top = (cy + ry * Math.sin(a)) + 'px';
  });
}
function layoutLobbyGrid(stage, seats) {
  const box = lobbySafe();
  const n = seats.length;
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : 4;
  const rows = Math.max(1, Math.ceil(n / cols));
  let portrait = n >= 16 ? 40 : 48;
  let kahinH = n >= 16 ? Math.min(118, box.h * 0.24) : n >= 8 ? Math.min(156, box.h * 0.3) : Math.min(210, box.h * 0.4);
  const place = () => {
    const gridTop = box.y + kahinH + 8;
    const gridH = Math.max(portrait + 30, box.y + box.h - gridTop);
    const cellW = box.w / cols;
    const cellH = gridH / rows;
    stage.style.setProperty('--portrait', portrait + 'px');
    stage.style.setProperty('--plate-w', Math.max(72, Math.floor(cellW - 8)) + 'px');
    placeKahin(box.x + box.w / 2, box.y + kahinH * 0.97, kahinH);
    seats.forEach((seat, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      seat.style.left = (box.x + cellW * (c + 0.5)) + 'px';
      seat.style.top = (gridTop + cellH * r + Math.min(cellH * 0.42, portrait / 2 + 6)) + 'px';
    });
  };
  place();
  for (let attempt = 0; attempt < 5 && seats.length && seatsHit(seats); attempt++) {
    portrait = Math.max(32, portrait - 4);
    kahinH = Math.max(84, kahinH - 14);
    place();
  }
}

const stackMq = window.matchMedia('(max-width: 1100px)');
function layoutPanels() {
  const action = $('action');
  const stageWrap = document.querySelector('.stage-wrap');
  const role = $('roleCard');
  if (!action || !stageWrap || !role) return;
  if (stackMq.matches) {
    if (action.nextElementSibling !== stageWrap) stageWrap.before(action);
    action.classList.add('action-lead');
  } else if (action.previousElementSibling !== role) {
    role.after(action);
    action.classList.remove('action-lead');
  }
}
stackMq.addEventListener('change', () => { layoutPanels(); layoutSeats(); });
addEventListener('resize', () => {
  if (document.body.classList.contains('kb-open')) return;
  if (state && (state.phase === 'lobby' || state.phase === 'starting')) paintLobby(state);
  layoutSeats();
});
document.fonts?.ready.then(() => { if (state) { layoutSeats(); if (Scene.wanted(state)) Scene.sync(state); } });
Scene.whenReady(() => { Scene.preloadLobby(); if (state) render(); });
layoutPanels();

let kbTimer = null;
document.addEventListener('focusin', e => {
  const t = e.target;
  if (!(t instanceof HTMLElement) || !t.matches('textarea, select, input:not([type="radio"]):not([type="checkbox"])')) return;
  document.body.classList.add('kb-open');
  const block = t.closest('.card, .chat-form, .row, .mafia-panel, .action') || t;
  clearTimeout(kbTimer);
  kbTimer = setTimeout(() => block.scrollIntoView({ block: 'start', inline: 'nearest' }), 280);
});
document.addEventListener('focusout', () => {
  clearTimeout(kbTimer);
  setTimeout(() => {
    const a = document.activeElement;
    if (!a || !a.matches?.('textarea, select, input:not([type="radio"]):not([type="checkbox"])')) document.body.classList.remove('kb-open');
  }, 180);
});

function renderRole(s) {
  const card = $('roleCard');
  if (!s.me) return card.classList.add('hidden');
  const r = s.roles[s.me.role];
  card.className = `glass role-card deco t-${r.team}` + (roleHidden ? ' blur' : '');
  card.innerHTML = `
    <div class="body"><div class="head"><span class="icon">${r.icon}</span><div>
      <div class="team">${r.team === 'mafia' ? 'MAFYA' : 'MASUM'}</div><div class="rname">${esc(r.name)}</div></div></div>
      <p>${esc(r.desc)}</p>${s.me.hasGun ? '<p><b>🔫 Elinde bir silah var!</b> Konuşma sıran gelince kullanabilirsin.</p>' : ''}</div>
    <button class="btn-link" id="toggleRole">${roleHidden ? '👁️ Rolümü göster' : '🙈 Rolümü gizle'}</button>`;
  $('toggleRole').onclick = () => { roleHidden = !roleHidden; renderRole(state); };
}

function targetButtons(ids, chosen, red) {
  return `<div class="targets">${ids.map(id => `<button class="${(Array.isArray(chosen) ? chosen.includes(id) : chosen === id) ? 'on' + (red ? ' red' : '') : ''}" data-t="${esc(id)}">${esc(nameOf(id))}</button>`).join('')}</div>`;
}

function renderAction(s) {
  const me = s.me, alive = me?.alive;
  let html = '';
  const deadNote = me && !alive && s.phase !== 'over' ? '<div class="dead-note">💀 Oyundan çıktın. İzlemeye devam edebilirsin; konuşamaz ve oy veremezsin.</div>' : '';

  switch (s.phase) {
    case 'lobby': {
      const link = `${location.origin}/?oda=${s.code}`;
      html = `<p class="big">Masa doluyor: ${s.players.length}/${s.size}</p>
        <p class="soft">${s.size} kişi olunca oyun kendiliğinden başlar. Arkadaşlarını çağır:</p>
        <div class="row"><input readonly value="${esc(link)}"><button class="btn-gold btn-sm" id="copy">KOPYALA</button></div>
        <p class="soft" style="margin-top:10px">🎤 Bekleme salonunda herkes birbirini duyar.</p>`;
      break;
    }
    case 'starting': html = '<p class="big">Masa doldu! 🎉</p><p class="soft">Birazdan rolün açıklanacak. Kimseye gösterme.</p>'; break;
    case 'roles': html = '<p class="big">Rolüne bak 🤫</p><p class="soft">Rol kartın burada her zaman duruyor. İstersen gizleyebilirsin.</p>'; break;
    case 'speech': case 'defense': {
      const sp = s.speaker;
      if (sp.id === s.myId) {
        html = `<p class="big">🎤 Sıra sende!</p><p class="soft">Konuş, herkes seni duyuyor.</p>`;
        if (s.challenge?.status === 'pending') html += `<div class="callout"><b>${esc(nameOf(s.challenge.from))}</b> senden sonra 30 saniye ek konuşma istiyor.<div class="btns"><button class="btn-ok btn-sm" id="chYes">KABUL ET</button><button class="btn-ghost btn-sm" id="chNo">REDDET</button></div></div>`;
        if (s.canShoot) html += shooting
          ? `<div class="callout"><b>🔫 Kimi vuruyorsun?</b><p class="soft">Mafyaysa çıkar; iyiyse kimse çıkmaz. İki durumda da hemen gece olur.</p>${targetButtons(s.players.filter(p => p.alive && p.id !== s.myId).map(p => p.id), null, true)}<div class="btns"><button class="btn-ghost btn-sm" id="noShoot">VAZGEÇ</button></div></div>`
          : '<div class="btns"><button class="btn-danger" id="shoot">🔫 SİLAHI KULLAN</button></div>';
        html += '<div class="btns"><button class="btn-gold" id="endSpeech">KONUŞMAMI BİTİR ✔</button></div>';
      } else {
        html = `<p class="big">${esc(nameOf(sp.id))} ${sp.kind === 'defense' ? 'kendini savunuyor' : sp.kind === 'challenge' ? 'ek süre kullanıyor' : 'konuşuyor'} 🎤</p><p class="soft">Dinle. Sıran gelince sen de konuşacaksın.</p>`;
        if (s.challenge) html += `<p class="soft">${esc(nameOf(s.challenge.from))} 30 sn ek süre istedi: ${{ pending: 'cevap bekleniyor…', accepted: 'kabul edildi ✔', declined: 'reddedildi ✖' }[s.challenge.status]}</p>`;
        if (s.canChallenge) html += `<div class="btns"><button class="btn-ghost" id="challenge">⏱ 30 SN EK SÜRE İSTE</button></div><p class="soft" style="margin-top:8px">${esc(nameOf(sp.id))} kabul ederse, onun konuşması bitince 30 saniye daha konuşursun. Günde bir kez.</p>`;
      }
      break;
    }
    case 'vote': case 'revote': {
      const v = s.vote;
      html = `<p class="big">🗳️ ${s.phase === 'revote' ? 'Son oylama' : 'Oylama'}</p><p class="soft">Çıkmasını istediğin kişilere dokun (birden fazla seçebilirsin). Gereken oy: <b>${v.need}</b></p>`;
      if (alive) html += targetButtons(v.candidates.filter(id => id !== s.myId), v.mine, true);
      html += `<div class="vote-bars">${v.candidates.map(id => `<div class="vote-bar ${v.counts[id] >= v.need ? 'hit' : ''}"><span>${esc(nameOf(id))}</span><span class="track"><span class="fill" style="width:${Math.min(100, v.counts[id] / v.need * 100)}%"></span></span><b>${v.counts[id]}/${v.need}</b></div>`).join('')}</div>`;
      break;
    }
    case 'revenge':
      html = s.revengeTargets
        ? `<p class="big">💣 Kimi yanında götürüyorsun?</p><p class="soft">Oylamayla çıktın ama son hamle senin. Seçtiğin kişi de oyundan çıkar.</p>${targetButtons(s.revengeTargets, null, true).replaceAll('data-t=', 'data-r=')}`
        : '<p class="big">💣 Terörist son hamlesini yapıyor…</p><p class="soft">Yanında kimi götüreceğini seçiyor.</p>';
      break;
    case 'poll':
      html = '<p class="big">❓ Dışarıdakiler</p><p class="soft">Çıkanların kaçı masum, kaçı mafya öğrenmek ister misin? (Kim olduğu söylenmez.)</p>';
      if (alive) html += `<div class="btns"><button class="${s.poll.mine === true ? 'btn-gold' : 'btn-ghost'}" id="pollYes">EVET</button><button class="${s.poll.mine === false ? 'btn-gold' : 'btn-ghost'}" id="pollNo">HAYIR</button></div>`;
      break;
    case 'night': {
      const opts = s.options || [];
      if (!opts.length) html = me?.team === 'mafia' && alive
        ? '<p class="big">🩸 Mafya uyandı</p><p class="soft">Mafya arkadaşların masada kırmızı çerçeveli. Aşağıdan onlarla yazış ya da konuş.</p>'
        : alive ? '<p class="big">😴 Uyuyorsun</p><p class="soft">Gözlerini kapat, sabahı bekle.</p>' : '';
      else html = '<p class="big">🌙 Gece seçimin</p><p class="soft">Süre bitince seçimin uygulanır. İstediğin kadar değiştirebilirsin.</p>' + opts.map(o => {
        let extra = '';
        if (o.type === 'guess') {
          guessRole ||= o.chosen?.role || o.roles[0];
          extra = `<select id="guessRole">${o.roles.map(r => `<option value="${r}" ${r === guessRole ? 'selected' : ''}>${s.roles[r].icon} ${esc(s.roles[r].name)}</option>`).join('')}</select>`;
        }
        const passed = o.chosen && o.chosen.target === null;
        return `<div class="opt" data-type="${o.type}"><b>${esc(o.label)}</b>${extra}${targetButtons(o.targets, o.chosen?.target, ['kill', 'shot', 'guess'].includes(o.type))}
          <div class="btns"><button class="btn-ghost btn-sm btn-pass ${passed ? 'on' : ''}" data-pass="1">${passed ? '✔ ' : ''}BU GECE KULLANMA</button></div></div>`;
      }).join('');
      if (s.mafiaKill !== undefined && me?.team === 'mafia') html += `<div class="callout">🎯 Bu geceki hedef: <b>${s.mafiaKill ? esc(nameOf(s.mafiaKill)) : 'henüz seçilmedi'}</b></div>`;
      break;
    }
    case 'over':
      html = `<p class="winner-banner" style="color:${s.winner === 'city' ? 'var(--gold-2)' : '#FF4D5A'}">${s.winner === 'city' ? '🎉 Masumlar kazandı!' : '🩸 Mafya kazandı!'}</p>
        <p class="soft" style="text-align:center">Herkesin rolü masada görünüyor.</p>
        <button class="btn-play" id="restart">TEKRAR OYNA</button>`;
      break;
    default: html = `<p class="big">${esc(s.narrator)}</p>`;
  }
  if (s.canFedai) html += sacrificing
    ? `<div class="callout"><b>🧨 Kimi yanında götürüyorsun?</b><p class="soft">Sen ve seçtiğin kişi oyundan çıkarsınız, sonra hemen gece olur.</p>${targetButtons(s.players.filter(p => p.alive && p.id !== s.myId).map(p => p.id), null, true).replaceAll('data-t=', 'data-f=')}<div class="btns"><button class="btn-ghost btn-sm" id="noFedai">VAZGEÇ</button></div></div>`
    : '<div class="btns"><button class="btn-danger" id="fedai">🧨 KENDİNİ FEDA ET</button></div>';
  if (s.deadReveal) html += `<p class="soft" style="margin-top:10px">Dışarıda: <b class="c-city">${s.deadReveal.city} masum</b>, <b class="c-mafia">${s.deadReveal.mafia} mafya</b>.</p>`;
  $('action').innerHTML = deadNote + html;
  wireAction(s);
}

function wireAction(s) {
  const on = (id, fn) => { const b = $(id); if (b) b.onclick = fn; };
  on('copy', () => { navigator.clipboard?.writeText(`${location.origin}/?oda=${s.code}`); $('copy').textContent = 'KOPYALANDI ✔'; });
  on('endSpeech', () => socket.emit('endSpeech'));
  on('chYes', () => socket.emit('challengeAnswer', { accept: true }));
  on('chNo', () => socket.emit('challengeAnswer', { accept: false }));
  on('challenge', () => socket.emit('challengeRequest'));
  on('shoot', () => { shooting = true; renderAction(state); });
  on('noShoot', () => { shooting = false; renderAction(state); });
  on('pollYes', () => socket.emit('poll', { yes: true }));
  on('pollNo', () => socket.emit('poll', { yes: false }));
  on('restart', () => socket.emit('restart'));
  on('fedai', () => { sacrificing = true; renderAction(state); });
  on('noFedai', () => { sacrificing = false; renderAction(state); });
  $('action').querySelectorAll('[data-f]').forEach(b => b.onclick = () => {
    if (confirm(`Kendini feda edip ${nameOf(b.dataset.f)} oyuncusunu da götürmek istediğine emin misin?`)) { sacrificing = false; socket.emit('fedai', { target: b.dataset.f }); }
  });
  $('action').querySelectorAll('[data-r]').forEach(b => b.onclick = () => {
    if (confirm(`${nameOf(b.dataset.r)} oyuncusunu yanında götürmek istediğine emin misin?`)) socket.emit('revenge', { target: b.dataset.r });
  });
  const sel = $('guessRole');
  if (sel) sel.onchange = () => { guessRole = sel.value; };
  $('action').querySelectorAll('[data-t]').forEach(b => b.onclick = () => {
    const t = b.dataset.t;
    if (s.phase === 'vote' || s.phase === 'revote') {
      const mine = new Set(s.vote.mine);
      mine.has(t) ? mine.delete(t) : mine.add(t);
      socket.emit('vote', { targets: [...mine] });
    } else if (s.phase === 'night') {
      const type = b.closest('.opt').dataset.type;
      socket.emit('action', { type, target: t, role: type === 'guess' ? guessRole : undefined });
    } else if (shooting) {
      if (confirm(`${nameOf(t)} oyuncusunu vurmak istediğine emin misin?`)) { shooting = false; socket.emit('gun', { target: t }); }
    }
  });
  $('action').querySelectorAll('[data-pass]').forEach(b => b.onclick = () => socket.emit('action', { type: b.closest('.opt').dataset.type, target: null }));
}

function renderFeeds(s) {
  const feed = (el, items) => { el.innerHTML = items.map(t => `<div>${esc(t)}</div>`).join(''); el.scrollTop = el.scrollHeight; };
  feed($('historyFeed'), s.history);
  $('logPanel').classList.toggle('hidden', !s.logs.length);
  feed($('logFeed'), s.logs);
  $('mafiaPanel').classList.toggle('hidden', !s.mafiaChat);
  if (s.mafiaChat) {
    $('mafiaFeed').innerHTML = s.mafiaChat.map(m => `<div><b>${esc(m.name)}:</b> ${esc(m.text)}</div>`).join('') || '<div class="soft">Gece burada yazışabilirsiniz.</div>';
    $('mafiaFeed').scrollTop = $('mafiaFeed').scrollHeight;
    $('mafiaInput').disabled = s.phase !== 'night' || !s.me.alive;
    $('mafiaInput').placeholder = s.phase === 'night' ? 'Sadece mafya görür…' : 'Sadece gece yazılabilir';
  }
}
$('mafiaForm').onsubmit = e => {
  e.preventDefault();
  const text = $('mafiaInput').value.trim();
  if (text) socket.emit('mafiaChat', { text });
  $('mafiaInput').value = '';
};

// ---------- cinematic moments ----------
let cineTimer;
function cine(title, sub, tone = '') {
  const el = $('cine');
  $('cineTitle').textContent = title;
  $('cineSub').textContent = sub;
  el.className = 'cine ' + tone;
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(cineTimer);
  cineTimer = setTimeout(() => el.classList.remove('show'), 2700);
}
function cinematic(s) {
  if (s.phase === prevPhase) return;
  if (s.phase === 'roles') return revealRole(s);
  if (!prevPhase) return; // just (re)connected: no fanfare
  if (s.phase === 'night') { cine(`GECE ${s.night}`, s.night === 1 ? 'Mafya birbirini tanıyor' : 'Masumlar uyuyor'); SFX.play.night(); }
  else if (s.phase === 'morning') { cine('SABAH', 'Masumlar uyanıyor', 'gold'); SFX.play.morning(); }
  else if (s.phase === 'vote') { cine('OYLAMA', 'Kim oyundan çıksın?', 'red'); SFX.play.vote(); }
  else if (s.phase === 'speech' && prevPhase === 'roles') { cine('GÜN 1', 'Tanışma turu', 'gold'); SFX.play.morning(); }
  else if (s.phase === 'over') {
    cine(s.winner === 'city' ? 'MASUMLAR KAZANDI' : 'MAFYA KAZANDI', 'Oyun bitti', s.winner === 'city' ? 'gold' : 'red');
    s.me?.team === s.winner ? SFX.play.win() : SFX.play.lose();
  }
}
function revealRole(s) {
  const r = s.roles[s.me.role];
  $('revealFront').className = `face front t-${r.team}`;
  $('revealFront').innerHTML = `<div class="big-icon">${r.icon}</div><div class="team">${r.team === 'mafia' ? 'MAFYA' : 'MASUM'}</div><h2>${esc(r.name)}</h2><p>${esc(r.desc)}</p>`;
  $('flip').classList.remove('on');
  $('reveal').classList.remove('hidden');
  setTimeout(() => { $('flip').classList.add('on'); SFX.play.reveal(); }, 700);
}
$('revealOk').onclick = () => $('reveal').classList.add('hidden');

// ---------- timer ----------
function tick() {
  const ring = $('ring');
  if (!state || state.left == null || state.phase === 'over') { ring.classList.add('off'); return; }
  ring.classList.remove('off');
  const left = Math.max(0, state.left - (Date.now() - receivedAt));
  const sec = Math.ceil(left / 1000);
  $('timer').textContent = sec >= 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : sec;
  $('ringFg').style.strokeDashoffset = 169.6 * (1 - left / (state.total || 1));
  ring.classList.toggle('low', sec <= 10);
  if (sec <= 5 && sec > 0 && sec !== lastTick) SFX.play.tick();
  lastTick = sec;
  if (state.phase !== 'roles' && !$('reveal').classList.contains('hidden') && left === 0) $('reveal').classList.add('hidden');
}
let lastTick = null;
setInterval(tick, 250);

// Layout previews (?onizle=1) drive render() without a live table. Game rules are untouched.
if (new URLSearchParams(location.search).has('onizle')) {
  addEventListener('mafya-preview', e => {
    state = e.detail;
    receivedAt = Date.now();
    prevPhase = state.phase;
    $('splash')?.remove();
    render();
  });
}
