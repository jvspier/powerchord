# POWER CHORD — a grunge odyssey

A browser-based 2.5D pixel-art metroidvania written in TypeScript on a plain HTML canvas.
No 3D engine: every voxel is drawn by a small custom software rasterizer.

You play a flannel-wearing 90s grunge guitarist touring four worlds to take down
**Rikki Spandex**, the evil 80s hair-metal guitar god. Fight with your guitar:
smash enemies with it, throw guitar picks, or unleash a distorted **power chord** shockwave.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build into dist/
```

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Move | WASD / arrows | left stick / d-pad |
| Jump (again in mid-air: Stage Dive) | Space | A |
| Guitar smash (also bats projectiles back) | J / left click | X |
| Throw pick (soft auto-aim) | K / right click | B |
| Power chord (costs feedback, breaks amp walls) | L / R | Y |
| Mosh dash | Shift | RB |
| Toggle isometric ⇄ third person | C / Tab | LB |
| Rotate camera | Q / E | LT / RT |
| Interact (tour van) / confirm | Enter / F | Start |
| Pause | Esc / P | Back |
| Music on/off, FPS | M, ` | |

## The tour

Four 90s locations, each procedurally generated around a clear theme. The layout is
re-rolled for every new game (the seed is stored in your save so backtracking stays consistent).

1. **Rain City** — rainy downtown streets, brick buildings, parked cars, payphones.
   Boss: The A&R Man → learn **Power Chord**
2. **Rewind Video** — a VHS rental store: carpet, aisles of tape shelves with neon genre signs,
   TV walls full of static, posters, the checkout counter. Blocked by a wall of TVs only a power chord
   can blow out. Boss: Late Fee Larry → learn **Stage Dive** (double jump)
3. **Galleria Mall** — checkerboard concourse, storefronts (arcades, record stores, clothes, toys),
   palm planters, kiosks, a fountain and a food court. The escalator is busted, so you'll need to
   stage-dive to the upper level. Boss: DJ Synthax → learn **Mosh Dash**
4. **The Colosseum** — the concert venue: stadium stands, lighting trusses, speaker stacks, crowd
   barriers and pyro vents. Dash across the mosh pit to reach the main stage and face Rikki Spandex.

Every world also hides a **mixtape** (+1 max health) sealed in a closet behind a breakable wall,
and a **pick pouch** (+2 picks) on a tower that needs the double jump, so you'll want to backtrack
with the tour van. Progress is saved in `localStorage`.

## How it works

- `src/renderer.ts` — 384×216 framebuffer with a float z-buffer (1/z). Voxel faces are
  transformed with 3×4 matrices, back-face culled, near-plane clipped (Sutherland–Hodgman)
  and scan-converted as convex polygons with top-left fill rules. A post pass adds sky,
  distance fog and depth-discontinuity outlines; characters hidden behind walls get a dithered
  x-ray silhouette. The canvas is upscaled with integer nearest-neighbour scaling.
- `src/camera.ts` — the camera never cuts. Pitch, yaw, the visible height at the target and
  `tan(fov/2)` are interpolated (log space) between a ~1° near-orthographic isometric view and
  a 62° perspective third-person view, i.e. a dolly zoom. Third-person camera collision is
  blended in only near the end of the transition, so nothing pops.
- `src/voxels.ts` — voxel grid, materials and 16×16 chunk meshing with baked sun shadows
  (ray-marched), per-face ambient occlusion and per-voxel colour jitter. Chunks re-mesh when
  amp walls are destroyed.
- `src/worlds.ts` — seeded procedural generation of each world: heightmaps, streets,
  buildings, forests, creeks, neon strips, lava, gates, arenas and secrets.
- `src/models.ts` — voxel characters built from parts plus a shared animation rig
  (walk cycles, guitar swings, power-chord poses, headbanging).
- `src/game.ts` — gameplay, enemy/boss AI, HUD and menus. `src/audio.ts` — WebAudio synth
  (fuzzed power chords, SFX and a small step sequencer for music).
