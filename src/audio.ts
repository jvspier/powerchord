// Tiny WebAudio synth: distorted power chords, SFX and a looping riff sequencer.
export class Audio {
  ctx: AudioContext | null = null;
  master!: GainNode;
  musicGain!: GainNode;
  private dist!: WaveShaperNode;
  musicOn = true;
  private nextNote = 0;
  private step = 0;
  private song: Song | null = null;
  private timer: number | undefined;

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.35;
    this.musicGain.connect(this.master);
    this.dist = this.ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 9) * 0.8;
    }
    this.dist.curve = curve;
    this.dist.oversample = '2x';
    const post = this.ctx.createBiquadFilter();
    post.type = 'lowpass';
    post.frequency.value = 3200;
    this.dist.connect(post);
    post.connect(this.master);
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  private env(g: GainNode, t: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private osc(type: OscillatorType, freq: number, t: number, dur: number, peak: number, dest: AudioNode, slideTo?: number) {
    const c = this.ctx!;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    this.env(g, t, 0.005, peak, dur);
    o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(t: number, dur: number, peak: number, dest: AudioNode, hp = 800) {
    const c = this.ctx!;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = hp;
    const g = c.createGain();
    this.env(g, t, 0.002, peak, dur);
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.start(t);
  }

  /** root + fifth + octave through a fuzz pedal */
  powerChord(root = 82.41, dur = 1.6, vol = 0.5) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const mult of [1, 1.4983, 2]) {
      for (const det of [-4, 5]) {
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = 'sawtooth';
        o.frequency.value = root * mult;
        o.detune.value = det;
        this.env(g, t, 0.01, vol * 0.25, dur);
        o.connect(g);
        g.connect(this.dist);
        o.start(t);
        o.stop(t + dur + 0.1);
      }
    }
  }

  sfx(name: 'smash' | 'pick' | 'hit' | 'hurt' | 'jump' | 'dive' | 'dash' | 'pickup' | 'enemyShot' | 'break' | 'die' | 'select' | 'bossDie' | 'checkpoint' | 'charge' | 'ready') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, m = this.master;
    switch (name) {
      case 'smash':
        this.noise(t, 0.15, 0.4, m, 300);
        this.osc('square', 140, t, 0.15, 0.25, m, 50);
        this.powerChord(110, 0.25, 0.25);
        break;
      case 'pick':
        this.osc('square', 1400, t, 0.06, 0.12, m, 900);
        break;
      case 'hit':
        this.noise(t, 0.08, 0.3, m, 1500);
        this.osc('square', 300, t, 0.08, 0.15, m, 120);
        break;
      case 'hurt':
        this.osc('sawtooth', 400, t, 0.3, 0.25, m, 80);
        break;
      case 'jump':
        this.osc('square', 300, t, 0.1, 0.1, m, 600);
        break;
      case 'dive':
        this.osc('square', 500, t, 0.15, 0.12, m, 1200);
        this.noise(t, 0.1, 0.1, m, 3000);
        break;
      case 'dash':
        this.noise(t, 0.2, 0.25, m, 600);
        break;
      case 'pickup':
        this.osc('square', 660, t, 0.08, 0.15, m);
        this.osc('square', 990, t + 0.08, 0.12, 0.15, m);
        break;
      case 'enemyShot':
        this.osc('triangle', 880, t, 0.12, 0.1, m, 440);
        break;
      case 'break':
        this.noise(t, 0.4, 0.4, m, 200);
        break;
      case 'die':
        this.noise(t, 0.25, 0.3, m, 500);
        this.osc('square', 220, t, 0.25, 0.15, m, 55);
        break;
      case 'bossDie':
        this.powerChord(55, 3, 0.7);
        this.noise(t, 1.5, 0.4, m, 100);
        break;
      case 'select':
        this.osc('square', 880, t, 0.05, 0.1, m);
        break;
      case 'charge':
        this.osc('sawtooth', 110, t, 0.6, 0.08, m, 520);
        break;
      case 'ready':
        this.osc('square', 1320, t, 0.06, 0.12, m);
        this.osc('square', 1760, t + 0.07, 0.1, 0.12, m);
        break;
      case 'checkpoint':
        this.osc('triangle', 523, t, 0.12, 0.2, m);
        this.osc('triangle', 659, t + 0.1, 0.12, 0.2, m);
        this.osc('triangle', 784, t + 0.2, 0.25, 0.2, m);
        break;
    }
  }

  // ----------------------------- music -----------------------------
  playSong(song: Song | null) {
    this.song = song;
    this.step = 0;
    if (this.ctx) this.nextNote = this.ctx.currentTime + 0.1;
  }
  toggleMusic() {
    this.musicOn = !this.musicOn;
    if (this.musicGain) this.musicGain.gain.value = this.musicOn ? 0.35 : 0;
  }
  private schedule() {
    const c = this.ctx;
    if (!c || !this.song) return;
    const s = this.song;
    const stepDur = 60 / s.bpm / 4;
    if (this.nextNote < c.currentTime - 0.5) this.nextNote = c.currentTime + 0.05;
    while (this.nextNote < c.currentTime + 0.12) {
      const i = this.step % 32;
      const t = this.nextNote;
      const g = this.musicGain;
      if (s.kick[i % s.kick.length] === 'x') {
        this.osc('sine', 120, t, 0.18, 0.7, g, 40);
      }
      if (s.snare[i % s.snare.length] === 'x') this.noise(t, 0.12, 0.35, g, 1200);
      if (s.hat[i % s.hat.length] === 'x') this.noise(t, 0.03, 0.12, g, 7000);
      if (s.lead) {
        const l = s.lead[i % s.lead.length];
        if (l > 0) this.osc('square', 41.2 * 8 * Math.pow(2, (l - 1) / 12), t, stepDur * 0.9, 0.06, g);
      }
      const n = s.bass[i % s.bass.length];
      if (n > 0) {
        const f = 41.2 * Math.pow(2, (n - 1) / 12);
        this.osc('sawtooth', f, t, stepDur * 1.6, 0.25, g);
        this.osc('square', f * 2, t, stepDur * 1.2, 0.08, g);
      }
      this.nextNote += stepDur;
      this.step++;
    }
  }
}

