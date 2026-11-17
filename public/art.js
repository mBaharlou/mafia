// Hand-made SVG art: the narrator, player portraits and the city skyline.

const ART = {};

// The narrator: a figure in a fedora and long coat, face in shadow, holding a candle.
ART.narrator = `
<svg class="narrator-svg" viewBox="0 0 320 460" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <radialGradient id="nGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#FFC66B" stop-opacity=".75"/>
      <stop offset=".35" stop-color="#F2B544" stop-opacity=".25"/>
      <stop offset="1" stop-color="#F2B544" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="nCoat" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2A2F3B"/><stop offset=".55" stop-color="#171A22"/><stop offset="1" stop-color="#0B0D12"/>
    </linearGradient>
    <linearGradient id="nHat" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2E3340"/><stop offset="1" stop-color="#12151C"/>
    </linearGradient>
    <linearGradient id="nLight" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#FFB44D" stop-opacity=".55"/><stop offset=".6" stop-color="#FFB44D" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="nFlame" cx="50%" cy="70%" r="60%">
      <stop offset="0" stop-color="#FFFBE6"/><stop offset=".45" stop-color="#FFD36B"/><stop offset="1" stop-color="#F07B1A"/>
    </radialGradient>
    <filter id="nBlur"><feGaussianBlur stdDeviation="3"/></filter>
  </defs>

  <!-- coat with broad shoulders -->
  <path id="nBody" d="M30 460 L36 318 C40 280 70 258 112 250 L160 242 L208 250 C250 258 280 280 284 318 L290 460 Z" fill="url(#nCoat)"/>
  <path d="M30 460 L36 318 C40 280 70 258 112 250 L160 242 L208 250 C250 258 280 280 284 318 L290 460 Z" fill="url(#nLight)" opacity=".35"/>
  <path d="M36 318 C40 280 70 258 112 250 M284 318 C280 280 250 258 208 250" stroke="#7FA3D8" stroke-opacity=".25" stroke-width="2" fill="none"/>
  <!-- raised collar + lapels -->
  <path d="M104 214 L160 300 L120 262 L96 300 Z" fill="#1E222C"/>
  <path d="M216 214 L160 300 L200 262 L224 300 Z" fill="#1E222C"/>
  <path d="M160 300 L132 250 L118 214 M160 300 L188 250 L202 214" stroke="#F2B544" stroke-opacity=".18" stroke-width="2" fill="none"/>
  <!-- shirt + tie -->
  <path d="M138 238 L160 300 L182 238 Z" fill="#0E1015"/>
  <path d="M154 246 L166 246 L170 300 L160 316 L150 300 Z" fill="#8E1420"/>
  <!-- head in shadow -->
  <ellipse cx="160" cy="168" rx="48" ry="58" fill="#0A0C10"/>
  <!-- eyes -->
  <g class="n-eyes">
    <ellipse cx="141" cy="168" rx="8" ry="2.6" fill="#F2B544"/>
    <ellipse cx="179" cy="168" rx="8" ry="2.6" fill="#F2B544"/>
    <ellipse cx="141" cy="168" rx="10" ry="4" fill="#F2B544" opacity=".5" filter="url(#nBlur)"/>
    <ellipse cx="179" cy="168" rx="10" ry="4" fill="#F2B544" opacity=".5" filter="url(#nBlur)"/>
  </g>
  <!-- fedora -->
  <path d="M100 128 C98 76 120 50 160 50 C200 50 222 76 220 128 Z" fill="url(#nHat)"/>
  <path d="M132 62 C148 74 172 74 188 62" stroke="#0A0C10" stroke-width="5" fill="none" stroke-linecap="round"/>
  <rect x="101" y="108" width="118" height="17" fill="#0B0D12"/>
  <rect x="101" y="108" width="118" height="3" fill="#8E1420" opacity=".9"/>
  <ellipse cx="160" cy="130" rx="112" ry="17" fill="#1B1F28"/>
  <ellipse cx="160" cy="127" rx="112" ry="14" fill="url(#nHat)"/>
  <path d="M50 128 C90 118 230 118 270 128" stroke="#F2B544" stroke-opacity=".22" stroke-width="2" fill="none"/>

  <!-- candle glow -->
  <circle class="n-glow" cx="160" cy="320" r="95" fill="url(#nGlow)" opacity=".8"/>
  <!-- gloved hands + candle -->
  <ellipse cx="128" cy="372" rx="24" ry="16" fill="#0C0E13"/>
  <ellipse cx="192" cy="372" rx="24" ry="16" fill="#0C0E13"/>
  <rect x="148" y="326" width="24" height="64" rx="3" fill="#EFE3C8"/>
  <path d="M152 330 C152 340 156 342 156 352" stroke="#D8C9A6" stroke-width="3" fill="none" stroke-linecap="round"/>
  <ellipse cx="160" cy="326" rx="12" ry="3" fill="#D8C9A6"/>
  <line x1="160" y1="326" x2="160" y2="318" stroke="#222" stroke-width="2"/>
  <path class="n-flame" d="M160 280 C170 296 172 306 168 314 C165 320 155 320 152 314 C148 306 150 296 160 280 Z" fill="url(#nFlame)"/>
</svg>`;

// Each copy needs its own gradient ids: a gradient defined inside a hidden screen won't paint.
ART.narratorCopy = key => ART.narrator.replace(/(id="|url\(#)(n[A-Z]\w*)/g, `$1$2${key}`);

// Player portrait: a silhouette bust whose hat and colours come from the player id.
const PORTRAIT_COLORS = [['#7B5EA7', '#3B2A5A'], ['#C2185B', '#5E0B2C'], ['#00897B', '#00403A'], ['#5D7FDB', '#253A73'], ['#E67E22', '#6B3A0E'], ['#6D8B3A', '#33421A'], ['#AD5A4A', '#4F2620'], ['#3F8FA6', '#1B4350'], ['#B0478F', '#521F42'], ['#8E6C3A', '#41311A']];
function hashOf(s) { return [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7); }

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
