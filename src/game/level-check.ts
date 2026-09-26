import type { Vec2 } from "../core/math";
import { DISH_TURN_TRIGGER, FULL_CALL, focusProfile, METRONOME_PULSE } from "./calls";
import { creatureTraits } from "./entities/warden-traits";
import { Acoustics, relaysOf, TONES, WHITE, type PaneEars, type Relay, type Strike, type Voice } from "./check-acoustics";
import { provePanesAndTimedDoors } from "./check-timing";
import { paneFaces } from "./entities/glass";
import { SoundGrid } from "./geodesic";
import { DECOR, TILE, type Ability, type LevelData } from "./level-types";

/** A wave the checker reasons about: how far it reaches and how hard it strikes. */
export interface Probe {
  radius: number;
  strength: number;
  /** A directional emitter's beam half-angle; sources then need a `facing`. */
  halfAngle?: number;
}

/** Where a probe is emitted from; `facing` aims a directional probe. */
export interface Emitter {
  x: number;
  y: number;
  facing?: Vec2 | null;
}

/** Something that opens a door group when sound reaches it hard enough. */
export interface Opener {
  kind: "bell";
  x: number;
  y: number;
  group: number;
  threshold: number;
}

/**
 * The waves the player can make with a given kit. Derived from the same
 * profiles the creature uses, so the proof and the game cannot drift. A focused
 * call is aimed by the player, so it is modelled as always pointing at its target.
 */
export function callProfiles(abilities: ReadonlySet<Ability>): Probe[] {
  const probes: Probe[] = [{ radius: FULL_CALL.radius, strength: FULL_CALL.strength }];
  if (abilities.has("focus")) {
    const focus = focusProfile(1);
    probes.push({ radius: focus.radius, strength: focus.strength });
  }
  return probes;
}

/** Every door opener in a level (bells that are not sluice bells). */
export function openersOf(level: LevelData): Opener[] {
  return level.bells.filter((b) => !b.toggle).map((b) => ({ kind: "bell", x: b.x, y: b.y, group: b.group, threshold: b.threshold }));
}

export interface LevelReport {
  errors: string[];
  /** Tiles the player can stand on once every ringable door is open. */
  reachable: Uint8Array;
  /** Door groups the player can open (timed ones included once they can be passed in time). */
  openedGroups: number[];
  /** Panes of glass the player can break, by index. */
  shattered: number[];
}

export interface CheckOptions {
  /** Whether crystals relay sound (off: prove a level needs its crystals). */
  crystals?: boolean;
  mimics?: boolean;
  tubes?: boolean;
  /** Whether a focused call may turn dishes. */
  turning?: boolean;
}

/** What the player has to work with in one state of the level. */
export interface Situation {
  level: LevelData;
  ac: Acoustics;
  relays: readonly Relay[];
  panes: readonly PaneEars[];
  /** Reachable tiles, and their centres grouped by the tone a call made there carries. */
  reachable: Uint8Array;
  stand: Vec2[][];
  call: Voice;
  /** The focused call, aimed at whatever it is tested against; null without Focus. */
  focus: Voice | null;
  /**
   * Sounds the level makes on its own, again and again: a metronome's pulse from
   * where it keeps its beat. Unpitched; the player chooses when to answer them.
   */
  ambient: { at: Vec2; voice: Voice }[];
  /** Directions each relay may sing along: one, or four for a dish a focused call can turn. */
  facings: (Vec2 | null)[][];
  /** Tones each relay can be made to answer with, by some call from somewhere reachable. */
  awake: Set<number>[];
  /** What is already open for good, and broken. */
  open: ReadonlySet<number>;
  broken: ReadonlySet<number>;
}

/** Latched progress: doors that stay open, doors that can be passed in time, glass that is gone. */
interface Progress {
  open: Set<number>;
  passable: Set<number>;
  broken: Set<number>;
}

/**
 * Static solvability check. Flood-fills walkable ground, then works out which
 * doors the player can open, which glass it can break and which sluices it can
 * turn — by any call from anywhere reachable, carried by any chain of crystals,
 * mimics, tubes and bells, in any flood state the sluices can reach — and
 * repeats until nothing changes. Chords and timed doors need one call's timing
 * and are proven call by call (check-timing.ts). Creatures are ignored.
 */
