// 디어밸리 터치앤고: 화면·조종·패턴 코치·무전·채점·멀티를 묶는 메인 코드
import * as THREE from 'three';
import { buildWorld } from './world/scene.js';
import { buildC172, nameTag } from './world/aircraft.js';
import { RUNWAYS, PAIRS, AIRPORT, FT, rad, wrap180, wrap360, runwayFrame, pointOnRunway, surfaceAt, terrainHeight, hdgMag } from './sim/airport.js';
import { createAircraft, stepAircraft, readout, airDensity, FLAP_STEPS, C172 } from './sim/flight.js';
import { scoreLanding } from './sim/scoring.js';
import { sunPosition, phoenixNow, phoenixToUtc, sunTimes, fmtHour } from './sim/sun.js';
import { WindModel, windComponents } from './sim/weather.js';
import { classifyLeg, coach, LEGS, CHECKLIST } from './sim/pattern.js';
import { selectRunway, radio, atisText, atisLetter, randomTail } from './sim/atc.js';
import { Panel } from './ui/panel.js';
import { SimAudio } from './ui/audio.js';
import { Net } from './ui/net.js';
import { drawReplay } from './ui/replay.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(`dvt:${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`dvt:${k}`, JSON.stringify(v)); } catch {} },
};
const pad3 = (n) => String(Math.round(wrap360(n)) % 360 || 360).padStart(3, '0');

// 렌더러·장면
const renderer = new THREE.WebGLRenderer({ canvas: $('view'), antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.3, 160000);
const world = buildWorld(scene, renderer);
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

const panel = new Panel($('panel'));
const audio = new SimAudio();
const wind = new WindModel();

// 상태
const S = {
  phase: 'menu',
  settings: Object.assign({ time: 'real', hour: 12, timeSetAt: Date.now(), wind: 'metar', manual: { dir: 250, kt: 8, gust: 0 }, coach: true, pattern: true, voice: true, sound: true }, store.get('settings', {})),
  wx: null,
  nick: store.get('nick', ''),
  tail: store.get('tail', '') || randomTail(),
  pair: store.get('pair', 'south'),
  mode: 'normal',
  rwyId: '25L',
  ac: null,
  ctl: { elevator: 0, aileron: 0, rudder: 0, throttle: 0, flapsTarget: 0, brakes: 0, trim: 0, engineFailed: false },
  cam: 'chase',
  orbit: { yaw: 0, pitch: 0 },
  t: 0,
  lap: null,
  landed: null,
  stopT: 0,
  crashT: 0,
  leg: 'ground',
  legSince: 0,
  peers: new Map(),
  online: 1,
  env: null,
  r: null,
  mapBig: false,
};
S.settings.timeSetAt = Date.now();
const keys = new Set();

// 비행기 메시
const plane = buildC172({ stripe: '#c0392b', tail: S.tail, landingLight: true });
plane.visible = false;
scene.add(plane);

// 시간·바람
function simUtc() {
  if (S.settings.time === 'real') return Date.now();
  const n = phoenixNow();
  return phoenixToUtc(n.y, n.mo, n.d, S.settings.hour) + (Date.now() - S.settings.timeSetAt);
}
function windBase() {
  if (S.settings.wind === 'manual') {
    const m = S.settings.manual;
    return { dir: m.dir, kt: m.kt, gust: m.gust > m.kt ? m.gust : null, variable: false, source: '연습 설정' };
  }
  if (S.wx?.ok) return { dir: S.wx.dir, kt: S.wx.kt, gust: S.wx.gust, variable: S.wx.variable, source: 'METAR' };
  return { dir: 0, kt: 0, gust: null, variable: false, source: '날씨 없음' };
}
function windText(b = windBase()) {
  if (b.kt < 1) return '무풍';
  return `${b.variable ? 'VRB' : pad3(b.dir)}°${Math.round(b.kt)}kt${b.gust ? ` G${b.gust}` : ''}`;
}
function effectiveMode() {
  if (S.mode === 'engine_out') return 'engine_out';
  const b = windBase();
  if (S.settings.wind === 'manual' && Math.abs(windComponents(b.dir, b.kt, RUNWAYS[S.rwyId].hdgTrue).cross) >= 8) return 'crosswind';
  return 'normal';
}
function applyWind() {
  wind.set(windBase());
}
async function loadWeather() {
  try {
    const res = await fetch('/api/weather');
    S.wx = await res.json();
  } catch {
    S.wx = { ok: false, reason: '서버에 연결하지 못했습니다.' };
  }
  applyWind();
  renderMenuWx();
  if (S.phase === 'flying' && S.ac?.onGround && !S.landed) pickRunway(false);
}
function renderMenuWx() {
  const n = phoenixNow(simUtc());
  const st = sunTimes(n.y, n.mo, n.d);
  const t = `피닉스 현지 <b>${fmtHour(phoenixNow().hour)}</b> MST · 일출 ${st.rise ? fmtHour(st.rise) : '-'} · 일몰 ${st.set ? fmtHour(st.set) : '-'}`;
  const wx = S.wx;
  if (!wx) return ($('menu-wx').innerHTML = `${t}<br>KDVT 날씨를 불러오는 중…`);
  if (!wx.ok) return ($('menu-wx').innerHTML = `${t}<br>실시간 날씨를 받지 못해 바람 없음으로 시작합니다. 설정(Esc)에서 바람을 직접 정할 수 있습니다.`);
  const rwy = selectRunway(S.pair, windBase());
  $('menu-wx').innerHTML = `${t}<br><b>METAR</b> ${esc(wx.raw)}<br>바람 ${esc(windText())} · 기온 ${wx.tempC ?? '-'}°C · 고도계 ${wx.altimInHg?.toFixed(2) ?? '-'} · 지금 바람이면 활주로 <b>${rwy}</b>`;
}

function pickRunway(announce) {
  const id = selectRunway(S.pair, windBase());
  if (id === S.rwyId) return false;
  S.rwyId = id;
  world.setPattern(id, S.settings.pattern);
  if (announce) addRadio([{ who: 'tower', en: `All aircraft, Deer Valley Tower, wind change, now using runway ${id}.`, ko: `모든 항공기, 바람이 바뀌어 이제 활주로 ${id}를 씁니다.` }]);
  return true;
}

// 비행 시작·초기화
function newLap() {
  S.lap = { startT: S.t, track: [], lastTrackT: -1, readyCalled: false, downwindCalled: false, rejoinCalled: false, goAroundCalled: false, engineCut: false, check: {}, outsideT: 0 };
}
function spawn() {
  pickRunway(false);
  const rwy = RUNWAYS[S.rwyId];
  const p = pointOnRunway(rwy, 25, 0);
  S.ac = createAircraft({ x: p.x, z: p.z, heading: rwy.hdgTrue });
  Object.assign(S.ctl, { elevator: 0, aileron: 0, rudder: 0, throttle: 0, flapsTarget: 0, brakes: 0, trim: 0.1, engineFailed: false });
  S.landed = null;
  S.stopT = 0;
  S.crashT = 0;
  S.orbit = { yaw: 0, pitch: 0 };
  newLap();
  world.setPattern(S.rwyId, S.settings.pattern);
  world.hideTrack();
  $('result').hidden = true;
  hideWarn();
  plane.visible = true;
  camInit = true;
  setTimeout(() => {
    if (S.phase !== 'flying' || S.lap.readyCalled) return;
    S.lap.readyCalled = true;
    addRadio(radio('ready', ctx()));
  }, 1500);
}
function ctx(extra = {}) {
  return { tail: S.tail, rwyId: S.rwyId, wx: { ...windBase(), observedMs: S.wx?.observedMs }, letter: currentAtis(), ...extra };
}
function currentAtis() {
  return atisLetter(S.settings.wind === 'manual' ? Date.now() : S.wx?.observedMs);
}

const net = new Net({
  welcome: (m) => { S.online = m.online; },
  snap: (m) => { S.online = m.online; updatePeers(m.planes); },
  chat: (m) => addLine('chat', `${m.nick} (${m.tail})`, m.text),
  sys: (m) => addLine('sys', '', m.text),
  leave: (m) => removePeer(m.id),
  full: (m) => addLine('sys', '', m.text),
  status: (t) => addLine('sys', '', `멀티: ${t}`),
});

$('f-nick').value = S.nick;
$('f-tail').value = S.tail;
$('f-pair').value = S.pair;
$('start-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const nick = $('f-nick').value.trim().slice(0, 16);
  const tail = $('f-tail').value.trim().toUpperCase();
  if (!nick) return $('f-nick').focus();
  if (!/^N[0-9A-Z]{2,5}$/.test(tail)) { $('f-tail').setCustomValidity('N으로 시작하는 기체 번호 (예: N172SP)'); $('f-tail').reportValidity(); return; }
  S.nick = nick; S.tail = tail; S.pair = $('f-pair').value; S.mode = $('f-mode').value;
  store.set('nick', nick); store.set('tail', tail); store.set('pair', S.pair);
  audio.start();
  audio.on = S.settings.sound; audio.voice = S.settings.voice;
  if (!net.hello) net.connect(nick, tail); else { net.hello = { t: 'hello', nick, tail }; net.ws?.close(); }
  S.phase = 'flying';
  $('menu').hidden = true;
  $('hud').hidden = false;
  addLine('sys', '', `${S.nick} 님, ${S.tail}로 활주로 ${selectRunway(S.pair, windBase())}에 정렬했습니다. ↑를 길게 눌러 출력을 올리세요.`);
  spawn();
});
$('f-tail').addEventListener('input', () => $('f-tail').setCustomValidity(''));

