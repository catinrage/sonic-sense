# Sonic Sense

*A game of listening in the dark.*

**Play:** <https://sonic-sense-taupe.vercel.app>

A top-down puzzle game in a world that is completely black. The only way to see
is to make a sound: your call spreads out as a wave, bends around corners, and
lights up whatever it touches — then the echo fades and the dark closes in again.

Every sound is also a risk. Blind **Wardens** hunt by ear, and the louder you
call, the further you are heard.

## Play

```bash
bun install
bun run dev
```

Open the printed URL (default <http://localhost:3000>) in a desktop browser with
WebGL2 (Chrome, Edge, Firefox, Safari 15+). Headphones are recommended — echoes
are panned to where they bounced.

| Input | Action |
| --- | --- |
| `W A S D` / arrows | Move (your footsteps quietly reveal the floor underfoot) |
| `Space` (hold, release) | Call out — hold longer for a louder call that reaches further |
| `Shift` | Sneak: silent, slow — and blind |
| Left click / `E` | Throw a stone where the reticle shows |
| `R` | Restart the chapter |
| `Esc` / `P` | Pause |

A gamepad also works (stick to move, A to call, B/RT to throw, LB/LT to sneak).

## The rules of the dark

- **Calls** reveal the world as an expanding wavefront that travels around
  corners. Surfaces flash as the front hits them, glow while the echo lingers,
  and leave a faint remembered outline behind.
- **Chasms** swallow sound-light: where no echo returns, there is no floor.
- **Echo Shards** must be gathered before the **Gate** wakes. The Gate hums
  periodically — follow its golden echo.
- **Resonance crystals** re-sing any sound that strikes them. Use them to carry
  your voice to places it cannot reach, or as loud decoys.
- **Bronze bells** open their doors when a wave reaches them with enough force.
  Some doors only stay open for a few seconds.
- **Wardens** click to find their way (you will see them in red). They hunt the
  source of anything they hear — calls, footsteps, splashes, clattering stones.
  Water betrays every step, even when sneaking.

Seven chapters teach and then combine these ideas. Progress and settings are
saved in the browser.

## Scripts

| Command | What it does |
| --- | --- |
| `bun run dev` | Dev server (rebuilds on reload) |
| `bun run start` | Production-mode server |
| `bun run build` | Static bundle in `dist/` |
| `bun test` | Unit, simulation and full-playthrough tests |
| `bun run typecheck` | TypeScript check |
| `bun tools/level-map.ts [n]` | Print a chapter's map with reachability analysis |
| `bun tools/shot.ts <scenario>` | Headless screenshots (needs Chrome) |

## How it works

**Sound propagation** (`src/game/geodesic.ts`). Every sound solves a geodesic
distance field on a quarter-tile grid with an any-angle Dijkstra (Theta\*-style
virtual sources). Cells that see the source get exact Euclidean distance, so
fronts stay perfectly round in open space and wrap smoothly around corners.
Each cell also stores the direction of travel and an energy term that falls off
as the wave diffracts into shadow. Big fields are solved progressively, just
ahead of the visible front. The same fields drive gameplay: creatures, crystals
and bells react exactly when the visible front reaches them.

**Rendering** (`src/render`, WebGL2). All fields live in one texture array.
A full-screen raycaster marches each pixel through the tile height field, so
walls rise with real perspective and chasms fall away. Floors, walls, water and
doors are procedural materials lit by the waves: grazing light from each wave's
direction of travel, a flash as the front passes, a phosphor-like afterglow that
dissolves into grain, and a world-space memory buffer that keeps a faint
outline of what you have heard. Creatures and props are signed-distance-field
shaders with analytic normals, lit by the same sonar. Post-processing adds a
dual-filter bloom, a shock-wave distortion ahead of loud fronts, chromatic
aberration, filmic tone mapping and grain.

**Audio** (`src/audio`). Two layers over one Web Audio graph. The graph itself
is procedural: spatial channels (distance gain, lowpass, pan, reverb send), room
echoes ray-cast against the level so small rooms answer quickly and halls slowly,
a cave reverb generated at startup, and a heartbeat that quickens as danger nears.

On top of it, `SampleBank` (`samples.ts`) plays recorded one-shots for the call,
footsteps, stones, crystal, bell, doors, Warden clicks and shrieks, pickups, the
Gate, deaths and UI — plus two looping ambient beds that crossfade between the
title screen and gameplay. Samples play through the same channels as the
synthesis, with a slight random playback rate so repeats differ; the crystal is
retuned by its pitch index and the bell by its group.

**Every sound falls back to its synthesized recipe** when the sample is missing
or has not decoded yet, so the game is fully playable with no audio assets
present at all. The samples are fetched from `/assets/audio/` at runtime rather
than bundled, and `bun run build` copies whatever is in `src/assets/audio/` into
`dist/` alongside an `index.json` manifest of what is actually there — the
client reads that manifest first, so nothing absent is ever requested.

## Project layout

```
index.ts               Bun server (HTML import)
src/main.ts            Boot
src/app.ts             Modes, level flow, UI + audio wiring
src/game/              Simulation: world, entities, sound fields, levels, effects
src/render/            WebGL2 renderer and GLSL (scene, sonar, entities, post)
src/audio/             Audio engine, sample bank, recipes, ambience
src/assets/audio/      Generated sound effects and ambient loops (optional)
src/ui/                DOM overlay (menus, HUD, cards)
tests/                 Solver, level solvability, simulation, scripted playthroughs
tools/                 Screenshot harness and level analysis
```

Levels are ASCII maps (`src/game/levels`). `bun test` checks every chapter two
ways: a static solver proves each one is solvable (including doors that only
open when sound is relayed through crystals), and a scripted bot plays each
chapter start to finish through the real simulation — luring, sneaking past and
timing its way around the Wardens exactly as a player would.
