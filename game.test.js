const test = require('node:test');
const assert = require('node:assert');
const G = require('./game');

// Fixed seating: p0 baba, p1 matador, p2 kotudoktor, p3 doktor, p4 nisanci, p5 buyucu, p6 gozcu, p7 susturucu, p8 silahci
const fresh = () => freshN(9);
const isAlive = (g, id) => G.byId(g, id).alive;

test('vote threshold', () => {
  assert.deepStrictEqual([9, 8, 7, 6, 5, 4].map(G.needed), [5, 4, 4, 3, 3, 2]);
});

test('kill works, doctor save blocks it', () => {
  let g = fresh();
  G.resolveNight(g, { kill: 'p6' });
  assert.equal(isAlive(g, 'p6'), false);
  g = fresh();
  G.resolveNight(g, { kill: 'p6', save: 'p6' });
  assert.equal(isAlive(g, 'p6'), true);
});

test('matador block cancels doctor save', () => {
  const g = fresh();
  const r = G.resolveNight(g, { kill: 'p6', save: 'p6', block: 'p3' });
  assert.equal(isAlive(g, 'p6'), false);
  assert.ok(r.privateMsgs.some(m => m.to === 'p3'));
});

test('sniper: baba shield, bad doctor, wrong target', () => {
  let g = fresh();
  G.resolveNight(g, { shot: 'p0' });
  assert.equal(isAlive(g, 'p0'), true);
  assert.equal(g.shieldUsed, true);
  G.resolveNight(g, { shot: 'p0' });
  assert.equal(isAlive(g, 'p0'), false);
  assert.equal(g.shotsLeft, 0);

  g = fresh();
  G.resolveNight(g, { shot: 'p1', badSave: 'p1' });
  assert.equal(isAlive(g, 'p1'), true);
  assert.equal(g.shotsLeft, 1);

  g = fresh();
  G.resolveNight(g, { shot: 'p7' });
  assert.equal(isAlive(g, 'p7'), true);
  assert.equal(isAlive(g, 'p4'), false);
});

test('gozcu sees baba as good, matador as mafia', () => {
  const g = fresh();
  let r = G.resolveNight(g, { query: 'p0' });
  assert.match(r.privateMsgs[0].text, /İYİ/);
  r = G.resolveNight(g, { query: 'p1' });
  assert.match(r.privateMsgs[0].text, /MAFYA/);
});

test('mafia guess: every guess spends a right', () => {
  let g = fresh();
  G.resolveNight(g, { guess: { target: 'p6', role: 'gozcu' } });
  assert.equal(isAlive(g, 'p6'), false);
  assert.equal(g.guessesLeft, 0);
  assert.ok(!G.nightOptions(g, 'p0').some(o => o.type === 'guess'));
  g = fresh();
  G.resolveNight(g, { guess: { target: 'p7', role: 'doktor' } });
  assert.equal(isAlive(g, 'p7'), true);
  assert.equal(g.guessesLeft, 0);
});

// Fixed roles in SETUPS order (hoisted so fresh() above can use it).
function freshN(n) {
  const g = G.createGame(Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i })));
  G.SETUPS[n].forEach((r, i) => { const p = g.players[i]; p.role = r; p.team = G.ROLES[r].team; p.armor = r === 'pehlivan' ? 2 : r === 'nisanci' ? 1 : 0; });
  g.night = 2;
  return g;
}

test('setups: one mafia per three players, guesses and shots scale', () => {
  for (const n of [9, 12, 16]) {
    const g = G.createGame(Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i })));
    assert.equal(g.players.filter(p => p.team === 'mafia').length, Math.floor(n / 3), `${n} players`);
    assert.equal(g.shotsLeft, Math.floor(n / 3) - 1);
    assert.equal(g.guessesLeft, n === 16 ? 2 : 1);
  }
  const g = freshN(16);
  assert.ok(!G.nightOptions(g, 'p0').find(o => o.type === 'guess').roles.includes('vatandas'));
});

