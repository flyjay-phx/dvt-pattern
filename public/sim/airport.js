// 피닉스 디어밸리 공항(KDVT) 배치. 서버와 브라우저가 같이 쓰는 순수 계산 모듈.
// 좌표: x = 동쪽(m), y = 위(m, 공항 지면 0), z = 남쪽(m). 원점 = 07R/25L 활주로 가운데.
// 출처: FAA 공항 자료(AirNav), 활주로 길이·폭·간격·표고·패턴 방향. 활주로 방위와 짧은 활주로의
// 앞뒤 위치는 대략값이다(시뮬레이터 연습용, 실제 비행 참고 자료가 아님).

export const AIRPORT = {
  icao: 'KDVT',
  name: 'Phoenix Deer Valley',
  lat: 33.6902,
  lon: -112.0662,
  elevFt: 1478,
  elevM: 450.5,
  magVar: 10, // 편차 약 10°E: 진방위 = 자방위 + 10
  utcOffset: -7, // 애리조나는 서머타임 없이 MST(UTC-7)
};

export const FT = 0.3048;
export const KT = 0.514444;
export const deg = (r) => (r * 180) / Math.PI;
export const rad = (d) => (d * Math.PI) / 180;
export const wrap360 = (a) => ((a % 360) + 360) % 360;
export const wrap180 = (a) => {
  const w = wrap360(a);
  return w > 180 ? w - 360 : w;
};

const HDG07_TRUE = 79; // 07 활주로 진방위(대략, 자방위 069)
const dir = { x: Math.sin(rad(HDG07_TRUE)), z: -Math.cos(rad(HDG07_TRUE)) }; // 07 방향 단위벡터
const leftOf07 = { x: Math.sin(rad(HDG07_TRUE - 90)), z: -Math.cos(rad(HDG07_TRUE - 90)) }; // 07 기준 왼쪽(북쪽)

const SOUTH = { len: 8196 * FT, width: 100 * FT, center: { x: 0, z: 0 } };
const NORTH_OFFSET = 700 * FT; // 두 활주로 중심선 간격 700ft
const NORTH = {
  len: 4500 * FT,
  width: 75 * FT,
  center: { x: leftOf07.x * NORTH_OFFSET - dir.x * 200, z: leftOf07.z * NORTH_OFFSET - dir.z * 200 },
};

function end(base, sign) {
  return { x: base.center.x + sign * dir.x * (base.len / 2), z: base.center.z + sign * dir.z * (base.len / 2) };
}

// traffic: 패턴 선회 방향. 7R·25R 우선회, 07L·25L 좌선회 (FAA 자료)
export const RUNWAYS = {
  '07R': { id: '07R', label: '7R', pair: 'south', thr: end(SOUTH, -1), hdgTrue: HDG07_TRUE, len: SOUTH.len, width: SOUTH.width, traffic: 'right', opposite: '25L' },
  '25L': { id: '25L', label: '25L', pair: 'south', thr: end(SOUTH, 1), hdgTrue: HDG07_TRUE + 180, len: SOUTH.len, width: SOUTH.width, traffic: 'left', opposite: '07R' },
  '07L': { id: '07L', label: '7L', pair: 'north', thr: end(NORTH, -1), hdgTrue: HDG07_TRUE, len: NORTH.len, width: NORTH.width, traffic: 'left', opposite: '25R' },
  '25R': { id: '25R', label: '25R', pair: 'north', thr: end(NORTH, 1), hdgTrue: HDG07_TRUE + 180, len: NORTH.len, width: NORTH.width, traffic: 'right', opposite: '07L' },
};
export const RUNWAY_IDS = Object.keys(RUNWAYS);
export const PAIRS = {
  south: { ids: ['07R', '25L'], label: '남쪽 긴 활주로 7R/25L (8,196ft)' },
  north: { ids: ['07L', '25R'], label: '북쪽 짧은 활주로 7L/25R (4,500ft)' },
};
export const RUNWAY_CENTERS = { south: SOUTH.center, north: NORTH.center };

export function hdgMag(trueHdg) {
  return wrap360(trueHdg - AIRPORT.magVar);
}

// 활주로 기준 좌표: s = 착륙 시단에서 활주로 방향으로 간 거리(m), d = 오른쪽(+) 옆 거리(m)
export function runwayFrame(rwy, x, z) {
  const h = rad(rwy.hdgTrue);
  const fx = Math.sin(h), fz = -Math.cos(h);
  const rx = Math.cos(h), rz = Math.sin(h); // 진행 방향의 오른쪽
  const dx = x - rwy.thr.x, dz = z - rwy.thr.z;
  const s = dx * fx + dz * fz;
  const d = dx * rx + dz * rz;
  const side = rwy.traffic === 'right' ? 1 : -1;
  return { s, d, dPattern: d * side };
}

export function pointOnRunway(rwy, s, d) {
  const h = rad(rwy.hdgTrue);
  return {
    x: rwy.thr.x + Math.sin(h) * s + Math.cos(h) * d,
    z: rwy.thr.z - Math.cos(h) * s + Math.sin(h) * d,
  };
}

// 유도로·계류장(포장면) 사각형: 활주로 기준 좌표로 정의
const PAVED = [
  { rwy: '07R', s0: 0, s1: SOUTH.len, d0: -NORTH_OFFSET / 2 - 9, d1: -NORTH_OFFSET / 2 + 9 }, // 두 활주로 사이 평행 유도로
  { rwy: '07R', s0: 700, s1: 1500, d0: 110, d1: 330 }, // 남쪽 계류장
  { rwy: '07R', s0: 500, s1: 1700, d0: 40, d1: 60 }, // 남쪽 유도로
];

export function surfaceAt(x, z) {
  for (const id of RUNWAY_IDS) {
    const r = RUNWAYS[id];
    const f = runwayFrame(r, x, z);
    if (f.s >= -3 && f.s <= r.len + 3 && Math.abs(f.d) <= r.width / 2 + 1) return { type: 'runway', id };
  }
  for (const p of PAVED) {
    const f = runwayFrame(RUNWAYS[p.rwy], x, z);
    if (f.s >= p.s0 && f.s <= p.s1 && f.d >= p.d0 && f.d <= p.d1) return { type: 'paved' };
  }
  return { type: 'dirt' };
}
export const PAVED_AREAS = PAVED;

// 지형: 공항 반경 5km 안은 평평, 바깥은 언덕, 멀리 산. 북쪽(-z)에 언덕을 더 둔다.
function hash(ix, iz) {
  let h = ix * 374761393 + iz * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < 5; i++) {
    s += amp * vnoise(x * f, z * f);
    f *= 2.03;
    amp *= 0.5;
  }
  return s;
}
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export function terrainHeight(x, z) {
  const r = Math.hypot(x, z);
  if (r < 5200) return 0;
  const north = 0.6 + 0.8 * smooth(0, 1, -z / Math.max(r, 1));
  const ridge = Math.pow(fbm(x / 2600 + 11, z / 2600 - 7), 2.2);
  const near = smooth(5200, 10000, r) * ridge * 520 * north;
  const far = smooth(14000, 30000, r) * Math.pow(fbm(x / 7000 - 3, z / 7000 + 5), 1.6) * 1500;
  return near + far;
}
