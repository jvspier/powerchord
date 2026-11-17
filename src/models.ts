// Voxel character & prop models, plus a shared humanoid animation rig.
import { PartBuilder, VoxelModel, makeModel } from './voxels';
import { hex, hash3, mix, Mat, mChain, mIdent, mPivot, mTrans, mRotZ, mRotX, mRotY, mMul } from './math';
import { FONT } from './font';

type ColFn = (x: number, y: number, z: number) => number;
export type HairStyle = 'grunge' | 'teased' | 'mullet' | 'slick' | 'cap' | 'visor';
export type ItemKind = 'guitar' | 'vguitar' | 'keytar' | 'briefcase' | 'skateboard' | 'joystick' | 'none';

export interface HumanoidCfg {
  skin: string;
  shoe: string;
  sole: string;
  pants: ColFn;
  top: ColFn;
  sleeve: ColFn | null; // null = bare arms
  hair: [string, string];
  hairStyle: HairStyle;
  glasses?: 'white' | 'dark' | 'visor';
  headband?: string;
  beard?: string;
  item: ItemKind;
  itemColor?: string;
  wide?: boolean; // shoulder pads / big guy
}

const C = (h: string) => hex(h);

function buildItem(kind: ItemKind, color: string): PartBuilder {
  const b = new PartBuilder();
  const body = C(color);
  if (kind === 'guitar') {
    const guard = C('#f2efe6'), pick = C('#1a1a1a'), neck = C('#7a4a22'), head = C('#3a2614'), chrome = C('#c8ccd4');
    // offset-waist body centered at origin, lying in the x/y plane
    for (let y = -2; y <= 2; y++) {
      const xa = Math.abs(y) === 2 ? -2 : -3, xb = y === 2 ? 1 : 2;
      for (let x = xa; x <= xb; x++) b.set(x, y, 0, body);
    }
    b.set(-1, 1, 1, guard).set(0, 1, 1, guard).set(-1, 0, 1, pick).set(0, -1, 1, guard).set(1, 0, 1, pick).set(-2, -1, 1, chrome);
    for (let x = 3; x <= 9; x++) b.set(x, 0, 0, neck);
    b.box(10, 0, 0, 11, 1, 0, head);
    b.set(10, 2, 0, chrome);
  } else if (kind === 'vguitar') {
    const neck = C('#2a2a2a'), stripe = C('#ffe23a'), chrome = C('#e0e0e8');
    for (let i = 0; i <= 6; i++) {
      const off = Math.round(i * 0.55);
      for (const s of [1, -1]) {
        b.set(-i, s * off, 0, i === 3 ? stripe : body);
        b.set(-i, s * off + (s > 0 ? -1 : 1) * (i > 1 ? 1 : 0), 0, body);
      }
    }
    b.set(0, 0, 0, body).set(-1, 0, 1, chrome);
    for (let x = 1; x <= 8; x++) b.set(x, 0, 0, neck);
    b.box(9, 0, 0, 10, 1, 0, body);
    b.set(11, 1, 0, body).set(11, 2, 0, stripe);
  } else if (kind === 'keytar') {
    const white = C('#f4f2ea'), black = C('#202020'), red = C('#ff2a3a');
    b.box(-6, -1, 0, 4, 0, 1, body);
    for (let x = -5; x <= 3; x++) b.set(x, 1, 0, x % 2 === 0 ? black : white).set(x, 1, 1, white);
    for (let x = 5; x <= 9; x++) b.set(x, 0, 0, black);
    b.set(9, 1, 0, red).set(-6, 0, 2, red);
  } else if (kind === 'skateboard') {
    // carried vertically: deck along y, griptape on one face, wheels at the ends
    const grip = C('#202020'), wheel = C('#f4f0a0'), truck = C('#b0b4bc');
    b.box(-1, -7, 0, 0, 2, 0, body);
    b.box(-1, -6, -1, 0, 1, -1, grip);
    for (const y of [-6, 1]) { b.set(-1, y, 1, truck).set(0, y, 1, truck).set(-2, y, 1, wheel).set(1, y, 1, wheel); }
    b.set(-1, -4, 0, C('#ffe23a')).set(0, -3, 0, C('#ffe23a'));
  } else if (kind === 'joystick') {
    // a giant arcade stick
    b.box(-3, -3, -1, 2, -1, 1, C('#1a1a1e'));
    b.box(-3, -1, -1, 2, -1, 1, body);
    b.box(-1, 0, 0, -1, 3, 0, C('#c0c0c8'));
    b.box(-2, 4, -1, 0, 5, 1, C('#e0202a'));
    b.set(1, 0, 1, C('#3af0ff')).set(1, 0, -1, C('#ffe23a'));
  } else if (kind === 'briefcase') {
    const gold = C('#e0c050'), dark = C('#3a2414');
    b.box(-2, -3, 0, 2, 0, 1, body);
    b.box(-1, 1, 0, 1, 1, 1, dark);
    b.set(0, -1, 2, gold);
  }
  return b;
}

