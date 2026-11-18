// 작은 벡터·쿼터니언 도우미 (three.js 없이 서버 테스트에서도 쓰기 위해 따로 둔다)
export const v = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const add = (a, b) => v(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a, b) => v(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a, s) => v(a.x * s, a.y * s, a.z * s);
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a, b) => v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const len = (a) => Math.hypot(a.x, a.y, a.z);
export const norm = (a) => {
  const l = len(a);
  return l > 1e-9 ? scale(a, 1 / l) : v();
};

export const q = (x = 0, y = 0, z = 0, w = 1) => ({ x, y, z, w });
export function qmul(a, b) {
  return q(
    a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  );
}
export const qconj = (a) => q(-a.x, -a.y, -a.z, a.w);
export function qnorm(a) {
  const l = Math.hypot(a.x, a.y, a.z, a.w) || 1;
  return q(a.x / l, a.y / l, a.z / l, a.w / l);
}
export function qaxis(axis, ang) {
  const s = Math.sin(ang / 2);
  return q(axis.x * s, axis.y * s, axis.z * s, Math.cos(ang / 2));
}
// 벡터를 쿼터니언으로 회전
export function qrot(a, p) {
  const t = qmul(qmul(a, q(p.x, p.y, p.z, 0)), qconj(a));
  return v(t.x, t.y, t.z);
}
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
