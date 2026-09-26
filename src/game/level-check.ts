import type { Vec2 } from "../core/math";
import { CRYSTAL_SONG, CRYSTAL_TRIGGER, FULL_CALL, focusProfile, RESONATOR_SONG } from "./calls";
import { coneGate, FieldJob, MIN_WIND_FACTOR, SoundGrid, UNREACHED } from "./geodesic";
import { DECOR, TILE, type Ability, type CrystalSpawn, type LevelData } from "./level-types";

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

const CRYSTAL_WAVE: Probe = { radius: CRYSTAL_SONG.radius, strength: CRYSTAL_SONG.strength };
const RESONATOR_WAVE: Probe = { radius: RESONATOR_SONG.radius, strength: RESONATOR_SONG.strength, halfAngle: RESONATOR_SONG.halfAngle };

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

/** Every door opener in a level (bells today; new kinds register here). */
export function openersOf(level: LevelData): Opener[] {
  return level.bells.map((b) => ({ kind: "bell", x: b.x, y: b.y, group: b.group, threshold: b.threshold }));
}

export interface LevelReport {
  errors: string[];
  /** Tiles the player can stand on once every ringable door is open. */
  reachable: Uint8Array;
  openedGroups: number[];
}

const fall = (d: number, r: number): number => {
  const u = Math.min(1, d / r);
  const k = 1 - u * u;
  return k * k;
};

/**
 * Static solvability check: flood-fills walkable tiles, opening door groups
 * whose bells can be rung by the player's loudest call or by a chain of
 * resonating crystals, until nothing changes. Creatures are ignored.
 */
export function checkLevel(level: LevelData, opts: { crystals?: boolean } = {}): LevelReport {
  const useCrystals = opts.crystals ?? true;
  const errors: string[] = [];
  const { w, h, tiles } = level;
  const idx = (x: number, y: number) => y * w + x;

  for (let x = 0; x < w; x++) {
    if (tiles[idx(x, 0)] !== TILE.Wall || tiles[idx(x, h - 1)] !== TILE.Wall) errors.push(`open border at column ${x}`);
  }
  for (let y = 0; y < h; y++) {
    if (tiles[idx(0, y)] !== TILE.Wall || tiles[idx(w - 1, y)] !== TILE.Wall) errors.push(`open border at row ${y}`);
  }
  if (!level.exit) errors.push("no exit ('X')");

  const groups = new Set<number>();
  level.doorGroup.forEach((g) => g > 0 && groups.add(g));
  const openers = openersOf(level);
  for (const g of groups) if (!openers.some((o) => o.group === g)) errors.push(`door group ${g} has no opener`);
  for (const o of openers) if (!groups.has(o.group)) errors.push(`${o.kind} at (${o.x}, ${o.y}) opens no door (group ${o.group})`);
  const probes = callProfiles(new Set(level.def.abilities ?? []));

  const props = new Set([...level.crystals, ...level.bells].map((p) => idx(Math.floor(p.x), Math.floor(p.y))));
  const open = new Set<number>();
  let reachable: Uint8Array = new Uint8Array(w * h);

  for (let round = 0; round < 12; round++) {
    reachable = flood(level, open, props);
    const ringable = ringableGroups(level, reachable, open, useCrystals, probes, openers);
    const before = open.size;
    for (const g of ringable) open.add(g);
    if (open.size === before) break;
  }

  const at = (p: { x: number; y: number }) => reachable[idx(Math.floor(p.x), Math.floor(p.y))] === 1;
  if (level.exit && !at(level.exit)) errors.push("exit is unreachable");
  level.shards.forEach((s, i) => !at(s) && errors.push(`shard #${i + 1} at (${Math.floor(s.x)}, ${Math.floor(s.y)}) is unreachable`));
  return { errors, reachable, openedGroups: [...open].sort() };
}

