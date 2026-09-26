import type { Vec2 } from "../core/math";
import type { CreatureKind } from "./entities/warden-traits";

export const TILE = {
  Floor: 0,
  Wall: 1,
  Pit: 2,
  Water: 3,
  Door: 4,
  /** Soft ground: footfalls are silent, and it drinks the sound that crosses it. */
  Silt: 5,
  /** Moving air: sound carries further downwind and dies quickly upwind. */
  Draft: 6,
} as const;
export type TileType = (typeof TILE)[keyof typeof TILE];

/**
 * Directions a Draft tile can blow, indexed by `LevelData.wind`. Map characters
 * '>' '<' 'v' '^' select them in this order.
 */
export const WIND_DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
export const WIND_CHARS = "><v^";

/** Cosmetic decoration flags stored per tile. */
export const DECOR = {
  Rubble: 1,
  Moss: 2,
  Cracks: 4,
  Runes: 8,
  /** A hanging moss curtain: walk through it, but sound cannot pass. */
  Baffle: 16,
} as const;

export type Facing = "n" | "e" | "s" | "w";
export const FACING_DIRS: Readonly<Record<Facing, Vec2>> = {
  n: { x: 0, y: -1 },
  e: { x: 1, y: 0 },
  s: { x: 0, y: 1 },
  w: { x: -1, y: 0 },
};

/**
 * Abilities a chapter is played (and proven solvable) with. They are granted
 * per chapter rather than carried forward, so every level knows its exact kit.
 */
export type Ability = "deepListen" | "focus" | "lureStone" | "muffle";

export type LegendEntry =
  | { kind: "bell"; group: number; timed?: number; threshold?: number }
  | { kind: "hint"; text: string; radius?: number }
  | { kind: "warden"; route?: string; speed?: number; creature?: CreatureKind }
  | { kind: "waypoint" }
  /** A crystal backed by a dish: it sings in one direction only, but further. */
  | { kind: "resonator"; facing: Facing };

export interface StartHint {
  text: string;
  delay?: number;
  duration?: number;
}

export interface LevelDef {
  id: string;
  chapter: string;
  title: string;
  tagline: string;
  map: readonly string[];
  legend?: Readonly<Record<string, LegendEntry>>;
  startHints?: readonly StartHint[];
  stones?: number;
  seed?: number;
  /** Which act the chapter belongs to (defaults to 1). */
  act?: 1 | 2;
  /** Kit the chapter is played and verified with. Defaults to none. */
  abilities?: readonly Ability[];
  /** Newly granted in this chapter (announced on its card). */
  grants?: readonly Ability[];
  /** The chapter closes an act: show this interlude before continuing. */
  endsAct?: { title: string; text: string; next: string };
}

export interface CrystalSpawn extends Vec2 {
  /** Beam direction of a resonator; null for an ordinary (omnidirectional) crystal. */
  facing: Vec2 | null;
}

export interface BellSpawn extends Vec2 {
  group: number;
  timed: number;
  threshold: number;
}

export interface WardenSpawn extends Vec2 {
  route: Vec2[];
  speed: number;
  creature: CreatureKind;
}

export interface HintSpawn extends Vec2 {
  text: string;
  radius: number;
}

export interface LevelData {
  def: LevelDef;
  w: number;
  h: number;
  tiles: Uint8Array;
  decor: Uint8Array;
  variant: Uint8Array;
  /** Door group per tile, -1 when the tile is not a door. */
  doorGroup: Int8Array;
  /** Wind per tile: an index into WIND_DIRS, or -1 for still air. */
  wind: Int8Array;
  player: Vec2;
  exit: Vec2 | null;
  shards: Vec2[];
  crystals: CrystalSpawn[];
  bells: BellSpawn[];
  wardens: WardenSpawn[];
  stonePiles: Vec2[];
  mushrooms: Vec2[];
  drips: Vec2[];
  /** Wind chimes: they ring by themselves when hung in a draft. */
  chimes: Vec2[];
  hints: HintSpawn[];
}
