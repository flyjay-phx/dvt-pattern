// 세스나 172 3D 모델 (기본 도형으로 직접 만든 것). 앞 = -Z, 바퀴 바닥 = y -1.25
import * as THREE from 'three';

const glowTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
export { glowTex };

function tailTexture(tail, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.font = 'bold 44px "IBM Plex Mono", monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(tail, 128, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function buildC172({ stripe = '#1f5fbf', tail = 'N172SP', landingLight = false, detail = true } = {}) {
  const root = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.45, metalness: 0.1 });
  const stripeMat = new THREE.MeshStandardMaterial({ color: stripe, roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.7 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1b2a3a, roughness: 0.1, metalness: 0.6 });
  const tire = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });

  // 동체: 회전체 단면을 위아래로 늘림
  const prof = [[0, -4.15], [0.3, -4.05], [0.5, -3.7], [0.6, -3.0], [0.66, -2.0], [0.66, -0.9], [0.56, 0.4], [0.38, 1.9], [0.22, 3.3], [0.13, 4.1]].map(([r, z]) => new THREE.Vector2(r, z));
  const fg = new THREE.LatheGeometry(prof, detail ? 20 : 10);
  fg.rotateX(Math.PI / 2);
  fg.scale(1, 1.25, 1);
  const fus = new THREE.Mesh(fg, white);
  fus.castShadow = true;
  root.add(fus);
  for (const s of [-1, 1]) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.14, 6.6), stripeMat);
    st.position.set(s * 0.63, -0.1, 0.2);
    st.rotation.y = s * 0.035;
    root.add(st);
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.35), new THREE.MeshBasicMaterial({ map: tailTexture(tail, '#1a1a1a'), transparent: true, depthWrite: false }));
    lab.position.set(s * 0.36, 0.15, 2.4);
    lab.rotation.y = s * (Math.PI / 2 + 0.09);
    root.add(lab);
  }
  // 조종석 유리
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.55, 1.9), glass);
  cab.position.set(0, 0.52, -1.15);
  root.add(cab);
  const ws = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.08, 0.9), glass);
  ws.position.set(0, 0.62, -2.35);
  ws.rotation.x = 0.55;
  root.add(ws);

  // 날개 (높은 날개)
  const wing = new THREE.Mesh(new THREE.BoxGeometry(11, 0.14, 1.5), white);
  wing.position.set(0, 0.95, -1.0);
  wing.castShadow = true;
  root.add(wing);
  for (const s of [-1, 1]) {
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, 1.5), stripeMat);
    tip.position.set(s * 5.3, 0.95, -1.0);
    root.add(tip);
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 6), white);
    strut.position.set(s * 1.6, 0.25, -0.95);
    strut.rotation.z = -s * 0.98;
    root.add(strut);
  }
  // 플랩 (날개 뒤쪽 안쪽, 접는 축이 뒷전)
  const flaps = [];
  for (const s of [-1, 1]) {
    const piv = new THREE.Group();
    piv.position.set(s * 2.4, 0.9, -0.3);
    const fl = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.06, 0.45), white);
    fl.position.set(0, 0, 0.22);
    piv.add(fl);
    root.add(piv);
    flaps.push(piv);
  }
  // 꼬리
  const hs = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.08, 1.0), white);
  hs.position.set(0, 0.22, 3.7);
  hs.castShadow = true;
  root.add(hs);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.55, 1.25), white);
  fin.position.set(0, 1.0, 3.75);
  fin.rotation.x = -0.42;
  fin.castShadow = true;
  root.add(fin);
  const finStripe = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.25, 1.2), stripeMat);
  finStripe.position.set(0, 1.25, 3.85);
  finStripe.rotation.x = -0.42;
  root.add(finStripe);

  // 바퀴
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.1, 0.08), dark);
    leg.position.set(s * 0.9, -0.75, -0.25);
    leg.rotation.z = s * -0.6;
    root.add(leg);
    const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.18, 14), tire);
    wh.rotation.z = Math.PI / 2;
    wh.position.set(s * 1.25, -0.95, -0.25);
    wh.castShadow = true;
    root.add(wh);
  }
  const ns = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.75, 6), dark);
  ns.position.set(0, -0.75, -3.1);
  root.add(ns);
  const nw = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.14, 12), tire);
  nw.rotation.z = Math.PI / 2;
  nw.position.set(0, -1.0, -3.1);
  root.add(nw);

  // 프로펠러
  const prop = new THREE.Group();
  prop.position.set(0, 0, -4.2);
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.45, 12), white);
  spinner.rotation.x = -Math.PI / 2;
  spinner.position.z = -0.12;
  prop.add(spinner);
  const blades = new THREE.Group();
  for (const s of [-1, 1]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.95, 0.04), dark);
    b.position.y = s * 0.5;
    b.rotation.y = s * 0.25;
    blades.add(b);
  }
  prop.add(blades);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.98, 28), new THREE.MeshBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
  prop.add(disc);
  root.add(prop);

  // 항법등: 왼쪽 빨강, 오른쪽 초록, 꼬리 흰색 + 깜빡이는 스트로브
  const navGeo = new THREE.BufferGeometry();
  navGeo.setAttribute('position', new THREE.Float32BufferAttribute([-5.55, 0.95, -1.0, 5.55, 0.95, -1.0, 0, 0.35, 4.15, -5.55, 0.98, -0.9, 5.55, 0.98, -0.9], 3));
  navGeo.setAttribute('color', new THREE.Float32BufferAttribute([1, 0.1, 0.1, 0.1, 1, 0.3, 1, 1, 1, 1, 1, 1, 1, 1, 1], 3));
  const navMat = new THREE.PointsMaterial({ size: 5, sizeAttenuation: false, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const nav = new THREE.Points(navGeo, navMat);
  nav.frustumCulled = false;
  root.add(nav);

  let lamp = null;
  if (landingLight) {
    lamp = new THREE.SpotLight(0xfff2d8, 0, 900, 0.32, 0.5, 1.4);
    lamp.position.set(-1.5, 0.9, -1.6);
    lamp.target.position.set(-1.5, -12, -60);
    root.add(lamp, lamp.target);
  }

  let strobeT = 0;
  root.userData = {
    update(dt, { rpm = 0, flaps: f = 0, night = 0 } = {}) {
      blades.rotation.z += (rpm / 60) * Math.PI * 2 * dt;
      blades.visible = rpm < 900;
      disc.visible = rpm >= 400;
      for (const p of flaps) p.rotation.x = (f * Math.PI) / 180;
      strobeT += dt;
      const strobe = strobeT % 1.2 < 0.06 ? 1 : 0;
      const col = navGeo.attributes.color;
      for (const i of [3, 4]) col.setXYZ(i, strobe, strobe, strobe);
      col.needsUpdate = true;
      navMat.opacity = 0.35 + 0.65 * night;
      if (lamp) lamp.intensity = night > 0.2 ? 3500 * night : 0;
    },
  };
  return root;
}

// 다른 비행기 이름표
export function nameTag(text) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  g.font = '600 40px Pretendard, system-ui, sans-serif';
  const w = Math.min(500, g.measureText(text).width + 44);
  g.fillStyle = 'rgba(12,16,24,0.72)';
  g.beginPath();
  g.roundRect((512 - w) / 2, 14, w, 64, 32);
  g.fill();
  g.fillStyle = '#f5f1e6';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 47);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, sizeAttenuation: false, transparent: true }));
  s.scale.set(0.16, 0.03, 1);
  s.position.set(0, 3.2, 0);
  s.renderOrder = 10;
  return s;
}
