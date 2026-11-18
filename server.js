const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');
const G = require('./game');

const SCALE = Number(process.env.TIME_SCALE || 1); // tests run with a tiny scale
const SECS = { starting: 10, roles: 8, speech: 50, challenge: 30, defense: 50, firstNight: 20, night: 45, morning: 8, poll: 15, vote: 30, revote: 25, announce: 6, coin: 5, revenge: 20 };
const SIZES = Object.keys(G.SETUPS).map(Number);
const DAY_PHASES = ['speech', 'defense', 'vote', 'revote']; // when the Fedai may strike

// Abuse limits. Windows are milliseconds. Rates are per socket and per client IP.
const LIMITS = {
  maxHttpBufferSize: 16 * 1024,
  connectionsPerIp: 48,
  roomsPerIdentity: 3,
  mafiaChatHistory: 100,
  chatMaxLen: 200,
  nameMaxRaw: 64,
  characterIdMax: 32,
  emptyRoomMs: 60_000,
  idleLobbyMs: 2 * 60 * 60 * 1000,
  rates: {
    create: { perSocket: [8, 60_000], perIp: [30, 60_000] },
    join: { perSocket: [10, 30_000], perIp: [250, 30_000] },
    resume: { perSocket: [10, 30_000], perIp: [60, 30_000] },
    mafiaChat: { perSocket: [8, 10_000], perIp: [24, 10_000] },
    rtc: { perSocket: [300, 10_000], perIp: [6000, 10_000] },
  },
};

const MSG = {
  bad: 'Geçersiz istek.',
  rate: 'Çok hızlı deniyorsun. Biraz bekleyip tekrar dene.',
  rooms: 'Aynı anda en fazla 3 masada olabilirsin. Önce birinden çık.',
  conn: 'Bu ağdan çok fazla bağlantı var. Bazı sekmeleri kapatıp tekrar dene.',
  chat: 'Mesajın çok uzun. En fazla 200 karakter yazabilirsin.',
  name: 'Önce bir isim yaz.',
  character: 'Bir karakter seç.',
  characterUnknown: 'Bu karakter yok. Listeden birini seç.',
  noRoom: 'Bu kodla bir oda yok.',
  taken: 'Bu isim odada zaten var, başka bir isim seç.',
  full: 'Bu oda dolu ya da oyun başladı.',
  inRoom: 'Zaten bir masadasın.',
  closed: 'Masa uzun süre boş kaldığı için kapandı.',
  oops: 'Bir şeyler ters gitti. Lütfen tekrar dene.',
};

const app = express();
// Render (and local dev behind a proxy) terminates TLS in front of us.
// Socket client IPs are derived separately in clientIpFrom(); this only affects Express.
app.set('trust proxy', 1);
app.use((req, res, next) => {
  if (req.path.startsWith('/socket.io')) return next();
  const sid = sidFromCookie(req.headers.cookie);
  if (!sid) {
    const fresh = crypto.randomBytes(16).toString('hex');
    res.appendHeader('Set-Cookie', `mafya_sid=${fresh}; Path=/; Max-Age=2592000; SameSite=Lax; HttpOnly`);
  }
  next();
});
app.use(express.static(__dirname + '/public'));
// Each role with the room sizes it appears in.
app.get('/roles.json', (req, res) => res.json(Object.fromEntries(Object.entries(G.ROLES).map(([k, r]) =>
  [k, { ...r, sizes: SIZES.filter(n => G.SETUPS[n].includes(k)) }]))));
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: LIMITS.maxHttpBufferSize });

const rooms = new Map();
const conns = new Map(); // ip -> open sockets
const hits = new Map(); // rate-limit key -> timestamps
const newId = () => crypto.randomBytes(8).toString('hex');
const cleanName = s => (typeof s !== 'string' || s.length > LIMITS.nameMaxRaw) ? '' : s.replace(/\s+/g, ' ').trim().slice(0, 16);

function sidFromCookie(header) {
  const m = /(?:^|;\s*)mafya_sid=([a-f0-9]{32})(?=$|;)/.exec(header || '');
  return m ? m[1] : '';
}

