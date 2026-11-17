// Camera rig that morphs continuously between an (almost) orthographic
// isometric view and a perspective third-person view. Instead of cutting,
// it interpolates pitch/yaw and does a "dolly zoom": the field of view is
// widened while the camera moves in so the subject keeps a similar size.
import { clamp, lerp, easeInOutCubic, wrapAngle, angleLerp } from './math';
import { VoxelWorld } from './voxels';

export class CameraRig {
  mode: 0 | 1 = 0; // 0 = isometric, 1 = third person
  t = 0; // animated blend 0..1
  yaw = Math.PI / 4;
  yawTarget = Math.PI / 4;
  tx = 0; ty = 0; tz = 0; // smoothed look target
  shake = 0;
  isoYaw = Math.PI / 4; // the gameplay (isometric) heading
  cine = 0; // remaining time of a cinematic third-person shot
  focus: [number, number, number] | null = null; // look at this instead of the player
  private collDist = 1e9;

  // tunables
  isoPitch = 0.55; // ~31.5 deg
  isoHalfH = 9.5; // world units visible above/below target
  isoFov = 0.9 * (Math.PI / 180);
  tpsPitch = 0.16;
  tpsDist = 6.5;
  curDist = 6.5;
  tpsFov = 62 * (Math.PI / 180);

  // outputs
  px = 0; py = 0; pz = 0; pitch = 0; fov = 1; dist = 1; s = 0;

  toggle() {
    this.mode = this.mode === 0 ? 1 : 0;
    this.curDist = this.tpsDist;
    this.tpsPitch = 0.3;
    if (this.mode === 0) this.yawTarget = this.isoYaw = this.snapIso(this.isoYaw);
  }
  /** Swoop into a third-person shot looking along `yaw` for `hold` seconds. */
  startCinematic(yaw: number, hold: number, focus: [number, number, number] | null = null, dist = 6.5, pitch = 0.16) {
    this.cine = hold;
    this.curDist = dist;
    this.tpsPitch = pitch;
    this.mode = 1;
    this.yawTarget = yaw;
    this.focus = focus;
  }
  endCinematic() {
    if (this.cine > 0) this.cine = 1e-4;
  }
  snapIso(y: number) {
    return Math.round((y - Math.PI / 4) / (Math.PI / 2)) * (Math.PI / 2) + Math.PI / 4;
  }
  rotate(dir: number, dt: number) {
    // continuous in third person; quarter-turns in iso are handled by rotateStep
    this.yawTarget += dir * dt * 2.2;
    this.yaw = this.yawTarget - wrapAngle(this.yawTarget - this.yaw);
  }
  rotateStep(dir: number) {
    this.isoYaw = this.snapIso(this.isoYaw) + dir * (Math.PI / 2);
    if (this.cine <= 0) this.yawTarget = this.isoYaw;
  }

  snapTo(x: number, y: number, z: number) {
    this.tx = x; this.ty = y; this.tz = z;
  }

  update(dt: number, fx: number, fy: number, fz: number, world: VoxelWorld | null, followYaw: number | null) {
    if (this.cine > 0) {
      this.cine -= dt;
      if (this.cine <= 0) { this.mode = 0; this.yawTarget = this.isoYaw; this.focus = null; }
    }
    const target = this.mode;
    const speed = target ? 1 / 0.5 : 1 / 0.8;
    this.t = clamp(this.t + (target ? 1 : -1) * speed * dt, 0, 1);
    if (this.focus) { fx = this.focus[0]; fy = this.focus[1]; fz = this.focus[2]; }
    const s = easeInOutCubic(this.t);
    this.s = s;

    if (followYaw !== null && this.mode === 1) {
      // lazy follow behind the player in third person
      this.yawTarget = angleLerp(this.yawTarget, followYaw, clamp(dt * 1.3, 0, 1));
    }
    this.yaw = angleLerp(this.yaw, this.yawTarget, clamp(dt * (this.cine > 0 ? 5 : 8), 0, 1));
    if (Math.abs(wrapAngle(this.yawTarget - this.yaw)) < 1e-4) this.yaw = this.yawTarget;

    // smooth target; third person looks a bit higher (over the shoulder)
    const k = clamp(dt * 7, 0, 1);
    this.tx = lerp(this.tx, fx, k);
    this.ty = lerp(this.ty, fy + lerp(0.6, 1.9, s), clamp(dt * 5, 0, 1));
    this.tz = lerp(this.tz, fz, k);

    this.pitch = lerp(this.isoPitch, this.tpsPitch, s);
    // visible half-height at the target and tan(fov/2), interpolated in log space
    const tpsHalf = this.curDist * Math.tan(this.tpsFov / 2);
    const half = Math.exp(lerp(Math.log(this.isoHalfH), Math.log(tpsHalf), s));
    const tanHalf = Math.exp(lerp(Math.log(Math.tan(this.isoFov / 2)), Math.log(Math.tan(this.tpsFov / 2)), s));
    this.fov = 2 * Math.atan(tanHalf);
    let dist = half / tanHalf;

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const fxv = Math.sin(this.yaw) * cp, fyv = -sp, fzv = Math.cos(this.yaw) * cp;

    // camera collision, blended in only near third person so nothing pops
    if (world) {
      const w = clamp((s - 0.55) / 0.4, 0, 1);
      if (w > 0) {
        let hit = dist;
        for (let d = 0.6; d < Math.min(dist, 30); d += 0.25) {
          const x = this.tx - fxv * d, y = this.ty - fyv * d, z = this.tz - fzv * d;
          if (world.inside(Math.floor(x), Math.floor(y), Math.floor(z)) && world.solidAt(Math.floor(x), Math.floor(y), Math.floor(z))) {
            hit = Math.max(1.2, d - 0.4);
            break;
          }
        }
        // move in fast, out slowly
        this.collDist = hit < this.collDist ? lerp(this.collDist, hit, clamp(dt * 20, 0, 1)) : lerp(this.collDist, hit, clamp(dt * 3, 0, 1));
        dist = lerp(dist, Math.min(dist, this.collDist), w);
      } else {
        this.collDist = 1e9;
      }
    }
    this.dist = dist;

    let sx = 0, sy = 0;
    if (this.shake > 0) {
      const a = this.shake * 0.25;
      sx = (Math.random() - 0.5) * a;
      sy = (Math.random() - 0.5) * a;
      this.shake = Math.max(0, this.shake - dt * 3);
    }
    // pixel-snap the look target in the isometric view so the world scrolls in
    // whole pixels (no texture shimmer), like a 16-bit console background
    let tx = this.tx, ty = this.ty, tz = this.tz;
    if (s < 0.01) {
      const wpp = (2 * half) / 216;
      const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
      const ux = fyv * rz, uy = fzv * rx - fxv * rz, uz = -fyv * rx;
      const ul = Math.hypot(ux, uy, uz);
      const tr = tx * rx + tz * rz, tu = (tx * ux + ty * uy + tz * uz) / ul;
      const dr = Math.round(tr / wpp) * wpp - tr, du = Math.round(tu / wpp) * wpp - tu;
      tx += rx * dr + (ux / ul) * du; ty += (uy / ul) * du; tz += rz * dr + (uz / ul) * du;
    }
    this.px = tx - fxv * dist + Math.cos(this.yaw) * sx;
    this.py = ty - fyv * dist + sy;
    this.pz = tz - fzv * dist - Math.sin(this.yaw) * sx;
  }
}
