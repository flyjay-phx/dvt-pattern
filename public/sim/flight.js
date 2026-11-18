// 세스나 172 비행 모델 (단순화). 실제 수치(실속 약 48kt, 플랩 30° 약 40kt, Vy 74kt)에 가깝게 맞추되
// 처음 하는 사람도 착륙할 수 있게 선회 협조와 수평 복원을 약하게 도와준다.
// 기체 축: 앞 = (0,0,-1), 위 = (0,1,0), 오른쪽 = (1,0,0)
import { v, add, scale, dot, cross, len, norm, q as Q, qmul, qnorm, qaxis, qrot, clamp } from './math.js';
import { KT, FT, AIRPORT, rad, deg, wrap360 } from './airport.js';

export const C172 = {
  mass: 1050, // kg (조종사 + 연료 절반)
  S: 16.2, // 날개 면적 m²
  CL0: 0.4,
  CLa: 4.8, // /rad
  CD0: 0.027,
  K: 0.054,
  T0: 2700, // 정지 추력 N (해면)
  Vmax: 95, // 추력이 0이 되는 속도 m/s
  gearH: 1.25, // 바퀴로 섰을 때 무게중심 높이 m
  flapCL: { 0: 0, 10: 0.25, 20: 0.45, 30: 0.6 },
  flapCD: { 0: 0, 10: 0.01, 20: 0.03, 30: 0.06 },
  vfe: { 10: 110, 20: 85, 30: 85 }, // 플랩 최대 속도 kt
};
export const FLAP_STEPS = [0, 10, 20, 30];

const F = v(0, 0, -1), U = v(0, 1, 0), R = v(1, 0, 0);
const G = 9.81;

const interp = (table, f) => {
  const lo = f >= 20 ? 20 : f >= 10 ? 10 : 0;
  const hi = lo === 20 ? 30 : lo + 10;
  const t = clamp((f - lo) / 10, 0, 1);
  return table[lo] + (table[hi] - table[lo]) * t;
};

export function quatFromEuler(headingTrueDeg, pitchDeg = 0, bankDeg = 0) {
  const qy = qaxis(U, -rad(headingTrueDeg));
  const qp = qaxis(R, rad(pitchDeg));
  const qr = qaxis(F, rad(bankDeg));
  return qnorm(qmul(qmul(qy, qp), qr));
}

export function createAircraft({ x = 0, y, z = 0, heading = 0, speedMs = 0, onGround = true, groundHeight = 0 } = {}) {
  const yy = y ?? groundHeight + C172.gearH;
  const h = rad(heading);
  return {
    pos: v(x, yy, z),
    vel: v(Math.sin(h) * speedMs, 0, -Math.cos(h) * speedMs),
    quat: quatFromEuler(heading, 0, 0),
    w: { p: 0, q: 0, r: 0 }, // 롤(+오른쪽), 피치(+기수 들기), 요(+기수 오른쪽) rad/s
    thr: 0,
    flaps: 0,
    onGround,
    crashed: null,
    airTime: 0,
    liftReported: !onGround,
    stallBuffet: 0,
  };
}

export function attitude(st) {
  const fw = qrot(st.quat, F), up = qrot(st.quat, U), rt = qrot(st.quat, R);
  return {
    fw, up, rt,
    headingTrue: wrap360(deg(Math.atan2(fw.x, -fw.z))),
    pitch: deg(Math.asin(clamp(fw.y, -1, 1))),
    bank: deg(Math.atan2(-rt.y, up.y)),
  };
}

function aero(st, env) {
  const { fw, up, rt } = attitude(st);
  const wind = env.wind || v();
  const va = v(st.vel.x - wind.x, st.vel.y - wind.y, st.vel.z - wind.z);
  const V = len(va);
  const u = dot(va, fw), wv = dot(va, up), sv = dot(va, rt);
  const alpha = V > 1 ? Math.atan2(-wv, Math.max(u, 0.1)) : 0;
  const beta = V > 1 ? Math.atan2(sv, Math.max(Math.abs(u), 0.1)) : 0;
  const flapFrac = st.flaps / 30;
  const alphaS = rad(15.5 - 1.5 * flapFrac);
  const dCL = interp(C172.flapCL, st.flaps);
  let CL = C172.CL0 + C172.CLa * alpha + dCL;
  const stalled = alpha > alphaS;
  if (stalled) {
    const CLmax = C172.CL0 + C172.CLa * alphaS + dCL;
    CL = Math.max(0.55, CLmax - 2.5 * (alpha - alphaS));
  } else if (alpha < -rad(12)) {
    CL = C172.CL0 + C172.CLa * -rad(12);
  }
  let CD = C172.CD0 + interp(C172.flapCD, st.flaps) + C172.K * CL * CL;
  if (stalled) CD += 0.9 * (alpha - alphaS);
  return { fw, up, rt, va, V, alpha, beta, CL, CD, alphaS, stalled };
}

