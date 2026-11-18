// 장주(트래픽 패턴) 구간 판정과 코치 안내
import { runwayFrame, wrap180, FT, AIRPORT } from './airport.js';
import { AIM_POINT_FT } from './scoring.js';

export const PATTERN_AGL_FT = 1000;
export const PATTERN_MSL_FT = Math.round((AIRPORT.elevFt + PATTERN_AGL_FT) / 100) * 100; // 2,500ft
export const LEGS = {
  ground: { ko: '지상', en: 'On ground' },
  takeoff: { ko: '이륙 활주', en: 'Takeoff roll' },
  upwind: { ko: '업윈드 (이륙 상승)', en: 'Upwind' },
  crosswind: { ko: '크로스윈드', en: 'Crosswind' },
  downwind: { ko: '다운윈드', en: 'Downwind' },
  base: { ko: '베이스', en: 'Base' },
  final: { ko: '파이널', en: 'Final' },
  rollout: { ko: '착륙 활주', en: 'Rollout' },
  outside: { ko: '패턴 밖', en: 'Outside pattern' },
};

// r: readout, pos: {x,z}, rwy: 사용 활주로
export function classifyLeg(rwy, pos, r, onGround, landed = false) {
  const f = runwayFrame(rwy, pos.x, pos.z);
  const rel = wrap180(r.headingTrue - rwy.hdgTrue);
  const onRunway = f.s > -30 && f.s < rwy.len + 30 && Math.abs(f.d) < rwy.width;
  if (onGround) {
    if (!onRunway) return { leg: 'ground', f, rel };
    return { leg: landed ? 'rollout' : r.gsKt > 5 ? 'takeoff' : 'ground', f, rel };
  }
  if (Math.abs(f.d) > 4500 || f.s < -6000 || f.s > rwy.len + 5000) return { leg: 'outside', f, rel };
  const aligned = Math.abs(rel) < 40;
  const opposite = Math.abs(rel) > 140;
  const towardPattern = rwy.traffic === 'right' ? rel > 40 && rel < 140 : rel < -40 && rel > -140;
  const towardRunway = rwy.traffic === 'right' ? rel < -40 && rel > -140 : rel > 40 && rel < 140;
  if (aligned && f.s < 0 && Math.abs(f.d) < 500) return { leg: 'final', f, rel };
  if (aligned && f.s >= 0 && Math.abs(f.d) < 600) return { leg: 'upwind', f, rel };
  if (opposite && f.dPattern > 300) return { leg: 'downwind', f, rel };
  if (towardPattern && f.s > rwy.len * 0.5) return { leg: 'crosswind', f, rel };
  if (towardRunway && f.s < rwy.len * 0.5 && f.dPattern > -300) return { leg: 'base', f, rel };
  if (aligned && f.s < 0) return { leg: 'final', f, rel };
  return { leg: 'outside', f, rel };
}

// 3° 활공각 기준 지금 있어야 할 높이 (ft AGL). 조준점은 시단에서 1,000ft
export function glidepathAglFt(sMeters) {
  const distFt = AIM_POINT_FT - sMeters / FT;
  return Math.max(0, distFt * Math.tan((3 * Math.PI) / 180));
}

const turnWord = (rwy) => (rwy.traffic === 'right' ? '오른쪽' : '왼쪽');

export function coach(leg, rwy, r, f, ctx = {}) {
  const t = { leg, title: LEGS[leg]?.ko || leg, items: [], next: '' };
  const add = (label, actual, target, tol, unit) => t.items.push({ label, actual, target, ok: Math.abs(actual - target) <= tol, unit });
  switch (leg) {
    case 'ground':
      t.next = '활주로에 정렬하고 풀 스로틀(↑ 길게). 55kt에서 S로 살짝 당겨 이륙';
      break;
    case 'takeoff':
      add('속도', r.iasKt, 55, 5, 'kt');
      t.next = r.iasKt < 50 ? '중심선 유지 (Q/E 러더). 55kt를 기다리세요' : 'S로 살짝 당겨 기수 들기 (로테이션)';
      break;
    case 'upwind':
      add('속도 Vy', r.iasKt, 74, 6, 'kt');
      t.next = r.aglFt < 700 ? `74kt로 상승. 700ft(지면 위)에서 ${turnWord(rwy)}으로 크로스윈드 선회` : `지금 ${turnWord(rwy)}으로 크로스윈드 선회 (경사 20° 정도)`;
      break;
    case 'crosswind':
      add('속도', r.iasKt, 74, 8, 'kt');
      add('높이 AGL', r.aglFt, PATTERN_AGL_FT, 150, 'ft');
      t.next = `패턴 고도 ${PATTERN_MSL_FT.toLocaleString()}ft(지면 위 1,000ft)에서 ${turnWord(rwy)}으로 다운윈드 선회. 활주로와 0.5~1마일 간격`;
      break;
    case 'downwind': {
      const abeam = f.s < 300;
      add('높이 AGL', r.aglFt, PATTERN_AGL_FT, 100, 'ft');
      add('속도', r.iasKt, abeam ? 80 : 90, 10, 'kt');
      if (abeam) {
        add('플랩', r.flaps, 10, 2, '°');
        t.next = f.s < -800 ? `활주로 끝이 뒤로 45° 보이면 ${turnWord(rwy)}으로 베이스 선회` : '활주로 시단 옆: 출력 1,500RPM, 플랩 10°, 착륙 전 체크리스트(K)';
      } else t.next = '패턴 고도·90kt 유지. 무전으로 터치앤고 요청이 나갑니다';
      break;
    }
    case 'base':
      add('속도', r.iasKt, 70, 6, 'kt');
      add('플랩', r.flaps, 20, 2, '°');
      t.next = `분당 500ft 정도로 내려가며 ${turnWord(rwy)}으로 파이널 선회. 중심선에 맞추기`;
      break;
    case 'final': {
      const gp = glidepathAglFt(f.s);
      add('속도', r.iasKt, 65, 5, 'kt');
      add('플랩', r.flaps, 30, 2, '°');
      add('활공각 높이', r.aglFt, gp, Math.max(40, gp * 0.15), 'ft');
      t.next = r.aglFt < 30 ? '출력 줄이고(↓) 천천히 당겨 플레어. 뒷바퀴부터' : 'PAPI 흰 2개·빨강 2개 유지. 옆바람이면 바람 쪽 날개를 살짝 내리고 반대 러더';
      t.glide = { gp, dev: r.aglFt - gp };
      break;
    }
    case 'rollout':
      t.next = ctx.mode === 'full' ? '브레이크(B)로 멈추세요' : '터치앤고: 플랩 올리고(V 여러 번), 풀 스로틀(↑), 55kt에서 다시 이륙';
      break;
    default:
      t.next = '공항 쪽으로 돌아와 다운윈드에 45°로 들어오세요 (지도 M)';
  }
  return t;
}

export const CHECKLIST = [
  { key: 'gas', ko: '연료 선택 BOTH', en: 'Gas — fuel selector BOTH' },
  { key: 'mixture', ko: '혼합비 RICH', en: 'Mixture — RICH' },
  { key: 'carb', ko: '카브 히트 확인', en: 'Carb heat — as required' },
  { key: 'belts', ko: '좌석벨트·좌석 잠금', en: 'Seats & belts — secure' },
  { key: 'lights', ko: '착륙등 ON', en: 'Landing light — ON' },
];