// 무전 기록
function addLine(kind, who, text, ko) {
  const box = $('radio-log');
  const d = document.createElement('div');
  d.className = `ln ${kind}`;
  if (who) { const w = document.createElement('div'); w.className = 'who'; w.textContent = who; d.append(w); }
  const e = document.createElement('div'); e.className = kind === 'chat' || kind === 'sys' ? '' : 'en'; e.textContent = text; d.append(e);
  if (ko) { const k = document.createElement('div'); k.className = 'ko'; k.textContent = ko; d.append(k); }
  box.append(d);
  while (box.children.length > 40) box.firstChild.remove();
  box.scrollTop = box.scrollHeight;
}
function addRadio(lines) {
  for (const l of lines) addLine(l.who, l.who === 'tower' ? 'DEER VALLEY TOWER' : `나 · ${S.tail}`, l.en, l.ko);
  audio.speak(lines);
}

// 입력
const GAME_KEYS = ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'KeyB', 'Space'];
addEventListener('keydown', (e) => {
  const typing = document.activeElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName);
  if (e.code === 'Escape') {
    if (document.activeElement === $('chat')) { $('chat').blur(); return; }
    const open = document.querySelector('.sheet:not([hidden])');
    if (open) { open.hidden = true; return; }
    if (S.phase === 'flying') openSettings();
    return;
  }
  if (typing || S.phase !== 'flying') return;
  if (GAME_KEYS.includes(e.code)) e.preventDefault();
  keys.add(e.code);
  if (e.repeat) return;
  switch (e.code) {
    case 'KeyF': S.ctl.flapsTarget = FLAP_STEPS[Math.min(3, FLAP_STEPS.indexOf(S.ctl.flapsTarget) + 1)]; break;
    case 'KeyV': S.ctl.flapsTarget = FLAP_STEPS[Math.max(0, FLAP_STEPS.indexOf(S.ctl.flapsTarget) - 1)]; break;
    case 'BracketLeft': S.ctl.trim = Math.max(-0.5, S.ctl.trim - 0.03); break;
    case 'BracketRight': S.ctl.trim = Math.min(0.5, S.ctl.trim + 0.03); break;
    case 'KeyC': S.cam = { chase: 'cockpit', cockpit: 'tower', tower: 'chase' }[S.cam]; camInit = true; toast({ chase: '뒤에서 보기', cockpit: '조종석', tower: '관제탑에서 보기' }[S.cam], 1200); break;
    case 'KeyK': toggleChecklist(); break;
    case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': case 'Digit5':
      if (!$('checklist').hidden) { const it = CHECKLIST[+e.code.slice(5) - 1]; S.lap.check[it.key] = !S.lap.check[it.key]; renderChecklist(); }
      break;
    case 'KeyI': playAtis(); break;
    case 'KeyM': S.mapBig = !S.mapBig; $('minimap').classList.toggle('big', S.mapBig); break;
    case 'KeyR': spawn(); toast('활주로로 돌아왔습니다', 1400); break;
    case 'KeyL': openBoard('today'); break;
    case 'KeyH': $('help').hidden = false; break;
    case 'Enter': e.preventDefault(); $('chat').focus(); break;
  }
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
$('chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const t = $('chat').value.trim();
  if (t) net.chat(t);
  $('chat').value = '';
  $('chat').blur();
});
// 마우스로 둘러보기
{
  let drag = null;
  $('view').addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, yaw: S.orbit.yaw, pitch: S.orbit.pitch }; });
  addEventListener('pointerup', () => (drag = null));
  addEventListener('pointermove', (e) => {
    if (!drag) return;
    S.orbit.yaw = drag.yaw - (e.clientX - drag.x) * 0.006;
    S.orbit.pitch = Math.max(-0.3, Math.min(1.2, drag.pitch + (e.clientY - drag.y) * 0.004));
  });
  $('view').addEventListener('dblclick', () => (S.orbit = { yaw: 0, pitch: 0 }));
}

