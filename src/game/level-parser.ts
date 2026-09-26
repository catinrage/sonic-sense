import { hash2 } from "../core/rng";
import type { CreatureKind } from "./entities/warden-traits";
import type { Vec2 } from "../core/math";
import {
  DECOR,
  FACING_DIRS,
  TILE,
  WIND_CHARS,
  type BellSpawn,
  type HintSpawn,
  type LegendEntry,
  type LevelData,
  type LevelDef,
  type WardenSpawn,
} from "./level-types";

const center = (x: number, y: number): Vec2 => ({ x: x + 0.5, y: y + 0.5 });

/** Map characters with a fixed meaning; a legend may not redefine them. */
const BUILTIN_CHARS: ReadonlySet<string> = new Set([..."# .,\"@X*o~CWsmd123456789:%&", ...WIND_CHARS]);

interface PendingWarden {
  pos: Vec2;
  route: string;
  speed: number;
  creature: CreatureKind;
}

/**
 * Parses an ASCII level definition into typed tile arrays and entity spawns.
 * Throws with a descriptive message on malformed input (fail fast at load time).
 */
export function parseLevel(def: LevelDef): LevelData {
  if (def.map.length === 0) throw new Error(`Level "${def.id}" has an empty map`);
  for (const key of Object.keys(def.legend ?? {})) {
    if (BUILTIN_CHARS.has(key)) throw new Error(`Level "${def.id}": legend key '${key}' shadows a built-in map character`);
  }
  const h = def.map.length;
  const w = Math.max(...def.map.map((row) => row.length));
  const n = w * h;

  const data: LevelData = {
    def,
    w,
    h,
    tiles: new Uint8Array(n).fill(TILE.Wall),
    decor: new Uint8Array(n),
    variant: new Uint8Array(n),
    doorGroup: new Int8Array(n).fill(-1),
    wind: new Int8Array(n).fill(-1),
    player: { x: -1, y: -1 },
    exit: null,
    shards: [],
    crystals: [],
    bells: [],
    wardens: [],
    stonePiles: [],
    mushrooms: [],
    drips: [],
    chimes: [],
    hints: [],
  };

  const waypoints = new Map<string, Vec2>();
  const pendingWardens: PendingWarden[] = [];
  const seed = def.seed ?? hashString(def.id);

  for (let y = 0; y < h; y++) {
    const row = def.map[y] ?? "";
    for (let x = 0; x < w; x++) {
      const ch = row[x] ?? " ";
      const i = y * w + x;
      data.variant[i] = Math.floor(hash2(x, y, seed) * 256);
      applyChar(data, ch, x, y, def, waypoints, pendingWardens);
    }
  }

  if (data.player.x < 0) throw new Error(`Level "${def.id}" has no player start ('@')`);

  data.wardens = pendingWardens.map((p) => resolveWarden(def.id, p, waypoints));
  hangChimes(data);
  decorate(data, seed);
  return data;
}

function applyChar(
  data: LevelData,
  ch: string,
  x: number,
  y: number,
  def: LevelDef,
  waypoints: Map<string, Vec2>,
  wardens: PendingWarden[],
): void {
  const i = y * data.w + x;
  const setFloor = () => (data.tiles[i] = TILE.Floor);

  switch (ch) {
    case "#":
    case " ":
      data.tiles[i] = TILE.Wall;
      return;
    case ".":
      setFloor();
      return;
    case ",":
      setFloor();
      data.decor[i] |= DECOR.Rubble;
      return;
    case '"':
      setFloor();
      data.decor[i] |= DECOR.Moss;
      return;
    case "@":
      setFloor();
      data.player = center(x, y);
      return;
    case "X":
      setFloor();
      data.exit = center(x, y);
      return;
    case "*":
      setFloor();
      data.shards.push(center(x, y));
      return;
    case "o":
      data.tiles[i] = TILE.Pit;
      return;
    case "~":
      data.tiles[i] = TILE.Water;
      return;
    case "C":
      setFloor();
      data.crystals.push({ ...center(x, y), facing: null });
      return;
    case "%":
      setFloor();
      data.decor[i] |= DECOR.Baffle;
      return;
    case "&":
      setFloor();
      data.chimes.push(center(x, y));
      return;
    case "W":
      setFloor();
      wardens.push({ pos: center(x, y), route: "", speed: 1, creature: "warden" });
      return;
    case "s":
      setFloor();
      data.stonePiles.push(center(x, y));
      return;
    case "m":
      setFloor();
      data.mushrooms.push(center(x, y));
      return;
    case "d":
      setFloor();
      data.drips.push(center(x, y));
      return;
    case ":":
      data.tiles[i] = TILE.Silt;
      return;
  }

  const wind = WIND_CHARS.indexOf(ch);
  if (wind >= 0) {
    data.tiles[i] = TILE.Draft;
    data.wind[i] = wind;
    return;
  }

  if (ch >= "1" && ch <= "9") {
    data.tiles[i] = TILE.Door;
    data.doorGroup[i] = Number(ch);
    return;
  }

  const entry: LegendEntry | undefined = def.legend?.[ch];
  if (!entry) throw new Error(`Level "${def.id}": unknown map character '${ch}' at (${x}, ${y})`);
  setFloor();
  applyLegend(data, entry, ch, x, y, waypoints, wardens);
}

