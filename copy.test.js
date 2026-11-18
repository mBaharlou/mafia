// Player-facing copy must call the good team Masum. Internal ids (team: 'city') stay.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const FILES = [
  'public/index.html',
  'public/app.js',
  'public/style.css',
  'public/art.js',
  'public/fx.js',
  'public/sound.js',
  'public/voice.js',
  'server.js',
  'game.js',
  'palette.html',
];

// Fold dotted and dotless capital I so both spellings of the old team name match.
function fold(s) {
  return s.replace(/İ/g, 'i').replace(/I/g, 'i').toLocaleLowerCase('tr');
}

test('player-visible copy says Masum, not the old city name', () => {
  const banned = 'şehr';
  const chunks = FILES.map(file => {
    const text = fs.readFileSync(path.join(__dirname, file), 'utf8');
    const folded = fold(text);
    const at = folded.indexOf(banned);
    assert.equal(at, -1, `${file} still shows the old team name near: ${JSON.stringify(text.slice(Math.max(0, at - 24), at + 28))}`);
    return text;
  });
  const all = chunks.join('\n');
  for (const phrase of [
    'Masumlar Uyurken',
    'Masumlar uyurken kimseye güvenme.',
    '3 mafya · 6 masum',
    '😇 Masum takımı',
    'MASUM',
    'MASUMLAR KAZANDI',
    'masumlardan birinin',
    'masumlar seninle kazanır',
    'Masumlar kazandı! 🎉',
    'Masumlar düştü.',
    'Masumlar uyuyor',
    'Masumlar uyanıyor',
  ]) {
    assert.ok(all.includes(phrase), 'missing phrase: ' + phrase);
  }
});
