// Actors with voxel-grid physics, plus a helper to draw animated voxel models.
import { VoxelWorld, VoxelModel, Lighting, MATS } from './voxels';
import { Renderer, FLAG_FLASH } from './renderer';
import { Mat, mChain, mTrans, mRotY, mScale, mMul, mIdent } from './math';
import { AnimState, ItemKind } from './models';

export function collides(w: VoxelWorld, x: number, y: number, z: number, r: number, h: number): boolean {
  const x0 = Math.floor(x - r), x1 = Math.floor(x + r - 1e-4);
  const y0 = Math.floor(y + 1e-4), y1 = Math.floor(y + h - 1e-4);
  const z0 = Math.floor(z - r), z1 = Math.floor(z + r - 1e-4);
  for (let yy = y0; yy <= y1; yy++)
    for (let zz = z0; zz <= z1; zz++)
      for (let xx = x0; xx <= x1; xx++) if (w.solidAt(xx, yy, zz)) return true;
  return false;
}

let nextId = 1;

export class Actor {
  x = 0; y = 0; z = 0;
  vx = 0; vy = 0; vz = 0;
  yaw = 0;
  r = 0.38;
  h = 2.9;
  onGround = false;
  inLiquid = false;
  onHazard = false;
  hp = 3;
  maxHp = 3;
  flashT = 0;
  hurtT = 0;
  dead = false;
  scale = 1;
  stepOffset = 0; // visual smoothing of auto-steps
  canStep = true;
  gravity = 38;
  hitWall = false;
  id: number;
  anim: AnimState;

  constructor(public model: VoxelModel, item: ItemKind) {
    this.id = (nextId++ % 200) + 1;
    this.anim = { t: Math.random() * 10, walk: 0, walkAmt: 0, air: false, act: -1, actKind: 'none', hurt: 0, item };
  }

  physics(w: VoxelWorld, dt: number, useGravity = true) {
    this.inLiquid = MATS[w.get(Math.floor(this.x), Math.floor(this.y + 0.3), Math.floor(this.z))].liquid === true;
    if (useGravity) this.vy -= this.gravity * (this.inLiquid ? 0.4 : 1) * dt;
    if (this.inLiquid) this.vy = Math.max(this.vy, -6);
    this.vy = Math.max(this.vy, -40);
    this.hitWall = false;
    // horizontal axes with auto-step
    for (const axis of [0, 2]) {
      let amt = (axis === 0 ? this.vx : this.vz) * dt;
      const steps = Math.ceil(Math.abs(amt) / 0.2);
      const inc = steps ? amt / steps : 0;
      for (let i = 0; i < steps; i++) {
        const nx = axis === 0 ? this.x + inc : this.x;
        const nz = axis === 2 ? this.z + inc : this.z;
        if (!collides(w, nx, this.y, nz, this.r, this.h)) {
          this.x = nx; this.z = nz;
          continue;
        }
        const stepY = Math.floor(this.y + 1e-3) + 1;
        if (this.canStep && this.onGround && stepY - this.y <= 1.05 && !collides(w, nx, stepY, nz, this.r, this.h)) {
          this.stepOffset -= stepY - this.y;
          this.y = stepY;
          this.x = nx; this.z = nz;
          continue;
        }
        if (axis === 0) this.vx = 0; else this.vz = 0;
        this.hitWall = true;
        break;
      }
    }
    // vertical
    const dy = this.vy * dt;
    const steps = Math.max(1, Math.ceil(Math.abs(dy) / 0.45));
    const inc = dy / steps;
    this.onGround = false;
    for (let i = 0; i < steps; i++) {
      const ny = this.y + inc;
      if (!collides(w, this.x, ny, this.z, this.r, this.h)) {
        this.y = ny;
        continue;
      }
      if (inc < 0) {
        this.y = Math.floor(ny) + 1;
        this.onGround = true;
      } else {
        this.y = Math.floor(ny + this.h) - this.h - 1e-3;
      }
      this.vy = 0;
      break;
    }
    // ground probe (so standing still counts as grounded)
    if (!this.onGround && this.vy <= 0 && collides(w, this.x, this.y - 0.05, this.z, this.r, 0.1)) this.onGround = true;
    this.onHazard = false;
    if (this.onGround) {
      const m = MATS[w.get(Math.floor(this.x), Math.floor(this.y - 0.5), Math.floor(this.z))];
      if (m.hazard) this.onHazard = true;
    }
    this.stepOffset *= Math.pow(0.0005, dt);
    if (this.flashT > 0) this.flashT -= dt;
    if (this.hurtT > 0) this.hurtT -= dt;
  }

  dist2(o: { x: number; z: number }) {
    return (o.x - this.x) ** 2 + (o.z - this.z) ** 2;
  }
}

// ----------------------------------------------------------------------------

export interface DrawOpts {
  flags?: number;
  flash?: boolean;
  flashColor?: number;
  id?: number;
}

const tmpShade = new Float32Array(6);

export function drawModel(
  r: Renderer, light: Lighting, model: VoxelModel, partMats: Mat[] | null,
  x: number, y: number, z: number, yaw: number, scale: number, o: DrawOpts = {},
  tilt: Mat | null = null,
) {
  const s = model.scale * scale;
  let E = mChain(mTrans(x, y, z), mRotY(yaw), mScale(s));
  if (tilt) E = mMul(E, tilt);
  const ident = mIdent();
  const [lx, ly, lz] = light.sun;
  for (let i = 0; i < model.parts.length; i++) {
    const part = model.parts[i];
    if (part.faces.n === 0) continue;
    const P = partMats ? partMats[i] ?? ident : ident;
    const Wm = mMul(E, P);
    const V = mMul(r.view, Wm);
    for (let d = 0; d < 6; d++) {
      const j = d >> 1, sg = d & 1 ? -1 : 1;
      const nx = (Wm[j] * sg) / s, ny = (Wm[4 + j] * sg) / s, nz = (Wm[8 + j] * sg) / s;
      const ndl = Math.max(0, nx * lx + ny * ly + nz * lz);
      tmpShade[d] = light.ambient * (0.78 + 0.22 * ny) + light.sunInt * ndl + 0.12;
    }
    let flags = o.flags ?? 0;
    if (o.flash) flags |= FLAG_FLASH;
    r.drawFaces(part.faces, V, tmpShade, flags, o.id ?? 1, o.flashColor ?? 0xffffffff);
  }
}
