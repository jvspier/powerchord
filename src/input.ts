// Keyboard (+ optional mouse/gamepad) input with edge detection.
export class Input {
  private down = new Set<string>();
  private pressedSet = new Set<string>();
  mouseDX = 0;
  locked = false;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.pressedSet.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    canvas.addEventListener('mousedown', (e) => {
      const code = e.button === 0 ? 'Mouse0' : e.button === 2 ? 'Mouse2' : 'Mouse1';
      this.pressedSet.add(code);
      this.down.add(code);
    });
    window.addEventListener('mouseup', (e) => this.down.delete(e.button === 0 ? 'Mouse0' : e.button === 2 ? 'Mouse2' : 'Mouse1'));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => (this.locked = document.pointerLockElement === canvas));
    window.addEventListener('mousemove', (e) => {
      if (this.locked) this.mouseDX += e.movementX;
    });
  }
  requestLock() {
    if (!this.locked) this.canvas.requestPointerLock?.();
  }
  releaseLock() {
    if (this.locked) document.exitPointerLock?.();
  }
  held(...codes: string[]) {
    return codes.some((c) => this.down.has(c));
  }
  pressed(...codes: string[]) {
    return codes.some((c) => this.pressedSet.has(c));
  }
  /** call at end of each fixed update */
  endFrame() {
    this.pressedSet.clear();
    this.mouseDX = 0;
  }

  // ---- gamepad: buttons are mapped onto the equivalent keyboard codes ----
  padX = 0;
  padY = 0;
  private padPrev: boolean[] = [];
  private static PAD_MAP: Record<number, string> = {
    0: 'Space', 1: 'KeyK', 2: 'KeyJ', 3: 'KeyL', 4: 'KeyC', 5: 'ShiftLeft', 6: 'KeyQ', 7: 'KeyE',
    8: 'Escape', 9: 'Enter', 12: 'ArrowUp', 13: 'ArrowDown', 14: 'ArrowLeft', 15: 'ArrowRight',
  };
  pollPad() {
    const pads = navigator.getGamepads?.() ?? [];
    let pad: Gamepad | null = null;
    for (const p of pads) if (p) { pad = p; break; }
    this.padX = this.padY = 0;
    if (!pad) return;
    const dz = (v: number) => (Math.abs(v) < 0.22 ? 0 : v);
    this.padX = dz(pad.axes[0] ?? 0);
    this.padY = -dz(pad.axes[1] ?? 0);
    for (const k in Input.PAD_MAP) {
      const i = +k;
      const on = !!pad.buttons[i]?.pressed;
      const code = Input.PAD_MAP[i];
      if (on && !this.padPrev[i]) { this.pressedSet.add(code); this.down.add(code); }
      if (!on && this.padPrev[i]) this.down.delete(code);
      this.padPrev[i] = on;
    }
  }
}