function applyLegend(
  data: LevelData,
  entry: LegendEntry,
  ch: string,
  x: number,
  y: number,
  waypoints: Map<string, Vec2>,
  wardens: PendingWarden[],
): void {
  switch (entry.kind) {
    case "bell": {
      const bell: BellSpawn = {
        ...center(x, y),
        group: entry.group,
        timed: entry.timed ?? 0,
        threshold: entry.threshold ?? 0.3,
      };
      data.bells.push(bell);
      return;
    }
    case "hint": {
      const hint: HintSpawn = { ...center(x, y), text: entry.text, radius: entry.radius ?? 2.2 };
      data.hints.push(hint);
      return;
    }
    case "warden":
      wardens.push({ pos: center(x, y), route: entry.route ?? "", speed: entry.speed ?? 1, creature: entry.creature ?? "warden" });
      return;
    case "waypoint":
      if (waypoints.has(ch)) throw new Error(`Level "${data.def.id}": waypoint '${ch}' appears more than once`);
      waypoints.set(ch, center(x, y));
      return;
    case "resonator":
      data.crystals.push({ ...center(x, y), facing: FACING_DIRS[entry.facing] });
      return;
  }
}

/** A chime hangs in the draft blowing past it: its tile takes the wind of a neighbouring draft. */
function hangChimes(data: LevelData): void {
  for (const c of data.chimes) {
    const tx = Math.floor(c.x);
    const ty = Math.floor(c.y);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = tx + dx;
      const ny = ty + dy;
      if (nx < 0 || ny < 0 || nx >= data.w || ny >= data.h) continue;
      const wind = data.wind[ny * data.w + nx]!;
      if (wind < 0) continue;
      data.tiles[ty * data.w + tx] = TILE.Draft;
      data.wind[ty * data.w + tx] = wind;
      break;
    }
  }
}

function resolveWarden(levelId: string, pending: PendingWarden, waypoints: Map<string, Vec2>): WardenSpawn {
  const route = [...pending.route].map((ch) => {
    const wp = waypoints.get(ch);
    if (!wp) throw new Error(`Level "${levelId}": warden route references missing waypoint '${ch}'`);
    return wp;
  });
  return { ...pending.pos, route, speed: pending.speed, creature: pending.creature };
}

/** Deterministic cosmetic decoration (rubble near walls, moss patches, carved runes). */
function decorate(data: LevelData, seed: number): void {
  const { w, h, tiles, decor } = data;
  const isWall = (x: number, y: number) => x < 0 || y < 0 || x >= w || y >= h || tiles[y * w + x] === TILE.Wall;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const r = hash2(x, y, seed + 17);
      const wallNeighbours =
        Number(isWall(x - 1, y)) + Number(isWall(x + 1, y)) + Number(isWall(x, y - 1)) + Number(isWall(x, y + 1));

      if (tiles[i] === TILE.Floor) {
        if (wallNeighbours >= 2 && r < 0.22) decor[i] |= DECOR.Rubble;
        if (hash2(x >> 2, y >> 2, seed + 5) < 0.35 && r > 0.55) decor[i] |= DECOR.Moss;
        if (hash2(x, y, seed + 29) < 0.18) decor[i] |= DECOR.Cracks;
      } else if (tiles[i] === TILE.Wall && wallNeighbours < 4 && r < 0.09) {
        decor[i] |= DECOR.Runes;
      }
    }
  }
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