function buildHumanoid(cfg: HumanoidCfg, scale: number): VoxelModel {
  const skin = C(cfg.skin), shoe = C(cfg.shoe), sole = C(cfg.sole);
  const [hl, hd] = [C(cfg.hair[0]), C(cfg.hair[1])];
  const hairC = (x: number, y: number, z: number) => (hash3(x, y, z, 3) < 0.35 ? hd : hl);
  const legL = new PartBuilder(), legR = new PartBuilder();
  for (const [leg, x0] of [[legL, -2], [legR, 0]] as [PartBuilder, number][]) {
    leg.box(x0, 2, -1, x0 + 1, 6, 0, cfg.pants);
    leg.box(x0, 0, -1, x0 + 1, 1, 1, (x, y, z) => (y === 0 ? sole : z === 1 && y === 1 ? sole : shoe));
  }
  const torso = new PartBuilder();
  const tw = cfg.wide ? 1 : 0;
  torso.box(-3 - tw, 7, -1, 2 + tw, 12, 1, cfg.top);
  const armL = new PartBuilder(), armR = new PartBuilder();
  for (const [arm, x0] of [[armL, -5 - tw], [armR, 3 + tw]] as [PartBuilder, number][]) {
    arm.box(x0, 8, -1, x0 + 1, 12, 0, (x, y, z) => (cfg.sleeve ? cfg.sleeve(x, y, z) : skin));
    arm.box(x0, 7, -1, x0 + 1, 7, 0, skin);
    if (cfg.wide) arm.box(x0 - 1, 12, -1, x0 + 2, 13, 1, cfg.top); // shoulder pads
  }
  const head = new PartBuilder();
  head.box(-2, 13, -1, 1, 16, 2, skin);
  // face details
  if (cfg.glasses === 'white') {
    const w = C('#f4f4f0'), k = C('#101018');
    head.set(-2, 15, 3, w).set(-1, 15, 3, k).set(0, 15, 3, k).set(1, 15, 3, w);
  } else if (cfg.glasses === 'dark') {
    const k = C('#101018');
    head.box(-2, 15, 3, 1, 15, 3, k);
  } else if (cfg.glasses === 'visor') {
    const v = C('#40f0ff');
    head.box(-3, 15, 2, 2, 15, 3, v);
  } else {
    const eye = C('#203040');
    head.set(-2, 15, 3, eye).set(1, 15, 3, eye);
  }
  head.set(-1, 14, 3, C('#b06a5a')).set(0, 14, 3, C('#b06a5a'));
  if (cfg.beard) head.box(-2, 13, 2, 1, 13, 2, C(cfg.beard)).set(-2, 14, 2, C(cfg.beard)).set(1, 14, 2, C(cfg.beard));
  switch (cfg.hairStyle) {
    case 'grunge':
      head.box(-2, 17, -1, 1, 17, 2, hairC);
      head.box(-3, 11, -1, -3, 17, 1, (x, y, z) => (y < 13 && z === 1 ? null : hairC(x, y, z)));
      head.box(2, 11, -1, 2, 17, 1, (x, y, z) => (y < 13 && z === 1 ? null : hairC(x, y, z)));
      head.box(-3, 10, -2, 2, 17, -2, (x, y, z) => (y < 11 && (x + y) % 2 === 0 ? null : hairC(x, y, z)));
      head.set(-2, 16, 3, hl).set(-1, 16, 3, hd).set(1, 16, 3, hl).set(-2, 18, 0, hl).set(0, 18, 1, hd);
      break;
    case 'teased':
      for (let x = -5; x <= 4; x++)
        for (let y = 10; y <= 22; y++)
          for (let z = -4; z <= 3; z++) {
            const dx = (x + 0.5) / 5.2, dy = (y - 16.5) / 6.2, dz = (z + 0.5) / 4.2;
            const r = dx * dx + dy * dy + dz * dz;
            if (r > 1 + (hash3(x, y, z, 9) - 0.5) * 0.5) continue;
            if (z >= 2 && y <= 16 && x >= -2 && x <= 1) continue; // face
            if (y < 13 && z > -1 && x >= -3 && x <= 2) continue; // neck/shoulders
            if (head.has(x, y, z) && !(y >= 17)) continue;
            head.set(x, y, z, hairC(x, y, z));
          }
      if (cfg.headband) head.box(-3, 16, -2, 2, 16, 3, (x, y, z) => (x > -3 && x < 2 && z < 3 && z > -2 ? null : C(cfg.headband!)));
      break;
    case 'mullet':
      head.box(-2, 17, -1, 1, 17, 2, hairC);
      head.box(-3, 15, -1, -3, 17, 1, hairC);
      head.box(2, 15, -1, 2, 17, 1, hairC);
      head.box(-3, 8, -2, 2, 17, -2, hairC);
      break;
    case 'slick':
      head.box(-2, 17, -1, 1, 17, 2, hd);
      head.box(-2, 14, -2, 1, 16, -2, hd);
      head.set(-3, 16, 0, hd).set(2, 16, 0, hd);
      break;
    case 'cap': {
      const cap = C(cfg.headband ?? '#c02a2a');
      head.box(-2, 17, -1, 1, 18, 2, cap);
      head.box(-2, 17, 3, 1, 17, 4, cap);
      head.box(-3, 14, -2, 2, 16, -2, hairC);
      break;
    }
    case 'visor':
      head.box(-2, 17, -1, 1, 17, 2, hairC);
      head.box(-3, 18, -2, 2, 19, 1, hairC);
      head.box(-3, 14, -2, 2, 17, -2, hairC);
      break;
  }
  const item = buildItem(cfg.item, cfg.itemColor ?? '#4a7ac8');
  return makeModel(scale, [
    ['legL', legL], ['legR', legR], ['torso', torso], ['armL', armL], ['armR', armR], ['head', head], ['item', item],
  ]);
}