function normalizeIp(ip) {
  if (!ip) return '';
  let s = String(ip).trim();
  if (s.startsWith('::ffff:')) s = s.slice(7);
  return s;
}

function isIp(s) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return s.split('.').every(n => Number(n) <= 255);
  return s.includes(':') && s.length <= 45 && /^[0-9a-f:]+$/i.test(s);
}

function isPrivateIp(ip) {
  if (!ip) return false;
  if (ip === '127.0.0.1' || ip === '::1') return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('169.254.')) return true;
  const m = /^172\.(\d+)\./.exec(ip);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  const v6 = ip.toLowerCase();
  return v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80:');
}

// Trust only the nearest proxy hop. A client-supplied prefix in X-Forwarded-For is ignored;
// the last address is the one the proxy actually appended. Direct public clients cannot set it.
function trustForwarded(remote) {
  if (process.env.TRUST_PROXY === '0') return false;
  if (process.env.TRUST_PROXY === '1' || process.env.RENDER === 'true') return true;
  return isPrivateIp(remote);
}

function clientIpFrom(remoteAddress, forwardedFor) {
  const remote = normalizeIp(remoteAddress);
  if (forwardedFor && trustForwarded(remote)) {
    const hops = String(forwardedFor).split(',').map(normalizeIp).filter(isIp);
    if (hops.length) return hops[hops.length - 1];
  }
  return remote || 'unknown';
}

function clientIp(socket) {
  const headers = socket.handshake?.headers || {};
  return clientIpFrom(socket.handshake?.address, headers['x-forwarded-for']);
}

function sessionId(socket) {
  const fromCookie = sidFromCookie(socket.handshake?.headers?.cookie);
  if (fromCookie) return fromCookie;
  if (!socket.data.ephemeralSid) socket.data.ephemeralSid = crypto.randomBytes(16).toString('hex');
  return socket.data.ephemeralSid;
}

function isPlainObject(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

const CHARACTER_FILE = path.join(__dirname, 'public', 'characters', 'characters.json');

function loadCharacters(file = CHARACTER_FILE) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!data || data.version !== 1 || !Array.isArray(data.characters) || !data.characters.length) {
    throw new Error('characters.json: expected version 1 and a non-empty characters array');
  }
  const byId = new Map();
  for (const c of data.characters) {
    if (!isPlainObject(c) || typeof c.id !== 'string' || !/^[a-z0-9]{1,32}$/.test(c.id)) throw new Error('characters.json: bad id');
    if (byId.has(c.id)) throw new Error('characters.json: duplicate id ' + c.id);
    if (typeof c.name !== 'string' || !c.name.trim()) throw new Error('characters.json: bad name for ' + c.id);
    if (!isPlainObject(c.images) || !isPlainObject(c.anchors)) throw new Error('characters.json: bad images or anchors for ' + c.id);
    if (!isPlainObject(c.placeholder) || typeof c.placeholder.initial !== 'string' || !c.placeholder.initial.trim()) {
      throw new Error('characters.json: bad placeholder for ' + c.id);
    }
    byId.set(c.id, c);
  }
  return { version: data.version, list: data.characters, byId };
}

const CHARACTERS = loadCharacters();

// Active scenes come from the manifest. Parked scenes (sahne) stay out of the pool.
const SCENE_MANIFEST = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'scene', 'scene-manifest.json'), 'utf8'));
const SCENE_IDS = Object.keys(SCENE_MANIFEST.scenes).filter(id => SCENE_MANIFEST.scenes[id].status === 'active');
if (!SCENE_IDS.length) throw new Error('scene-manifest: no active scenes');
function pickSceneId() {
  return SCENE_IDS[crypto.randomInt(SCENE_IDS.length)];
}

// { id } or { error: 'missing' | 'type' | 'oversize' | 'unknown' }.
// The same id may be used by more than one player (16 seats, 8 characters).
function parseCharacterId(v) {
  if (v == null || v === '') return { error: 'missing' };
  if (typeof v !== 'string') return { error: 'type' };
  if (v.length > LIMITS.characterIdMax) return { error: 'oversize' };
  const id = v.trim();
  if (!id) return { error: 'missing' };
  if (!CHARACTERS.byId.has(id)) return { error: 'unknown' };
  return { id };
}

