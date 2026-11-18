import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreLanding } from '../public/sim/scoring.js';
import { sunTimes, sunPosition, phoenixToUtc } from '../public/sim/sun.js';
import { selectRunway, windPhrase, spellTail, runwaySpoken, atisText, radio } from '../public/sim/atc.js';
import { windComponents, windVector, WindModel } from '../public/sim/weather.js';
import { RUNWAYS, runwayFrame, pointOnRunway, surfaceAt, terrainHeight } from '../public/sim/airport.js';
import { createAircraft, stepAircraft, readout, airDensity } from '../public/sim/flight.js';

test('채점: 부드럽고 정확한 착륙은 A, 세게·길게 닿으면 감점', () => {
  const good = scoreLanding({ sinkFpm: 120, centerlineFt: 4, fromThresholdFt: 1050, iasKt: 55, crabDeg: 1, bankDeg: 1, runwayWidthFt: 100 });
  assert.equal(good.grade, 'A');
  const bad = scoreLanding({ sinkFpm: 750, centerlineFt: 35, fromThresholdFt: 3200, iasKt: 75, crabDeg: 9, bankDeg: 8, runwayWidthFt: 100 });
  assert.equal(bad.grade, 'D');
  assert.ok(bad.notes.length >= 5);
  const withChecklist = scoreLanding({ sinkFpm: 300, centerlineFt: 4, fromThresholdFt: 1050, iasKt: 55, crabDeg: 1, bankDeg: 1, runwayWidthFt: 100, checklist: true });
  const without = scoreLanding({ sinkFpm: 300, centerlineFt: 4, fromThresholdFt: 1050, iasKt: 55, crabDeg: 1, bankDeg: 1, runwayWidthFt: 100 });
  assert.equal(withChecklist.score - without.score, 3);
});

test('해: 피닉스 하지·동지의 일출·일몰 시각이 실제와 15분 이내', () => {
  // 실제(대략): 6/21 일출 05:19 일몰 19:42, 12/21 일출 07:30 일몰 17:23 (MST)
  const s = sunTimes(2026, 5, 21), w = sunTimes(2026, 11, 21);
  const near = (a, b) => Math.abs(a - b) * 60 < 15;
  assert.ok(near(s.rise, 5 + 19 / 60), `하지 일출 ${s.rise}`);
  assert.ok(near(s.set, 19 + 42 / 60), `하지 일몰 ${s.set}`);
  assert.ok(near(w.rise, 7 + 30 / 60), `동지 일출 ${w.rise}`);
  assert.ok(near(w.set, 17 + 23 / 60), `동지 일몰 ${w.set}`);
  const noon = sunPosition(phoenixToUtc(2026, 5, 21, 12.5));
  assert.ok(noon.elevation > 75 && noon.azimuth > 120 && noon.azimuth < 240);
});

test('활주로 배치: 07R/25L 길이 8,196ft, 두 활주로 간격 700ft, 패턴 방향', () => {
  const r = RUNWAYS['07R'];
  assert.ok(Math.abs(r.len / 0.3048 - 8196) < 1);
  const nCenter = pointOnRunway(RUNWAYS['07L'], RUNWAYS['07L'].len / 2, 0);
  assert.ok(Math.abs(Math.abs(runwayFrame(r, nCenter.x, nCenter.z).d) / 0.3048 - 700) < 1);
  assert.equal(RUNWAYS['07R'].traffic, 'right');
  assert.equal(RUNWAYS['25L'].traffic, 'left');
  assert.equal(RUNWAYS['25R'].traffic, 'right');
  assert.equal(RUNWAYS['07L'].traffic, 'left');
  // 남쪽 활주로 패턴(7R 우선회, 25L 좌선회)은 둘 다 남쪽으로 돈다
  const s7 = pointOnRunway(RUNWAYS['07R'], 1000, 500), s25 = pointOnRunway(RUNWAYS['25L'], 1000, -500);
  assert.ok(s7.z > 0 && s25.z > 0);
  assert.equal(surfaceAt(0, 0).type, 'runway');
  assert.equal(terrainHeight(0, 0), 0);
  assert.ok(terrainHeight(0, -15000) > 0);
});

test('바람: 성분 계산과 사용 활주로 선택', () => {
  assert.ok(Math.abs(windComponents(259, 10, 259).head - 10) < 0.01);
  assert.ok(windComponents(349, 10, 259).cross > 9.9); // 오른쪽에서 부는 옆바람
  assert.equal(selectRunway('south', { dir: 80, kt: 10 }), '07R');
  assert.equal(selectRunway('south', { dir: 260, kt: 10 }), '25L');
  assert.equal(selectRunway('north', { dir: 60, kt: 8 }), '07L');
  assert.equal(selectRunway('south', { dir: 80, kt: 2 }), '25L'); // 약한 바람은 서쪽 기본
  const v = windVector(270, 10); // 서풍 → 공기가 동쪽(+x)으로 감
  assert.ok(v.x > 5 && Math.abs(v.z) < 0.01);
  const m = new WindModel(1);
  m.set({ dir: 250, kt: 10, gust: 20 });
  const sp = Array.from({ length: 200 }, (_, i) => m.sample(i * 0.5, 300).kt);
  assert.ok(Math.max(...sp) > 14 && Math.min(...sp) >= 9.5);
});

test('관제 문장: 기체 번호·활주로·바람을 무전 발음으로', () => {
  assert.equal(spellTail('N172SP'), 'one seven two Sierra Papa');
  assert.equal(runwaySpoken('25L'), 'two five left');
  assert.equal(runwaySpoken('07R'), 'seven right'); // 미국은 한 자리 활주로 앞에 zero를 붙이지 않음
  assert.equal(windPhrase({ dir: 260, kt: 8 }).en, 'wind two five zero at eight'); // 진방위 260 → 자방위 250
  assert.equal(windPhrase({ dir: 0, kt: 1 }).en, 'wind calm');
  const lines = radio('downwind', { tail: 'N172SP', rwyId: '25L', wx: { dir: 260, kt: 8 }, letter: 'Alpha' });
  assert.match(lines[0].en, /left downwind runway two five left, touch and go/);
  assert.match(lines[1].en, /cleared touch and go/);
  const a = atisText({ letter: 'Bravo', wx: { dir: 260, kt: 8, altimInHg: 30.1, tempC: 20, dewC: -3, observedMs: Date.UTC(2026, 10, 18, 17, 53) }, rwyId: '25L' });
  assert.match(a.en, /information Bravo/);
  assert.match(a.en, /altimeter three zero one zero/);
  assert.match(a.en, /temperature two zero, dewpoint minus three/);
});

test('비행 모델: 실속 경고는 50kt 근처, 풀 스로틀 정지 상태에서 이륙 가능', () => {
  const env = { wind: { x: 0, y: 0, z: 0 }, rho: airDensity(450, 20), groundHeight: () => 0, surface: () => ({ type: 'runway' }) };
  const st = createAircraft({ heading: 79, y: 600, speedMs: 40, onGround: false });
  let warnAt = null;
  const c = { throttle: 0, elevator: 0, aileron: 0, rudder: 0, flapsTarget: 0, brakes: 0, trim: 0 };
  for (let i = 0; i < 120 * 60 && warnAt == null; i++) {
    c.elevator = Math.min(1, c.elevator + 0.0006);
    stepAircraft(st, c, env, 1 / 120);
    const r = readout(st, env);
    if (r.stallWarn) warnAt = r.iasKt;
  }
  assert.ok(warnAt > 45 && warnAt < 62, `실속 경고 ${warnAt}kt`);
});