export function checkLevel(level: LevelData, opts: CheckOptions = {}): LevelReport {
  const errors = lint(level);
  const relays = relaysOf(level, { crystals: opts.crystals ?? true, mimics: opts.mimics ?? true, tubes: opts.tubes ?? true });
  const panes: PaneEars[] = level.glass.map((pane) => ({ pane, faces: paneFaces(level.w, level.h, level.tiles, pane) }));
  panes.forEach((p, i) => p.faces.length === 0 && errors.push(`glass #${i + 1} has no open side to hear from`));
  const basinGroups = [...new Set(level.basins.map((b) => b.group))].sort((a, b) => a - b);
  const progress: Progress = { open: new Set(), passable: new Set(), broken: new Set() };
  const floods = new Set([basinGroups.reduce((m, g, i) => (level.basins.some((b) => b.group === g && b.flooded) ? m | (1 << i) : m), 0)]);
  const grids = new Map<string, Acoustics>();
  const turning = opts.turning ?? true;

  const situation = (fs: number): Situation => {
    const key = [[...progress.open].sort(), [...progress.broken].sort(), fs].join("|");
    let ac = grids.get(key);
    if (!ac) {
      const flooded = new Map(basinGroups.map((g, i) => [g, (fs & (1 << i)) !== 0]));
      ac = new Acoustics(soundGridFor(level, progress.open, "backward", { broken: progress.broken, flooded }), FULL_CALL.radius);
      grids.set(key, ac);
    }
    return situate(level, ac, relays, panes, flood(level, progress), progress, turning);
  };

  for (;;) {
    let changed = false;
    for (const fs of [...floods]) {
      const s = situation(fs);
      const add = (set: Set<number>, v: number) => !set.has(v) && (set.add(v), (changed = true));
      relays.forEach((r, k) => {
        if (r.kind !== "bell" || s.awake[k]!.size === 0) return;
        const bell = level.bells[r.index]!;
        const basin = basinGroups.indexOf(bell.group);
        if (bell.toggle && basin >= 0) add(floods, fs ^ (1 << basin));
        else if (!bell.toggle && bell.timed <= 0) add(progress.open, bell.group);
      });
      for (const i of singlePanesBroken(s)) add(progress.broken, i);
    }
    if (changed) continue;
    // Nothing more latches from single waves: now what needs one call's timing.
    for (const fs of floods) {
      const proven = provePanesAndTimedDoors(situation(fs), progress.passable);
      for (const i of proven.broken) !progress.broken.has(i) && (progress.broken.add(i), (changed = true));
      for (const g of proven.passable) !progress.passable.has(g) && (progress.passable.add(g), (changed = true));
    }
    if (!changed) break;
  }

  const reachable = flood(level, progress);
  const at = (p: Vec2) => reachable[Math.floor(p.y) * level.w + Math.floor(p.x)] === 1;
  if (level.exit && !at(level.exit)) errors.push("exit is unreachable");
  level.shards.forEach((s, i) => !at(s) && errors.push(`shard #${i + 1} at (${Math.floor(s.x)}, ${Math.floor(s.y)}) is unreachable`));
  return {
    errors,
    reachable,
    openedGroups: [...progress.open, ...progress.passable].sort((a, b) => a - b),
    shattered: [...progress.broken].sort((a, b) => a - b),
  };
}

function lint(level: LevelData): string[] {
  const errors: string[] = [];
  const { w, h, tiles } = level;
  for (let x = 0; x < w; x++) {
    if (tiles[x] !== TILE.Wall || tiles[(h - 1) * w + x] !== TILE.Wall) errors.push(`open border at column ${x}`);
  }
  for (let y = 0; y < h; y++) {
    if (tiles[y * w] !== TILE.Wall || tiles[y * w + w - 1] !== TILE.Wall) errors.push(`open border at row ${y}`);
  }
  if (!level.exit) errors.push("no exit ('X')");
  const groups = new Set<number>();
  level.doorGroup.forEach((g) => g > 0 && groups.add(g));
  const openers = openersOf(level);
  for (const g of groups) if (!openers.some((o) => o.group === g)) errors.push(`door group ${g} has no opener`);
  for (const o of openers) if (!groups.has(o.group)) errors.push(`${o.kind} at (${o.x}, ${o.y}) opens no door (group ${o.group})`);
  const basins = new Set(level.basins.map((b) => b.group));
  for (const b of level.bells) if (b.toggle && !basins.has(b.group)) errors.push(`sluice bell at (${b.x}, ${b.y}) has no basin (group ${b.group})`);
  for (const g of basins) if (!level.bells.some((b) => b.toggle && b.group === g)) errors.push(`basin group ${g} has no sluice bell`);
  return errors;
}

