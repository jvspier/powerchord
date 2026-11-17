// On-screen controls for phones/tablets: a floating thumbstick on the left,
// action buttons on the right, and taps on the game screen for menus.
import type { Game } from './game';
import { W, H } from './renderer';

export function isTouchDevice() {
  return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

export function setupTouch(game: Game, canvas: HTMLCanvasElement) {
  const root = document.getElementById('touch')!;
  const zone = document.getElementById('stickzone')!;
  const stick = document.getElementById('stick')!;
  const knob = document.getElementById('knob')!;
  const inp = game.input;
  const enable = () => {
    if (document.body.classList.contains('touch')) return;
    document.body.classList.add('touch');
    game.touch = true;
    window.dispatchEvent(new Event('resize'));
  };
  if (isTouchDevice()) enable();
  window.addEventListener('touchstart', enable, { passive: true });

  // taps on the game screen (title, dialogs, tour-van map, pause, victory)
  const tapAt = (cx: number, cy: number) => {
    const r = canvas.getBoundingClientRect();
    game.tap(((cx - r.left) / r.width) * W, ((cy - r.top) / r.height) * H);
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    e.preventDefault();
    game.audio.init();
    tapAt(e.clientX, e.clientY);
  });

  // ---- floating thumbstick ----
  let stickId = -1, ox = 0, oy = 0;
  const R = 46;
  const home = () => {
    stick.style.left = '';
    stick.style.top = '';
    knob.style.transform = '';
    inp.touchX = inp.touchY = 0;
  };
  zone.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    game.audio.init();
    if (game.state !== 'play') { tapAt(e.clientX, e.clientY); return; }
    if (stickId !== -1) return;
    stickId = e.pointerId;
    try { zone.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    ox = e.clientX; oy = e.clientY;
    stick.style.left = `${ox}px`;
    stick.style.top = `${oy}px`;
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== stickId) return;
    let dx = e.clientX - ox, dy = e.clientY - oy;
    const l = Math.hypot(dx, dy);
    if (l > R) { dx = (dx / l) * R; dy = (dy / l) * R; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const m = Math.min(1, l / R);
    const k = m < 0.18 ? 0 : (m - 0.18) / 0.82;
    inp.touchX = l > 0 ? (dx / Math.min(l, R)) * k : 0;
    inp.touchY = l > 0 ? (-dy / Math.min(l, R)) * k : 0;
  });
  const endStick = (e: PointerEvent) => {
    if (e.pointerId !== stickId) return;
    stickId = -1;
    home();
  };
  zone.addEventListener('pointerup', endStick);
  zone.addEventListener('pointercancel', endStick);

  // ---- buttons: each maps onto the equivalent keyboard key ----
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('.btn'))) {
    const code = el.dataset.key!;
    const up = (e: PointerEvent) => {
      e.preventDefault();
      el.classList.remove('on');
      inp.release(code);
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      game.audio.init();
      try { el.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      el.classList.add('on');
      // menus/dialogs: action-ish buttons confirm
      if (game.state !== 'play' && (code === 'Space' || code === 'KeyJ' || code === 'Enter')) { inp.press('Enter'); inp.release('Enter'); }
      inp.press(code);
    });
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', () => { el.classList.remove('on'); inp.release(code); });
  }

  // dim buttons for abilities you haven't learned yet
  const abilityBtns = Array.from(root.querySelectorAll<HTMLElement>('[data-ability]'));
  setInterval(() => {
    for (const el of abilityBtns) el.classList.toggle('locked', !game.has(el.dataset.ability as never));
  }, 500);
}
