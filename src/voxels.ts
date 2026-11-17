// Voxel world grid, materials, chunk meshing with baked lighting, and model builders.
import { FaceSet } from './renderer';
import { hex, shade, hash3, clamp, mix } from './math';

export interface Material {
  name: string;
  color: number;
  vary: number;
  solid: boolean;
  emissive?: boolean;
  liquid?: boolean;
  breakable?: boolean;
  hazard?: boolean;
  side?: number; // alternative color for side faces (e.g. grass)
}

export const MATS: Material[] = [];
function def(name: string, color: string, vary: number, opts: Partial<Material> = {}): number {
  MATS.push({ name, color: hex(color), vary, solid: true, ...opts });
  return MATS.length - 1;
}

export const M = {
  AIR: def('air', '#000000', 0, { solid: false }),
  GRASS: def('grass', '#5d9440', 0.12, { side: hex('#6e4d30') }),
  DIRT: def('dirt', '#6e4d30', 0.12),
  STONE: def('stone', '#7c7c84', 0.1),
  ROCK: def('rock', '#5c5c66', 0.14),
  ASPHALT: def('asphalt', '#3c3c44', 0.08),
  LINE: def('line', '#d8c040', 0.05),
  SIDEWALK: def('sidewalk', '#8e8e8c', 0.06),
  PUDDLE: def('puddle', '#5a7090', 0.05),
  BRICK: def('brick', '#8c3e2e', 0.14),
  BRICK2: def('brick2', '#6a5040', 0.14),
  BRICK3: def('brick3', '#5a6470', 0.1),
  WINDOW: def('window', '#26303e', 0.05),
  WINDOW_LIT: def('window_lit', '#ffd27a', 0.1, { emissive: true }),
  ROOF: def('roof', '#46464e', 0.06),
  WOOD: def('wood', '#7a5430', 0.1),
  BARK: def('bark', '#4c3422', 0.12),
  PINE: def('pine', '#2f6038', 0.12),
  PINE2: def('pine2', '#245030', 0.12),
  LEAVES: def('leaves', '#4f7a36', 0.15),
  WATER: def('water', '#3a6e94', 0.05, { solid: false, liquid: true }),
  SAND: def('sand', '#c8b080', 0.08),
  MUSH: def('mush', '#c83a2a', 0.05),
  MUSH_W: def('mush_w', '#ece2d0', 0.05),
  NEON_PINK: def('neon_pink', '#ff3aa8', 0.04, { emissive: true }),
  NEON_CYAN: def('neon_cyan', '#3af0ff', 0.04, { emissive: true }),
  NEON_YELLOW: def('neon_yellow', '#ffe23a', 0.04, { emissive: true }),
  NEON_PURPLE: def('neon_purple', '#b45aff', 0.04, { emissive: true }),
  PALM: def('palm', '#8a6a40', 0.1),
  PALM_LEAF: def('palm_leaf', '#3a8a4a', 0.12),
  AMP: def('amp', '#1c1c20', 0.04, { breakable: true }),
  AMP_GRILLE: def('amp_grille', '#45403c', 0.1, { breakable: true }),
  AMP_LOGO: def('amp_logo', '#e0b84a', 0.03, { breakable: true, emissive: true }),
  METAL: def('metal', '#8a8f98', 0.06),
  LAVA: def('lava', '#ff6a10', 0.15, { emissive: true, hazard: true }),
  OBSIDIAN: def('obsidian', '#2c1c30', 0.1),
  STAGE: def('stage', '#3c2a1e', 0.08),
  CONCRETE: def('concrete', '#9a9a96', 0.07),
  FENCE: def('fence', '#a0a4aa', 0.05),
  VAN_W: def('van_w', '#e8e4d8', 0.02),
  VAN_B: def('van_b', '#3a6ab0', 0.02),
  TIRE: def('tire', '#1a1a1a', 0.02),
  GLASS: def('glass', '#9ac0d8', 0.04),
  DUMPSTER: def('dumpster', '#2f6a3a', 0.06),
  LAMP: def('lamp', '#fff0b0', 0.02, { emissive: true }),
  RED: def('red', '#c02a2a', 0.05),
  WHITE: def('white', '#e8e8e8', 0.03),
  HILL: def('hill', '#4a3a3a', 0.1),
  DRYGRASS: def('drygrass', '#9a8a4a', 0.12, { side: hex('#7a5a3a') }),
  MOSS: def('moss', '#4c6e32', 0.14, { side: hex('#5c5c66') }),
  AMPD: def('amp_deco', '#1c1c20', 0.04),
  GRILLED: def('grille_deco', '#45403c', 0.1),
  CHAIN: def('chain', '#6a6a70', 0.1),
};