// ----------------------------- character designs -----------------------------

/** The hero: oversized plaid flannel over a striped tee, ripped light jeans,
 *  beat-up high-top sneakers, shaggy blond hair and white sunglasses. */
export function heroModel(): VoxelModel {
  const flannelA = C('#9c2c2c'), flannelB = C('#3a1e22'), flannelC = C('#5a7a4a');
  const teeA = C('#e4dcc0'), teeB = C('#3a3a58');
  return buildHumanoid(
    {
      skin: '#eab896', shoe: '#22222a', sole: '#ecebe4',
      pants: (x, y, z) => {
        if (z === 0 && (y === 4 || y === 3) && (x === -2 || x === 1)) return y === 4 ? C('#eab896') : C('#e8eef4');
        return hash3(x, y, z, 2) < 0.2 ? C('#7f9dbd') : C('#94b2cf');
      },
      top: (x, y, z) => {
        if (z === 1 && (x === -1 || x === 0) && y >= 8) return y % 2 ? teeA : teeB; // open flannel, striped tee
        if (y === 7 && z === 1 && (x === -1 || x === 0)) return teeB;
        if (y % 3 === 0 || x % 3 === 0) return flannelB;
        return (x + y) % 5 === 0 ? flannelC : flannelA;
      },
      sleeve: (x, y) => (y % 3 === 0 ? flannelB : flannelA),
      hair: ['#e2c46a', '#b8923c'], hairStyle: 'grunge', glasses: 'white', beard: '#c49a72',
      item: 'guitar', itemColor: '#5a8ad8',
    },
    1 / 6,
  );
}

const zebra = (a: string, b: string) => (x: number, y: number, z: number) => ((x + y * 2 + z) % 4 < 2 ? C(a) : C(b));
const leopard = (x: number, y: number, z: number) => (hash3(x, y, z, 4) < 0.25 ? C('#3a2410') : C('#d8a040'));

