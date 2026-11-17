const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { Server } = require('socket.io');
const G = require('./game');

const SCALE = Number(process.env.TIME_SCALE || 1); // tests run with a tiny scale
const SECS = { starting: 10, roles: 8, speech: 50, challenge: 30, defense: 50, firstNight: 20, night: 45, morning: 8, poll: 15, vote: 30, revote: 25, announce: 6, coin: 5, revenge: 20 };
const SIZES = Object.keys(G.SETUPS).map(Number);
const DAY_PHASES = ['speech', 'defense', 'vote', 'revote']; // when the Fedai may strike

const app = express();
app.use(express.static(__dirname + '/public'));
app.get('/roles.json', (req, res) => res.json(G.ROLES));
const server = http.createServer(app);
const io = new Server(server);

const rooms = new Map();
const newId = () => crypto.randomBytes(8).toString('hex');
const cleanName = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 16);

function newCode() {
  let c;
  do c = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPRSTUVYZ'[crypto.randomInt(21)]).join('');
  while (rooms.has(c));
  return c;
}

class Room {
  constructor(size) {
    this.code = newCode();
    this.size = size;
    this.players = []; // {id, token, name, socketId, connected, nonce}
    this.reset();
  }

  reset() {
    clearTimeout(this.timer);
    this.phase = 'lobby';
    this.g = null;
    this.history = [];
    this.logs = {};
    this.mafiaChat = [];
    this.winner = null;
    this.deadReveal = null;
    this.speaker = null;
    this.narrator = '';
  }

  // ---------- phase plumbing ----------
  set(phase, secs, next, narrator) {
    clearTimeout(this.timer);
    this.phase = phase;
    this.deadline = secs ? Date.now() + secs * 1000 * SCALE : null;
    this.duration = secs * 1000 * SCALE;
    if (narrator) { this.narrator = narrator; this.history.push(narrator); }
    if (secs) this.timer = setTimeout(() => { next(); }, secs * 1000 * SCALE);
    this.broadcast();
  }
  say(text) { this.narrator = text; this.history.push(text); }
  log(id, text) { (this.logs[id] ||= []).push(text); }
  name(id) { return G.byId(this.g, id)?.name || this.players.find(p => p.id === id)?.name; }

  // ---------- lobby ----------
  join(name) {
    if (this.phase !== 'lobby' || this.players.length >= this.size) return null;
    const p = { id: newId(), token: newId(), name, socketId: null, connected: true, nonce: 0 };
    this.players.push(p);
    if (this.players.length === this.size) this.set('starting', SECS.starting, () => this.start(), 'Masa doldu! Oyun 10 saniye içinde başlıyor.');
    return p;
  }

  leaveLobby(p) {
    this.players = this.players.filter(x => x !== p);
    if (this.phase === 'starting') { clearTimeout(this.timer); this.phase = 'lobby'; }
    this.broadcast();
  }

  start() {
    this.g = G.createGame(G.shuffle(this.players));
    this.set('roles', SECS.roles, () => this.startSpeeches(true), 'Rolüne bak ve kimseye söyleme! 🤫');
  }

  // ---------- day: speeches ----------
  startSpeeches(intro) {
    this.intro = intro;
    this.spoken = new Set();
    this.challengeUsed = new Set();
    this.queue = G.alive(this.g).filter(p => !p.silenced).map(p => ({ id: p.id, kind: 'speech', secs: SECS.speech }));
    const silenced = G.alive(this.g).filter(p => p.silenced);
    if (silenced.length) this.say(`${silenced.map(p => p.name).join(', ')} bugün susturuldu 🤐`);
    this.nextSpeaker();
  }

  nextSpeaker() {
    const turn = this.queue.shift();
    if (!turn) return this.queueDone();
    this.speaker = turn;
    this.challenge = null;
    const n = this.name(turn.id);
    const text = turn.kind === 'defense' ? `${n} kendini savunuyor.`
      : turn.kind === 'challenge' ? `${n} ek süre kullanıyor (30 sn).`
      : this.intro ? `Tanışma turu: ${n} konuşuyor.` : `${n} konuşuyor.`;
    this.set(turn.kind === 'defense' ? 'defense' : 'speech', turn.secs, () => this.endTurn(), text);
  }

