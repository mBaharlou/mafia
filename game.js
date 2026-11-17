// Pure game rules: roles, night resolution, voting. No sockets or timers here (see server.js).

const ROLES = {
  baba:       { team: 'mafia', name: 'Baba',           icon: '🎩', desc: 'Her gece kimin öleceğini sen seçersin. Bir kez Keskin Nişancı\'nın kurşunundan kurtulursun. Gözcü seni iyi görür.' },
  matador:    { team: 'mafia', name: 'Matador',        icon: '🎭', desc: 'Her gece şehirden birinin yeteneğini o gece için kapatırsın. Aynı kişiyi üst üste iki gece seçemezsin.' },
  kotudoktor: { team: 'mafia', name: 'Kötü Doktor',    icon: '💉', desc: 'Her gece bir mafyayı (kendin dahil) Keskin Nişancı\'ya karşı korursun.' },
  doktor:     { team: 'city',  name: 'Doktor',         icon: '🩺', desc: 'Her gece birini mafyadan korursun. Kendini sadece bir kez koruyabilirsin. Aynı kişiyi en fazla iki gece üst üste korursun.' },
  nisanci:    { team: 'city',  name: 'Keskin Nişancı', icon: '🎯', desc: 'Gece bir kişiyi vurabilirsin (gecede en fazla 1). Mafyayı vurursan çıkar; iyi birini vurursan sen çıkarsın.' },
  buyucu:     { team: 'city',  name: 'Büyücü',         icon: '🔮', desc: 'Oyunda bir kez, ölen birini geri getirirsin. Mafyayı getirirsen herkes öğrenir.' },
  gozcu:      { team: 'city',  name: 'Gözcü',          icon: '👁️', desc: 'Her gece birini sorarsın: mafya mı, iyi mi? Baba iyi görünür. Rolünü belli etme!' },
  susturucu:  { team: 'city',  name: 'Susturucu',      icon: '🤐', desc: 'İstersen her gece birini seçersin; ertesi gün konuşamaz (oy verebilir).' },
  silahci:    { team: 'city',  name: 'Silahçı',        icon: '🔫', desc: 'Oyunda bir kez, güvendiğin birine silah verirsin. O kişi gündüz sırası gelince silahı kullanabilir.' },
};

const SETUPS = { 9: ['baba', 'matador', 'kotudoktor', 'doktor', 'nisanci', 'buyucu', 'gozcu', 'susturucu', 'silahci'] };

