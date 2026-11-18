// Name flag skin. Live text only. Unknown, paid, or failing-AA skins fall back to standart.
(function () {
  function passesAA(skin) {
    if (!skin || skin.passes_aa !== true) return false;
    const c = skin.contrast || {};
    return ['normal', 'speaking', 'dead', 'you'].every(k => typeof c[k] === 'number' && c[k] >= 4.5);
  }

  function makeFlag(skinId, o) {
    const skins = window.FLAG_SKINS || {};
    let s = skins[skinId];
    if (!s || s.tier !== 'free' || !passesAA(s)) s = skins.standart;
    const el = document.createElement('div');
    el.className = 'flag' + (o.you ? ' you' : '');
    if (!s) return el;
    el.dataset.skin = s.id;
    el.dataset.edge = s.cloth.edge || 'vnotch';
    if (s.rod.knob && s.rod.knob !== 'none') el.dataset.knob = s.rod.knob;
    const v = {
      '--c1': s.cloth.fill[0], '--c2': s.cloth.fill[1], '--tx': s.text.color,
      '--rod1': s.rod.fill[0], '--rod2': s.rod.fill[1],
      '--pole1': s.pole.fill[0], '--pole2': s.pole.fill[1],
      '--acc': s.cloth.accent_stripe === 'character' ? (o.accent || '#F2B544') : (s.cloth.accent_stripe || 'transparent'),
      '--edgecol': s.cloth.edge_color || 'transparent',
    };
    const st = s.states || {};
    if (st.speaking) {
      v['--sc1'] = st.speaking.cloth[0]; v['--sc2'] = st.speaking.cloth[1]; v['--stx'] = st.speaking.text;
      if (st.speaking.glow) v['--glow'] = st.speaking.glow;
    }
    if (st.dead) { v['--dc1'] = st.dead.cloth[0]; v['--dc2'] = st.dead.cloth[1]; v['--dtx'] = st.dead.text; }
    if (st.you) { v['--ybd'] = st.you.border; v['--ytx'] = st.you.text; v['--tabbg'] = st.you.tab_bg; v['--tabtx'] = st.you.tab_text; }
    const pat = {
      none: 'none',
      velvet: 'radial-gradient(120% 90% at 30% 0%, rgba(255,255,255,.22), rgba(255,255,255,0) 60%)',
      pinstripe: 'repeating-linear-gradient(90deg, rgba(242,181,68,.20) 0 1px, rgba(0,0,0,0) 1px 7px)',
      stars: 'none',
    }[s.cloth.pattern || 'none'];
    v['--pattern'] = pat;
    for (const k in v) el.style.setProperty(k, v[k]);
    el.style.fontSize = o.fs + 'px';
    if (o.pad) el.style.setProperty('--pad', o.pad);
    const knobName = /^[a-z]+$/.test(s.rod.knob || '') && s.rod.knob !== 'none' ? s.rod.knob : '';
    const knob = knobName
      ? `<i class="knob l"><img src="/scene/flags/knobs/${knobName}.svg" alt=""></i><i class="knob r"><img src="/scene/flags/knobs/${knobName}.svg" alt=""></i>`
      : '';
    el.innerHTML = `<span class="meta"></span><div class="pole"></div><div class="rod">${knob}</div><div class="cloth" style="max-width:${o.maxw}px"><span class="tab">${o.phone ? '★' : 'SEN'}</span><svg class="snd" viewBox="0 0 12 10" aria-hidden="true"><rect x="0" y="3" width="2.4" height="4" rx="1"/><rect x="4.5" y="1" width="2.4" height="8" rx="1"/><rect x="9" y="2.5" width="2.4" height="5" rx="1"/></svg><span class="nm"></span></div><div class="fringe"></div>`;
    el.querySelectorAll('.knob img').forEach(img => {
      img.addEventListener('error', () => img.remove());
    });
    const name = o.name || '';
    el.querySelector('.nm').textContent = name;
    el.title = name;
    el.setAttribute('aria-label', name + (o.you ? ', sen' : ''));
    return el;
  }

  window.makeFlag = makeFlag;
  window.flagSkinPassesAA = passesAA;
})();