// 한 단계 적분. controls: elevator/aileron/rudder(-1~1, S키=+1 기수 들기), throttle(0~1), flapsTarget, brakes(0~1), trim, engineFailed
// env: wind(벡터 m/s, 공기가 움직이는 방향), rho, groundHeight(x,z), surface(x,z)
export function stepAircraft(st, c, env, dt) {
  const events = [];
  if (st.crashed) return events;
  const m = C172.mass;
  const a = aero(st, env);
  const { fw, up, rt, va, V, alpha, beta } = a;
  const rho = env.rho ?? 1.12;
  const qd = 0.5 * rho * V * V;

  // 엔진·플랩
  st.thr += ((c.engineFailed ? 0 : clamp(c.throttle, 0, 1)) - st.thr) * Math.min(1, dt * 2.5);
  const ft = c.flapsTarget ?? 0;
  st.flaps += clamp(ft - st.flaps, -4 * dt, 4 * dt);

  // 힘
  let force = v(0, -m * G, 0);
  if (V > 0.5) {
    const vh = scale(va, 1 / V);
    const liftDir = norm(cross(rt, vh));
    force = add(force, scale(liftDir, qd * C172.S * a.CL));
    force = add(force, scale(vh, -qd * C172.S * a.CD));
    force = add(force, scale(rt, -qd * C172.S * 0.6 * beta));
  }
  const sigma = rho / 1.225;
  const thrust = c.engineFailed ? -qd * C172.S * 0.004 : st.thr * C172.T0 * sigma * Math.max(0, 1 - V / C172.Vmax);
  force = add(force, scale(fw, thrust));

  // 회전 (속도가 클수록 조종면이 잘 듣는다)
  const k = qd / 1531;
  const vf = clamp(V / 50, 0.15, 1.6);
  const att = attitude(st);
  const bankR = rad(att.bank);
  const ePitch = clamp((c.elevator || 0) + (c.trim || 0), -1.2, 1.2);
  let qDot = k * (1.83 * ePitch - 7 * (alpha - rad(2))) - 4 * vf * st.w.q;
  let pDot = k * 1.6 * (c.aileron || 0) - 2.5 * vf * st.w.p;
  if (Math.abs(c.aileron || 0) < 0.05 && !st.onGround) pDot -= k * 0.6 * bankR; // 손을 떼면 천천히 수평으로 (쉬운 조종)
  // 지상에서는 바퀴가 방향을 잡아 주므로 바람에 기수가 덜 돌아간다 (풍향계 효과를 약하게)
  let rDot = k * (2.0 * (c.rudder || 0) + (st.onGround ? 0.8 : 6) * beta) - 3 * vf * st.w.r;
  if (!st.onGround && V > 15) rDot += 1.5 * vf * ((G * Math.tan(clamp(bankR, -1.2, 1.2))) / V - st.w.r); // 선회 협조 도움
  if (a.stalled && !st.onGround) {
    st.stallBuffet += dt;
    pDot += Math.sin(st.stallBuffet * 7.3) * 0.9 * vf; // 실속 시 날개 흔들림
    qDot -= 0.6 * vf; // 기수가 떨어짐
  }

  // 지면
  const gh = env.groundHeight ? env.groundHeight(st.pos.x, st.pos.z) : 0;
  const floor = gh + C172.gearH;
  const surf = env.surface ? env.surface(st.pos.x, st.pos.z) : { type: 'runway' };

  if (st.onGround) {
    const N = Math.max(0, -force.y);
    if (force.y > 0 && V > 15) {
      st.onGround = false;
      st.airTime = 0;
      st.liftReported = false;
    } else {
      force.y = 0;
      st.vel.y = 0;
      const hf = norm(v(fw.x, 0, fw.z));
      const along = st.vel.x * hf.x + st.vel.z * hf.z;
      const lat = v(st.vel.x - hf.x * along, 0, st.vel.z - hf.z * along);
      const paved = surf.type !== 'dirt';
      const mu = (paved ? 0.025 : 0.08) + clamp(c.brakes || 0, 0, 1) * (paved ? 0.4 : 0.3);
      const fr = mu * N;
      if (Math.abs(along) < 0.4 && Math.abs(dot(force, hf)) < fr) {
        st.vel.x -= hf.x * along;
        st.vel.z -= hf.z * along;
        force.x -= hf.x * dot(force, hf);
        force.z -= hf.z * dot(force, hf);
      } else {
        force = add(force, scale(hf, -Math.sign(along) * fr));
      }
      const latMax = 0.9 * N;
      const latF = scale(lat, -m * 8);
      const lf = len(latF);
      force = add(force, lf > latMax && lf > 0 ? scale(latF, latMax / lf) : latF);
      // 앞바퀴 조향
      const steerW = clamp(1 - V / 30, 0.15, 1);
      const steer = (c.rudder || 0) * 0.45 * clamp(Math.abs(along) / 6, 0, 1) * Math.sign(along || 1);
      st.w.r += (steer - st.w.r) * Math.min(1, dt * 6) * steerW;
      st.w.p = -bankR * 4;
      if (att.pitch <= -0.5 && qDot < 0) { qDot = 0; st.w.q = Math.max(st.w.q, 0); }
      if (att.pitch >= 14 && qDot > 0) { qDot = 0; st.w.q = Math.min(st.w.q, 0); }
      if (st.pos.y !== floor) st.pos.y = floor;
    }
  }

  // 적분
  st.w.q += qDot * dt;
  st.w.p += pDot * dt;
  st.w.r += rDot * dt;
  const om = Q(st.w.q, -st.w.r, -st.w.p, 0); // 기체 축 각속도 (x=피치, y=-요, z=-롤)
  const dq = qmul(st.quat, om);
  st.quat = qnorm(Q(st.quat.x + 0.5 * dq.x * dt, st.quat.y + 0.5 * dq.y * dt, st.quat.z + 0.5 * dq.z * dt, st.quat.w + 0.5 * dq.w * dt));
  if (st.onGround) {
    const at2 = attitude(st);
    st.quat = quatFromEuler(at2.headingTrue, clamp(at2.pitch, -0.5, 14), at2.bank * Math.max(0, 1 - dt * 6));
  }

  const vyBefore = st.vel.y;
  st.vel = add(st.vel, scale(force, dt / m));
  st.pos = add(st.pos, scale(st.vel, dt));
  if (!st.onGround) {
    st.airTime += dt;
    // 1초 넘게 떠 있어야 진짜 이륙으로 본다 (활주 중 살짝 뜨는 것은 무시)
    if (!st.liftReported && st.airTime > 1) {
      st.liftReported = true;
      events.push({ type: 'liftoff', iasKt: (V * Math.sqrt(sigma)) / KT });
    }
  }

  // 접지 판정
  if (!st.onGround && st.pos.y <= floor) {
    const at3 = attitude(st);
    const vy = Math.min(vyBefore, st.vel.y);
    const ias = (V * Math.sqrt(sigma)) / KT;
    let crash = null;
    if (gh > 3) crash = '지형 충돌';
    else if (vy < -5.1) crash = '너무 세게 내림 (분당 1,000ft 이상)';
    else if (Math.abs(at3.bank) > 15) crash = '날개 끝이 땅에 닿음';
    else if (at3.pitch < -3 && vy < -1) crash = '앞바퀴부터 세게 닿음';
    st.pos.y = floor;
    if (crash) {
      st.crashed = crash;
      st.vel = v();
      events.push({ type: 'crash', reason: crash });
      return events;
    }
    st.onGround = true;
    st.vel.y = 0;
    st.w.q *= 0.3;
    if (!st.liftReported) return events; // 이륙 전 잠깐 뜬 것: 접지로 세지 않음
    events.push({ type: 'touchdown', vyMs: vy, iasKt: ias, bank: at3.bank, pitch: at3.pitch, headingTrue: at3.headingTrue, airTime: st.airTime, surface: surf });
  }
  if (a.stalled && !st.onGround && V > 10) events.push({ type: 'stall' });
  return events;
}

