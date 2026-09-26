import type { LevelDef } from "../level-types";

/** Debug diorama: moss curtains, a resonator dish and wind chimes (not part of the campaign). */
export const FIXTURES: LevelDef = {
  id: "fixtures",
  chapter: "",
  title: "Fixtures",
  tagline: "",
  map: [
    "##########################",
    "#........#...............#",
    "#..R.....%.......>>&>>>..#",
    "#........#...............#",
    "#####%####...............#",
    "#............@......&....#",
    "#......C.................#",
    "##########################",
  ],
  legend: { R: { kind: "resonator", facing: "e" } },
};
