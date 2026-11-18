// 서버 API: 메모리 DB로 실제 HTTP 요청을 보내 본다.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';
import { createMemoryPool } from '../src/db.js';
import { normalizeMetar, WeatherService } from '../src/weather.js';
import { attachMultiplayer, parseState } from '../src/multiplayer.js';

const sample = { sinkFpm: 140, centerlineFt: 5, fromThresholdFt: 1100, iasKt: 56, crabDeg: 2, bankDeg: 1, checklist: true };
const fakeWeather = { get: async () => ({ ok: true, dir: 60, kt: 7 }) };

async function boot() {
  const pool = await createMemoryPool();
  const app = createApp({ pool, mode: 'memory', weather: fakeWeather, rateMs: 0 });
  const server = http.createServer(app);
  attachMultiplayer(server);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base };
}
const post = (base, body) => fetch(`${base}/api/landings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('착륙 저장 → 서버가 점수를 다시 계산하고 기록판·로그북·리플레이에 나온다', async () => {
  const { server, base } = await boot();
  try {
    const res = await post(base, { pilot: '영준', tail: 'N172SP', runway: '25L', kind: 'touch_and_go', ...sample, score: 1, grade: 'D', track: [[0, 1, 0, 2, 0], [1, 5, 40, 6, 60]] });
    assert.equal(res.status, 201);
    const j = await res.json();
    assert.equal(j.grade, 'A'); // 브라우저가 보낸 score/grade는 무시
    const list = await (await fetch(`${base}/api/landings?range=today`)).json();
    assert.equal(list.landings.length, 1);
    assert.equal(list.landings[0].pilot, '영준');
    assert.equal(list.landings[0].has_track, true);
    const one = await (await fetch(`${base}/api/landings/${j.id}`)).json();
    assert.equal(one.track.length, 2);
    await post(base, { pilot: '영준', tail: 'N172SP', runway: '25L', kind: 'full_stop', ...sample, sinkFpm: 500 });
    const me = await (await fetch(`${base}/api/pilots/${encodeURIComponent('영준')}`)).json();
    assert.equal(me.total, 2);
    assert.equal(me.touchAndGo, 1);
    assert.equal(me.fullStop, 1);
  } finally {
    server.close();
  }
});

test('잘못된 기록은 400으로 막는다', async () => {
  const { server, base } = await boot();
  try {
    for (const bad of [
      { pilot: '', tail: 'N172SP', runway: '25L', kind: 'touch_and_go', ...sample },
      { pilot: 'a', tail: 'HL1234', runway: '25L', kind: 'touch_and_go', ...sample },
      { pilot: 'a', tail: 'N172SP', runway: '18', kind: 'touch_and_go', ...sample },
      { pilot: 'a', tail: 'N172SP', runway: '25L', kind: 'touch_and_go', ...sample, sinkFpm: 99999 },
      { pilot: 'a', tail: 'N172SP', runway: '25L', kind: 'touch_and_go', ...sample, track: [[0, 'x', 0, 0, 0]] },
    ]) {
      const r = await post(base, bad);
      assert.equal(r.status, 400, JSON.stringify(bad).slice(0, 80));
      assert.ok((await r.json()).error);
    }
    const r2 = await fetch(`${base}/api/landings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
    assert.equal(r2.status, 400);
    assert.equal((await fetch(`${base}/api/landings/abc`)).status, 400);
    assert.equal((await fetch(`${base}/api/landings/999`)).status, 404);
  } finally {
    server.close();
  }
});

test('METAR 정리와 날씨 실패 처리', async () => {
  const w = normalizeMetar({ rawOb: 'METAR KDVT 180953Z AUTO 06007KT 10SM CLR 11/05 A3010', wdir: 60, wspd: 7, visib: '10+', altim: 1019.4, temp: 10.6, dewp: 5, obsTime: 1794995580, clouds: [] });
  assert.equal(w.dir, 60);
  assert.equal(w.kt, 7);
  assert.equal(w.altimInHg, 30.1);
  assert.equal(w.visSm, 10);
  assert.equal(normalizeMetar({ wdir: 'VRB', wspd: 3 }).variable, true);
  const svc = new WeatherService({ fetchImpl: async () => { throw new Error('offline'); } });
  const r = await svc.get();
  assert.equal(r.ok, false);
});

test('멀티: 두 접속자가 서로의 위치와 채팅을 받는다, 이상한 위치는 버린다', async () => {
  assert.equal(parseState({ p: [0, 99999, 0], q: [0, 0, 0, 1] }), null);
  assert.ok(parseState({ p: [10, 50, -20], q: [0, 0, 0, 1], leg: 'final', rwy: '25L' }));
  const { server, base } = await boot();
  const url = base.replace('http', 'ws') + '/ws';
  const open = (nick) => new Promise((res) => {
    const ws = new WebSocket(url);
    const msgs = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d)));
    ws.on('open', () => { ws.send(JSON.stringify({ t: 'hello', nick, tail: 'N1AB' })); res({ ws, msgs }); });
  });
  try {
    const a = await open('가'), b = await open('나');
    await new Promise((r) => setTimeout(r, 150));
    a.ws.send(JSON.stringify({ t: 'state', p: [100, 300, -50], q: [0, 0, 0, 1], ias: 80, leg: 'downwind', rwy: '25L' }));
    b.ws.send(JSON.stringify({ t: 'chat', text: '다운윈드 진입합니다' }));
    await new Promise((r) => setTimeout(r, 400));
    const snap = b.msgs.filter((m) => m.t === 'snap').pop();
    assert.ok(snap.planes.some((p) => p.nick === '가' && p.leg === 'downwind'));
    assert.ok(a.msgs.some((m) => m.t === 'chat' && m.text === '다운윈드 진입합니다' && m.nick === '나'));
    a.ws.close(); b.ws.close();
  } finally {
    server.close();
  }
});
