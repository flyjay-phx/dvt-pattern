// 기본 6계기 + 엔진·플랩·트림 표시 (2D 캔버스)
const TAU = Math.PI * 2;
const C = { face: '#15181d', ring: '#2a2f37', tick: '#e9e4d8', dim: '#8b8f96', green: '#38b56a', yellow: '#e8c547', red: '#e24b3b', white: '#f2f2ee', sky: '#3f7fc4', ground: '#8a5a33', bug: '#ff9f43' };
const MONO = '"IBM Plex Mono", ui-monospace, monospace';

export class Panel {
  constructor(canvas) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.W = 1080;
    this.H = 190;
    this.resize();
    addEventListener('resize', () => this.resize());
  }
  resize() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.c.width = this.W * dpr;
    this.c.height = this.H * dpr;
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  dial(cx, cy, r, label) {
    const g = this.g;
    g.fillStyle = C.ring;
    g.beginPath(); g.arc(cx, cy, r + 5, 0, TAU); g.fill();
    g.fillStyle = C.face;
    g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
    if (label) {
      g.fillStyle = C.dim;
      g.font = `600 9px ${MONO}`;
      g.textAlign = 'center';
      g.fillText(label, cx, cy + r * 0.42);
    }
  }
  needle(cx, cy, ang, len, w = 3, col = C.white) {
    const g = this.g;
    g.save(); g.translate(cx, cy); g.rotate(ang);
    g.fillStyle = col;
    g.beginPath(); g.moveTo(-w, 6); g.lineTo(0, -len); g.lineTo(w, 6); g.closePath(); g.fill();
    g.restore();
    g.fillStyle = '#444'; g.beginPath(); g.arc(cx, cy, 4, 0, TAU); g.fill();
  }
  ticks(cx, cy, r, a0, a1, n, major, labelFn) {
    const g = this.g;
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n - Math.PI / 2;
      const big = i % major === 0;
      g.strokeStyle = C.tick; g.lineWidth = big ? 2 : 1;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r * (big ? 0.78 : 0.86), cy + Math.sin(a) * r * (big ? 0.78 : 0.86));
      g.lineTo(cx + Math.cos(a) * r * 0.95, cy + Math.sin(a) * r * 0.95);
      g.stroke();
      if (big && labelFn) {
        const t = labelFn(i);
        if (t != null) {
          g.fillStyle = C.tick; g.font = `600 11px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(t, cx + Math.cos(a) * r * 0.62, cy + Math.sin(a) * r * 0.62);
        }
      }
    }
  }
  arc(cx, cy, r, a0, a1, col, w = 5) {
    const g = this.g;
    g.strokeStyle = col; g.lineWidth = w;
    g.beginPath(); g.arc(cx, cy, r, a0 - Math.PI / 2, a1 - Math.PI / 2); g.stroke();
  }
  draw(d, ex) {
    const g = this.g;
    g.clearRect(0, 0, this.W, this.H);
    const r = 70, y = 95;
    const xs = [85, 245, 405, 565, 725, 885];
    // 속도계
    {
      const cx = xs[0], max = 180, A = (kt) => (Math.min(max, Math.max(0, kt)) / max) * TAU * 0.92;
      this.dial(cx, y, r, 'KNOTS');
      this.arc(cx, y, r * 0.93, A(40), A(85), C.white, 4);
      this.arc(cx, y, r * 0.86, A(48), A(129), C.green, 5);
      this.arc(cx, y, r * 0.86, A(129), A(163), C.yellow, 5);
      this.arc(cx, y, r * 0.86, A(163), A(165), C.red, 6);
      this.ticks(cx, y, r, 0, TAU * 0.92, 36, 4, (i) => (i * 5 % 20 === 0 && i ? i * 5 : null));
      this.needle(cx, y, A(d.iasKt), r * 0.8);
      this.digital(cx, y + 26, `${Math.round(d.iasKt)}`);
    }
    // 자세계
    {
      const cx = xs[1];
      g.save();
      g.beginPath(); g.arc(cx, y, r, 0, TAU); g.clip();
      g.translate(cx, y); g.rotate((-d.bank * Math.PI) / 180);
      const off = d.pitch * 2.6;
      g.fillStyle = C.sky; g.fillRect(-200, -200 + off, 400, 200);
      g.fillStyle = C.ground; g.fillRect(-200, off, 400, 200);
      g.strokeStyle = C.white; g.lineWidth = 2;
      g.beginPath(); g.moveTo(-200, off); g.lineTo(200, off); g.stroke();
      g.lineWidth = 1.2; g.font = `600 9px ${MONO}`; g.fillStyle = C.white; g.textAlign = 'left';
      for (let p = -20; p <= 20; p += 5) {
        if (!p) continue;
        const yy = off - p * 2.6, w = p % 10 === 0 ? 22 : 11;
        g.beginPath(); g.moveTo(-w, yy); g.lineTo(w, yy); g.stroke();
        if (p % 10 === 0) g.fillText(Math.abs(p), w + 4, yy + 3);
      }
      g.restore();
      g.strokeStyle = C.ring; g.lineWidth = 6; g.beginPath(); g.arc(cx, y, r + 2, 0, TAU); g.stroke();
      // 경사 눈금
      for (const b of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
        const a = (b * Math.PI) / 180 - Math.PI / 2;
        g.strokeStyle = C.white; g.lineWidth = b % 30 === 0 ? 2.5 : 1.2;
        g.beginPath(); g.moveTo(cx + Math.cos(a) * r * 0.85, y + Math.sin(a) * r * 0.85); g.lineTo(cx + Math.cos(a) * r * 0.98, y + Math.sin(a) * r * 0.98); g.stroke();
      }
      g.save(); g.translate(cx, y); g.rotate((-d.bank * Math.PI) / 180);
      g.fillStyle = C.bug; g.beginPath(); g.moveTo(0, -r * 0.84); g.lineTo(-5, -r * 0.74); g.lineTo(5, -r * 0.74); g.fill();
      g.restore();
      g.strokeStyle = C.bug; g.lineWidth = 3.5;
      g.beginPath(); g.moveTo(cx - 34, y); g.lineTo(cx - 12, y); g.lineTo(cx - 6, y + 7); g.moveTo(cx + 34, y); g.lineTo(cx + 12, y); g.lineTo(cx + 6, y + 7); g.stroke();
      g.fillStyle = C.bug; g.beginPath(); g.arc(cx, y, 3, 0, TAU); g.fill();
    }
    // 고도계
    {
      const cx = xs[2];
      this.dial(cx, y, r, 'ALT');
      this.ticks(cx, y, r, 0, TAU, 50, 5, (i) => (i < 50 ? i / 5 : null));
      const alt = Math.max(0, d.altFt);
      this.needle(cx, y, ((alt % 10000) / 10000) * TAU, r * 0.48, 4.5, C.tick);
      this.needle(cx, y, ((alt % 1000) / 1000) * TAU, r * 0.82, 2.5);
      this.digital(cx, y + 22, `${Math.round(alt).toLocaleString('en-US')}`);
      g.fillStyle = C.dim; g.font = `9px ${MONO}`; g.textAlign = 'center';
      g.fillText(`${ex.altim.toFixed(2)}`, cx, y - 20);
    }
    // 선회계
    {
      const cx = xs[3];
      this.dial(cx, y, r, '2 MIN');
      g.save(); g.translate(cx, y - 6); g.rotate(Math.max(-0.7, Math.min(0.7, (d.turnRate / 3) * 0.35)));
      g.strokeStyle = C.white; g.lineWidth = 4;
      g.beginPath(); g.moveTo(-40, 0); g.lineTo(40, 0); g.moveTo(0, -10); g.lineTo(0, 0); g.moveTo(-10, 12); g.lineTo(10, 12); g.stroke();
      g.restore();
      for (const s of [-1, 1]) {
        g.strokeStyle = C.white; g.lineWidth = 2;
        const a = s * 0.35;
        g.beginPath(); g.moveTo(cx + Math.cos(a) * 46 * s, y - 6 + Math.sin(a) * 46 * s); g.lineTo(cx + Math.cos(a) * 58 * s, y - 6 + Math.sin(a) * 58 * s); g.stroke();
      }
      g.fillStyle = '#0c0d10'; g.beginPath(); g.roundRect(cx - 34, y + 30, 68, 14, 7); g.fill();
      g.strokeStyle = C.dim; g.lineWidth = 1;
      g.beginPath(); g.moveTo(cx - 7, y + 30); g.lineTo(cx - 7, y + 44); g.moveTo(cx + 7, y + 30); g.lineTo(cx + 7, y + 44); g.stroke();
      const ball = Math.max(-1, Math.min(1, -d.beta / 8));
      g.fillStyle = C.white; g.beginPath(); g.arc(cx + ball * 26, y + 37, 6, 0, TAU); g.fill();
    }
    // 방향지시계
    {
      const cx = xs[4];
      this.dial(cx, y, r);
      g.save(); g.translate(cx, y); g.rotate((-d.headingMag * Math.PI) / 180);
      for (let h = 0; h < 360; h += 5) {
        const a = (h * Math.PI) / 180 - Math.PI / 2, big = h % 30 === 0;
        g.strokeStyle = C.tick; g.lineWidth = big ? 2 : 1;
        g.beginPath(); g.moveTo(Math.cos(a) * r * (h % 10 === 0 ? 0.8 : 0.87), Math.sin(a) * r * (h % 10 === 0 ? 0.8 : 0.87)); g.lineTo(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95); g.stroke();
        if (big) {
          g.save(); g.rotate(a + Math.PI / 2);
          g.fillStyle = h % 90 === 0 ? C.bug : C.tick; g.font = `700 ${h % 90 === 0 ? 13 : 11}px ${MONO}`; g.textAlign = 'center';
          g.fillText({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[h] ?? h / 10, 0, -r * 0.62);
          g.restore();
        }
      }
      if (ex.rwyMag != null) {
        g.save(); g.rotate((ex.rwyMag * Math.PI) / 180);
        g.fillStyle = C.bug; g.fillRect(-5, -r * 0.98, 10, 8);
        g.restore();
      }
      g.restore();
      g.fillStyle = C.bug; g.beginPath(); g.moveTo(cx, y - r + 2); g.lineTo(cx - 6, y - r - 6); g.lineTo(cx + 6, y - r - 6); g.fill();
      g.strokeStyle = C.bug; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(cx, y - 18); g.lineTo(cx, y + 18); g.moveTo(cx - 16, y - 2); g.lineTo(cx + 16, y - 2); g.moveTo(cx - 7, y + 14); g.lineTo(cx + 7, y + 14); g.stroke();
      this.digital(cx, y + 30, String(Math.round(d.headingMag) % 360 || 360).padStart(3, '0'));
    }
    // 승강계
    {
      const cx = xs[5], A = (fpm) => Math.PI * 1.5 + (Math.max(-2000, Math.min(2000, fpm)) / 2000) * Math.PI * 0.95;
      this.dial(cx, y, r, 'VERT SPEED');
      for (let v = -2000; v <= 2000; v += 100) {
        const a = A(v) - Math.PI / 2, big = v % 500 === 0;
        g.strokeStyle = C.tick; g.lineWidth = big ? 2 : 1;
        g.beginPath(); g.moveTo(Math.cos(a) * r * (big ? 0.78 : 0.87) + cx, Math.sin(a) * r * (big ? 0.78 : 0.87) + y); g.lineTo(Math.cos(a) * r * 0.95 + cx, Math.sin(a) * r * 0.95 + y); g.stroke();
        if (big && v % 1000 === 0) {
          g.fillStyle = C.tick; g.font = `600 11px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(Math.abs(v / 1000), Math.cos(a) * r * 0.62 + cx, Math.sin(a) * r * 0.62 + y);
        }
      }
      this.needle(cx, y, A(d.vsFpm) - Math.PI / 2 + Math.PI / 2, r * 0.82);
      this.digital(cx, y + 26, `${d.vsFpm >= 0 ? '+' : ''}${Math.round(d.vsFpm / 10) * 10}`);
    }
    // 엔진·플랩·트림
    {
      const x0 = 980;
      g.fillStyle = C.face; g.beginPath(); g.roundRect(x0 - 70, 18, 140, 160, 12); g.fill();
      g.fillStyle = C.dim; g.font = `600 10px ${MONO}`; g.textAlign = 'left';
      g.fillText('RPM', x0 - 58, 38);
      g.fillStyle = d.rpm > 2700 ? C.red : C.white; g.font = `700 22px ${MONO}`;
      g.fillText(String(d.rpm), x0 - 58, 62);
      const bw = 116;
      g.fillStyle = '#2a2f37'; g.fillRect(x0 - 58, 70, bw, 6);
      g.fillStyle = C.green; g.fillRect(x0 - 58 + (2100 / 3000) * bw, 70, (600 / 3000) * bw, 6);
      g.fillStyle = C.white; g.fillRect(x0 - 58 + Math.min(1, d.rpm / 3000) * bw - 1.5, 66, 3, 14);
      g.fillStyle = C.dim; g.font = `600 10px ${MONO}`;
      g.fillText(`THR ${Math.round(ex.throttle * 100)}%`, x0 - 58, 98);
      g.fillText('FLAPS', x0 - 58, 118);
      [0, 10, 20, 30].forEach((f, i) => {
        const on = Math.abs(d.flaps - f) < 5;
        g.fillStyle = on ? C.bug : '#2a2f37';
        g.beginPath(); g.roundRect(x0 - 58 + i * 30, 124, 26, 16, 4); g.fill();
        g.fillStyle = on ? '#111' : C.dim; g.textAlign = 'center';
        g.fillText(f, x0 - 45 + i * 30, 136);
      });
      g.textAlign = 'left'; g.fillStyle = C.dim;
      g.fillText('TRIM', x0 - 58, 160);
      g.fillStyle = '#2a2f37'; g.fillRect(x0 - 20, 154, 70, 5);
      g.fillStyle = C.white; g.fillRect(x0 + 15 + ex.trim * 70 - 2, 150, 4, 13);
      if (ex.brakes) { g.fillStyle = C.red; g.font = `700 10px ${MONO}`; g.fillText('BRAKE', x0 + 10, 38); }
      if (ex.engineFailed) { g.fillStyle = C.red; g.font = `700 10px ${MONO}`; g.fillText('ENG OUT', x0 + 4, 98); }
    }
  }
  digital(cx, cy, text) {
    const g = this.g;
    g.fillStyle = '#0b0c0e';
    g.beginPath(); g.roundRect(cx - 24, cy - 9, 48, 18, 4); g.fill();
    g.fillStyle = '#ffd27a'; g.font = `700 12px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, cx, cy + 1);
    g.textBaseline = 'alphabetic';
  }
}
