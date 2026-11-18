const socket = io();
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SAVE_KEY = 'mafya-session';

let state = null, prevPhase = null, receivedAt = 0, guessRole = null, shooting = false, sacrificing = false, roleHidden = false, openRooms = [], leftRoom = false;
const voice = new Voice(socket);

// ---------- art ----------
$('skyline').innerHTML = ART.skyline();
$('heroNarrator').innerHTML = ART.narratorCopy('H');
$('stageNarrator').innerHTML = ART.narratorCopy('S');
$('props').innerHTML = ART.props;

// ---------- intro, sound, parallax ----------
$('enter').onclick = () => {
  SFX.start();
  SFX.play.reveal();
  $('splash').classList.add('out');
  setTimeout(() => $('splash').remove(), 900);
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
$('name').value = localStorage.getItem('mafya-name') || '';
const params = new URLSearchParams(location.search);
if (params.get('oda')) $('code').value = params.get('oda').toUpperCase();

function myName() {
  const n = $('name').value.trim();
  if (!n) { $('homeError').textContent = 'Önce takma adını yaz 🙂'; $('name').focus(); return null; }
  localStorage.setItem('mafya-name', n);
  $('homeError').textContent = '';
  return n;
}
async function go(event, data) {
  const name = myName();
  if (!name) return;
  await voice.startMic(); // asks for mic permission inside the click
  socket.emit(event, { ...data, name });
}
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
}

// ---------- game room ----------
const PHASES = {
  lobby: ['Bekleme salonu', 'Masa doluyor'], starting: ['Hazırlan', 'Oyun başlıyor'], roles: ['Roller', 'Rolüne bak, kimseye söyleme'],
  speech: ['Gündüz', 'Konuşma turu'], defense: ['Savunma', 'Son sözler'], vote: ['Oylama', 'Kim çıksın?'], revote: ['Son oylama', 'Karar anı'],
  poll: ['Soru', 'Dışarıdakiler'], revenge: ['İntikam', 'Terörist son hamlesini yapıyor'], morning: ['Sabah', 'Şehir uyanıyor'], announce: ['Duyuru', ''], coin: ['Yazı tura', 'Şans karar verecek'],
  night: ['Gece', 'Şehir uyuyor'], over: ['Oyun bitti', ''],
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
  $('stage').classList.toggle('talking', ['morning', 'announce', 'coin', 'roles', 'starting', 'over'].includes(s.phase));
  renderSeats(s);
  renderRole(s);
  renderAction(s);
  renderFeeds(s);
  cinematic(s);
  voice.update(s);
  tick();
}

function renderSeats(s) {
  const stage = $('stage');
  stage.querySelectorAll('.seat').forEach(e => e.remove());
  const n = s.size;
  stage.dataset.size = n;
  const span = { 9: 280, 12: 296, 16: 310 }[n] || 300, big = n > 9 ? 2 : 0;
  s.players.forEach(p => {
    // seats run clockwise around the table, leaving the top free for the narrator
    const deg = -90 + (360 - span) / 2 + p.seat * span / (n - 1);
    const a = deg * Math.PI / 180;
    const el = document.createElement('div');
    const speaking = s.speaker?.id === p.id;
    el.className = 'seat' + (p.id === s.myId ? ' me' : '') + (!p.alive ? ' dead' : '') + (p.mate ? ' mate' : '') + (speaking ? ' speaking' : '');
    el.style.left = 50 + (42 + big) * Math.cos(a) + '%';
    el.style.top = 58 + (34 + big) * Math.sin(a) + '%';
    const role = p.role && s.roles[p.role];
    const votes = s.vote?.counts[p.id];
    const showRole = role && (s.phase === 'over' || p.id !== s.myId);
    el.innerHTML = `
      <div class="portrait"><div class="pic">${ART.portrait(p.id)}</div>
        ${p.alive && p.silenced ? '<span class="badge">🤐</span>' : p.alive && !p.connected ? '<span class="badge" title="Bağlantı koptu">📵</span>' : ''}
        ${votes ? `<span class="badge votes">${votes}</span>` : ''}
        ${speaking ? '<span class="eq"><i></i><i></i><i></i><i></i></span>' : ''}
      </div>
      <div class="plate">${esc(p.name)}</div>
      ${showRole ? `<div class="tag" style="color:var(--${role.team === 'mafia' ? 'mafia' : 'city'})">${role.icon} ${esc(role.name)}</div>`
        : p.mate && p.id !== s.myId ? '<div class="tag" style="color:var(--mafia)">🩸 Mafya</div>' : ''}`;
    stage.appendChild(el);
  });
}

