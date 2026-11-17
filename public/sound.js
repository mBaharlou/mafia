// Sound design, synthesized with Web Audio (no audio files): ambient rain + drone, and stings for game moments.
// Music ducks while someone speaks so voice chat stays clear.
const SFX = (() => {
  let ctx = null, master, music, fx, rainGain, padGain, padFilter;
  const saved = JSON.parse(localStorage.getItem('mafya-sound') || '{"on":true,"music":0.5,"fx":0.8}');
  const settings = { ...saved };
  let duck = 1, mode = 'night';

  function start() {
    if (ctx) return ctx.resume();
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.connect(ctx.destination);
    music = ctx.createGain(); music.connect(master);
    fx = ctx.createGain(); fx.connect(master);

    // rain: looping filtered noise
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200;
    rainGain = ctx.createGain(); rainGain.gain.value = 0;
    noise.connect(hp).connect(lp).connect(rainGain).connect(music); noise.start();

    // drone: detuned low voices through a slowly breathing filter
    padFilter = ctx.createBiquadFilter(); padFilter.type = 'lowpass'; padFilter.frequency.value = 380; padFilter.Q.value = 4;
    padGain = ctx.createGain(); padGain.gain.value = 0;
    padFilter.connect(padGain).connect(music);
    for (const [f, type, det] of [[55, 'sawtooth', -6], [55, 'sawtooth', 7], [82.4, 'triangle', 0], [110, 'sine', 3]]) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = det;
      const g = ctx.createGain(); g.gain.value = type === 'sawtooth' ? .18 : .3;
      o.connect(g).connect(padFilter); o.start();
    }
    const lfo = ctx.createOscillator(), lfoAmt = ctx.createGain();
    lfo.frequency.value = .07; lfoAmt.gain.value = 160;
    lfo.connect(lfoAmt).connect(padFilter.frequency); lfo.start();
    apply();
  }

  function apply() {
    if (!ctx) return;
    const t = ctx.currentTime;
    master.gain.setTargetAtTime(settings.on ? 1 : 0, t, .1);
    music.gain.setTargetAtTime(settings.music * duck, t, .4);
    fx.gain.setTargetAtTime(settings.fx, t, .1);
    rainGain.gain.setTargetAtTime(mode === 'night' ? .07 : .015, t, 1.5);
    padGain.gain.setTargetAtTime(mode === 'night' ? .22 : .12, t, 1.5);
    padFilter.frequency.setTargetAtTime(mode === 'night' ? 380 : 700, t, 2);
    localStorage.setItem('mafya-sound', JSON.stringify(settings));
  }

  // one enveloped tone
  function tone(freq, { type = 'sine', at = 0, dur = 1, vol = .3, attack = .01, glide } = {}) {
    if (!ctx) return;
    const t = ctx.currentTime + at, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g).connect(fx); o.start(t); o.stop(t + dur + .05);
  }
  function burst({ at = 0, dur = .3, vol = .5, freq = 1200 } = {}) {
    if (!ctx) return;
    const t = ctx.currentTime + at, n = ctx.sampleRate * dur, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = b; f.type = 'lowpass'; f.frequency.value = freq; g.gain.value = vol;
    s.connect(f).connect(g).connect(fx); s.start(t);
  }

  const play = {
    click: () => tone(880, { dur: .08, vol: .08, type: 'triangle' }),
    night: () => { tone(98, { dur: 3.5, vol: .35 }); tone(147, { dur: 3, vol: .18, at: .05 }); tone(196, { dur: 2.5, vol: .1, at: .1 }); burst({ dur: 1.4, vol: .12, freq: 600 }); },
    morning: () => [523.3, 659.3, 784, 1046.5].forEach((f, i) => tone(f, { at: i * .12, dur: 1.6, vol: .12, type: 'triangle' })),
    vote: () => { tone(160, { glide: 45, dur: .5, vol: .6 }); burst({ dur: .15, vol: .25, freq: 3000 }); tone(160, { glide: 45, dur: .5, vol: .45, at: .35 }); },
    death: () => { burst({ dur: .5, vol: .9, freq: 2400 }); tone(90, { glide: 30, dur: .7, vol: .6 }); },
    reveal: () => [784, 988, 1175, 1568].forEach((f, i) => tone(f, { at: i * .09, dur: 1.2, vol: .08 })),
    tick: () => tone(1400, { dur: .05, vol: .06, type: 'square' }),
    win: () => [261.6, 329.6, 392, 523.3].forEach((f, i) => tone(f, { at: i * .15, dur: 2.5, vol: .12, type: 'triangle', attack: .2 })),
    lose: () => [220, 207.7, 196, 146.8].forEach((f, i) => tone(f, { at: i * .3, dur: 1.8, vol: .14, type: 'sawtooth', attack: .1 })),
  };

  return {
    start, play, settings,
    set(k, v) { settings[k] = v; apply(); },
    mode(m) { if (m !== mode) { mode = m; apply(); } },
    duck(on) { const d = on ? .25 : 1; if (d !== duck) { duck = d; apply(); } },
  };
})();