function characterMessage(error) {
  return error === 'unknown' ? MSG.characterUnknown : MSG.character;
}

function normalizeCode(v) {
  if (typeof v !== 'string' || v.length > 16) return '';
  const code = v.trim().toUpperCase();
  return /^[A-Z]{4}$/.test(code) ? code : '';
}

function shortId(v) {
  return typeof v === 'string' && /^[a-f0-9]{16}$/.test(v) ? v : '';
}

function allow(key, max, windowMs) {
  const now = Date.now();
  let arr = hits.get(key);
  if (!arr) hits.set(key, arr = []);
  const cutoff = now - windowMs;
  let i = 0;
  while (i < arr.length && arr[i] <= cutoff) i++;
  if (i) arr.splice(0, i);
  if (arr.length >= max) return false;
  arr.push(now);
  return true;
}

function pruneHits(now = Date.now()) {
  for (const [key, arr] of hits) {
    const fresh = arr.filter(t => now - t < 60_000);
    if (!fresh.length) hits.delete(key);
    else if (fresh.length !== arr.length) hits.set(key, fresh);
  }
}

// True when this event must be dropped. Tells the socket at most once every 2s.
function block(kind, socket) {
  const rule = LIMITS.rates[kind];
  const ip = socket.data.ip || 'unknown';
  const ok = allow(`s:${socket.id}:${kind}`, rule.perSocket[0], rule.perSocket[1])
    && allow(`ip:${ip}:${kind}`, rule.perIp[0], rule.perIp[1]);
  if (ok) return false;
  const now = Date.now();
  const noted = socket.data.noted || (socket.data.noted = {});
  if (!noted[kind] || now - noted[kind] > 2000) {
    noted[kind] = now;
    try { socket.emit('err', MSG.rate); } catch { /* socket already closing */ }
  }
  return true;
}

function dropConn(ip) {
  const n = (conns.get(ip) || 1) - 1;
  if (n <= 0) conns.delete(ip);
  else conns.set(ip, n);
}

// Rooms this IP or browser session already sits in or created. A finished, empty table does not count.
function countedRooms(ip, sid) {
  const ipRooms = [], sidRooms = [];
  for (const r of rooms.values()) {
    if (r.phase === 'over' && !r.players.some(p => p.connected)) continue;
    if (r.creatorIp === ip || r.players.some(p => p.ip === ip)) ipRooms.push(r);
    if (sid && (r.creatorSid === sid || r.players.some(p => p.sid === sid))) sidRooms.push(r);
  }
  return { ipRooms, sidRooms };
}

// `joining` is the room being entered. Sitting down at a table you already count does not use a new slot.
function overCap(ip, sid, joining) {
  const { ipRooms, sidRooms } = countedRooms(ip, sid);
  const ipNext = joining && ipRooms.includes(joining) ? ipRooms.length : ipRooms.length + 1;
  const sidNext = joining && sidRooms.includes(joining) ? sidRooms.length : sidRooms.length + 1;
  return ipNext > LIMITS.roomsPerIdentity || sidNext > LIMITS.roomsPerIdentity;
}

function guard(socket, label, fn) {
  return (...args) => {
    try { fn(...args); }
    catch (err) {
      console.error(`socket handler error (${label})`, err && err.stack || err);
      try { socket.emit('err', MSG.oops); } catch { /* ignore */ }
    }
  };
}

