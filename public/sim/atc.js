// 관제 무전·ATIS 문장. 실제 관제가 아니라 연습용 흉내다.
import { RUNWAYS, PAIRS, AIRPORT, wrap360 } from './airport.js';
import { windComponents } from './weather.js';

const PH = { A: 'Alpha', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot', G: 'Golf', H: 'Hotel', I: 'India', J: 'Juliett', K: 'Kilo', L: 'Lima', M: 'Mike', N: 'November', O: 'Oscar', P: 'Papa', Q: 'Quebec', R: 'Romeo', S: 'Sierra', T: 'Tango', U: 'Uniform', V: 'Victor', W: 'Whiskey', X: 'X-ray', Y: 'Yankee', Z: 'Zulu' };
const DIG = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'];
export const ATIS_LETTERS = Object.values(PH);

export function digits(n, pad = 0) {
  return String(Math.round(n)).padStart(pad, '0').split('').map((c) => DIG[+c] ?? c).join(' ');
}
export function spellTail(tail) {
  return tail.replace(/^N/, '').split('').map((c) => (/\d/.test(c) ? DIG[+c] : PH[c] || c)).join(' ');
}
export function callsign(tail) {
  return `Skyhawk ${spellTail(tail)}`;
}
export function randomTail() {
  const L = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  return `N${100 + Math.floor(Math.random() * 900)}${L[Math.floor(Math.random() * L.length)]}${L[Math.floor(Math.random() * L.length)]}`;
}
export function runwaySpoken(id) {
  const n = +id.slice(0, 2);
  const side = { L: 'left', R: 'right', C: 'center' }[id[2]] || '';
  return `${digits(n)} ${side}`.trim();
}

// 바람 문장. dir은 진방위 → 관제는 자방위로 말한다
export function windPhrase(w) {
  if (!w || w.kt < 3) return { en: 'wind calm', ko: '바람 없음' };
  const mag = Math.round(wrap360(w.dir - AIRPORT.magVar) / 10) * 10 || 360;
  const g = w.gust ? ` gusts ${digits(w.gust)}` : '';
  return {
    en: `wind ${w.variable ? 'variable' : digits(mag, 3)} at ${digits(w.kt)}${g}`,
    ko: `바람 ${w.variable ? '방향 바뀜' : String(mag).padStart(3, '0') + '°'} ${Math.round(w.kt)}kt${w.gust ? `, 돌풍 ${w.gust}kt` : ''}`,
  };
}

// 바람에 따라 사용 활주로 고르기. 바람이 약하면 피닉스 지역 기본인 서쪽(25)
export function selectRunway(pair, w) {
  const [east, west] = PAIRS[pair].ids;
  if (!w || w.kt < 4 || w.variable) return west;
  const hE = windComponents(w.dir, w.kt, RUNWAYS[east].hdgTrue).head;
  return hE > 1 ? east : west;
}

export function atisLetter(obsMs) {
  const h = Math.floor((obsMs || Date.now()) / 3600000);
  return ATIS_LETTERS[h % 26];
}

export function atisText({ letter, wx, rwyId }) {
  const w = windPhrase(wx);
  const t = new Date(wx?.observedMs || Date.now());
  const z = `${String(t.getUTCHours()).padStart(2, '0')}${String(t.getUTCMinutes()).padStart(2, '0')}`;
  const other = RUNWAYS[rwyId].pair === 'south' ? (rwyId.startsWith('07') ? '07L' : '25R') : rwyId.startsWith('07') ? '07R' : '25L';
  const parts = [
    `Deer Valley information ${letter}`,
    `${digits(+z, 4)} Zulu`,
    w.en,
    `visibility ${wx?.visSm ? digits(Math.min(10, wx.visSm)) : 'one zero'}`,
    wx?.sky || 'sky clear',
    wx?.tempC != null ? `temperature ${wx.tempC < 0 ? 'minus ' : ''}${digits(Math.abs(wx.tempC))}` : '',
    wx?.dewC != null ? `dewpoint ${wx.dewC < 0 ? 'minus ' : ''}${digits(Math.abs(wx.dewC))}` : '',
    wx?.altimInHg ? `altimeter ${digits(Math.round(wx.altimInHg * 100), 4)}` : 'altimeter two niner niner two',
    `landing and departing runways ${runwaySpoken(rwyId)} and ${runwaySpoken(other)}`,
    `advise on initial contact you have information ${letter}`,
  ].filter(Boolean);
  return {
    en: parts.join(', ') + '.',
    ko: `디어밸리 정보 ${letter}. ${w.ko}, 활주로 ${rwyId}·${other} 사용${wx?.altimInHg ? `, 고도계 ${wx.altimInHg.toFixed(2)}` : ''}. 처음 부를 때 "${letter} 받았다"고 말합니다.`,
  };
}

// 상황별 무전 한 쌍 (조종사 → 관제)
export function radio(kind, { tail, rwyId, wx, letter, seq = 1, traffic = null, side }) {
  const cs = callsign(tail);
  const rw = runwaySpoken(rwyId);
  const w = windPhrase(wx);
  const turn = side || (RUNWAYS[rwyId].traffic === 'right' ? 'right' : 'left');
  const turnKo = turn === 'right' ? '우선회' : '좌선회';
  switch (kind) {
    case 'ready':
      return [
        { who: 'pilot', en: `Deer Valley Tower, ${cs}, holding short runway ${rw}, ready for departure, remaining in the pattern, with ${letter}.`, ko: `타워, ${tail}, 활주로 ${rwyId} 앞 대기, 이륙 준비 완료, 패턴에 남겠다, 정보 ${letter} 받음.` },
        { who: 'tower', en: `${cs}, Deer Valley Tower, ${w.en}, runway ${rw}, cleared for takeoff, make ${turn} closed traffic.`, ko: `${tail}, ${w.ko}, 활주로 ${rwyId} 이륙 허가, ${turnKo} 패턴 비행.` },
      ];
    case 'downwind': {
      const tw = seq > 1 && traffic
        ? { en: `${cs}, number ${digits(seq)}, follow the Skyhawk on ${traffic}, runway ${rw}, cleared touch and go.`, ko: `${tail}, ${seq}번째, ${traffic === 'final' ? '파이널' : '베이스'}의 앞 비행기를 따라가고, 활주로 ${rwyId} 터치앤고 허가.` }
        : { en: `${cs}, ${w.en}, runway ${rw}, cleared touch and go.`, ko: `${tail}, ${w.ko}, 활주로 ${rwyId} 터치앤고 허가.` };
      return [
        { who: 'pilot', en: `Deer Valley Tower, ${cs}, ${turn} downwind runway ${rw}, touch and go.`, ko: `타워, ${tail}, 활주로 ${rwyId} ${turnKo} 다운윈드, 터치앤고 요청.` },
        { who: 'tower', ...tw },
      ];
    }
    case 'rejoin':
      return [
        { who: 'pilot', en: `Deer Valley Tower, ${cs}, returning to the pattern, with ${letter}.`, ko: `타워, ${tail}, 패턴으로 돌아가겠다, 정보 ${letter} 받음.` },
        { who: 'tower', en: `${cs}, enter ${turn} downwind runway ${rw}, report midfield.`, ko: `${tail}, 활주로 ${rwyId} ${turnKo} 다운윈드로 들어오고, 활주로 중간 옆에서 보고.` },
      ];
    case 'engine':
      return [
        { who: 'pilot', en: `Mayday, mayday, mayday, Deer Valley Tower, ${cs}, engine failure, landing runway ${rw}.`, ko: `메이데이 ×3, ${tail}, 엔진 고장, 활주로 ${rwyId}에 내리겠다.` },
        { who: 'tower', en: `${cs}, roger mayday, ${w.en}, runway ${rw}, cleared to land, any runway available.`, ko: `${tail}, 메이데이 알았다, ${w.ko}, 활주로 ${rwyId} 착륙 허가, 어느 활주로든 가능.` },
      ];
    case 'goaround':
      return [{ who: 'tower', en: `${cs}, go around, traffic on the runway.`, ko: `${tail}, 복행하라, 활주로에 다른 비행기.` }];
    case 'fullstop':
      return [{ who: 'tower', en: `${cs}, turn right next taxiway, contact ground point niner.`, ko: `${tail}, 다음 유도로로 오른쪽 빠지고, 지상 관제로 바꾸라.` }];
    default:
      return [];
  }
}
