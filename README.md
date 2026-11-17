# POWER CHORD — a grunge odyssey

A browser-based 2.5D pixel-art metroidvania written in TypeScript on a plain HTML canvas.
No 3D engine: every voxel is drawn by a small custom software rasterizer.

You play a flannel-wearing 90s grunge guitarist (with a sonic-blue offset-waist guitar) touring six 90s
worlds — city streets, a VHS rental store, a skate park, a mall, an arcade and a concert venue — to take down
**Rikki Spandex**, the evil 80s hair-metal guitar god. Fight with your guitar: smash enemies with it
(hold for a charged finisher), throw guitar picks, or unleash a distorted **power chord** shockwave.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build into dist/
```

## Play it

**https://jvspier.github.io/powerchord/** — published to GitHub Pages by `.github/workflows/pages.yml` on every push.

On a phone (iPhone/Android): open the link, turn the phone sideways and play with the on-screen
controls — a floating thumbstick on the left, JUMP / SMASH / PICK / CHORD / DASH / ACT on the right,
and pause / rotate / music on the edge. Hold SMASH after a hit to charge the finisher. Tap the screen
to start, advance dialogue and pick gigs in the tour van. The ⛶ button (top-left) goes
fullscreen where the browser allows it (Android, iPad); iPhone Safari doesn't allow fullscreen web pages,
so there it explains **Share → Add to Home Screen**, which launches the game without browser bars. (On iPhone, turn off silent mode to hear the music.)

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Move | WASD / arrows | left stick / d-pad |
| Jump (again in mid-air: Stage Dive) | Space | A |
| Guitar smash (also bats projectiles back) | J / left click | X |
| Charged finisher: keep holding after a smash, release when it flashes (costs feedback) | hold J | hold X |
| Throw pick (soft auto-aim) | K / right click | B |
| Power chord (costs feedback, breaks amp walls) | L / R | Y |
| Mosh dash | Shift | RB |
| Rotate the isometric view | Q / E | LT / RT |
| Interact (tour van) / confirm | Enter / F | Start |
| Pause | Esc / P | Back |
| Music on/off, FPS | M, ` | |

## The tour

Six 90s locations, each procedurally generated around a clear theme. The layout is
re-rolled for every new game (the seed is stored in your save so backtracking stays consistent).

1. **Rain City** — rainy downtown streets, brick buildings, parked cars, payphones.
   Boss: The A&R Man → learn **Power Chord**
2. **Rewind Video** — a VHS rental store: carpet, aisles of tape shelves with neon genre signs,
   TV walls full of static, posters, the checkout counter. Blocked by a wall of TVs only a power chord
   can blow out. Boss: Late Fee Larry → learn **Stage Dive** (double jump)
3. **Shred Park** — a sunset skate park: pool bowls with coping, quarter pipes, fun-box pyramids,
   grind rails, ledges, graffiti walls, palms and a chain-link fence. The vert ramp is too tall without a
   stage dive. Boss: Rad Chad → **Triple Pick** (picks fan out three at a time)
4. **Galleria Mall** — checkerboard concourse, storefronts (arcades, record stores, clothes, toys),
   palm planters, kiosks, a fountain and a food court. The escalator is busted, so you'll need to
   stage-dive to the upper level. Boss: DJ Synthax → learn **Mosh Dash**
5. **Pixel Palace** — an arcade: cosmic carpet, back-to-back rows of cabinets with glowing
   marquees, pinball tables, a dance machine and the prize counter. The floor has caved in, so dash
   across. Boss: Game Over Gary → **Overdrive** (cheaper, bigger, harder power chords)
6. **The Colosseum** — the concert venue: stadium stands, lighting trusses, speaker stacks, crowd
   barriers and pyro vents. Dash across the mosh pit to reach the main stage and face Rikki Spandex.

Every world also hides a **mixtape** (+1 max health) sealed in a closet behind a breakable wall,
and a **pick pouch** (+2 picks) on a tower that needs the double jump, so you'll want to backtrack
with the tour van. Progress is saved in `localStorage`.

## How it works

- `src/renderer.ts` — 384×216 framebuffer with a float z-buffer (1/z). Voxel faces are
  transformed with 3×4 matrices, back-face culled, near-plane clipped (Sutherland–Hodgman)
  and scan-converted with perspective-correct texture mapping. A post pass adds a banded,
  ordered-dithered sky, dithered fog, light rims on convex top edges, dark outlines around
  characters and depth edges, and a soft neon glow; characters hidden behind walls get a
  dithered x-ray silhouette. The canvas is upscaled with integer nearest-neighbour scaling.
- `src/textures.ts` — procedural 16-bit style textures (bricks, slabs, beveled mall tiles,
  carpet, planks, VHS spines, CRT scanlines, chain link, foliage...). Texels store shade levels,
  so each face builds an 8-colour ramp from its lit colour, and textures are mapped in world
  space so patterns flow across neighbouring voxels instead of repeating per cube. Contact
  shadows at the foot of walls are dithered bands computed per texel.
- `src/camera.ts` — gameplay is isometric (pixel-snapped so the world scrolls in whole
  pixels, like a console background layer). For special moments — the power chord, boss
  intros, boss finishes and the charged guitar-smash finisher — the camera swoops into a cinematic third-person shot and back
  without cutting: pitch, yaw, the visible height at the target and `tan(fov/2)` are
  interpolated between a ~1° near-orthographic view and a 62° perspective view (a dolly zoom),
  while a cutaway that grows with the transition peels away any walls between the camera and the hero.
- `src/voxels.ts` — voxel grid, materials and 16×16 chunk meshing with baked sun shadows
  (ray-marched), per-face ambient occlusion and per-voxel colour jitter. Chunks re-mesh when
  amp walls are destroyed.
- `src/worlds.ts` — seeded procedural generation of each world: heightmaps, streets,
  buildings, forests, creeks, neon strips, lava, gates, arenas and secrets.
- `src/models.ts` — voxel characters built from parts plus a shared animation rig
  (walk cycles, guitar swings, power-chord poses, headbanging).
- `src/game.ts` — gameplay, enemy/boss AI, HUD and menus. `src/audio.ts` — WebAudio synth
  (fuzzed power chords, SFX and a small step sequencer for music).