function controls(dt) {
  const k = (c) => (keys.has(c) ? 1 : 0);
  const ease = (cur, tgt, rate) => cur + (tgt - cur) * Math.min(1, dt * rate);
  S.ctl.elevator = ease(S.ctl.elevator, (k('KeyS') - k('KeyW')) * 0.75, 4);
  S.ctl.aileron = ease(S.ctl.aileron, (k('KeyD') - k('KeyA')) * 0.8, 5);
  S.ctl.rudder = ease(S.ctl.rudder, k('KeyE') - k('KeyQ'), 5);
  S.ctl.throttle = Math.max(0, Math.min(1, S.ctl.throttle + (k('ArrowUp') - k('ArrowDown')) * 0.55 * dt));
  S.ctl.brakes = k('KeyB') || k('Space');
}

// 체크리스트
function toggleChecklist() {
  $('checklist').hidden = !$('checklist').hidden;
  renderChecklist();
}
function allChecked() {
  return CHECKLIST.every((c) => S.lap?.check[c.key]);
}
function renderChecklist() {
  const el = $('checklist');
  if (el.hidden) return;
  el.innerHTML = `<h4>착륙 전 체크리스트</h4>${CHECKLIST.map((c, i) => `<label><input type="checkbox" data-k="${c.key}" ${S.lap.check[c.key] ? 'checked' : ''}/> <span>${i + 1}. ${esc(c.ko)}<small>${esc(c.en)}</small></span></label>`).join('')}${allChecked() ? '<div class="done">완료 · 착륙 점수 +3</div>' : ''}`;
  el.querySelectorAll('input').forEach((inp) => inp.addEventListener('change', () => { S.lap.check[inp.dataset.k] = inp.checked; renderChecklist(); }));
}