export const POSER_VARIANTS: HumanoidCfg[] = [
  {
    skin: '#f0c0a0', shoe: '#f0f0f0', sole: '#c0c0c0', pants: zebra('#f0f0f0', '#202020'),
    top: (x, y, z) => (z === 1 && x > -2 && x < 1 ? C('#f0c0a0') : C('#2a2a2a')), sleeve: null,
    hair: ['#f0e080', '#d0b050'], hairStyle: 'teased', headband: '#ff3aa8', item: 'none',
  },
  {
    skin: '#e0b090', shoe: '#2a2a2a', sole: '#606060', pants: zebra('#ff3aa8', '#2a1a2a'),
    top: () => C('#f4f4f4'), sleeve: null,
    hair: ['#2a1a1a', '#4a2a2a'], hairStyle: 'teased', headband: '#3af0ff', item: 'none',
  },
  {
    skin: '#f0c8a8', shoe: '#c02a2a', sole: '#ffffff', pants: leopard,
    top: (x, y, z) => (z === 1 && x > -2 && x < 1 ? C('#f0c8a8') : C('#6a2a8a')), sleeve: null,
    hair: ['#c0402a', '#8a2a1a'], hairStyle: 'teased', headband: '#ffe23a', item: 'none',
  },
];

export function poserModel(variant: number) {
  return buildHumanoid(POSER_VARIANTS[variant % POSER_VARIANTS.length], 1 / 6);
}

export function roadieModel() {
  return buildHumanoid(
    {
      skin: '#d8a888', shoe: '#3a2a1a', sole: '#2a1a0a', pants: () => C('#5a5a3a'),
      top: (x, y, z) => (z === 1 && y === 10 && x > -3 && x < 2 ? C('#e0e0e0') : C('#1a1a1e')),
      sleeve: () => C('#1a1a1e'), hair: ['#4a3020', '#3a2010'], hairStyle: 'cap', headband: '#2a2a2a',
      beard: '#4a3020', item: 'none', wide: true,
    },
    1 / 6,
  );
}

export function bossModel(kind: number): VoxelModel {
  switch (kind) {
    case 0: // the A&R man: sharp suit, slick hair, briefcase full of contracts
      return buildHumanoid(
        {
          skin: '#e8c0a0', shoe: '#101010', sole: '#101010', pants: () => C('#30323a'),
          top: (x, y, z) => (z === 1 && (x === -1 || x === 0) ? (x === 0 && y < 12 ? C('#d02a2a') : C('#f4f4f4')) : C('#30323a')),
          sleeve: () => C('#30323a'), hair: ['#141418', '#2a2a30'], hairStyle: 'slick', glasses: 'dark',
          item: 'briefcase', itemColor: '#6a3a1a', wide: true,
        },
        1 / 6,
      );
    case 1: // Mullet Mountain: a giant roadie in denim with a monster mullet
      return buildHumanoid(
        {
          skin: '#d89878', shoe: '#3a2a1a', sole: '#1a1a1a', pants: () => C('#3a4a6a'),
          top: (x, y, z) => (z === 1 && x > -2 && x < 1 ? C('#d89878') : C('#5a7aa8')), sleeve: null,
          hair: ['#6a4020', '#4a2a10'], hairStyle: 'mullet', beard: '#5a3a1a', item: 'vguitar', itemColor: '#c02a2a', wide: true,
        },
        1 / 6,
      );
    case 2: // DJ Synthax: neon jumpsuit, shoulder pads, visor, keytar
      return buildHumanoid(
        {
          skin: '#c8a0e0', shoe: '#ffffff', sole: '#3af0ff', pants: () => C('#6a2ab0'),
          top: (x, y, z) => (y === 10 ? C('#3af0ff') : C('#8a3ad0')), sleeve: (x, y) => (y === 10 ? C('#3af0ff') : C('#8a3ad0')),
          hair: ['#ff3aa8', '#c02a80'], hairStyle: 'visor', glasses: 'visor', item: 'keytar', itemColor: '#f4f2ea', wide: true,
        },
        1 / 6,
      );
    case 4: // Rad Chad: neon windbreaker skate poser with a deck
      return buildHumanoid(
        {
          skin: '#f0c098', shoe: '#ffffff', sole: '#ff3aa8',
          pants: (x, y, z) => ((x + y * 2 + z) % 5 < 2 ? C('#3af0ff') : C('#2a2a48')),
          top: (x, y, z) => (y >= 11 ? C('#ff3aa8') : y >= 9 ? C('#3ad0c0') : C('#7a3ad0')),
          sleeve: (x, y) => (y >= 11 ? C('#ff3aa8') : C('#3ad0c0')),
          hair: ['#f8e070', '#e0b040'], hairStyle: 'teased', headband: '#5ad04a', glasses: 'dark',
          item: 'skateboard', itemColor: '#ff5a2a', wide: true,
        },
        1 / 6,
      );
    case 5: // Game Over Gary: reigning high-score champ with a giant arcade stick
      return buildHumanoid(
        {
          skin: '#e8b898', shoe: '#1a1a1a', sole: '#3af0ff', pants: () => C('#202028'),
          top: (x, y, z) => (z === 1 && y === 10 ? C('#3af0ff') : y === 12 ? C('#ff3aa8') : C('#141418')),
          sleeve: (x, y) => (y === 10 ? C('#3af0ff') : C('#141418')),
          hair: ['#2a1a2a', '#4a2a3a'], hairStyle: 'teased', headband: '#ff2a3a', glasses: 'visor',
          item: 'joystick', itemColor: '#f4f2ea', wide: true,
        },
        1 / 6,
      );
    default: // Rikki Spandex: the final boss
      return buildHumanoid(
        {
          skin: '#f4c8a8', shoe: '#ffffff', sole: '#d0d0d0', pants: leopard,
          top: (x, y, z) => (z === 1 && x > -3 && x < 2 ? C('#f4c8a8') : C('#1a1a1a')), sleeve: () => C('#1a1a1a'),
          hair: ['#fff090', '#e8c050'], hairStyle: 'teased', headband: '#ff3aa8', item: 'vguitar', itemColor: '#ff3aa8', wide: true,
        },
        1 / 6,
      );
  }
}

