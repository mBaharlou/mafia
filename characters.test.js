// Character picks: id checks, room sync, and resume.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { io: connect } = require('socket.io-client');
const { server, rooms, LIMITS, resetForTests, parseCharacterId, CHARACTERS } = require('./server');

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

test('character id validation', () => {
  const disk = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'characters', 'characters.json'), 'utf8'));
  assert.deepEqual(CHARACTERS.list.map(c => c.id), disk.characters.map(c => c.id));
  assert.deepEqual(CHARACTERS.list.map(c => c.id), ['vinil', 'pelus', 'goz', 'rakun', 'fitil', 'murekkep', 'penguen', 'teneke']);
  for (const c of CHARACTERS.list) {
    assert.equal(parseCharacterId(c.id).id, c.id);
    assert.equal(typeof c.anchors, 'object');
    assert.ok(c.images['128'] && c.images['256'] && c.images['512']);
    assert.ok(c.states.speaking['128'] && c.states.dead['256'] && c.accent);
  }
  assert.equal(parseCharacterId(' fitil ').id, 'fitil');

  assert.equal(parseCharacterId(undefined).error, 'missing');
  assert.equal(parseCharacterId(null).error, 'missing');
  assert.equal(parseCharacterId('').error, 'missing');
  assert.equal(parseCharacterId('   ').error, 'missing');

  assert.equal(parseCharacterId(1).error, 'type');
  assert.equal(parseCharacterId(true).error, 'type');
  assert.equal(parseCharacterId({ id: 'fitil' }).error, 'type');
  assert.equal(parseCharacterId(['fitil']).error, 'type');

  assert.equal(parseCharacterId('yok').error, 'unknown');
  assert.equal(parseCharacterId('FITIL').error, 'unknown');
  assert.equal(parseCharacterId('z'.repeat(LIMITS.characterIdMax)).error, 'unknown');

  assert.equal(parseCharacterId('z'.repeat(LIMITS.characterIdMax + 1)).error, 'oversize');
  assert.equal(parseCharacterId('x'.repeat(5000)).error, 'oversize');
});

test('chosen character syncs to the room and a join without one is rejected', { timeout: 20_000 }, async () => {
  await new Promise((resolve, reject) => server.listen(0, err => err ? reject(err) : resolve()));
  const url = `http://127.0.0.1:${server.address().port}`;
  const clients = [];
  const track = socket => {
    const box = { state: null, errs: [] };
    socket.on('state', s => { box.state = s; });
    socket.on('err', m => box.errs.push(m));
    clients.push(socket);
    return box;
  };
  const client = () => {
    const c = connect(url, { forceNew: true, transports: ['websocket'], reconnection: false, timeout: 5000 });
    c.on('error', () => {});
    c.on('connect_error', () => {});
    return c;
  };

  try {
    const host = client();
    const hostBox = track(host);
    await once(host, 'connect');
    const missingName = once(host, 'err');
    host.emit('create', { size: 9, characterId: 'vinil' });
    assert.match(await missingName, /isim/);
    assert.equal(rooms.size, 0);

    const missingCharacter = once(host, 'err');
    host.emit('create', { name: 'Ayşe', size: 9 });
    assert.match(await missingCharacter, /karakter seç/);
    assert.equal(rooms.size, 0);

    const joined = once(host, 'joined');
    host.emit('create', { name: 'Ayşe', size: 9, characterId: 'fitil' });
    const info = await joined;
    await waitFor(() => hostBox.state?.players?.length === 1);
    assert.equal(hostBox.state.players[0].characterId, 'fitil');

    const guest = client();
    const guestBox = track(guest);
    const guestJoined = once(guest, 'joined');
    guest.emit('join', { name: 'Ali', code: info.code, characterId: 'fitil' });
    await guestJoined;
    await waitFor(() => hostBox.state.players.length === 2 && guestBox.state?.players?.length === 2);
    assert.deepEqual(hostBox.state.players.map(p => p.characterId), ['fitil', 'fitil']);
    assert.deepEqual(guestBox.state.players.map(p => p.characterId), ['fitil', 'fitil']);

    const bad = client();
    const badBox = track(bad);
    const cases = [
      [{ name: 'Yeni', code: info.code }, /karakter seç/],
      [{ name: 'Yeni', code: info.code, characterId: 12 }, /karakter seç/],
      [{ name: 'Yeni', code: info.code, characterId: 'x'.repeat(5000) }, /karakter seç/],
      [{ name: 'Yeni', code: info.code, characterId: 'fasulye' }, /Bu karakter yok/],
    ];
    for (const [payload, pattern] of cases) {
      const err = once(bad, 'err');
      bad.emit('join', payload);
      assert.match(await err, pattern);
    }
    await wait(40);
    assert.equal(rooms.get(info.code).players.length, 2);
    assert.equal(badBox.state, null);

    const third = client();
    const thirdBox = track(third);
    const thirdJoined = once(third, 'joined');
    third.emit('join', { name: 'Deniz', code: info.code, characterId: 'penguen' });
    const thirdInfo = await thirdJoined;
    await waitFor(() => hostBox.state.players.length === 3 && thirdBox.state?.players?.some(p => p.characterId === 'penguen'));
    assert.ok(guestBox.state.players.some(p => p.name === 'Deniz' && p.characterId === 'penguen'));

    // Lobby disconnect frees the seat. A live game keeps the row, and the character with it.
    const room = rooms.get(info.code);
    room.phase = 'roles';
    third.close();
    await waitFor(() => hostBox.state.players.find(p => p.name === 'Deniz' && p.connected === false));
    const again = client();
    const againBox = track(again);
    const resumed = once(again, 'joined');
    again.emit('resume', { code: info.code.toLowerCase(), token: thirdInfo.token, characterId: 'teneke' });
    await resumed;
    await waitFor(() => againBox.state?.players?.some(p => p.name === 'Deniz' && p.characterId === 'penguen'));
    assert.equal(againBox.state.players.find(p => p.name === 'Deniz').characterId, 'penguen');
    await waitFor(() => hostBox.state.players.find(p => p.name === 'Deniz' && p.connected && p.characterId === 'penguen'));
  } finally {
    for (const c of clients) c.close();
    resetForTests();
    await new Promise(resolve => server.close(() => resolve()));
  }
});
