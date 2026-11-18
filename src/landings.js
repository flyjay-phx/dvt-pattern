// 착륙 기록 API: 검증 → 서버에서 점수 다시 계산 → 저장. 기록판·로그북 조회.
import { Router } from 'express';
import { RUNWAYS, RUNWAY_IDS, FT } from '../public/sim/airport.js';
import { scoreLanding } from '../public/sim/scoring.js';

const KINDS = ['touch_and_go', 'full_stop'];
const MODES = ['normal', 'crosswind', 'engine_out'];
const MAX_TRACK = 1500;

export class InputError extends Error {}

const num = (v, name, lo, hi) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw new InputError(`${name} 값이 올바르지 않습니다 (${lo}~${hi}).`);
  return v;
};

export function cleanName(v) {
  if (typeof v !== 'string') throw new InputError('닉네임을 입력해 주세요.');
  const s = v.normalize('NFC').replace(/[\u0000-\u001f\u007f<>]/g, '').trim();
  if ([...s].length < 1 || [...s].length > 16) throw new InputError('닉네임은 1~16자로 써 주세요.');
  return s;
}

export function validateLanding(b) {
  if (!b || typeof b !== 'object') throw new InputError('보낼 내용이 없습니다.');
  const pilot = cleanName(b.pilot);
  const tail = typeof b.tail === 'string' && /^N[0-9A-Z]{2,5}$/.test(b.tail) ? b.tail : null;
  if (!tail) throw new InputError('기체 번호 형식이 올바르지 않습니다.');
  if (!RUNWAY_IDS.includes(b.runway)) throw new InputError('활주로가 올바르지 않습니다.');
  if (!KINDS.includes(b.kind)) throw new InputError('착륙 종류가 올바르지 않습니다.');
  const mode = MODES.includes(b.mode) ? b.mode : 'normal';
  const m = {
    sinkFpm: num(b.sinkFpm, '하강률', 0, 1100),
    centerlineFt: num(b.centerlineFt, '중심선 거리', 0, 80),
    fromThresholdFt: num(b.fromThresholdFt, '접지 위치', -50, 8300),
    iasKt: num(b.iasKt, '접지 속도', 20, 140),
    crabDeg: num(b.crabDeg, '어긋난 각도', 0, 90),
    bankDeg: num(b.bankDeg, '기울기', 0, 20),
    checklist: b.checklist === true,
  };
  const rwy = RUNWAYS[b.runway];
  const result = scoreLanding({ ...m, runwayWidthFt: rwy.width / FT });
  let track = null;
  if (b.track != null) {
    if (!Array.isArray(b.track) || b.track.length > MAX_TRACK) throw new InputError('비행 궤적이 너무 깁니다.');
    track = b.track.map((p) => {
      if (!Array.isArray(p) || p.length !== 5 || !p.every((x) => typeof x === 'number' && Number.isFinite(x))) throw new InputError('비행 궤적 형식이 올바르지 않습니다.');
      const [t, x, alt, z, ias] = p;
      if (Math.abs(x) > 40000 || Math.abs(z) > 40000 || alt < 0 || alt > 20000 || t < 0 || t > 7200 || ias < 0 || ias > 250) throw new InputError('비행 궤적 값이 범위를 벗어났습니다.');
      return [Math.round(t * 10) / 10, Math.round(x), Math.round(alt), Math.round(z), Math.round(ias)];
    });
  }
  return {
    pilot, tail, runway: b.runway, kind: b.kind, mode, ...m, result, track,
    windText: typeof b.windText === 'string' ? b.windText.slice(0, 40).replace(/[<>]/g, '') : '',
    simHour: typeof b.simHour === 'number' && b.simHour >= 0 && b.simHour <= 24 ? b.simHour : null,
    flightTimeS: typeof b.flightTimeS === 'number' && b.flightTimeS >= 0 && b.flightTimeS <= 7200 ? Math.round(b.flightTimeS) : 0,
  };
}

const LIST_COLS = `id, pilot, tail, runway, kind, mode, sink_fpm, centerline_ft, from_threshold_ft, ias_kt, crab_deg, bank_deg, checklist, wind_text, sim_hour, flight_time_s, score, grade, created_at, (track is not null) as has_track`;