// ----------------------------- small props -----------------------------

export function droneModel(): VoxelModel {
  const keytar = buildItem('keytar', '#f4f2ea');
  const rotor = new PartBuilder();
  const m = C('#606068');
  rotor.set(0, 0, 0, m).box(-4, 1, 0, 3, 1, 0, C('#2a2a2a')).box(-1, 1, -3, 0, 1, 3, C('#2a2a2a'));
  return makeModel(1 / 6, [['body', keytar], ['rotor', rotor]]);
}

export function pickModel(color = '#ff8a20'): VoxelModel {
  const b = new PartBuilder(), c = C(color);
  b.box(-2, 1, 0, 1, 2, 0, c).box(-1, -1, 0, 0, 0, 0, c).set(-1, 2, 0, C('#ffffff'));
  return makeModel(1 / 8, [['p', b]]);
}

export function noteModel(color: string): VoxelModel {
  const b = new PartBuilder(), c = C(color);
  b.box(-2, -2, 0, -1, -1, 0, c).box(-1, 0, 0, -1, 3, 0, c).box(0, 2, 0, 1, 3, 0, c).set(1, 1, 0, c);
  return makeModel(1 / 7, [['n', b]]);
}

export function tapeModel(): VoxelModel {
  const b = new PartBuilder();
  b.box(-4, -2, 0, 3, 2, 0, C('#202024'));
  b.box(-3, 0, 1, 2, 1, 1, C('#f4f0e0'));
  b.set(-2, -1, 1, C('#808080')).set(1, -1, 1, C('#808080'));
  b.box(-3, 2, 1, 2, 2, 1, C('#ff3aa8'));
  return makeModel(1 / 7, [['t', b]]);
}

export function pouchModel(): VoxelModel {
  const b = new PartBuilder();
  b.box(-2, -2, 0, 2, 2, 1, C('#7a4a2a'));
  b.box(-2, 2, 0, 2, 3, 1, C('#5a3018'));
  b.box(-1, -1, 2, 0, 0, 2, C('#ff8a20')).set(-1, 1, 2, C('#ff8a20')).set(0, 1, 2, C('#ff8a20'));
  return makeModel(1 / 7, [['p', b]]);
}

export function heartModel(): VoxelModel {
  const b = new PartBuilder(), c = C('#ff3a4a');
  const rows = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];
  rows.forEach((r, i) => [...r].forEach((ch, x) => ch === '#' && b.set(x - 3, 5 - i, 0, c)));
  b.set(-2, 4, 1, C('#ffc0c0'));
  return makeModel(1 / 9, [['h', b]]);
}

export function micStandModel(lit: boolean): VoxelModel {
  const b = new PartBuilder();
  const metal = C('#9a9aa4');
  b.box(-2, 0, -2, 1, 0, 1, C('#2a2a2a'));
  b.box(0, 1, 0, 0, 14, 0, metal);
  b.box(0, 14, 1, 0, 14, 3, metal);
  b.box(0, 14, 4, 0, 16, 5, lit ? C('#ffe23a') : C('#404048'));
  return makeModel(1 / 6, [['m', b]]);
}

// ----------------------------- animation rig -----------------------------