// 착륙 처리
function onTouchdown(e) {
  audio.thump('touch');
  if (e.surface.type !== 'runway') {
    S.landed = { off: true };
    toast('활주로 밖에 내렸습니다. 이번 착륙은 기록하지 않습니다.', 3500);
    return;
  }
  const base = RUNWAYS[e.surface.id];
  const rwy = [base, RUNWAYS[base.opposite]].reduce((a, b) => (Math.abs(wrap180(e.headingTrue - a.hdgTrue)) <= Math.abs(wrap180(e.headingTrue - b.hdgTrue)) ? a : b));
  const f = runwayFrame(rwy, S.ac.pos.x, S.ac.pos.z);
  const r = readout(S.ac, S.env);
  const m = {
    sinkFpm: Math.max(0, (-e.vyMs / FT) * 60),
    centerlineFt: Math.min(80, Math.abs(f.d) / FT),
    fromThresholdFt: Math.max(-50, f.s / FT),
    iasKt: Math.max(20, Math.min(140, e.iasKt)),
    crabDeg: Math.min(90, Math.abs(wrap180(e.headingTrue - r.trackTrue))),
    bankDeg: Math.min(20, Math.abs(e.bank)),
    checklist: allChecked(),
  };
  const result = scoreLanding({ ...m, runwayWidthFt: rwy.width / FT });
  pushTrack(true);
  S.landed = { m, result, rwyId: rwy.id, track: S.lap.track.slice(), flightTime: S.t - S.lap.startT, mode: effectiveMode(), wind: windText(), posted: false };
  showResult();
}
function pushTrack(force) {
  if (!S.lap || !S.ac || !S.r) return;
  const t = S.t - S.lap.startT;
  if (!force && t - S.lap.lastTrackT < 0.5) return;
  S.lap.lastTrackT = t;
  S.lap.track.push([Math.round(t * 10) / 10, Math.round(S.ac.pos.x), Math.round(S.r.aglFt), Math.round(S.ac.pos.z), Math.round(S.r.iasKt)]);
  if (S.lap.track.length > 1500) S.lap.track.shift();
}
async function postLanding(kind) {
  const L = S.landed;
  if (!L || L.off || L.posted) return;
  L.posted = true;
  L.kind = kind;
  const n = phoenixNow(simUtc());
  const body = { pilot: S.nick, tail: S.tail, runway: L.rwyId, kind, mode: L.mode, ...L.m, windText: L.wind, simHour: n.hour, flightTimeS: Math.round(L.flightTime), track: L.track.length > 1 ? L.track : null };
  try {
    const res = await fetch('/api/landings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json();
    L.saved = res.ok ? `기록판에 저장됨 (#${j.id}, ${kind === 'touch_and_go' ? '터치앤고' : '풀스톱'})` : `저장 못 함: ${j.error || res.status}`;
  } catch {
    L.saved = '저장 못 함: 서버에 연결하지 못했습니다.';
  }
  showResult();
}
function showResult() {
  const L = S.landed;
  if (!L || L.off) return;
  const el = $('result');
  const R = L.result;
  el.innerHTML = `<div class="top"><div class="big g-${R.grade}">${R.grade}</div><div><h3>${R.score}점 · ${esc(R.label)}</h3><div class="sub">활주로 ${L.rwyId} · ${Math.round(L.m.sinkFpm)}fpm · ${Math.round(L.m.iasKt)}kt · ${esc(L.wind)}</div></div></div>
    <ul>${R.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
    <div class="sub">${esc(L.saved || '다시 이륙하면 터치앤고, 멈추면 풀스톱으로 저장됩니다.')}</div>
    <div class="row"><button class="ghost" id="r-replay">리플레이</button><button class="ghost" id="r-close">닫기</button></div>`;
  el.hidden = false;
  $('r-replay').onclick = () => openReplay(L.track, L.rwyId, `방금 착륙 · ${L.rwyId} · ${R.score}점`);
  $('r-close').onclick = () => (el.hidden = true);
}

function handleEvents(evs) {
  for (const e of evs) {
    if (e.type === 'touchdown') onTouchdown(e);
    else if (e.type === 'liftoff') {
      if (S.landed && !S.landed.off) postLanding('touch_and_go');
      if (S.landed) setTimeout(() => { if (!S.ac?.onGround) $('result').hidden = true; }, 9000);
      S.landed = null;
      newLap();
      if (!S.lap.readyCalled) S.lap.readyCalled = true;
    } else if (e.type === 'crash') {
      audio.thump('crash');
      showWarn(`추락: ${e.reason} · R로 다시 시작`);
      S.landed = null;
    }
  }
}

// 무전 자동 진행
function radioLogic(leg, f) {
  const lap = S.lap;
  if (!lap) return;
  if (leg === 'outside') lap.outsideT += 1 / 10;
  if (['crosswind', 'downwind'].includes(leg) && lap.outsideT > 8 && !lap.rejoinCalled) {
    lap.rejoinCalled = true;
    addRadio(radio('rejoin', ctx()));
  }
  if (leg === 'downwind' && !lap.downwindCalled && f.s < RUNWAYS[S.rwyId].len * 0.75) {
    lap.downwindCalled = true;
    const ahead = [...S.peers.values()].filter((p) => p.s?.rwy === S.rwyId && ['base', 'final'].includes(p.s.leg));
    const seq = ahead.length + 1;
    addRadio(radio('downwind', ctx({ seq, traffic: ahead[0]?.s.leg })));
  }
  if (S.mode === 'engine_out' && leg === 'downwind' && !lap.engineCut && f.s < 250) {
    lap.engineCut = true;
    S.ctl.engineFailed = true;
    showWarn('엔진 고장! 최량 활공 68kt 유지하고 활주로로', true);
    setTimeout(hideWarn, 4000);
    addRadio(radio('engine', ctx()));
  }
  if (leg === 'final' && S.r.aglFt < 400 && !lap.goAroundCalled) {
    const onRwy = [...S.peers.values()].some((p) => p.s?.rwy === S.rwyId && ['takeoff', 'rollout', 'ground'].includes(p.s.leg) && Math.abs(runwayFrame(RUNWAYS[S.rwyId], p.s.p[0], p.s.p[2]).d) < 30 && runwayFrame(RUNWAYS[S.rwyId], p.s.p[0], p.s.p[2]).s > -50);
    if (onRwy) { lap.goAroundCalled = true; addRadio(radio('goaround', ctx())); toast('복행: 풀 스로틀, 플랩 단계적으로 올리기', 4000); }
  }
}

// 경고·알림
let toastTimer = null;
function toast(text, ms = 2500) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}
let warnSticky = false;
function showWarn(text, soft = false) {
  const el = $('warn');
  el.textContent = text;
  el.classList.toggle('soft', soft);
  el.hidden = false;
  warnSticky = true;
}
function hideWarn() {
  $('warn').hidden = true;
  warnSticky = false;
}

// 다른 비행기
const PEER_COLORS = ['#1f5fbf', '#2e7d32', '#6a1b9a', '#ef6c00', '#00838f', '#ad1457', '#5d4037'];
function updatePeers(list) {
  const seen = new Set();
  for (const p of list) {
    if (p.id === net.id) continue;
    seen.add(p.id);
    let peer = S.peers.get(p.id);
    if (!peer) {
      const mesh = buildC172({ stripe: PEER_COLORS[p.id % PEER_COLORS.length], tail: p.tail, detail: false });
      mesh.add(nameTag(`${p.nick} · ${p.tail}`));
      mesh.position.set(...p.p);
      scene.add(mesh);
      peer = { mesh, tp: new THREE.Vector3(...p.p), tq: new THREE.Quaternion(...p.q) };
      S.peers.set(p.id, peer);
    }
    peer.s = p;
    peer.seen = performance.now();
    peer.tp.set(...p.p);
    peer.tq.set(...p.q);
  }
  for (const [id, peer] of S.peers) if (!seen.has(id) && performance.now() - peer.seen > 3000) removePeer(id);
}
function removePeer(id) {
  const p = S.peers.get(id);
  if (!p) return;
  scene.remove(p.mesh);
  S.peers.delete(id);
}