export function landingRoutes(pool, { rateMs = 8000 } = {}) {
  const r = Router();
  const lastPost = new Map();

  r.post('/landings', async (req, res, next) => {
    try {
      const ip = req.ip || 'x';
      const now = Date.now();
      if (now - (lastPost.get(ip) || 0) < rateMs) return res.status(429).json({ error: '잠시 뒤에 다시 저장해 주세요.' });
      const v = validateLanding(req.body);
      lastPost.set(ip, now);
      if (lastPost.size > 5000) lastPost.clear();
      const { rows } = await pool.query(
        `insert into dvt_landings (pilot, tail, runway, kind, mode, sink_fpm, centerline_ft, from_threshold_ft, ias_kt, crab_deg, bank_deg, checklist, wind_text, sim_hour, flight_time_s, score, grade, track)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning id, created_at`,
        [v.pilot, v.tail, v.runway, v.kind, v.mode, Math.round(v.sinkFpm), Math.round(v.centerlineFt), Math.round(v.fromThresholdFt), Math.round(v.iasKt), Math.round(v.crabDeg), Math.round(v.bankDeg), v.checklist, v.windText, v.simHour, v.flightTimeS, v.result.score, v.result.grade, v.track ? JSON.stringify(v.track) : null],
      );
      res.status(201).json({ id: Number(rows[0].id), created_at: rows[0].created_at, ...v.result });
    } catch (e) {
      next(e);
    }
  });

  r.get('/landings', async (req, res, next) => {
    try {
      const range = ['today', 'week', 'all'].includes(req.query.range) ? req.query.range : 'today';
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
      const since = range === 'all' ? new Date(0) : new Date(Date.now() - (range === 'today' ? 1 : 7) * 86400000);
      const { rows } = await pool.query(`select ${LIST_COLS} from dvt_landings where created_at >= $1 order by score desc, created_at desc limit $2`, [since, limit]);
      res.json({ range, landings: rows.map(fix) });
    } catch (e) {
      next(e);
    }
  });

  r.get('/landings/recent', async (_req, res, next) => {
    try {
      const { rows } = await pool.query(`select ${LIST_COLS} from dvt_landings order by created_at desc limit 15`);
      res.json({ landings: rows.map(fix) });
    } catch (e) {
      next(e);
    }
  });

  r.get('/landings/:id', async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isSafeInteger(id) || id < 1) throw new InputError('기록 번호가 올바르지 않습니다.');
      const { rows } = await pool.query(`select ${LIST_COLS}, track from dvt_landings where id = $1`, [id]);
      if (!rows[0]) return res.status(404).json({ error: '기록을 찾지 못했습니다.' });
      const row = fix(rows[0]);
      row.track = typeof rows[0].track === 'string' ? JSON.parse(rows[0].track) : rows[0].track;
      res.json(row);
    } catch (e) {
      next(e);
    }
  });

  r.get('/pilots/:name', async (req, res, next) => {
    try {
      const pilot = cleanName(req.params.name);
      const { rows } = await pool.query(`select ${LIST_COLS} from dvt_landings where pilot = $1 order by created_at desc limit 200`, [pilot]);
      const list = rows.map(fix);
      const n = list.length;
      const sum = (f) => list.reduce((a, x) => a + f(x), 0);
      res.json({
        pilot,
        total: n,
        touchAndGo: list.filter((x) => x.kind === 'touch_and_go').length,
        fullStop: list.filter((x) => x.kind === 'full_stop').length,
        best: n ? Math.max(...list.map((x) => x.score)) : null,
        avgScore: n ? Math.round(sum((x) => x.score) / n) : null,
        avgSink: n ? Math.round(sum((x) => x.sink_fpm) / n) : null,
        flightMinutes: Math.round(sum((x) => x.flight_time_s) / 60),
        recent: list.slice(0, 10),
      });
    } catch (e) {
      next(e);
    }
  });
  return r;
}

function fix(row) {
  const o = { ...row, id: Number(row.id) };
  delete o.track;
  return o;
}