// Returns a cleaned action, { error } for a user-visible rejection, or null to ignore.
function parseAction(ev, data) {
  if (data === undefined) {
    if (ev === 'endSpeech' || ev === 'challengeRequest' || ev === 'restart') return {};
    return null;
  }
  if (!isPlainObject(data)) return null;
  switch (ev) {
    case 'endSpeech':
    case 'challengeRequest':
    case 'restart':
      return {};
    case 'challengeAnswer':
      if (typeof data.accept !== 'boolean') return null;
      return { accept: data.accept };
    case 'gun':
    case 'fedai':
    case 'revenge': {
      const target = shortId(data.target);
      if (!target) return null;
      return { target };
    }
    case 'vote': {
      if (!Array.isArray(data.targets) || data.targets.length > 20) return null;
      const targets = [];
      for (const t of data.targets) {
        const id = shortId(t);
        if (!id) return null;
        targets.push(id);
      }
      return { targets };
    }
    case 'poll':
      if (typeof data.yes !== 'boolean') return null;
      return { yes: data.yes };
    case 'action': {
      if (typeof data.type !== 'string' || !/^[a-zA-Z]{1,16}$/.test(data.type)) return null;
      let target = null;
      if (data.target != null) {
        target = shortId(data.target);
        if (!target) return null;
      }
      if (data.role != null && (typeof data.role !== 'string' || data.role.length > 24)) return null;
      return { type: data.type, target, role: data.role };
    }
    case 'mafiaChat': {
      if (typeof data.text !== 'string') return null;
      const text = data.text.trim();
      if (!text) return null;
      if (text.length > LIMITS.chatMaxLen) return { error: MSG.chat };
      return { text };
    }
    default:
      return null;
  }
}

function newCode() {
  let c;
  do c = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPRSTUVYZ'[crypto.randomInt(21)]).join('');
  while (rooms.has(c));
  return c;
}

class Room {
  constructor(size, owner = {}) {
    this.code = newCode();
    this.size = size;
    this.creatorIp = owner.ip || '';
    this.creatorSid = owner.sid || '';
    this.activityAt = Date.now();
    this.emptyAt = 0;
    this.players = []; // {id, token, name, characterId, socketId, connected, nonce, ip, sid}
    this.reset();
  }

  reset() {
    clearTimeout(this.timer);
    this.phase = 'lobby';
    this.sceneId = null;
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
    if (secs && next) this.timer = setTimeout(() => {
      try { next(); }
      catch (err) { console.error('phase error', this.code, err && err.stack || err); }
    }, secs * 1000 * SCALE);
    this.broadcast();
  }
  say(text) { this.narrator = text; this.history.push(text); }
  log(id, text) { (this.logs[id] ||= []).push(text); }
  name(id) { return G.byId(this.g, id)?.name || this.players.find(p => p.id === id)?.name; }

  // ---------- lobby ----------
  join(name, meta = {}) {
    if (this.phase !== 'lobby' || this.players.length >= this.size) return null;
    // Duplicate character picks are allowed: 16 seats, 8 characters. Player colour keeps the seats apart.
    const p = { id: newId(), token: newId(), name, characterId: meta.characterId, socketId: null, connected: true, nonce: 0, ip: meta.ip || '', sid: meta.sid || '' };
    this.players.push(p);
    this.activityAt = Date.now();
    if (this.players.length === this.size) this.set('starting', SECS.starting, () => this.start(), 'Masa doldu! Oyun 10 saniye içinde başlıyor.');
    return p;
  }

  leaveLobby(p) {
    this.players = this.players.filter(x => x !== p);
    this.activityAt = Date.now();
    if (this.phase === 'starting') { clearTimeout(this.timer); this.phase = 'lobby'; }
    this.broadcast();
  }

  start() {
    this.sceneId = pickSceneId();
    this.g = G.createGame(G.shuffle(this.players));
    this.mafiaCount = this.g.players.filter(p => p.team === 'mafia').length;
    this.set('roles', SECS.roles, () => this.startSpeeches(true), 'Rolüne bak ve kimseye söyleme! 🤫');
  }