export interface Lighting {
  sun: [number, number, number];
  sunInt: number;
  ambient: number;
  sunColor: number;
}

const CS = 16; // chunk size in x/z

export class Chunk {
  faces: FaceSet = { n: 0, pos: new Float32Array(0), dir: new Uint8Array(0), col: new Uint32Array(0) };
  dirty = true;
  constructor(public cx: number, public cz: number) {}
}

export class VoxelWorld {
  data: Uint8Array;
  chunks: Chunk[] = [];
  nx: number;
  nz: number;
  constructor(public X: number, public Y: number, public Z: number) {
    this.data = new Uint8Array(X * Y * Z);
    this.nx = Math.ceil(X / CS);
    this.nz = Math.ceil(Z / CS);
    for (let cz = 0; cz < this.nz; cz++) for (let cx = 0; cx < this.nx; cx++) this.chunks.push(new Chunk(cx, cz));
  }
  inside(x: number, y: number, z: number) {
    return x >= 0 && y >= 0 && z >= 0 && x < this.X && y < this.Y && z < this.Z;
  }
  get(x: number, y: number, z: number): number {
    if (!this.inside(x, y, z)) return 0;
    return this.data[(y * this.Z + z) * this.X + x];
  }
  set(x: number, y: number, z: number, m: number): this {
    if (this.inside(x, y, z)) this.data[(y * this.Z + z) * this.X + x] = m;
    return this;
  }
  /** set + mark chunk(s) dirty (for runtime edits) */
  edit(x: number, y: number, z: number, m: number) {
    this.set(x, y, z, m);
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const cx = Math.floor((x + dx) / CS), cz = Math.floor((z + dz) / CS);
      if (cx >= 0 && cz >= 0 && cx < this.nx && cz < this.nz) this.chunks[cz * this.nx + cx].dirty = true;
    }
  }
  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: number | ((x: number, y: number, z: number) => number)) {
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) {
          const v = typeof m === 'number' ? m : m(x, y, z);
          if (v >= 0) this.set(x, y, z, v);
        }
  }
  /** For collision: outside x/z = solid wall, below 0 = open (falls), above = air */
  solidAt(x: number, y: number, z: number): boolean {
    if (x < 0 || z < 0 || x >= this.X || z >= this.Z) return true;
    if (y < 0 || y >= this.Y) return false;
    return MATS[this.data[(y * this.Z + z) * this.X + x]].solid;
  }
  matAt(x: number, y: number, z: number) {
    return MATS[this.get(Math.floor(x), Math.floor(y), Math.floor(z))];
  }
  /** top surface height (y of first air above highest solid) at column, or 0 */
  heightAt(x: number, z: number): number {
    x = Math.floor(x); z = Math.floor(z);
    for (let y = this.Y - 1; y >= 0; y--) if (MATS[this.get(x, y, z)].solid) return y + 1;
    return 0;
  }
  /** first solid surface at or below y */
  groundBelow(x: number, y: number, z: number): number {
    x = Math.floor(x); z = Math.floor(z);
    for (let yy = Math.min(this.Y - 1, Math.floor(y)); yy >= 0; yy--) if (MATS[this.get(x, yy, z)].solid) return yy + 1;
    return -100;
  }

  rebuild(light: Lighting, all = false) {
    for (const c of this.chunks) if (c.dirty || all) this.meshChunk(c, light);
  }

  private occludes(x: number, y: number, z: number, self: Material): boolean {
    if (y < 0) return true;
    if (!this.inside(x, y, z)) return false;
    const m = MATS[this.data[(y * this.Z + z) * this.X + x]];
    if (m === MATS[0]) return false;
    if (m.liquid && !self.liquid) return false;
    return true;
  }

  private shadowed(x: number, y: number, z: number, light: Lighting): boolean {
    const [sx, sy, sz] = light.sun;
    for (let i = 1; i < 40; i++) {
      const t = i * 0.6;
      const px = Math.floor(x + sx * t), py = Math.floor(y + sy * t), pz = Math.floor(z + sz * t);
      if (py >= this.Y) return false;
      if (!this.inside(px, py, pz)) return false;
      const m = MATS[this.data[(py * this.Z + pz) * this.X + px]];
      if (m.solid && !m.emissive) return true;
    }
    return false;
  }

  private meshChunk(c: Chunk, light: Lighting) {
    const pos: number[] = [], dir: number[] = [], col: number[] = [];
    const x0 = c.cx * CS, z0 = c.cz * CS;
    const x1 = Math.min(this.X, x0 + CS), z1 = Math.min(this.Z, z0 + CS);
    const N = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const [lx, ly, lz] = light.sun;
    for (let y = 0; y < this.Y; y++) {
      for (let z = z0; z < z1; z++) {
        for (let x = x0; x < x1; x++) {
          const id = this.data[(y * this.Z + z) * this.X + x];
          if (id === 0) continue;
          const mat = MATS[id];
          const vr = 1 + (hash3(x, y, z, 11) - 0.5) * 2 * mat.vary;
          for (let d = 0; d < 6; d++) {
            const n = N[d];
            if (this.occludes(x + n[0], y + n[1], z + n[2], mat)) continue;
            let base = mat.color;
            if (mat.side !== undefined && d !== 2) {
              // grass-like: side faces are dirt except a fringe row under the top
              base = this.get(x, y + 1, z) === 0 && hash3(x, y, z + d, 5) < 0.6 ? mix(mat.side, mat.color, 0.55) : mat.side;
            }
            let c2: number;
            if (mat.emissive) {
              c2 = shade(base, vr * 1.05);
            } else {
              const ndl = Math.max(0, n[0] * lx + n[1] * ly + n[2] * lz);
              let sunlit = ndl;
              if (ndl > 0 && this.shadowed(x + 0.5 + n[0] * 0.55, y + 0.5 + n[1] * 0.55, z + 0.5 + n[2] * 0.55, light)) sunlit = 0;
              // face-level ambient occlusion: count solid cells around the face
              let occ = 0;
              const fx = x + n[0], fy = y + n[1], fz = z + n[2];
              for (let a = -1; a <= 1; a++)
                for (let b = -1; b <= 1; b++) {
                  if (a === 0 && b === 0) continue;
                  let ox = fx, oy = fy, oz = fz;
                  if (n[0] !== 0) { oy += a; oz += b; } else if (n[1] !== 0) { ox += a; oz += b; } else { ox += a; oy += b; }
                  if (this.solidAt(ox, oy, oz) && this.inside(ox, oy, oz)) occ++;
                }
              const ao = 1 - occ * 0.045;
              const sideDim = d === 3 ? 0.55 : d === 2 ? 1 : 0.86 - (d >= 4 ? 0.06 : 0);
              const low = 0.8 + 0.2 * clamp(y / 10, 0, 1);
              const lum = (light.ambient * sideDim + light.sunInt * sunlit) * ao * low * vr;
              c2 = mix(shade(base, lum), shade(light.sunColor, lum), 0.12 * sunlit);
            }
            pos.push(x, y, z);
            dir.push(d);
            col.push(c2);
          }
        }
      }
    }
    c.faces = { n: dir.length, pos: new Float32Array(pos), dir: new Uint8Array(dir), col: new Uint32Array(col) };
    c.dirty = false;
  }
}