  endTurn() {
    const t = this.speaker;
    this.speaker = null;
    if (t.kind === 'speech') this.spoken.add(t.id);
    if (this.challenge?.status === 'accepted') this.queue.unshift({ id: this.challenge.from, kind: 'challenge', secs: SECS.challenge });
    this.nextSpeaker();
  }

  queueDone() {
    if (this.phase === 'defense') return this.startRevote();
    return this.intro ? this.startNight() : this.startVote();
  }

  // ---------- day: voting ----------
  startVote() {
    this.votes = {};
    this.candidates = G.alive(this.g).map(p => p.id);
    this.set('vote', SECS.vote, () => this.endVote(false), `Oylama! Oyundan çıkmasını istediğin kişilere oy ver. Gereken oy: ${G.needed(this.candidates.length)}`);
  }

  endVote(final) {
    const { reached } = G.tally(this.g, this.votes, this.candidates);
    if (!reached.length) return this.announce('Kimse yeterli oy almadı. Kimse çıkmıyor.', () => this.startNight());
    if (!final) {
      this.candidates = reached;
      this.queue = reached.map(id => ({ id, kind: 'defense', secs: SECS.defense }));
      this.phase = 'defense';
      return this.nextSpeaker();
    }
    if (reached.length === 1) return this.eliminate(reached[0]);
    const loser = reached[crypto.randomInt(reached.length)];
    this.set('coin', SECS.coin, () => this.eliminate(loser), `Oylar eşit (${reached.map(id => this.name(id)).join(', ')})! Yazı tura atılıyor… 🪙`);
  }

  startRevote() {
    this.votes = {};
    this.set('revote', SECS.revote, () => this.endVote(true), `Son oylama: ${this.candidates.map(id => this.name(id)).join(', ')}. Gereken oy: ${G.needed(G.alive(this.g).length)}`);
  }

  eliminate(id) {
    const p = G.byId(this.g, id);
    p.alive = false;
    this.g.deadSeen = true;
    if (p.role !== 'terorist') return this.announce(`${p.name} oylamayla oyundan çıktı.`, () => this.startNight());
    this.revengeBy = id;
    this.set('revenge', SECS.revenge, () => this.announce(`💣 ${p.name} kimseyi yanında götürmedi.`, () => this.startNight()),
      `${p.name} oylamayla çıktı… ama o bir TERÖRİST! 💣 Yanında birini götürecek.`);
  }

  announce(text, next) {
    this.set('announce', SECS.announce, () => {
      const w = G.winner(this.g, false);
      w ? this.end(w) : next();
    }, text);
  }

  // ---------- night ----------
  startNight() {
    const w = G.winner(this.g, true);
    if (w) return this.end(w);
    this.g.night++;
    this.actions = {};
    this.chosen = {};
    const first = this.g.night === 1;
    this.set('night', first ? SECS.firstNight : SECS.night, () => this.endNight(),
      first ? 'Şehir uyuyor… Mafya gözlerini açsın ve birbirini tanısın.' : 'Gece oldu. Şehir uyuyor… Yeteneği olanlar seçimini yapsın.');
  }

  endNight() {
    this.g.day = (this.g.day || 1) + 1;
    if (this.g.night === 1) return this.set('morning', SECS.morning, () => this.afterMorning(), 'Günaydın! Gün başlıyor.');
    const r = G.resolveNight(this.g, this.actions);
    r.privateMsgs.forEach(m => this.log(m.to, m.text));
    let text = r.died.length ? `Günaydın! Bu gece ${r.deadNames.join(', ')} oyundan çıktı.` : 'Günaydın! Bu gece kimse ölmedi.';
    if (r.revived) text += r.revived.mafia ? ` Büyücü bir MAFYAYI geri getirdi: ${this.name(r.revived.id)}!` : ` Büyücü ${this.name(r.revived.id)} oyuncusunu geri getirdi.`;
    this.set('morning', SECS.morning, () => this.afterMorning(), text);
  }

