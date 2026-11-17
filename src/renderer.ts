// Custom software rasterizer: a low-res framebuffer + z-buffer that draws
// voxel faces as convex polygons, then upscales with nearest-neighbour.
import { Mat, mix, shade, hash2, clamp, rgb } from './math';
import { FONT } from './font';
import { TEXTURES, LEVELS, TPU, Texture } from './textures';

export const W = 384;
export const H = 216;

export const FLAG_XRAY = 1; // draw a dithered silhouette where hidden behind terrain
export const FLAG_SHADOW = 2; // darken what's underneath, no depth write
export const FLAG_FLASH = 4; // draw solid flash color

/** A batch of unit-cube faces. pos = voxel min-corner, dir = 0..5 (+x,-x,+y,-y,+z,-z) */
export interface FaceSet {
  n: number;
  pos: Float32Array;
  dir: Uint8Array;
  col: Uint32Array;
  tex?: Uint8Array; // texture id per face (0 = flat)
  ao?: Uint8Array; // edge occlusion mask per face (u-,u+,v-,v+)
}

// 4x4 ordered-dither matrix (0..1)
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

// corner offsets for each face direction (a cycle around the face)
const CORN: number[][] = [
  [1, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1],
  [0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0],
  [0, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0],
  [0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1],
  [0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1],
  [0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0],
];

export class Renderer {
  readonly color: Uint32Array;
  readonly depth = new Float32Array(W * H); // stores 1/z, 0 = empty (sky)
  readonly ids = new Uint8Array(W * H); // 0 = terrain, >0 = entity
  readonly nbuf = new Uint8Array(W * H); // terrain face direction per pixel, 255 = other
  readonly emis = new Uint8Array(W * H); // 1 where an emissive (neon) surface is visible
  glowStrength = 0.55;
  private glow = new Float32Array((W >> 2) * (H >> 2) * 3);
  private glow2 = new Float32Array((W >> 2) * (H >> 2) * 3);
  private img: ImageData;
  private ctx: CanvasRenderingContext2D;

  // camera
  view: Mat = new Float32Array(12);
  camPos = [0, 0, 0];
  focal = 100;
  cx = W / 2;
  cy = H / 2;
  near = 0.08;
  yaw = 0;
  pitch = 0;

  // atmosphere
  fogColor = 0;
  fogStart = 50;
  fogEnd = 100;
  skyTop = 0;
  skyBot = 0;
  stars = false;
  outlineThreshold = 1.4;
  silhouetteColor = 0;

  // scratch
  private rowMinX = new Float32Array(H);
  private rowMaxX = new Float32Array(H);
  private rowMinZ = new Float32Array(H);
  private rowMaxZ = new Float32Array(H);
  private qx = new Float32Array(16);
  private qy = new Float32Array(16);
  private qz = new Float32Array(16);
  private tx = new Float32Array(16);
  private ty = new Float32Array(16);
  private tz = new Float32Array(16);
  private qu = new Float32Array(16);
  private qv = new Float32Array(16);
  private tu = new Float32Array(16);
  private tv = new Float32Array(16);
  private rowMinU = new Float32Array(H);
  private rowMinV = new Float32Array(H);
  private rowMaxU = new Float32Array(H);
  private rowMaxV = new Float32Array(H);
  private pal = new Uint32Array(8);
  private curDir = 255;
  private curEmis = 0;
  private off = new Float32Array(6 * 12);
  private nrm = new Float32Array(18);
  private nOff = new Float32Array(6);
  private skyRow = new Uint32Array(H);
  private post = new Uint32Array(W * H);

  stats = { faces: 0, polys: 0 };

