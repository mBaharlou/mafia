// Hand-made SVG art: player portraits and the city skyline.

const ART = {};

// Player portrait: a silhouette bust whose hat and colours come from the player id.
const PORTRAIT_COLORS = [['#7B5EA7', '#3B2A5A'], ['#C2185B', '#5E0B2C'], ['#00897B', '#00403A'], ['#5D7FDB', '#253A73'], ['#E67E22', '#6B3A0E'], ['#6D8B3A', '#33421A'], ['#AD5A4A', '#4F2620'], ['#3F8FA6', '#1B4350'], ['#B0478F', '#521F42'], ['#8E6C3A', '#41311A']];
function hashOf(s) { return [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7); }

ART.tint = id => PORTRAIT_COLORS[hashOf(String(id)) % PORTRAIT_COLORS.length][1];

ART.portrait = id => {
  const h = hashOf(id);
  const [c1, c2] = PORTRAIT_COLORS[h % PORTRAIT_COLORS.length];
  const hat = h % 4; // 0 fedora, 1 none, 2 flat cap, 3 none
  const hats = [
    '<ellipse cx="50" cy="35" rx="27" ry="5" fill="#0D0F14"/><path d="M33 35 C32 20 39 13 50 13 C61 13 68 20 67 35 Z" fill="#0D0F14"/><rect x="33" y="29" width="34" height="4" fill="' + c1 + '" opacity=".7"/>',
    '<path d="M34 38 C34 22 44 18 50 18 C58 18 66 22 66 36 C60 30 44 28 34 38 Z" fill="#0D0F14"/>',
    '<path d="M31 34 C31 22 40 17 52 17 C63 17 69 24 69 32 L74 35 C60 36 44 36 31 34 Z" fill="#0D0F14"/>',
    '<path d="M35 34 C36 24 42 20 50 20 C58 20 64 24 65 34 C58 27 42 27 35 34 Z" fill="#0D0F14"/>',
  ];
  return `<svg viewBox="0 0 100 100" aria-hidden="true">
    <defs><radialGradient id="pg${h}" cx="50%" cy="35%" r="75%"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></radialGradient></defs>
    <rect width="100" height="100" fill="url(#pg${h})"/>
    <path d="M14 100 C16 76 30 66 50 64 C70 66 84 76 86 100 Z" fill="#0D0F14"/>
    <path d="M42 66 L50 82 L58 66" fill="${c2}" opacity=".9"/>
    <ellipse cx="50" cy="44" rx="16" ry="19" fill="#0D0F14"/>
    ${hats[hat]}
  </svg>`;
};

// City skyline with randomly lit windows.
ART.skyline = (seed = 3) => {
  let s = seed;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  let x = 0, out = '';
  while (x < 1600) {
    const w = 40 + rnd() * 90, h = 90 + rnd() * 260, y = 420 - h;
    out += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#07090D"/>`;
    if (rnd() < .3) out += `<rect x="${x + w / 2 - 2}" y="${y - 30}" width="4" height="30" fill="#07090D"/>`;
    for (let wy = y + 14; wy < 410; wy += 18)
      for (let wx = x + 8; wx < x + w - 10; wx += 14)
        if (rnd() < .16) out += `<rect class="win" x="${wx}" y="${wy}" width="6" height="9" fill="#F2B544" opacity="${(.35 + rnd() * .6).toFixed(2)}"/>`;
    x += w + 4;
  }
  return `<svg class="skyline" viewBox="0 0 1600 420" preserveAspectRatio="xMidYMax slice" aria-hidden="true">${out}</svg>`;
};
