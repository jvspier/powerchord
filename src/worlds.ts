// World definitions and procedural voxel generation for each stop of the tour.
// Every world shares a skeleton (start lot + tour van, a winding main route,
// an ability gate, two secrets and a boss arena) but is dressed by its own
// themed generator. Layouts are seeded per playthrough.
import { VoxelWorld, M, Lighting } from './voxels';
import { RNG, hex, hash2, clamp } from './math';

export type Ability = 'chord' | 'dive' | 'dash';
export type EnemyKind = 'poser' | 'drone' | 'roadie';
export type GateKind = 'none' | 'amp' | 'cliff' | 'chasm';
export type Theme = 'city' | 'video' | 'mall' | 'venue';

export interface WorldDef {
  name: string;
  subtitle: string;
  seed: number;
  skyTop: number;
  skyBot: number;
  fog: number;
  light: Lighting;
  stars: boolean;
  weather: 'rain' | 'dust' | 'neon' | 'confetti';
  gate: GateKind;
  gateHint: string;
  gateHintHave: string;
  boss: number;
  bossName: string;
  bossLines: string[];
  reward: Ability | null;
  rewardText: string;
  enemies: EnemyKind[];
  theme: Theme;
}

const norm = (x: number, y: number, z: number): [number, number, number] => {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
};