// 계기 표시용 값
export function readout(st, env) {
  const a = aero(st, env);
  const att = attitude(st);
  const rho = env.rho ?? 1.12;
  const gh = env.groundHeight ? env.groundHeight(st.pos.x, st.pos.z) : 0;
  const ias = (a.V * Math.sqrt(rho / 1.225)) / KT;
  const gs = Math.hypot(st.vel.x, st.vel.z);
  const rpm = Math.min(2750, (st.thr > 0.001 || ias > 30 ? 650 + 1650 * st.thr : 0) + 9 * ias * (ias > 30 ? 1 : 0));
  return {
    iasKt: ias,
    tasKt: a.V / KT,
    gsKt: gs / KT,
    altFt: (st.pos.y - C172.gearH + AIRPORT.elevM) / FT,
    aglFt: Math.max(0, (st.pos.y - gh - C172.gearH) / FT),
    vsFpm: (st.vel.y / FT) * 60,
    headingTrue: att.headingTrue,
    headingMag: wrap360(att.headingTrue - AIRPORT.magVar),
    trackTrue: gs > 1 ? wrap360(deg(Math.atan2(st.vel.x, -st.vel.z))) : att.headingTrue,
    pitch: att.pitch,
    bank: att.bank,
    alpha: deg(a.alpha),
    beta: deg(a.beta),
    stallWarn: !st.onGround && a.V > 10 && a.alpha > a.alphaS - rad(3),
    turnRate: deg(st.w.r),
    rpm: st.crashed ? 0 : Math.round(rpm),
    flaps: st.flaps,
  };
}

export function airDensity(altM, tempC = 15) {
  return 1.225 * Math.exp(-altM / 8500) * (288.15 / (273.15 + tempC));
}