function shuffle(arr, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// players: [{id, name}] in seat order. Returns a new game.
function createGame(players, rng = Math.random) {
  const roles = shuffle(SETUPS[players.length], rng);
  const mafiaCount = roles.filter(r => ROLES[r].team === 'mafia').length;
  return {
    players: players.map((p, i) => ({ id: p.id, name: p.name, seat: i, role: roles[i], team: ROLES[roles[i]].team, alive: true, silenced: false, hasGun: false })),
    night: 0,
    shieldUsed: false,
    shotsLeft: mafiaCount - 1,
    doctorSelfUsed: false,
    doctorHistory: [],
    matadorLast: null,
    reviveUsed: false,
    gunGiven: false,
    gunUsed: false,
    guessAvailable: true,
    deadSeen: false,
  };
}

const byId = (g, id) => g.players.find(p => p.id === id);
const alive = g => g.players.filter(p => p.alive);
const roleHolder = (g, role) => g.players.find(p => p.role === role && p.alive);
const needed = aliveCount => Math.ceil(aliveCount / 2);

// The mafia member who picks the kill: Baba, or the next living mafia by seat.
function mafiaLeader(g) {
  return roleHolder(g, 'baba') || alive(g).find(p => p.team === 'mafia');
}

const CITY_ROLES = Object.keys(ROLES).filter(r => ROLES[r].team === 'city');

// Night actions this player may take, with allowed targets. Empty on the first night.
function nightOptions(g, playerId) {
  const me = byId(g, playerId);
  if (!me || !me.alive || g.night <= 1) return [];
  const others = alive(g).filter(p => p.id !== me.id);
  const nonMafia = alive(g).filter(p => p.team !== 'mafia');
  const ids = list => list.map(p => p.id);
  const opts = [];
  if (mafiaLeader(g)?.id === me.id) {
    opts.push({ type: 'kill', label: 'Bu gece kim ölsün?', targets: ids(nonMafia) });
    if (g.guessAvailable) opts.push({ type: 'guess', label: 'Rol tahmini (doğruysa o kişi de çıkar, yanlışsa hak biter)', targets: ids(nonMafia), roles: CITY_ROLES });
  }
  switch (me.role) {
    case 'matador': opts.push({ type: 'block', label: 'Kimin yeteneğini kapatıyorsun?', targets: ids(nonMafia.filter(p => p.id !== g.matadorLast)) }); break;
    case 'kotudoktor': opts.push({ type: 'badSave', label: 'Hangi mafyayı koruyorsun?', targets: ids(alive(g).filter(p => p.team === 'mafia')) }); break;
    case 'doktor': {
      const [a, b] = g.doctorHistory.slice(-2);
      const banned = a && a === b ? a : null;
      opts.push({ type: 'save', label: 'Bu gece kimi koruyorsun?', targets: ids(alive(g).filter(p => p.id !== banned && !(p.id === me.id && g.doctorSelfUsed))) });
      break;
    }
    case 'nisanci': if (g.shotsLeft > 0) opts.push({ type: 'shot', label: `Kimi vuruyorsun? (${g.shotsLeft} kurşun kaldı)`, targets: ids(others) }); break;
    case 'buyucu': {
      const dead = g.players.filter(p => !p.alive);
      if (!g.reviveUsed && dead.length) opts.push({ type: 'revive', label: 'Kimi geri getiriyorsun? (bir kez)', targets: ids(dead) });
      break;
    }
    case 'gozcu': opts.push({ type: 'query', label: 'Kimi soruyorsun?', targets: ids(others) }); break;
    case 'susturucu': opts.push({ type: 'silence', label: 'Yarın kim sussun?', targets: ids(others) }); break;
    case 'silahci': if (!g.gunGiven) opts.push({ type: 'gun', label: 'Silahı kime veriyorsun? (bir kez)', targets: ids(others) }); break;
  }
  return opts;
}

// Validate one submitted action against nightOptions. Returns the cleaned action or null.
function validAction(g, playerId, type, target, role) {
  const opt = nightOptions(g, playerId).find(o => o.type === type);
  if (!opt) return null;
  if (target === null) return { target: null }; // passing is always allowed
  if (!opt.targets.includes(target)) return null;
  if (type === 'guess' && !CITY_ROLES.includes(role)) return null;
  return type === 'guess' ? { target, role } : { target };
}

// actions: { kill, guess:{target,role}, block, badSave, save, shot, revive, query, silence, gun } (player ids or null)
// Mutates g. Returns { died: [ids], revived: {id, mafia} | null, privateMsgs: [{to, text}] }.
function resolveNight(g, actions) {
  const a = actions;
  const msgs = [];
  const name = id => byId(g, id).name;
  const blockedId = a.block || null;
  const actorBlocked = role => {
    const p = roleHolder(g, role);
    return !p || p.id === blockedId;
  };
  g.players.forEach(p => { p.silenced = false; });
  g.matadorLast = blockedId;
  if (blockedId) msgs.push({ to: blockedId, text: 'Matador bu gece yeteneğini kapattı.' });

  const save = actorBlocked('doktor') ? null : a.save || null;
  g.doctorHistory.push(save);
  if (save && save === roleHolder(g, 'doktor')?.id) g.doctorSelfUsed = true;
  const badSave = a.badSave || null;

  const died = new Set();
  if (a.kill && a.kill !== save) died.add(a.kill);

  const sniper = roleHolder(g, 'nisanci');
  if (a.shot && !actorBlocked('nisanci') && g.shotsLeft > 0) {
    g.shotsLeft--;
    const t = byId(g, a.shot);
    if (t.team === 'city') died.add(sniper.id);
    else if (t.id === badSave) { /* protected by Kötü Doktor */ }
    else if (t.role === 'baba' && !g.shieldUsed) g.shieldUsed = true;
    else died.add(t.id);
  }

  if (a.guess?.target && g.guessAvailable) {
    if (byId(g, a.guess.target).role === a.guess.role) died.add(a.guess.target);
    else g.guessAvailable = false;
  }

  let revived = null;
  if (a.revive && !actorBlocked('buyucu') && !g.reviveUsed && !byId(g, a.revive).alive) {
    g.reviveUsed = true;
    revived = { id: a.revive, mafia: byId(g, a.revive).team === 'mafia' };
  }

  const gozcu = roleHolder(g, 'gozcu');
  if (a.query && !actorBlocked('gozcu')) {
    const t = byId(g, a.query);
    const mafia = t.team === 'mafia' && t.role !== 'baba';
    msgs.push({ to: gozcu.id, text: `${t.name}: ${mafia ? '👍 MAFYA' : '👎 İYİ görünüyor'}` });
  }

  if (a.silence && !actorBlocked('susturucu')) byId(g, a.silence).silenced = true;

  if (a.gun && !actorBlocked('silahci') && !g.gunGiven) {
    g.gunGiven = true;
    byId(g, a.gun).hasGun = true;
    msgs.push({ to: a.gun, text: 'Silahçı sana bir silah verdi! Gündüz konuşma sıran gelince kullanabilirsin.' });
  }

  died.forEach(id => { byId(g, id).alive = false; });
  if (revived) byId(g, revived.id).alive = true;
  if (died.size) g.deadSeen = true;
  return { died: [...died], revived, privateMsgs: msgs, deadNames: [...died].map(name) };
}

// votes: Map/obj voterId -> array of target ids. Returns ids that reached the needed count.
function tally(g, votes, candidates) {
  const count = Object.fromEntries(candidates.map(id => [id, 0]));
  for (const [voter, targets] of Object.entries(votes)) {
    if (!byId(g, voter)?.alive) continue;
    for (const t of new Set(targets)) if (t in count && t !== voter) count[t]++;
  }
  const need = needed(alive(g).length);
  return { count, need, reached: candidates.filter(id => count[id] >= need) };
}

// Gun shot during the day. Returns { mafia, name }.
function useGun(g, shooterId, targetId) {
  const shooter = byId(g, shooterId), t = byId(g, targetId);
  if (!shooter?.alive || !shooter.hasGun || g.gunUsed || !t?.alive || t.id === shooter.id) return null;
  g.gunUsed = true;
  shooter.hasGun = false;
  if (t.team === 'mafia') t.alive = false;
  return { mafia: t.team === 'mafia', name: t.name };
}

// 'city' | 'mafia' | null. Mafia parity only counts as night falls.
function winner(g, nightFalling) {
  const m = alive(g).filter(p => p.team === 'mafia').length;
  const c = alive(g).length - m;
  if (m === 0) return 'city';
  if (nightFalling && m >= c) return 'mafia';
  return null;
}

function deadCounts(g) {
  const dead = g.players.filter(p => !p.alive);
  return { city: dead.filter(p => p.team === 'city').length, mafia: dead.filter(p => p.team === 'mafia').length };
}

module.exports = { ROLES, SETUPS, createGame, nightOptions, validAction, resolveNight, tally, useGun, winner, needed, mafiaLeader, deadCounts, byId, alive, shuffle };