function renderRole(s) {
  const card = $('roleCard');
  if (!s.me) return card.classList.add('hidden');
  const r = s.roles[s.me.role];
  card.className = `glass role-card deco t-${r.team}` + (roleHidden ? ' blur' : '');
  card.innerHTML = `
    <div class="body"><div class="head"><span class="icon">${r.icon}</span><div>
      <div class="team">${r.team === 'mafia' ? 'MAFYA' : 'ŞEHİR'}</div><div class="rname">${esc(r.name)}</div></div></div>
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
      html = '<p class="big">❓ Dışarıdakiler</p><p class="soft">Çıkanların kaçı şehir, kaçı mafya öğrenmek ister misin? (Kim olduğu söylenmez.)</p>';
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
      html = `<p class="winner-banner" style="color:${s.winner === 'city' ? 'var(--gold-2)' : '#FF4D5A'}">${s.winner === 'city' ? '🎉 Şehir kazandı!' : '🩸 Mafya kazandı!'}</p>
        <p class="soft" style="text-align:center">Herkesin rolü masada görünüyor.</p>
        <button class="btn-play" id="restart">TEKRAR OYNA</button>`;
      break;
    default: html = `<p class="big">${esc(s.narrator)}</p>`;
  }
  if (s.canFedai) html += sacrificing
    ? `<div class="callout"><b>🧨 Kimi yanında götürüyorsun?</b><p class="soft">Sen ve seçtiğin kişi oyundan çıkarsınız, sonra hemen gece olur.</p>${targetButtons(s.players.filter(p => p.alive && p.id !== s.myId).map(p => p.id), null, true).replaceAll('data-t=', 'data-f=')}<div class="btns"><button class="btn-ghost btn-sm" id="noFedai">VAZGEÇ</button></div></div>`
    : '<div class="btns"><button class="btn-danger" id="fedai">🧨 KENDİNİ FEDA ET</button></div>';
  if (s.deadReveal) html += `<p class="soft" style="margin-top:10px">Dışarıda: <b class="c-city">${s.deadReveal.city} şehir</b>, <b class="c-mafia">${s.deadReveal.mafia} mafya</b>.</p>`;
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
  if (s.phase === 'night') { cine(`GECE ${s.night}`, s.night === 1 ? 'Mafya birbirini tanıyor' : 'Şehir uyuyor'); SFX.play.night(); }
  else if (s.phase === 'morning') { cine('SABAH', 'Şehir uyanıyor', 'gold'); SFX.play.morning(); }
  else if (s.phase === 'vote') { cine('OYLAMA', 'Kim oyundan çıksın?', 'red'); SFX.play.vote(); }
  else if (s.phase === 'speech' && prevPhase === 'roles') { cine('GÜN 1', 'Tanışma turu', 'gold'); SFX.play.morning(); }
  else if (s.phase === 'over') {
    cine(s.winner === 'city' ? 'ŞEHİR KAZANDI' : 'MAFYA KAZANDI', 'Oyun bitti', s.winner === 'city' ? 'gold' : 'red');
    s.me?.team === s.winner ? SFX.play.win() : SFX.play.lose();
  }
}
function revealRole(s) {
  const r = s.roles[s.me.role];
  $('revealFront').className = `face front t-${r.team}`;
  $('revealFront').innerHTML = `<div class="big-icon">${r.icon}</div><div class="team">${r.team === 'mafia' ? 'MAFYA' : 'ŞEHİR'}</div><h2>${esc(r.name)}</h2><p>${esc(r.desc)}</p>`;
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
