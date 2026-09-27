import { creatureTraits, type CreatureKind } from "./entities/warden-traits";
import { parseLevel } from "./level-parser";
import { LEVELS } from "./levels";
import type { LevelDef } from "./level-types";

/** Everything in the dark that listens back: the hunters, and the Mimic. */
export type BestiaryId = CreatureKind | "mimic";

export interface BestiaryEntry {
  id: BestiaryId;
  name: string;
  epithet: string;
  /** Its glow, as CSS: the page takes this colour. */
  accent: string;
  senses: { air: boolean; ground: boolean; beat: boolean; discord: boolean };
  /** 0..5 each. Alarm: how far its cry carries to other hunters. */
  meters: { speed: number; tenacity: number; alarm: number };
  /** What it does. */
  ways: readonly string[];
  /** How to stay alive near it. */
  live: readonly string[];
  /** Shown when you call to it on its page. */
  heard: string;
}

/** In the order they are met on the way down. */
export const BESTIARY: readonly BestiaryEntry[] = [
  {
    id: "warden",
    name: "Warden",
    epithet: "The first hunter",
    accent: "#ff4f5e",
    senses: { air: true, ground: false, beat: false, discord: false },
    meters: { speed: 4, tenacity: 3, alarm: 0 },
    ways: [
      "Blind. It clicks to find its way, and each click shows it to you in red.",
      "Hunts the source of anything it hears — calls, footsteps, splashes, a stone's clatter.",
      "Nearly as quick as you. After a while it gives up, searches, and goes back.",
    ],
    live: [
      "The louder you call, the further you are heard: call short, or aim a Focus.",
      "Sneak past. Only a hunter within arm's reach hears a creeping step.",
      "Throw a stone, and it goes to listen there instead.",
      "Keep out of water: every step splashes, sneaking or not.",
    ],
    heard: "It heard you — and it is coming to where you were.",
  },
  {
    id: "tremor",
    name: "Tremor",
    epithet: "It feels the ground",
    accent: "#e8a862",
    senses: { air: false, ground: true, beat: false, discord: false },
    meters: { speed: 5, tenacity: 3, alarm: 0 },
    ways: [
      "Deaf to the air — call as much as you like.",
      "Feels footsteps through the floor, and every stone that strikes it.",
      "Its own tread thumps; that is how you see it.",
    ],
    live: [
      "Sneak, walk on silt, or Muffle your steps near it.",
      "Water carries your footfalls further through the floor.",
      "A thrown stone draws it: the ground carries the landing.",
    ],
    heard: "Nothing. It cannot hear the air — only the ground.",
  },
  {
    id: "sentinel",
    name: "Sentinel",
    epithet: "The watcher that calls",
    accent: "#a8ecff",
    senses: { air: true, ground: false, beat: false, discord: false },
    meters: { speed: 0, tenacity: 2, alarm: 5 },
    ways: [
      "Rooted where it stands: it never moves.",
      "Calls on its own every few seconds, and its voice lights the hall — for you as well.",
      "Hear you, and it screams for every hunter in earshot.",
    ],
    live: [
      "Borrow its light: move while its call fades, be still while it listens.",
      "It cannot chase you. Its scream will.",
    ],
    heard: "It heard you. Its scream would bring every hunter near.",
  },
  {
    id: "chorus",
    name: "Chorus",
    epithet: "It hunts as one",
    accent: "#ff9442",
    senses: { air: true, ground: false, beat: false, discord: false },
    meters: { speed: 5, tenacity: 2, alarm: 3 },
    ways: [
      "Smaller and quicker than a Warden, and never alone.",
      "When one hears you, its cry rallies the others to where it was going.",
    ],
    live: [
      "Never let the first one hear you: there is no second chance.",
      "A stone thrown far from their path draws the whole pack; a lure stone holds them there.",
    ],
    heard: "It heard you. Its cry would bring the others.",
  },
  {
    id: "stalker",
    name: "Stalker",
    epithet: "It never gives up",
    accent: "#a770ff",
    senses: { air: true, ground: false, beat: false, discord: false },
    meters: { speed: 2, tenacity: 5, alarm: 0 },
    ways: ["Slow — slower than you.", "Once it hunts, it never turns back; then it circles the last place it heard you, for a long time."],
    live: [
      "You can always out-walk it. You can never out-wait it.",
      "Leave it a sound somewhere else, and be somewhere it did not hear.",
    ],
    heard: "It heard you. It will not stop looking.",
  },
  {
    id: "mimic",
    name: "Mimic",
    epithet: "Many-mouthed",
    accent: "#dcc9ff",
    senses: { air: true, ground: false, beat: false, discord: false },
    meters: { speed: 0, tenacity: 0, alarm: 2 },
    ways: [
      "Rooted, and harmless in itself.",
      "Repeats whatever it hears a breath and a half later, in the same note — calls, crystals, your footsteps.",
    ],
    live: [
      "Sneak past it: it only catches steps close by.",
      "Its echo can carry your note round a corner — or draw hunters to it instead of you.",
    ],
    heard: "Listen: it will say it back.",
  },
  {
    id: "metronome",
    name: "Metronome",
    epithet: "Keeper of time",
    accent: "#ffcf6e",
    senses: { air: false, ground: false, beat: true, discord: false },
    meters: { speed: 4, tenacity: 2, alarm: 0 },
    ways: [
      "Deaf. It sees with its pulse, on a strict beat, with a tick just before each one.",
      "Whatever moves as the pulse passes, it sees — and hunts.",
    ],
    live: ["Move between beats. Be still when the pulse washes over you.", "Its pulse lights the room for you too: use it to see."],
    heard: "Nothing. It hears no voice — its beat sees only what moves.",
  },
  {
    id: "conductor",
    name: "Conductor",
    epithet: "Keeper of the Instrument",
    accent: "#ff63be",
    senses: { air: true, ground: false, beat: false, discord: true },
    meters: { speed: 2, tenacity: 5, alarm: 0 },
    ways: ["Slow, and it never gives up a hunt.", "Hears every discord struck anywhere in the Instrument, however far away."],
    live: [
      "Keep out of its hearing — and use what it listens for.",
      "Strike a wrong note far away, down a tube or on a distant pane, and it goes to listen.",
    ],
    heard: "It heard you. A wrong note would draw it from anywhere.",
  },
];

