// 실시간 멀티: 같은 시간 접속한 비행기 위치와 무전 채팅을 WebSocket으로 나눈다.
// 서버가 위치 범위·보내는 빈도·글 길이를 검사하고, 10Hz로 모아서 보낸다. 채팅은 저장하지 않는다.
import { WebSocketServer } from 'ws';
import { cleanName } from './landings.js';
import { RUNWAY_IDS } from '../public/sim/airport.js';

const MAX_CLIENTS = 60;
const LEGS = ['ground', 'takeoff', 'upwind', 'crosswind', 'downwind', 'base', 'final', 'rollout', 'outside'];
const fin = (x, lo, hi) => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;

export function parseState(m) {
  if (!Array.isArray(m.p) || m.p.length !== 3 || !Array.isArray(m.q) || m.q.length !== 4) return null;
  const [x, y, z] = m.p;
  if (!fin(x, -40000, 40000) || !fin(y, -50, 8000) || !fin(z, -40000, 40000)) return null;
  if (!m.q.every((c) => fin(c, -1.01, 1.01))) return null;
  return {
    p: [x, y, z].map((n) => Math.round(n * 10) / 10),
    q: m.q.map((n) => Math.round(n * 1000) / 1000),
    ias: fin(m.ias, 0, 250) ? Math.round(m.ias) : 0,
    leg: LEGS.includes(m.leg) ? m.leg : 'outside',
    rwy: RUNWAY_IDS.includes(m.rwy) ? m.rwy : null,
    flaps: fin(m.flaps, 0, 30) ? Math.round(m.flaps) : 0,
    lights: m.lights === true,
  };
}

export function attachMultiplayer(server) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
  const clients = new Map();
  let nextId = 1;

  const send = (ws, obj) => ws.readyState === 1 && ws.send(JSON.stringify(obj));
  const broadcast = (obj, except) => {
    const s = JSON.stringify(obj);
    for (const [ws] of clients) if (ws !== except && ws.readyState === 1) ws.send(s);
  };

  wss.on('connection', (ws) => {
    if (clients.size >= MAX_CLIENTS) {
      send(ws, { t: 'full', text: '지금 공항이 가득 찼습니다. 잠시 뒤에 다시 들어와 주세요.' });
      return ws.close();
    }
    const c = { id: nextId++, nick: null, tail: null, state: null, lastState: 0, lastChat: 0, count: 0, windowStart: Date.now(), alive: true };
    clients.set(ws, c);
    ws.on('pong', () => (c.alive = true));
    ws.on('message', (buf) => {
      const now = Date.now();
      if (now - c.windowStart > 1000) { c.windowStart = now; c.count = 0; }
      if (++c.count > 30) return; // 1초에 30개 넘으면 버림
      let m;
      try { m = JSON.parse(buf.toString()); } catch { return; }
      if (!m || typeof m !== 'object') return;
      if (m.t === 'hello') {
        try { c.nick = cleanName(m.nick); } catch { c.nick = '나그네'; }
        c.tail = typeof m.tail === 'string' && /^N[0-9A-Z]{2,5}$/.test(m.tail) ? m.tail : 'N172SP';
        send(ws, { t: 'welcome', id: c.id, online: clients.size });
        broadcast({ t: 'sys', text: `${c.nick}(${c.tail}) 님이 디어밸리에 들어왔습니다.` }, ws);
      } else if (m.t === 'state' && c.nick) {
        if (now - c.lastState < 60) return;
        const s = parseState(m);
        if (s) { c.state = s; c.lastState = now; }
      } else if (m.t === 'chat' && c.nick) {
        if (now - c.lastChat < 1500 || typeof m.text !== 'string') return;
        const text = m.text.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);
        if (!text) return;
        c.lastChat = now;
        broadcast({ t: 'chat', id: c.id, nick: c.nick, tail: c.tail, text, at: now });
      }
    });
    ws.on('close', () => {
      clients.delete(ws);
      if (c.nick) broadcast({ t: 'sys', text: `${c.nick} 님이 나갔습니다.` });
      broadcast({ t: 'leave', id: c.id });
    });
    ws.on('error', () => {});
  });

  const snap = setInterval(() => {
    if (!clients.size) return;
    const planes = [];
    for (const [, c] of clients) if (c.state && Date.now() - c.lastState < 5000) planes.push({ id: c.id, nick: c.nick, tail: c.tail, ...c.state });
    broadcast({ t: 'snap', planes, online: clients.size });
  }, 100);
  const beat = setInterval(() => {
    for (const [ws, c] of clients) {
      if (!c.alive) { ws.terminate(); continue; }
      c.alive = false;
      try { ws.ping(); } catch {}
    }
  }, 30000);
  wss.on('close', () => { clearInterval(snap); clearInterval(beat); });
  return { wss, count: () => clients.size };
}
