import { Game } from './game';
import { W, H } from './renderer';
import { setupTouch } from './touch';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Game(canvas);
(window as unknown as { game: Game }).game = game;

function resize() {
  const vw = window.visualViewport?.width ?? window.innerWidth;
  const vh = window.visualViewport?.height ?? window.innerHeight;
  // whole-number scaling keeps pixels perfectly even on big screens; phones get
  // the largest fractional scale that fits (nearest-neighbour keeps it crisp)
  let s = Math.min(vw / W, vh / H);
  if (s >= 2) s = Math.floor(s);
  canvas.style.width = `${Math.floor(W * s)}px`;
  canvas.style.height = `${Math.floor(H * s)}px`;
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));
window.visualViewport?.addEventListener('resize', resize);
resize();
canvas.focus();

setupTouch(game, canvas);
// iOS only lets audio start from inside a user gesture
const unlock = () => game.audio.init();
document.addEventListener('touchend', unlock, { passive: true });
document.addEventListener('click', unlock);
// pause when the app is backgrounded
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.state === 'play') game.state = 'pause';
  if (game.audio.ctx) document.hidden ? game.audio.ctx.suspend() : game.audio.ctx.resume();
});

const STEP = 1 / 60;
let last = performance.now();
let acc = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt;
  game.fps = game.fps * 0.95 + (dt > 0 ? 1 / dt : 60) * 0.05;
  while (acc >= STEP) {
    game.update(STEP);
    acc -= STEP;
  }
  game.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