function flood(level: LevelData, open: Set<number>, props: Set<number>): Uint8Array {
  const { w, h, tiles, doorGroup } = level;
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
      if (seen[n]) continue;
      const walkable = isWalkableTile(tiles[n]!) || (tiles[n] === TILE.Door && open.has(doorGroup[n]!));
      if (!walkable || props.has(n)) continue;
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

/**
 * The level's sound grid with the given doors open. The checker solves each
 * field from the *target* outward, so it is built with every wind negated:
 * draft cost is antisymmetric, so a backwards solve against the reversed wind
 * yields exactly the forward source-to-target costs.
 */
export function soundGridFor(level: LevelData, open: ReadonlySet<number>, direction: "forward" | "backward" = "backward"): SoundGrid {
  const grid = new SoundGrid(level.w, level.h);
  const solid = new Uint8Array(level.w * level.h);
  const silt = new Uint8Array(level.w * level.h);
  for (let i = 0; i < solid.length; i++) {
    const t = level.tiles[i];
    const baffle = (level.decor[i]! & DECOR.Baffle) !== 0;
    solid[i] = t === TILE.Wall || baffle || (t === TILE.Door && !open.has(level.doorGroup[i]!)) ? 1 : 0;
    silt[i] = t === TILE.Silt ? 1 : 0;
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
  // Downwind, sound can cover more ground than its radius: widen the cheap prefilter to match.
  const reach = grid.hasWind ? wave.radius / MIN_WIND_FACTOR : wave.radius;
  const near = sources.filter((src) => Math.hypot(src.x - tx, src.y - ty) <= reach);
  if (near.length === 0) return 0;
  const job = new FieldJob(grid, tx, ty, wave.radius);
  job.advance(Infinity);
  let best = 0;
  const s = { d: 0, e: 0, dx: 0, dy: 0 };
  for (const src of near) {
    job.sample(src.x, src.y, s);
    if (s.d >= UNREACHED) continue;
    best = Math.max(best, wave.strength * s.e * fall(s.d, wave.radius) * beamGate(src, s.dx, s.dy, wave));
  }
  return best;
}

function beamGate(src: Emitter, arriveX: number, arriveY: number, wave: Probe): number {
  if (wave.halfAngle === undefined || !src.facing) return 1;
  const len = Math.hypot(arriveX, arriveY);
  if (len < 1e-6) return 1;
  // Forward, the sound leaves against the direction the backwards field arrives from.
  return coneGate(-(arriveX * src.facing.x + arriveY * src.facing.y) / len, wave.halfAngle);
}

/** Best energy any singing crystal (or resonator) delivers to (tx, ty). */
function relayEnergy(grid: SoundGrid, singers: readonly CrystalSpawn[], tx: number, ty: number): number {
  const plain = singers.filter((c) => !c.facing);
  const beams = singers.filter((c) => c.facing);
  return Math.max(bestEnergy(grid, plain, tx, ty, CRYSTAL_WAVE), bestEnergy(grid, beams, tx, ty, RESONATOR_WAVE));
}

/** Best energy any of the player's calls delivers to (tx, ty). */
function bestCall(grid: SoundGrid, stand: { x: number; y: number }[], tx: number, ty: number, probes: Probe[]): number {
  return Math.max(0, ...probes.map((p) => bestEnergy(grid, stand, tx, ty, p)));
}

function ringableGroups(
  level: LevelData,
  reachable: Uint8Array,
  open: Set<number>,
  useCrystals: boolean,
  probes: Probe[],
  openers: Opener[],
): number[] {
  const grid = soundGridFor(level, open);
  const stand: { x: number; y: number }[] = [];
  reachable.forEach((r, i) => r && stand.push({ x: (i % level.w) + 0.5, y: Math.floor(i / level.w) + 0.5 }));

  // Crystals woken by the player, then by each other.
  const awake = new Set<number>();
  let changed = useCrystals;
  while (changed) {
    changed = false;
    level.crystals.forEach((c, i) => {
      if (awake.has(i)) return;
      const fromPlayer = bestCall(grid, stand, c.x, c.y, probes);
      const fromCrystals = relayEnergy(grid, [...awake].map((k) => level.crystals[k]!), c.x, c.y);
      if (Math.max(fromPlayer, fromCrystals) >= CRYSTAL_TRIGGER) {
        awake.add(i);
        changed = true;
      }
    });
  }
  const singers = [...awake].map((k) => level.crystals[k]!);
  const groups: number[] = [];
  for (const o of openers) {
    if (open.has(o.group)) continue;
    const e = Math.max(bestCall(grid, stand, o.x, o.y, probes), relayEnergy(grid, singers, o.x, o.y));
    if (e >= o.threshold) groups.push(o.group);
  }
  return groups;
}
