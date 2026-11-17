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

  // gamepad (polled)
  pad(): Gamepad | null {
    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) if (p) return p;
    return null;
  }
}
