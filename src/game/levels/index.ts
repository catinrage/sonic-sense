import type { LevelDef } from "../level-types";
import { FIRST_LIGHT, HOLLOW_FLOOR, RESONANCE } from "./chapters-1-3";
import { CHOIR_OF_GLASS, DEEP_GATE, STILL_WATER, THE_LISTENER } from "./chapters-4-7";
import { BREATHING_HALLS, SILT_FLATS, WHAT_WALKS_BELOW } from "./chapters-8-10";
import { CHOIR_OF_MANY, THE_PATIENT_ONE, THE_WATCHER, WHERE_THE_DARK_BREATHES } from "./chapters-11-14";

import { BESTIARY } from "./bestiary";
import { SHOWCASE } from "./showcase";
import { FIXTURES } from "./fixtures";
import { KIT } from "./kit";
import { TERRAIN } from "./terrain";

export { SHOWCASE };

/** Non-campaign dioramas, loadable from the debug API by id. */
export const DIORAMAS: Readonly<Record<string, LevelDef>> = { showcase: SHOWCASE, bestiary: BESTIARY, terrain: TERRAIN, fixtures: FIXTURES, kit: KIT };

/** Display names of the acts, shown in chapter select. */
export const ACT_NAMES: Readonly<Record<number, string>> = {
  1: "The Sunken Temple",
  2: "The Breathing Dark",
};

/** Campaign order. */
export const LEVELS: readonly LevelDef[] = [
  FIRST_LIGHT,
  HOLLOW_FLOOR,
  RESONANCE,
  THE_LISTENER,
  STILL_WATER,
  CHOIR_OF_GLASS,
  DEEP_GATE,
  SILT_FLATS,
  WHAT_WALKS_BELOW,
  BREATHING_HALLS,
  THE_WATCHER,
  CHOIR_OF_MANY,
  THE_PATIENT_ONE,
  WHERE_THE_DARK_BREATHES,
];
