// 바람 모델: 기본 풍향·풍속(METAR 또는 연습 설정)에 돌풍과 풍향 흔들림을 더한다.
import { KT, rad, wrap360 } from './airport.js';

// 풍향(바람이 불어오는 방향, 진방위)과 풍속 → 공기가 움직이는 속도 벡터 (m/s)
export function windVector(fromDeg, kt) {
  const s = kt * KT;
  return { x: -Math.sin(rad(fromDeg)) * s, y: 0, z: Math.cos(rad(fromDeg)) * s };
}

// 활주로 방향 기준 맞바람(+)·옆바람(+는 오른쪽에서) 성분 kt
export function windComponents(fromDeg, kt, rwyHdgTrue) {
  const a = rad(fromDeg - rwyHdgTrue);
  return { head: kt * Math.cos(a), cross: kt * Math.sin(a) };
}

export class WindModel {
  constructor(seed = Math.random() * 1000) {
    this.seed = seed;
    this.base = { dir: 0, kt: 0, gust: null, variable: false };
  }
  set(base) {
    this.base = { dir: base.dir ?? 0, kt: base.kt ?? 0, gust: base.gust ?? null, variable: !!base.variable };
  }
  // t: 초, aglM: 지면 위 높이
  sample(t, aglM = 300) {
    const s = this.seed;
    const n1 = Math.sin(t * 0.37 + s) * 0.5 + Math.sin(t * 0.91 + s * 2.1) * 0.3 + Math.sin(t * 2.3 + s * 0.7) * 0.2;
    const n2 = Math.sin(t * 0.11 + s * 1.3) * 0.6 + Math.sin(t * 0.43 + s * 0.4) * 0.4;
    const { dir, kt, gust } = this.base;
    let speed = kt;
    if (gust && gust > kt) speed = kt + (gust - kt) * Math.max(0, n1);
    else speed = kt * (1 + 0.08 * n1);
    const wobble = this.base.variable ? 40 : 8;
    const d = wrap360(dir + n2 * wobble);
    const shear = 0.7 + 0.3 * Math.min(1, aglM / 30); // 지면 가까이 바람이 약해짐
    const sp = Math.max(0, speed * shear);
    return { dir: d, kt: sp, vec: windVector(d, sp) };
  }
}
