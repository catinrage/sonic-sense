import { FieldJob, SoundGrid, UNREACHED } from "./geodesic";
import { TILE, type LevelData } from "./level-types";

/** Loudest call the player can make (matches Player.releasePulse at full charge). */
const FULL_PULSE = { radius: 15, strength: 1.25 };
const CRYSTAL_WAVE = { radius: 8.5, strength: 0.95 };
const CRYSTAL_TRIGGER = 0.1;

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
  for (const g of groups) if (!level.bells.some((b) => b.group === g)) errors.push(`door group ${g} has no bell`);
  for (const b of level.bells) if (!groups.has(b.group)) errors.push(`bell at (${b.x}, ${b.y}) opens no door (group ${b.group})`);

  const props = new Set([...level.crystals, ...level.bells].map((p) => idx(Math.floor(p.x), Math.floor(p.y))));
  const open = new Set<number>();
  let reachable: Uint8Array = new Uint8Array(w * h);

  for (let round = 0; round < 12; round++) {
    reachable = flood(level, open, props);
    const ringable = ringableGroups(level, reachable, open, useCrystals);
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
      const t = tiles[n];
      const walkable = t === TILE.Floor || t === TILE.Water || (t === TILE.Door && open.has(doorGroup[n]!));
      if (!walkable || props.has(n)) continue;
      seen[n] = 1;
      queue.push(n);
    }
  }
  return seen;
}

function soundGridFor(level: LevelData, open: Set<number>): SoundGrid {
  const grid = new SoundGrid(level.w, level.h);
  const mask = new Uint8Array(level.w * level.h);
  for (let i = 0; i < mask.length; i++) {
    const t = level.tiles[i];
    mask[i] = t === TILE.Wall || (t === TILE.Door && !open.has(level.doorGroup[i]!)) ? 1 : 0;
  }
  grid.setSolidTiles(mask);
  return grid;
}

/**
 * Best energy a wave of the given kind delivers to (tx, ty) from any source.
 * Propagation paths are symmetric, so one field solved from the target serves every source.
 */
function bestEnergy(grid: SoundGrid, sources: { x: number; y: number }[], tx: number, ty: number, wave: { radius: number; strength: number }): number {
  const near = sources.filter((src) => Math.hypot(src.x - tx, src.y - ty) <= wave.radius);
  if (near.length === 0) return 0;
  const job = new FieldJob(grid, tx, ty, wave.radius);
  job.advance(Infinity);
  let best = 0;
  const s = { d: 0, e: 0 };
  for (const src of near) {
    job.sample(src.x, src.y, s);
    if (s.d >= UNREACHED) continue;
    best = Math.max(best, wave.strength * s.e * fall(s.d, wave.radius));
  }
  return best;
}

function ringableGroups(level: LevelData, reachable: Uint8Array, open: Set<number>, useCrystals: boolean): number[] {
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
      const fromPlayer = bestEnergy(grid, stand, c.x, c.y, FULL_PULSE);
      const fromCrystals = bestEnergy(grid, [...awake].map((k) => level.crystals[k]!), c.x, c.y, CRYSTAL_WAVE);
      if (Math.max(fromPlayer, fromCrystals) >= CRYSTAL_TRIGGER) {
        awake.add(i);
        changed = true;
      }
    });
  }
  const singers = [...awake].map((k) => level.crystals[k]!);
  const groups: number[] = [];
  for (const b of level.bells) {
    if (open.has(b.group)) continue;
    const e = Math.max(bestEnergy(grid, stand, b.x, b.y, FULL_PULSE), bestEnergy(grid, singers, b.x, b.y, CRYSTAL_WAVE));
    if (e >= b.threshold) groups.push(b.group);
  }
  return groups;
}
