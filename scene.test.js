// Scene id sync, and the full-screen layout math from the build note.
process.env.TIME_SCALE = '0.01';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { io: connect } = require('socket.io-client');
const { server, rooms, resetForTests, SCENE_IDS, pickSceneId, CHARACTERS } = require('./server');
const { layoutSeats, resolveCharacterId, resolveSceneId, skinPassesAA, resolveFlagSkin } = require('./public/scene');

const wait = ms => new Promise(r => setTimeout(r, ms));
function once(emitter, ev, ms = 4000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout waiting for ' + ev)), ms);
    emitter.once(ev, v => { clearTimeout(t); resolve(v); });
  });
}
async function waitFor(fn, ms = 4000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < ms) {
    last = fn();
    if (last) return last;
    await wait(15);
  }
  throw new Error('timeout: ' + last);
}

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'scene', 'scene-manifest.json'), 'utf8'));

function walk(dir) {
  const files = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) files.push(...walk(p));
    else files.push(p);
  }
  return files;
}

test('shipped scene pack is webp only, meydan and cember', () => {
  assert.deepEqual(Object.keys(manifest.scenes).sort(), ['cember', 'meydan']);
  assert.equal(manifest.scenes.sahne, undefined);
  const urls = [];
  const take = files => { for (const f of Object.values(files)) urls.push(f.full, f.small); };
  for (const p of Object.values(manifest.players)) take(p.files);
  take(manifest.kahin.files);
  for (const scene of Object.values(manifest.scenes)) {
    for (const layout of Object.values(scene.bg)) for (const file of Object.values(layout)) urls.push(file);
  }
  assert.ok(urls.length >= 60);
  for (const url of urls) {
    assert.ok(url.endsWith('.webp'), url);
    assert.ok(!url.includes('sahne'), url);
    const disk = path.join(__dirname, 'public', url.replace(/^\//, ''));
    assert.ok(fs.existsSync(disk), disk);
  }
  const shipped = walk(path.join(__dirname, 'public', 'scene'));
  assert.ok(shipped.every(f => !f.endsWith('.png')));
  assert.ok(shipped.every(f => !path.basename(f).includes('sahne')));
});

test('unknown scene falls back to meydan and only the free skin renders', () => {
  assert.equal(resolveSceneId(manifest, 'meydan'), 'meydan');
  assert.equal(resolveSceneId(manifest, 'cember'), 'cember');
  assert.equal(resolveSceneId(manifest, 'sahne'), 'meydan');
  assert.equal(resolveSceneId(manifest, 'nope'), 'meydan');
  assert.equal(resolveSceneId(manifest, null), 'meydan');
  assert.equal(manifest.scenes.meydan.bg.desktop.day.endsWith('meydan-day-desktop.webp'), true);
  assert.equal(manifest.scenes.cember.bg.desktop.day.endsWith('cember-day-desktop.webp'), true);
  assert.equal(manifest.scenes.cember.bg.phone.day.endsWith('cember-day-phone.webp'), true);
  assert.equal(manifest.scenes.meydan.day_night.duration_ms, 1800);
  assert.equal(manifest.scenes.cember.day_night.duration_ms, 1800);
  for (const rel of ['flags/knobs/ball.svg', 'flags/knobs/star.svg', 'flags/ornaments/crown.svg', 'flags/ornaments/crescent.svg', 'flags/ornaments/fedora.svg', 'flags/patterns/stars.svg']) {
    assert.ok(fs.existsSync(path.join(__dirname, 'public', 'scene', rel)), rel);
  }
  assert.equal(manifest.note, undefined);
  for (const skin of Object.values(manifest.flag_skins.skins)) {
    assert.equal(skinPassesAA(skin), true, skin.id);
    for (const k of ['normal', 'speaking', 'dead', 'you']) assert.ok(skin.contrast[k] >= 4.5, skin.id + ' ' + k);
  }
  assert.equal(resolveFlagSkin(manifest, 'standart'), 'standart');
  assert.equal(resolveFlagSkin(manifest, 'kraliyet'), 'standart');
  assert.equal(resolveFlagSkin(manifest, 'yildiz'), 'standart');
  assert.equal(resolveFlagSkin(manifest, 'gangster'), 'standart');
  assert.equal(manifest.flag_skins.skins.kraliyet.tier, 'paid');
  assert.equal(manifest.cosmetic_stack.order_bottom_to_top.join(','), 'base,costume,hat,effect,flag');
});

test('blob is the same character as goz', () => {
  assert.equal(resolveCharacterId('blob'), 'goz');
  assert.equal(resolveCharacterId('goz'), 'goz');
  assert.equal(resolveCharacterId('vinil'), 'vinil');
  assert.ok(manifest.players.goz);
  assert.equal(manifest.players.blob, undefined);
});

test('scene pick is only meydan or cember', () => {
  const seen = new Set();
  for (let i = 0; i < 40; i++) seen.add(pickSceneId());
  assert.deepEqual([...seen].sort(), [...SCENE_IDS].sort());
});

function layoutOf(scene, layout, n, width, height, meIndex) {
  return layoutSeats(manifest, { scene, layout, n, width, height, meIndex });
}

function assertInside(lay, width) {
  for (const s of lay.seats) {
    assert.ok(s.x - s.imgW / 2 >= 11.5, `left ${s.x - s.imgW / 2}`);
    assert.ok(s.x + s.imgW / 2 <= width - 11.5, `right ${s.x + s.imgW / 2}`);
  }
}

test('ring layout matches the build note at 16 and 8', () => {
  const desk = layoutOf('meydan', 'desktop', 16, 1920, 1080, 3);
  const heights = desk.seats.map(s => s.h);
  assert.ok(Math.min(...heights) >= 160 && Math.min(...heights) <= 190, 'back row ~162, got ' + Math.min(...heights));
  assert.ok(Math.max(...heights) >= 200 && Math.max(...heights) <= 224, 'front row ~221, got ' + Math.max(...heights));
  assert.ok(Math.abs(desk.god.h - 0.36 * 1080) < 0.5, desk.god.h);
  const phone = layoutOf('meydan', 'phone', 16, 375, 812, 0);
  const ph = phone.seats.map(s => s.h);
  assert.ok(Math.min(...ph) >= 62 && Math.min(...ph) <= 72, 'phone back ~63, got ' + Math.min(...ph));
  assert.ok(Math.max(...ph) >= 74 && Math.max(...ph) <= 82, 'phone front ~80, got ' + Math.max(...ph));
  assert.ok(Math.abs(phone.god.h - 0.19 * 812) < 0.5, phone.god.h);

  const eight = layoutOf('cember', 'desktop', 8, 1920, 1080, 1);
  const eh = eight.seats.map(s => s.h);
  assert.ok(Math.min(...eh) > Math.min(...heights), '8 players stand taller than 16');
  assert.ok(Math.abs(eight.god.h - 0.36 * 1080) < 0.5);

  for (const [scene, layout, n, w, h] of [
    ['meydan', 'desktop', 16, 1920, 1080],
    ['meydan', 'desktop', 8, 1920, 1080],
    ['meydan', 'phone', 16, 375, 812],
    ['cember', 'desktop', 16, 1920, 1080],
    ['cember', 'desktop', 8, 1920, 1080],
    ['cember', 'phone', 16, 375, 812],
    ['meydan', 'desktop', 16, 900, 1400],
    ['cember', 'phone', 9, 320, 700],
  ]) {
    const me = 4 % n;
    const lay = layoutOf(scene, layout, n, w, h, me);
    assert.equal(lay.seats.length, n);
    assertInside(lay, w);
    const front = lay.seats.reduce((a, b) => Math.abs(a.angle - 90) < Math.abs(b.angle - 90) ? a : b);
    assert.equal(front.playerIndex, me);
    const lowest = lay.seats.reduce((a, b) => a.y >= b.y ? a : b);
    assert.equal(lowest.playerIndex, me, 'you stands at the front');
    for (let i = 1; i < n; i++) assert.ok(lay.seats[i].angle >= lay.seats[i - 1].angle - 0.01);
    const ordered = lay.seats.slice().sort((a, b) => a.angle - b.angle);
    const at = ordered.findIndex(s => s.playerIndex === me);
    assert.equal(ordered[(at + 1) % n].playerIndex, (me + 1) % n);
  }
});

test('a game shares one scene id, and resume keeps it', { timeout: 120000 }, async () => {
  await new Promise((resolve, reject) => server.listen(0, err => err ? reject(err) : resolve()));
  const url = `http://127.0.0.1:${server.address().port}`;
  const clients = [];
  const bots = [];
  const track = socket => {
    const box = { state: null, token: null, code: null };
    socket.on('state', s => { box.state = s; });
    socket.on('joined', info => { box.token = info.token; box.code = info.code; });
    clients.push(socket);
    return box;
  };
  const open = () => {
    const c = connect(url, { forceNew: true, transports: ['websocket'], reconnection: false, timeout: 8000 });
    c.on('error', () => {});
    c.on('connect_error', () => {});
    return c;
  };
  const ids = CHARACTERS.list.map(c => c.id);

  try {
    const boxes = [];
    const host = open();
    boxes.push(track(host));
    await once(host, 'connect');
    host.emit('create', { name: 'Host', size: 9, characterId: 'fitil' });
    await waitFor(() => boxes[0].state && boxes[0].state.phase === 'lobby');
    assert.equal(boxes[0].state.sceneId, null);
    const code = boxes[0].code;
    for (let i = 1; i < 9; i++) {
      const c = open();
      boxes.push(track(c));
      await once(c, 'connect');
      c.emit('join', { name: 'P' + i, code, characterId: ids[i % ids.length] });
    }
    await waitFor(() => boxes.every(b => b.state && b.state.phase !== 'lobby' && b.state.phase !== 'starting' && b.state.sceneId));
    const sceneId = boxes[0].state.sceneId;
    assert.ok(SCENE_IDS.includes(sceneId), sceneId);
    for (const b of boxes) assert.equal(b.state.sceneId, sceneId);

    const gone = clients[4];
    const token = boxes[4].token;
    gone.close();
    clients.splice(clients.indexOf(gone), 1);
    await wait(30);
    const again = open();
    const againBox = track(again);
    await once(again, 'connect');
    again.emit('resume', { code, token });
    await waitFor(() => againBox.state && againBox.state.sceneId === sceneId && againBox.state.players.some(p => p.connected && p.name === 'P4'));
    assert.equal(againBox.state.sceneId, sceneId);

    const room = rooms.get(code);
    room.reset();
    assert.equal(room.sceneId, null);
    room.start();
    assert.ok(SCENE_IDS.includes(room.sceneId));
    await waitFor(() => boxes[0].state && boxes[0].state.sceneId === room.sceneId && boxes[0].state.phase !== 'lobby');

    for (const c of clients) c.close();
    clients.length = 0;
    await wait(40);
    resetForTests();

    const seen = { sceneId: null, spoke: new Set(), died: false, day: 0, phases: new Set(), error: null };
    let finished;
    let dayTimer;
    const done = new Promise((resolve, reject) => {
      finished = () => { clearTimeout(dayTimer); resolve(); };
      dayTimer = setTimeout(() => reject(new Error('day 3 not reached; day ' + seen.day + ' died ' + seen.died + ' spoke ' + seen.spoke.size + ' phases ' + [...seen.phases])), 90000);
    });
    const bot = (i, roomCode) => {
      const c = open();
      bots.push(c);
      c.on('state', s => {
        seen.phases.add(s.phase);
        if (s.phase !== 'lobby' && s.phase !== 'starting') {
          if (!SCENE_IDS.includes(s.sceneId)) seen.error = 'bad scene ' + s.sceneId;
          else if (!seen.sceneId) seen.sceneId = s.sceneId;
          else if (s.sceneId !== seen.sceneId) seen.error = 'scene changed ' + seen.sceneId + ' -> ' + s.sceneId;
        }
        if (s.day) seen.day = Math.max(seen.day, s.day);
        if ((s.phase === 'speech' || s.phase === 'defense') && s.speaker) seen.spoke.add(s.speaker.id);
        if (s.players?.some(p => p.alive === false)) seen.died = true;
        if (seen.day >= 3 && seen.spoke.size && seen.died) finished();
        if (s.phase === 'over') return;
        const me = s.me;
        if (!me?.alive) return;
        if ((s.phase === 'speech' || s.phase === 'defense') && s.speaker?.id === s.myId) {
          if (s.challenge?.status === 'pending') return c.emit('challengeAnswer', { accept: false });
          return setTimeout(() => c.emit('endSpeech'), 5);
        }
        if ((s.phase === 'vote' || s.phase === 'revote') && s.vote && !s.vote.mine.length) {
          const t = s.vote.candidates.filter(id => id !== s.myId);
          if (t[0]) c.emit('vote', { targets: [t[0]] });
        }
        if (s.phase === 'poll' && s.poll && s.poll.mine === undefined) c.emit('poll', { yes: true });
        if (s.phase === 'night') for (const o of s.options || []) if (!o.chosen) c.emit('action', { type: o.type, target: (o.targets || [])[0] || null, role: o.roles && o.roles[0] });
        if (s.revengeTargets) c.emit('revenge', { target: s.revengeTargets[0] });
      });
      if (roomCode) c.emit('join', { name: 'Bot' + i, code: roomCode, characterId: ids[i % ids.length] });
      return c;
    };
    const lead = bot(0);
    lead.once('joined', ({ code: roomCode }) => { for (let i = 1; i < 16; i++) bot(i, roomCode); });
    lead.emit('create', { name: 'Bot0', size: 16, characterId: ids[0] });
    await done;
    assert.equal(seen.error, null);
    assert.ok(seen.spoke.size >= 1, 'someone spoke');
    assert.equal(seen.died, true);
    assert.ok(seen.day >= 3, 'reached day ' + seen.day);
    assert.ok(SCENE_IDS.includes(seen.sceneId));
    for (const c of bots) c.close();
  } finally {
    for (const c of bots) c.close();
    for (const c of clients) c.close();
    resetForTests();
    await new Promise(resolve => server.close(() => resolve()));
  }
});
