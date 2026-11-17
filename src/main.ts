import { Game } from './game';
import { W, H } from './renderer';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Game(canvas);
(window as unknown as { game: Game }).game = game;

function resize() {
  // integer scaling keeps pixels perfectly crisp
  const s = Math.max(1, Math.floor(Math.min(window.innerWidth / W, window.innerHeight / H)));
  canvas.style.width = `${W * s}px`;
  canvas.style.height = `${H * s}px`;
}
window.addEventListener('resize', resize);
resize();
canvas.focus();

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
