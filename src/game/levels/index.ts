import type { LevelDef } from "../level-types";
import { FIRST_LIGHT, HOLLOW_FLOOR, RESONANCE } from "./chapters-1-3";
import { CHOIR_OF_GLASS, DEEP_GATE, STILL_WATER, THE_LISTENER } from "./chapters-4-7";

export { SHOWCASE } from "./showcase";

/** Campaign order. */
export const LEVELS: readonly LevelDef[] = [
  FIRST_LIGHT,
  HOLLOW_FLOOR,
  RESONANCE,
  THE_LISTENER,
  STILL_WATER,
  CHOIR_OF_GLASS,
  DEEP_GATE,
];