// 카메라
let camInit = true;
const camPos = new THREE.Vector3(), look = new THREE.Vector3(), tmpV = new THREE.Vector3();
function updateCamera(dt, att) {
  if (S.phase !== 'flying' || !S.ac) {
    const t = performance.now() / 1000 * 0.03;
    camera.position.set(Math.cos(t) * 1100, 160, Math.sin(t) * 1100);
    camera.lookAt(0, 20, 0);
    camera.fov = 55;
    camera.updateProjectionMatrix();
    return;
  }
  const p = plane.position;
  // 조종석 시점에서는 내 비행기 몸체가 화면을 가리므로 숨긴다 (착륙등 빛은 그대로)
  const showBody = S.cam !== 'cockpit';
  if (plane.userData.bodyShown !== showBody) {
    plane.userData.bodyShown = showBody;
    plane.traverse((o) => { if (o.isMesh || o.isPoints || o.isSprite) o.visible = showBody; });
  }
  if (S.cam === 'chase') {
    const h = rad(att.headingTrue) + S.orbit.yaw;
    const dist = 15 + S.orbit.pitch * 6;
    tmpV.set(p.x - Math.sin(h) * dist * Math.cos(S.orbit.pitch * 0.6), p.y + 3.6 + S.orbit.pitch * 14, p.z + Math.cos(h) * dist * Math.cos(S.orbit.pitch * 0.6));
    const gh = terrainHeight(tmpV.x, tmpV.z) + 1.2;
    if (tmpV.y < gh) tmpV.y = gh;
    if (camInit) camPos.copy(tmpV); else camPos.lerp(tmpV, 1 - Math.exp(-dt * 5));
    camera.position.copy(camPos);
    look.set(p.x + Math.sin(rad(att.headingTrue)) * 6, p.y + 1.2, p.z - Math.cos(rad(att.headingTrue)) * 6);
    camera.lookAt(look);
    camera.fov = 62;
  } else if (S.cam === 'cockpit') {
    camera.position.copy(plane.localToWorld(tmpV.set(-0.3, 0.55, -1.05)));
    camera.quaternion.copy(plane.quaternion);
    camera.rotateX(-0.12 + S.orbit.pitch * -0.5);
    camera.rotateY(S.orbit.yaw);
    camera.fov = 72;
  } else {
    camera.position.copy(world.towerCam);
    camera.lookAt(p);
    const d = camera.position.distanceTo(p);
    camera.fov = Math.max(2.5, Math.min(55, (2 * Math.atan(28 / d) * 180) / Math.PI));
  }
  camInit = false;
  camera.updateProjectionMatrix();
}

// 지도
const mm = $('minimap').getContext('2d');
function drawMinimap() {
  const el = $('minimap');
  const W = S.mapBig ? 420 : 220;
  const dpr = Math.min(2, devicePixelRatio || 1);
  if (el.width !== W * dpr) { el.width = el.height = W * dpr; }
  mm.setTransform(dpr, 0, 0, dpr, 0, 0);
  const scale = S.mapBig ? 24 : 36;
  const ac = S.ac;
  let ox = 0, oz = 0;
  if (ac && Math.hypot(ac.pos.x, ac.pos.z) > (W / 2 - 20) * scale) { ox = ac.pos.x; oz = ac.pos.z; }
  const X = (x) => W / 2 + (x - ox) / scale, Y = (z) => W / 2 + (z - oz) / scale;
  mm.clearRect(0, 0, W, W);
  mm.fillStyle = 'rgba(30,26,20,0.55)'; mm.fillRect(0, 0, W, W);
  mm.strokeStyle = 'rgba(255,255,255,0.08)';
  for (const nm of [1852, 3704, 5556]) { mm.beginPath(); mm.arc(X(0), Y(0), nm / scale, 0, Math.PI * 2); mm.stroke(); }
  // 활주로
  for (const id of ['07R', '07L']) {
    const r = RUNWAYS[id];
    const a = pointOnRunway(r, 0, 0), b = pointOnRunway(r, r.len, 0);
    mm.strokeStyle = id.startsWith('07') && RUNWAYS[S.rwyId].pair === r.pair ? '#e8e2d4' : '#8b8f96';
    mm.lineWidth = Math.max(3, r.width / scale + 2);
    mm.beginPath(); mm.moveTo(X(a.x), Y(a.z)); mm.lineTo(X(b.x), Y(b.z)); mm.stroke();
  }
  // 패턴
  const r = RUNWAYS[S.rwyId], side = r.traffic === 'right' ? 1 : -1;
  const P = (s, d) => { const q = pointOnRunway(r, s, d * side); return [X(q.x), Y(q.z)]; };
  mm.setLineDash([4, 4]); mm.strokeStyle = 'rgba(255,211,77,0.75)'; mm.lineWidth = 1.5;
  mm.beginPath(); mm.moveTo(...P(r.len, 0)); mm.lineTo(...P(r.len + 700, 0)); mm.lineTo(...P(r.len + 700, 1250)); mm.lineTo(...P(-1500, 1250)); mm.lineTo(...P(-1500, 0)); mm.lineTo(...P(0, 0)); mm.stroke(); mm.setLineDash([]);
  // 착륙 방향 화살표
  const t0 = P(-700, 0), t1 = P(-250, 0);
  mm.strokeStyle = '#ffb547'; mm.lineWidth = 2; mm.beginPath(); mm.moveTo(...t0); mm.lineTo(...t1); mm.stroke();
  // 다른 비행기
  mm.font = '10px Pretendard, sans-serif';
  for (const p of S.peers.values()) {
    const x = X(p.mesh.position.x), y = Y(p.mesh.position.z);
    mm.fillStyle = '#b48cff'; mm.beginPath(); mm.arc(x, y, 3.5, 0, Math.PI * 2); mm.fill();
    mm.fillStyle = '#ddd'; mm.fillText(p.s?.nick || '', x + 6, y + 3);
  }
  // 내 비행기
  if (ac && S.r) {
    const x = X(ac.pos.x), y = Y(ac.pos.z), h = rad(S.r.headingTrue);
    mm.save(); mm.translate(x, y); mm.rotate(h);
    mm.fillStyle = '#4dd2ff'; mm.beginPath(); mm.moveTo(0, -8); mm.lineTo(5.5, 6); mm.lineTo(0, 3); mm.lineTo(-5.5, 6); mm.closePath(); mm.fill();
    mm.restore();
  }
  // 바람·북쪽
  const wb = windBase();
  mm.fillStyle = '#ddd'; mm.font = '600 10px "IBM Plex Mono", monospace';
  mm.fillText('N', W - 14, 14);
  if (wb.kt >= 1) {
    mm.save(); mm.translate(20, 22); mm.rotate(rad(wb.dir + 180));
    mm.strokeStyle = '#7fd1ff'; mm.lineWidth = 2; mm.beginPath(); mm.moveTo(0, 9); mm.lineTo(0, -9); mm.lineTo(-4, -4); mm.moveTo(0, -9); mm.lineTo(4, -4); mm.stroke();
    mm.restore();
    mm.fillText(`${Math.round(wb.kt)}kt`, 34, 26);
  }
  mm.fillStyle = '#8b8f96'; mm.fillText(`원 = 1·2·3 NM`, 8, W - 8);
}