export const WORLDS: WorldDef[] = [
  {
    name: 'RAIN CITY', subtitle: 'DOWNTOWN, 1991', seed: 101, theme: 'city',
    skyTop: hex('#2e3a4c'), skyBot: hex('#8c98a6'), fog: hex('#7a8694'), stars: false, weather: 'rain',
    light: { sun: norm(-0.45, 0.8, -0.35), sunInt: 0.42, ambient: 0.66, sunColor: hex('#d8e0f0') },
    gate: 'none', gateHint: '', gateHintHave: '',
    boss: 0, bossName: 'THE A&R MAN', reward: 'chord',
    bossLines: ['SIGN HERE, KID. LOSE THE FLANNEL,', 'GET A PERM, AND WE CAN MAKE YOU A STAR.', 'RIKKI SPANDEX OWNS THIS TOWN NOW.'],
    rewardText: 'POWER CHORD! PRESS L TO UNLEASH A SHOCKWAVE. IT BREAKS WALLS OF AMPS AND TVS.',
    enemies: ['poser', 'poser', 'drone'],
  },
  {
    name: 'REWIND VIDEO', subtitle: 'BE KIND, PLEASE REWIND', seed: 202, theme: 'video',
    skyTop: hex('#0e0b14'), skyBot: hex('#241c30'), fog: hex('#221a2c'), stars: false, weather: 'dust',
    light: { sun: norm(0.2, 0.95, 0.25), sunInt: 0.3, ambient: 0.78, sunColor: hex('#e8fff0') },
    gate: 'amp', gateHint: 'A WALL OF TVS. ONLY A POWER CHORD COULD BLOW IT OUT.', gateHintHave: 'PRESS L: POWER CHORD THE TV WALL!',
    boss: 1, bossName: 'LATE FEE LARRY', reward: 'dive',
    bossLines: ['THAT TAPE WAS DUE BACK IN 1989!', 'YOU OWE ME FOUR HUNDRED BUCKS IN LATE FEES.', 'BE KIND... REWIND... YOUR FACE!'],
    rewardText: 'STAGE DIVE! PRESS JUMP IN MID-AIR TO DOUBLE JUMP.',
    enemies: ['poser', 'roadie', 'drone', 'poser'],
  },
  {
    name: 'GALLERIA MALL', subtitle: 'OPEN LATE ALL WEEKEND', seed: 303, theme: 'mall',
    skyTop: hex('#6a9ac8'), skyBot: hex('#d8e4ec'), fog: hex('#b8c8d4'), stars: false, weather: 'neon',
    light: { sun: norm(-0.3, 0.9, 0.3), sunInt: 0.42, ambient: 0.68, sunColor: hex('#fff4e0') },
    gate: 'cliff', gateHint: 'THE ESCALATOR IS BUSTED. A STAGE DIVE MIGHT GET YOU UP THERE.', gateHintHave: '',
    boss: 2, bossName: 'DJ SYNTHAX', reward: 'dash',
    bossLines: ['WELCOME TO THE FOOD COURT, FLANNEL BOY.', 'GUITARS ARE OVER. THE FUTURE IS SYNTH-ETIC!', 'FEEL THE KEYTAR!'],
    rewardText: 'MOSH DASH! PRESS SHIFT TO DASH, EVEN IN MID-AIR.',
    enemies: ['poser', 'drone', 'drone', 'roadie'],
  },
  {
    name: 'THE COLOSSEUM', subtitle: 'RIKKI SPANDEX: LIVE AND LOUD', seed: 404, theme: 'venue',
    skyTop: hex('#06040a'), skyBot: hex('#3a0c2a'), fog: hex('#1c0a1c'), stars: true, weather: 'confetti',
    light: { sun: norm(0.3, 0.8, 0.45), sunInt: 0.42, ambient: 0.62, sunColor: hex('#ffc0e0') },
    gate: 'chasm', gateHint: "THE MOSH PIT IS TOO WIDE TO JUMP. YOU'LL NEED A MOSH DASH.", gateHintHave: '',
    boss: 3, bossName: 'RIKKI SPANDEX', reward: null,
    bossLines: ['WELL WELL. THE FLANNEL FREAK.', 'THE 80S WILL NEVER DIE, BABY!', 'TIME TO FACE THE HAIR!'],
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
  vents: [number, number, number][];
  arena: [number, number, number, number]; // x, y, z, radius
  gateX: number;
  pathZ: (x: number) => number;
}

export const WX = 176, WY = 44, WZ = 48;
const GX = 86; // ability gate
const ARX = 154, ARZ = WZ / 2, ARR = 13; // boss arena
const BASE = 8;
const BLD = 20; // indoor themes: the building starts here (parking lot before it)

const TAPES = [M.TAPE_K, M.TAPE_K, M.TAPE_R, M.TAPE_Y, M.TAPE_B, M.TAPE_G, M.TAPE_W];

export function generateWorld(index: number, runSeed = 0): GenResult {
  const def = WORLDS[index];
  const seed = def.seed + (runSeed | 0) * 7919;
  const w = new VoxelWorld(WX, WY, WZ);
  const rng = new RNG(seed);
  const ph = (seed % 1000) * 0.37;
  const wig = def.theme === 'city' ? 6 : 4;
  const pathZ = (x: number) => WZ / 2 + Math.sin(x * 0.045 + ph) * wig + Math.sin(x * 0.11 + ph * 2) * 2;
  const theme = def.theme;
  const indoor = theme !== 'city';
  const cliffUp = def.gate === 'cliff' ? 6 : 0;
  const arenaH = BASE + cliffUp;
  const vents: [number, number, number][] = [];

  // ---------------------------------------------------------------- heightmap
  const H = new Int16Array(WX * WZ);
  const hAt = (x: number, z: number) => H[clamp(z, 0, WZ - 1) * WX + clamp(x, 0, WX - 1)];
  for (let z = 0; z < WZ; z++) {
    for (let x = 0; x < WX; x++) {
      const dp = Math.abs(z - pathZ(x));
      let h = BASE;
      if (x >= GX && cliffUp) h += cliffUp;
      // concert venue: stepped stadium stands rising away from the floor
      if (theme === 'venue' && x > BLD + 4 && dp > 11) h += Math.min(6, Math.floor((dp - 11) / 1.4));
      if (x < BLD) h = BASE;
      if (Math.hypot(x - ARX, z - ARZ) < ARR + 3) h = arenaH;
      H[z * WX + x] = h;
    }
  }

  // floor materials per theme
  const floorMat = (x: number, z: number): number => {
    const dp = Math.abs(z - pathZ(x));
    if (indoor && x < BLD) return hash2(x, z, 3) < 0.03 ? M.PUDDLE : (x % 7 === 0 && dp > 4 ? M.LINE : M.ASPHALT);
    switch (theme) {
      case 'city':
        if (dp <= 3.5) return Math.abs(z - Math.round(pathZ(x))) < 0.5 && x % 6 < 3 ? M.LINE : hash2(x, z, 4) < 0.05 ? M.PUDDLE : M.ASPHALT;
        return M.SIDEWALK;
      case 'video': {
        const d1 = (x + z) % 7 === 0, d2 = (x - z + 700) % 7 === 0;
        return d1 && d2 ? M.CARPET3 : d1 || d2 ? M.CARPET2 : M.CARPET;
      }
      case 'mall':
        return ((x >> 1) + (z >> 1)) % 2 ? M.TILE : M.TILE2;
      case 'venue':
        if (hAt(x, z) > BASE + cliffUp) return Math.floor(Math.abs(z - pathZ(x)) / 1.4) % 2 ? M.SEAT : M.CONCRETE;
        return hash2(x, z, 8) < 0.02 ? M.LINE : M.VFLOOR;
    }
  };
  const sub = indoor ? M.CONCRETE : M.DIRT;
  for (let z = 0; z < WZ; z++)
    for (let x = 0; x < WX; x++) {
      const h = hAt(x, z);
      const fm = floorMat(x, z);
      for (let y = 0; y < h; y++) w.set(x, y, z, y === h - 1 ? fm : y < h - 4 ? M.STONE : sub);
    }

  const top = (x: number, z: number) => w.heightAt(x, z);
  const free = (x: number, z: number, r: number) => {
    if (Math.abs(z - pathZ(x)) < r) return false;
    if (Math.abs(x - GX) < 12) return false;
    if (Math.hypot(x - ARX, z - ARZ) < ARR + 4) return false;
    if (x < BLD + 2) return false;
    return x > 1 && z > 1 && x < WX - 2 && z < WZ - 2;
  };
  const wallMat = { city: M.BRICK2, video: M.WALLPAPER, mall: M.CONCRETE, venue: M.WALL_DARK }[theme];

  function wallStripe(t: Theme, ry: number, x: number): number {
    if (t === 'video') return ry === 2 ? M.WALL_STRIPE : ry === 3 && x % 9 < 2 ? M.TAPE_Y : M.WALLPAPER;
    if (t === 'mall') return ry === 1 ? M.TILE2 : M.CONCRETE;
    return ry % 4 === 0 ? M.AMPD : M.WALL_DARK;
  }

  // ---------------------------------------------------------------- interior shell
  if (indoor) {
    const wallH = theme === 'venue' ? 9 : 7;
    for (let x = BLD; x < WX; x++)
      for (const z of [0, WZ - 1]) {
        const h = hAt(x, z);
        for (let y = h; y < Math.max(h, BASE) + wallH; y++) w.set(x, y, z, wallStripe(theme, y - BASE, x));
      }
    for (let z = 0; z < WZ; z++) for (let y = hAt(WX - 1, z); y < BASE + cliffUp + wallH + 4; y++) w.set(WX - 1, y, z, wallMat);
    // facade with an entrance on the route
    for (let z = 0; z < WZ; z++) {
      const door = Math.abs(z - pathZ(BLD)) <= 3;
      for (let y = BASE; y < BASE + wallH; y++) {
        const ry = y - BASE;
        if (door && ry < 5) continue;
        const win = !door && ry >= 1 && ry <= 3 && z % 6 < 4 && theme !== 'venue';
        w.set(BLD, y, z, win ? M.GLASS : theme === 'mall' ? M.CONCRETE : theme === 'video' ? M.BRICK3 : M.WALL_DARK);
      }
    }
    // marquee sign above the doors
    const sz = Math.round(pathZ(BLD));
    const signCol = theme === 'video' ? [M.NEON_YELLOW, M.NEON_PINK] : theme === 'mall' ? [M.NEON_CYAN, M.NEON_PURPLE] : [M.NEON_PINK, M.LAMP];
    w.fill(BLD - 1, BASE + 5, sz - 6, BLD - 1, BASE + 8, sz + 6, (x, y, z) =>
      y === BASE + 5 || y === BASE + 8 || Math.abs(z - sz) === 6 ? signCol[0] : (z + y) % 3 === 0 ? signCol[1] : M.WALL_DARK);
  }

  // ---------------------------------------------------------------- themes
  if (theme === 'city') genCity();
  else if (theme === 'video') genVideo();
  else if (theme === 'mall') genMall();
  else genVenue();

  function genCity() {
    for (const side of [-1, 1]) {
      let x = 20;
      while (x < WX - 2) {
        const bw = rng.int(6, 11), bh = rng.int(5, 12);
        const mat = rng.pick([M.BRICK, M.BRICK2, M.BRICK3]);
        const lit = rng.next();
        for (let bx = x; bx < Math.min(WX, x + bw); bx++)
          for (let z = 0; z < WZ; z++) {
            const dz = (z - pathZ(bx)) * side;
            if (dz <= 7 || !free(bx, z, 7)) continue;
            const h = hAt(bx, z);
            for (let y = h; y < h + bh; y++) {
              const ry = y - h;
              const win = ry % 3 === 1 && (bx + z) % 3 === 1 && ry < bh - 1;
              w.set(bx, y, z, win ? (hash2(bx * 7 + y, z, 3) < lit * 0.6 ? M.WINDOW_LIT : M.WINDOW) : ry === bh - 1 ? M.ROOF : mat);
            }
            if (hash2(bx, z, 21) < 0.02) w.set(bx, h + bh, z, M.METAL);
          }
        x += bw + rng.int(1, 3);
      }
    }
    for (let x = 24; x < WX - 20; x += 11) {
      if (Math.abs(x - GX) < 12) continue;
      const side = (x / 11) % 2 < 1 ? 1 : -1;
      const z = Math.round(pathZ(x) + side * 5);
      const h = top(x, z);
      w.fill(x, h, z, x, h + 4, z, M.METAL);
      w.set(x, h + 5, z, M.LAMP).set(x, h + 4, z - side, M.METAL);
    }
    // parked cars (low enough to hop over)
    for (let i = 0; i < 9; i++) {
      const x = rng.int(26, WX - 26);
      if (Math.abs(x - GX) < 12) continue;
      const side = rng.chance(0.5) ? 1 : -1;
      const z = Math.round(pathZ(x) + side * 2.5);
      const h = top(x, z);
      w.fill(x, h, z - 1, x + 4, h, z, rng.pick([M.RED, M.VAN_B, M.WHITE, M.DUMPSTER]));
      w.fill(x + 1, h + 1, z - 1, x + 3, h + 1, z, M.GLASS);
    }
    // payphones and newspaper boxes on the sidewalks
    for (let i = 0; i < 6; i++) {
      const x = rng.int(24, WX - 30);
      const z = Math.round(pathZ(x) + (rng.chance(0.5) ? 5.5 : -5.5));
      if (Math.abs(x - GX) < 12) continue;
      const h = top(x, z);
      if (rng.chance(0.5)) { w.fill(x, h, z, x, h + 2, z, M.METAL); w.set(x, h + 2, z, M.VAN_B); }
      else w.fill(x, h, z, x, h + 1, z, rng.pick([M.RED, M.VAN_B, M.TAPE_Y]));
    }
  }

  // ------------------------------------------------ VHS rental store
  function genVideo() {
    // aisles of tape shelves running across the store, each with a gap
    let x = BLD + 6;
    while (x < ARX - ARR - 6) {
      if (Math.abs(x - GX) < 12) { x++; continue; }
      const pz = pathZ(x);
      for (const s of [-1, 1]) {
        const from = Math.round(pz + s * 4.5), to = s > 0 ? WZ - 3 : 2;
        const gapAt = rng.int(Math.min(from, to) + 2, Math.max(from, to) - 3);
        for (let z = from; s > 0 ? z <= to : z >= to; z += s) {
          if (Math.abs(z - gapAt) <= 1) continue;
          const h = hAt(x, z);
          for (let y = h; y < h + 3; y++) {
            w.set(x, y, z, M.SHELF);
            // tape spines on both faces of the shelf
            w.set(x - 1, y, z, hash2(x * 3 + y, z, 7) < 0.1 ? M.SHELF : TAPES[Math.floor(hash2(x, y * 31 + z, 9) * TAPES.length)]);
            w.set(x + 1, y, z, TAPES[Math.floor(hash2(x + 1, y * 31 + z, 9) * TAPES.length)]);
          }
          w.fill(x - 1, h + 3, z, x + 1, h + 3, z, M.SHELF);
        }
        // hanging genre sign at the aisle end
        const sc = rng.pick([M.NEON_PINK, M.NEON_CYAN, M.NEON_YELLOW, M.NEON_PURPLE]);
        w.fill(x - 1, BASE + 6, from + s, x + 1, BASE + 6, from + s, sc);
      }
      x += rng.int(5, 7);
    }
    // checkout counter with a CRT and a stack of tapes
    const cz = Math.round(pathZ(BLD + 5) - 7);
    w.fill(BLD + 3, BASE, cz - 2, BLD + 9, BASE + 1, cz, M.PLASTIC);
    w.fill(BLD + 4, BASE + 2, cz - 1, BLD + 5, BASE + 3, cz - 1, M.WALL_DARK);
    w.set(BLD + 4, BASE + 3, cz, M.CRT).set(BLD + 5, BASE + 3, cz, M.CRT);
    w.fill(BLD + 7, BASE + 2, cz - 1, BLD + 8, BASE + 2, cz - 1, M.TAPE_K);
    // TV walls showing static along the back wall
    for (let tx = BLD + 8; tx < WX - 20; tx += rng.int(10, 16)) {
      if (Math.abs(tx - GX) < 12) continue;
      w.fill(tx, BASE + 2, WZ - 2, tx + 5, BASE + 5, WZ - 2, (xx, y) => ((xx - tx) % 2 === 0 || y === BASE + 2 ? M.WALL_DARK : M.CRT));
    }
    // movie posters on the walls
    for (let i = 0; i < 14; i++) {
      const px = rng.int(BLD + 4, WX - 6);
      const pz = rng.chance(0.5) ? 1 : WZ - 2;
      if (w.get(px, BASE + 3, pz) !== 0) continue;
      const c = rng.pick([M.RED, M.TAPE_Y, M.VAN_B, M.NEON_PINK, M.TAPE_G]);
      w.fill(px, BASE + 2, pz, px + 1, BASE + 4, pz, (xx, y) => (y === BASE + 3 && xx === px ? M.TAPE_W : c));
    }
    // returns bin near the door
    const rz = Math.round(pathZ(BLD + 3) + 6);
    w.fill(BLD + 2, BASE, rz, BLD + 3, BASE + 1, rz + 1, M.VAN_B);
    w.set(BLD + 2, BASE + 1, rz, M.TAPE_W);
  }

  // ------------------------------------------------ shopping mall
  function genMall() {
    const storeKinds = ['arcade', 'music', 'clothes', 'toys'];
    for (const s of [-1, 1]) {
      let x = BLD + 2;
      while (x < ARX - ARR - 6) {
        const sw = rng.int(9, 13);
        if (x + sw > GX - 10 && x < GX + 10) { x = GX + 10; continue; }
        const kind = rng.pick(storeKinds);
        const neon = rng.pick([M.NEON_PINK, M.NEON_CYAN, M.NEON_YELLOW, M.NEON_PURPLE]);
        const inner = rng.pick([M.CARPET, M.WOODFLOOR, M.CARPET2, M.TILE]);
        const doorAt = x + Math.floor(sw / 2);
        for (let bx = x; bx < x + sw; bx++) {
          const pz = pathZ(bx);
          for (let z = 1; z < WZ - 1; z++) {
            const dz = (z - pz) * s;
            if (dz < 8) continue;
            const h = hAt(bx, z);
            const front = dz < 9;
            const side = bx === x || bx === x + sw - 1;
            if (front || side) {
              for (let y = h; y < h + 7; y++) {
                const ry = y - h;
                let m: number = M.CONCRETE;
                if (front && !side) {
                  if (Math.abs(bx - doorAt) <= 1 && ry < 4) m = 0;
                  else if (ry < 4) m = ry === 0 ? M.CONCRETE : M.GLASS;
                  else if (ry === 4 || ry === 5) m = neon;
                }
                w.set(bx, y, z, m);
              }
            } else {
              w.set(bx, h - 1, z, inner);
              if ((bx + z) % 3 === 0 && Math.abs(bx - doorAt) > 1 && dz > 10) {
                if (kind === 'arcade') {
                  if (bx % 3 === 0) {
                    w.fill(bx, h, z, bx, h + 2, z, M.ARCADE);
                    w.set(bx, h + 2, z - s, rng.pick([M.NEON_CYAN, M.NEON_PINK, M.CRT]));
                  }
                } else if (kind === 'music') {
                  w.set(bx, h, z, M.SHELF).set(bx, h + 1, z, TAPES[(bx * 7 + z) % TAPES.length]);
                } else if (kind === 'clothes') {
                  w.set(bx, h + 2, z, M.METAL);
                  w.set(bx, h + 1, z, rng.pick([M.RED, M.TAPE_B, M.TAPE_G, M.NEON_PURPLE, M.TAPE_W]));
                } else {
                  w.set(bx, h, z, rng.pick([M.RED, M.TAPE_Y, M.TAPE_B]));
                }
              }
            }
          }
        }
        x += sw - 1;
      }
    }
    // concourse: planters with palms, benches and kiosk carts
    for (let i = 0; i < 26; i++) {
      const x = rng.int(BLD + 4, ARX - ARR - 6);
      const s = rng.chance(0.5) ? 1 : -1;
      const z = Math.round(pathZ(x) + s * rng.range(4.5, 6.5));
      if (!free(x, z, 4.2) || top(x, z) !== hAt(x, z) || top(x + 1, z + 1) !== hAt(x + 1, z + 1)) continue;
      const h = hAt(x, z);
      const r = rng.next();
      if (r < 0.4) {
        w.fill(x, h, z, x + 1, h, z + 1, M.POT);
        w.fill(x, h + 1, z, x + 1, h + 1, z + 1, M.PLANT);
        w.fill(x, h + 2, z, x, h + 4, z, M.PALM);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) w.set(x + dx, h + 5, z + dz, M.PALM_LEAF).set(x + dx * 2, h + 4, z + dz * 2, M.PALM_LEAF);
      } else if (r < 0.7) {
        w.fill(x, h, z, x + 2, h, z, M.WOODFLOOR);
      } else {
        w.fill(x, h, z, x + 1, h + 1, z + 1, M.PLASTIC);
        w.fill(x, h + 2, z, x, h + 3, z, M.METAL);
        w.fill(x - 1, h + 4, z - 1, x + 2, h + 4, z + 2, rng.pick([M.NEON_PINK, M.NEON_CYAN, M.NEON_YELLOW]));
      }
    }
    // fountain on the concourse (a low rim you can step over)
    const fx = rng.int(46, 64), fz = Math.round(pathZ(fx));
    for (let z = fz - 5; z <= fz + 5; z++)
      for (let x = fx - 5; x <= fx + 5; x++) {
        const d = Math.hypot(x - fx, z - fz);
        if (d > 4.6) continue;
        for (let y = BASE; y < BASE + 6; y++) w.set(x, y, z, 0);
        if (d > 3.6) w.set(x, BASE, z, M.CONCRETE);
        else { w.set(x, BASE - 1, z, M.WATER); w.set(x, BASE - 2, z, M.TILE2); }
      }
    w.fill(fx, BASE - 1, fz, fx, BASE, fz, M.CONCRETE);
    w.set(fx, BASE + 1, fz, M.NEON_CYAN);
    // a tiled lip on the upper level
    for (let z = 1; z < WZ - 1; z++) if (hAt(GX, z) === BASE + cliffUp) w.set(GX, BASE + cliffUp - 1, z, M.TILE2);
    // food court tables around the arena
    for (let i = 0; i < 14; i++) {
      const a = rng.range(0, Math.PI * 2), d = ARR + rng.range(2.5, 5);
      const x = Math.round(ARX + Math.cos(a) * d), z = Math.round(ARZ + Math.sin(a) * d);
      if (x < ARX - ARR + 1 || z < 2 || z > WZ - 3 || x > WX - 3) continue;
      const h = hAt(x, z);
      w.set(x, h, z, M.METAL).set(x, h + 1, z, M.WHITE).set(x + 1, h + 1, z, M.WHITE);
    }
  }

  // ------------------------------------------------ concert venue
  function genVenue() {
    // overhead lighting trusses with coloured spotlights
    for (let x = BLD + 10; x < WX - 4; x += 14) {
      const y = BASE + 12;
      for (let z = 1; z < WZ - 1; z++) {
        w.set(x, y, z, M.METAL);
        if (z % 4 === 2) w.set(x, y - 1, z, rng.pick([M.SPOT_W, M.NEON_PINK, M.NEON_CYAN, M.NEON_PURPLE, M.NEON_YELLOW]));
      }
      for (const z of [1, WZ - 2]) w.fill(x, hAt(x, z), z, x, y, z, M.METAL);
    }
    // speaker stacks and crowd barriers along the floor
    for (let x = BLD + 6; x < ARX - ARR - 6; x += rng.int(7, 10)) {
      if (Math.abs(x - GX) < 12) continue;
      for (const s of [-1, 1]) {
        const z = Math.round(pathZ(x) + s * 5.5);
        const h = hAt(x, z);
        if (h !== BASE) continue;
        if (rng.chance(0.55)) {
          w.fill(x - 1, h, z - 1, x + 1, h + 4, z + 1, (xx, y, zz) => ((y - h) % 3 !== 0 && Math.abs(zz - z) + Math.abs(xx - x) === 1 ? M.GRILLED : M.AMPD));
        } else {
          w.fill(x - 2, h, z, x + 2, h, z, M.FENCE);
        }
      }
    }
    // pyro vents: flame jets scattered across the floor (they hurt!)
    for (let i = 0; i < 40; i++) {
      const x = rng.int(BLD + 4, ARX - ARR - 4), z = rng.int(3, WZ - 4);
      if (!free(x, z, 4.5) || hAt(x, z) !== BASE || w.get(x, BASE, z) !== 0) continue;
      w.set(x, BASE - 1, z, M.PYRO);
      vents.push([x + 0.5, BASE, z + 0.5]);
    }
    // merch stand near the entrance
    const mz = Math.round(pathZ(BLD + 6) - 7);
    w.fill(BLD + 4, BASE, mz - 1, BLD + 9, BASE + 1, mz, M.SHELF);
    for (let x = BLD + 4; x <= BLD + 9; x++) w.set(x, BASE + 2, mz - 1, rng.pick([M.TAPE_K, M.RED, M.TAPE_W, M.NEON_PINK]));
  }

  // ---------------------------------------------------------------- ability gate
  for (let x = GX - 9; x <= GX + 9; x++) {
    const pz = pathZ(x);
    for (let z = 0; z < WZ; z++) {
      if (Math.abs(z - pz) <= 4.5) continue;
      const h = hAt(x, z);
      const hh = Math.max(h, BASE + cliffUp) + 14;
      for (let y = h; y < Math.min(WY, hh); y++) {
        const ry = y - h;
        const win = (theme === 'city' || theme === 'mall') && ry % 3 === 1 && (x + z) % 3 === 1;
        w.set(x, y, z, win ? (theme === 'mall' ? M.GLASS : M.WINDOW) : theme === 'video' ? wallStripe('video', ry, x) : wallMat);
      }
    }
  }
  const corridor = (x: number) => {
    const pz = pathZ(x);
    return [Math.ceil(pz - 4.5), Math.floor(pz + 4.5)];
  };
  // breakable materials: a TV wall in the video store, amp stacks elsewhere
  const brk = (x: number, y: number, z: number, logo: boolean) =>
    theme === 'video'
      ? (y % 3 === 0 || z % 3 === 0 ? M.TV_CASE : M.TV_SCREEN)
      : y % 4 === 3 ? M.AMP : logo ? M.AMP_LOGO : x % 2 === 0 ? M.AMP_GRILLE : M.AMP;
  if (def.gate === 'amp') {
    for (let x = GX; x <= GX + 1; x++) {
      const [z0, z1] = corridor(x);
      const h = hAt(x, Math.round(pathZ(x)));
      for (let z = z0; z <= z1; z++) for (let y = h; y < h + 14; y++) w.set(x, y, z, brk(x, y, z, (y - h) % 4 === 0 && z === Math.round(pathZ(x))));
    }
  } else if (def.gate === 'chasm') {
    for (let x = GX - 6; x <= GX + 7; x++) {
      const [z0, z1] = corridor(x);
      for (let z = z0; z <= z1; z++) for (let y = 0; y < WY; y++) w.set(x, y, z, 0);
    }
  } else if (def.gate === 'none') {
    const [z0, z1] = corridor(GX);
    const h = hAt(GX, Math.round(pathZ(GX)));
    w.fill(GX, h, z0, GX + 1, h + 1, z1, (x, y, z) => ((x + y + z) % 2 ? M.WOOD : M.DUMPSTER));
  }

  // ---------------------------------------------------------------- boss arena
  for (let z = 0; z < WZ; z++)
    for (let x = ARX - ARR - 4; x < WX; x++) {
      const d = Math.hypot(x - ARX, z - ARZ);
      if (d < ARR) {
        let m: number;
        if (theme === 'city') m = x % 5 === 0 && Math.abs(z - ARZ) < 6 ? M.LINE : M.ASPHALT;
        else if (theme === 'video') m = d < 4 ? M.CARPET3 : (x + z) % 4 === 0 ? M.CARPET2 : M.CARPET;
        else if (theme === 'mall') m = ((x >> 1) + (z >> 1)) % 2 ? M.TILE : M.NEON_PURPLE;
        else m = M.STAGE;
        w.set(x, arenaH - 1, z, m);
        for (let y = arenaH; y < WY; y++) w.set(x, y, z, 0);
      } else if (d < ARR + 1.2 && x > ARX - ARR + 2) {
        const fm = theme === 'video' ? M.SHELF : M.FENCE;
        for (let y = arenaH; y < arenaH + 3; y++) w.set(x, y, z, fm);
      }
    }
  if (theme === 'venue') {
    // the main stage: giant amp wall, drum riser and lights
    for (let z = ARZ - 10; z <= ARZ + 10; z++)
      for (let y = arenaH; y < arenaH + 12; y++) w.set(WX - 3, y, z, (y + z) % 3 === 0 ? M.AMPD : M.GRILLED);
    const dx = ARX + 8, dz = ARZ - 6;
    w.fill(dx - 2, arenaH, dz - 2, dx + 2, arenaH, dz + 2, M.STAGE);
    w.fill(dx - 1, arenaH + 1, dz - 1, dx + 1, arenaH + 2, dz + 1, (x, y, z) => (x === dx && z === dz ? M.WHITE : M.RED));
    w.set(dx + 2, arenaH + 1, dz + 2, M.METAL).set(dx + 2, arenaH + 2, dz + 2, M.TAPE_Y);
  }
  if (theme === 'video') {
    // "RETURNS" neon over the back room
    const sz = ARZ - ARR - 1;
    w.fill(ARX - 4, arenaH + 4, sz, ARX + 4, arenaH + 6, sz, (x, y) => (y === arenaH + 5 && x % 2 === 0 ? M.NEON_YELLOW : M.NEON_PINK));
  }

  // ---------------------------------------------------------------- tour vans
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
  buildVan(3, vanZ, BASE);
  const vans: [number, number, number][] = [[7, BASE, vanZ - 1]];
  const evz = ARZ + 5;
  buildVan(ARX + 4, evz, arenaH);
  vans.push([ARX + 8, arenaH, evz - 1]);

  // ---------------------------------------------------------------- secrets
  const collectibles: Collectible[] = [];
  const closetWall = theme === 'city' ? M.BRICK2 : theme === 'venue' ? M.CONCRETE : wallMat;
  // a closet sealed by a breakable wall (needs POWER CHORD)
  {
    const hx = rng.int(36, 52), pz = Math.round(pathZ(hx));
    const s = rng.chance(0.5) ? 1 : -1;
    const hz = s > 0 ? pz + 7 : pz - 11;
    const h = BASE;
    w.fill(hx - 1, 0, hz - 1, hx + 5, WY - 1, hz + 5, 0);
    w.fill(hx - 1, 0, hz - 1, hx + 5, h - 1, hz + 5, (x, y, z) => (y === h - 1 ? floorMat(x, z) : sub));
    const doorZ = s > 0 ? hz - 1 : hz + 5;
    w.fill(hx - 1, h, hz - 1, hx + 5, h + 5, hz + 5, (x, y, z) => {
      const edge = x === hx - 1 || x === hx + 5 || z === hz - 1 || z === hz + 5 || y === h + 5;
      if (!edge) return 0;
      if (z === doorZ && x >= hx + 1 && x <= hx + 3 && y < h + 4) return brk(x, y, z, false);
      return closetWall;
    });
    // clear walkway between the route and the closet door
    const z0 = s > 0 ? pz : hz + 6, z1 = s > 0 ? hz - 2 : pz;
    for (let z = z0; z <= z1; z++)
      for (let x = hx + 1; x <= hx + 3; x++) {
        for (let y = h; y < WY; y++) w.set(x, y, z, 0);
        for (let y = 0; y < h; y++) w.set(x, y, z, y === h - 1 ? floorMat(x, z) : sub);
      }
    collectibles.push({ kind: 'tape', id: `${index}-tape`, x: hx + 2.5, y: h + 1.2, z: hz + 2.5 });
  }
  // a tall display tower (needs STAGE DIVE)
  {
    const px = rng.int(110, 124), s = rng.chance(0.5) ? 1 : -1;
    const pz = Math.round(pathZ(px)) + s * 8;
    const h = BASE + cliffUp;
    w.fill(px - 4, h, pz - 4, px + 4, WY - 1, pz + 4, 0);
    w.fill(px - 4, 0, pz - 4, px + 4, h - 1, pz + 4, (x, y, z) => (y === h - 1 ? floorMat(x, z) : sub));
    w.fill(px - 1, h, pz - 1, px + 1, h + 5, pz + 1, (x, y, z) => {
      if (y === h + 5) return theme === 'video' ? M.SHELF : theme === 'mall' ? M.NEON_CYAN : M.ROOF;
      if (theme === 'video') return TAPES[Math.floor(hash2(x, y * 13 + z, 4) * TAPES.length)];
      if (theme === 'venue') return (y + z) % 3 === 0 ? M.AMPD : M.GRILLED;
      return closetWall;
    });
    collectibles.push({ kind: 'pouch', id: `${index}-pouch`, x: px + 0.5, y: h + 7.2, z: pz + 0.5 });
  }

  // ---------------------------------------------------------------- enemies & checkpoints
  const spawns: Spawn[] = [];
  for (let x = 28; x < ARX - ARR - 4; x += rng.int(8, 12)) {
    if (Math.abs(x - GX) < 11) continue;
    const kind = rng.pick(def.enemies);
    const z = pathZ(x) + rng.range(-2.5, 2.5);
    const y = top(Math.floor(x), Math.floor(z));
    spawns.push({ kind, x: x + 0.5, y: kind === 'drone' ? y + 4 : y, z });
    if (x > 60 && rng.chance(0.35)) spawns.push({ kind: 'poser', x: x + 2.5, y: top(x + 2, Math.floor(z + 1.5)), z: z + 1.5 });
  }
  const ck1z = Math.round(pathZ(14) - 3);
  const ck2x = GX + 12, ck2z = Math.round(pathZ(ck2x) + 3);
  w.fill(ck2x - 1, BASE + cliffUp, ck2z - 1, ck2x + 1, WY - 1, ck2z + 1, 0);
  const checkpoints: [number, number, number][] = [
    [14.5, top(14, ck1z), ck1z + 0.5],
    [ck2x + 0.5, top(ck2x, ck2z), ck2z + 0.5],
  ];

  return {
    world: w, start: [10.5, BASE, pathZ(10)], spawns, collectibles, checkpoints, vans, vents,
    arena: [ARX, arenaH, ARZ, ARR], gateX: GX, pathZ,
  };
}