  afterMorning() {
    const w = G.winner(this.g, false);
    if (w) return this.end(w);
    if (!this.g.players.some(p => !p.alive)) return this.startSpeeches(false);
    this.poll = {};
    this.set('poll', SECS.poll, () => {
      const yes = Object.entries(this.poll).filter(([id, v]) => v && G.byId(this.g, id).alive).length;
      if (yes > G.alive(this.g).length / 2) {
        const c = G.deadCounts(this.g);
        this.deadReveal = c;
        this.say(`Dışarıda: ${c.city} şehir, ${c.mafia} mafya.`);
      } else this.say('Çoğunluk istemedi, dışarıdakiler gizli kaldı.');
      this.startSpeeches(false);
    }, 'Dışarıdakilerin kaç tanesinin şehir, kaç tanesinin mafya olduğunu öğrenmek ister misiniz?');
  }

  end(w) {
    this.winner = w;
    this.set('over', 0, null, w === 'city' ? 'Şehir kazandı! 🎉 Tüm mafya yakalandı.' : 'Mafya kazandı! 🩸 Şehir düştü.');
  }

  // ---------- player commands ----------
  handle(p, type, data = {}) {
    const g = this.g;
    const me = g && G.byId(g, p.id);
    const isSpeaker = this.speaker?.id === p.id && (this.phase === 'speech' || this.phase === 'defense');
    switch (type) {
      case 'endSpeech':
        if (isSpeaker) this.endTurn();
        return;
      case 'challengeRequest':
        if (this.phase === 'speech' && !this.intro && this.speaker.kind === 'speech' && me?.alive && !this.challenge
          && p.id !== this.speaker.id && this.spoken.has(p.id) && !this.challengeUsed.has(p.id)) {
          this.challenge = { from: p.id, status: 'pending' };
          break;
        }
        return;
      case 'challengeAnswer':
        if (isSpeaker && this.challenge?.status === 'pending') {
          this.challenge.status = data.accept ? 'accepted' : 'declined';
          if (data.accept) this.challengeUsed.add(this.challenge.from);
          break;
        }
        return;
      case 'gun': {
        if (!isSpeaker || this.speaker.kind !== 'speech') return;
        const r = G.useGun(g, p.id, data.target);
        if (!r) return;
        this.speaker = null;
        return this.announce(r.mafia ? `💥 ${me.name}, ${r.name} oyuncusunu vurdu: MAFYA çıktı! Oyundan çıktı. Gece oluyor.`
          : `💥 ${me.name}, ${r.name} oyuncusunu vurdu: İYİ çıktı. Kimse çıkmıyor. Gece oluyor.`, () => this.startNight());
      }
      case 'fedai': {
        if (!DAY_PHASES.includes(this.phase)) return;
        const target = G.fedaiStrike(g, p.id, data.target);
        if (!target) return;
        this.speaker = null;
        return this.announce(`🧨 ${me.name} kendini feda etti ve ${target} oyuncusunu da yanında götürdü! Gece oluyor.`, () => this.startNight());
      }
      case 'revenge': {
        if (this.phase !== 'revenge' || this.revengeBy !== p.id) return;
        const target = G.terroristRevenge(g, p.id, data.target);
        if (!target) return;
        return this.announce(`💣 ${me.name}, ${target} oyuncusunu da yanında götürdü!`, () => this.startNight());
      }
      case 'vote':
        if ((this.phase === 'vote' || this.phase === 'revote') && me?.alive && Array.isArray(data.targets)) {
          this.votes[p.id] = data.targets.filter(t => this.candidates.includes(t) && t !== p.id);
          break;
        }
        return;
      case 'poll':
        if (this.phase === 'poll' && me?.alive) { this.poll[p.id] = !!data.yes; break; }
        return;
      case 'action': {
        if (this.phase !== 'night') return;
        const a = G.validAction(g, p.id, data.type, data.target ?? null, data.role);
        if (!a) return;
        this.actions[data.type] = data.type === 'guess' ? (a.target ? a : null) : a.target;
        (this.chosen[p.id] ||= {})[data.type] = a;
        break;
      }
      case 'mafiaChat': {
        const text = String(data.text || '').trim().slice(0, 200);
        if (this.phase === 'night' && me?.alive && me.team === 'mafia' && text) { this.mafiaChat.push({ name: me.name, text }); break; }
        return;
      }
      case 'restart':
        if (this.phase === 'over') {
          this.players = this.players.filter(x => x.connected);
          this.reset();
          if (this.players.length === this.size) this.set('starting', SECS.starting, () => this.start(), 'Yeni oyun 10 saniye içinde başlıyor.');
          break;
        }
        return;
      default: return;
    }
    this.broadcast();
  }

