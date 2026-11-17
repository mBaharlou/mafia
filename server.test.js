// 9 bots play full games against the real server with sped-up timers.
process.env.TIME_SCALE = '0.01';
const test = require('node:test');
const assert = require('node:assert');
const { io: connect } = require('socket.io-client');
const { server } = require('./server');

const pick = arr => arr[Math.floor(Math.random() * arr.length)];

function playGame(url, size) {
  return new Promise((resolve, reject) => {
    const bots = [];
    const seen = { phases: new Set(), mafiaMates: 0, challenge: false, gun: false, fedai: false };
    const timeout = setTimeout(() => reject(new Error('game did not finish; phases seen: ' + [...seen.phases])), 60000);
    const done = (s) => { clearTimeout(timeout); bots.forEach(b => b.close()); resolve({ s, seen }); };

    const bot = (i, code) => {
      const c = connect(url, { forceNew: true, transports: ['websocket'] });
      bots.push(c);
      c.on('state', s => {
        seen.phases.add(s.phase);
        const me = s.me;
        if (s.phase === 'over') return i === 0 && done(s);
        if (s.phase === 'night' && s.night === 1 && me.team === 'mafia') seen.mafiaMates = Math.max(seen.mafiaMates, s.players.filter(p => p.mate).length);
        if (s.revengeTargets) return c.emit('revenge', { target: pick(s.revengeTargets) });
        if (!me?.alive) return;
        if (s.canFedai && Math.random() < 0.05) { seen.fedai = true; return c.emit('fedai', { target: pick(s.players.filter(p => p.alive && p.id !== s.myId)).id }); }
        if ((s.phase === 'speech' || s.phase === 'defense') && s.speaker.id === s.myId) {
          if (s.challenge?.status === 'pending') return c.emit('challengeAnswer', { accept: true });
          if (s.canShoot) { seen.gun = true; return c.emit('gun', { target: pick(s.players.filter(p => p.alive && p.id !== s.myId)).id }); }
          if (s.challenge?.status !== 'accepted' || s.speaker.kind !== 'speech') return setTimeout(() => c.emit('endSpeech'), 5);
        }
        if (s.canChallenge && Math.random() < 0.3) { seen.challenge = true; c.emit('challengeRequest'); }
        if ((s.phase === 'vote' || s.phase === 'revote') && !s.vote.mine.length) {
          const t = s.vote.candidates.filter(id => id !== s.myId);
          if (t.length) c.emit('vote', { targets: [t[0]] }); // everyone agrees → eliminations happen
        }
        if (s.phase === 'poll' && s.poll.mine === undefined) c.emit('poll', { yes: true });
        if (s.phase === 'night') for (const o of s.options) if (!o.chosen) c.emit('action', { type: o.type, target: pick(o.targets), role: o.roles && pick(o.roles) });
      });
      if (code) c.emit('join', { name: 'Bot' + i, code });
      return c;
    };

    const host = bot(0);
    host.once('joined', ({ code }) => { for (let i = 1; i < size; i++) bot(i, code); });
    host.emit('create', { name: 'Bot0', size });
  });
}

test('bots play full games to the end', async () => {
  await new Promise(r => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  const winners = {}, all = { phases: new Set(), challenge: false, gun: false, fedai: false };
  for (const size of [9, 9, 9, 12, 12, 12, 16, 16, 16, 16]) {
    const { s, seen } = await playGame(url, size);
    winners[s.winner] = (winners[s.winner] || 0) + 1;
    assert.ok(['city', 'mafia'].includes(s.winner));
    assert.equal(seen.mafiaMates, Math.floor(size / 3), 'mafia see each other on night 1');
    assert.ok(s.players.every(p => p.role), 'roles revealed at the end');
    seen.phases.forEach(p => all.phases.add(p));
    all.challenge ||= seen.challenge; all.gun ||= seen.gun; all.fedai ||= seen.fedai;
  }
  console.log('winners', winners, 'phases', [...all.phases].join(','), 'challenge', all.challenge, 'gun', all.gun, 'fedai', all.fedai);
  for (const p of ['starting', 'roles', 'speech', 'night', 'morning', 'vote', 'defense', 'revote', 'announce', 'revenge', 'over']) assert.ok(all.phases.has(p), 'phase seen: ' + p);
  server.close();
  process.exit(0); // room cleanup timers would keep the process alive
});