// ---------------------------------------------------------------------------
// Voxel models (characters, props) built from small parts.

export interface ModelPart {
  name: string;
  faces: FaceSet;
}
export interface VoxelModel {
  parts: ModelPart[];
  scale: number;
  index: Record<string, number>;
}

export class PartBuilder {
  vox = new Map<number, number>();
  private key(x: number, y: number, z: number) {
    return ((x + 128) << 16) | ((y + 128) << 8) | (z + 128);
  }
  set(x: number, y: number, z: number, c: number | null) {
    if (c === null) this.vox.delete(this.key(x, y, z));
    else this.vox.set(this.key(x, y, z), c);
    return this;
  }
  has(x: number, y: number, z: number) {
    return this.vox.has(this.key(x, y, z));
  }
  /** inclusive box; color may be a function returning a color or null (skip) */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number | ((x: number, y: number, z: number) => number | null)) {
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) {
          const v = typeof c === 'number' ? c : c(x, y, z);
          if (v !== null) this.set(x, y, z, v);
        }
    return this;
  }
  build(): FaceSet {
    const pos: number[] = [], dir: number[] = [], col: number[] = [];
    const N = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    for (const [k, c] of this.vox) {
      const x = ((k >> 16) & 255) - 128, y = ((k >> 8) & 255) - 128, z = (k & 255) - 128;
      for (let d = 0; d < 6; d++) {
        const n = N[d];
        if (this.has(x + n[0], y + n[1], z + n[2])) continue;
        pos.push(x, y, z);
        dir.push(d);
        col.push(c);
      }
    }
    return { n: dir.length, pos: new Float32Array(pos), dir: new Uint8Array(dir), col: new Uint32Array(col) };
  }
}

export function makeModel(scale: number, parts: [string, PartBuilder][]): VoxelModel {
  const index: Record<string, number> = {};
  const ps = parts.map(([name, b], i) => {
    index[name] = i;
    return { name, faces: b.build() };
  });
  return { parts: ps, scale, index };
}
