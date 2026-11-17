const socket = io();
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SAVE_KEY = 'mafya-session';

let state = null, receivedAt = 0, guessRole = null, shooting = false;
const voice = new Voice(socket);

// ---------- home ----------
$('name').value = localStorage.getItem('mafya-name') || '';
const params = new URLSearchParams(location.search);
if (params.get('oda')) $('code').value = params.get('oda').toUpperCase();

function myName() {
  const n = $('name').value.trim();
  if (!n) { $('homeError').textContent = 'Önce adını yaz 🙂'; $('name').focus(); return null; }
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
document.querySelectorAll('.size.go').forEach(b => b.onclick = () => go('create', { size: Number(b.dataset.size) }));
$('joinCode').onclick = () => go('join', { code: $('code').value.trim().toUpperCase() });
$('roomList').onclick = e => { const c = e.target.dataset.join; if (c) go('join', { code: c }); };

socket.on('rooms', list => {
  $('roomList').innerHTML = list.length
    ? list.map(r => `<div class="room-item"><span><b>Oda ${esc(r.code)}</b> <span class="soft">· ${r.count}/${r.size} kişi</span></span><button class="btn-main btn-sm" data-join="${esc(r.code)}">Katıl</button></div>`).join('')
    : '<p class="soft">Şu an açık oda yok. Hemen bir tane kur!</p>';
});
socket.on('err', msg => { $('homeError').textContent = msg; });
socket.on('joined', ({ code, token }) => {
  localStorage.setItem(SAVE_KEY, JSON.stringify({ code, token }));
  voice.startMic(); // no-op if already on; needed after a page reload
  history.replaceState(null, '', '?oda=' + code);
});
socket.on('connect', () => {
  const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
  if (saved) socket.emit('resume', saved);
});
socket.on('resumeFailed', () => { localStorage.removeItem(SAVE_KEY); showHome(); });
socket.on('state', s => { state = s; receivedAt = Date.now(); render(); });

$('leave').onclick = () => {
  if (state?.phase !== 'lobby' && state?.phase !== 'over' && !confirm('Oyundan çıkmak istediğine emin misin?')) return;
  socket.emit('leave');
  localStorage.removeItem(SAVE_KEY);
  history.replaceState(null, '', location.pathname);
  state = null;
  voice.closeAll();
  showHome();
};
function showHome() { $('home').classList.remove('hidden'); $('room').classList.add('hidden'); document.documentElement.dataset.phase = 'night'; }

// role list in "Nasıl oynanır?"
fetch('/roles.json').then(r => r.json()).then(fetchRoles);
function fetchRoles(roles) {
  if (!roles || $('roleGrid').children.length) return;
  $('roleGrid').innerHTML = Object.values(roles).map(r => `<div class="role-mini t-${r.team}"><b>${r.icon} ${esc(r.name)}</b>${esc(r.desc)}</div>`).join('');
}

// ---------- room ----------
const PHASES = {
  lobby: '🪑 Bekleme odası', starting: '⏳ Başlıyor', roles: '🎭 Roller', speech: '☀️ Gündüz', defense: '🛡️ Savunma',
  vote: '🗳️ Oylama', revote: '🗳️ Son oylama', poll: '❓ Soru', morning: '🌅 Sabah', announce: '📢 Duyuru',
  coin: '🪙 Yazı tura', night: '🌙 Gece', over: '🏁 Oyun bitti',
};
const DARK = ['lobby', 'starting', 'roles', 'night', 'over'];
const COLORS = ['#7B5EA7', '#C2185B', '#00897B', '#5D7FDB', '#E67E22', '#6D8B3A', '#AD5A4A', '#3F8FA6', '#8E6C3A', '#B0478F', '#4A6B8A', '#9C6B30'];
const colorOf = id => COLORS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
const nameOf = id => state.players.find(p => p.id === id)?.name || '?';

function render() {
  const s = state;
  $('home').classList.add('hidden');
  $('room').classList.remove('hidden');
  document.documentElement.dataset.phase = DARK.includes(s.phase) ? 'night' : 'day';
  fetchRoles(s.roles);
  $('roomCode').textContent = s.code;
  $('phaseLabel').textContent = s.phase === 'night' ? `🌙 Gece ${s.night}` : s.phase === 'speech' ? `☀️ Gün ${s.day}` : PHASES[s.phase];
  $('narrator').textContent = s.narrator || (s.phase === 'lobby' ? `Oyuncular bekleniyor… (${s.players.length}/${s.size})` : '');
  renderSeats(s);
  renderRole(s);
  renderAction(s);
  renderFeeds(s);
  voice.update(s);
  tick();
}

function renderSeats(s) {
  const wrap = $('tableWrap');
  wrap.querySelectorAll('.seat').forEach(e => e.remove());
  const n = Math.max(s.players.length, s.size);
  s.players.forEach(p => {
    const angle = (-90 + p.seat * 360 / n) * Math.PI / 180;
    const el = document.createElement('div');
    const speaking = s.speaker?.id === p.id;
    el.className = 'seat' + (p.id === s.myId ? ' me' : '') + (!p.alive ? ' dead' : '') + (p.mate ? ' mate' : '') + (speaking ? ' speaking' : '');
    el.style.left = 50 + 41 * Math.cos(angle) + '%';
    el.style.top = 50 + 41 * Math.sin(angle) + '%';
    const role = p.role && s.roles[p.role];
    const votes = s.vote?.counts[p.id];
    el.innerHTML = `
      <div class="avatar" style="background:${colorOf(p.id)}">${esc(p.name[0].toUpperCase())}
        ${!p.alive ? '<span class="badge">💀</span>' : p.silenced ? '<span class="badge">🤐</span>' : !p.connected ? '<span class="badge">📵</span>' : ''}
        ${votes ? `<span class="badge votes">${votes}</span>` : ''}
        ${speaking ? '<span class="badge talk">🎤</span>' : ''}
      </div>
      <div class="nm">${esc(p.name)}</div>
      ${role && (s.phase === 'over' || p.id !== s.myId) ? `<div class="tag" style="color:var(--${role.team === 'mafia' ? 'mafia' : 'city'})">${role.icon} ${esc(role.name)}</div>`
        : p.mate && p.id !== s.myId ? '<div class="tag" style="color:var(--mafia)">Mafya</div>' : ''}`;
    wrap.appendChild(el);
  });
}

let roleHidden = false;
function renderRole(s) {
  const card = $('roleCard');
  if (!s.me) return card.classList.add('hidden');
  const r = s.roles[s.me.role];
  card.className = `panel role-card t-${r.team}` + (roleHidden ? ' blur' : '');
  card.innerHTML = `
    <div class="body"><div class="head"><span class="icon">${r.icon}</span><div>
      <div class="team">${r.team === 'mafia' ? 'Mafya' : 'Şehir'}</div><h3>${esc(r.name)}</h3></div></div>
      <p>${esc(r.desc)}</p>${s.me.hasGun ? '<p><b>🔫 Elinde bir silah var!</b></p>' : ''}</div>
    <div class="btns"><button class="btn-ghost btn-sm" id="toggleRole">${roleHidden ? '👁️ Rolümü göster' : '🙈 Rolümü gizle'}</button></div>`;
  $('toggleRole').onclick = () => { roleHidden = !roleHidden; renderRole(state); };
}

function targetButtons(ids, chosen, cb, red) {
  return `<div class="targets">${ids.map(id => `<button class="${chosen?.includes?.(id) || chosen === id ? 'on' + (red ? ' red' : '') : ''}" data-t="${esc(id)}">${esc(nameOf(id))}</button>`).join('')}</div>`;
}

function renderAction(s) {
  const el = $('action');
  const me = s.me, alive = me?.alive;
  let html = '';
  const deadNote = me && !alive && s.phase !== 'over' ? '<p class="soft">💀 Oyundan çıktın. İzlemeye devam edebilirsin; konuşamaz ve oy veremezsin.</p>' : '';

  switch (s.phase) {
    case 'lobby': {
      const link = `${location.origin}/?oda=${s.code}`;
      html = `<h3>Masa doluyor: ${s.players.length}/${s.size}</h3>
        <p class="soft">${s.size} kişi olunca oyun kendiliğinden başlar. Arkadaşlarını çağır:</p>
        <div class="row"><input readonly value="${esc(link)}"><button class="btn-main btn-sm" id="copy">Kopyala</button></div>
        <p class="soft">Bekleme odasında herkes birbirini duyar 🎤</p>`;
      break;
    }
    case 'starting': html = '<h3>Masa doldu! 🎉</h3><p class="soft">Oyun birazdan başlıyor. Rolünü kimseye gösterme.</p>'; break;
    case 'roles': html = '<h3>Rolüne bak 👆</h3><p class="soft">Yukarıdaki kartta rolün ve ne yapacağın yazıyor. Kimseye söyleme!</p>'; break;
    case 'speech': case 'defense': {
      const sp = s.speaker;
      if (sp.id === s.myId) {
        html = `<p class="big">🎤 Sıra sende! Konuş, herkes seni duyuyor.</p>`;
        if (s.challenge?.status === 'pending') html += `<div class="panel" style="margin-top:10px"><b>${esc(nameOf(s.challenge.from))}</b> senden sonra 30 saniye ek konuşma istiyor.<div class="btns"><button class="btn-ok btn-sm" id="chYes">Kabul et</button><button class="btn-ghost btn-sm" id="chNo">Reddet</button></div></div>`;
        if (s.canShoot) html += shooting
          ? `<div class="opt"><b>🔫 Kimi vuruyorsun?</b> <span class="soft">Mafyaysa çıkar; iyiyse kimse çıkmaz. İki durumda da hemen gece olur.</span>${targetButtons(s.players.filter(p => p.alive && p.id !== s.myId).map(p => p.id), null)}<div class="btns"><button class="btn-ghost btn-sm" id="noShoot">Vazgeç</button></div></div>`
          : '<div class="btns"><button class="btn-danger" id="shoot">🔫 Silahı kullan</button></div>';
        html += '<div class="btns"><button class="btn-main" id="endSpeech">Konuşmamı bitir ✔</button></div>';
      } else {
        html = `<p class="big">${esc(nameOf(sp.id))} ${sp.kind === 'defense' ? 'kendini savunuyor' : 'konuşuyor'} 🎤</p><p class="soft">Dinle. Sıran gelince sen de konuşacaksın.</p>`;
        if (s.challenge) html += `<p class="soft">${esc(nameOf(s.challenge.from))} 30 sn ek süre istedi: ${{ pending: 'cevap bekleniyor…', accepted: 'kabul edildi ✔', declined: 'reddedildi ✖' }[s.challenge.status]}</p>`;
        if (s.canChallenge) html += `<div class="btns"><button class="btn-ghost" id="challenge">⏱ 30 sn ek süre iste</button></div><p class="soft">${esc(nameOf(sp.id))} kabul ederse, onun konuşması bitince 30 saniye daha konuşursun. Günde bir kez.</p>`;
      }
      break;
    }
    case 'vote': case 'revote': {
      const v = s.vote;
      html = `<h3>🗳️ ${s.phase === 'revote' ? 'Son oylama' : 'Oylama'}</h3><p class="soft">Çıkmasını istediğin kişilere dokun (birden fazla seçebilirsin). Gereken oy: <b>${v.need}</b></p>`;
      if (alive) html += targetButtons(v.candidates.filter(id => id !== s.myId), v.mine, null, true);
      html += `<div class="feed" style="margin-top:10px">${v.candidates.map(id => `<div>${esc(nameOf(id))}: <b>${v.counts[id]}</b> / ${v.need}</div>`).join('')}</div>`;
      break;
    }
    case 'poll':
      html = '<h3>❓ Dışarıdakiler</h3><p class="soft">Çıkanların kaçı şehir, kaçı mafya öğrenmek ister misin? (Kim olduğu söylenmez.)</p>';
      if (alive) html += `<div class="btns"><button class="${s.poll.mine === true ? 'btn-main' : 'btn-ghost'}" id="pollYes">Evet</button><button class="${s.poll.mine === false ? 'btn-main' : 'btn-ghost'}" id="pollNo">Hayır</button></div>`;
      break;
    case 'night': {
      const opts = s.options || [];
      if (!opts.length) html = me?.team === 'mafia' && alive
        ? `<h3>🩸 Mafya uyandı</h3><p class="soft">Mafya arkadaşların masada kırmızı çerçeveli. Aşağıdan onlarla yazış ya da konuş.</p>`
        : alive ? '<h3>😴 Uyuyorsun</h3><p class="soft">Gözlerini kapat, sabahı bekle.</p>' : '';
      else html = '<h3>🌙 Gece seçimin</h3><p class="soft">Süre bitince seçimin uygulanır. Seçimini değiştirebilirsin.</p>' + opts.map(o => {
        const chosen = o.chosen?.target;
        let extra = '';
        if (o.type === 'guess') {
          guessRole ||= o.chosen?.role || o.roles[0];
          extra = `<select id="guessRole">${o.roles.map(r => `<option value="${r}" ${r === guessRole ? 'selected' : ''}>${s.roles[r].icon} ${esc(s.roles[r].name)}</option>`).join('')}</select>`;
        }
        return `<div class="opt" data-type="${o.type}"><b>${esc(o.label)}</b>${extra}${targetButtons(o.targets, chosen, null, ['kill', 'shot', 'guess'].includes(o.type))}
          <div class="btns"><button class="btn-ghost btn-sm ${o.chosen && o.chosen.target === null ? 'on' : ''}" data-pass="1">${o.chosen && o.chosen.target === null ? '✔ ' : ''}Bu gece kullanma</button></div></div>`;
      }).join('');
      if (s.mafiaKill !== undefined && me?.team === 'mafia') html += `<p style="margin-top:12px">🎯 Bu geceki hedef: <b>${s.mafiaKill ? esc(nameOf(s.mafiaKill)) : 'henüz seçilmedi'}</b></p>`;
      break;
    }
    case 'over':
      html = `<p class="winner-banner"><b>${s.winner === 'city' ? '🎉 Şehir kazandı!' : '🩸 Mafya kazandı!'}</b></p>
        <p class="soft">Herkesin rolü masada görünüyor.</p>
        <div class="btns"><button class="btn-main" id="restart">Tekrar oyna</button></div>`;
      break;
    default: html = `<p class="big">${esc(s.narrator)}</p>`;
  }
  if (s.deadReveal) html += `<p class="soft">Dışarıda: ${s.deadReveal.city} şehir, ${s.deadReveal.mafia} mafya.</p>`;
  el.innerHTML = deadNote + html;
  wireAction(s);
}

function wireAction(s) {
  const on = (id, fn) => { const b = $(id); if (b) b.onclick = fn; };
  on('copy', () => navigator.clipboard?.writeText(`${location.origin}/?oda=${s.code}`));
  on('endSpeech', () => socket.emit('endSpeech'));
  on('chYes', () => socket.emit('challengeAnswer', { accept: true }));
  on('chNo', () => socket.emit('challengeAnswer', { accept: false }));
  on('challenge', () => socket.emit('challengeRequest'));
  on('shoot', () => { shooting = true; renderAction(state); });
  on('noShoot', () => { shooting = false; renderAction(state); });
  on('pollYes', () => socket.emit('poll', { yes: true }));
  on('pollNo', () => socket.emit('poll', { yes: false }));
  on('restart', () => socket.emit('restart'));
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

function tick() {
  const el = $('timer');
  if (!state || state.left == null) return el.textContent = '';
  const left = Math.max(0, state.left - (Date.now() - receivedAt));
  const sec = Math.ceil(left / 1000);
  el.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  el.classList.toggle('low', sec <= 10);
}
setInterval(tick, 250);