  // ---------- what each player may see ----------
  audioFor(id) {
    const ph = this.phase, g = this.g;
    const everyone = this.players.map(p => p.id);
    const sendTo = from => {
      if (['lobby', 'starting', 'over'].includes(ph)) return everyone.filter(x => x !== from);
      if ((ph === 'speech' || ph === 'defense') && this.speaker?.id === from) return everyone.filter(x => x !== from);
      if (ph === 'night') {
        const f = G.byId(g, from);
        if (f?.alive && f.team === 'mafia') return G.alive(g).filter(p => p.team === 'mafia' && p.id !== from).map(p => p.id);
      }
      return [];
    };
    return { sendTo: sendTo(id), hear: everyone.filter(x => x !== id && sendTo(x).includes(id)) };
  }

  view(p) {
    const g = this.g;
    const me = g && G.byId(g, p.id);
    const over = this.phase === 'over';
    const mafiaEyes = me && me.team === 'mafia' && g.night >= 1;
    const v = {
      code: this.code, size: this.size, phase: this.phase, myId: p.id,
      left: this.deadline ? Math.max(0, this.deadline - Date.now()) : null,
      total: this.duration,
      narrator: this.narrator, history: this.history.slice(-30), logs: this.logs[p.id] || [],
      players: (g ? g.players : this.players).map((x, i) => {
        const conn = this.players.find(y => y.id === x.id);
        return {
          id: x.id, name: x.name, seat: g ? x.seat : i, alive: g ? x.alive : true,
          connected: conn?.connected, nonce: conn?.nonce || 0,
          silenced: !!(g && x.silenced && x.alive),
          mate: !!(mafiaEyes && x.team === 'mafia'),
          role: g && (over || x.id === p.id) ? x.role : null,
        };
      }),
      audio: this.audioFor(p.id),
      winner: this.winner,
      deadReveal: this.deadReveal,
      roles: G.ROLES,
    };
    if (!g) return v;
    v.me = { role: me.role, team: me.team, alive: me.alive, hasGun: me.hasGun && !g.gunUsed };
    v.day = g.day || 1;
    v.night = g.night;
    if (this.speaker) {
      v.speaker = { id: this.speaker.id, kind: this.speaker.kind };
      v.challenge = this.challenge && { from: this.challenge.from, status: this.challenge.status };
      v.canChallenge = this.phase === 'speech' && !this.intro && this.speaker.kind === 'speech' && me.alive && !this.challenge
        && p.id !== this.speaker.id && this.spoken.has(p.id) && !this.challengeUsed.has(p.id);
      v.canShoot = v.me.hasGun && this.speaker.id === p.id && this.speaker.kind === 'speech';
    }
    if (this.phase === 'vote' || this.phase === 'revote') {
      const t = G.tally(g, this.votes, this.candidates);
      v.vote = { candidates: this.candidates, counts: t.count, need: t.need, mine: this.votes[p.id] || [] };
    }
    if (this.phase === 'poll') v.poll = { mine: this.poll[p.id] };
    v.canFedai = me.alive && me.role === 'fedai' && !g.fedaiUsed && DAY_PHASES.includes(this.phase);
    if (this.phase === 'revenge' && this.revengeBy === p.id) v.revengeTargets = G.alive(g).map(x => x.id);
    if (this.phase === 'night') {
      v.options = G.nightOptions(g, p.id).map(o => ({ ...o, chosen: this.chosen[p.id]?.[o.type] || null }));
      if (mafiaEyes) v.mafiaKill = this.actions.kill || null;
    }
    if (mafiaEyes) v.mafiaChat = this.mafiaChat.slice(-50);
    return v;
  }

