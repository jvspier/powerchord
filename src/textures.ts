// Procedural 16-bit style pixel textures. Each texel stores a shade *level*
// (0..7) rather than a colour, so one texture can dress many materials: at
// draw time each face builds an 8-colour ramp from its lit base colour.
// Textures are mapped in world space (TPU texels per voxel) so patterns run
// continuously across neighbouring voxels instead of repeating per cube.
import { hash2 } from './math';
import { MATS } from './voxels';

export const TPU = 6; // texels per world unit
export const LEVELS = [0.5, 0.62, 0.74, 0.87, 1.0, 1.1, 1.2, 1.34];

export interface Texture { w: number; h: number; d: Uint8Array; }

function make(w: number, h: number, f: (x: number, y: number) => number): Texture {
  const d = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = Math.max(0, Math.min(7, Math.round(f(x, y))));
  return { w, h, d };
}
const n = (x: number, y: number, s: number) => hash2(x, y, s);

const T: Record<string, Texture> = {
  plain: make(6, 6, (x, y) => (n(x, y, 1) < 0.08 ? 3 : 4)),
  brick: make(12, 6, (x, y) => {
    const r = y % 3, course = Math.floor(y / 3), off = course % 2 ? 3 : 0;
    if (r === 0 || (x + off) % 6 === 0) return 1;
    if (n(x, y, 2) < 0.07) return 3;
    return r === 1 ? 5 : 4;
  }),
  asphalt: make(12, 12, (x, y) => { const h = n(x, y, 3); return h < 0.12 ? 3 : h > 0.94 ? 5 : 4; }),
  slab: make(12, 12, (x, y) => (x === 0 || y === 0 ? 2 : x === 1 || y === 1 ? 5 : n(x, y, 4) < 0.06 ? 3 : 4)),
  tile: make(12, 12, (x, y) => {
    if (x === 0 || y === 0) return 6;
    if (x === 11 || y === 11) return 2;
    if ((x === 3 && y === 3) || (x === 4 && y === 3) || (x === 3 && y === 4)) return 7;
    return 4;
  }),
  carpet: make(6, 6, (x, y) => (x === 3 && y === 3 ? 6 : (x + y) % 3 === 0 ? 3 : (x * 7 + y * 3) % 5 === 0 ? 5 : 4)),
  wood: make(12, 6, (x, y) => {
    const r = y % 3, row = Math.floor(y / 3);
    if (r === 0 || (x + row * 5) % 12 === 0) return 2;
    const g = n(x >> 1, y, 5);
    return g < 0.25 ? 3 : g > 0.85 ? 5 : 4;
  }),
  tapes: make(6, 6, (x, y) => (y === 5 ? 1 : x % 2 === 1 && y > 0 ? 2 : y === 2 || y === 3 ? 6 : 4)),
  window: make(6, 6, (x, y) => (x === 0 || y === 0 || x === 5 || y === 5 ? 2 : x === y || x === y + 1 ? 7 : x + y < 4 ? 5 : 4)),
  glass: make(6, 6, (x, y) => ((x + y) % 6 === 2 || (x + y) % 6 === 3 ? 7 : 5)),
  metal: make(6, 6, (x, y) => ((x === 0 || x === 5) && (y === 0 || y === 5) ? 6 : y % 2 ? 4 : 5)),
  grille: make(6, 6, (x, y) => ((x + y) % 2 ? 3 : 5)),
  roof: make(12, 12, (x, y) => { const h = n(x, y, 6); return h < 0.2 ? 3 : h > 0.85 ? 5 : 4; }),
  neon: make(6, 6, (x, y) => (x === 0 || y === 0 || x === 5 || y === 5 ? 5 : 7)),
  crt: make(6, 6, (x, y) => (x === 0 || y === 0 || x === 5 || y === 5 ? 1 : y % 2 ? 5 : 7)),
  tvstatic: make(6, 6, (x, y) => (x === 0 || y === 0 ? 1 : 3 + Math.floor(n(x, y, 7) * 5))),
  seat: make(6, 6, (x, y) => (y === 3 ? 2 : y < 3 ? (x === 0 || x === 5 ? 3 : 5) : 4)),
  water: make(12, 12, (x, y) => (y % 4 === 0 && (x + y * 2) % 8 < 3 ? 6 : n(x, y, 8) < 0.05 ? 7 : 4)),
  fence: make(6, 6, (x, y) => ((x + y) % 3 === 0 || (x - y + 6) % 3 === 0 ? 6 : 2)),
  wallpaper: make(12, 12, (x, y) => (x % 6 === 0 ? 3 : (x % 6 === 3 && y % 6 === 2) || (x % 6 === 2 && y % 6 === 3) || (x % 6 === 4 && y % 6 === 3) ? 6 : 4)),
  stripe: make(6, 6, (_x, y) => (y === 0 ? 5 : y === 5 ? 2 : 4)),
  panel: make(12, 12, (x, y) => (x === 0 || y === 0 ? 2 : x === 1 || y === 1 ? 5 : 4)),
  van: make(6, 6, (_x, y) => (y === 0 ? 5 : 4)),
  smooth: make(6, 6, () => 4),
  // arcade carpet: dark base with bright cosmic squiggles and stars
  cosmic: make(12, 12, (x, y) => {
    if ((x === 2 && y === 9) || (x === 8 && y === 3)) return 7;
    if ((x + y * 2) % 11 === 0 && y % 4 < 2) return 7;
    if ((x * 3 + y) % 13 === 0) return 6;
    return n(x, y, 13) < 0.1 ? 5 : 4;
  }),
  grass: make(6, 6, (x, y) => { const h = n(x, y, 14); return h < 0.2 ? 3 : h > 0.8 ? 6 : (x + y) % 3 === 0 ? 5 : 4; }),
  pool: make(12, 12, (x, y) => (x === 0 || y === 0 ? 3 : n(x, y, 15) < 0.04 ? 5 : 4)),
  cabinet: make(6, 6, (x, y) => (x === 0 || x === 5 ? 3 : y === 2 && x > 0 && x < 5 ? 6 : 4)),
  leaf: make(12, 12, (x, y) => {
    // clustered leaf blobs: bright tips, dark gaps
    const h = n(x >> 1, y >> 1, 11), k = n(x, y, 12);
    if (h < 0.22) return 2;
    return k < 0.25 ? 6 : k < 0.6 ? 5 : 3;
  }),
};