  // ---------- day: speeches ----------
  startSpeeches(intro) {
    this.intro = intro;
    this.spoken = new Set();
    this.challengeUsed = new Set();
    // Day 1 starts at a random seat; each later day starts (mafia count) seats further round the table.
    const n = this.g.players.length;
    this.startSeat = intro ? crypto.randomInt(n) : (this.startSeat + this.mafiaCount) % n;
    const order = G.speechOrder(this.g, this.startSeat);
    this.queue = order.map(p => ({ id: p.id, kind: 'speech', secs: SECS.speech }));
    const silenced = G.alive(this.g).filter(p => p.silenced);
    if (silenced.length) this.say(`${silenced.map(p => p.name).join(', ')} bugün susturuldu 🤐`);
    if (order.length) this.say(`Bugün konuşmaya ${order[0].name} başlıyor.`);
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
      first ? 'Masumlar uyuyor… Mafya gözlerini açsın ve birbirini tanısın.' : 'Gece oldu. Masumlar uyuyor… Yeteneği olanlar seçimini yapsın.');
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
        this.say(`Dışarıda: ${c.city} masum, ${c.mafia} mafya.`);
      } else this.say('Çoğunluk istemedi, dışarıdakiler gizli kaldı.');
      this.startSpeeches(false);
    }, 'Dışarıdakilerin kaç tanesinin masum, kaç tanesinin mafya olduğunu öğrenmek ister misiniz?');
  }

  end(w) {
    this.winner = w;
    this.set('over', 0, null, w === 'city' ? 'Masumlar kazandı! 🎉 Tüm mafya yakalandı.' : 'Mafya kazandı! 🩸 Masumlar düştü.');
  }

  // ---------- player commands ----------
  handle(p, type, data = {}) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;
    const g = this.g;
    const me = g && G.byId(g, p.id);
    const isSpeaker = this.speaker?.id === p.id && (this.phase === 'speech' || this.phase === 'defense');
    switch (type) {
      case 'endSpeech':
        if (isSpeaker) this.endTurn();
        return;
      case 'challengeRequest':
        if (this.phase === 'speech' && !this.intro && this.speaker?.kind === 'speech' && me?.alive && !this.challenge
          && p.id !== this.speaker.id && this.spoken.has(p.id) && !this.challengeUsed.has(p.id)) {
          this.challenge = { from: p.id, status: 'pending' };
          break;
        }
        return;
      case 'challengeAnswer':
        if (isSpeaker && this.challenge?.status === 'pending' && typeof data.accept === 'boolean') {
          this.challenge.status = data.accept ? 'accepted' : 'declined';
          if (data.accept) this.challengeUsed.add(this.challenge.from);
          break;
        }
        return;
      case 'gun': {
        if (!isSpeaker || this.speaker.kind !== 'speech' || typeof data.target !== 'string') return;
        const r = G.useGun(g, p.id, data.target);
        if (!r) return;
        this.speaker = null;
        return this.announce(r.mafia ? `💥 ${me.name}, ${r.name} oyuncusunu vurdu: MAFYA çıktı! Oyundan çıktı. Gece oluyor.`
          : `💥 ${me.name}, ${r.name} oyuncusunu vurdu: İYİ çıktı. Kimse çıkmıyor. Gece oluyor.`, () => this.startNight());
      }
      case 'fedai': {
        if (!DAY_PHASES.includes(this.phase) || typeof data.target !== 'string') return;
        const target = G.fedaiStrike(g, p.id, data.target);
        if (!target) return;
        this.speaker = null;
        return this.announce(`🧨 ${me.name} kendini feda etti ve ${target} oyuncusunu da yanında götürdü! Gece oluyor.`, () => this.startNight());
      }
      case 'revenge': {
        if (this.phase !== 'revenge' || this.revengeBy !== p.id || typeof data.target !== 'string') return;
        const target = G.terroristRevenge(g, p.id, data.target);
        if (!target) return;
        return this.announce(`💣 ${me.name}, ${target} oyuncusunu da yanında götürdü!`, () => this.startNight());
      }
      case 'vote':
        if ((this.phase === 'vote' || this.phase === 'revote') && me?.alive && Array.isArray(data.targets)) {
          this.votes[p.id] = data.targets.filter(t => typeof t === 'string' && this.candidates.includes(t) && t !== p.id);
          break;
        }
        return;
      case 'poll':
        if (this.phase === 'poll' && me?.alive && typeof data.yes === 'boolean') { this.poll[p.id] = data.yes; break; }
        return;
      case 'action': {
        if (this.phase !== 'night' || typeof data.type !== 'string') return;
        const a = G.validAction(g, p.id, data.type, data.target ?? null, data.role);
        if (!a) return;
        this.actions[data.type] = data.type === 'guess' ? (a.target ? a : null) : a.target;
        (this.chosen[p.id] ||= {})[data.type] = a;
        break;
      }
      case 'mafiaChat': {
        const text = typeof data.text === 'string' ? data.text.trim() : '';
        if (text.length > LIMITS.chatMaxLen) return;
        // Dead mafia are spectators: they cannot write on the mafia channel.
        if (this.phase === 'night' && me?.alive && me.team === 'mafia' && text) {
          this.mafiaChat.push({ name: me.name, text });
          if (this.mafiaChat.length > LIMITS.mafiaChatHistory) this.mafiaChat.splice(0, this.mafiaChat.length - LIMITS.mafiaChatHistory);
          break;
        }
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
    this.activityAt = Date.now();
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
    // Dead mafia see only the public board. Living mafia, from night 1 on, see teammates, the kill and the chat.
    const mafiaEyes = !!(me && me.alive && me.team === 'mafia' && g.night >= 1);
    const v = {
      code: this.code, size: this.size, phase: this.phase, sceneId: this.sceneId, myId: p.id,
      left: this.deadline ? Math.max(0, this.deadline - Date.now()) : null,
      total: this.duration,
      narrator: this.narrator, history: this.history.slice(-30), logs: this.logs[p.id] || [],
      players: (g ? g.players : this.players).map((x, i) => {
        const conn = this.players.find(y => y.id === x.id);
        return {
          id: x.id, name: x.name, characterId: x.characterId || conn?.characterId || null, seat: g ? x.seat : i, alive: g ? x.alive : true,
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
    if (!g || !me) return v;
    v.me = { role: me.role, team: me.team, alive: me.alive, hasGun: me.hasGun && !g.gunUsed };
    v.day = g.day || 1;
    v.night = g.night;
    if (this.speaker) {
      v.speaker = { id: this.speaker.id, kind: this.speaker.kind };
      v.challenge = this.challenge && { from: this.challenge.from, status: this.challenge.status };
      v.canChallenge = this.phase === 'speech' && !this.intro && this.speaker.kind === 'speech' && me?.alive && !this.challenge
        && p.id !== this.speaker.id && this.spoken.has(p.id) && !this.challengeUsed.has(p.id);
      v.canShoot = v.me.hasGun && this.speaker.id === p.id && this.speaker.kind === 'speech';
    }
    if (this.phase === 'vote' || this.phase === 'revote') {
      const t = G.tally(g, this.votes, this.candidates);
      v.vote = { candidates: this.candidates, counts: t.count, need: t.need, mine: this.votes[p.id] || [] };
    }
    if (this.phase === 'poll') v.poll = { mine: this.poll[p.id] };
    v.canFedai = !!(me?.alive && me.role === 'fedai' && !g.fedaiUsed && DAY_PHASES.includes(this.phase));
    if (this.phase === 'revenge' && this.revengeBy === p.id) v.revengeTargets = G.alive(g).map(x => x.id);
    if (this.phase === 'night') {
      v.options = G.nightOptions(g, p.id).map(o => ({ ...o, chosen: this.chosen?.[p.id]?.[o.type] || null }));
      if (mafiaEyes) v.mafiaKill = this.actions?.kill || null;
    }
    if (mafiaEyes) v.mafiaChat = this.mafiaChat.slice(-LIMITS.mafiaChatHistory);
    return v;
  }

  broadcast() {
    for (const p of this.players) {
      if (!p.socketId) continue;
      try { io.to(p.socketId).emit('state', this.view(p)); }
      catch (err) { console.error('broadcast error', err && err.stack || err); }
    }
    try { sendRooms(); }
    catch (err) { console.error('room list error', err && err.stack || err); }
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

function markPresence(r) {
  if (r.players.some(p => p.connected)) r.emptyAt = 0;
  else if (!r.emptyAt) r.emptyAt = Date.now();
}

const ACTIONS = ['endSpeech', 'challengeRequest', 'challengeAnswer', 'gun', 'fedai', 'revenge', 'vote', 'poll', 'action', 'mafiaChat', 'restart'];

function onConnect(socket) {
  const ip = clientIp(socket);
  const sid = sessionId(socket);
  socket.data.ip = ip;
  socket.data.sid = sid;
  conns.set(ip, (conns.get(ip) || 0) + 1);
  let tracked = true;
  let room = null, player = null;

  const release = () => {
    if (!tracked) return;
    tracked = false;
    dropConn(ip);
  };

  const attach = (r, p) => {
    room = r; player = p;
    p.socketId = socket.id; p.connected = true; p.nonce++;
    r.activityAt = Date.now();
    r.emptyAt = 0;
    socket.emit('joined', { code: r.code, token: p.token });
    r.broadcast();
  };

  if ((conns.get(ip) || 0) > LIMITS.connectionsPerIp) {
    socket.emit('err', MSG.conn);
    socket.on('disconnect', release);
    setTimeout(() => { try { socket.disconnect(true); } catch { /* ignore */ } }, 50);
    return;
  }

  sendRooms();

  socket.on('create', guard(socket, 'create', data => {
    if (block('create', socket)) return;
    if (!isPlainObject(data)) return socket.emit('err', MSG.bad);
    const name = cleanName(data.name);
    if (!name) return socket.emit('err', MSG.name);
    const size = data.size;
    if (typeof size !== 'number' || !Number.isInteger(size) || !SIZES.includes(size)) return socket.emit('err', MSG.bad);
    const character = parseCharacterId(data.characterId);
    if (character.error) return socket.emit('err', characterMessage(character.error));
    if (room) return socket.emit('err', MSG.inRoom);
    if (overCap(ip, sid, null)) return socket.emit('err', MSG.rooms);
    const r = new Room(size, { ip, sid });
    rooms.set(r.code, r);
    const p = r.join(name, { ip, sid, characterId: character.id });
    if (!p) { rooms.delete(r.code); return socket.emit('err', MSG.bad); }
    attach(r, p);
  }));

  socket.on('join', guard(socket, 'join', data => {
    if (block('join', socket)) return;
    if (!isPlainObject(data)) return socket.emit('err', MSG.bad);
    const name = cleanName(data.name);
    if (!name) return socket.emit('err', MSG.name);
    const character = parseCharacterId(data.characterId);
    if (character.error) return socket.emit('err', characterMessage(character.error));
    if (room) return socket.emit('err', MSG.inRoom);
    const code = normalizeCode(data.code);
    if (!code) return socket.emit('err', MSG.bad);
    const r = rooms.get(code);
    if (!r) return socket.emit('err', MSG.noRoom);
    if (overCap(ip, sid, r)) return socket.emit('err', MSG.rooms);
    if (r.players.some(p => p.name.toLowerCase() === name.toLowerCase())) return socket.emit('err', MSG.taken);
    const p = r.join(name, { ip, sid, characterId: character.id });
    if (!p) return socket.emit('err', MSG.full);
    attach(r, p);
  }));

  // Resume reattaches the same player row, so the character picked at join stays. A new characterId is ignored.
  socket.on('resume', guard(socket, 'resume', data => {
    if (block('resume', socket)) return;
    if (!isPlainObject(data)) return socket.emit('resumeFailed');
    const code = normalizeCode(data.code);
    const token = shortId(data.token);
    const r = code && rooms.get(code);
    const p = token && r?.players.find(x => x.token === token);
    if (room || !p) return socket.emit('resumeFailed');
    if (p.socketId && p.socketId !== socket.id) io.sockets.sockets.get(p.socketId)?.disconnect();
    attach(r, p);
  }));

  socket.on('leave', guard(socket, 'leave', () => {
    if (!room) return;
    if (room.phase === 'lobby' || room.phase === 'starting') room.leaveLobby(player);
    else { player.connected = false; player.socketId = null; room.broadcast(); }
    cleanup(room);
    room = player = null;
  }));

  socket.on('rtc', guard(socket, 'rtc', data => {
    if (block('rtc', socket)) return;
    if (!isPlainObject(data)) return;
    const to = shortId(data.to);
    if (!to || !isPlainObject(data.data)) return;
    let size = 0;
    try { size = Buffer.byteLength(JSON.stringify(data.data)); }
    catch { return; }
    if (size > 12 * 1024) return;
    const target = room?.players.find(p => p.id === to);
    if (target?.socketId && player) io.to(target.socketId).emit('rtc', { from: player.id, data: data.data });
  }));

  for (const ev of ACTIONS) {
    socket.on(ev, guard(socket, ev, data => {
      if (!room || !player) return;
      if (ev === 'mafiaChat' && block('mafiaChat', socket)) return;
      const parsed = parseAction(ev, data);
      if (!parsed) return;
      if (parsed.error) return socket.emit('err', parsed.error);
      room.handle(player, ev, parsed);
    }));
  }

  socket.on('disconnect', guard(socket, 'disconnect', () => {
    release();
    sendRooms(); // online count changed
    if (!room || player.socketId !== socket.id) return;
    if (room.phase === 'lobby' || room.phase === 'starting') room.leaveLobby(player);
    else { player.connected = false; player.socketId = null; room.broadcast(); }
    cleanup(room);
  }));
}

io.on('connection', socket => {
  try { onConnect(socket); }
  catch (err) {
    console.error('connection setup error', err && err.stack || err);
    try { socket.disconnect(true); } catch { /* ignore */ }
  }
});

// Drop a room a minute after its last player left.
function cleanup(r) {
  markPresence(r);
  clearTimeout(r.cleanupTimer);
  if (r.players.some(p => p.connected)) return;
  if (!rooms.has(r.code)) return;
  r.cleanupTimer = setTimeout(() => {
    r.cleanupTimer = null;
    if (!rooms.has(r.code)) return;
    if (!r.players.some(p => p.connected)) {
      clearTimeout(r.timer);
      rooms.delete(r.code);
      sendRooms();
    }
  }, LIMITS.emptyRoomMs * SCALE);
  r.cleanupTimer.unref?.();
}

function dropRoom(r, message) {
  clearTimeout(r.timer);
  clearTimeout(r.cleanupTimer);
  rooms.delete(r.code);
  for (const p of r.players) {
    const s = p.socketId && io.sockets.sockets.get(p.socketId);
    if (!s) continue;
    try { s.emit('err', message || MSG.closed); } catch { /* ignore */ }
    try { s.disconnect(true); } catch { /* ignore */ }
  }
  sendRooms();
}

function sweep() {
  try {
    const now = Date.now();
    const emptyAfter = LIMITS.emptyRoomMs * SCALE;
    const idleAfter = LIMITS.idleLobbyMs * SCALE;
    for (const r of [...rooms.values()]) {
      const connected = r.players.some(p => p.connected);
      if (!connected) {
        if (!r.emptyAt) r.emptyAt = now;
        if (now - r.emptyAt >= emptyAfter) dropRoom(r);
        continue;
      }
      r.emptyAt = 0;
      if (r.phase === 'lobby' && now - r.activityAt >= idleAfter) dropRoom(r, 'Masa çok uzun süre beklediği için kapandı.');
    }
    pruneHits(now);
  } catch (err) {
    console.error('room sweep error', err && err.stack || err);
  }
}

const sweeper = setInterval(sweep, Math.max(500, Math.round(5000 * SCALE)));
sweeper.unref?.();

function onUncaught(err) {
  console.error('uncaughtException', err && err.stack || err);
}
function onRejection(err) {
  console.error('unhandledRejection', err && (err.stack || err));
}
process.on('uncaughtException', onUncaught);
process.on('unhandledRejection', onRejection);

function resetForTests() {
  for (const r of rooms.values()) {
    clearTimeout(r.timer);
    clearTimeout(r.cleanupTimer);
  }
  rooms.clear();
  conns.clear();
  hits.clear();
}

const PORT = process.env.PORT || 3000;
if (require.main === module) server.listen(PORT, () => console.log(`Mafya: http://localhost:${PORT}`));
module.exports = { server, io, rooms, SECS, LIMITS, resetForTests, clientIpFrom, parseCharacterId, CHARACTERS, SCENE_IDS, pickSceneId };