  broadcast() {
    for (const p of this.players) if (p.socketId) io.to(p.socketId).emit('state', this.view(p));
    sendRooms();
  }
}

function roomList() {
  return {
    online: io.engine.clientsCount,
    rooms: [...rooms.values()].filter(r => r.phase === 'lobby').map(r => ({ code: r.code, size: r.size, count: r.players.length })),
  };
}
let roomsTimer = null;
function sendRooms() { // batched: many state changes per second shouldn't spam everyone
  if (roomsTimer) return;
  roomsTimer = setTimeout(() => { roomsTimer = null; io.emit('rooms', roomList()); }, 200);
}

io.on('connection', socket => {
  let room = null, player = null;

  const attach = (r, p) => {
    room = r; player = p;
    p.socketId = socket.id; p.connected = true; p.nonce++;
    socket.emit('joined', { code: r.code, token: p.token });
    r.broadcast();
  };

  sendRooms();

  socket.on('create', ({ name, size } = {}) => {
    name = cleanName(name);
    if (room || !name || !SIZES.includes(size)) return socket.emit('err', 'Geçersiz istek.');
    const r = new Room(size);
    rooms.set(r.code, r);
    attach(r, r.join(name));
  });

  socket.on('join', ({ name, code } = {}) => {
    name = cleanName(name);
    const r = rooms.get(String(code || '').toUpperCase());
    if (room || !name) return socket.emit('err', 'Önce bir isim yaz.');
    if (!r) return socket.emit('err', 'Bu kodla bir oda yok.');
    if (r.players.some(p => p.name.toLowerCase() === name.toLowerCase())) return socket.emit('err', 'Bu isim odada zaten var, başka bir isim seç.');
    const p = r.join(name);
    if (!p) return socket.emit('err', 'Bu oda dolu ya da oyun başladı.');
    attach(r, p);
  });

  socket.on('resume', ({ code, token } = {}) => {
    const r = rooms.get(code);
    const p = r?.players.find(x => x.token === token);
    if (room || !p) return socket.emit('resumeFailed');
    if (p.socketId && p.socketId !== socket.id) io.sockets.sockets.get(p.socketId)?.disconnect();
    attach(r, p);
  });

  socket.on('leave', () => {
    if (!room) return;
    if (room.phase === 'lobby' || room.phase === 'starting') room.leaveLobby(player);
    else { player.connected = false; player.socketId = null; room.broadcast(); }
    cleanup(room);
    room = player = null;
  });

  socket.on('rtc', ({ to, data } = {}) => {
    const target = room?.players.find(p => p.id === to);
    if (target?.socketId) io.to(target.socketId).emit('rtc', { from: player.id, data });
  });

  for (const ev of ['endSpeech', 'challengeRequest', 'challengeAnswer', 'gun', 'fedai', 'revenge', 'vote', 'poll', 'action', 'mafiaChat', 'restart']) {
    socket.on(ev, data => { if (room && player) room.handle(player, ev, data); });
  }

  socket.on('disconnect', () => {
    sendRooms(); // online count changed
    if (!room || player.socketId !== socket.id) return;
    if (room.phase === 'lobby' || room.phase === 'starting') room.leaveLobby(player);
    else { player.connected = false; player.socketId = null; room.broadcast(); }
    cleanup(room);
  });
});

// Drop a room a minute after its last player left.
function cleanup(r) {
  if (r.players.some(p => p.connected)) return;
  setTimeout(() => {
    if (!r.players.some(p => p.connected)) { clearTimeout(r.timer); rooms.delete(r.code); sendRooms(); }
  }, 60000 * SCALE);
}

const PORT = process.env.PORT || 3000;
if (require.main === module) server.listen(PORT, () => console.log(`Mafya: http://localhost:${PORT}`));
module.exports = { server, rooms, SECS };
