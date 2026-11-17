// World definitions and procedural voxel generation for each stage of the tour.
import { VoxelWorld, M, Lighting } from './voxels';
import { Noise2D, RNG, hex, hash2, clamp, smoothstep } from './math';

export type Ability = 'chord' | 'dive' | 'dash';
export type EnemyKind = 'poser' | 'drone' | 'roadie';
export type GateKind = 'none' | 'amp' | 'cliff' | 'chasm';

export interface WorldDef {
  name: string;
  subtitle: string;
  seed: number;
  skyTop: number;
  skyBot: number;
  fog: number;
  light: Lighting;
  stars: boolean;
  weather: 'rain' | 'pollen' | 'embers' | 'neon';
  gate: GateKind;
  boss: number;
  bossName: string;
  bossLines: string[];
  reward: Ability | null;
  rewardText: string;
  enemies: EnemyKind[];
  theme: 'city' | 'forest' | 'strip' | 'arena';
}

const norm = (x: number, y: number, z: number): [number, number, number] => {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
};

export const WORLDS: WorldDef[] = [
  {
    name: 'RAIN CITY', subtitle: 'SEATTLE, 1991', seed: 101, theme: 'city',
    skyTop: hex('#2e3a4c'), skyBot: hex('#8c98a6'), fog: hex('#7a8694'), stars: false, weather: 'rain',
    light: { sun: norm(-0.45, 0.8, -0.35), sunInt: 0.42, ambient: 0.66, sunColor: hex('#d8e0f0') },
    gate: 'none', boss: 0, bossName: 'THE A&R MAN', reward: 'chord',
    bossLines: ['SIGN HERE, KID. LOSE THE FLANNEL,', 'GET A PERM, AND WE CAN MAKE YOU A STAR.', 'RIKKI SPANDEX OWNS THIS TOWN NOW.'],
    rewardText: 'POWER CHORD! PRESS L TO UNLEASH A SHOCKWAVE. BREAKS AMP WALLS.',
    enemies: ['poser', 'poser', 'drone'],
  },
  {
    name: 'EVERGREEN WOODS', subtitle: 'THE LOGGING ROAD', seed: 202, theme: 'forest',
    skyTop: hex('#3a6670'), skyBot: hex('#b4d0bc'), fog: hex('#9cbaa8'), stars: false, weather: 'pollen',
    light: { sun: norm(0.5, 0.75, -0.3), sunInt: 0.55, ambient: 0.55, sunColor: hex('#fff0c0') },
    gate: 'amp', boss: 1, bossName: 'MULLET MOUNTAIN', reward: 'dive',
    bossLines: ['BUSINESS IN THE FRONT...', 'PARTY IN THE BACK!', 'NOBODY GETS PAST THE MOUNTAIN.'],
    rewardText: 'STAGE DIVE! PRESS JUMP IN MID-AIR TO DOUBLE JUMP.',
    enemies: ['poser', 'roadie', 'drone', 'poser'],
  },
  {
    name: 'SUNSET STRIP', subtitle: 'LOS ANGELES AFTER DARK', seed: 303, theme: 'strip',
    skyTop: hex('#140a30'), skyBot: hex('#ff5a7a'), fog: hex('#5a2458'), stars: true, weather: 'neon',
    light: { sun: norm(-0.6, 0.45, 0.4), sunInt: 0.4, ambient: 0.55, sunColor: hex('#ff9ac0') },
    gate: 'cliff', boss: 2, bossName: 'DJ SYNTHAX', reward: 'dash',
    bossLines: ['GUITARS ARE OVER, BABY.', 'THE FUTURE IS SYNTH-ETIC!', 'FEEL THE KEYTAR!'],
    rewardText: 'MOSH DASH! PRESS SHIFT TO DASH, EVEN IN MID-AIR.',
    enemies: ['poser', 'drone', 'drone', 'roadie'],
  },
  {
    name: 'ARENA OF EXCESS', subtitle: 'THE FINAL GIG', seed: 404, theme: 'arena',
    skyTop: hex('#160406'), skyBot: hex('#a0281a'), fog: hex('#4a1210'), stars: true, weather: 'embers',
    light: { sun: norm(0.3, 0.6, 0.5), sunInt: 0.45, ambient: 0.6, sunColor: hex('#ffb070') },
    gate: 'chasm', boss: 3, bossName: 'RIKKI SPANDEX', reward: null,
    bossLines: ['WELL WELL. THE FLANNEL FREAK.', "THE 80'S WILL NEVER DIE, BABY!", 'TIME TO FACE THE HAIR!'],
    rewardText: '',
    enemies: ['poser', 'roadie', 'drone', 'poser', 'roadie'],
  },
];

