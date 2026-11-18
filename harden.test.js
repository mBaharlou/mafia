// Socket-level checks for payload safety, abuse limits, dead-mafia secrecy and room codes.
const test = require('node:test');
const assert = require('node:assert');
const { io: connect } = require('socket.io-client');
const { server, io, rooms, LIMITS, resetForTests, clientIpFrom } = require('./server');

const wait = ms => new Promise(r => setTimeout(r, ms));

function once(emitter, ev, ms = 4000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout waiting for ' + ev)), ms);
    emitter.once(ev, v => { clearTimeout(t); resolve(v); });
  });
}

async function waitFor(fn, ms = 2000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < ms) {
    last = fn();
    if (last) return last;
    await wait(20);
  }
  throw new Error('timeout: ' + last);
}

test('client IP trusts only the proxy hop', () => {
  assert.equal(clientIpFrom('10.0.0.8', '1.2.3.4, 203.0.113.20'), '203.0.113.20');
  assert.equal(clientIpFrom('::ffff:127.0.0.1', '9.9.9.9, 198.51.100.8'), '198.51.100.8');
  // A client that connects directly cannot spoof X-Forwarded-For.
  assert.equal(clientIpFrom('8.8.8.8', '1.2.3.4, 203.0.113.20'), '8.8.8.8');
  assert.equal(clientIpFrom('203.0.113.5', ''), '203.0.113.5');
  const prev = process.env.RENDER;
  process.env.RENDER = 'true';
  try {
    assert.equal(clientIpFrom('8.8.8.8', '1.1.1.1, 198.51.100.9'), '198.51.100.9');
  } finally {
    if (prev === undefined) delete process.env.RENDER;
    else process.env.RENDER = prev;
  }
  assert.equal(io.engine.opts.maxHttpBufferSize, LIMITS.maxHttpBufferSize);
  assert.ok(process.listeners('uncaughtException').some(fn => fn.name === 'onUncaught'));
  assert.ok(process.listeners('unhandledRejection').some(fn => fn.name === 'onRejection'));
});

