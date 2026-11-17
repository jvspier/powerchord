// Game state, gameplay, AI and HUD.
import { Renderer, W, H, FLAG_XRAY, FLAG_SHADOW, FLAG_FLASH } from './renderer';
import { Input } from './input';
import { Audio, SONGS, BOSS_SONG } from './audio';
import { CameraRig } from './camera';
import { VoxelWorld, VoxelModel, MATS, PartBuilder, makeModel, Chunk } from './voxels';
import { WORLDS, WorldDef, generateWorld, GenResult, Ability, EnemyKind } from './worlds';
import { Actor, drawModel } from './entities';
import {
  heroModel, poserModel, roadieModel, droneModel, bossModel, pickModel, noteModel, tapeModel, pouchModel,
  heartModel, micStandModel, poseHumanoid, textModel, ItemKind, HERO_RIG,
} from './models';
import { clamp, lerp, angleLerp, hex, mix, mIdent, mRotX, mRotY, mRotZ, mPivot, mChain, mTrans, mScale, wrapAngle, TAU } from './math';

type State = 'title' | 'play' | 'dialog' | 'map' | 'pause' | 'victory' | 'dead';

interface Save {
  abilities: Ability[];
  unlocked: number;
  beaten: number[];
  collected: string[];
  maxHp: number;
  maxPicks: number;
  seed: number;
}
const SAVE_KEY = 'powerchord-save-v1';
const freshSave = (): Save => ({ abilities: [], unlocked: 0, beaten: [], collected: [], maxHp: 5, maxPicks: 5, seed: Math.floor(Math.random() * 1e6) });

class Player extends Actor {
  picks = 5;
  maxPicks = 5;
  feedback = 100;
  coyote = 0;
  jumpBuf = 0;
  usedDive = false;
  jumpCut = false;
  dashT = 0;
  dashCd = 0;
  airDashUsed = false;
  dashX = 0;
  dashZ = 1;
  actT = -1;
  actDur = 0;
  actKind: 'smash' | 'throw' | 'chord' | 'finisher' | 'none' = 'none';
  actHit = false;
  charging = false;
  chargeT = 0;
  chargeReady = false;
  invuln = 0;
  blinkT = 0;
  pickRegen = 0;
  safe: [number, number, number] = [0, 0, 0];
}

type BossAttack = 'spread' | 'charge' | 'slam' | 'ring' | 'summon' | 'teleport';
const BOSS_PATTERNS: BossAttack[][] = [
  ['spread', 'charge', 'spread', 'summon', 'charge'],
  ['slam', 'charge', 'slam', 'spread'],
  ['ring', 'teleport', 'spread', 'summon', 'ring', 'teleport'],
  ['spread', 'charge', 'slam', 'ring', 'summon', 'slam'],
  ['charge', 'slam', 'charge', 'spread', 'slam'],
  ['ring', 'summon', 'spread', 'teleport', 'ring', 'spread'],
];
const BOSS_HP = [40, 52, 58, 90, 48, 62];
const BOSS_SCALE = [1.55, 2.2, 1.6, 1.9, 1.6, 1.7];
const BOSS_PROJ = ['#f4f4f4', '#ff8a20', '#3af0ff', '#ff3aa8', '#a0ff40', '#ffe23a'];
const BOSS_ITEM: ItemKind[] = ['briefcase', 'vguitar', 'keytar', 'vguitar', 'skateboard', 'joystick'];

class Enemy extends Actor {
  kind: EnemyKind | 'boss' = 'poser';
  state = 'idle';
  timer = 0;
  cd = 0;
  boss = -1;
  atk = 0;
  aggro = false;
  flying = false;
  contact = 1;
  dirX = 0;
  dirZ = 0;
  variant = 0;
}

interface Projectile {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; dmg: number; friendly: boolean; model: VoxelModel; spin: number; r: number;
}
interface Particle {
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  life: number; max: number; col: number; size: number; g: number;
}
interface Wave { x: number; y: number; z: number; r: number; maxR: number; speed: number; friendly: boolean; hit: boolean; col: number; }
interface Pickup { kind: 'tape' | 'pouch' | 'heart'; id: string; x: number; y: number; z: number; t: number; }
interface Checkpoint { x: number; y: number; z: number; lit: boolean; }
interface Dialog { name: string; lines: string[]; i: number; t: number; done: () => void; }

const HEART = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];
const PICK = ['####', '####', '.##.', '.##.', '..#.'];

export class Game {
  r: Renderer;
  input: Input;
  audio = new Audio();
  cam = new CameraRig();
  state: State = 'title';
  save: Save;
  hasSave = false;

  idx = 0;
  def!: WorldDef;
  gen!: GenResult;
  world!: VoxelWorld;
  player!: Player;
  enemies: Enemy[] = [];
  projectiles: Projectile[] = [];
  particles: Particle[] = [];
  waves: Wave[] = [];
  pickups: Pickup[] = [];
  checkpoints: Checkpoint[] = [];
  weather: Particle[] = [];
  respawn: [number, number, number] = [0, 0, 0];
  boss: Enemy | null = null;
  bossActive = false;

  messages: { text: string; t: number; col: number }[] = [];
  prompt = '';
  dialog: Dialog | null = null;
  time = 0;
  mapSel = 0;
  titleT = 0;
  deadT = 0;
  victoryT = 0;
  hitstop = 0;
  flash = 0;
  slowmo = 0;
  slowFactor = 0.35;
  showFps = false;
  fps = 60;
  finalWon = false;
  gateHintT = 0;

  m = {
    hero: heroModel(),
    posers: [poserModel(0), poserModel(1), poserModel(2)],
    roadie: roadieModel(),
    drone: droneModel(),
    bosses: [bossModel(0), bossModel(1), bossModel(2), bossModel(3), bossModel(4), bossModel(5)],
    pick: pickModel(),
    notes: BOSS_PROJ.map((c) => noteModel(c)),
    droneNote: noteModel('#b45aff'),
    tape: tapeModel(),
    pouch: pouchModel(),
    heart: heartModel(),
    micOff: micStandModel(false),
    micOn: micStandModel(true),
    title: textModel('POWER CHORD', '#ffe23a', '#ff3aa8'),
    contract: (() => {
      const b = new PartBuilder();
      b.box(-2, -3, 0, 2, 3, 0, hex('#f4f4ec'));
      for (let y = -2; y <= 2; y += 2) b.box(-1, y, 1, 1, y, 1, hex('#404040'));
      b.set(1, -2, 1, hex('#c02a2a'));
      return makeModel(1 / 8, [['c', b]]);
    })(),
  };