export interface Song {
  bpm: number;
  kick: string;
  snare: string;
  hat: string;
  bass: number[]; // semitones above low E (1 = E1), 0 = rest
  lead?: number[]; // optional chiptune lead, same note scale (3 octaves up)
}

const BOSS_METAL: Song = { bpm: 150, kick: 'x.x.x.x.x.x.x.x.', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', bass: [1, 1, 1, 1, 2, 1, 1, 1, 4, 1, 1, 1, 2, 1, 7, 6, 1, 1, 1, 1, 2, 1, 1, 1, 9, 8, 7, 6, 5, 4, 2, 1] };
export const BOSS_SONG = BOSS_METAL;

/** One song per world, in tour order. */
export const SONGS: Song[] = [
  // Rain City: mid-tempo grunge in E
  { bpm: 112, kick: 'x...x.....x.x...', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', bass: [1, 0, 1, 0, 1, 1, 4, 0, 6, 0, 6, 0, 4, 4, 1, 0, 1, 0, 1, 0, 1, 1, 9, 0, 8, 0, 6, 0, 4, 0, 4, 0] },
  // Rewind Video: slow sludge
  { bpm: 90, kick: 'x.......x.x.....', snare: '....x.......x...', hat: 'x...x...x...x...', bass: [1, 0, 0, 0, 1, 0, 2, 0, 1, 0, 0, 0, 11, 0, 9, 0, 1, 0, 0, 0, 1, 0, 2, 0, 4, 0, 0, 0, 2, 0, 1, 0] },
  // Skate park: fast skate punk
  { bpm: 172, kick: 'x...x...x...x...', snare: '..x...x...x...x.', hat: 'x.x.x.x.x.x.x.x.', bass: [1, 1, 1, 1, 6, 6, 6, 6, 4, 4, 4, 4, 9, 9, 8, 8, 1, 1, 1, 1, 6, 6, 6, 6, 11, 11, 9, 9, 8, 8, 6, 6] },
  // Galleria Mall: glam shuffle
  { bpm: 128, kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'xxxxxxxxxxxxxxxx', bass: [6, 6, 6, 6, 6, 6, 9, 9, 11, 11, 11, 11, 9, 9, 6, 6, 4, 4, 4, 4, 4, 4, 6, 6, 9, 9, 9, 9, 6, 6, 4, 4] },
  // Arcade: chiptune
  {
    bpm: 140, kick: 'x.....x...x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', bass: [1, 0, 13, 0, 1, 0, 13, 0, 9, 0, 21, 0, 11, 0, 23, 0, 6, 0, 18, 0, 6, 0, 18, 0, 8, 0, 20, 0, 11, 0, 23, 0],
    lead: [13, 17, 20, 25, 20, 17, 13, 17, 21, 25, 28, 25, 23, 20, 16, 20, 18, 22, 25, 30, 25, 22, 18, 22, 20, 23, 27, 32, 27, 23, 20, 0],
  },
  // The Colosseum
  BOSS_METAL,
];
