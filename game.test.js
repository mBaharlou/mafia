const test = require('node:test');
const assert = require('node:assert');
const G = require('./game');

// Fixed seating: p0 baba, p1 matador, p2 kotudoktor, p3 doktor, p4 nisanci, p5 buyucu, p6 gozcu, p7 susturucu, p8 silahci
function fresh() {
  const g = G.createGame(Array.from({ length: 9 }, (_, i) => ({ id: 'p' + i, name: 'P' + i })));
  G.SETUPS[9].forEach((r, i) => { g.players[i].role = r; g.players[i].team = G.ROLES[r].team; });
  g.night = 2;
  return g;
}
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

test('sniper: shield, bad doctor, wrong target', () => {
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

test('mafia guess: right kills, wrong loses the right', () => {
  const g = fresh();
  G.resolveNight(g, { guess: { target: 'p6', role: 'gozcu' } });
  assert.equal(isAlive(g, 'p6'), false);
  assert.equal(g.guessAvailable, true);
  G.resolveNight(g, { guess: { target: 'p7', role: 'doktor' } });
  assert.equal(isAlive(g, 'p7'), true);
  assert.equal(g.guessAvailable, false);
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