// 화면 글자 갱신
function renderHud(r, leg, f) {
  const n = phoenixNow(simUtc());
  const st = sunTimes(n.y, n.mo, n.d);
  const nextSun = st.rise && n.hour < st.rise ? `일출 ${fmtHour(st.rise)}` : st.set && n.hour < st.set ? `일몰 ${fmtHour(st.set)}` : `일출 ${st.rise ? fmtHour(st.rise) : '-'}`;
  $('c-time').textContent = `KDVT ${fmtHour(n.hour)} MST · ${nextSun}${S.settings.time === 'manual' ? ' · 연습 시간' : ''}`;
  const wb = windBase();
  const comp = windComponents(wb.dir, S.windNow?.kt ?? wb.kt, RUNWAYS[S.rwyId].hdgTrue);
  $('c-wind').textContent = `바람 ${windText(wb)} (${wb.source}) · 맞바람 ${Math.round(comp.head)} · 옆바람 ${Math.abs(Math.round(comp.cross))}${comp.cross >= 0 ? 'R' : 'L'}`;
  const rwy = RUNWAYS[S.rwyId];
  $('c-rwy').textContent = `활주로 ${S.rwyId} · ${rwy.traffic === 'right' ? '우선회' : '좌선회'} 패턴`;
  $('c-atis').textContent = `ATIS ${currentAtis()} ▶`;
  $('c-online').textContent = `접속 ${S.online}명`;
  $('tape').innerHTML = [['속도', `${Math.round(r.iasKt)}`, 'KT'], ['고도', Math.round(r.altFt).toLocaleString(), 'FT MSL'], ['지면 위', Math.round(r.aglFt).toLocaleString(), 'FT AGL'], ['승강', `${r.vsFpm >= 0 ? '+' : ''}${Math.round(r.vsFpm / 10) * 10}`, 'FPM'], ['방향', pad3(r.headingMag), 'MAG']]
    .map(([a, b, c]) => `<div><small>${a}</small><b>${b}</b><small>${c}</small></div>`).join('');
  const el = $('coach');
  if (!S.settings.coach) { el.hidden = true; return; }
  el.hidden = false;
  const c = coach(leg, rwy, r, f, { mode: S.mode === 'engine_out' && S.ctl.engineFailed ? 'full' : 'tg' });
  const items = c.items.map((i) => `<span class="it ${i.ok ? 'ok' : 'bad'}">${esc(i.label)} ${Math.round(i.actual)}/${Math.round(i.target)}${i.unit}</span>`).join('');
  let gs = '';
  if (c.glide) { const pos = Math.max(0, Math.min(100, 50 - (c.glide.dev / Math.max(60, c.glide.gp * 0.3)) * 50)); gs = `<div class="gs" title="활공각: 가운데가 정상, 왼쪽=높음, 오른쪽=낮음"><i style="left:${pos}%"></i></div>`; }
  el.innerHTML = `<h4>${esc(c.title)}<small>${esc(LEGS[leg]?.en || '')}</small></h4>${items ? `<div class="items">${items}</div>` : ''}<p>${esc(c.next)}</p>${gs}`;
}

// ATIS
function playAtis() {
  const wb = windBase();
  const wx = { ...(S.wx?.ok ? S.wx : {}), dir: wb.dir, kt: wb.kt, gust: wb.gust, variable: wb.variable, observedMs: S.settings.wind === 'manual' ? Date.now() : S.wx?.observedMs };
  const a = atisText({ letter: currentAtis(), wx, rwyId: S.rwyId });
  addLine('tower', `ATIS ${currentAtis()}`, a.en, a.ko);
  audio.speak([{ who: 'tower', en: a.en }]);
}
$('c-atis').onclick = playAtis;

// 설정
function openSettings() {
  const s = S.settings;
  document.querySelector(`input[name=time][value=${s.time}]`).checked = true;
  document.querySelector(`input[name=wind][value=${s.wind}]`).checked = true;
  $('s-hour').value = s.time === 'manual' ? s.hour : phoenixNow().hour;
  $('s-dir').value = s.manual.dir; $('s-kt').value = s.manual.kt; $('s-gust').value = s.manual.gust;
  $('t-coach').checked = s.coach; $('t-pattern').checked = s.pattern; $('t-voice').checked = s.voice; $('t-sound').checked = s.sound;
  syncSettingsLabels();
  $('settings').hidden = false;
}
function syncSettingsLabels() {
  const n = phoenixNow();
  const st = sunTimes(n.y, n.mo, n.d);
  const h = +$('s-hour').value;
  $('s-hour-label').textContent = `${S.settings.time === 'manual' ? `연습 시각 ${fmtHour(h)}부터 실제 시간처럼 흐름` : `지금 피닉스 ${fmtHour(n.hour)}`} · 오늘 일출 ${st.rise ? fmtHour(st.rise) : '-'} · 일몰 ${st.set ? fmtHour(st.set) : '-'}`;
  $('o-dir').textContent = `${pad3(+$('s-dir').value)}°`;
  $('o-kt').textContent = `${$('s-kt').value}kt`;
  $('o-gust').textContent = +$('s-gust').value > +$('s-kt').value ? `${$('s-gust').value}kt` : '없음';
}
function saveSettings() {
  const s = S.settings;
  s.time = document.querySelector('input[name=time]:checked').value;
  if (s.time === 'manual') { s.hour = +$('s-hour').value; s.timeSetAt = Date.now(); }
  s.wind = document.querySelector('input[name=wind]:checked').value;
  s.manual = { dir: +$('s-dir').value, kt: +$('s-kt').value, gust: +$('s-gust').value };
  s.coach = $('t-coach').checked; s.pattern = $('t-pattern').checked; s.voice = $('t-voice').checked; s.sound = $('t-sound').checked;
  audio.voice = s.voice; audio.on = s.sound;
  if (!s.voice) audio.stopVoice();
  world.showPattern(s.pattern);
  applyWind();
  if (S.phase === 'flying') {
    const changed = pickRunway(!S.ac?.onGround);
    if (changed && S.ac?.onGround && !S.landed) spawn();
  }
  store.set('settings', { ...s, timeSetAt: undefined });
  syncSettingsLabels();
  renderMenuWx();
}
$('settings').addEventListener('input', (e) => {
  if (e.target.id === 's-hour') document.querySelector('input[name=time][value=manual]').checked = true;
  if (['s-dir', 's-kt', 's-gust'].includes(e.target.id)) document.querySelector('input[name=wind][value=manual]').checked = true;
  saveSettings();
});
$('s-xwind').onclick = () => {
  const r = RUNWAYS[S.rwyId];
  $('s-dir').value = Math.round(wrap360(r.hdgTrue + 90) / 10) * 10 % 360;
  $('s-kt').value = 12; $('s-gust').value = 18;
  document.querySelector('input[name=wind][value=manual]').checked = true;
  saveSettings();
  toast('측풍 연습: 오른쪽에서 12kt, 돌풍 18kt', 2500);
};
$('s-reset').onclick = () => { $('settings').hidden = true; spawn(); };
$('s-menu').onclick = () => {
  $('settings').hidden = true;
  S.phase = 'menu';
  plane.visible = false;
  $('hud').hidden = true;
  $('menu').hidden = false;
  audio.stopVoice();
  renderMenuWx();
};
$('b-settings').onclick = openSettings;
document.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => (b.closest('.sheet').hidden = true)));
$('b-help').onclick = $('m-help').onclick = () => ($('help').hidden = false);
$('minimap').onclick = () => { S.mapBig = !S.mapBig; $('minimap').classList.toggle('big', S.mapBig); };

