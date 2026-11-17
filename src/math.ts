// Small math / color / noise toolkit. No dependencies.

export const TAU = Math.PI * 2;
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}
export const angleLerp = (a: number, b: number, t: number) => a + wrapAngle(b - a) * t;

/** Integer hash -> [0,1). */
export function hash3(x: number, y: number, z: number, seed = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 2246822519) + Math.imul(seed | 0, 3266489917)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export const hash2 = (x: number, y: number, seed = 0) => hash3(x, y, 0, seed);

export class RNG {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number) {
    return Math.floor(this.range(a, b + 1));
  }
  pick<T>(arr: T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  chance(p: number) {
    return this.next() < p;
  }
}

export class Noise2D {
  constructor(private seed: number) {}
  value(x: number, y: number): number {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi, this.seed), b = hash2(xi + 1, yi, this.seed);
    const c = hash2(xi, yi + 1, this.seed), d = hash2(xi + 1, yi + 1, this.seed);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }
  fbm(x: number, y: number, oct = 4): number {
    let sum = 0, amp = 0.5, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += this.value(x * f, y * f) * amp;
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return sum / norm;
  }
}

// ---- colors are packed little-endian ABGR (ImageData Uint32 view) ----
export const rgb = (r: number, g: number, b: number) =>
  ((255 << 24) | (clamp(b | 0, 0, 255) << 16) | (clamp(g | 0, 0, 255) << 8) | clamp(r | 0, 0, 255)) >>> 0;
export function hex(h: string): number {
  const n = parseInt(h.replace('#', ''), 16);
  return rgb((n >> 16) & 255, (n >> 8) & 255, n & 255);
}
export const cr = (c: number) => c & 255;
export const cg = (c: number) => (c >>> 8) & 255;
export const cb = (c: number) => (c >>> 16) & 255;
export function shade(c: number, f: number): number {
  return rgb((c & 255) * f, ((c >>> 8) & 255) * f, ((c >>> 16) & 255) * f);
}
export function mix(a: number, b: number, t: number): number {
  return rgb(
    lerp(a & 255, b & 255, t),
    lerp((a >>> 8) & 255, (b >>> 8) & 255, t),
    lerp((a >>> 16) & 255, (b >>> 16) & 255, t),
  );
}

// ---- 3x4 affine matrices, row-major: [m00 m01 m02 tx | m10 m11 m12 ty | m20 m21 m22 tz] ----
export type Mat = Float32Array;
export function mIdent(): Mat {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
}
export function mMul(a: Mat, b: Mat, out: Mat = new Float32Array(12)): Mat {
  const r = new Float32Array(12);
  for (let i = 0; i < 3; i++) {
    const a0 = a[i * 4], a1 = a[i * 4 + 1], a2 = a[i * 4 + 2];
    r[i * 4] = a0 * b[0] + a1 * b[4] + a2 * b[8];
    r[i * 4 + 1] = a0 * b[1] + a1 * b[5] + a2 * b[9];
    r[i * 4 + 2] = a0 * b[2] + a1 * b[6] + a2 * b[10];
    r[i * 4 + 3] = a0 * b[3] + a1 * b[7] + a2 * b[11] + a[i * 4 + 3];
  }
  out.set(r);
  return out;
}
export const mTrans = (x: number, y: number, z: number): Mat => new Float32Array([1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z]);
export const mScale = (s: number): Mat => new Float32Array([s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0]);
export function mRotX(a: number): Mat {
  const c = Math.cos(a), s = Math.sin(a);
  return new Float32Array([1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0]);
}
export function mRotY(a: number): Mat {
  const c = Math.cos(a), s = Math.sin(a);
  return new Float32Array([c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0]);
}
export function mRotZ(a: number): Mat {
  const c = Math.cos(a), s = Math.sin(a);
  return new Float32Array([c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0]);
}
/** Chain multiply left-to-right: mChain(A,B,C) = A*B*C */
export function mChain(...ms: Mat[]): Mat {
  let r = ms[0];
  for (let i = 1; i < ms.length; i++) r = mMul(r, ms[i]);
  return r;
}
/** Rotation about a pivot point: T(p) * Rz * Ry * Rx * T(-p) */
export function mPivot(px: number, py: number, pz: number, rx: number, ry = 0, rz = 0): Mat {
  return mChain(mTrans(px, py, pz), mRotZ(rz), mRotY(ry), mRotX(rx), mTrans(-px, -py, -pz));
}
export function mApply(m: Mat, x: number, y: number, z: number): [number, number, number] {
  return [
    m[0] * x + m[1] * y + m[2] * z + m[3],
    m[4] * x + m[5] * y + m[6] * z + m[7],
    m[8] * x + m[9] * y + m[10] * z + m[11],
  ];
}
