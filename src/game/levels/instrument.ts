import type { LevelDef } from "../level-types";

/**
 * Debug diorama of the Instrument (not part of the campaign): a key for every
 * note, single and chord glass, tuned crystals and a prism, a turning dish, a
 * mimic, a speaking tube, a sluice, and the two new creatures.
 */
export const INSTRUMENT: LevelDef = {
  id: "instrument",
  chapter: "",
  title: "The Instrument",
  tagline: "",
  abilities: ["focus"],
  map: [
    "##############################",
    "#............#...............#",
    "#.a.c.k.e.g..#..T..P....R....#",
    "#............#...............#",
    "#.....@......h.......M.......#",
    "#............#...............#",
    "#..u.........j....bbbbbb.S...#",
    "######.#######....bbbbbb.....#",
    "#.....y...........N.....Q....#",
    "##############################",
  ],
  legend: {
    a: { kind: "key", note: 0 },
    c: { kind: "key", note: 1 },
    k: { kind: "key", note: 2 },
    e: { kind: "key", note: 3 },
    g: { kind: "key", note: 4 },
    T: { kind: "crystal", note: 3 },
    P: { kind: "crystal", note: 4, prism: true },
    R: { kind: "crystal", facing: "w", turnable: true },
    h: { kind: "glass", notes: [3] },
    j: { kind: "glass", notes: [0, 3, 4] },
    M: { kind: "mimic" },
    u: { kind: "tube", pair: "x" },
    y: { kind: "tube", pair: "x" },
    b: { kind: "basin", group: 7, flooded: true },
    S: { kind: "bell", group: 7, toggle: true },
    N: { kind: "warden", creature: "metronome" },
    Q: { kind: "warden", creature: "conductor" },
  },
};
