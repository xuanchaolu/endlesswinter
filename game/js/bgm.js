/* ============================================================
 * 《炉火与长夜》 —— 无尽冬日 BGM（WebAudio 程序化作曲）
 * A 小调 · 和声进行 Am → F → C → G
 * 层次：暖垫(pad) + 五声琵琶式琶音 + 风声 + 稀疏铃铛旋律
 * 全程离线合成，无任何音频文件
 * ============================================================ */
(function () {
  'use strict';
  let ctx = null, master = null, started = false, muted = false;
  let padGain = null, windGain = null, windFilter = null, delayNode = null;
  let chordTimer = null, arpTimer = null, bellTimer = null;
  let chordIdx = 0;

  const N = { A2: 110.0, C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.0,
              A3: 220.0, C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0,
              A4: 440.0, C5: 523.25, D5: 587.33, E5: 659.25 };
  /* 和弦（根音、三音、五音、八度） */
  const PROG = [
    [N.A2, N.C4, N.E4, N.A3],   // Am
    [N.F3, N.A3, N.C4, N.F3 * 2], // F
    [N.C3, N.E4 - 12 + 12, N.G4 - 24 + 12, N.C4], // C (C3 E4? 归一化见下)
    [N.G3, N.D4, N.G4 - 12 + 12, N.D4], // G
  ];
  PROG[2] = [130.81, 164.81, 196.0, 261.63];   // C3 E3 G3 C4
  PROG[3] = [98.0, 146.83, 196.0, 293.66];     // G2 D3 G3 D4
  /* A 小调五声音阶（琶音用） */
  const PENTA = [N.A3, N.C4, N.D4, N.E4, N.G4, N.A4, N.C5, N.D5, N.E5];

  function ensureCtx() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.16;
    master.connect(ctx.destination);

    /* 简易回声（山谷感） */
    delayNode = ctx.createDelay(1.2);
    delayNode.delayTime.value = 0.42;
    const fb = ctx.createGain(); fb.gain.value = 0.34;
    const wet = ctx.createGain(); wet.gain.value = 0.35;
    delayNode.connect(fb); fb.connect(delayNode);
    delayNode.connect(wet); wet.connect(master);

    /* 风声：循环白噪声 → 低通 */
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 320;
    windFilter.Q.value = 0.6;
    windGain = ctx.createGain();
    windGain.gain.value = 0.05;
    src.connect(windFilter); windFilter.connect(windGain); windGain.connect(master);
    src.start();
    /* 风的缓慢呼吸 */
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.02;
    lfo.connect(lfoG); lfoG.connect(windGain.gain);
    lfo.start();
  }

  function playPad(freqs, dur) {
    freqs.forEach((f, i) => {
      const o1 = ctx.createOscillator(); o1.type = 'triangle'; o1.frequency.value = f; o1.detune.value = -5;
      const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f; o2.detune.value = +6;
      const g = ctx.createGain();
      const t = ctx.currentTime + i * 0.14;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05, t + 1.8);
      g.gain.setValueAtTime(0.05, t + dur - 2.2);
      g.gain.linearRampToValueAtTime(0, t + dur);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      o1.connect(lp); o2.connect(lp); lp.connect(g);
      g.connect(master); g.connect(delayNode);
      o1.start(t); o2.start(t);
      o1.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
    });
  }

  function pluck(freq, vel) {
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine'; o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.15);
    o.connect(g); g.connect(master); g.connect(delayNode);
    o.start(t); o.stop(t + 1.2);
  }

  function bell(freq) {
    const t = ctx.currentTime;
    [1, 2.76].forEach((mult, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = freq * mult;
      const g = ctx.createGain();
      const v = i ? 0.02 : 0.07;
      g.gain.setValueAtTime(v, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
      o.connect(g); g.connect(master); g.connect(delayNode);
      o.start(t); o.stop(t + 2.7);
    });
  }

  function scheduleChords() {
    playPad(PROG[chordIdx % PROG.length], 8.4);
    chordIdx++;
    chordTimer = setTimeout(scheduleChords, 8000);
  }
  function scheduleArp() {
    const ch = PROG[(chordIdx + PROG.length - 1) % PROG.length];
    if (Math.random() < 0.82) {
      /* 琶音在和弦音与五声装饰音之间游走 */
      const pool = Math.random() < 0.68 ? ch.slice(1).map(f => f * 2) : PENTA;
      pluck(pool[Math.floor(Math.random() * pool.length)], 0.05 + Math.random() * 0.03);
    }
    arpTimer = setTimeout(scheduleArp, 560 + Math.random() * 240);
  }
  function scheduleBell() {
    if (Math.random() < 0.75) bell(PENTA[4 + Math.floor(Math.random() * 5)]);
    bellTimer = setTimeout(scheduleBell, 3400 + Math.random() * 4200);
  }

  window.BGM = {
    start() {
      ensureCtx();
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();
      if (started) return;
      started = true;
      scheduleChords(); scheduleArp(); scheduleBell();
    },
    setMuted(m) {
      muted = m;
      if (!ctx) { if (!m) this.start(); return; }
      master.gain.linearRampToValueAtTime(m ? 0 : 0.16, ctx.currentTime + 0.4);
      if (!m && ctx.state === 'suspended') ctx.resume();
    },
    /* 暴风雪联动：风声增强、变亮 */
    setStorm(x) {
      if (!ctx || !windGain) return;
      windGain.gain.linearRampToValueAtTime(0.05 + x * 0.11, ctx.currentTime + 1.5);
      windFilter.frequency.linearRampToValueAtTime(320 + x * 520, ctx.currentTime + 1.5);
    },
  };
})();