// material name -> [side texture, top texture]
const MAP: Record<string, [string, string]> = {
  stone: ['slab', 'slab'], asphalt: ['asphalt', 'asphalt'], sidewalk: ['slab', 'slab'], puddle: ['water', 'water'],
  brick: ['brick', 'roof'], brick2: ['brick', 'roof'], brick3: ['brick', 'roof'], window: ['window', 'window'],
  window_lit: ['window', 'window'], roof: ['roof', 'roof'], wood: ['wood', 'wood'], water: ['water', 'water'],
  neon_pink: ['neon', 'neon'], neon_cyan: ['neon', 'neon'], neon_yellow: ['neon', 'neon'], neon_purple: ['neon', 'neon'],
  palm: ['wood', 'wood'], amp: ['metal', 'metal'], amp_deco: ['panel', 'metal'], amp_grille: ['grille', 'metal'],
  grille_deco: ['grille', 'metal'], amp_logo: ['neon', 'neon'], metal: ['metal', 'metal'], lava: ['water', 'water'],
  obsidian: ['slab', 'slab'], stage: ['wood', 'wood'], concrete: ['slab', 'slab'], fence: ['fence', 'metal'],
  van_w: ['van', 'smooth'], van_b: ['van', 'smooth'], glass: ['glass', 'glass'], dumpster: ['metal', 'metal'],
  lamp: ['neon', 'neon'], red: ['van', 'smooth'], white: ['van', 'smooth'], chain: ['fence', 'metal'],
  carpet: ['carpet', 'carpet'], carpet2: ['carpet', 'carpet'], carpet3: ['carpet', 'carpet'], tile: ['tile', 'tile'],
  tile2: ['tile', 'tile'], woodfloor: ['wood', 'wood'], shelf: ['wood', 'wood'],
  tape_k: ['tapes', 'smooth'], tape_r: ['tapes', 'smooth'], tape_y: ['tapes', 'smooth'], tape_b: ['tapes', 'smooth'],
  tape_g: ['tapes', 'smooth'], tape_w: ['tapes', 'smooth'], plastic: ['van', 'smooth'], crt: ['crt', 'crt'],
  tv_case: ['metal', 'metal'], tv_screen: ['tvstatic', 'tvstatic'], wallpaper: ['wallpaper', 'slab'],
  wall_stripe: ['stripe', 'slab'], wall_dark: ['panel', 'panel'], seat: ['seat', 'smooth'], venue_floor: ['slab', 'slab'],
  arcade2: ['cabinet', 'metal'], arcade3: ['cabinet', 'metal'], acarpet: ['cosmic', 'cosmic'], acarpet2: ['cosmic', 'cosmic'],
  acarpet3: ['cosmic', 'cosmic'], skate: ['slab', 'slab'], pool: ['pool', 'pool'], coping: ['metal', 'metal'],
  graf_p: ['plain', 'plain'], graf_o: ['plain', 'plain'], graf_g: ['plain', 'plain'], grass: ['grass', 'grass'],
  pyro: ['neon', 'neon'], palm_leaf: ['leaf', 'leaf'], plant: ['leaf', 'leaf'], leaves: ['leaf', 'leaf'], pine: ['leaf', 'leaf'], pine2: ['leaf', 'leaf'], spot_w: ['neon', 'neon'], arcade: ['cabinet', 'metal'], line: ['asphalt', 'asphalt'],
};

/** Texture table indexed by id (0 = untextured). */
export const TEXTURES: Texture[] = [T.smooth];
const ids: Record<string, number> = {};
for (const k in T) { ids[k] = TEXTURES.length; TEXTURES.push(T[k]); }

let cache: [number, number][] | null = null;
/** per-material texture ids: [side, top] (computed lazily: MATS fills at module load) */
export function matTex(): [number, number][] {
  if (!cache) cache = MATS.map((m) => {
    const e = MAP[m.name] ?? ['plain', 'plain'];
    return [ids[e[0]], ids[e[1]]];
  });
  return cache;
}