export interface Spawn { kind: EnemyKind; x: number; y: number; z: number; }
export interface Collectible { kind: 'tape' | 'pouch'; id: string; x: number; y: number; z: number; }
export interface GenResult {
  world: VoxelWorld;
  start: [number, number, number];
  spawns: Spawn[];
  collectibles: Collectible[];
  checkpoints: [number, number, number][];
  vans: [number, number, number][];
  arena: [number, number, number, number]; // x, y, z, radius
  gateX: number;
  pathZ: (x: number) => number;
}

export const WX = 176, WY = 44, WZ = 48;

export function generateWorld(index: number): GenResult {
  const def = WORLDS[index];
  const w = new VoxelWorld(WX, WY, WZ);
  const rng = new RNG(def.seed);
  const noise = new Noise2D(def.seed);
  const n2 = new Noise2D(def.seed + 7);
  const ph = def.seed * 0.37;
  const pathZ = (x: number) => WZ / 2 + Math.sin(x * 0.045 + ph) * 6 + Math.sin(x * 0.11 + ph * 2) * 2;
  const GX = 86; // gate position
  const ARX = 154, ARZ = WZ / 2, ARR = 13;
  const baseH = 8;
  const theme = def.theme;
  const cliffUp = def.gate === 'cliff' ? 6 : 0;

  // ---- heightmap ----
  const H = new Int16Array(WX * WZ);
  const hAt = (x: number, z: number) => H[z * WX + x];
  for (let z = 0; z < WZ; z++) {
    for (let x = 0; x < WX; x++) {
      const pz = pathZ(x);
      const dp = Math.abs(z - pz);
      let h = baseH;
      if (theme === 'forest') {
        const n = noise.fbm(x * 0.05, z * 0.05) * 14 - 5;
        h = baseH + Math.round(n * smoothstep(3, 9, dp)) + Math.round(Math.sin(x * 0.06) * 1.5);
      } else if (theme === 'strip') {
        const hills = Math.max(0, dp - 13) * 0.9 * (0.6 + noise.fbm(x * 0.06, z * 0.06));
        h = baseH + Math.round(hills);
      } else if (theme === 'arena') {
        const n = noise.fbm(x * 0.07, z * 0.07);
        h = baseH + Math.round((n - 0.5) * 6 * smoothstep(4, 10, dp));
      } else {
        h = baseH;
      }
      if (x >= GX && cliffUp) h += cliffUp;
      // flatten start pad and arena
      if (x < 20) h = baseH;
      const da = Math.hypot(x - ARX, z - ARZ);
      const arenaH = baseH + cliffUp;
      if (da < ARR + 3) h = arenaH;
      H[z * WX + x] = clamp(h, 2, WY - 16);
    }
  }

  // ---- base fill ----
  const surf = theme === 'forest' ? M.GRASS : theme === 'arena' ? M.OBSIDIAN : theme === 'strip' ? M.DRYGRASS : M.SIDEWALK;
  const sub = theme === 'forest' ? M.DIRT : theme === 'arena' ? M.ROCK : M.DIRT;
  for (let z = 0; z < WZ; z++)
    for (let x = 0; x < WX; x++) {
      const h = hAt(x, z);
      for (let y = 0; y < h; y++) w.set(x, y, z, y === h - 1 ? surf : y < h - 4 ? M.STONE : sub);
    }

  const top = (x: number, z: number) => w.heightAt(x, z);
  const setTop = (x: number, z: number, m: number) => w.set(x, hAt(x, z) - 1, z, m);

  // ---- paths / roads ----
  for (let x = 0; x < WX; x++) {
    const pz = pathZ(x);
    for (let z = 0; z < WZ; z++) {
      const dp = Math.abs(z - pz);
      if (theme === 'city' || theme === 'strip') {
        if (dp <= 3.5) setTop(x, z, Math.abs(z - Math.round(pz)) < 0.5 && x % 6 < 3 ? M.LINE : hash2(x, z, 4) < 0.05 && theme === 'city' ? M.PUDDLE : M.ASPHALT);
        else if (dp <= 6 && theme === 'city') setTop(x, z, M.SIDEWALK);
        else if (dp <= 5.5 && theme === 'strip') setTop(x, z, M.SIDEWALK);
      } else if (theme === 'forest') {
        if (dp <= 2) setTop(x, z, hash2(x, z, 2) < 0.2 ? M.SAND : M.DIRT);
      } else if (theme === 'arena') {
        if (dp <= 3) setTop(x, z, M.STONE);
        else if (dp <= 3.8) setTop(x, z, M.METAL);
      }
    }
  }

  const free = (x: number, z: number, r: number) => {
    // keep decorations away from the path, gate, arena, start, and secrets
    if (Math.abs(z - pathZ(x)) < r) return false;
    if (Math.abs(x - GX) < 12) return false;
    if (Math.hypot(x - ARX, z - ARZ) < ARR + 4) return false;
    if (x < 20) return false;
    return x > 1 && z > 1 && x < WX - 2 && z < WZ - 2;
  };

  // ---- theme decorations ----
  if (theme === 'city') {
    // buildings along both sides of the street
    for (const side of [-1, 1]) {
      let x = 20;
      while (x < WX - 2) {
        const bw = rng.int(6, 11);
        const bh = rng.int(5, 12);
        const mat = rng.pick([M.BRICK, M.BRICK2, M.BRICK3]);
        const lit = rng.next();
        for (let bx = x; bx < Math.min(WX, x + bw); bx++) {
          for (let z = 0; z < WZ; z++) {
            const dz = (z - pathZ(bx)) * side;
            if (dz <= 7 || !free(bx, z, 7)) continue;
            const h = hAt(bx, z);
            for (let y = h; y < h + bh; y++) {
              const ry = y - h;
              const win = ry % 3 === 1 && ((bx + z) % 3 === 1) && ry < bh - 1;
              w.set(bx, y, z, win ? (hash2(bx * 7 + y, z, 3) < lit * 0.6 ? M.WINDOW_LIT : M.WINDOW) : ry === bh - 1 ? M.ROOF : mat);
            }
            if (hash2(bx, z, 21) < 0.02) w.fill(bx, h + bh, z, bx, h + bh, z, M.METAL);
          }
        }
        x += bw + rng.int(1, 3);
      }
    }
    // street lamps, dumpsters, cars
    for (let x = 24; x < WX - 20; x += 11) {
      if (Math.abs(x - GX) < 10) continue;
      const side = (x / 11) % 2 < 1 ? 1 : -1;
      const z = Math.round(pathZ(x) + side * 5);
      const h = top(x, z);
      w.fill(x, h, z, x, h + 4, z, M.METAL);
      w.set(x, h + 5, z, M.LAMP);
      w.set(x, h + 4, z - side, M.METAL);
    }
    for (let i = 0; i < 9; i++) {
      const x = rng.int(26, WX - 26);
      if (Math.abs(x - GX) < 10) continue;
      const side = rng.chance(0.5) ? 1 : -1;
      const z = Math.round(pathZ(x) + side * 2.5);
      const h = top(x, z);
      const body = rng.pick([M.RED, M.VAN_B, M.WHITE, M.DUMPSTER]);
      w.fill(x, h, z - 1, x + 4, h, z, body);
      w.fill(x + 1, h + 1, z - 1, x + 3, h + 1, z, M.GLASS);
      w.set(x, h, z - 1, M.TIRE); w.set(x + 4, h, z - 1, M.TIRE); w.set(x, h, z, M.TIRE); w.set(x + 4, h, z, M.TIRE);
    }
    // coffee shop sign
    const sx = 40, sz = Math.round(pathZ(40) + 8);
    w.fill(sx, top(sx, sz - 1) + 3, sz - 1, sx + 4, top(sx, sz - 1) + 3, sz - 1, M.NEON_YELLOW);
  } else if (theme === 'forest') {
    for (let i = 0; i < 260; i++) {
      const x = rng.int(2, WX - 3), z = rng.int(2, WZ - 3);
      if (!free(x, z, 5)) continue;
      const h = top(x, z);
      if (w.get(x, h - 1, z) !== M.GRASS) continue;
      const th = rng.int(2, 4), ch = rng.int(6, 10), r0 = rng.range(2.2, 3.4);
      w.fill(x, h, z, x, h + th + ch - 2, z, M.BARK);
      for (let k = 0; k < ch; k++) {
        const r = r0 * (1 - k / ch) + 0.3;
        const y = h + th + k;
        for (let dz = -3; dz <= 3; dz++)
          for (let dx = -3; dx <= 3; dx++) {
            if (dx * dx + dz * dz > r * r) continue;
            if (w.get(x + dx, y, z + dz) === 0) w.set(x + dx, y, z + dz, (k + dx + dz) % 3 === 0 ? M.PINE2 : M.PINE);
          }
      }
    }
    for (let i = 0; i < 40; i++) {
      const x = rng.int(2, WX - 3), z = rng.int(2, WZ - 3);
      if (!free(x, z, 3.5)) continue;
      const h = top(x, z);
      if (rng.chance(0.5)) {
        const r = rng.range(1, 2.2);
        for (let dy = 0; dy < 3; dy++)
          for (let dz = -2; dz <= 2; dz++)
            for (let dx = -2; dx <= 2; dx++)
              if (dx * dx + dz * dz + dy * dy * 1.5 < r * r) w.set(x + dx, h + dy, z + dz, M.ROCK);
      } else {
        w.set(x, h, z, M.MUSH_W);
        w.fill(x - 1, h + 1, z - 1, x + 1, h + 1, z + 1, M.MUSH);
      }
    }
    // a creek with a log bridge
    for (let x = 56; x <= 59; x++)
      for (let z = 0; z < WZ; z++) {
        const h = hAt(x, z);
        for (let y = h - 3; y < h; y++) w.set(x, y, z, y === h - 1 ? M.WATER : y === h - 2 ? M.WATER : M.SAND);
      }
    for (let x = 55; x <= 60; x++) {
      const pz = Math.round(pathZ(x));
      for (let z = pz - 1; z <= pz + 1; z++) w.set(x, hAt(x, z) - 1, z, M.WOOD);
    }
  } else if (theme === 'strip') {
    for (const side of [-1, 1]) {
      let x = 22;
      while (x < WX - 2) {
        const bw = rng.int(5, 9), bh = rng.int(4, 7);
        const neon = rng.pick([M.NEON_PINK, M.NEON_CYAN, M.NEON_PURPLE, M.NEON_YELLOW]);
        const wall = rng.pick([M.CONCRETE, M.WHITE, M.BRICK3]);
        for (let bx = x; bx < Math.min(WX, x + bw); bx++) {
          for (let z = 0; z < WZ; z++) {
            const dz = (z - pathZ(bx)) * side;
            if (dz <= 7 || dz > 14 || !free(bx, z, 7)) continue;
            const h = hAt(bx, z);
            for (let y = h; y < h + bh; y++) {
              const ry = y - h;
              const roofEdge = ry === bh - 1 && (bx === x || bx === x + bw - 1 || Math.abs(dz - 8) < 1);
              const stripe = ry === bh - 2 && (bx + z) % 2 === 0;
              w.set(bx, y, z, roofEdge || stripe ? neon : ry === bh - 1 ? M.ROOF : ry === 1 && (bx + z) % 3 === 0 ? M.WINDOW_LIT : wall);
            }
          }
        }
        x += bw + rng.int(2, 4);
      }
    }
    // palm trees along the sidewalks
    for (let x = 24; x < WX - 18; x += rng.int(6, 10)) {
      if (Math.abs(x - GX) < 10) continue;
      const side = rng.chance(0.5) ? 1 : -1;
      const z = Math.round(pathZ(x) + side * 5);
      const h = top(x, z);
      const th = rng.int(7, 10);
      for (let y = 0; y < th; y++) w.set(x + (y > th - 3 ? 1 : 0), h + y, z, M.PALM);
      const cx = x + 1, cy = h + th;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        for (let k = 1; k <= 3; k++) w.set(cx + dx * k, cy - (k === 3 ? 1 : 0), z + dz * k, M.PALM_LEAF);
      }
      w.set(cx, cy, z, M.PALM_LEAF);
    }
    // billboards
    for (const bx of [48, 120]) {
      const bz = Math.round(pathZ(bx) - 11);
      const h = top(bx, bz);
      w.fill(bx, h, bz, bx, h + 5, bz, M.METAL);
      w.fill(bx + 6, h, bz, bx + 6, h + 5, bz, M.METAL);
      w.fill(bx - 1, h + 6, bz, bx + 7, h + 10, bz, (x, y) => (y === h + 6 || y === h + 10 || x === bx - 1 || x === bx + 7 ? M.NEON_PINK : (x + y) % 4 === 0 ? M.NEON_YELLOW : M.OBSIDIAN));
    }
  } else if (theme === 'arena') {
    // lava pools
    for (let z = 1; z < WZ - 1; z++)
      for (let x = 20; x < WX - 1; x++) {
        if (!free(x, z, 6)) continue;
        if (n2.fbm(x * 0.08, z * 0.08) > 0.6) {
          const h = hAt(x, z);
          w.set(x, h - 1, z, M.LAVA);
        }
      }
    // amp stacks & pyro pillars along the path
    for (let x = 26; x < WX - 26; x += 9) {
      if (Math.abs(x - GX) < 11) continue;
      for (const side of [-1, 1]) {
        const z = Math.round(pathZ(x) + side * 6);
        const h = top(x, z);
        if (rng.chance(0.6)) {
          w.fill(x - 1, h, z - 1, x + 1, h + 5, z + 1, (xx, y, zz) => (y === h + 5 ? M.AMPD : (y - h) % 3 !== 0 && Math.abs(zz - z) + Math.abs(xx - x) === 1 ? M.GRILLED : M.AMPD));
        } else {
          w.fill(x, h, z, x, h + 7, z, M.METAL);
          w.set(x, h + 8, z, M.NEON_YELLOW);
          w.set(x, h + 7, z, M.LAVA);
        }
      }
    }
  }

  // ---- gate canyon ----
  const wallMat = theme === 'city' ? M.BRICK2 : theme === 'forest' ? M.ROCK : theme === 'strip' ? M.HILL : M.OBSIDIAN;
  for (let x = GX - 9; x <= GX + 9; x++) {
    const pz = pathZ(x);
    for (let z = 0; z < WZ; z++) {
      if (Math.abs(z - pz) <= 3.5) continue;
      const h = hAt(x, z);
      const hh = Math.max(h, baseH + cliffUp) + 14;
      for (let y = h; y < Math.min(WY, hh); y++) {
        const win = theme === 'city' && (y - h) % 3 === 1 && (x + z) % 3 === 1;
        w.set(x, y, z, win ? M.WINDOW : y === hh - 1 && theme === 'forest' ? M.MOSS : wallMat);
      }
    }
  }
  const corridor = (x: number) => {
    const pz = pathZ(x);
    return [Math.ceil(pz - 3.5), Math.floor(pz + 3.5)];
  };
  if (def.gate === 'amp') {
    for (let x = GX; x <= GX + 1; x++) {
      const [z0, z1] = corridor(x);
      const h = hAt(x, Math.round(pathZ(x)));
      for (let z = z0; z <= z1; z++)
        for (let y = h; y < h + 14; y++) {
          const ry = y - h;
          const m = ry % 4 === 3 ? M.AMP : (ry % 4 === 0 && z === Math.round(pathZ(x))) ? M.AMP_LOGO : x === GX ? M.AMP_GRILLE : M.AMP;
          w.set(x, y, z, m);
        }
    }
  } else if (def.gate === 'chasm') {
    for (let x = GX - 7; x <= GX + 7; x++) {
      const [z0, z1] = corridor(x);
      for (let z = z0; z <= z1; z++) for (let y = 0; y < WY; y++) w.set(x, y, z, 0);
    }
  } else if (def.gate === 'none') {
    // a jumpable barricade of crates
    const [z0, z1] = corridor(GX);
    const h = hAt(GX, Math.round(pathZ(GX)));
    w.fill(GX, h, z0, GX + 1, h + 1, z1, (x, y, z) => ((x + y + z) % 2 ? M.WOOD : M.DUMPSTER));
  }

  // ---- boss arena ----
  const arenaH = baseH + cliffUp;
  for (let z = 0; z < WZ; z++)
    for (let x = ARX - ARR - 4; x < WX; x++) {
      const d = Math.hypot(x - ARX, z - ARZ);
      if (d < ARR) {
        const m = theme === 'city' ? ((x % 5 === 0 && Math.abs(z - ARZ) < 6) ? M.LINE : M.ASPHALT) : theme === 'forest' ? M.DIRT : theme === 'strip' ? (((x >> 1) + (z >> 1)) % 2 ? M.NEON_PURPLE : M.OBSIDIAN) : M.STAGE;
        w.set(x, arenaH - 1, z, m);
        for (let y = arenaH; y < WY; y++) w.set(x, y, z, 0);
      } else if (d < ARR + 1.2 && x > ARX - ARR + 2) {
        const fm = theme === 'city' ? M.FENCE : theme === 'forest' ? M.WOOD : theme === 'strip' ? M.NEON_CYAN : M.CHAIN;
        for (let y = arenaH; y < arenaH + 3; y++) w.set(x, y, z, fm);
      }
    }
  if (theme === 'arena') {
    // giant amp wall behind the stage
    for (let z = ARZ - 10; z <= ARZ + 10; z++)
      for (let y = arenaH; y < arenaH + 12; y++)
        w.set(WX - 3, y, z, (y + z) % 3 === 0 ? M.AMPD : M.GRILLED);
  }

  // ---- start area: tour van ----
  const vanZ = Math.round(pathZ(6) + 4);
  const buildVan = (x0: number, z0: number, h: number) => {
    w.fill(x0, h + 1, z0, x0 + 7, h + 4, z0 + 3, (x, y, z) => {
      if (y === h + 3 && (x === x0 + 6 || x === x0 + 7 || (x >= x0 + 1 && x <= x0 + 4 && (z === z0 || z === z0 + 3)))) return M.GLASS;
      if (y === h + 2) return M.VAN_B;
      return M.VAN_W;
    });
    for (const [tx, tz] of [[x0 + 1, z0], [x0 + 6, z0], [x0 + 1, z0 + 3], [x0 + 6, z0 + 3]]) w.set(tx, h, tz, M.TIRE);
    w.set(x0 + 7, h + 2, z0, M.LAMP).set(x0 + 7, h + 2, z0 + 3, M.LAMP);
  };
  buildVan(3, vanZ, baseH);
  const vans: [number, number, number][] = [[7, baseH, vanZ - 1]];
  // exit van in the arena (behind the boss)
  const evz = ARZ + 5;
  buildVan(ARX + 4, evz, arenaH);
  vans.push([ARX + 8, arenaH, evz - 1]);

  // ---- secrets ----
  const collectibles: Collectible[] = [];
  // hut sealed by an amp wall (needs POWER CHORD)
  {
    const hx = 44, pz = Math.round(pathZ(44));
    const hz = pz + 7;
    const h = Math.max(hAt(hx, hz), hAt(hx + 4, hz + 4));
    w.fill(hx - 1, 0, hz - 1, hx + 5, WY - 1, hz + 5, 0);
    w.fill(hx - 1, 0, hz - 1, hx + 5, h - 1, hz + 5, sub);
    w.fill(hx - 1, h, hz - 1, hx + 5, h + 5, hz + 5, (x, y, z) => {
      const edge = x === hx - 1 || x === hx + 5 || z === hz - 1 || z === hz + 5 || y === h + 5;
      if (!edge) return 0;
      if (z === hz - 1 && x >= hx + 1 && x <= hx + 3 && y < h + 4) return (y + x) % 2 ? M.AMP_GRILLE : M.AMP;
      return wallMat === M.OBSIDIAN ? M.ROCK : wallMat;
    });
    // walkway from the path to the door
    for (let z = pz; z < hz - 1; z++) for (let x = hx + 1; x <= hx + 3; x++) {
      for (let y = h; y < WY; y++) w.set(x, y, z, 0);
      for (let y = Math.min(hAt(x, z), h) - 1; y < h; y++) w.set(x, y, z, theme === 'forest' ? M.DIRT : M.SIDEWALK);
    }
    collectibles.push({ kind: 'tape', id: `${index}-tape`, x: hx + 2.5, y: h + 1.2, z: hz + 2.5 });
  }
  // tall pillar (needs STAGE DIVE)
  {
    const px = 118, pz = Math.round(pathZ(118)) - 8;
    const h = baseH + cliffUp;
    w.fill(px - 4, h, pz - 4, px + 4, WY - 1, pz + 4, 0);
    w.fill(px - 4, 0, pz - 4, px + 4, h - 1, pz + 4, (x, y) => (y === h - 1 ? surf : sub));
    w.fill(px - 1, h, pz - 1, px + 1, h + 6, pz + 1, (x, y) => (y === h + 6 ? (theme === 'forest' ? M.MOSS : M.ROOF) : wallMat === M.OBSIDIAN ? M.ROCK : wallMat));
    collectibles.push({ kind: 'pouch', id: `${index}-pouch`, x: px + 0.5, y: h + 8.2, z: pz + 0.5 });
  }

  // ---- enemies ----
  const spawns: Spawn[] = [];
  for (let x = 28; x < ARX - ARR - 4; x += rng.int(8, 12)) {
    if (Math.abs(x - GX) < 11) continue;
    const kind = rng.pick(def.enemies);
    const z = pathZ(x) + rng.range(-3, 3);
    const y = top(Math.floor(x), Math.floor(z));
    spawns.push({ kind, x: x + 0.5, y: kind === 'drone' ? y + 4 : y, z });
    if (x > 60 && rng.chance(0.35)) spawns.push({ kind: 'poser', x: x + 2.5, y: top(x + 2, Math.floor(z + 1.5)), z: z + 1.5 });
  }

  const ck2x = GX + 12;
  const checkpoints: [number, number, number][] = [
    [14.5, top(14, Math.round(pathZ(14) - 3)), Math.round(pathZ(14) - 3) + 0.5],
    [ck2x + 0.5, top(ck2x, Math.round(pathZ(ck2x) + 3)), Math.round(pathZ(ck2x) + 3) + 0.5],
  ];

  return {
    world: w,
    start: [10.5, baseH, pathZ(10)],
    spawns,
    collectibles,
    checkpoints,
    vans,
    arena: [ARX, arenaH, ARZ, ARR],
    gateX: GX,
    pathZ,
  };
}