/** Whether calling to it on its page draws a reaction (it hears the air). */
export function hearsCalls(id: BestiaryId): boolean {
  return id !== "mimic" && creatureTraits(id).hearsAir;
}

let firstMetCache: Map<BestiaryId, number> | null = null;

/** Index of the first chapter each creature appears in (absent: never). */
export function firstMet(): ReadonlyMap<BestiaryId, number> {
  if (firstMetCache) return firstMetCache;
  const met = new Map<BestiaryId, number>();
  LEVELS.forEach((def, i) => {
    const level = parseLevel(def);
    for (const w of level.wardens) if (!met.has(w.creature)) met.set(w.creature, i);
    if (level.mimics.length > 0 && !met.has("mimic")) met.set("mimic", i);
  });
  firstMetCache = met;
  return met;
}

/** Where the creature stands on its stage. */
export const STAGE_CENTRE = { x: 7.5, y: 5.5 } as const;

/**
 * The stage a creature is shown on: a small round chamber with the creature at
 * its heart. `null` shows the chamber empty (a creature not heard yet). The
 * player is placed out of the way; the showcase moves it, unseen, beside the creature.
 */
export function bestiaryStage(id: BestiaryId | null): LevelDef {
  const mark = id === null ? "." : id === "mimic" ? "M" : "A";
  return {
    id: `bestiary-${id ?? "unheard"}`,
    chapter: "",
    title: "Bestiary",
    tagline: "",
    map: [
      "###############",
      "######...######",
      "####.......####",
      "###..,......,##",
      "##...........##",
      `##.....${mark}.....##`,
      "##...........##",
      "###...,.....###",
      "####.......####",
      "######.@.######",
      "###############",
    ],
    legend: id === "mimic" ? { M: { kind: "mimic" } } : id === null ? {} : { A: { kind: "warden", creature: id } },
  };
}
