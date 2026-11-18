// 엔진·바람·실속 경고음은 브라우저에서 바로 합성하고, 관제 무전은 브라우저 음성(영어)으로 읽는다.
export class SimAudio {
  constructor() {
    this.ctx = null;
    this.on = true;
    this.voice = true;
    this.queue = [];
    this.speaking = false;
  }
  start() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    const master = (this.master = ctx.createGain());
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = noiseBuf;
    // 엔진: 낮은 톱니파 2개 + 걸러낸 잡음
    this.eGain = ctx.createGain(); this.eGain.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    this.o1 = ctx.createOscillator(); this.o1.type = 'sawtooth';
    this.o2 = ctx.createOscillator(); this.o2.type = 'square';
    const g2 = ctx.createGain(); g2.gain.value = 0.35;
    this.o1.connect(lp); this.o2.connect(g2).connect(lp);
    const en = ctx.createBufferSource(); en.buffer = noiseBuf; en.loop = true;
    const enf = ctx.createBiquadFilter(); enf.type = 'bandpass'; enf.frequency.value = 220; enf.Q.value = 0.8;
    const eng = ctx.createGain(); eng.gain.value = 0.5;
    en.connect(enf).connect(eng).connect(lp);
    this.enf = enf;
    lp.connect(this.eGain).connect(master);
    this.o1.start(); this.o2.start(); en.start();
    // 바람
    const wn = ctx.createBufferSource(); wn.buffer = noiseBuf; wn.loop = true;
    this.wf = ctx.createBiquadFilter(); this.wf.type = 'bandpass'; this.wf.frequency.value = 600; this.wf.Q.value = 0.5;
    this.wGain = ctx.createGain(); this.wGain.gain.value = 0;
    wn.connect(this.wf).connect(this.wGain).connect(master); wn.start();
    // 실속 경고음
    this.so = ctx.createOscillator(); this.so.type = 'square'; this.so.frequency.value = 1650;
    const sf = ctx.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 2400;
    this.sGain = ctx.createGain(); this.sGain.gain.value = 0;
    this.so.connect(sf).connect(this.sGain).connect(master); this.so.start();
  }
  update({ rpm, ias, stall, onGround, gs }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, on = this.on ? 1 : 0;
    const f = Math.max(18, (rpm / 60) * 2);
    this.o1.frequency.setTargetAtTime(f, t, 0.08);
    this.o2.frequency.setTargetAtTime(f * 0.5, t, 0.08);
    this.enf.frequency.setTargetAtTime(150 + rpm * 0.12, t, 0.1);
    this.eGain.gain.setTargetAtTime(on * (rpm > 100 ? 0.05 + (rpm / 2700) * 0.16 : 0), t, 0.1);
    this.wf.frequency.setTargetAtTime(300 + ias * 12, t, 0.2);
    this.wGain.gain.setTargetAtTime(on * Math.min(0.22, (ias / 120) ** 2 * 0.22 + (onGround ? gs * 0.002 : 0)), t, 0.2);
    this.sGain.gain.setTargetAtTime(on * (stall ? 0.12 : 0), t, 0.03);
  }
  thump(kind = 'touch') {
    if (!this.ctx || !this.on) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = kind === 'crash' ? 120 : 1800; f.Q.value = kind === 'crash' ? 0.5 : 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(kind === 'crash' ? 0.9 : 0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (kind === 'crash' ? 1.2 : 0.25));
    src.connect(f).connect(g).connect(this.master);
    src.start(t); src.stop(t + 1.3);
  }
  speak(lines) {
    if (!this.voice || !('speechSynthesis' in window)) return;
    for (const l of lines) this.queue.push(l);
    this.next();
  }
  next() {
    if (this.speaking || !this.queue.length) return;
    const l = this.queue.shift();
    const u = new SpeechSynthesisUtterance(l.en);
    const voices = speechSynthesis.getVoices().filter((v) => v.lang && v.lang.startsWith('en'));
    const pick = l.who === 'tower' ? voices.find((v) => /US|United States/i.test(v.name + v.lang)) : voices.find((v) => /GB|UK|Australia/i.test(v.name + v.lang));
    if (pick || voices[0]) u.voice = pick || voices[0];
    u.lang = 'en-US';
    u.rate = l.who === 'tower' ? 1.12 : 1.05;
    u.pitch = l.who === 'tower' ? 0.9 : 1.05;
    this.speaking = true;
    u.onend = u.onerror = () => { this.speaking = false; setTimeout(() => this.next(), 350); };
    speechSynthesis.speak(u);
  }
  stopVoice() {
    this.queue = [];
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    this.speaking = false;
  }
}
