import type { Vec2 } from "../core/math";

export const TILE = {
  Floor: 0,
  Wall: 1,
  Pit: 2,
  Water: 3,
  Door: 4,
} as const;
export type TileType = (typeof TILE)[keyof typeof TILE];

/** Cosmetic decoration flags stored per tile. */
export const DECOR = {
  Rubble: 1,
  Moss: 2,
  Cracks: 4,
  Runes: 8,
} as const;

export type LegendEntry =
  | { kind: "bell"; group: number; timed?: number; threshold?: number }
  | { kind: "hint"; text: string; radius?: number }
  | { kind: "warden"; route?: string; speed?: number }
  | { kind: "waypoint" };

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
}

export interface BellSpawn extends Vec2 {
  group: number;
  timed: number;
  threshold: number;
}

export interface WardenSpawn extends Vec2 {
  route: Vec2[];
  speed: number;
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
  player: Vec2;
  exit: Vec2 | null;
  shards: Vec2[];
  crystals: Vec2[];
  bells: BellSpawn[];
  wardens: WardenSpawn[];
  stonePiles: Vec2[];
  mushrooms: Vec2[];
  drips: Vec2[];
  hints: HintSpawn[];
}