  // occlusion cutaway: terrain faces above cutWY, nearer than cutZ and within
  // cutR (view-space, in the xy plane) of (cutX,cutY) are skipped
  dither = false; // draw only every other pixel (see-through)
  cutActive = false;
  cutX = 0; cutY = 0; cutZ = 0; cutR2 = 0; cutWY = 0;

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = W;
    canvas.height = H;
    this.ctx = canvas.getContext('2d')!;
    this.img = this.ctx.createImageData(W, H);
    this.color = new Uint32Array(this.img.data.buffer);
  }

  setCamera(px: number, py: number, pz: number, yaw: number, pitch: number, fovY: number) {
    this.yaw = yaw;
    this.pitch = pitch;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const fx = Math.sin(yaw) * cp, fy = -sp, fz = Math.cos(yaw) * cp;
    const rx = Math.cos(yaw), ry = 0, rz = -Math.sin(yaw);
    // u = f x r
    const ux = fy * rz - fz * ry, uy = fz * rx - fx * rz, uz = fx * ry - fy * rx;
    const v = this.view;
    v[0] = rx; v[1] = ry; v[2] = rz; v[3] = -(rx * px + ry * py + rz * pz);
    v[4] = ux; v[5] = uy; v[6] = uz; v[7] = -(ux * px + uy * py + uz * pz);
    v[8] = fx; v[9] = fy; v[10] = fz; v[11] = -(fx * px + fy * py + fz * pz);
    this.camPos = [px, py, pz];
    this.focal = H / 2 / Math.tan(fovY / 2);
  }

  /** world -> view */
  toView(x: number, y: number, z: number): [number, number, number] {
    const v = this.view;
    return [
      v[0] * x + v[1] * y + v[2] * z + v[3],
      v[4] * x + v[5] * y + v[6] * z + v[7],
      v[8] * x + v[9] * y + v[10] * z + v[11],
    ];
  }

  /** Is a sphere (world space) potentially visible? */
  sphereVisible(x: number, y: number, z: number, rad: number, maxZ: number): boolean {
    const [vx, vy, vz] = this.toView(x, y, z);
    if (vz < -rad || vz - rad > maxZ) return false;
    const tx = (W / 2) / this.focal, ty = (H / 2) / this.focal;
    const nx = 1 / Math.sqrt(1 + tx * tx), ny = 1 / Math.sqrt(1 + ty * ty);
    if ((Math.abs(vx) - vz * tx) * nx > rad) return false;
    if ((Math.abs(vy) - vz * ty) * ny > rad) return false;
    return true;
  }

  clear() {
    this.depth.fill(0);
    this.ids.fill(0);
    this.nbuf.fill(255);
    this.emis.fill(0);
    this.stats.faces = 0;
    this.stats.polys = 0;
  }

  /**
   * Draw a set of cube faces with model->view matrix m.
   * shadeTab: optional per-direction light multiplier (for dynamic models).
   */
  drawFaces(fs: FaceSet, m: Mat, shadeTab: Float32Array | null, flags: number, id: number, flashCol = 0xffffffff) {
    const ax = m[0], ay = m[4], az = m[8];
    const bx = m[1], by = m[5], bz = m[9];
    const cx = m[2], cy = m[6], cz = m[10];
    const tx = m[3], ty = m[7], tz = m[11];
    const off = this.off, nrm = this.nrm, nOff = this.nOff;
    for (let d = 0; d < 6; d++) {
      const c = CORN[d];
      for (let k = 0; k < 4; k++) {
        const a = c[k * 3], b = c[k * 3 + 1], e = c[k * 3 + 2];
        off[d * 12 + k * 3] = a * ax + b * bx + e * cx;
        off[d * 12 + k * 3 + 1] = a * ay + b * by + e * cy;
        off[d * 12 + k * 3 + 2] = a * az + b * bz + e * cz;
      }
      const s = d & 1 ? -1 : 1;
      const ax2 = d < 2 ? ax : d < 4 ? bx : cx;
      const ay2 = d < 2 ? ay : d < 4 ? by : cy;
      const az2 = d < 2 ? az : d < 4 ? bz : cz;
      nrm[d * 3] = s * ax2; nrm[d * 3 + 1] = s * ay2; nrm[d * 3 + 2] = s * az2;
      nOff[d] = nrm[d * 3] * off[d * 12] + nrm[d * 3 + 1] * off[d * 12 + 1] + nrm[d * 3 + 2] * off[d * 12 + 2];
    }
    const pos = fs.pos, dir = fs.dir, col = fs.col, tex = fs.tex, aom = fs.ao;
    const qu = this.qu, qv = this.qv, pal = this.pal;
    const qx = this.qx, qy = this.qy, qz = this.qz;
    const n = fs.n;
    const cut = this.cutActive && id === 0;
    const cX = this.cutX, cY = this.cutY, cZ = this.cutZ, cR2 = this.cutR2, cWY = this.cutWY;
    for (let i = 0; i < n; i++) {
      const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
      const bxv = tx + px * ax + py * bx + pz * cx;
      const byv = ty + px * ay + py * by + pz * cy;
      const bzv = tz + px * az + py * bz + pz * cz;
      if (cut && py >= cWY && bzv < cZ && (bxv - cX) * (bxv - cX) + (byv - cY) * (byv - cY) < cR2) continue;
      const d = dir[i];
      if (nrm[d * 3] * bxv + nrm[d * 3 + 1] * byv + nrm[d * 3 + 2] * bzv + nOff[d] >= 0) continue;
      const o = d * 12;
      qx[0] = bxv + off[o]; qy[0] = byv + off[o + 1]; qz[0] = bzv + off[o + 2];
      qx[1] = bxv + off[o + 3]; qy[1] = byv + off[o + 4]; qz[1] = bzv + off[o + 5];
      qx[2] = bxv + off[o + 6]; qy[2] = byv + off[o + 7]; qz[2] = bzv + off[o + 8];
      qx[3] = bxv + off[o + 9]; qy[3] = byv + off[o + 10]; qz[3] = bzv + off[o + 11];
      let c = col[i];
      if (flags & FLAG_FLASH) c = flashCol;
      else if (shadeTab) c = shade(c, shadeTab[d]);
      this.stats.faces++;
      this.curDir = id === 0 ? d : 255;
      const t = tex ? tex[i] : 0;
      if (t > 0) {
        const cn = CORN[d];
        for (let k = 0; k < 4; k++) {
          const a = cn[k * 3], b = cn[k * 3 + 1], e = cn[k * 3 + 2];
          if (d < 2) { qu[k] = pz + e; qv[k] = py + b; }
          else if (d < 4) { qu[k] = px + a; qv[k] = pz + e; }
          else { qu[k] = px + a; qv[k] = py + b; }
        }
        for (let k = 0; k < 8; k++) pal[k] = shade(c, LEVELS[k]);
        this.curEmis = t & 0x80 ? 1 : 0;
        this.polyTex(TEXTURES[t & 0x7f], aom ? aom[i] : 0, id);
      } else {
        this.poly(4, c, flags, id);
      }
    }
  }

  /** Draw an arbitrary convex polygon given in world space. */
  drawWorldPoly(pts: number[], color: number, flags: number, id = 0) {
    const n = pts.length / 3;
    const v = this.view;
    for (let k = 0; k < n; k++) {
      const x = pts[k * 3], y = pts[k * 3 + 1], z = pts[k * 3 + 2];
      this.qx[k] = v[0] * x + v[1] * y + v[2] * z + v[3];
      this.qy[k] = v[4] * x + v[5] * y + v[6] * z + v[7];
      this.qz[k] = v[8] * x + v[9] * y + v[10] * z + v[11];
    }
    this.poly(n, color, flags, id);
  }

  private poly(n: number, color: number, flags: number, id: number) {
    let qx = this.qx, qy = this.qy, qz = this.qz;
    const near = this.near;
    let inside = 0;
    for (let k = 0; k < n; k++) if (qz[k] >= near) inside++;
    if (inside === 0) return;
    if (inside < n) {
      // Sutherland-Hodgman against z = near
      const ox = this.tx, oy = this.ty, oz = this.tz;
      let m = 0;
      for (let k = 0; k < n; k++) {
        const j = (k + 1) % n;
        const ain = qz[k] >= near, bin = qz[j] >= near;
        if (ain) { ox[m] = qx[k]; oy[m] = qy[k]; oz[m] = qz[k]; m++; }
        if (ain !== bin) {
          const t = (near - qz[k]) / (qz[j] - qz[k]);
          ox[m] = qx[k] + (qx[j] - qx[k]) * t;
          oy[m] = qy[k] + (qy[j] - qy[k]) * t;
          oz[m] = near;
          m++;
        }
      }
      if (m < 3) return;
      n = m; qx = ox; qy = oy; qz = oz;
    }
    // project in place into (qx,qy) screen and qz = 1/z
    const f = this.focal, cx = this.cx, cy = this.cy;
    let ymin = 1e9, ymax = -1e9, xmin = 1e9, xmax = -1e9;
    for (let k = 0; k < n; k++) {
      const iz = 1 / qz[k];
      const sx = cx + qx[k] * f * iz, sy = cy - qy[k] * f * iz;
      qx[k] = sx; qy[k] = sy; qz[k] = iz;
      if (sy < ymin) ymin = sy;
      if (sy > ymax) ymax = sy;
      if (sx < xmin) xmin = sx;
      if (sx > xmax) xmax = sx;
    }
    if (ymax < 0 || ymin > H || xmax < 0 || xmin > W) return;
    const y0 = Math.max(0, Math.ceil(ymin - 0.5));
    const y1 = Math.min(H - 1, Math.ceil(ymax - 0.5) - 1);
    if (y1 < y0) return;
    const rMinX = this.rowMinX, rMaxX = this.rowMaxX, rMinZ = this.rowMinZ, rMaxZ = this.rowMaxZ;
    for (let y = y0; y <= y1; y++) { rMinX[y] = 1e9; rMaxX[y] = -1e9; }
    for (let k = 0; k < n; k++) {
      const j = k + 1 === n ? 0 : k + 1;
      let ax = qx[k], ay = qy[k], az = qz[k], bx = qx[j], by = qy[j], bz = qz[j];
      if (ay === by) continue;
      if (ay > by) { let t = ax; ax = bx; bx = t; t = ay; ay = by; by = t; t = az; az = bz; bz = t; }
      const ys = Math.max(y0, Math.ceil(ay - 0.5));
      const ye = Math.min(y1, Math.ceil(by - 0.5) - 1);
      if (ye < ys) continue;
      const inv = 1 / (by - ay);
      const dxdy = (bx - ax) * inv, dzdy = (bz - az) * inv;
      let x = ax + (ys + 0.5 - ay) * dxdy, z = az + (ys + 0.5 - ay) * dzdy;
      for (let y = ys; y <= ye; y++) {
        if (x < rMinX[y]) { rMinX[y] = x; rMinZ[y] = z; }
        if (x > rMaxX[y]) { rMaxX[y] = x; rMaxZ[y] = z; }
        x += dxdy; z += dzdy;
      }
    }
    this.stats.polys++;
    const depth = this.depth, cbuf = this.color, ids = this.ids;
    const xray = flags & FLAG_XRAY, shadowF = flags & FLAG_SHADOW;
    const sil = this.silhouetteColor;
    for (let y = y0; y <= y1; y++) {
      const lx = rMinX[y], rx = rMaxX[y];
      if (rx < lx) continue;
      const xs = Math.max(0, Math.ceil(lx - 0.5));
      const xe = Math.min(W - 1, Math.ceil(rx - 0.5) - 1);
      if (xe < xs) continue;
      const span = rx - lx;
      const dz = span > 1e-6 ? (rMaxZ[y] - rMinZ[y]) / span : 0;
      let z = rMinZ[y] + (xs + 0.5 - lx) * dz;
      let idx = y * W + xs;
      if (shadowF) {
        for (let x = xs; x <= xe; x++, idx++, z += dz) {
          if (z >= depth[idx] * 0.99995 && ids[idx] === 0 && depth[idx] > 0) cbuf[idx] = shade(cbuf[idx], 0.55);
        }
      } else if (xray && !this.dither) {
        for (let x = xs; x <= xe; x++, idx++, z += dz) {
          const d = depth[idx];
          if (z > d) { depth[idx] = z; cbuf[idx] = color; ids[idx] = id; }
          else if (ids[idx] === 0 && ((x + y) & 1) === 0 && 1 / z - 1 / d > 0.8) cbuf[idx] = sil;
        }
      } else if (this.dither) {
        for (let x = xs; x <= xe; x++, idx++, z += dz) {
          if (((x + y) & 1) === 0 && z > depth[idx]) { depth[idx] = z; cbuf[idx] = color; ids[idx] = id; }
        }
      } else {
        const nd = this.curDir;
        for (let x = xs; x <= xe; x++, idx++, z += dz) {
          if (z > depth[idx]) { depth[idx] = z; cbuf[idx] = color; ids[idx] = id; this.nbuf[idx] = nd; this.emis[idx] = 0; }
        }
      }
    }
  }

  /** Textured, perspective-correct quad (qx/qy/qz + qu/qv in world units). */
  private polyTex(tx: Texture, aoMask: number, id: number) {
    let n = 4;
    let qx = this.qx, qy = this.qy, qz = this.qz, qu = this.qu, qv = this.qv;
    const near = this.near;
    let inside = 0;
    for (let k = 0; k < n; k++) if (qz[k] >= near) inside++;
    if (inside === 0) return;
    if (inside < n) {
      const ox = this.tx, oy = this.ty, oz = this.tz, ou = this.tu, ov = this.tv;
      let m = 0;
      for (let k = 0; k < n; k++) {
        const j = (k + 1) % n;
        const ain = qz[k] >= near, bin = qz[j] >= near;
        if (ain) { ox[m] = qx[k]; oy[m] = qy[k]; oz[m] = qz[k]; ou[m] = qu[k]; ov[m] = qv[k]; m++; }
        if (ain !== bin) {
          const t = (near - qz[k]) / (qz[j] - qz[k]);
          ox[m] = qx[k] + (qx[j] - qx[k]) * t;
          oy[m] = qy[k] + (qy[j] - qy[k]) * t;
          ou[m] = qu[k] + (qu[j] - qu[k]) * t;
          ov[m] = qv[k] + (qv[j] - qv[k]) * t;
          oz[m] = near;
          m++;
        }
      }
      if (m < 3) return;
      n = m; qx = ox; qy = oy; qz = oz; qu = ou; qv = ov;
    }
    const f = this.focal, cx = this.cx, cy = this.cy;
    let ymin = 1e9, ymax = -1e9, xmin = 1e9, xmax = -1e9;
    for (let k = 0; k < n; k++) {
      const iz = 1 / qz[k];
      const sx = cx + qx[k] * f * iz, sy = cy - qy[k] * f * iz;
      qx[k] = sx; qy[k] = sy; qz[k] = iz; qu[k] *= iz; qv[k] *= iz;
      if (sy < ymin) ymin = sy;
      if (sy > ymax) ymax = sy;
      if (sx < xmin) xmin = sx;
      if (sx > xmax) xmax = sx;
    }
    if (ymax < 0 || ymin > H || xmax < 0 || xmin > W) return;
    const y0 = Math.max(0, Math.ceil(ymin - 0.5));
    const y1 = Math.min(H - 1, Math.ceil(ymax - 0.5) - 1);
    if (y1 < y0) return;
    const rMinX = this.rowMinX, rMaxX = this.rowMaxX, rMinZ = this.rowMinZ, rMaxZ = this.rowMaxZ;
    const rMinU = this.rowMinU, rMaxU = this.rowMaxU, rMinV = this.rowMinV, rMaxV = this.rowMaxV;
    for (let y = y0; y <= y1; y++) { rMinX[y] = 1e9; rMaxX[y] = -1e9; }
    for (let k = 0; k < n; k++) {
      const j = k + 1 === n ? 0 : k + 1;
      let ax = qx[k], ay = qy[k], az = qz[k], au = qu[k], av = qv[k];
      let bx = qx[j], by = qy[j], bz = qz[j], bu = qu[j], bv = qv[j];
      if (ay === by) continue;
      if (ay > by) {
        let t = ax; ax = bx; bx = t; t = ay; ay = by; by = t; t = az; az = bz; bz = t;
        t = au; au = bu; bu = t; t = av; av = bv; bv = t;
      }
      const ys = Math.max(y0, Math.ceil(ay - 0.5));
      const ye = Math.min(y1, Math.ceil(by - 0.5) - 1);
      if (ye < ys) continue;
      const inv = 1 / (by - ay);
      const dxdy = (bx - ax) * inv, dzdy = (bz - az) * inv, dudy = (bu - au) * inv, dvdy = (bv - av) * inv;
      const o = ys + 0.5 - ay;
      let x = ax + o * dxdy, z = az + o * dzdy, u = au + o * dudy, v = av + o * dvdy;
      for (let y = ys; y <= ye; y++) {
        if (x < rMinX[y]) { rMinX[y] = x; rMinZ[y] = z; rMinU[y] = u; rMinV[y] = v; }
        if (x > rMaxX[y]) { rMaxX[y] = x; rMaxZ[y] = z; rMaxU[y] = u; rMaxV[y] = v; }
        x += dxdy; z += dzdy; u += dudy; v += dvdy;
      }
    }
    this.stats.polys++;
    const depth = this.depth, cbuf = this.color, ids = this.ids, nbuf = this.nbuf;
    const pal = this.pal, td = tx.d, tw = tx.w, th = tx.h, nd = this.curDir;
    const dither = this.dither, em = this.curEmis, ebuf = this.emis;
    for (let y = y0; y <= y1; y++) {
      const lx = rMinX[y], rx = rMaxX[y];
      if (rx < lx) continue;
      const xs = Math.max(0, Math.ceil(lx - 0.5));
      const xe = Math.min(W - 1, Math.ceil(rx - 0.5) - 1);
      if (xe < xs) continue;
      const span = rx - lx;
      const is = span > 1e-6 ? 1 / span : 0;
      const dz = (rMaxZ[y] - rMinZ[y]) * is, du = (rMaxU[y] - rMinU[y]) * is, dv = (rMaxV[y] - rMinV[y]) * is;
      const o = xs + 0.5 - lx;
      let z = rMinZ[y] + o * dz, uz = rMinU[y] + o * du, vz = rMinV[y] + o * dv;
      let idx = y * W + xs;
      for (let x = xs; x <= xe; x++, idx++, z += dz, uz += du, vz += dv) {
        if (z <= depth[idx]) continue;
        if (dither && ((x + y) & 1)) continue;
        const iz = 1 / z;
        const u = uz * iz, v = vz * iz;
        const tu = Math.floor(u * TPU), tvv = Math.floor(v * TPU);
        let col = tu % tw; if (col < 0) col += tw;
        let row = tvv % th; if (row < 0) row += th;
        let lvl = td[(th - 1 - row) * tw + col];
        if (aoMask) {
          let lu = tu - Math.floor(u) * TPU, lv = tvv - Math.floor(v) * TPU;
          lu = lu < 0 ? 0 : lu > TPU - 1 ? TPU - 1 : lu;
          lv = lv < 0 ? 0 : lv > TPU - 1 ? TPU - 1 : lv;
          let dist = 9;
          if (aoMask & 1 && lu < dist) dist = lu;
          if (aoMask & 2 && TPU - 1 - lu < dist) dist = TPU - 1 - lu;
          if (aoMask & 4 && lv < dist) dist = lv;
          if (aoMask & 8 && TPU - 1 - lv < dist) dist = TPU - 1 - lv;
          const k = dist === 0 ? 3 : dist === 1 ? 2 : dist === 2 ? ((x + y) & 1) + 1 : dist === 3 ? (x + y) & 1 : 0;
          lvl = lvl > k ? lvl - k : 0;
        }
        depth[idx] = z; cbuf[idx] = pal[lvl]; ids[idx] = id; nbuf[idx] = nd; ebuf[idx] = em;
      }
    }
  }

  /** Screen-facing square particle at world pos, depth tested. size in world units. */
  drawParticle(x: number, y: number, z: number, size: number, color: number, minPx = 1) {
    const [vx, vy, vz] = this.toView(x, y, z);
    if (vz < this.near) return;
    const iz = 1 / vz;
    const s = Math.max(minPx, Math.round(size * this.focal * iz));
    const sx = Math.round(this.cx + vx * this.focal * iz - s / 2);
    const sy = Math.round(this.cy - vy * this.focal * iz - s / 2);
    for (let yy = sy; yy < sy + s; yy++) {
      if (yy < 0 || yy >= H) continue;
      for (let xx = sx; xx < sx + s; xx++) {
        if (xx < 0 || xx >= W) continue;
        const idx = yy * W + xx;
        if (iz > this.depth[idx]) { this.depth[idx] = iz; this.color[idx] = color; this.ids[idx] = 250; }
      }
    }
  }

  /** Vertical streak (rain). */
  drawStreak(x: number, y: number, z: number, len: number, color: number) {
    const [vx, vy, vz] = this.toView(x, y, z);
    if (vz < this.near) return;
    const iz = 1 / vz;
    const sx = Math.round(this.cx + vx * this.focal * iz);
    const sy = Math.round(this.cy - vy * this.focal * iz);
    const l = Math.max(2, Math.min(8, Math.round(len * this.focal * iz)));
    if (sx < 0 || sx >= W) return;
    for (let yy = sy; yy < sy + l; yy++) {
      if (yy < 0 || yy >= H) continue;
      const idx = yy * W + sx;
      if (iz > this.depth[idx]) this.color[idx] = mix(this.color[idx], color, 0.6);
    }
  }

  /** Sky (dithered bands), dithered fog, rim highlights and outlines. */
  postProcess(time: number) {
    const depth = this.depth, col = this.color, out = this.post, ids = this.ids, nb = this.nbuf;
    const BANDS = 9;
    const fogS = this.fogStart, fogE = this.fogEnd, fogC = this.fogColor, invF = 1 / (fogE - fogS);
    const fogPal: number[] = [];
    const thr = this.outlineThreshold;
    const starShift = Math.round(this.yaw * 300);
    const starPitch = Math.round(this.pitch * 200);
    const bandCols: number[] = [];
    for (let b = 0; b <= BANDS; b++) bandCols.push(mix(this.skyTop, this.skyBot, Math.pow(b / BANDS, 1.2)));
    void fogPal;
    // --- neon glow: accumulate emissive pixels at quarter res, blur, add back
    const GW = W >> 2, GH = H >> 2, g = this.glow, g2 = this.glow2;
    g.fill(0);
    let anyGlow = false;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!this.emis[i] || depth[i] === 0 || ids[i] !== 0) continue;
        anyGlow = true;
        const c = col[i], gi = ((y >> 2) * GW + (x >> 2)) * 3;
        g[gi] += (c & 255) / 16; g[gi + 1] += ((c >>> 8) & 255) / 16; g[gi + 2] += ((c >>> 16) & 255) / 16;
      }
    if (anyGlow) {
      for (let pass = 0; pass < 2; pass++) {
        for (let y = 0; y < GH; y++)
          for (let x = 0; x < GW; x++) {
            let r = 0, gg = 0, b = 0, cnt = 0;
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++) {
                const xx = x + dx, yy = y + dy;
                if (xx < 0 || yy < 0 || xx >= GW || yy >= GH) continue;
                const k = (yy * GW + xx) * 3;
                r += g[k]; gg += g[k + 1]; b += g[k + 2]; cnt++;
              }
            const k = (y * GW + x) * 3;
            g2[k] = r / cnt; g2[k + 1] = gg / cnt; g2[k + 2] = b / cnt;
          }
        g.set(g2);
      }
    }
    const gs = this.glowStrength;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const d = depth[i];
        const bay = BAYER[(y & 3) * 4 + (x & 3)];
        if (d === 0) {
          // banded 16-bit style sky gradient with ordered dither between bands
          const t = (y / H) * BANDS;
          let c = bandCols[clamp(Math.floor(t + bay), 0, BANDS)];
          if (this.stars) {
            const h = hash2(x + starShift, y + starPitch, 77);
            if (h < 0.004) c = Math.sin(time * 3 + h * 5000) > 0 ? 0xffffffff : mix(c, 0xffffffff, 0.5);
          }
          let edge = false;
          if (x > 0 && depth[i - 1] > 0) edge = true;
          else if (x < W - 1 && depth[i + 1] > 0) edge = true;
          else if (y > 0 && depth[i - W] > 0) edge = true;
          else if (y < H - 1 && depth[i + W] > 0) edge = true;
          out[i] = edge ? shade(c, 0.35) : c;
          continue;
        }
        const z = 1 / d;
        let c = col[i];
        const myId = ids[i];
        // outline: this pixel is farther than a neighbour by > thr, or borders a character
        let outline = 0;
        const check = (j: number) => {
          const e = depth[j];
          if (e <= d) return;
          const nid = ids[j];
          if (nid !== myId && nid > 0 && nid < 200) outline = 2;
          else if (z - 1 / e > thr && outline === 0) outline = 1;
        };
        if (x > 0) check(i - 1);
        if (x < W - 1) check(i + 1);
        if (y > 0) check(i - W);
        if (y < H - 1) check(i + W);
        // light rim on convex top edges (top face pixel sitting right above a nearer side face)
        if (myId === 0 && nb[i] === 2 && y < H - 1 && outline === 0) {
          const j = i + W, nd = nb[j];
          if (nd !== 2 && nd !== 3 && nd !== 255 && ids[j] === 0 && depth[j] >= d && z - 1 / depth[j] < 1.2) c = shade(c, 1.28);
        }
        if (z > fogS) {
          // ordered-dithered fog in 4 steps
          const f = clamp((z - fogS) * invF, 0, 1);
          const q = Math.min(4, Math.floor(f * 4 + bay));
          if (q > 0) c = mix(c, fogC, q / 4);
        }
        if (outline === 2) c = shade(c, 0.22);
        else if (outline === 1) c = shade(c, 0.38);
        if (anyGlow) {
          // bilinear sample of the glow buffer, added with a little ordered dither
          const gx = Math.min(GW - 1.001, Math.max(0, x / 4 - 0.375)), gy = Math.min(GH - 1.001, Math.max(0, y / 4 - 0.375));
          const x0 = gx | 0, y0 = gy | 0, fx = gx - x0, fy = gy - y0;
          const k00 = (y0 * GW + x0) * 3, k10 = k00 + 3, k01 = k00 + GW * 3, k11 = k01 + 3;
          const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
          const s2 = gs * (0.85 + bay * 0.3);
          const ar = (g[k00] * w00 + g[k10] * w10 + g[k01] * w01 + g[k11] * w11) * s2;
          const ag = (g[k00 + 1] * w00 + g[k10 + 1] * w10 + g[k01 + 1] * w01 + g[k11 + 1] * w11) * s2;
          const ab = (g[k00 + 2] * w00 + g[k10 + 2] * w10 + g[k01 + 2] * w01 + g[k11 + 2] * w11) * s2;
          if (ar + ag + ab > 6) c = rgb((c & 255) + ar, ((c >>> 8) & 255) + ag, ((c >>> 16) & 255) + ab);
        }
        out[i] = c;
      }
    }
    col.set(out);
  }

  present() {
    this.ctx.putImageData(this.img, 0, 0);
  }

  // ---------------- 2D HUD helpers (drawn into the framebuffer) ----------------
  rect(x: number, y: number, w: number, h: number, c: number, alpha = 1) {
    x = Math.round(x); y = Math.round(y);
    for (let yy = Math.max(0, y); yy < Math.min(H, y + h); yy++) {
      for (let xx = Math.max(0, x); xx < Math.min(W, x + w); xx++) {
        const i = yy * W + xx;
        this.color[i] = alpha >= 1 ? c : mix(this.color[i], c, alpha);
      }
    }
  }
  fade(c: number, a: number) {
    if (a <= 0) return;
    for (let i = 0; i < this.color.length; i++) this.color[i] = mix(this.color[i], c, a);
  }
  /** bitmap from strings: '.' transparent, other chars mapped via palette */
  sprite(x: number, y: number, rows: string[], pal: Record<string, number>, scale = 1) {
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        const ch = rows[r][c];
        if (ch === '.' || ch === ' ') continue;
        const col = pal[ch];
        if (col === undefined) continue;
        this.rect(x + c * scale, y + r * scale, scale, scale, col);
      }
    }
  }
  textWidth(s: string, scale = 1) {
    return s.length * 4 * scale - scale;
  }
  text(s: string, x: number, y: number, c: number, scale = 1, shadowCol: number | null = 0xff000000) {
    s = s.toUpperCase();
    if (shadowCol !== null) this.textRaw(s, x + scale, y + scale, shadowCol, scale);
    this.textRaw(s, x, y, c, scale);
  }
  textCentered(s: string, y: number, c: number, scale = 1, shadowCol: number | null = 0xff000000) {
    this.text(s, Math.round(W / 2 - this.textWidth(s.toUpperCase(), scale) / 2), y, c, scale, shadowCol);
  }
  private textRaw(s: string, x: number, y: number, c: number, scale: number) {
    x = Math.round(x); y = Math.round(y);
    for (let i = 0; i < s.length; i++) {
      const g = FONT[s[i]];
      if (g) {
        for (let r = 0; r < 5; r++) {
          for (let k = 0; k < 3; k++) {
            if (g[r][k] === '#') this.rect(x + k * scale, y + r * scale, scale, scale, c);
          }
        }
      }
      x += 4 * scale;
    }
  }
}