/** Everything the player can do in one state of the level, before timing matters. */
function situate(
  level: LevelData,
  ac: Acoustics,
  relays: readonly Relay[],
  panes: readonly PaneEars[],
  reachable: Uint8Array,
  progress: Progress,
  turning: boolean,
): Situation {
  const stand: Vec2[][] = TONES.map(() => []);
  reachable.forEach((r, i) => {
    if (!r) return;
    const key = level.keys[i]!;
    stand[key >= 0 ? key : WHITE]!.push({ x: (i % level.w) + 0.5, y: Math.floor(i / level.w) + 0.5 });
  });
  const abilities = new Set(level.def.abilities ?? []);
  const call: Voice = FULL_CALL;
  const focus: Voice | null = abilities.has("focus") ? { ...focusProfile(1), halfAngle: undefined } : null;
  const ambient = level.wardens.flatMap((w) => {
    const traits = creatureTraits(w.creature);
    return traits.beat > 0 ? [{ at: { x: w.x, y: w.y }, voice: { ...METRONOME_PULSE, radius: traits.pulseRadius } }] : [];
  });
  const s: Situation = { level, ac, relays, panes, reachable, stand, call, focus, ambient, facings: [], awake: [], open: progress.open, broken: progress.broken };

  s.facings = relays.map((r) => {
    const turned = turning && focus && r.turnable && TONES.some((t) => ac.best(stand[t]!, focus, r.ear.x, r.ear.y) >= DISH_TURN_TRIGGER);
    if (!turned) return [r.facing];
    const f = r.facing!;
    return [f, { x: -f.y, y: f.x }, { x: -f.x, y: -f.y }, { x: f.y, y: -f.x }];
  });
  s.awake = awaken(s);
  return s;
}

/**
 * The most any call of the player's, carrying `tone`, delivers to `at` — or, for
 * unpitched sound, anything the level keeps sounding by itself. `anyTone` ignores the tone.
 */
export function playerHeard(s: Situation, at: Vec2, focus: boolean, anyTone = false, tone = WHITE): number {
  let best = 0;
  for (const t of anyTone ? TONES : [tone]) {
    const points = s.stand[t]!;
    best = Math.max(best, s.ac.best(points, s.call, at.x, at.y));
    if (focus && s.focus) best = Math.max(best, s.ac.best(points, s.focus, at.x, at.y));
    if (t === WHITE) for (const a of s.ambient) best = Math.max(best, s.ac.best([a.at], a.voice, at.x, at.y));
  }
  return best;
}

/** The most relay `j` (in any of its facings) delivers to `at`. */
export function relayStrike(s: Situation, j: number, at: Vec2): number {
  const r = s.relays[j]!;
  const st: Strike = { e: 0, d: 0 };
  return Math.max(...s.facings[j]!.map((f) => s.ac.strike(r.mouth, f, r.voice, at.x, at.y, st).e));
}

/**
 * Which tones each relay can be made to answer with: woken by a call from any
 * reachable tile (in that tile's tone), or by another relay that can sing a
 * tone it answers. Single waves latch their effects, so the union is exact.
 */
function awaken(s: Situation): Set<number>[] {
  const { relays } = s;
  const fromPlayer = relays.map((r) => TONES.map((t) => playerHeard(s, r.ear, !r.turnable, false, t)));
  const link = relays.map((_, j) => relays.map((r, k) => (j !== k && hearsRelay(relays, k, j) ? relayStrike(s, j, r.ear) : 0)));
  const awake = relays.map(() => new Set<number>());
  for (let changed = true; changed; ) {
    changed = false;
    relays.forEach((r, k) => {
      for (const t of TONES) {
        const out = r.answer(t);
        if (out < 0 || awake[k]!.has(out)) continue;
        const heard = fromPlayer[k]![t]! >= r.trigger || relays.some((_, j) => awake[j]!.has(t) && link[j]![k]! >= r.trigger);
        if (!heard) continue;
        awake[k]!.add(out);
        changed = true;
      }
    });
  }
  return awake;
}

function hearsRelay(relays: readonly Relay[], k: number, j: number): boolean {
  const a = relays[k]!;
  const b = relays[j]!;
  return !(a.kind === "tube" && b.kind === "tube" && a.index === b.index);
}

