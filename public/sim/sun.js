// 해 위치 (NOAA 계산식). 피닉스 시간 = UTC-7 (서머타임 없음)
import { AIRPORT } from './airport.js';

const R = Math.PI / 180;

export function sunPosition(utcMs, lat = AIRPORT.lat, lon = AIRPORT.lon) {
  const jd = utcMs / 86400000 + 2440587.5;
  const T = (jd - 2451545) / 36525;
  const L0 = (((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360) + 360) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * R) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * R) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * R) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * R);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * R);
  const decl = Math.asin(Math.sin(eps * R) * Math.sin(lambda * R));
  const y = Math.tan((eps * R) / 2) ** 2;
  const eqt = (4 / R) * (y * Math.sin(2 * L0 * R) - 2 * e * Math.sin(M * R) + 4 * e * y * Math.sin(M * R) * Math.cos(2 * L0 * R) - 0.5 * y * y * Math.sin(4 * L0 * R) - 1.25 * e * e * Math.sin(2 * M * R));
  const d = new Date(utcMs);
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  const tst = minutes + eqt + 4 * lon;
  const ha = (tst / 4 - 180) * R;
  const la = lat * R;
  const cosZ = Math.sin(la) * Math.sin(decl) + Math.cos(la) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(Math.min(1, Math.max(-1, cosZ)));
  const az = (Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(la) - Math.tan(decl) * Math.cos(la)) / R + 180) % 360;
  return { elevation: 90 - zen / R, azimuth: az };
}

// 피닉스 날짜(y,m,d)와 시(0~24, 소수 가능) → UTC ms
export function phoenixToUtc(y, mo, d, hour) {
  return Date.UTC(y, mo, d, 0, 0, 0) + (hour - AIRPORT.utcOffset) * 3600000;
}
export function phoenixNow(utcMs = Date.now()) {
  const local = new Date(utcMs + AIRPORT.utcOffset * 3600000);
  return {
    y: local.getUTCFullYear(), mo: local.getUTCMonth(), d: local.getUTCDate(),
    hour: local.getUTCHours() + local.getUTCMinutes() / 60 + local.getUTCSeconds() / 3600,
  };
}
export function fmtHour(h) {
  const hh = Math.floor(((h % 24) + 24) % 24);
  const mm = Math.floor((h - Math.floor(h)) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// 그 날의 일출·일몰 (피닉스 시각, 시 단위)
export function sunTimes(y, mo, d) {
  let rise = null, set = null, prev = null;
  for (let m = 0; m <= 1440; m += 2) {
    const el = sunPosition(phoenixToUtc(y, mo, d, m / 60)).elevation + 0.833;
    if (prev !== null) {
      if (prev < 0 && el >= 0 && rise === null) rise = (m - 2 + (2 * -prev) / (el - prev)) / 60;
      if (prev >= 0 && el < 0 && set === null) set = (m - 2 + (2 * prev) / (prev - el)) / 60;
    }
    prev = el;
  }
  return { rise, set };
}