test('socket hardening', { timeout: 60_000 }, async (t) => {
  await new Promise((resolve, reject) => server.listen(0, err => err ? reject(err) : resolve()));
  const url = `http://127.0.0.1:${server.address().port}`;
  const clients = [];

  function client(opts = {}) {
    const c = connect(url, { forceNew: true, transports: ['websocket'], reconnection: false, timeout: 5000, ...opts });
    c._errs = [];
    c.on('err', m => c._errs.push(m));
    c.on('error', () => {});
    c.on('connect_error', () => {});
    clients.push(c);
    return c;
  }
  function track(socket) {
    const box = { state: null };
    socket.on('state', s => { box.state = s; });
    return box;
  }
  async function settle() {
    for (const c of clients) c.close();
    clients.length = 0;
    await wait(50);
    resetForTests();
  }

  try {
    await t.test('malformed payloads do not crash the process', async () => {
      const sock = client();
      await once(sock, 'connect');
      const junk = [null, undefined, 0, 'nope', [], { name: 1, size: '9' }, { name: 'A'.repeat(5000), size: 9, characterId: 'fitil' }];
      for (const ev of ['create', 'join', 'resume', 'rtc', 'vote', 'poll', 'action', 'gun', 'fedai', 'revenge', 'mafiaChat', 'challengeAnswer']) {
        for (const payload of junk) sock.emit(ev, payload);
      }
      sock.emit('vote', { targets: [1, { a: 1 }, 'zzzzzzzzzzzzzzzz'] });
      sock.emit('action', { type: 'kill', target: 5, role: ['x'] });
      sock.emit('mafiaChat', { text: { boom: true } });
      sock.emit('rtc', { to: { id: 'x' }, data: 'big' });
      await wait(80);
      assert.equal(server.listening, true);

      const host = client();
      const joined = once(host, 'joined');
      host.emit('create', { name: 'Ayşe', size: 9, characterId: 'fitil' });
      const info = await joined;
      assert.match(info.code, /^[A-Z]{4}$/);
      assert.equal(server.listening, true);

      const guest = client();
      const guestJoined = once(guest, 'joined');
      guest.emit('join', { name: 'Ali', code: info.code.toLowerCase(), characterId: 'pelus' });
      const guestInfo = await guestJoined;
      assert.equal(guestInfo.code, info.code);
    });

    await t.test('event spam is rate limited', async () => {
      await settle();
      const sock = client();
      await once(sock, 'connect');
      for (let i = 0; i < 20; i++) sock.emit('join', { name: 'Spam', code: 'ZZZZ', characterId: 'fitil' });
      await waitFor(() => sock._errs.some(m => m.includes('Çok hızlı')));
      assert.ok(sock._errs.some(m => m.includes('oda yok')));
      const other = client();
      const joined = once(other, 'joined');
      other.emit('create', { name: 'Hâlâ', size: 9, characterId: 'fitil' });
      await joined;
      assert.equal(server.listening, true);
    });

    await t.test('a fourth concurrent room from the same IP is rejected', async () => {
      await settle();
      const made = [];
      for (let i = 0; i < 3; i++) {
        const c = client();
        const joined = once(c, 'joined');
        c.emit('create', { name: 'Ev' + i, size: 9, characterId: 'fitil' });
        made.push(await joined);
      }
      assert.equal(rooms.size, 3);
      const fourth = client();
      const err = once(fourth, 'err');
      fourth.emit('create', { name: 'Ev3', size: 9, characterId: 'fitil' });
      assert.match(await err, /en fazla 3 masa/);
      await wait(40);
      assert.equal(rooms.size, 3);
      const guest = client();
      const guestJoined = once(guest, 'joined');
      guest.emit('join', { name: 'Misafir', code: made[0].code, characterId: 'goz' });
      await guestJoined;
      assert.equal(rooms.size, 3);
      const fifth = client();
      const fifthErr = once(fifth, 'err');
      fifth.emit('create', { name: 'Ev4', size: 9, characterId: 'fitil' });
      assert.match(await fifthErr, /en fazla 3 masa/);
      assert.equal(rooms.size, 3);
    });

    await t.test('a fourth room from the same browser session is rejected', async () => {
      await settle();
      const sid = 'ab'.repeat(16);
      for (let i = 0; i < 3; i++) {
        const c = client({ extraHeaders: { cookie: `mafya_sid=${sid}`, 'x-forwarded-for': `198.51.100.${10 + i}` } });
        const joined = once(c, 'joined');
        c.emit('create', { name: 'Oturum' + i, size: 9, characterId: 'fitil' });
        await joined;
      }
      const ips = new Set([...rooms.values()].map(r => r.creatorIp));
      assert.equal(ips.size, 3);
      assert.ok(!ips.has('1.2.3.4'));
      const fourth = client({ extraHeaders: { cookie: `mafya_sid=${sid}`, 'x-forwarded-for': '1.2.3.4, 198.51.100.99' } });
      const err = once(fourth, 'err');
      fourth.emit('create', { name: 'Oturum3', size: 9, characterId: 'fitil' });
      assert.match(await err, /en fazla 3 masa/);
      await wait(40);
      assert.equal(rooms.size, 3);
      assert.ok([...rooms.values()].every(r => r.creatorIp !== '1.2.3.4'));
    });

    await t.test('dead mafia see no secrets, lowercase resume works, chat is capped', async () => {
      await settle();
      const members = [];
      const host = client();
      const hostBox = track(host);
      const hostJoined = once(host, 'joined');
      host.emit('create', { name: 'P0', size: 9, characterId: 'fitil' });
      const first = await hostJoined;
      members.push({ socket: host, box: hostBox, token: first.token });
      for (let i = 1; i < 9; i++) {
        const c = client();
        const box = track(c);
        const joined = once(c, 'joined');
        c.emit('join', { name: 'P' + i, code: first.code, characterId: 'fitil' });
        const info = await joined;
        members.push({ socket: c, box, token: info.token });
      }
      const room = rooms.get(first.code);
      room.start();
      clearTimeout(room.timer);
      await waitFor(() => members.every(m => m.box.state?.me?.team));

      const mafia = members.filter(m => m.box.state.me.team === 'mafia');
      const city = members.find(m => m.box.state.me.team === 'city');
      assert.equal(mafia.length, 3);
      const dead = mafia[0];
      const alive = mafia[1];
      const cityId = city.box.state.myId;
      const deadPlayer = room.g.players.find(p => p.id === dead.box.state.myId);
      deadPlayer.alive = false;
      room.phase = 'night';
      room.g.night = 2;
      room.actions = { kill: cityId };
      room.chosen = {};
      room.mafiaChat = [{ name: 'Gizli', text: 'plan-xyz' }];
      room.broadcast();
      await waitFor(() => dead.box.state.me.alive === false && alive.box.state.phase === 'night');

      const deadView = dead.box.state;
      assert.equal(deadView.mafiaChat, undefined);
      assert.equal(deadView.mafiaKill, undefined);
      assert.ok(deadView.players.every(p => !p.mate));
      assert.ok(deadView.players.every(p => (p.id === deadView.myId ? p.role : p.role == null)));
      assert.deepEqual(deadView.options, []);
      assert.deepEqual(deadView.audio.sendTo, []);
      assert.deepEqual(deadView.audio.hear, []);

      const aliveView = alive.box.state;
      assert.ok(aliveView.mafiaChat.some(m => m.text === 'plan-xyz'));
      assert.ok(aliveView.players.some(p => p.mate && p.id !== aliveView.myId));
      assert.equal(aliveView.mafiaKill, cityId);
      assert.ok(aliveView.audio.sendTo.length > 0);

      const cityView = city.box.state;
      assert.equal(cityView.mafiaChat, undefined);
      assert.equal(cityView.mafiaKill, undefined);

      const before = room.mafiaChat.length;
      dead.socket.emit('mafiaChat', { text: 'dead-secret' });
      dead.socket.emit('action', { type: 'kill', target: cityId });
      await wait(60);
      assert.equal(room.mafiaChat.length, before);
      assert.ok(!room.mafiaChat.some(m => m.text === 'dead-secret'));
      assert.equal(room.actions.kill, cityId);

      const long = once(alive.socket, 'err');
      alive.socket.emit('mafiaChat', { text: 'x'.repeat(LIMITS.chatMaxLen + 1) });
      assert.match(await long, /200 karakter/);
      assert.equal(room.mafiaChat.length, before);

      const seat = room.players.find(p => p.id === alive.box.state.myId);
      for (let i = 0; i < 120; i++) room.handle(seat, 'mafiaChat', { text: 'm' + i });
      assert.equal(room.mafiaChat.length, LIMITS.mafiaChatHistory);
      assert.equal(room.mafiaChat[0].text, 'm20');
      assert.equal(room.mafiaChat.at(-1).text, 'm119');

      alive.socket.close();
      await wait(40);
      const again = client();
      const againBox = track(again);
      const resumed = once(again, 'joined');
      again.emit('resume', { code: '  ' + first.code.toLowerCase() + ' ', token: alive.token });
      const resumedInfo = await resumed;
      assert.equal(resumedInfo.code, first.code);
      await waitFor(() => againBox.state?.myId === alive.box.state.myId && againBox.state.mafiaChat);
      assert.ok(againBox.state.mafiaChat.some(m => m.text === 'm119'));
      assert.equal(againBox.state.me.alive, true);

      room.phase = 'over';
      room.winner = 'city';
      room.broadcast();
      await waitFor(() => dead.box.state.phase === 'over' && dead.box.state.players.every(p => p.role));
      assert.equal(dead.box.state.mafiaChat, undefined);
      assert.ok(dead.box.state.players.every(p => p.role));
    });

    await t.test('per-IP connection cap', async () => {
      await settle();
      const open = [];
      for (let i = 0; i < LIMITS.connectionsPerIp; i++) open.push(client());
      await waitFor(() => open.every(s => s.connected), 8000);
      const extra = client();
      await waitFor(() => extra._errs.some(m => m.includes('bağlantı')), 4000);
      await waitFor(() => extra.connected === false, 2000);
      assert.equal(server.listening, true);
      open[0].close();
      await wait(60);
      const still = client();
      await once(still, 'connect');
      assert.equal(still.connected, true);
    });

    await t.test('an oversized packet does not take the server down', async () => {
      await settle();
      const big = client();
      await once(big, 'connect');
      try { big.emit('rtc', { to: 'a'.repeat(32), data: { pad: 'x'.repeat(20 * 1024) } }); } catch { /* client may reject it */ }
      await wait(100);
      assert.equal(server.listening, true);
      const next = client();
      const joined = once(next, 'joined');
      next.emit('create', { name: 'Ayaktayız', size: 9, characterId: 'fitil' });
      await joined;
    });
  } finally {
    for (const c of clients) c.close();
    resetForTests();
    await new Promise(resolve => server.close(() => resolve()));
  }
});