/** Single-note panes struck by their note hard enough, by any call or relay. */
function singlePanesBroken(s: Situation): number[] {
  const out: number[] = [];
  s.panes.forEach((p, i) => {
    if (s.broken.has(i) || p.pane.notes.length !== 1) return;
    const note = p.pane.notes[0]!;
    const struck = p.faces.some(
      (f) =>
        playerHeard(s, f, true, false, note) >= p.pane.threshold ||
        s.relays.some((_, j) => s.awake[j]!.has(note) && relayStrike(s, j, f) >= p.pane.threshold),
    );
    if (struck) out.push(i);
  });
  return out;
}

/** Tile index of each pane's tiles, for the flood. */
function paneTiles(level: LevelData): Map<number, number> {
  const at = new Map<number, number>();
  level.glass.forEach((g, i) => g.tiles.forEach((t) => at.set(t, i)));
  return at;
}

function flood(level: LevelData, progress: Progress): Uint8Array {
  const { w, h, tiles, doorGroup } = level;
  const props = new Set(
    [...level.crystals, ...level.bells, ...level.mimics, ...level.tubes.flatMap((t) => [t.a, t.b])].map((p) => Math.floor(p.y) * w + Math.floor(p.x)),
  );
  const panes = paneTiles(level);
  const seen = new Uint8Array(w * h);
  const start = Math.floor(level.player.y) * w + Math.floor(level.player.x);
  const queue = [start];
  seen[start] = 1;
  while (queue.length) {
    const i = queue.pop()!;
    const x = i % w;
    const y = (i / w) | 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = ny * w + nx;
      if (seen[n] || props.has(n)) continue;
      const t = tiles[n]!;
      const door = t === TILE.Door && (progress.open.has(doorGroup[n]!) || progress.passable.has(doorGroup[n]!));
      const glass = t === TILE.Glass && progress.broken.has(panes.get(n)!);
      if (!isWalkableTile(t) && !door && !glass) continue;
      seen[n] = 1;
      queue.push(n);
    }
  }
  return seen;
}

/** Tiles a creature can stand on regardless of doors. Every walkable tile type must be listed here. */
function isWalkableTile(t: number): boolean {
  return t === TILE.Floor || t === TILE.Water || t === TILE.Silt || t === TILE.Draft;
}

export interface GridState {
  /** Panes already broken (their tiles let sound through). */
  broken?: ReadonlySet<number>;
  /** Sluice groups and whether their basins are flooded (water) or drained (silt). */
  flooded?: ReadonlyMap<number, boolean>;
}

/**
 * The level's sound grid with the given doors open. The checker solves each
 * field from the *target* outward, so it is built with every wind negated:
 * draft cost is antisymmetric, so a backwards solve against the reversed wind
 * yields exactly the forward source-to-target costs.
 */
export function soundGridFor(level: LevelData, open: ReadonlySet<number>, direction: "forward" | "backward" = "backward", state: GridState = {}): SoundGrid {
  const grid = new SoundGrid(level.w, level.h);
  const n = level.w * level.h;
  const solid = new Uint8Array(n);
  const silt = new Uint8Array(n);
  const panes = paneTiles(level);
  for (let i = 0; i < n; i++) {
    const t = level.tiles[i];
    const baffle = (level.decor[i]! & DECOR.Baffle) !== 0;
    const glass = t === TILE.Glass && !state.broken?.has(panes.get(i)!);
    solid[i] = t === TILE.Wall || baffle || glass || (t === TILE.Door && !open.has(level.doorGroup[i]!)) ? 1 : 0;
    silt[i] = t === TILE.Silt ? 1 : 0;
  }
  for (const b of level.basins) {
    const flooded = state.flooded?.get(b.group) ?? b.flooded;
    for (const i of b.tiles) silt[i] = flooded ? 0 : 1;
  }
  grid.setSolidTiles(solid);
  grid.setSiltTiles(silt);
  grid.setWind(level.wind, direction === "backward" ? -1 : 1);
  return grid;
}

/**
 * Best energy a wave of the given kind delivers to (tx, ty) from any source.
 * One field solved backwards from the target serves every source (see soundGridFor).
 * For a directional source, the backwards field arrives at it from exactly the
 * direction the forward sound must leave in, so its beam is checked against that.
 */
export function bestEnergy(grid: SoundGrid, sources: readonly Emitter[], tx: number, ty: number, wave: Probe): number {
  const ac = new Acoustics(grid, wave.radius);
  const voice: Voice = { ...wave, speed: 1 };
  const st: Strike = { e: 0, d: 0 };
  return Math.max(0, ...sources.map((src) => ac.strike(src, src.facing ?? null, voice, tx, ty, st).e));
}