// 기록판
$('b-board').onclick = $('m-board').onclick = () => openBoard('today');
document.querySelectorAll('#board .tabs button').forEach((b) => (b.onclick = () => openBoard(b.dataset.range)));
const ago = (iso) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  return s < 60 ? '방금' : s < 3600 ? `${Math.floor(s / 60)}분 전` : s < 86400 ? `${Math.floor(s / 3600)}시간 전` : `${Math.floor(s / 86400)}일 전`;
};
function rowsHtml(list, rank = true) {
  if (!list.length) return '<p class="empty">아직 기록이 없습니다. 첫 터치앤고를 남겨 보세요.</p>';
  return `<div class="wrap"><table><thead><tr>${rank ? '<th>#</th>' : ''}<th>조종사</th><th>활주로</th><th>종류</th><th>점수</th><th>하강률</th><th>중심선</th><th>접지</th><th>속도</th><th>바람</th><th></th></tr></thead><tbody>${list
    .map((x, i) => `<tr class="${x.has_track ? 'clickable' : ''}" data-id="${x.id}">${rank ? `<td>${i + 1}</td>` : ''}<td class="name">${esc(x.pilot)} <small>${esc(x.tail)}</small></td><td>${esc(x.runway)}</td><td>${x.kind === 'touch_and_go' ? 'T&G' : '풀스톱'}${x.mode === 'engine_out' ? ' · 엔진' : x.mode === 'crosswind' ? ' · 측풍' : ''}</td><td><span class="grade g-${esc(x.grade)}">${esc(x.grade)}</span> ${x.score}</td><td>${x.sink_fpm}fpm</td><td>${x.centerline_ft}ft</td><td>${x.from_threshold_ft}ft</td><td>${x.ias_kt}kt</td><td>${esc(x.wind_text)}</td><td>${ago(x.created_at)}</td></tr>`)
    .join('')}</tbody></table></div><p class="hint">줄을 누르면 그 착륙의 리플레이를 봅니다.</p>`;
}
async function openBoard(range) {
  $('board').hidden = false;
  document.querySelectorAll('#board .tabs button').forEach((b) => b.classList.toggle('on', b.dataset.range === range));
  const body = $('board-body');
  body.innerHTML = '<p class="empty">불러오는 중…</p>';
  try {
    if (range === 'me') {
      if (!S.nick) { body.innerHTML = '<p class="empty">시작 화면에서 닉네임을 정하면 내 로그북이 생깁니다.</p>'; return; }
      const j = await (await fetch(`/api/pilots/${encodeURIComponent(S.nick)}`)).json();
      if (j.error) throw new Error(j.error);
      body.innerHTML = `<div class="stats"><div><b>${j.total}</b><small>착륙</small></div><div><b>${j.touchAndGo}</b><small>터치앤고</small></div><div><b>${j.fullStop}</b><small>풀스톱</small></div><div><b>${j.best ?? '-'}</b><small>최고 점수</small></div><div><b>${j.avgScore ?? '-'}</b><small>평균 점수</small></div><div><b>${j.avgSink ?? '-'}</b><small>평균 하강률 fpm</small></div><div><b>${j.flightMinutes}</b><small>패턴 비행 분</small></div></div>${rowsHtml(j.recent, false)}`;
    } else {
      const j = await (await fetch(`/api/landings?range=${range}&limit=30`)).json();
      if (j.error) throw new Error(j.error);
      body.innerHTML = rowsHtml(j.landings);
    }
    body.querySelectorAll('tr.clickable').forEach((tr) => (tr.onclick = async () => {
      const d = await (await fetch(`/api/landings/${tr.dataset.id}`)).json();
      if (d.track) openReplay(d.track, d.runway, `${d.pilot} · ${d.runway} · ${d.score}점 (${d.grade})`);
    }));
  } catch (e) {
    body.innerHTML = `<p class="empty">기록을 불러오지 못했습니다: ${esc(e.message)}</p>`;
  }
}

// 리플레이
let replay = null;
function openReplay(track, rwyId, title) {
  if (!track || track.length < 2) return toast('궤적이 없습니다.');
  $('replay').hidden = false;
  $('replay-title').textContent = `리플레이 · ${title}`;
  const sc = $('replay-scrub');
  sc.max = track.length - 1;
  sc.value = track.length - 1;
  replay = { track, rwyId, playing: false, idx: track.length - 1 };
  requestAnimationFrame(() => drawReplay($('replay-canvas'), track, rwyId, track.length - 1));
  if (S.phase === 'flying') world.setTrack(track);
}
$('replay-scrub').oninput = (e) => { if (replay) { replay.idx = +e.target.value; drawReplay($('replay-canvas'), replay.track, replay.rwyId, replay.idx); } };
$('replay-play').onclick = () => {
  if (!replay) return;
  replay.playing = !replay.playing;
  $('replay-play').textContent = replay.playing ? '멈춤' : '재생';
  if (replay.playing && replay.idx >= replay.track.length - 1) replay.idx = 0;
};

