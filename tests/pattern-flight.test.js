// 간단한 자동 조종으로 07R 우선회 패턴을 한 바퀴 돌고 내려서, 비행 모델·구간 판정·채점이 같이 맞는지 본다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAircraft, stepAircraft, readout, airDensity } from '../public/sim/flight.js';
import { RUNWAYS, pointOnRunway, runwayFrame, surfaceAt, terrainHeight, wrap180, FT } from '../public/sim/airport.js';
import { classifyLeg, glidepathAglFt } from '../public/sim/pattern.js';
import { scoreLanding } from '../public/sim/scoring.js';

function fly(rwyId, windVec = { x: 0, y: 0, z: 0 }) {
  const rwy = RUNWAYS[rwyId];
  const side = rwy.traffic === 'right' ? 1 : -1;
  const p = pointOnRunway(rwy, 25, 0);
  const st = createAircraft({ x: p.x, z: p.z, heading: rwy.hdgTrue });
  const env = { wind: windVec, rho: airDensity(450, 20), groundHeight: terrainHeight, surface: surfaceAt };
  const c = { throttle: 1, elevator: 0, aileron: 0, rudder: 0, flapsTarget: 0, brakes: 0, trim: 0 };
  const legs = new Set();
  let phase = 'takeoff', td = null;
  const dt = 1 / 120;
  for (let t = 0; t < 900 && !td; t += dt) {
    const r = readout(st, env);
    const f = runwayFrame(rwy, st.pos.x, st.pos.z);
    legs.add(classifyLeg(rwy, st.pos, r, st.onGround).leg);
    if (process.env.TRACE && Math.abs(t % 15) < dt) console.log(t.toFixed(0), phase, 'ias', r.iasKt.toFixed(0), 'agl', r.aglFt.toFixed(0), 's', f.s.toFixed(0), 'dP', f.dPattern.toFixed(0), 'hdg', r.headingTrue.toFixed(0), 'bank', r.bank.toFixed(0));
    let hdg = rwy.hdgTrue, pitchT = 6, spd = null;
    if (phase === 'takeoff') { pitchT = r.iasKt > 55 ? 9 : 0; if (!st.onGround && r.aglFt > 50) phase = 'upwind'; }
    else if (phase === 'upwind') { pitchT = 8; hdg = rwy.hdgTrue - f.d * 0.05; if (r.aglFt > 700) phase = 'cross'; }
    else if (phase === 'cross') { pitchT = r.aglFt < 1000 ? 7 : 2; hdg = rwy.hdgTrue + 90 * side; if (f.dPattern > 1150) phase = 'down'; }
    else if (phase === 'down') {
      hdg = rwy.hdgTrue + 180 + Math.max(-30, Math.min(30, (f.dPattern - 1250) * 0.04)) * side;
      pitchT = 2 + (1000 - r.aglFt) * 0.02; c.throttle = Math.min(0.75, Math.max(0.3, 0.55 + (90 - r.iasKt) * 0.03));
      if (f.s < 300) { c.flapsTarget = 10; c.throttle = 0.35; }
      if (f.s < -1200) phase = 'base';
    } else if (phase === 'base') {
      hdg = rwy.hdgTrue - 90 * side; c.flapsTarget = 20; spd = 70;
      if (f.dPattern < 350) phase = 'final';
    } else if (phase === 'final') {
      hdg = rwy.hdgTrue - Math.max(-25, Math.min(25, f.d * 0.25));
      c.flapsTarget = 30; spd = 63;
      const gp = glidepathAglFt(f.s);
      c.throttle = Math.min(0.8, Math.max(0, 0.3 + (gp - r.aglFt) * 0.01));
      if (r.aglFt < 18) phase = 'flare';
    } else if (phase === 'flare') { c.throttle = 0; pitchT = 5; hdg = rwy.hdgTrue; }
    if (spd != null && phase !== 'flare') pitchT = Math.max(-6, Math.min(10, (r.iasKt - spd) * 0.6 + 0));
    const hErr = wrap180(hdg - r.headingTrue);
    const bankT = st.onGround ? 0 : Math.max(-25, Math.min(25, hErr * 1.5));
    c.aileron = Math.max(-1, Math.min(1, (bankT - r.bank) * 0.06));
    c.elevator = Math.max(-1, Math.min(1, (pitchT - r.pitch) * 0.12 - st.w.q * 0.4));
    c.rudder = st.onGround ? Math.max(-1, Math.min(1, hErr * 0.15)) : 0;
    for (const e of stepAircraft(st, c, env, dt)) {
      if (e.type === 'touchdown' && phase === 'flare') {
        const ff = runwayFrame(rwy, st.pos.x, st.pos.z);
        td = { e, f: ff, legs, r: readout(st, env) };
      }
      if (e.type === 'crash') return { crash: e.reason, legs, phase };
      if (process.env.TRACE && e.type !== 'stall') console.log(t.toFixed(0), phase, e.type);
    }
  }
  return td || { legs, phase };
}

for (const id of ['07R', '25L']) {
  test(`자동 조종으로 ${id} 패턴 한 바퀴 → 활주로에 접지`, () => {
    const res = fly(id);
    assert.ok(!res.crash, `추락: ${res.crash}`);
    assert.ok(res.e, `접지하지 못함 (마지막 단계 ${res.phase})`);
    for (const leg of ['takeoff', 'upwind', 'crosswind', 'downwind', 'base', 'final']) assert.ok(res.legs.has(leg), `${leg} 구간이 판정되지 않음`);
    assert.equal(res.e.surface.type, 'runway');
    const m = { sinkFpm: (-res.e.vyMs / FT) * 60, centerlineFt: Math.abs(res.f.d) / FT, fromThresholdFt: res.f.s / FT, iasKt: res.e.iasKt, crabDeg: 0, bankDeg: Math.abs(res.e.bank) };
    const s = scoreLanding({ ...m, runwayWidthFt: 100 });
    assert.ok(m.sinkFpm < 700, `하강률 ${m.sinkFpm}`);
    assert.ok(m.centerlineFt < 40, `중심선 ${m.centerlineFt}`);
    assert.ok(s.score > 30, `점수 ${s.score} ${s.notes.join(' / ')}`);
  });
}
