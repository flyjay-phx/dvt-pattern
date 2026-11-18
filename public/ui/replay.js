// 리플레이: 위에서 본 패턴 궤적 + 옆에서 본 높이(3° 활공각과 비교)
import { RUNWAYS, runwayFrame, pointOnRunway, FT } from '../sim/airport.js';
import { glidepathAglFt, PATTERN_AGL_FT } from '../sim/pattern.js';

const LEG_COLORS = ['#4dd2ff'];

export function drawReplay(canvas, track, rwyId, idx = track.length - 1) {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const rwy = RUNWAYS[rwyId];
  const topH = Math.round(H * 0.62);
  const side = rwy.traffic === 'right' ? 1 : -1;
  // 활주로 기준 좌표로 바꿔 그리면 착륙 방향이 항상 오른쪽 → 왼쪽이 아니라 아래 → 위가 된다
  const pts = track.map((p) => ({ ...runwayFrame(rwy, p[1], p[3]), alt: p[2], ias: p[4], t: p[0] }));
  const sMin = Math.min(-2200, ...pts.map((p) => p.s)), sMax = Math.max(rwy.len + 1500, ...pts.map((p) => p.s));
  const dMin = Math.min(-600, ...pts.map((p) => p.dPattern)), dMax = Math.max(1800, ...pts.map((p) => p.dPattern));
  const pad = 26;
  const sc = Math.min((W - pad * 2) / (sMax - sMin), (topH - pad * 2) / (dMax - dMin));
  const X = (s) => pad + (s - sMin) * sc;
  const Y = (dp) => pad + (dMax - dp) * sc;
  g.fillStyle = '#10141a'; g.fillRect(0, 0, W, topH);
  // 활주로
  g.fillStyle = '#5a5e64';
  g.fillRect(X(0), Y(rwy.width / 2) , rwy.len * sc, Math.max(3, rwy.width * sc));
  g.fillStyle = '#ffd34d';
  g.fillRect(X(305) - 1, Y(rwy.width) - 2, 3, Math.max(6, rwy.width * 2 * sc) + 4);
  // 이상적인 패턴 (점선)
  g.setLineDash([6, 6]); g.strokeStyle = 'rgba(255,211,77,0.55)'; g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(X(0), Y(0)); g.lineTo(X(rwy.len + 700), Y(0)); g.lineTo(X(rwy.len + 700), Y(1250)); g.lineTo(X(-1500), Y(1250)); g.lineTo(X(-1500), Y(0)); g.lineTo(X(305), Y(0));
  g.stroke(); g.setLineDash([]);
  // 궤적: 속도에 따라 색
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const k = Math.max(0, Math.min(1, (b.ias - 50) / 50));
    g.strokeStyle = i <= idx ? `hsl(${190 - k * 150},85%,60%)` : 'rgba(255,255,255,0.12)';
    g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(X(a.s), Y(a.dPattern)); g.lineTo(X(b.s), Y(b.dPattern)); g.stroke();
  }
  const cur = pts[Math.max(0, Math.min(pts.length - 1, idx))];
  if (cur) { g.fillStyle = '#fff'; g.beginPath(); g.arc(X(cur.s), Y(cur.dPattern), 5, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#9aa3ad'; g.font = '12px Pretendard, sans-serif';
  g.fillText(`위에서 본 패턴 · 활주로 ${rwyId} · 노란 점선 = 연습용 표준 패턴`, pad, 16);

  // 옆에서 본 높이: 최종 접근 3km
  const y0 = topH + 8, h = H - y0 - 8;
  g.fillStyle = '#0d1116'; g.fillRect(0, y0, W, h);
  const s0 = -3500, s1 = 1200;
  const PX = (s) => pad + ((s - s0) / (s1 - s0)) * (W - pad * 2);
  const PY = (alt) => y0 + h - 18 - (alt / 1200) * (h - 34);
  g.strokeStyle = 'rgba(255,211,77,0.7)'; g.setLineDash([5, 5]);
  g.beginPath(); g.moveTo(PX(s0), PY(glidepathAglFt(s0))); g.lineTo(PX(305), PY(0)); g.stroke(); g.setLineDash([]);
  g.strokeStyle = '#5a5e64'; g.lineWidth = 4; g.beginPath(); g.moveTo(PX(0), PY(0)); g.lineTo(PX(s1), PY(0)); g.stroke();
  g.strokeStyle = '#4dd2ff'; g.lineWidth = 2;
  g.beginPath();
  let started = false;
  pts.forEach((p, i) => {
    if (i > idx || p.s < s0 || p.s > s1 || Math.abs(p.dPattern) > 400) { started = false; return; }
    if (!started) { g.moveTo(PX(p.s), PY(p.alt)); started = true; } else g.lineTo(PX(p.s), PY(p.alt));
  });
  g.stroke();
  g.fillStyle = '#9aa3ad';
  g.fillText('파이널 옆모습 · 노란 점선 = 3° 활공각 (조준점 1,000ft)', pad, y0 + 16);
  if (cur) {
    g.fillStyle = '#f2f2ee'; g.font = '600 13px "IBM Plex Mono", monospace';
    g.fillText(`${Math.round(cur.t)}초  ${Math.round(cur.alt)}ft  ${Math.round(cur.ias)}kt`, W - 230, 16);
  }
}