  constructor(canvas: HTMLCanvasElement) {
    this.r = new Renderer(canvas);
    this.input = new Input(canvas);
    let s: Save | null = null;
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) s = { ...freshSave(), ...JSON.parse(raw) };
    } catch {
      s = null;
    }
    this.hasSave = !!s;
    this.save = s ?? freshSave();
    if (s) this.persist(); // pins the run seed for saves made before seeds existed
    this.loadWorld(0, true);
  }

  persist() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.save));
      this.hasSave = true;
    } catch {
      /* storage unavailable */
    }
  }
  has(a: Ability) {
    return this.save.abilities.includes(a);
  }

  // ------------------------------------------------------------------ world
  loadWorld(i: number, quiet = false) {
    this.idx = i;
    this.def = WORLDS[i];
    this.gen = generateWorld(i, this.save.seed);
    this.world = this.gen.world;
    this.world.rebuild(this.def.light, true);
    const r = this.r;
    r.skyTop = this.def.skyTop;
    r.skyBot = this.def.skyBot;
    r.fogColor = this.def.fog;
    r.stars = this.def.stars;
    r.silhouetteColor = mix(this.def.fog, 0xff000000, 0.55);

    const p = new Player(this.m.hero, 'guitar');
    p.maxHp = this.save.maxHp;
    p.hp = p.maxHp;
    p.maxPicks = this.save.maxPicks;
    p.picks = p.maxPicks;
    [p.x, p.y, p.z] = this.gen.start;
    p.yaw = Math.PI / 2;
    p.safe = [p.x, p.y, p.z];
    this.player = p;
    this.respawn = [p.x, p.y, p.z];
    this.cam.snapTo(p.x, p.y + 1.4, p.z);
    if (this.state !== 'title') { this.cam.cine = 0; this.cam.focus = null; this.cam.mode = 0; this.cam.yawTarget = this.cam.isoYaw; }
    this.projectiles = [];
    this.particles = [];
    this.waves = [];
    this.pickups = this.gen.collectibles
      .filter((c) => !this.save.collected.includes(c.id))
      .map((c) => ({ kind: c.kind, id: c.id, x: c.x, y: c.y, z: c.z, t: 0 }));
    this.checkpoints = this.gen.checkpoints.map(([x, y, z]) => ({ x, y, z, lit: false }));
    this.spawnEnemies();
    this.initWeather();
    if (!quiet) {
      this.audio.playSong(SONGS[i]);
      this.msg(`${this.def.name}`, 3.5, hex('#ffe23a'));
      this.msg(this.def.subtitle, 3.5);
    }
  }

  spawnEnemies() {
    this.enemies = [];
    this.boss = null;
    this.bossActive = false;
    for (const s of this.gen.spawns) this.enemies.push(this.makeEnemy(s.kind, s.x, s.y, s.z));
    if (!this.save.beaten.includes(this.idx)) {
      const [ax, ay, az] = this.gen.arena;
      const b = new Enemy(this.m.bosses[this.def.boss], BOSS_ITEM[this.def.boss]);
      b.kind = 'boss';
      b.boss = this.def.boss;
      b.scale = BOSS_SCALE[b.boss];
      b.r = 0.42 * b.scale;
      b.h = 2.9 * b.scale;
      b.hp = b.maxHp = BOSS_HP[b.boss];
      b.x = ax + 6; b.y = ay; b.z = az;
      b.yaw = -Math.PI / 2;
      b.flying = b.boss === 2;
      b.canStep = true;
      b.state = 'idle';
      this.enemies.push(b);
      this.boss = b;
    }
  }

  makeEnemy(kind: EnemyKind, x: number, y: number, z: number): Enemy {
    let e: Enemy;
    if (kind === 'poser') {
      const v = Math.floor(Math.random() * 3);
      e = new Enemy(this.m.posers[v], 'none');
      e.variant = v;
      e.hp = e.maxHp = 3;
    } else if (kind === 'roadie') {
      e = new Enemy(this.m.roadie, 'none');
      e.scale = 1.3;
      e.r = 0.5;
      e.h = 3.7;
      e.hp = e.maxHp = 7;
    } else {
      e = new Enemy(this.m.drone, 'none');
      e.flying = true;
      e.h = 0.8;
      e.r = 0.6;
      e.hp = e.maxHp = 2;
      e.canStep = false;
    }
    e.kind = kind;
    e.x = x; e.y = y; e.z = z;
    e.yaw = Math.random() * TAU;
    e.cd = 1 + Math.random() * 2;
    return e;
  }

  initWeather() {
    this.weather = [];
    const n = this.def.weather === 'rain' ? 260 : 70;
    for (let i = 0; i < n; i++) this.weather.push(this.newWeather(true));
  }
  newWeather(anywhere: boolean): Particle {
    const c = this.cam;
    const x = c.tx + (Math.random() - 0.5) * 44, z = c.tz + (Math.random() - 0.5) * 44;
    const y = anywhere ? c.ty - 8 + Math.random() * 28 : c.ty + 18 + Math.random() * 4;
    switch (this.def.weather) {
      case 'rain':
        return { x, y, z, vx: -2, vy: -26 - Math.random() * 6, vz: 1, life: 9, max: 9, col: hex('#b8c8e0'), size: 0.08, g: 0 };
      case 'dust':
        return { x, y: c.ty + Math.random() * 8 - 2, z, vx: 0.2, vy: 0.05, vz: 0.15, life: 6 + Math.random() * 6, max: 12, col: hex('#a8a090'), size: 0.06, g: 0 };
      case 'neon':
        return { x, y: c.ty + Math.random() * 12 - 2, z, vx: 0, vy: 0.5, vz: 0, life: 4 + Math.random() * 6, max: 10, col: Math.random() < 0.5 ? hex('#ff3aa8') : hex('#3af0ff'), size: 0.08, g: 0 };
      default: {
        const cols = ['#ff3aa8', '#3af0ff', '#ffe23a', '#b45aff', '#ffffff'];
        return { x, y: anywhere ? c.ty + Math.random() * 14 - 2 : c.ty + 14, z, vx: (Math.random() - 0.5), vy: -1.5 - Math.random(), vz: (Math.random() - 0.5), life: 10, max: 10, col: hex(cols[Math.floor(Math.random() * cols.length)]), size: 0.1, g: 0 };
      }
    }
  }

  msg(text: string, t = 3, col = 0xffffffff) {
    this.messages.push({ text, t, col });
    if (this.messages.length > 4) this.messages.shift();
  }

  // ------------------------------------------------------------------ main update
  update(dt: number) {
    this.time += dt;
    const inp = this.input;
    inp.pollPad();
    if (inp.pressed('Backquote')) this.showFps = !this.showFps;
    if (inp.pressed('KeyM')) {
      this.audio.init();
      this.audio.toggleMusic();
      this.msg(this.audio.musicOn ? 'MUSIC ON' : 'MUSIC OFF', 1.5);
    }
    for (const m of this.messages) m.t -= dt;
    this.messages = this.messages.filter((m) => m.t > 0);
    this.flash = Math.max(0, this.flash - dt * 2.5);

    switch (this.state) {
      case 'title':
        this.updateTitle(dt);
        break;
      case 'play':
        if (inp.pressed('Escape', 'KeyP')) {
          this.state = 'pause';
          break;
        }
        if (this.hitstop > 0) {
          this.hitstop -= dt;
          this.updateCamera(dt);
          break;
        }
        if (this.slowmo > 0) {
          this.slowmo -= dt;
          dt *= this.slowFactor;
        }
        this.updatePlay(dt);
        break;
      case 'dialog': {
        const d = this.dialog!;
        d.t += dt;
        if (inp.pressed('Enter', 'Space', 'KeyJ', 'NumpadEnter')) {
          const full = d.t * 40 >= d.lines[d.i].length;
          if (!full) d.t = 99;
          else if (++d.i >= d.lines.length) {
            this.dialog = null;
            this.state = 'play';
            d.done();
          } else d.t = 0;
          this.audio.sfx('select');
        }
        this.updateCamera(dt);
        this.updateParticles(dt);
        break;
      }
      case 'map':
        this.updateMap();
        this.updateCamera(dt);
        break;
      case 'pause':
        if (inp.pressed('Escape', 'KeyP', 'Enter')) this.state = 'play';
        break;
      case 'dead':
        this.deadT += dt;
        this.updateParticles(dt);
        this.updateCamera(dt);
        if (this.deadT > 2.2) this.doRespawn();
        break;
      case 'victory':
        this.victoryT += dt;
        this.updateParticles(dt);
        this.cam.isoYaw += dt * 0.2;
        this.cam.yawTarget = this.cam.isoYaw;
        this.updateCamera(dt);
        if (this.victoryT > 3 && inp.pressed('Enter')) {
          this.state = 'title';
          this.titleT = 0;
          this.loadWorld(0, true);
          this.audio.playSong(null);
        }
        break;
    }
    this.updateWeather(dt);
    this.input.endFrame();
  }

  updateTitle(dt: number) {
    this.titleT += dt;
    const p = this.player;
    // demo camera: drift along the street and morph between views
    const x = 12 + ((this.titleT * 3) % 120);
    p.x = x;
    p.z = this.gen.pathZ(x);
    p.y = this.world.heightAt(p.x, p.z);
    p.yaw = Math.PI / 2;
    p.anim.walk += dt * 8;
    p.anim.walkAmt = 0.8;
    p.anim.t += dt;
    const want = Math.floor(this.titleT / 5) % 2 === 1 ? 1 : 0;
    if (this.cam.mode !== want) this.cam.toggle();
    if (this.cam.mode === 0 && Math.floor(this.titleT / 5) % 4 === 0) { this.cam.isoYaw += dt * 0.25; this.cam.yawTarget = this.cam.isoYaw; }
    this.cam.update(dt, p.x, p.y, p.z, this.world, null);
    const inp = this.input;
    if (inp.pressed('Enter', 'Space', 'NumpadEnter', 'Mouse0')) {
      this.audio.init();
      this.startGame(false);
    } else if (inp.pressed('KeyN') && this.hasSave) {
      this.audio.init();
      this.startGame(true);
    }
  }

  startGame(fresh: boolean) {
    if (fresh) {
      this.save = freshSave();
      this.persist();
    }
    this.state = 'play';
    this.cam.cine = 0;
    this.cam.focus = null;
    this.cam.mode = 0;
    this.cam.yawTarget = this.cam.isoYaw = Math.PI / 4;
    const start = fresh ? 0 : this.save.unlocked;
    this.loadWorld(Math.min(start, WORLDS.length - 1));
    if (this.save.beaten.length === 0) {
      this.msg('WASD MOVE  SPACE JUMP  J SMASH  K PICKS', 7);
      this.msg('HOLD J AFTER A SMASH TO CHARGE A FINISHER   Q/E: ROTATE VIEW', 7);
    }
  }

  // ------------------------------------------------------------------ gameplay
  updatePlay(dt: number) {
    const p = this.player;
    this.prompt = '';
    this.controlPlayer(dt);
    for (const e of this.enemies) this.updateEnemy(e, dt);
    this.enemies = this.enemies.filter((e) => !e.dead);
    this.updateProjectiles(dt);
    this.updateWaves(dt);
    this.updateParticles(dt);
    this.updatePickups(dt);
    this.updateWorldInteractions(dt);
    this.world.rebuild(this.def.light);
    this.updateCamera(dt);
    if (p.hp <= 0 && this.state === 'play') {
      this.state = 'dead';
      this.deadT = 0;
      this.audio.sfx('die');
      this.burst(p.x, p.y + 1.5, p.z, [hex('#9c2c2c'), hex('#e2c46a'), hex('#94b2cf')], 40, 8);
    }
  }

  updateCamera(dt: number) {
    const inp = this.input, c = this.cam, p = this.player;
    if (this.state === 'play') {
      if (inp.pressed('KeyQ')) c.rotateStep(-1);
      if (inp.pressed('KeyE')) c.rotateStep(1);
    }
    c.update(dt, p.x, p.y + p.stepOffset, p.z, this.world, null);
  }

  controlPlayer(dt: number) {
    const p = this.player, inp = this.input, w = this.world;
    const ix = (inp.held('KeyD', 'ArrowRight') ? 1 : 0) - (inp.held('KeyA', 'ArrowLeft') ? 1 : 0);
    const iy = (inp.held('KeyW', 'ArrowUp') ? 1 : 0) - (inp.held('KeyS', 'ArrowDown') ? 1 : 0);
    const cy = this.cam.isoYaw;
    const jx = ix + inp.padX, jy = iy + inp.padY;
    let mx = Math.sin(cy) * jy + Math.cos(cy) * jx;
    let mz = Math.cos(cy) * jy - Math.sin(cy) * jx;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }

    p.invuln = Math.max(0, p.invuln - dt);
    p.blinkT = Math.max(0, p.blinkT - dt);
    p.dashCd = Math.max(0, p.dashCd - dt);
    p.coyote = p.onGround ? 0.1 : Math.max(0, p.coyote - dt);
    p.jumpBuf = inp.pressed('Space') ? 0.13 : Math.max(0, p.jumpBuf - dt);
    if (p.onGround) { p.usedDive = false; p.airDashUsed = false; }
    p.feedback = Math.min(100, p.feedback + dt * 5);
    if (p.picks < p.maxPicks) {
      p.pickRegen += dt;
      if (p.pickRegen > 1.1) { p.picks++; p.pickRegen = 0; }
    }

    // --- actions
    const busy = p.actT >= 0 || p.charging;
    if (!busy && inp.pressed('KeyJ', 'Mouse0')) this.startAct('smash', 0.42);
    else if (!busy && inp.pressed('KeyK', 'Mouse2')) {
      if (p.picks > 0) this.startAct('throw', 0.25);
    } else if (!busy && inp.pressed('KeyL', 'KeyR')) {
      if (!this.has('chord')) this.msg("YOU DON'T KNOW THAT CHORD YET", 1.5);
      else if (p.feedback < this.chordCost()) this.msg('NEED MORE FEEDBACK!', 1.2, hex('#ffe23a'));
      else {
        this.startAct('chord', 1.0);
        // cinematic hero shot: swoop to a low 3/4 front view in slow motion
        const b = p.yaw + Math.PI;
        this.cam.startCinematic(this.bestCineYaw([b + 0.6, b - 0.6, b + 1.2, b - 1.2, p.yaw + 0.6], p.x, p.y + 2.5, p.z, 7.5, 0.22), 0.85, null, 7.5, 0.22);
        this.slowmo = 0.95;
        this.slowFactor = 0.5;
        p.invuln = Math.max(p.invuln, 1.2);
      }
    }
    if (inp.pressed('ShiftLeft', 'ShiftRight') && this.has('dash') && p.dashCd <= 0 && (p.onGround || !p.airDashUsed)) {
      p.dashT = 0.22;
      p.dashCd = 0.55;
      if (!p.onGround) p.airDashUsed = true;
      const l = Math.hypot(mx, mz);
      p.dashX = l > 0.1 ? mx / l : Math.sin(p.yaw);
      p.dashZ = l > 0.1 ? mz / l : Math.cos(p.yaw);
      p.invuln = Math.max(p.invuln, 0.25);
      this.audio.sfx('dash');
    }
    if (p.actT >= 0) {
      p.actT += dt;
      const prog = p.actT / p.actDur;
      if (!p.actHit) {
        if (p.actKind === 'smash' && prog > 0.45) { p.actHit = true; this.doSmash(); }
        if (p.actKind === 'throw' && prog > 0.4) { p.actHit = true; this.throwPick(); }
        if (p.actKind === 'chord' && prog > 0.42) { p.actHit = true; this.doChord(); }
      }
      if (p.actKind === 'finisher' && !p.actHit && prog > 0.4 && !p.onGround) p.vy = Math.min(p.vy, -26);
      if (p.actKind === 'finisher' && !p.actHit && prog > 0.42 && (p.onGround || prog > 0.6)) { p.actHit = true; this.doFinisher(); }
      if (prog >= 1) {
        // keep holding the smash button to charge a finisher
        if (p.actKind === 'smash' && inp.held('KeyJ', 'Mouse0')) {
          p.charging = true; p.chargeT = 0; p.chargeReady = false;
          this.audio.sfx('charge');
        }
        p.actT = -1; p.actKind = 'none';
      }
    }
    if (p.charging) {
      if (inp.held('KeyJ', 'Mouse0')) {
        p.chargeT += dt;
        const a = Math.random() * TAU;
        const gx = p.x - Math.sin(p.yaw) * 0.3, gz = p.z - Math.cos(p.yaw) * 0.3;
        this.particles.push({
          x: gx + Math.cos(a) * 1.2, y: p.y + 4 + Math.sin(a) * 0.8, z: gz + Math.sin(a) * 1.2,
          vx: -Math.cos(a) * 3, vy: -Math.sin(a) * 2, vz: -Math.sin(a) * 3, life: 0.25, max: 0.25,
          col: p.chargeReady ? hex('#ffe23a') : hex('#93cfdc'), size: 0.12, g: 0,
        });
        if (!p.chargeReady && p.chargeT > 0.6) {
          p.chargeReady = true;
          p.flashT = 0.08;
          this.audio.sfx('ready');
        }
      } else {
        p.charging = false;
        if (p.chargeReady) {
          if (p.feedback < 25) this.msg('NEED MORE FEEDBACK!', 1.2, hex('#ffe23a'));
          else this.startFinisher();
        }
      }
    }

    // --- movement
    const speed = p.inLiquid ? 4.5 : 8;
    let slow = p.actKind === 'smash' ? 0.35 : p.actKind === 'chord' ? 0.1 : p.actKind === 'finisher' ? 0.6 : p.charging ? 0.3 : 1;
    if (p.dashT > 0) {
      p.dashT -= dt;
      p.vx = p.dashX * 24;
      p.vz = p.dashZ * 24;
      p.vy = 0;
      if (Math.random() < 0.8) this.spark(p.x, p.y + 1.2, p.z, hex('#e8e8ff'), 0.3);
    } else {
      const acc = p.onGround ? 14 : 5;
      p.vx = lerp(p.vx, mx * speed * slow, clamp(dt * acc, 0, 1));
      p.vz = lerp(p.vz, mz * speed * slow, clamp(dt * acc, 0, 1));
    }
    if (ml > 0.1 && p.actKind !== 'chord') p.yaw = angleLerp(p.yaw, Math.atan2(mx, mz), clamp(dt * 14, 0, 1));

    // --- jumping
    if (p.jumpBuf > 0 && p.dashT <= 0) {
      if (p.onGround || p.coyote > 0) {
        p.vy = 16;
        p.onGround = false;
        p.coyote = 0;
        p.jumpBuf = 0;
        p.jumpCut = false;
        this.audio.sfx('jump');
      } else if (this.has('dive') && !p.usedDive) {
        p.vy = 16;
        p.usedDive = true;
        p.jumpBuf = 0;
        p.jumpCut = false;
        this.audio.sfx('dive');
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * TAU;
          this.particles.push({ x: p.x, y: p.y + 0.2, z: p.z, vx: Math.cos(a) * 5, vy: -1, vz: Math.sin(a) * 5, life: 0.4, max: 0.4, col: hex('#ffffff'), size: 0.12, g: 0 });
        }
      }
    }
    if (!inp.held('Space') && p.vy > 4 && !p.jumpCut) { p.vy *= 0.5; p.jumpCut = true; }

    const wasAir = !p.onGround, fallV = p.vy;
    p.physics(w, dt, p.dashT <= 0);
    if (wasAir && p.onGround && fallV < -10) {
      const gc = MATS[w.get(Math.floor(p.x), Math.floor(p.y - 0.5), Math.floor(p.z))].color;
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU;
        this.particles.push({ x: p.x + Math.cos(a) * 0.4, y: p.y + 0.1, z: p.z + Math.sin(a) * 0.4, vx: Math.cos(a) * 3, vy: 1.5, vz: Math.sin(a) * 3, life: 0.35, max: 0.35, col: mix(gc, 0xffffffff, 0.3), size: 0.14, g: 6 });
      }
    }
    if (p.onGround && Math.hypot(p.vx, p.vz) > 6 && Math.random() < dt * 8) {
      this.particles.push({ x: p.x, y: p.y + 0.05, z: p.z, vx: -p.vx * 0.05, vy: 1, vz: -p.vz * 0.05, life: 0.3, max: 0.3, col: hex('#c8c8c0'), size: 0.1, g: 2 });
    }

    // hazards & falling
    if (p.onHazard) {
      this.hurtPlayer(1, p.x - Math.sin(p.yaw), p.z - Math.cos(p.yaw));
      p.vy = 15;
      for (let i = 0; i < 10; i++) this.spark(p.x, p.y, p.z, hex('#ff8a20'), 1);
    }
    if (p.y < -4) {
      [p.x, p.y, p.z] = p.safe;
      p.vx = p.vy = p.vz = 0;
      if (p.invuln <= 0) this.hurtPlayer(1, p.x, p.z, true);
      this.cam.snapTo(p.x, p.y + 1.4, p.z);
    }
    if (p.onGround && !p.onHazard) {
      const solidUnder = [[-p.r, -p.r], [p.r, -p.r], [-p.r, p.r], [p.r, p.r]].every(([ox, oz]) => w.solidAt(Math.floor(p.x + ox), Math.floor(p.y - 0.5), Math.floor(p.z + oz)));
      if (solidUnder) p.safe = [p.x, p.y, p.z];
    }

    // animation
    const hs = Math.hypot(p.vx, p.vz);
    p.anim.t += dt;
    p.anim.walk += hs * dt * 1.5;
    p.anim.walkAmt = lerp(p.anim.walkAmt, clamp(hs / 8, 0, 1), clamp(dt * 10, 0, 1));
    p.anim.air = !p.onGround;
    p.anim.act = p.charging ? 0.5 : p.actT >= 0 ? p.actT / p.actDur : -1;
    p.anim.actKind = p.charging ? 'charge' : p.actKind;
    p.anim.hurt = p.invuln > 0.7 ? 1 : 0;
  }

  startAct(kind: 'smash' | 'throw' | 'chord' | 'finisher', dur: number) {
    const p = this.player;
    p.actKind = kind;
    p.actT = 0;
    p.actDur = dur;
    p.actHit = false;
    if (kind === 'smash') this.audio.sfx('jump');
  }

  /** Of several candidate cinematic headings, pick the one with the clearest view of `focus`. */
  bestCineYaw(cands: number[], fx: number, fy: number, fz: number, dist: number, pitch: number) {
    let best = cands[0], bestFree = -1;
    for (const yaw of cands) {
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const dx = -Math.sin(yaw) * cp, dy = sp, dz = -Math.cos(yaw) * cp;
      let free = dist;
      for (let d = 0.8; d < dist; d += 0.3) {
        const x = Math.floor(fx + dx * d), y = Math.floor(fy + dy * d), z = Math.floor(fz + dz * d);
        if (this.world.inside(x, y, z) && this.world.solidAt(x, y, z)) { free = d; break; }
      }
      if (free > bestFree + 0.5) { best = yaw; bestFree = free; }
      if (free >= dist) break;
    }
    return best;
  }

  /** Guitar-smash finisher: leap, swoop the camera to a low hero shot, slam. */
  startFinisher() {
    const p = this.player;
    p.feedback -= 25;
    this.startAct('finisher', 1.05);
    p.vy = 12;
    p.onGround = false;
    p.invuln = Math.max(p.invuln, 1.4);
    const b = p.yaw + Math.PI;
    const yaw = this.bestCineYaw([b + 0.9, b - 0.9, b + 0.4, b - 0.4, p.yaw + 0.8, p.yaw - 0.8], p.x, p.y + 2.5, p.z, 8, 0.2);
    this.cam.startCinematic(yaw, 0.9, null, 8, 0.2);
    this.slowmo = 1.0;
    this.slowFactor = 0.5;
    this.audio.sfx('dive');
  }

  doFinisher() {
    const p = this.player;
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    const cx = p.x + fx * 1.4, cz = p.z + fz * 1.4;
    const RAD = 5.5;
    this.audio.sfx('smash');
    this.audio.powerChord(41.2, 1.4, 0.6);
    this.cam.shake = 2.2;
    this.flash = 0.5;
    this.hitstop = 0.09;
    this.waves.push({ x: cx, y: p.y + 0.1, z: cz, r: 0.3, maxR: RAD + 0.5, speed: 18, friendly: true, hit: false, col: hex('#ff8a20') });
    this.waves.push({ x: cx, y: p.y + 0.6, z: cz, r: 0.2, maxR: RAD, speed: 13, friendly: true, hit: false, col: hex('#93cfdc') });
    for (const e of this.enemies) {
      if (e.kind === 'boss' && !this.bossActive) continue;
      const d = Math.hypot(e.x - cx, e.z - cz);
      if (d < RAD + e.r && Math.abs(e.y - p.y) < 4) {
        this.damageEnemy(e, 6, (e.x - cx) / (d || 1), (e.z - cz) / (d || 1), 18);
        if (e.kind !== 'boss' && !e.flying) e.vy = 13;
      }
    }
    this.projectiles = this.projectiles.filter((pr) => pr.friendly || Math.hypot(pr.x - cx, pr.z - cz) > RAD);
    // debris kicked up from the floor plus guitar sparks
    const gc = MATS[this.world.get(Math.floor(cx), Math.floor(p.y - 0.5), Math.floor(cz))].color || hex('#a0a0a0');
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * TAU, sp = 3 + Math.random() * 6;
      this.particles.push({
        x: cx, y: p.y + 0.2, z: cz, vx: Math.cos(a) * sp, vy: 5 + Math.random() * 7, vz: Math.sin(a) * sp,
        life: 0.7 + Math.random() * 0.5, max: 1.2, col: i % 3 === 0 ? hex('#ffe23a') : i % 3 === 1 ? hex('#93cfdc') : gc, size: 0.22, g: 22,
      });
    }
  }

  doSmash() {
    const p = this.player;
    this.audio.sfx('smash');
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    const hx = p.x + fx * 1.3, hz = p.z + fz * 1.3;
    let hit = false;
    for (const e of this.enemies) {
      if (e.state === 'idle' && e.kind === 'boss' && !this.bossActive) continue;
      const er = e.r + 1.4;
      const dx = e.x - hx, dz = e.z - hz;
      if (dx * dx + dz * dz < er * er && e.y < p.y + 3 && e.y + e.h > p.y - 0.5) {
        const l = Math.hypot(e.x - p.x, e.z - p.z) || 1;
        this.damageEnemy(e, 2, (e.x - p.x) / l, (e.z - p.z) / l, 10);
        hit = true;
      }
    }
    // smack enemy projectiles away
    for (const pr of this.projectiles) {
      if (pr.friendly) continue;
      if ((pr.x - hx) ** 2 + (pr.z - hz) ** 2 < 2.5 && Math.abs(pr.y - (p.y + 1.5)) < 2) {
        pr.friendly = true;
        pr.vx = fx * 18; pr.vz = fz * 18; pr.vy = 0;
        pr.life = 1;
        hit = true;
      }
    }
    // swoosh arc in front of the player
    for (let i = 0; i <= 12; i++) {
      const a = p.yaw - 1.2 + (i / 12) * 2.4;
      const rr = 1.5 + Math.sin((i / 12) * Math.PI) * 0.3;
      this.particles.push({
        x: p.x + Math.sin(a) * rr, y: p.y + 2.4 - (i / 12) * 1.6, z: p.z + Math.cos(a) * rr,
        vx: Math.sin(a) * 2, vy: 0, vz: Math.cos(a) * 2, life: 0.12 + i * 0.008, max: 0.2,
        col: i % 3 === 0 ? hex('#ffe23a') : 0xffffffff, size: 0.2, g: 0,
      });
    }
    if (hit) { this.hitstop = 0.06; this.cam.shake = Math.max(this.cam.shake, 0.6); }
  }

  throwPick() {
    const p = this.player;
    p.picks--;
    this.audio.sfx('pick');
    let dx = Math.sin(p.yaw), dz = Math.cos(p.yaw), dy = 0;
    // soft auto-aim at the closest enemy in front
    let best: Enemy | null = null, bestD = 22 * 22;
    for (const e of this.enemies) {
      const ex = e.x - p.x, ez = e.z - p.z;
      const d2 = ex * ex + ez * ez;
      if (d2 > bestD) continue;
      const ang = Math.abs(wrapAngle(Math.atan2(ex, ez) - p.yaw));
      if (ang < 0.55) { best = e; bestD = d2; }
    }
    const sy = p.y + 1.7;
    if (best) {
      const tx = best.x - p.x, ty = best.y + best.h * 0.5 - sy, tz = best.z - p.z;
      const l = Math.hypot(tx, ty, tz);
      dx = tx / l; dy = ty / l; dz = tz / l;
    }
    const sp = 26;
    const fan = this.has('spread') ? [-0.22, 0, 0.22] : [0];
    for (const a of fan) {
      const ca = Math.cos(a), sa = Math.sin(a);
      const fx = dx * ca + dz * sa, fz = -dx * sa + dz * ca;
      this.projectiles.push({ x: p.x + fx * 0.6, y: sy, z: p.z + fz * 0.6, vx: fx * sp, vy: dy * sp, vz: fz * sp, life: 0.9, dmg: 1, friendly: true, model: this.m.pick, spin: 0, r: 0.3 });
    }
  }

  doChord() {
    const p = this.player;
    p.feedback -= this.chordCost();
    const od = this.has('overdrive');
    const RAD = od ? 9 : 7;
    this.audio.powerChord();
    this.cam.shake = 1.6;
    this.flash = 0.45;
    const cx = p.x, cy = p.y + 1.2, cz = p.z;
    this.waves.push({ x: cx, y: p.y + 0.3, z: cz, r: 0.5, maxR: RAD, speed: 22, friendly: true, hit: false, col: hex('#ffe23a') });
    this.waves.push({ x: cx, y: p.y + 1.6, z: cz, r: 0.2, maxR: 6, speed: 16, friendly: true, hit: false, col: hex('#ff3aa8') });
    for (const e of this.enemies) {
      if (e.kind === 'boss' && !this.bossActive) continue;
      const d = Math.hypot(e.x - cx, e.z - cz);
      if (d < RAD + e.r && Math.abs(e.y - p.y) < 5) this.damageEnemy(e, od ? 6 : 4, (e.x - cx) / (d || 1), (e.z - cz) / (d || 1), 16);
    }
    this.projectiles = this.projectiles.filter((pr) => pr.friendly || Math.hypot(pr.x - cx, pr.z - cz) > 7);
    // break amp walls
    const w = this.world;
    let broke = 0;
    const R = od ? 6.5 : 5.5;
    for (let y = Math.floor(cy - R); y <= cy + R; y++)
      for (let z = Math.floor(cz - R); z <= cz + R; z++)
        for (let x = Math.floor(cx - R); x <= cx + R; x++) {
          const m = MATS[w.get(x, y, z)];
          if (!m.breakable) continue;
          if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 * 0.5 + (z + 0.5 - cz) ** 2 > R * R) continue;
          w.edit(x, y, z, 0);
          broke++;
          if (broke % 3 === 0) {
            this.particles.push({ x: x + 0.5, y: y + 0.5, z: z + 0.5, vx: (x + 0.5 - cx) * 1.5, vy: 4 + Math.random() * 4, vz: (z + 0.5 - cz) * 1.5, life: 1.2, max: 1.2, col: m.color, size: 0.4, g: 20 });
          }
        }
    if (broke) {
      this.audio.sfx('break');
      this.msg('KRRRANG! THE WALL CRUMBLES!', 2, hex('#ffe23a'));
    }
  }

  chordCost() {
    return this.has('overdrive') ? 30 : 40;
  }

  hurtPlayer(dmg: number, fromX: number, fromZ: number, noKnock = false) {
    const p = this.player;
    if (p.invuln > 0 || this.state !== 'play') return;
    p.hp -= dmg;
    p.invuln = 1.1;
    p.blinkT = 1.1;
    p.flashT = 0.15;
    this.audio.sfx('hurt');
    this.cam.shake = Math.max(this.cam.shake, 0.9);
    this.hitstop = 0.05;
    if (!noKnock) {
      const l = Math.hypot(p.x - fromX, p.z - fromZ) || 1;
      p.vx = ((p.x - fromX) / l) * 10;
      p.vz = ((p.z - fromZ) / l) * 10;
      p.vy = 8;
    }
  }

  damageEnemy(e: Enemy, dmg: number, dx: number, dz: number, kb: number) {
    if (e.dead) return;
    if (e.kind === 'boss') {
      if (e.hurtT > 0) return;
      e.hurtT = 0.22;
    }
    e.hp -= dmg;
    e.flashT = 0.12;
    e.aggro = true;
    const kbm = e.kind === 'boss' ? 0.25 : e.kind === 'roadie' ? 0.6 : 1;
    e.vx = dx * kb * kbm;
    e.vz = dz * kb * kbm;
    if (e.kind !== 'boss' && !e.flying) e.vy = 6;
    if (e.kind === 'roadie' && e.state === 'charge') { e.state = 'recover'; e.timer = 0.8; }
    this.player.feedback = Math.min(100, this.player.feedback + 9);
    this.audio.sfx('hit');
    for (let i = 0; i < 5; i++) this.spark(e.x, e.y + e.h * 0.6, e.z, hex('#ffffff'), 4);
    if (e.hp <= 0) this.killEnemy(e);
  }

  killEnemy(e: Enemy) {
    e.dead = true;
    const cols = e.kind === 'drone' ? [hex('#f4f2ea'), hex('#202020'), hex('#ff2a3a')]
      : e.kind === 'roadie' ? [hex('#1a1a1e'), hex('#d8a888'), hex('#5a5a3a')]
        : [hex('#ff3aa8'), hex('#f0e080'), hex('#2a2a2a'), hex('#f0c0a0')];
    this.burst(e.x, e.y + e.h * 0.5, e.z, cols, e.kind === 'boss' ? 120 : 26, e.kind === 'boss' ? 14 : 7);
    if (e.kind === 'boss') {
      this.bossDefeated(e);
      return;
    }
    this.audio.sfx('die');
    if (Math.random() < 0.22) this.pickups.push({ kind: 'heart', id: '', x: e.x, y: e.y + 0.8, z: e.z, t: 0 });
  }

  bossDefeated(e: Enemy) {
    this.audio.sfx('bossDie');
    this.slowmo = 1.5;
    this.slowFactor = 0.35;
    {
      const p = this.player;
      const yaw = Math.atan2(e.x - p.x, e.z - p.z) + 0.7;
      this.cam.startCinematic(yaw, 2.4, [e.x, e.y + e.h * 0.35, e.z], 6 + e.scale * 2.5, 0.22);
    }
    this.cam.shake = 2;
    this.flash = 0.8;
    this.bossActive = false;
    this.boss = null;
    for (const o of this.enemies) if (o !== e && !o.dead) { o.dead = true; this.burst(o.x, o.y + 1, o.z, [hex('#ffffff')], 10, 5); }
    if (!this.save.beaten.includes(this.idx)) this.save.beaten.push(this.idx);
    this.save.unlocked = Math.max(this.save.unlocked, Math.min(WORLDS.length - 1, this.idx + 1));
    const rew = this.def.reward;
    if (rew && !this.save.abilities.includes(rew)) this.save.abilities.push(rew);
    this.persist();
    this.msg(`${this.def.bossName} DEFEATED!`, 5, hex('#ffe23a'));
    if (this.idx === WORLDS.length - 1) {
      this.finalWon = true;
      setTimeout(() => {
        this.state = 'victory';
        this.victoryT = 0;
        this.cam.endCinematic();
      }, 3500);
      return;
    }
    setTimeout(() => {
      if (rew) {
        this.dialog = {
          name: 'NEW ABILITY', lines: [this.def.rewardText, 'TOUR VAN: NEXT STOP UNLOCKED. FIND THE VAN BEHIND THE ARENA.'], i: 0, t: 0, done: () => { },
        };
        this.state = 'dialog';
      }
    }, 1600);
  }

  // ------------------------------------------------------------------ enemies
  updateEnemy(e: Enemy, dt: number) {
    const p = this.player, w = this.world;
    const dx = p.x - e.x, dz = p.z - e.z;
    const d = Math.hypot(dx, dz) || 0.001;
    const nx = dx / d, nz = dz / d;
    e.anim.t += dt;
    e.cd -= dt;
    e.timer -= dt;
    if (d < 16) e.aggro = true;
    else if (d > 34) e.aggro = false;

    // friction on knockback
    const fr = clamp(dt * (e.onGround || e.flying ? 6 : 1), 0, 1);
    let tvx = 0, tvz = 0;

    if (e.kind === 'boss') {
      this.updateBoss(e, dt, d, nx, nz);
      return;
    }

    if (e.kind === 'poser') {
      e.anim.headbang = !e.aggro;
      if (e.aggro && d > 1.1) { tvx = nx * 4.3; tvz = nz * 4.3; e.yaw = angleLerp(e.yaw, Math.atan2(nx, nz), clamp(dt * 8, 0, 1)); }
      if (e.hitWall && e.onGround && e.aggro) e.vy = 13;
      e.vx = lerp(e.vx, tvx, fr);
      e.vz = lerp(e.vz, tvz, fr);
      e.physics(w, dt);
    } else if (e.kind === 'roadie') {
      if (e.state === 'idle' || e.state === 'walk') {
        if (e.aggro) {
          e.state = 'walk';
          tvx = nx * 2.8; tvz = nz * 2.8;
          e.yaw = angleLerp(e.yaw, Math.atan2(nx, nz), clamp(dt * 5, 0, 1));
          if (d < 9 && e.cd <= 0) { e.state = 'wind'; e.timer = 0.55; e.dirX = nx; e.dirZ = nz; }
        }
        e.vx = lerp(e.vx, tvx, fr);
        e.vz = lerp(e.vz, tvz, fr);
      } else if (e.state === 'wind') {
        e.vx = lerp(e.vx, 0, fr); e.vz = lerp(e.vz, 0, fr);
        e.flashT = Math.sin(e.timer * 40) > 0 ? 0.02 : 0;
        if (e.timer <= 0) { e.state = 'charge'; e.timer = 0.7; this.audio.sfx('dash'); }
      } else if (e.state === 'charge') {
        e.vx = e.dirX * 15; e.vz = e.dirZ * 15;
        if (Math.random() < 0.5) this.spark(e.x, e.y + 0.2, e.z, hex('#a08060'), 1);
        if (e.timer <= 0 || e.hitWall) { e.state = 'recover'; e.timer = 0.9; if (e.hitWall) this.cam.shake = 0.5; }
      } else if (e.state === 'recover') {
        e.vx = lerp(e.vx, 0, fr); e.vz = lerp(e.vz, 0, fr);
        if (e.timer <= 0) { e.state = 'walk'; e.cd = 2.2; }
      }
      e.contact = e.state === 'charge' ? 2 : 1;
      e.physics(w, dt);
    } else if (e.kind === 'drone') {
      const ground = w.groundBelow(e.x, e.y + 2, e.z);
      let tx = e.x, tz = e.z, ty = Math.max(ground, p.y) + 4.2 + Math.sin(e.anim.t * 2) * 0.4;
      if (e.aggro) {
        const a = Math.atan2(e.z - p.z, e.x - p.x) + dt * 0.6;
        tx = p.x + Math.cos(a) * 7;
        tz = p.z + Math.sin(a) * 7;
        e.yaw = Math.atan2(nx, nz) + Math.PI / 2;
        if (e.cd <= 0 && d < 17) {
          e.cd = 2.4;
          this.fireAt(e.x, e.y + 0.4, e.z, p.x, p.y + 1.4, p.z, 9, this.m.droneNote);
        }
      }
      const vx = clamp((tx - e.x) * 1.5, -5, 5), vz = clamp((tz - e.z) * 1.5, -5, 5);
      e.vx = lerp(e.vx, vx, fr * 0.5);
      e.vz = lerp(e.vz, vz, fr * 0.5);
      e.vy = clamp((ty - e.y) * 2, -4, 4);
      e.physics(w, dt, false);
    }
    if (e.y < -6) e.dead = true;
    if (e.onHazard) { e.hp = 0; this.killEnemy(e); }
    this.contactDamage(e);
    const hs = Math.hypot(e.vx, e.vz);
    e.anim.walk += hs * dt * 1.6;
    e.anim.walkAmt = clamp(hs / 5, 0, 1);
    e.anim.air = !e.onGround && !e.flying;
  }

  contactDamage(e: Enemy) {
    const p = this.player;
    const rr = e.r + p.r + 0.1;
    if ((p.x - e.x) ** 2 + (p.z - e.z) ** 2 < rr * rr && p.y < e.y + e.h && p.y + p.h > e.y && p.dashT <= 0) this.hurtPlayer(e.contact, e.x, e.z);
  }

  fireAt(x: number, y: number, z: number, tx: number, ty: number, tz: number, speed: number, model: VoxelModel, spread = 0) {
    let dx = tx - x, dy = ty - y, dz = tz - z;
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    if (spread) {
      const a = Math.atan2(dx, dz) + spread;
      const hl = Math.hypot(dx, dz);
      dx = Math.sin(a) * hl; dz = Math.cos(a) * hl;
    }
    this.projectiles.push({ x, y, z, vx: dx * speed, vy: dy * speed, vz: dz * speed, life: 3.5, dmg: 1, friendly: false, model, spin: 0, r: 0.4 });
    this.audio.sfx('enemyShot');
  }

  updateBoss(e: Enemy, dt: number, d: number, nx: number, nz: number) {
    const p = this.player, w = this.world;
    const [ax, ay, az, ar] = this.gen.arena;
    const projModel = e.boss === 0 ? this.m.contract : this.m.notes[e.boss];
    const phase2 = e.hp < e.maxHp / 2;
    const rate = phase2 ? 0.65 : 1;
    if (!this.bossActive) {
      e.anim.headbang = e.boss !== 0;
      e.yaw = angleLerp(e.yaw, Math.atan2(nx, nz), clamp(dt * 3, 0, 1));
      if (Math.hypot(p.x - ax, p.z - az) < ar - 1.5 && this.state === 'play') {
        this.bossActive = true;
        e.state = 'move';
        e.timer = 1.5;
        this.dialog = {
          name: this.def.bossName, lines: this.def.bossLines, i: 0, t: 0,
          done: () => { this.cam.endCinematic(); this.audio.playSong({ ...BOSS_SONG, bpm: 138 + this.idx * 4 }); },
        };
        // "versus" shot over the player's shoulder at the boss
        this.cam.startCinematic(Math.atan2(e.x - p.x, e.z - p.z) + 0.45, 999, [e.x, e.y + e.h * 0.35, e.z], 7 + e.scale * 3, 0.2);
        this.state = 'dialog';
      }
      e.vx = e.vz = 0;
      e.physics(w, dt, !e.flying);
      return;
    }
    e.anim.headbang = false;
    e.anim.act = -1;
    const fr = clamp(dt * 5, 0, 1);
    const face = () => (e.yaw = angleLerp(e.yaw, Math.atan2(nx, nz), clamp(dt * 6, 0, 1)));
    switch (e.state) {
      case 'move': {
        face();
        const sp = (e.flying ? 3 : 3.6) / rate;
        const want = d > 5 ? 1 : -0.3;
        e.vx = lerp(e.vx, nx * sp * want, fr);
        e.vz = lerp(e.vz, nz * sp * want, fr);
        if (e.timer <= 0) {
          const pat = BOSS_PATTERNS[e.boss];
          e.state = pat[e.atk++ % pat.length];
          e.timer = 0;
          e.cd = 0;
          e.dirX = nx; e.dirZ = nz;
          if (e.state === 'charge') e.timer = 0.6;
          if (e.state === 'spread' || e.state === 'ring') e.timer = 0.45;
          if (e.state === 'slam') { e.vy = 18; e.vx = clamp(nx * d * 0.9, -12, 12); e.vz = clamp(nz * d * 0.9, -12, 12); e.timer = 0.3; }
          if (e.state === 'summon') e.timer = 0.6;
          if (e.state === 'teleport') e.timer = 0.5;
        }
        break;
      }
      case 'spread': {
        face();
        e.vx = lerp(e.vx, 0, fr); e.vz = lerp(e.vz, 0, fr);
        e.anim.act = 0.2; e.anim.actKind = 'throw';
        if (e.timer <= 0) {
          const n = phase2 ? 7 : 5;
          for (let i = 0; i < n; i++) this.fireAt(e.x, e.y + e.h * 0.55, e.z, p.x, p.y + 1.2, p.z, 10, projModel, (i - (n - 1) / 2) * 0.22);
          this.toMove(e, 1.3 * rate);
        }
        break;
      }
      case 'ring': {
        e.vx = lerp(e.vx, 0, fr); e.vz = lerp(e.vz, 0, fr);
        e.anim.act = 0.5; e.anim.actKind = 'chord';
        if (e.timer <= 0) {
          const n = phase2 ? 18 : 12;
          const off = Math.random();
          for (let i = 0; i < n; i++) {
            const a = ((i + off) / n) * TAU;
            this.projectiles.push({ x: e.x, y: e.y + 1.4, z: e.z, vx: Math.sin(a) * 8, vy: 0, vz: Math.cos(a) * 8, life: 3, dmg: 1, friendly: false, model: projModel, spin: 0, r: 0.4 });
          }
          this.audio.powerChord(55, 0.6, 0.3);
          this.toMove(e, 1.5 * rate);
        }
        break;
      }
      case 'charge': {
        if (e.timer > 0 && e.cd === 0) {
          e.vx = lerp(e.vx, 0, fr); e.vz = lerp(e.vz, 0, fr);
          e.flashT = Math.sin(e.timer * 40) > 0 ? 0.02 : 0;
          face();
          e.dirX = nx; e.dirZ = nz;
        } else {
          if (e.cd === 0) { e.cd = 1; e.timer = 0.75; this.audio.sfx('dash'); }
          e.vx = e.dirX * 17; e.vz = e.dirZ * 17;
          e.contact = 2;
          e.anim.act = 0.6; e.anim.actKind = 'smash';
          if (Math.random() < 0.6) this.spark(e.x, e.y + 0.3, e.z, hex('#c0a080'), 2);
          if (e.timer <= 0 || e.hitWall || Math.hypot(e.x - ax, e.z - az) > ar + 1) {
            if (e.hitWall) this.cam.shake = 1;
            this.toMove(e, 1.2 * rate);
          }
        }
        break;
      }
      case 'slam': {
        e.anim.act = 0.3; e.anim.actKind = 'slam';
        if (e.timer <= 0 && e.onGround) {
          this.waves.push({ x: e.x, y: e.y, z: e.z, r: 0.5, maxR: 13, speed: 11, friendly: false, hit: false, col: hex('#ff8a20') });
          if (phase2) setTimeout(() => this.waves.push({ x: e.x, y: e.y, z: e.z, r: 0.5, maxR: 13, speed: 11, friendly: false, hit: false, col: hex('#ff3aa8') }), 450);
          this.cam.shake = 1.4;
          this.audio.sfx('smash');
          this.toMove(e, 1.4 * rate);
        }
        break;
      }
      case 'summon': {
        e.vx = lerp(e.vx, 0, fr); e.vz = lerp(e.vz, 0, fr);
        e.anim.act = 0.5; e.anim.actKind = 'chord';
        if (e.timer <= 0) {
          const alive = this.enemies.filter((o) => o.kind !== 'boss').length;
          if (alive < 5) {
            for (let i = 0; i < 2; i++) {
              const a = Math.random() * TAU;
              const sx = ax + Math.cos(a) * 7, sz = az + Math.sin(a) * 7;
              const kind: EnemyKind = e.boss === 2 || e.boss === 5 ? 'drone' : 'poser';
              const m = this.makeEnemy(kind, sx, kind === 'drone' ? ay + 4 : ay + 0.1, sz);
              m.aggro = true;
              this.enemies.push(m);
              this.burst(sx, ay + 1, sz, [hex('#ff3aa8'), hex('#ffffff')], 14, 4);
            }
          }
          this.toMove(e, 1.2 * rate);
        }
        break;
      }
      case 'teleport': {
        e.vx = e.vz = 0;
        if (e.timer <= 0) {
          this.burst(e.x, e.y + 1.5, e.z, [hex('#3af0ff'), hex('#b45aff')], 20, 5);
          const a = Math.random() * TAU;
          e.x = ax + Math.cos(a) * 8;
          e.z = az + Math.sin(a) * 8;
          this.burst(e.x, e.y + 1.5, e.z, [hex('#3af0ff'), hex('#b45aff')], 20, 5);
          this.toMove(e, 0.6);
        }
        break;
      }
    }
    if (e.flying) {
      const ty = ay + 2 + Math.sin(e.anim.t * 2) * 0.5;
      e.vy = clamp((ty - e.y) * 3, -6, 6);
      e.physics(w, dt, false);
    } else {
      e.physics(w, dt);
    }
    // keep the boss inside its arena
    const da = Math.hypot(e.x - ax, e.z - az);
    if (da > ar - 1) { e.x = ax + ((e.x - ax) / da) * (ar - 1); e.z = az + ((e.z - az) / da) * (ar - 1); }
    if (e.y < -6) { e.x = ax; e.z = az; e.y = ay + 2; }
    this.contactDamage(e);
    const hs = Math.hypot(e.vx, e.vz);
    e.anim.walk += hs * dt * 1.2;
    e.anim.walkAmt = clamp(hs / 4, 0, 1);
    e.anim.air = !e.onGround && !e.flying;
  }
  toMove(e: Enemy, t: number) {
    e.state = 'move';
    e.contact = 1;
    e.timer = t;
  }

  // ------------------------------------------------------------------ misc systems
  updateProjectiles(dt: number) {
    const w = this.world, p = this.player;
    for (const pr of this.projectiles) {
      pr.life -= dt;
      pr.spin += dt * 14;
      pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.z += pr.vz * dt;
      if (w.inside(Math.floor(pr.x), Math.floor(pr.y), Math.floor(pr.z)) && w.solidAt(Math.floor(pr.x), Math.floor(pr.y), Math.floor(pr.z))) {
        pr.life = 0;
        for (let i = 0; i < 4; i++) this.spark(pr.x - pr.vx * dt, pr.y, pr.z - pr.vz * dt, hex('#ffd080'), 3);
        continue;
      }
      if (pr.friendly) {
        for (const e of this.enemies) {
          if (e.dead || (e.kind === 'boss' && !this.bossActive)) continue;
          const rr = e.r + pr.r;
          if ((pr.x - e.x) ** 2 + (pr.z - e.z) ** 2 < rr * rr && pr.y > e.y - 0.2 && pr.y < e.y + e.h + 0.2) {
            const l = Math.hypot(pr.vx, pr.vz) || 1;
            this.damageEnemy(e, pr.dmg, pr.vx / l, pr.vz / l, 4);
            pr.life = 0;
            break;
          }
        }
      } else {
        const rr = p.r + pr.r;
        if ((pr.x - p.x) ** 2 + (pr.z - p.z) ** 2 < rr * rr && pr.y > p.y && pr.y < p.y + p.h && p.dashT <= 0) {
          this.hurtPlayer(pr.dmg, pr.x - pr.vx, pr.z - pr.vz);
          pr.life = 0;
        }
      }
    }
    this.projectiles = this.projectiles.filter((p2) => p2.life > 0);
  }

  updateWaves(dt: number) {
    const p = this.player;
    for (const wv of this.waves) {
      wv.r += wv.speed * dt;
      if (!wv.friendly && !wv.hit) {
        const d = Math.hypot(p.x - wv.x, p.z - wv.z);
        if (Math.abs(d - wv.r) < 0.8 && p.y - wv.y < 0.9) {
          wv.hit = true;
          this.hurtPlayer(1, wv.x, wv.z);
        }
      }
    }
    this.waves = this.waves.filter((wv) => wv.r < wv.maxR);
  }

  updateParticles(dt: number) {
    for (const q of this.particles) {
      q.life -= dt;
      q.vy -= q.g * dt;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
    }
    this.particles = this.particles.filter((q) => q.life > 0);
    if (this.particles.length > 900) this.particles.splice(0, this.particles.length - 900);
  }

  updateWeather(dt: number) {
    const c = this.cam;
    for (const [vx, vy, vz] of this.gen.vents) {
      if (Math.abs(vx - c.tx) > 26 || Math.abs(vz - c.tz) > 26) continue;
      const burst = Math.sin(this.time * 2.3 + vx * 0.7 + vz) > 0.3;
      if (Math.random() < dt * (burst ? 30 : 4)) {
        this.particles.push({
          x: vx + (Math.random() - 0.5) * 0.6, y: vy + 0.1, z: vz + (Math.random() - 0.5) * 0.6,
          vx: 0, vy: burst ? 5 + Math.random() * 4 : 1.5, vz: 0, life: 0.5, max: 0.5,
          col: Math.random() < 0.5 ? hex('#ff7a20') : hex('#ffd040'), size: 0.22, g: -2,
        });
      }
    }
    for (let i = 0; i < this.weather.length; i++) {
      const q = this.weather[i];
      q.life -= dt;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      if (this.def.weather === 'dust' || this.def.weather === 'neon') { q.x += Math.sin(this.time + i) * dt * 0.5; }
      const far = Math.abs(q.x - c.tx) > 24 || Math.abs(q.z - c.tz) > 24;
      if (q.life <= 0 || far || q.y < c.ty - 12) this.weather[i] = this.newWeather(this.def.weather !== 'rain' || far);
    }
  }

  updatePickups(dt: number) {
    const p = this.player;
    for (const k of this.pickups) {
      k.t += dt;
      const d2 = (k.x - p.x) ** 2 + (k.z - p.z) ** 2;
      if (d2 < 1.3 && k.y > p.y - 0.8 && k.y < p.y + p.h + 0.5) {
        k.t = -1;
        this.audio.sfx('pickup');
        if (k.kind === 'heart') p.hp = Math.min(p.maxHp, p.hp + 1);
        else {
          this.save.collected.push(k.id);
          if (k.kind === 'tape') {
            this.save.maxHp++;
            p.maxHp = this.save.maxHp;
            p.hp = p.maxHp;
            this.msg('MIXTAPE FOUND! MAX HEALTH +1', 3.5, hex('#ff3aa8'));
          } else {
            this.save.maxPicks += 2;
            p.maxPicks = this.save.maxPicks;
            p.picks = p.maxPicks;
            this.msg('PICK POUCH FOUND! MAX PICKS +2', 3.5, hex('#ff8a20'));
          }
          this.persist();
        }
        this.burst(k.x, k.y, k.z, [hex('#ffe23a'), hex('#ffffff')], 16, 4);
      }
    }
    this.pickups = this.pickups.filter((k) => k.t >= 0);
  }

  updateWorldInteractions(dt: number) {
    const p = this.player, inp = this.input;
    for (const c of this.checkpoints) {
      if (!c.lit && (c.x - p.x) ** 2 + (c.z - p.z) ** 2 < 2.5 && Math.abs(c.y - p.y) < 2) {
        for (const o of this.checkpoints) o.lit = false;
        c.lit = true;
        this.respawn = [c.x + 1, c.y, c.z];
        p.hp = p.maxHp;
        this.audio.sfx('checkpoint');
        this.msg('CHECKPOINT! HEALTH RESTORED', 2.5, hex('#ffe23a'));
        this.burst(c.x, c.y + 2.5, c.z, [hex('#ffe23a')], 12, 3);
      }
    }
    this.gen.vans.forEach(([vx, vy, vz], i) => {
      if ((vx - p.x) ** 2 + (vz - p.z) ** 2 < 9 && Math.abs(vy - p.y) < 3) {
        if (i === 1 && !this.save.beaten.includes(this.idx)) return;
        this.prompt = '[ENTER] BOARD THE TOUR VAN';
        if (inp.pressed('Enter', 'KeyF', 'NumpadEnter')) {
          this.state = 'map';
          this.mapSel = Math.min(this.save.unlocked, i === 1 ? this.idx + 1 : this.idx);
          this.audio.sfx('select');
        }
      }
    });
    // gate hints
    const gx = this.gen.gateX;
    if (Math.abs(p.x - (gx - 8)) < 3) {
      const g = this.def.gate;
      if (g === 'amp' && !this.has('chord')) this.prompt = this.def.gateHint;
      if (g === 'amp' && this.has('chord') && this.world.get(gx, Math.floor(p.y) + 1, Math.floor(this.gen.pathZ(gx))) !== 0) this.prompt = this.def.gateHintHave;
      if (g === 'cliff' && !this.has('dive')) this.prompt = this.def.gateHint;
      if (g === 'chasm' && !this.has('dash')) this.prompt = this.def.gateHint;
    }
    void dt;
  }

  updateMap() {
    const inp = this.input;
    if (inp.pressed('ArrowUp', 'KeyW')) { this.mapSel = Math.max(0, this.mapSel - 1); this.audio.sfx('select'); }
    if (inp.pressed('ArrowDown', 'KeyS')) { this.mapSel = Math.min(this.save.unlocked, this.mapSel + 1); this.audio.sfx('select'); }
    if (inp.pressed('Escape', 'Backspace')) this.state = 'play';
    if (inp.pressed('Enter', 'Space', 'NumpadEnter')) {
      this.state = 'play';
      this.loadWorld(this.mapSel);
    }
  }

  doRespawn() {
    const p = this.player;
    this.cam.endCinematic();
    this.state = 'play';
    [p.x, p.y, p.z] = this.respawn;
    p.vx = p.vy = p.vz = 0;
    p.hp = p.maxHp;
    p.invuln = 1.5;
    p.actT = -1; p.actKind = 'none';
    p.safe = [p.x, p.y, p.z];
    this.projectiles = [];
    this.waves = [];
    this.spawnEnemies();
    this.audio.playSong(SONGS[this.idx]);
    this.cam.snapTo(p.x, p.y + 1.4, p.z);
  }

  spark(x: number, y: number, z: number, col: number, sp: number) {
    this.particles.push({
      x, y, z, vx: (Math.random() - 0.5) * sp * 2, vy: Math.random() * sp, vz: (Math.random() - 0.5) * sp * 2,
      life: 0.3 + Math.random() * 0.3, max: 0.6, col, size: 0.12, g: 12,
    });
  }
  burst(x: number, y: number, z: number, cols: number[], n: number, sp: number) {
    for (let i = 0; i < n; i++) {
      this.particles.push({
        x, y, z, vx: (Math.random() - 0.5) * sp * 2, vy: Math.random() * sp * 1.4, vz: (Math.random() - 0.5) * sp * 2,
        life: 0.6 + Math.random() * 0.8, max: 1.4, col: cols[i % cols.length], size: 0.18 + Math.random() * 0.15, g: 18,
      });
    }
  }

  // ------------------------------------------------------------------ rendering
  render() {
    const r = this.r, c = this.cam, light = this.def.light;
    r.clear();
    r.setCamera(c.px, c.py, c.pz, c.yaw, c.pitch, c.fov);
    r.near = c.nearClip;
    const s = c.s;
    r.fogStart = c.dist + lerp(14, 18, s);
    r.fogEnd = c.dist + lerp(70, 56, s);
    r.outlineThreshold = lerp(1.6, 1.2, s);
    const maxZ = r.fogEnd + 4;

    // terrain chunks, front to back
    const vis: { ch: Chunk; z: number }[] = [];
    for (const ch of this.world.chunks) {
      const cx = ch.cx * 16 + 8, cz = ch.cz * 16 + 8, cy = this.world.Y / 2;
      if (!r.sphereVisible(cx, cy, cz, 25, maxZ)) continue;
      vis.push({ ch, z: r.toView(cx, cy, cz)[2] });
    }
    vis.sort((a, b) => a.z - b.z);
    const ident = mIdent();
    const view = r.view;
    void ident;
    // cut away terrain that hides the player (mostly for the isometric view)
    const pl = this.player;
    // grows from a small iso cutaway into removing everything in front during cinematics
    const cutR = lerp(4.2, 80, Math.pow(clamp(s / 0.45, 0, 1), 2));
    r.cutActive = cutR > 0.3 && this.state !== 'title';
    if (r.cutActive) {
      const [vx, vy, vz] = r.toView(pl.x, pl.y + 1.4, pl.z);
      r.cutX = vx; r.cutY = vy; r.cutZ = vz - 0.8; r.cutR2 = cutR * cutR; r.cutWY = Math.floor(pl.y) + 2;
    }
    for (const v of vis) r.drawFaces(v.ch.faces, view, null, 0, 0);
    r.cutActive = false;

    // blob shadows
    const actors: Actor[] = [this.player, ...this.enemies];
    for (const a of actors) {
      if (a === this.player && this.state === 'dead') continue;
      const g = this.world.groundBelow(a.x, a.y + 0.5, a.z);
      if (a.y - g > 12 || g < 0) continue;
      const rad = a.r * 1.25 * clamp(1 - (a.y - g) / 14, 0.4, 1);
      const pts: number[] = [];
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * TAU;
        pts.push(a.x + Math.cos(ang) * rad, g + 0.04, a.z + Math.sin(ang) * rad);
      }
      r.drawWorldPoly(pts, 0, FLAG_SHADOW);
    }

    // actors
    const p = this.player;
    if (this.state !== 'dead') {
      const blink = p.blinkT > 0 && Math.floor(this.time * 20) % 2 === 0 && p.blinkT < 1;
      if (!blink) {
        drawModel(r, light, p.model, poseHumanoid(p.anim, HERO_RIG), p.x, p.y + p.stepOffset, p.z, p.yaw, 1, { flags: FLAG_XRAY, id: 1, flash: p.flashT > 0 });
      }
    }
    const plz = r.toView(p.x, p.y + 1.4, p.z)[2];
    for (const e of this.enemies) {
      if (!r.sphereVisible(e.x, e.y + 1, e.z, 3 * e.scale, maxZ)) continue;
      const flash = e.flashT > 0;
      // see-through when standing between the third-person camera and the player
      const ez = r.toView(e.x, e.y + e.h * 0.5, e.z)[2];
      r.dither = s > 0.5 && ez < plz - 1 && ez < 6;
      const fc = e.state === 'wind' || (e.state === 'charge' && e.cd === 0) ? hex('#ffe23a') : 0xffffffff;
      if (e.kind === 'drone') {
        const rot = mPivot(0, 1, 0, 0, e.anim.t * 25, 0);
        const tilt = mRotZ(Math.sin(e.anim.t * 3) * 0.15);
        drawModel(r, light, e.model, [ident, rot], e.x, e.y, e.z, e.yaw, 1, { flags: FLAG_XRAY, id: 2, flash, flashColor: fc }, tilt);
      } else {
        drawModel(r, light, e.model, poseHumanoid(e.anim), e.x, e.y + e.stepOffset, e.z, e.yaw, e.scale, { flags: FLAG_XRAY, id: 2, flash, flashColor: fc });
      }
    }
    r.dither = false;
    // checkpoints
    for (const ck of this.checkpoints) {
      if (!r.sphereVisible(ck.x, ck.y + 1, ck.z, 3, maxZ)) continue;
      drawModel(r, light, ck.lit ? this.m.micOn : this.m.micOff, null, ck.x, ck.y, ck.z, this.time * (ck.lit ? 1 : 0), 1, { id: 3 });
    }
    // pickups
    for (const k of this.pickups) {
      const model = k.kind === 'tape' ? this.m.tape : k.kind === 'pouch' ? this.m.pouch : this.m.heart;
      const bob = Math.sin(this.time * 3 + k.x) * 0.2;
      drawModel(r, light, model, null, k.x, k.y + bob, k.z, this.time * 2.5, k.kind === 'heart' ? 1 : 1.3, { id: 4, flags: FLAG_XRAY });
      if (Math.random() < 0.1) this.particles.push({ x: k.x + (Math.random() - 0.5), y: k.y, z: k.z + (Math.random() - 0.5), vx: 0, vy: 1, vz: 0, life: 0.6, max: 0.6, col: hex('#ffe23a'), size: 0.08, g: 0 });
    }
    // projectiles
    for (const pr of this.projectiles) {
      const yaw = Math.atan2(pr.vx, pr.vz);
      drawModel(r, light, pr.model, null, pr.x, pr.y, pr.z, yaw + pr.spin, 1, { id: 5 }, mRotX(pr.friendly ? Math.PI / 2 : 0));
    }
    // shockwaves: rings of particles
    for (const wv of this.waves) {
      const n = Math.max(16, Math.floor(wv.r * 7));
      const fade = 1 - wv.r / wv.maxR;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + this.time;
        const col = i % 2 ? wv.col : mix(wv.col, 0xffffffff, 0.5);
        r.drawParticle(wv.x + Math.cos(a) * wv.r, wv.y + 0.2 + (i % 3) * 0.35 * fade, wv.z + Math.sin(a) * wv.r, wv.friendly ? 0.34 : 0.26, col);
      }
    }
    for (const q of this.particles) {
      const f = clamp(q.life / q.max, 0, 1);
      r.drawParticle(q.x, q.y, q.z, q.size * (0.5 + f * 0.5), q.col);
    }
    for (const q of this.weather) {
      if (this.def.weather === 'rain') r.drawStreak(q.x, q.y, q.z, 0.7, q.col);
      else r.drawParticle(q.x, q.y, q.z, q.size, q.col);
    }

    r.postProcess(this.time);
    if (this.state === 'title') this.drawTitle3D();
    if (this.flash > 0) r.fade(0xffffffff, Math.min(0.6, this.flash));
    this.drawHud();
    r.present();
  }

  drawHud() {
    const r = this.r, p = this.player;
    const st = this.state;
    if (st === 'title') return this.drawTitle();
    // hearts
    for (let i = 0; i < p.maxHp; i++) {
      const full = i < p.hp;
      r.sprite(6 + i * 9, 6, HEART, { '#': full ? hex('#ff3a4a') : hex('#3a1a22') });
      if (full) r.rect(8 + i * 9, 7, 1, 1, hex('#ffc0c0'));
    }
    // picks
    r.sprite(6, 16, PICK, { '#': hex('#ff8a20') });
    r.text(`X${p.picks}`, 12, 16, p.picks > 0 ? 0xffffffff : hex('#808080'));
    // feedback meter
    if (this.has('chord')) {
      r.text('FEEDBACK', 6, 26, hex('#c0c0c0'));
      r.rect(6, 33, 52, 5, hex('#101010'));
      const ready = p.feedback >= 40;
      r.rect(7, 34, Math.round(50 * p.feedback / 100), 3, ready ? (Math.floor(this.time * 6) % 2 ? hex('#ffe23a') : hex('#ffb020')) : hex('#7a6a2a'));
      r.rect(7 + 20, 33, 1, 5, hex('#606060'));
    }
    // abilities row
    let ax = 6;
    const abY = this.has('chord') ? 41 : 26;
    for (const [a, lbl] of [['chord', 'L:CHORD'], ['dive', '2XJUMP'], ['dash', 'SHIFT:DASH'], ['spread', '3XPICK'], ['overdrive', 'OVERDRIVE']] as [Ability, string][]) {
      if (!this.has(a)) continue;
      r.text(lbl, ax, abY, hex('#9a9aa8'));
      ax += r.textWidth(lbl) + 6;
    }
    // world name
    const wn = `${this.idx + 1}. ${this.def.name}`;
    r.text(wn, W - r.textWidth(wn) - 6, 6, hex('#ffe23a'));
    const col = `TAPES ${this.save.collected.filter((c) => c.endsWith('tape')).length}/${WORLDS.length}  POUCHES ${this.save.collected.filter((c) => c.endsWith('pouch')).length}/${WORLDS.length}`;
    r.text(col, W - r.textWidth(col) - 6, 14, hex('#a0a0b0'));
    // camera mode
    if (this.showFps) r.text(`${Math.round(this.fps)} FPS  ${r.stats.faces} F`, 6, H - 10, hex('#80ff80'));

    // boss bar
    const b = this.boss;
    if (b && this.bossActive && st === 'play') {
      const bw = 200, bx = (W - bw) / 2, by = H - 24;
      r.textCentered(this.def.bossName, by - 8, hex('#ff3aa8'));
      r.rect(bx - 1, by - 1, bw + 2, 7, hex('#000000'));
      r.rect(bx, by, bw, 5, hex('#3a1020'));
      r.rect(bx, by, Math.round(bw * Math.max(0, b.hp) / b.maxHp), 5, hex('#ff3aa8'));
      r.rect(bx, by, Math.round(bw * Math.max(0, b.hp) / b.maxHp), 1, hex('#ffa0d0'));
    }
    // messages
    let my = 52;
    for (const m of this.messages) {
      const a = clamp(m.t * 2, 0, 1);
      if (a > 0.3) r.textCentered(m.text, my, m.col);
      my += 9;
    }
    if (this.prompt && st === 'play') {
      const pw = r.textWidth(this.prompt) + 8;
      r.rect((W - pw) / 2, H - 46, pw, 11, 0xff000000, 0.6);
      r.textCentered(this.prompt, H - 43, 0xffffffff);
    }

    if (st === 'dialog' && this.dialog) {
      const d = this.dialog;
      r.rect(20, H - 64, W - 40, 50, hex('#0a0a14'), 0.88);
      r.rect(20, H - 64, W - 40, 1, hex('#ff3aa8'));
      r.rect(20, H - 15, W - 40, 1, hex('#ff3aa8'));
      r.text(d.name, 28, H - 58, hex('#ff3aa8'));
      const line = d.lines[d.i];
      const shown = line.slice(0, Math.floor(d.t * 40));
      // wrap
      const words = shown.split(' ');
      let row = '', y = H - 46;
      for (const wd of words) {
        if (r.textWidth(row + wd) > W - 60) { r.text(row, 28, y, 0xffffffff); row = ''; y += 8; }
        row += wd + ' ';
      }
      r.text(row, 28, y, 0xffffffff);
      if (Math.floor(this.time * 3) % 2) r.text('ENTER >', W - 62, H - 24, hex('#a0a0b0'));
    }
    if (st === 'map') this.drawMap();
    if (st === 'pause') this.drawPause();
    if (st === 'dead') {
      r.fade(hex('#200008'), clamp(this.deadT / 1.5, 0, 0.75));
      r.textCentered('YOU GOT HEADBANGED', H / 2 - 10, hex('#ff3a4a'), 2);
      r.textCentered('BACK TO THE LAST CHECKPOINT...', H / 2 + 8, 0xffffffff);
    }
    if (st === 'victory') this.drawVictory();
  }

  /** Spinning extruded voxel logo, drawn in view space on top of the scene. */
  drawTitle3D() {
    const r = this.r, t = this.titleT;
    r.depth.fill(0);
    const { model, width } = this.m.title;
    const z = Math.max(4, this.cam.dist * 0.5);
    const u = z / r.focal; // world units per pixel at that depth
    const vox = 6.5 * u;
    const intro = clamp(t / 1.2, 0, 1);
    const wob = Math.sin(t * 0.9) * 0.35 + (1 - intro) * 3;
    const yPix = 62 + Math.sin(t * 2) * 2;
    const mk = (dx: number, dy: number, dz: number) =>
      mChain(mTrans(dx * u, (H / 2 - yPix + dy) * u, z + dz * u), mRotY(wob), mRotX(Math.sin(t * 1.3) * 0.15 - 0.15), mScale(vox), mTrans(-width / 2, -2.5, 0.5));
    const lv = [0.35, 0.55, -0.75];
    const sh = new Float32Array(6);
    const M = mk(0, 0, 0);
    for (let d = 0; d < 6; d++) {
      const j = d >> 1, sg = d & 1 ? -1 : 1;
      const nx = (M[j] * sg) / vox, ny = (M[4 + j] * sg) / vox, nz = (M[8 + j] * sg) / vox;
      sh[d] = 0.55 + 0.6 * Math.max(0, nx * lv[0] + ny * lv[1] + nz * lv[2]);
    }
    r.drawFaces(model.parts[0].faces, mk(3, -3, 40), null, FLAG_FLASH, 9, hex('#1a0010'));
    r.drawFaces(model.parts[0].faces, M, sh, 0, 9);
  }

  drawTitle() {
    const r = this.r;
    r.rect(0, 0, W, H, 0xff000000, 0.25);
    const t = this.titleT;
    const y = 34 + Math.round(Math.sin(t * 2) * 2);
    r.textCentered('A GRUNGE ODYSSEY', y + 54, hex('#ffe23a'), 2);
    r.textCentered('FLANNEL VS. SPANDEX', y + 70, hex('#c0c8d0'));
    if (Math.floor(t * 2) % 2 === 0) r.textCentered(this.hasSave ? 'PRESS ENTER TO CONTINUE' : 'PRESS ENTER TO START', 130, 0xffffffff);
    if (this.hasSave) r.textCentered('N: NEW GAME', 140, hex('#a0a0b0'));
    const lines = ['WASD/ARROWS MOVE  SPACE JUMP  J SMASH  K THROW PICK', 'L POWER CHORD  SHIFT DASH  Q/E ROTATE VIEW  M MUSIC'];
    lines.forEach((l, i) => r.textCentered(l, H - 24 + i * 9, hex('#c0c0c0')));
  }

  drawMap() {
    const r = this.r;
    r.rect(40, 30, W - 80, H - 60, hex('#0a0a14'), 0.92);
    r.rect(40, 30, W - 80, 1, hex('#ffe23a'));
    r.textCentered('TOUR VAN - PICK YOUR NEXT GIG', 38, hex('#ffe23a'));
    WORLDS.forEach((wd, i) => {
      const y = 50 + i * 19;
      const unlocked = i <= this.save.unlocked;
      const sel = i === this.mapSel;
      if (sel) r.rect(48, y - 2, W - 96, 17, hex('#3a1a3a'));
      const name = unlocked ? `${i + 1}. ${wd.name}` : `${i + 1}. ???`;
      r.text((sel ? '> ' : '  ') + name, 54, y, unlocked ? 0xffffffff : hex('#606060'));
      if (unlocked) {
        const beaten = this.save.beaten.includes(i);
        const tape = this.save.collected.includes(`${i}-tape`), pouch = this.save.collected.includes(`${i}-pouch`);
        r.text(`${wd.subtitle}`, 62, y + 8, hex('#9090a0'));
        const st = `${beaten ? 'CLEARED' : 'BOSS: ' + wd.bossName}  ${tape ? 'TAPE*' : 'TAPE-'} ${pouch ? 'POUCH*' : 'POUCH-'}`;
        r.text(st, W - 54 - r.textWidth(st), y, beaten ? hex('#80ff80') : hex('#ff8080'));
      }
    });
    r.textCentered('UP/DOWN SELECT   ENTER TRAVEL   ESC CANCEL', H - 42, hex('#a0a0b0'));
  }

  drawPause() {
    const r = this.r;
    r.rect(0, 0, W, H, 0xff000000, 0.6);
    r.textCentered('PAUSED', 30, hex('#ff3aa8'), 3);
    const lines = [
      'WASD / ARROWS ..... MOVE', 'SPACE ............. JUMP (AGAIN IN AIR: STAGE DIVE)', 'J / LEFT CLICK .... GUITAR SMASH',
      'HOLD J AFTER SMASH  CHARGED FINISHER (COSTS FEEDBACK)', 'K / RIGHT CLICK ... THROW PICK', 'L / R ............. POWER CHORD (COSTS FEEDBACK)', 'SHIFT ............. MOSH DASH',
      'Q / E ............. ROTATE THE VIEW',  'ENTER / F ......... INTERACT',
      'M ................. MUSIC ON/OFF', '` ................. FPS',
    ];
    lines.forEach((l, i) => r.text(l, 60, 60 + i * 10, 0xffffffff));
    r.textCentered('ESC TO RESUME', H - 20, hex('#a0a0b0'));
  }

  drawVictory() {
    const r = this.r;
    const a = clamp(this.victoryT / 2, 0, 0.7);
    r.fade(hex('#100018'), a);
    if (this.victoryT < 1) return;
    r.textCentered('THE 80S ARE OVER.', 50, hex('#ffe23a'), 3);
    r.textCentered('RIKKI SPANDEX HAS BEEN UNPLUGGED.', 82, 0xffffffff);
    r.textCentered('THE FLANNEL REVOLUTION BEGINS.', 92, 0xffffffff);
    const tapes = this.save.collected.filter((c) => c.endsWith('tape')).length;
    const pouches = this.save.collected.filter((c) => c.endsWith('pouch')).length;
    r.textCentered(`MIXTAPES ${tapes}/${WORLDS.length}   PICK POUCHES ${pouches}/${WORLDS.length}`, 112, hex('#ff3aa8'));
    if (this.victoryT > 3 && Math.floor(this.time * 2) % 2) r.textCentered('PRESS ENTER', 140, hex('#a0a0b0'));
  }
}