// 메인 루프
let last = performance.now();
let hudT = 0, panelT = 0, rwyCheckT = 0, wxT = 0, lastLegForRadio = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const utc = simUtc();
  const sp = sunPosition(utc);
  let att = null;

  if (S.phase === 'flying' && S.ac) {
    controls(dt);
    const ac = S.ac;
    const agl = Math.max(0, ac.pos.y - C172.gearH - terrainHeight(ac.pos.x, ac.pos.z));
    S.windNow = wind.sample(S.t, agl);
    S.env = {
      wind: S.windNow.vec,
      rho: airDensity(ac.pos.y + AIRPORT.elevM, S.wx?.tempC ?? 25),
      groundHeight: terrainHeight,
      surface: surfaceAt,
    };
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    const evs = [];
    for (let i = 0; i < n; i++) {
      evs.push(...stepAircraft(ac, S.ctl, S.env, h));
      S.t += h;
    }
    handleEvents(evs);
    const r = (S.r = readout(ac, S.env));
    const rwy = RUNWAYS[S.rwyId];
    const landedOnGround = !!S.landed && ac.onGround;
    const cl = classifyLeg(rwy, ac.pos, r, ac.onGround, landedOnGround);
    S.leg = cl.leg;
    if (!ac.onGround || landedOnGround) pushTrack(false);
    // 풀스톱: 착륙 뒤 멈춤
    if (S.landed && !S.landed.off && !S.landed.posted && ac.onGround && r.gsKt < 3) {
      S.stopT += dt;
      if (S.stopT > 2) {
        postLanding('full_stop');
        addRadio(radio('fullstop', ctx()));
        if (S.ctl.engineFailed) setTimeout(() => { S.ctl.engineFailed = false; toast('엔진을 다시 걸었습니다. R로 활주로에 돌아가 다시 이륙할 수 있습니다.', 4000); }, 2500);
      }
    } else S.stopT = 0;
    if (S.landed?.off && ac.onGround && r.gsKt < 3) S.landed = null;
    lastLegForRadio += dt;
    if (lastLegForRadio > 0.1) { lastLegForRadio = 0; radioLogic(cl.leg, cl.f); }
    // 경고
    if (!warnSticky) {
      const vfe = C172.vfe[Math.round(ac.flaps / 10) * 10];
      if (r.stallWarn) { $('warn').textContent = 'STALL'; $('warn').classList.remove('soft'); $('warn').hidden = false; }
      else if (ac.flaps > 2 && vfe && r.iasKt > vfe) { $('warn').textContent = `플랩 속도 초과 (${vfe}kt 이하)`; $('warn').classList.add('soft'); $('warn').hidden = false; }
      else $('warn').hidden = true;
    }
    // 바람이 바뀌면 지상·패턴 밖에서만 활주로 변경
    rwyCheckT += dt;
    if (rwyCheckT > 10) {
      rwyCheckT = 0;
      if (['ground', 'outside', 'upwind', 'crosswind'].includes(cl.leg) && !S.landed) {
        const changed = pickRunway(!ac.onGround);
        if (changed && ac.onGround && r.gsKt < 2) spawn();
      }
    }
    plane.position.set(ac.pos.x, ac.pos.y, ac.pos.z);
    plane.quaternion.set(ac.quat.x, ac.quat.y, ac.quat.z, ac.quat.w);
    plane.userData.update(dt, { rpm: r.rpm, flaps: ac.flaps, night: world.night });
    att = { headingTrue: r.headingTrue };
    audio.update({ rpm: r.rpm, ias: r.iasKt, stall: r.stallWarn, onGround: ac.onGround, gs: r.gsKt });
    net.sendState({ p: [ac.pos.x, ac.pos.y, ac.pos.z], q: [ac.quat.x, ac.quat.y, ac.quat.z, ac.quat.w], ias: r.iasKt, leg: cl.leg, rwy: S.rwyId, flaps: ac.flaps, lights: world.night > 0.3 });
    hudT += dt;
    if (hudT > 0.12) { hudT = 0; renderHud(r, cl.leg, cl.f); drawMinimap(); }
    panelT += dt;
    if (panelT > 1 / 30) {
      panelT = 0;
      panel.draw(r, { altim: S.wx?.altimInHg || 29.92, throttle: ac.thr, trim: S.ctl.trim, brakes: S.ctl.brakes > 0, engineFailed: S.ctl.engineFailed, rwyMag: hdgMag(rwy.hdgTrue) });
    }
  }
  for (const p of S.peers.values()) {
    p.mesh.position.lerp(p.tp, 1 - Math.exp(-dt * 8));
    p.mesh.quaternion.slerp(p.tq, 1 - Math.exp(-dt * 8));
    p.mesh.userData.update(dt, { rpm: p.s?.ias > 5 ? 2300 : 900, flaps: p.s?.flaps || 0, night: world.night });
  }
  if (replay?.playing && !$('replay').hidden) {
    replay.idx = Math.min(replay.track.length - 1, replay.idx + dt * 8);
    $('replay-scrub').value = Math.floor(replay.idx);
    drawReplay($('replay-canvas'), replay.track, replay.rwyId, Math.floor(replay.idx));
    if (replay.idx >= replay.track.length - 1) { replay.playing = false; $('replay-play').textContent = '재생'; }
  }
  updateCamera(dt, att);
  const focus = S.phase === 'flying' && S.ac ? plane.position : new THREE.Vector3(0, 0, 0);
  world.update({ sunEl: sp.elevation, sunAz: sp.azimuth, camera, focus, windDir: S.windNow?.dir ?? windBase().dir, windKt: S.windNow?.kt ?? windBase().kt, dt });
  wxT += dt;
  if (wxT > 600) { wxT = 0; loadWeather(); }
  if (S.phase === 'menu' && Math.floor(now / 1000) !== Math.floor((now - dt * 1000) / 1000)) renderMenuWx();
  renderer.render(scene, camera);
}

applyWind();
loadWeather();
requestAnimationFrame(frame);
window.__dvt = S; // 개발 확인용