test('sniper shield and pehlivan lives stop mafia kills', () => {
  const g = freshN(12); // p4 nisanci, p10 pehlivan
  G.resolveNight(g, { kill: 'p4' });
  assert.equal(isAlive(g, 'p4'), true);
  G.resolveNight(g, { kill: 'p4' });
  assert.equal(isAlive(g, 'p4'), false);
  G.resolveNight(g, { kill: 'p10' });
  G.resolveNight(g, { kill: 'p10', save: 'p10' }); // doctor save does not cost a life
  G.resolveNight(g, { kill: 'p10' });
  assert.equal(isAlive(g, 'p10'), true);
  G.resolveNight(g, { kill: 'p10' });
  assert.equal(isAlive(g, 'p10'), false);
});

test('speech order starts at a seat, wraps round, skips dead and silenced', () => {
  const g = freshN(12);
  G.byId(g, 'p8').alive = false;
  G.byId(g, 'p1').silenced = true;
  assert.deepStrictEqual(G.speechOrder(g, 7).map(p => p.id), ['p7', 'p9', 'p10', 'p11', 'p0', 'p2', 'p3', 'p4', 'p5', 'p6']);
  assert.equal(G.speechOrder(g, 8)[0].id, 'p9'); // start seat dead → next living player opens
});

test('fedai and terrorist take someone along', () => {
  const g = freshN(16); // p9 terorist, p13 fedai
  assert.equal(G.fedaiStrike(g, 'p13', 'p0'), 'P0');
  assert.equal(isAlive(g, 'p13'), false);
  assert.equal(isAlive(g, 'p0'), false);
  assert.equal(G.fedaiStrike(g, 'p13', 'p1'), null);
  assert.equal(G.terroristRevenge(g, 'p9', 'p5'), null); // only after being voted out
  G.byId(g, 'p9').alive = false;
  assert.equal(G.terroristRevenge(g, 'p9', 'p5'), 'P5');
  assert.equal(isAlive(g, 'p5'), false);
});

test('doctor: self once, max two nights in a row', () => {
  const g = fresh();
  G.resolveNight(g, { save: 'p3' });
  assert.ok(!G.nightOptions(g, 'p3')[0].targets.includes('p3'));
  G.resolveNight(g, { save: 'p5' });
  G.resolveNight(g, { save: 'p5' });
  assert.ok(!G.nightOptions(g, 'p3')[0].targets.includes('p5'));
  G.resolveNight(g, { save: 'p6' });
  assert.ok(G.nightOptions(g, 'p3')[0].targets.includes('p5'));
});

test('revive and gun', () => {
  const g = fresh();
  G.resolveNight(g, { kill: 'p7' });
  const r = G.resolveNight(g, { revive: 'p7', gun: 'p6' });
  assert.equal(isAlive(g, 'p7'), true);
  assert.equal(r.revived.mafia, false);
  assert.equal(G.byId(g, 'p6').hasGun, true);
  assert.deepStrictEqual(G.useGun(g, 'p6', 'p1'), { mafia: true, name: 'P1' });
  assert.equal(isAlive(g, 'p1'), false);
  assert.equal(G.useGun(g, 'p6', 'p2'), null);
});

test('tally ignores self-votes and dead voters; multi-vote allowed', () => {
  const g = fresh();
  const votes = { p0: ['p5', 'p6'], p1: ['p5'], p2: ['p5', 'p2'], p3: ['p5'], p4: ['p5'], p8: ['p6'] };
  const t = G.tally(g, votes, g.players.map(p => p.id));
  assert.deepStrictEqual(t.reached, ['p5']);
  assert.equal(t.count.p6, 2);
  assert.equal(t.count.p2, 0);
});

test('winner', () => {
  const g = fresh();
  ['p3', 'p4', 'p5'].forEach(id => { G.byId(g, id).alive = false; });
  assert.equal(G.winner(g, false), null);
  assert.equal(G.winner(g, true), 'mafia'); // 3 v 3
  const h = fresh();
  ['p0', 'p1', 'p2'].forEach(id => { G.byId(h, id).alive = false; });
  assert.equal(G.winner(h, false), 'city');
});

test('first night has no actions; leader passes to next mafia', () => {
  const g = fresh();
  g.night = 1;
  assert.deepStrictEqual(G.nightOptions(g, 'p0'), []);
  g.night = 2;
  G.byId(g, 'p0').alive = false;
  assert.equal(G.nightOptions(g, 'p1')[0].type, 'kill');
});
