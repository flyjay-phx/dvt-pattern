// KDVT 실제 날씨: 미국 기상청 aviationweather.gov 공개 METAR (키 없음). 10분 캐시.
const URL = 'https://aviationweather.gov/api/data/metar?ids=KDVT&format=json';

export function normalizeMetar(m) {
  if (!m || typeof m !== 'object') throw new Error('METAR 형식이 다릅니다.');
  const variable = m.wdir === 'VRB';
  const dir = typeof m.wdir === 'number' ? m.wdir : 0;
  const kt = typeof m.wspd === 'number' ? m.wspd : 0;
  const gust = typeof m.wgst === 'number' && m.wgst > kt ? m.wgst : null;
  const visSm = typeof m.visib === 'number' ? m.visib : parseFloat(String(m.visib || '10')) || 10;
  const clouds = Array.isArray(m.clouds) ? m.clouds.filter((c) => c && c.cover).map((c) => ({ cover: String(c.cover), baseFt: Number(c.base) || null })) : [];
  const coverWord = { FEW: 'few clouds', SCT: 'scattered', BKN: 'broken', OVC: 'overcast' };
  const sky = clouds.length
    ? clouds.map((c) => `${coverWord[c.cover] || c.cover}${c.baseFt ? ` ${c.baseFt.toLocaleString('en-US')}` : ''}`).join(', ')
    : 'sky clear';
  return {
    ok: true,
    source: 'metar',
    raw: String(m.rawOb || '').slice(0, 200),
    dir, kt, gust, variable,
    visSm,
    tempC: typeof m.temp === 'number' ? Math.round(m.temp) : null,
    dewC: typeof m.dewp === 'number' ? Math.round(m.dewp) : null,
    altimInHg: typeof m.altim === 'number' ? Math.round((m.altim / 33.8639) * 100) / 100 : null,
    clouds,
    sky,
    observedMs: typeof m.obsTime === 'number' ? m.obsTime * 1000 : Date.parse(m.reportTime) || Date.now(),
  };
}

export class WeatherService {
  constructor({ fetchImpl = globalThis.fetch, ttlMs = 10 * 60 * 1000 } = {}) {
    this.fetch = fetchImpl;
    this.ttl = ttlMs;
    this.cache = null;
    this.at = 0;
    this.pending = null;
  }
  async get() {
    if (this.cache && Date.now() - this.at < this.ttl) return this.cache;
    if (!this.pending) {
      this.pending = (async () => {
        try {
          const res = await this.fetch(URL, { headers: { 'User-Agent': 'dvt-pattern-trainer (student project)' }, signal: AbortSignal.timeout(8000) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const arr = await res.json();
          this.cache = normalizeMetar(Array.isArray(arr) ? arr[0] : arr);
          this.at = Date.now();
        } catch (e) {
          // 실패하면 지난 값을 쓰고, 없으면 실패를 그대로 알린다 (지어낸 날씨를 주지 않음)
          if (!this.cache) return { ok: false, reason: `실시간 날씨를 받지 못했습니다: ${e.message}` };
        } finally {
          this.pending = null;
        }
        return this.cache;
      })();
    }
    return this.pending;
  }
}