export interface AnimState {
  t: number; // time
  walk: number; // walk phase
  walkAmt: number; // 0..1
  air: boolean;
  act: number; // action progress 0..1, <0 none
  actKind: 'smash' | 'throw' | 'chord' | 'slam' | 'none';
  hurt: number;
  headbang?: boolean;
  item: ItemKind;
}

const scratch: Mat[] = [];
export function poseHumanoid(a: AnimState): Mat[] {
  const out = scratch;
  const sw = Math.sin(a.walk) * 0.75 * a.walkAmt;
  let legL = a.air ? -0.7 : sw, legR = a.air ? 0.35 : -sw;
  let lean = -0.08 * a.walkAmt + a.hurt * 0.35;
  let bob = a.air ? 0 : Math.abs(Math.cos(a.walk)) * 0.5 * a.walkAmt + Math.sin(a.t * 2.2) * 0.12;
  let headRx = a.headbang ? Math.max(0, Math.sin(a.t * 12)) * 0.6 : 0;
  const playing = a.item === 'guitar' || a.item === 'vguitar' || a.item === 'keytar';
  let armL = playing ? -0.9 : -sw * 0.8, armR = playing ? -0.55 : sw * 0.8;
  let armLz = playing ? -0.35 : 0, armRz = playing ? 0.4 : 0;
  let swing = 0; // guitar swing about the shoulders
  let strum = 0;
  if (a.act >= 0) {
    const p = a.act;
    if (a.actKind === 'smash' || a.actKind === 'slam') {
      swing = p < 0.35 ? -2.7 * (p / 0.35) : -2.7 + 3.4 * Math.min(1, (p - 0.35) / 0.25);
      if (p > 0.75) swing *= 1 - (p - 0.75) / 0.25;
      armL = armR = swing - 0.5;
      armLz = armRz = 0;
      lean += p < 0.35 ? -0.25 * (p / 0.35) : 0.3;
    } else if (a.actKind === 'throw') {
      armR = p < 0.3 ? 1.0 * (p / 0.3) : 1.0 - 2.8 * Math.min(1, (p - 0.3) / 0.3);
      armRz = 0;
    } else if (a.actKind === 'chord') {
      lean -= 0.35 * Math.sin(Math.min(1, p * 2) * Math.PI * 0.5);
      headRx = -0.4;
      strum = Math.sin(p * 40) * 0.5;
      swing = -0.5;
      legL = 0.35; legR = -0.35;
    }
  }
  if (a.air) lean += 0.1;
  const upper = mChain(mTrans(0, bob, 0), mPivot(0, 7, 0, lean));
  out[0] = mMul(mTrans(0, bob * 0.3, 0), mPivot(0, 7, 0, legL));
  out[1] = mMul(mTrans(0, bob * 0.3, 0), mPivot(0, 7, 0, legR));
  out[2] = upper;
  out[3] = mMul(upper, mPivot(-4, 12.5, 0, armL, 0, armLz));
  out[4] = mMul(upper, mPivot(4, 12.5, 0, armR + strum, 0, armRz));
  out[5] = mMul(upper, mPivot(0, 13, 0.5, headRx));
  if (a.item === 'briefcase' || a.item === 'skateboard' || a.item === 'joystick') {
    out[6] = mMul(out[4], mTrans(4, 6, 0));
  } else if (playing) {
    const rest = mChain(mTrans(-0.5, 9.5, 2.6), mRotZ(0.4), mRotY(0.15));
    out[6] = mChain(upper, mPivot(0, 12, 0.5, swing), rest);
  } else {
    out[6] = mIdent();
  }
  return out;
}

export const _unused = mRotX;

/** Extruded voxel text built from the 3x5 pixel font (2 voxels deep). */
export function textModel(str: string, top: string, bottom: string): { model: VoxelModel; width: number } {
  const b = new PartBuilder();
  const ct = hex(top), cbm = hex(bottom), side = hex('#3a0a2a');
  let x = 0;
  for (const ch of str) {
    const g = FONT[ch];
    if (g) {
      for (let r = 0; r < 5; r++)
        for (let k = 0; k < 3; k++)
          if (g[r][k] === '#') {
            const y = 4 - r;
            const c = mix(cbm, ct, y / 4);
            b.set(x + k, y, -2, c).set(x + k, y, -1, side).set(x + k, y, 0, side);
          }
    }
    x += 4;
  }
  return { model: makeModel(1, [['t', b]]), width: x - 1 };
}
