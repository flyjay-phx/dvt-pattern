// 디어밸리 공항과 주변 사막·도시, 하늘(해·별), 조명, 활주로 등화·PAPI, 윈드삭, 패턴 안내선
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { RUNWAYS, RUNWAY_IDS, RUNWAY_CENTERS, PAVED_AREAS, pointOnRunway, terrainHeight, runwayFrame, FT, rad } from '../sim/airport.js';
import { PATTERN_AGL_FT, glidepathAglFt } from '../sim/pattern.js';
import { buildC172, glowTex } from './aircraft.js';

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
const unitPlane = () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
function rectMatrix(x, z, hdgDeg, w, l, y) {
  _q.setFromAxisAngle(_up, -rad(hdgDeg));
  return _m.compose(_p.set(x, y, z), _q, _s.set(w, 1, l)).clone();
}
function pointsMat(size, opts = {}) {
  return new THREE.PointsMaterial({ size, sizeAttenuation: false, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, ...opts });
}

export function buildWorld(scene, renderer) {
  const world = { night: 0 };

  // 하늘
  const sky = new Sky();
  sky.scale.setScalar(400000);
  const su = sky.material.uniforms;
  su.turbidity.value = 3.2;
  su.rayleigh.value = 1.3;
  su.mieCoefficient.value = 0.004;
  su.mieDirectionalG.value = 0.82;
  scene.add(sky);

  const starGeo = new THREE.BufferGeometry();
  {
    const r = rng(7), pos = [], col = [];
    for (let i = 0; i < 2600; i++) {
      const th = r() * Math.PI * 2, ph = Math.acos(1 - r() * 0.95);
      const R = 90000;
      pos.push(Math.sin(ph) * Math.cos(th) * R, Math.cos(ph) * R, Math.sin(ph) * Math.sin(th) * R);
      const b = 0.4 + r() * 0.6;
      col.push(b, b, b * (0.9 + r() * 0.2));
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    starGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  }
  const stars = new THREE.Points(starGeo, pointsMat(2.2, { fog: false }));
  stars.frustumCulled = false;
  scene.add(stars);

  // 조명
  const sun = new THREE.DirectionalLight(0xffffff, 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 10, far: 4000 });
  sun.shadow.bias = -0.0004;
  scene.add(sun, sun.target);
  const moon = new THREE.DirectionalLight(0x8fa6d6, 0.0);
  moon.position.set(-3000, 5000, 2000);
  scene.add(moon);
  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x8a6a48, 0.9);
  scene.add(hemi);
  scene.fog = new THREE.Fog(0xc9d6e3, 4000, 52000);

  // 지형
  const SIZE = 90000, SEG = 220;
  const tg = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG).rotateX(-Math.PI / 2);
  const tp = tg.attributes.position;
  const tcol = [];
  const cA = new THREE.Color(0xc8a77e), cB = new THREE.Color(0xa88a63), cC = new THREE.Color(0x8b7a5a), cR = new THREE.Color(0x7b6248);
  const tmp = new THREE.Color();
  for (let i = 0; i < tp.count; i++) {
    const x = tp.getX(i), z = tp.getZ(i);
    const h = terrainHeight(x, z);
    tp.setY(i, h);
    const n = (Math.sin(x * 0.0021) * Math.cos(z * 0.0017) + Math.sin(x * 0.0007 + z * 0.0009)) * 0.25 + 0.5;
    tmp.copy(cA).lerp(cB, n).lerp(cC, smooth(0, 0.6, Math.sin(x * 0.0004 - z * 0.0003) * 0.5 + 0.2) * 0.5).lerp(cR, smooth(60, 600, h));
    tcol.push(tmp.r, tmp.g, tmp.b);
  }
  tg.setAttribute('color', new THREE.Float32BufferAttribute(tcol, 3));
  tg.computeVertexNormals();
  const groundTex = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#d8c3a0';
    g.fillRect(0, 0, w, h);
    const r = rng(3);
    for (let i = 0; i < 9000; i++) {
      const v = 150 + r() * 90;
      g.fillStyle = `rgba(${v},${v * 0.86},${v * 0.66},${0.25 + r() * 0.3})`;
      g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
    }
    for (let i = 0; i < 260; i++) {
      g.fillStyle = `rgba(${70 + r() * 30},${80 + r() * 30},${50 + r() * 20},0.75)`;
      g.beginPath();
      g.arc(r() * w, r() * h, 2 + r() * 4, 0, Math.PI * 2);
      g.fill();
    }
  }, [SIZE / 60, SIZE / 60]);
  const terrain = new THREE.Mesh(tg, new THREE.MeshLambertMaterial({ vertexColors: true, map: groundTex }));
  terrain.receiveShadow = true;
  scene.add(terrain);

  // 포장면: 활주로·유도로·계류장
  const asphalt = canvasTex(256, 1024, (g, w, h) => {
    g.fillStyle = '#3a3c3f';
    g.fillRect(0, 0, w, h);
    const r = rng(11);
    for (let i = 0; i < 16000; i++) {
      const v = 40 + r() * 40;
      g.fillStyle = `rgba(${v},${v},${v + 3},0.5)`;
      g.fillRect(r() * w, r() * h, 1, 1);
    }
    g.strokeStyle = 'rgba(15,15,15,0.18)';
    for (let i = 0; i < 40; i++) {
      g.lineWidth = 2 + r() * 5;
      const x = w * (0.35 + r() * 0.3);
      g.beginPath();
      g.moveTo(x, r() * h);
      g.lineTo(x + (r() - 0.5) * 8, r() * h);
      g.stroke();
    }
  });
  const pavedMat = new THREE.MeshLambertMaterial({ color: 0xffffff, map: asphalt, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const taxiMat = new THREE.MeshLambertMaterial({ color: 0x8d8a84, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const pair = (id1) => RUNWAYS[id1];
  for (const id of ['07R', '07L']) {
    const r = pair(id);
    const c = pointOnRunway(r, r.len / 2, 0);
    const geo = new THREE.PlaneGeometry(r.width, r.len).rotateX(-Math.PI / 2);
    geo.attributes.uv.array.forEach((_, i, a) => { if (i % 2 === 1) a[i] *= r.len / 120; });
    asphalt.wrapS = asphalt.wrapT = THREE.RepeatWrapping;
    const mesh = new THREE.Mesh(geo, pavedMat);
    mesh.position.set(c.x, 0.04, c.z);
    mesh.rotation.y = -rad(r.hdgTrue);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  for (const p of PAVED_AREAS) {
    const r = RUNWAYS[p.rwy];
    const c = pointOnRunway(r, (p.s0 + p.s1) / 2, (p.d0 + p.d1) / 2);
    const mesh = new THREE.Mesh(unitPlane(), taxiMat);
    mesh.applyMatrix4(rectMatrix(c.x, c.z, r.hdgTrue, p.d1 - p.d0, p.s1 - p.s0, 0.03));
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  // 연결 유도로
  {
    const r = RUNWAYS['07R'];
    for (const s of [120, 700, 1250, 1800, 2380]) {
      const c = pointOnRunway(r, s, -NORTH_GAP() / 2);
      const m = new THREE.Mesh(unitPlane(), taxiMat);
      m.applyMatrix4(rectMatrix(c.x, c.z, r.hdgTrue, NORTH_GAP() - 30, 18, 0.025));
      scene.add(m);
    }
    for (const s of [700, 1250, 1500]) {
      const c = pointOnRunway(r, s, 75);
      const m = new THREE.Mesh(unitPlane(), taxiMat);
      m.applyMatrix4(rectMatrix(c.x, c.z, r.hdgTrue, 120, 18, 0.025));
      scene.add(m);
    }
  }
  function NORTH_GAP() { return 700 * FT; }

  // 활주로 표시 (흰 사각형은 한 번에 그리기)
  const rects = [];
  const yellowRects = [];
  const R = (rwy, s, d, w, l) => rects.push({ rwy, s, d, w, l });
  for (const id of RUNWAY_IDS) {
    const rwy = RUNWAYS[id];
    const big = rwy.width > 25;
    const n = big ? 8 : 6;
    const stripeW = 1.75, gap = (rwy.width - 6 - n * stripeW) / (n - 1);
    for (let i = 0; i < n; i++) {
      const d = -rwy.width / 2 + 3 + stripeW / 2 + i * (stripeW + gap);
      R(rwy, 6 + 22.5, d, stripeW, 45);
    }
    // 조준점 (1,000ft)
    for (const sd of [-1, 1]) R(rwy, 305 + 22.5, sd * (big ? 8 : 6.5), big ? 6 : 4.5, 45);
    if (big) {
      for (const [s, k] of [[152, 3], [457, 2], [610, 2], [762, 1]]) {
        for (const sd of [-1, 1]) for (let j = 0; j < k; j++) R(rwy, s + 11, sd * (4 + j * 2.6), 1.8, 22.5);
      }
    }
  }
  for (const id of ['07R', '07L']) {
    const rwy = RUNWAYS[id];
    for (let s = 130; s < rwy.len - 130; s += 61) R(rwy, s + 18, 0, 0.9, 36.6);
    if (rwy.width > 25) for (const sd of [-1, 1]) R(rwy, rwy.len / 2, sd * (rwy.width / 2 - 1), 0.9, rwy.len - 20);
  }
  {
    // 유도로 노란 중심선
    const r = RUNWAYS['07R'];
    yellowRects.push({ rwy: r, s: r.len / 2, d: -NORTH_GAP() / 2, w: 0.3, l: r.len });
  }
  const markMat = new THREE.MeshLambertMaterial({ color: 0xf2f2ee, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const inst = new THREE.InstancedMesh(unitPlane(), markMat, rects.length);
  rects.forEach((m, i) => {
    const c = pointOnRunway(m.rwy, m.s, m.d);
    inst.setMatrixAt(i, rectMatrix(c.x, c.z, m.rwy.hdgTrue, m.w, m.l, 0.06));
  });
  inst.receiveShadow = true;
  scene.add(inst);
  const yMat = new THREE.MeshBasicMaterial({ color: 0xd9b23a, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  for (const m of yellowRects) {
    const c = pointOnRunway(m.rwy, m.s, m.d);
    const mesh = new THREE.Mesh(unitPlane(), yMat);
    mesh.applyMatrix4(rectMatrix(c.x, c.z, m.rwy.hdgTrue, m.w, m.l, 0.05));
    scene.add(mesh);
  }
  // 활주로 번호
  for (const id of RUNWAY_IDS) {
    const rwy = RUNWAYS[id];
    const num = rwy.label.replace(/[LRC]/, '');
    const side = rwy.label.replace(/\d/g, '');
    const tex = canvasTex(256, 600, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.fillStyle = '#f2f2ee';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = 'bold 250px "Arial Narrow", Arial, sans-serif';
      g.save();
      g.scale(0.62, 1);
      g.fillText(num, w / 2 / 0.62, h * 0.28);
      g.fillText(side, w / 2 / 0.62, h * 0.74);
      g.restore();
    });
    const mesh = new THREE.Mesh(unitPlane(), new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.4, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    const c = pointOnRunway(rwy, 60 + 24, 0);
    mesh.applyMatrix4(rectMatrix(c.x, c.z, rwy.hdgTrue, rwy.width > 25 ? 14 : 11, 40, 0.07));
    scene.add(mesh);
  }

  // 건물: 격납고, 관제탑, 계류장 비행기
  const bldMat = new THREE.MeshLambertMaterial({ color: 0xe6e0d4 });
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x9aa3ab });
  const r07 = RUNWAYS['07R'];
  const addBox = (s, d, w, l, h, mat = bldMat, rwy = r07) => {
    const c = pointOnRunway(rwy, s, d);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat);
    m.position.set(c.x, h / 2, c.z);
    m.rotation.y = -rad(rwy.hdgTrue);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  for (let i = 0; i < 6; i++) addBox(760 + i * 120, 360, 30, 90, 5, i % 2 ? bldMat : roofMat);
  for (let i = 0; i < 3; i++) addBox(1520 + i * 70, 300, 40, 50, 11, bldMat);
  addBox(1100, 350, 25, 60, 7, new THREE.MeshLambertMaterial({ color: 0xc9b48f }));
  const towerPos = pointOnRunway(r07, 1240, 160);
  {
    const t = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.8, 28, 12), bldMat);
    shaft.position.y = 14;
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 3.6, 4, 8), new THREE.MeshStandardMaterial({ color: 0x223344, metalness: 0.6, roughness: 0.2 }));
    cab.position.y = 30;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 0.8, 8), roofMat);
    cap.position.y = 32.4;
    t.add(shaft, cab, cap);
    t.position.set(towerPos.x, 0, towerPos.z);
    t.traverse((o) => { o.castShadow = true; });
    scene.add(t);
  }
  world.towerCam = new THREE.Vector3(towerPos.x, 31, towerPos.z);
  const parked = [];
  const colors = ['#b3261e', '#1f5fbf', '#2e7d32', '#6a1b9a', '#ef6c00', '#37474f'];
  for (let i = 0; i < 14; i++) {
    const p = buildC172({ stripe: colors[i % colors.length], tail: `N${7000 + i * 37}D`, detail: false });
    const c = pointOnRunway(r07, 760 + (i % 7) * 95, 150 + Math.floor(i / 7) * 70);
    p.position.set(c.x, 1.25, c.z);
    p.rotation.y = -rad(r07.hdgTrue + 90);
    scene.add(p);
    parked.push(p);
  }

  // 주변 도시 (남쪽·동쪽·서쪽 주택가) + 밤 불빛 + 도로
  {
    const r = rng(21);
    const houses = [];
    const lights = [], lcol = [];
    for (let gx = -14000; gx <= 14000; gx += 140) {
      for (let gz = -9000; gz <= 16000; gz += 140) {
        const x = gx + (r() - 0.5) * 60, z = gz + (r() - 0.5) * 60;
        const dist = Math.hypot(x, z);
        if (dist < 1800) continue;
        if (terrainHeight(x, z) > 2) continue;
        const dens = z > -1500 ? 0.55 : 0.12;
        if (r() > dens) continue;
        if (Math.abs(runwayFrame(r07, x, z).d) < 900 && runwayFrame(r07, x, z).s > -2500 && runwayFrame(r07, x, z).s < r07.len + 2500) continue;
        houses.push([x, z, 10 + r() * 14, 8 + r() * 12, 4 + r() * 4, r()]);
        if (r() < 0.75) {
          lights.push(x + (r() - 0.5) * 30, 3, z + (r() - 0.5) * 30);
          const w = 0.8 + r() * 0.2;
          lcol.push(1 * w, 0.78 * w, 0.48 * w);
        }
      }
    }
    const hm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshLambertMaterial({ color: 0xffffff }), houses.length);
    const hc = new THREE.Color();
    houses.forEach(([x, z, w, l, h, k], i) => {
      _q.setFromAxisAngle(_up, 0);
      hm.setMatrixAt(i, _m.compose(_p.set(x, 0, z), _q, _s.set(w, h, l)).clone());
      hm.setColorAt(i, hc.setHSL(0.08 + k * 0.05, 0.25, 0.68 + k * 0.12));
    });
    scene.add(hm);
    // 도로: I-17(서쪽 남북), Deer Valley Rd(남쪽 동서), 7th St/Ave
    const roadMat = new THREE.MeshLambertMaterial({ color: 0x55575a, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const roads = [[-3600, 3500, 40, 32000, 0], [0, 1900, 30000, 18, 0], [2400, 4000, 16, 20000, 0], [-1300, 4000, 16, 20000, 0], [0, 5200, 30000, 16, 0]];
    for (const [x, z, w, l] of roads) {
      const m = new THREE.Mesh(unitPlane(), roadMat);
      m.position.set(x, 0.02, z);
      m.scale.set(w, 1, l);
      scene.add(m);
      const n = Math.floor(Math.max(w, l) / 90);
      for (let i = 0; i < n; i++) {
        const t = (i / n - 0.5);
        lights.push(x + (w > l ? t * w : w / 2 + 3), 8, z + (l > w ? t * l : l / 2 + 3));
        lcol.push(1, 0.62, 0.25);
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lights, 3));
    lg.setAttribute('color', new THREE.Float32BufferAttribute(lcol, 3));
    world.cityLights = new THREE.Points(lg, pointsMat(2.6));
    world.cityLights.frustumCulled = false;
    scene.add(world.cityLights);
  }

  // 활주로 등화
  {
    const pos = [], col = [];
    const add = (p, c, y = 0.5) => { pos.push(p.x, y, p.z); col.push(...c); };
    for (const id of ['07R', '07L']) {
      const r = RUNWAYS[id];
      for (let s = 0; s <= r.len + 0.1; s += 60) for (const sd of [-1, 1]) add(pointOnRunway(r, s, sd * (r.width / 2 + 1.5)), s > r.len - 600 || s < 600 ? [1, 0.85, 0.4] : [1, 1, 0.92]);
    }
    for (const id of RUNWAY_IDS) {
      const r = RUNWAYS[id];
      for (let i = 0; i <= 8; i++) {
        const d = -r.width / 2 + (r.width * i) / 8;
        add(pointOnRunway(r, -2, d), [0.2, 1, 0.45]);
        add(pointOnRunway(r, r.len + 2, d), [1, 0.15, 0.1]);
      }
    }
    // 유도로 파란 등
    const r = RUNWAYS['07R'];
    for (let s = 0; s < r.len; s += 50) for (const d of [-NORTH_GAP() / 2 - 10, -NORTH_GAP() / 2 + 10]) add(pointOnRunway(r, s, d), [0.25, 0.45, 1], 0.4);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    world.rwyLights = new THREE.Points(g, pointsMat(4.2));
    world.rwyLights.frustumCulled = false;
    scene.add(world.rwyLights);
  }

  // PAPI: 각 활주로 끝, 시단 1,000ft 왼쪽에 4개. 보는 각도에 따라 흰색/빨강
  const papi = [];
  {
    const pos = [], col = [];
    for (const id of RUNWAY_IDS) {
      const r = RUNWAYS[id];
      for (let i = 0; i < 4; i++) {
        const d = -(r.width / 2 + 15 + i * 9);
        const p = pointOnRunway(r, 305, d);
        pos.push(p.x, 1, p.z);
        col.push(1, 1, 1);
        papi.push({ id, i, x: p.x, z: p.z, thr: [3.5, 3.17, 2.83, 2.5][i], rwy: r });
        const box = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.0, 0.6), new THREE.MeshLambertMaterial({ color: 0x2a2a2a }));
        box.position.set(p.x, 0.5, p.z);
        box.rotation.y = -rad(r.hdgTrue);
        scene.add(box);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    world.papi = new THREE.Points(g, pointsMat(8, { blending: THREE.NormalBlending }));
    world.papi.frustumCulled = false;
    scene.add(world.papi);
  }

  // 회전 비컨(관제탑 옆)
  const beaconGeo = new THREE.BufferGeometry();
  beaconGeo.setAttribute('position', new THREE.Float32BufferAttribute([towerPos.x + 12, 36, towerPos.z], 3));
  beaconGeo.setAttribute('color', new THREE.Float32BufferAttribute([0, 1, 0.4], 3));
  const beacon = new THREE.Points(beaconGeo, pointsMat(14));
  scene.add(beacon);

  // 윈드삭
  const sock = new THREE.Group();
  {
    const p = pointOnRunway(r07, 1250, 70);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 6, 6), new THREE.MeshLambertMaterial({ color: 0xdddddd }));
    pole.position.y = 3;
    sock.add(pole);
    const pivot = new THREE.Group();
    pivot.position.y = 5.8;
    const stripes = canvasTex(64, 256, (g, w, h) => {
      for (let i = 0; i < 5; i++) { g.fillStyle = i % 2 ? '#f6f6f6' : '#ff6a13'; g.fillRect(0, (i * h) / 5, w, h / 5); }
    });
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.45, 3.6, 12, 1, true), new THREE.MeshLambertMaterial({ map: stripes, side: THREE.DoubleSide }));
    cone.rotation.x = Math.PI / 2;
    cone.position.z = 1.8;
    pivot.add(cone);
    sock.add(pivot);
    sock.userData.pivot = pivot;
    sock.position.set(p.x, 0, p.z);
    scene.add(sock);
  }

  // 패턴 안내선·지난 비행 궤적
  const patLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xffd34d, dashSize: 60, gapSize: 40, transparent: true, opacity: 0.85, fog: false }));
  patLine.frustumCulled = false;
  scene.add(patLine);
  const trackLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x4dd2ff, transparent: true, opacity: 0.9, fog: false }));
  trackLine.frustumCulled = false;
  trackLine.visible = false;
  scene.add(trackLine);

  world.setPattern = (rwyId, visible = true) => {
    const r = RUNWAYS[rwyId];
    const side = r.traffic === 'right' ? 1 : -1;
    const A = PATTERN_AGL_FT * FT;
    const pts = [
      [0, 0, 0], [r.len, 0, 0.0], [r.len + 700, 0, 213], [r.len + 900, 900, A], [r.len + 300, 1250, A],
      [-200, 1250, A], [-1100, 1250, A * 0.8], [-1500, 900, A * 0.62], [-1500, 250, glidepathAglFt(-1500) * FT + 25],
      [-1100, 0, glidepathAglFt(-1100) * FT], [305, 0, 0],
    ];
    const v = pts.map(([s, dp, y]) => {
      const p = pointOnRunway(r, s, dp * side);
      return new THREE.Vector3(p.x, y + 1, p.z);
    });
    const curve = new THREE.CatmullRomCurve3(v, false, 'centripetal', 0.3);
    patLine.geometry.dispose();
    patLine.geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(220));
    patLine.computeLineDistances();
    patLine.visible = visible;
  };
  world.showPattern = (on) => (patLine.visible = on);
  world.setTrack = (pts) => {
    trackLine.geometry.dispose();
    trackLine.geometry = new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p[1], p[2] * FT + 1, p[3])));
    trackLine.visible = pts.length > 1;
  };
  world.hideTrack = () => (trackLine.visible = false);

  // 매 프레임: 해 위치·밤 정도·PAPI 색·윈드삭
  const sunDir = new THREE.Vector3();
  const fogDay = new THREE.Color(0xc9d6e3), fogDusk = new THREE.Color(0xd9936a), fogNight = new THREE.Color(0x0a0f1c), fc = new THREE.Color();
  const warm = new THREE.Color(1, 0.62, 0.36), white = new THREE.Color(1, 0.98, 0.94);
  let beaconT = 0;
  world.update = ({ sunEl, sunAz, camera, focus, windDir, windKt, dt }) => {
    const el = rad(sunEl), az = rad(sunAz);
    sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az));
    su.sunPosition.value.copy(sunDir);
    const day = smooth(-6, 10, sunEl);
    const night = 1 - smooth(-10, -2, sunEl);
    world.night = night;
    const dusk = smooth(-8, 0, sunEl) * (1 - smooth(4, 16, sunEl));
    renderer.toneMappingExposure = 0.42 + 0.25 * night;
    sun.intensity = 2.8 * smooth(-1.5, 8, sunEl);
    sun.color.copy(warm).lerp(white, smooth(2, 25, sunEl));
    sun.position.copy(focus).addScaledVector(sunDir, 2000);
    sun.target.position.copy(focus);
    sun.castShadow = sunEl > 0;
    moon.intensity = 0.35 * night;
    hemi.intensity = 0.12 + 0.95 * day;
    hemi.color.setHSL(0.6, 0.4, 0.55 + 0.25 * day);
    hemi.groundColor.setHSL(0.08, 0.3, 0.2 + 0.25 * day);
    fc.copy(fogNight).lerp(fogDay, day).lerp(fogDusk, dusk * 0.55);
    scene.fog.color.copy(fc);
    stars.material.opacity = night;
    stars.visible = night > 0.02;
    const lightsOn = 1 - smooth(-2, 6, sunEl);
    world.cityLights.material.opacity = lightsOn;
    world.cityLights.visible = lightsOn > 0.02;
    world.rwyLights.material.opacity = 0.15 + 0.85 * lightsOn;
    beaconT += dt;
    const ph = beaconT % 2;
    beaconGeo.attributes.color.setXYZ(0, ph < 1 ? 0 : 1, 1, ph < 1 ? 0.4 : 1);
    beaconGeo.attributes.color.needsUpdate = true;
    beacon.material.opacity = ph % 1 < 0.25 ? lightsOn : 0.1 * lightsOn;
    // PAPI
    const pc = world.papi.geometry.attributes.color;
    papi.forEach((u, k) => {
      const dx = camera.position.x - u.x, dz = camera.position.z - u.z;
      const ang = (Math.atan2(camera.position.y - 1, Math.hypot(dx, dz)) * 180) / Math.PI;
      const f = runwayFrame(u.rwy, camera.position.x, camera.position.z);
      const facing = f.s < 305;
      if (!facing) return pc.setXYZ(k, 0, 0, 0);
      if (ang > u.thr) pc.setXYZ(k, 1, 1, 1);
      else pc.setXYZ(k, 1, 0.1, 0.08);
    });
    pc.needsUpdate = true;
    world.papi.material.opacity = 0.9;
    // 윈드삭: 바람이 가는 쪽을 가리키고, 바람이 셀수록 들림
    sock.rotation.y = -rad((windDir + 180) % 360) + Math.PI;
    sock.userData.pivot.rotation.x = -(Math.PI / 2) * (0.25 + 0.75 * Math.min(1, windKt / 15)) + Math.PI / 2;
    for (const p of parked) p.userData.update(dt, { night });
  };
  world.terrain = terrain;
  return world;
}
