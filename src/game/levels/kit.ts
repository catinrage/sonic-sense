import type { LevelDef } from "../level-types";

/** Debug diorama: every Act II ability at once (not part of the campaign). */
export const KIT: LevelDef = {
  id: "kit",
  chapter: "",
  title: "Kit",
  tagline: "",
  map: [
    "########################",
    "#......................#",
    "#...d..........C.......#",
    "#......................#",
    "#......@...............#",
    "#..............s.......#",
    "#...C...........W......#",
    "########################",
  ],
  abilities: ["deepListen", "focus", "lureStone", "muffle"],
  stones: 2,
};
