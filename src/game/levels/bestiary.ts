import type { LevelDef } from "../level-types";

/** Debug diorama: every creature kind side by side (not part of the campaign). */
export const BESTIARY: LevelDef = {
  id: "bestiary",
  chapter: "",
  title: "Bestiary",
  tagline: "",
  map: [
    "############################",
    "#..........................#",
    "#..........................#",
    "#...W....A....S....P....T..#",
    "#..........................#",
    "#.............@............#",
    "#..........................#",
    "############################",
  ],
  legend: {
    A: { kind: "warden", creature: "chorus" },
    S: { kind: "warden", creature: "sentinel" },
    P: { kind: "warden", creature: "stalker" },
    T: { kind: "warden", creature: "tremor" },
  },
};
