# Sonic Sense

*A game of listening in the dark.*

**Play:** <https://sonic-sense-taupe.vercel.app>

A top-down puzzle game in a world that is completely black. The only way to see
is to make a sound: your call spreads out as a wave, bends around corners, and
lights up whatever it touches — then the echo fades and the dark closes in again.

Every sound is also a risk. Blind **Wardens** hunt by ear, and the louder you
call, the further you are heard. Twenty-one chapters in three acts: the sunken
temple, the breathing dark beneath it, and the half-ruined Instrument at the
bottom of it all.

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
| `Shift` | Sneak: quiet (only a hunter within arm's reach hears it), slow — and blind |
| Left click / `E` | Throw a stone where the reticle shows |
| `Q` (hold, release) | **Focus** (Act II): a narrow call aimed at the pointer |
| `F` | **Muffle** (Act II): silence your footfalls for a few seconds |
| `R` | Restart the chapter |
| `Esc` / `P` | Pause |

A gamepad also works (stick to move, A to call, B/RT to throw, LB/LT to sneak,
X to focus, RB to muffle).

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
  Water betrays every step, even when sneaking. Hunters are nearly as fast as
  you are: once one has heard you, running rarely saves you.

### Act II — The Breathing Dark

Below the temple the rules bend. Each chapter declares the abilities it is
played with, and grants at most one new one:

- **Silt** swallows footsteps — and drinks the sound that crosses it, so the
  safest ground is also the blindest. A stone falls on it without a sound.
- **Drafts** carry sound further downwind and cut it short upwind; you can see
  the wind bend every wavefront. **Wind chimes** hung in a draft ring on their
  own: a light you cannot silence, and a lure you did not choose.
- **Moss curtains** can be walked through, but sound cannot pass them.
- **Resonator dishes** are crystals backed by a reflector: they sing in one
  direction only, and much further.
- **Tremors** are deaf — call as much as you like — but feel every step through
  the floor. **The Chorus** hunts as a pack: wake one and all come. **Sentinels**
  never move; they call on their own (their voice lights the hall for you) and
  scream for help. **Stalkers** are slow and never, ever give up.
- **Deep Listen** — stand still, and the world's own sounds reveal far more.
  **Focus** — a narrow, quiet call that strikes harder. **Lure Stone** — thrown
  stones keep chirping where they land. **Muffle** — a few silent seconds.
  Each is taught on its own screen when its chapter begins (the chapter waits
  until you have read it), the HUD shows what sets each one off, and the pause
  menu lists the abilities the current chapter is played with.

### Act III — The Instrument

At the bottom of the dark, something vast is still being played, out of tune.
Act III keeps the whole Act II kit and adds no abilities: its new things are
devices and creatures, each taught on its own lesson screen the first time it
appears, and listed in the pause menu wherever it is.

- **The five tones.** Call standing on a floor key and your voice carries its
  note — A, C, D, E or G, each with its own colour and mark (triangle, ring,
  diamond, bars, cross), so no note is told by colour alone. Elsewhere your
  calls are plain. **Tuned crystals** wake only to their own note and sing it;
  **prisms** wake to anything and always sing theirs; white crystals sing plain.
- **Singing glass** blocks the way and every sound until it is struck hard by
  its note — then it shatters for good. **Chords** need two or three notes
  ringing on the pane at once (each rings about three seconds); a note outside
  the chord is a **discord** that silences it and carries far.
- **The Mimic** repeats whatever it hears a breath and a half later, in the
  same note — your footsteps too. **Speaking tubes** carry a sound from one
  bronze mouth to the other at once, whatever it is. Every relay answers each
  sound once, so echoes never feed back.
- **Turning dishes** sing one way only; a focused call turns one a quarter step.
- **Sluice bells** flood or drain their basins: water carries notes and betrays
  steps, silt swallows both.
- **The Metronome** is deaf, but its pulse, on a strict beat with a tick before
  it, sees anything moving as it passes. **The Conductor** is slow, relentless,
  and hears every discord struck anywhere in the Instrument — which makes a
  wrong note, played on purpose far away, the best lure there is.

Progress and settings are saved in the browser.

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

Terrain bends the metric. Silt adds an absorption term integrated along each
segment. Drafts make travel cost directional — `1 − 0.35·cos(angle to the wind)`
per tile — so every straight segment is traced tile by tile for its exact wind
integral, and because cost now varies, a path bent at a cell is compared against
the straight one even with a clear line of sight (sound refracts into a draft).
Directional emitters (resonators, the focused call) gate energy by the direction
each cell's sound first left the source, carried along the virtual-source chain.

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

On top of it, `SampleBank` (`samples.ts`) plays recorded one-shots for stones,
crystal, bell, doors, Warden clicks and shrieks, pickups, the Gate, drips,
deaths and UI — plus two looping ambient beds that crossfade between the title
screen and gameplay. Samples play through the same channels as the synthesis,
with a slight random playback rate so repeats differ; the crystal is retuned by
its pitch index and the bell by its group.

**Every sound falls back to its synthesized recipe** when the sample is missing
or has not decoded yet, so the game is fully playable with no audio assets
present at all. The samples are fetched from `/assets/audio/` at runtime rather
than bundled, and `bun run build` copies whatever is in `src/assets/audio/` into
`dist/` alongside an `index.json` manifest of what is actually there — the
client reads that manifest first, so nothing absent is ever requested.

### Generated audio

Everything in `src/assets/audio/` was generated with **ElevenLabs** — sound
effects with `eleven_text_to_sound_v2`, and the title score with
`eleven_music_v2`. 24 files.

| Sound | Files | Used for |
| --- | --- | --- |
| `stone-throw`, `stone-hit`, `pickup` | 1 + 2 + 1 | Throwing, landing and gathering stones |
| `crystal`, `bell` | 1 + 1 | Resonance crystals (retuned per pitch) and bronze bells (retuned per group) |
| `door-open`, `door-close`, `tick` | 1 + 1 + 1 | Stone slabs and the timed-door countdown |
| `warden-click`, `warden-shriek` | 3 + 1 | Warden echolocation and alarm |
| `shard`, `gate-hum`, `gate-awake` | 1 + 1 + 1 | Echo Shards and the Gate |
| `drip` | 2 | Cave drips |
| `death-pit`, `death-warden`, `complete` | 1 + 1 + 1 | Endings |
| `ui-select` | 1 | Menu selection |
| `ambience-loop`, `title-loop` | 1 + 1 | Cave bed (30 s) and title score (60 s), crossfaded |

One-shots are mono and peak-normalized so the per-sound gains in `sounds.ts`
set the balance; the two loops stay stereo and sit well below them.

The Act II sounds — sentinel calls, tremor footfalls, wind chimes, the focused
call, Muffle, lure chirps, soft steps on silt and the wind bed that swells in
drafts — are synthesized; no samples exist for them yet. So are the Act III
sounds (`sounds-instrument.ts`): the note a keyed call sings, glass ringing,
clinking and shattering, discords, the Mimic, the tubes, turning dishes,
sluices and the Metronome — synthesis keeps every note exactly in tune with the
crystals.

**Still synthesized on purpose.** The call (`pulse`), the footsteps on stone
and in water, and the menu hover tick sounded better procedural in play-testing,
so no sample ships for them. The call especially benefits: each echo tap is re-rendered at its own
delay and charge instead of replaying one fixed recording. A stone landing in
water is synthesized too, since no generated sample covers it.

The heartbeat, the room echo taps, the cave reverb and all spatialization
remain procedural.

## Project layout

```
index.ts               Bun server (HTML import)
src/main.ts            Boot
src/app.ts             Modes, level flow, UI + audio wiring
src/game/              Simulation: world, entities, sound fields, levels, effects
src/render/            WebGL2 renderer and GLSL (scene, sonar, entities, post)
src/audio/             Audio engine, sample bank, recipes, ambience
src/assets/audio/      Generated sound effects and ambient loops (ElevenLabs)
src/ui/                DOM overlay (menus, HUD, cards)
tests/                 Solver, level solvability, simulation, scripted playthroughs
tools/                 Screenshot harness and level analysis
```

Levels are ASCII maps (`src/game/levels`):

| Char | Meaning | Char | Meaning |
| --- | --- | --- | --- |
| `#` | Wall | `.` `,` `"` | Floor (plain, rubble, moss) |
| `@` | Start | `X` | The Gate |
| `*` | Echo Shard | `o` | Chasm |
| `~` | Water | `:` | Silt |
| `>` `<` `v` `^` | Draft (blowing that way) | `%` | Moss curtain |
| `&` | Wind chime | `C` | Resonance crystal |
| `W` | Warden | `s` `m` `d` | Stone pile, glow-caps, drip |
| `1`–`9` | Door of that group | other | Legend: bells (sluice bells too), hints, waypoints, creatures, resonators, keys, tuned crystals and prisms, glass, mimics, tubes, basins |

`bun test` checks every chapter two ways. A static solver proves each one is
solvable with exactly the abilities it declares — including doors opened by
sound relayed through crystals and aimed resonators, and bells reached only on
the wind (it solves each field backwards from the target with the wind negated;
directional cost is antisymmetric, so that yields the forward costs exactly).
For the Instrument it also tracks the note of every sound, relays through
crystals, prisms, mimics, tubes and bells, every way the turning dishes can
face, every state the sluices can reach, and — for chords and timed doors —
follows a single call through everything it sets off, with real travel times
and delays, played against a metronome's beat where there is one (`check-*.ts`).
Tests prove each chapter's new device is actually needed. And a scripted bot
plays the chapters start to finish through the real simulation — luring,
sneaking past and timing its way around the creatures exactly as a player would.
