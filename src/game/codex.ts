import type { AbilityLesson } from "./abilities";
import type { CodexId, LevelData } from "./level-types";

/**
 * The Instrument's devices and creatures. Each is taught on its own lesson
 * screen in the chapter that introduces it (`LevelDef.introduces`), in the
 * same form as a new ability, and listed in the pause menu wherever it appears.
 */
export interface CodexInfo {
  name: string;
  /** Shown as the tag on its pause-menu row. */
  kind: "Device" | "Creature";
  /** One line, shown in the pause menu. */
  blurb: string;
  lesson: AbilityLesson;
}

export const CODEX_INFO: Readonly<Record<CodexId, CodexInfo>> = {
  tones: {
    name: "The Five Tones",
    kind: "Device",
    blurb: "Call standing on a floor key and your voice carries its note. Tuned crystals wake only to their own note.",
    lesson: {
      use: "Stand on a floor key — a coloured inlay in the stone — and call with [Space] as usual.",
      does: "Your call carries that key's note: A, C, D, E or G, each with its own colour and mark. A tuned crystal wakes only to its own note, and sings it back. Off the keys, your voice is plain, as it always was.",
      tip: "White crystals still answer anything, but they only ever sing plain. Watch the colour of a crystal's glow.",
    },
  },
  glass: {
    name: "Singing Glass",
    kind: "Device",
    blurb: "Panes that block the way and every sound — until struck hard by their own note. Then they shatter for good.",
    lesson: {
      use: "Call on the key whose colour matches the pane, close enough to strike it hard.",
      does: "Struck by its note, the glass shatters and the way is open — for you and for sound. Any other note only makes it clink, and plain calls pass it by.",
      tip: "A crystal singing the right note breaks it just as well, even from somewhere you cannot go.",
    },
  },
  mimic: {
    name: "The Mimic",
    kind: "Creature",
    blurb: "Rooted, many-mouthed. It repeats whatever it hears a breath and a half later — notes and footsteps alike.",
    lesson: {
      use: "Make a sound where it can hear you, then wait.",
      does: "A breath and a half later it repeats the sound from where it sits, in the same note: a voice that turns corners yours cannot. It answers each sound only once.",
      tip: "It repeats your footsteps too, loud enough for hunters to hear. That can betray you — or send them to it instead of you.",
    },
  },
  tubes: {
    name: "Speaking Tubes",
    kind: "Device",
    blurb: "Bronze mouths joined through the rock: what strikes one comes out of the other at once, in the same note.",
    lesson: {
      use: "Call into one mouth of a tube.",
      does: "The sound comes out of its twin mouth in the same instant and in the same note — even in a room sealed off from yours.",
      tip: "Tubes carry anything: footsteps and stones too. Hunters on the far side hear what comes out.",
    },
  },
  dishes: {
    name: "Turning Dishes",
    kind: "Device",
    blurb: "Dishes that sing one way only. A focused call turns one a quarter step clockwise; any other sound wakes it.",
    lesson: {
      use: "Aim a Focus call — hold [Q], point, release — at a dish ringed with notches.",
      does: "Each focused strike turns it a quarter step clockwise, with a stony grind. Any other sound — your call, a crystal's song — makes it sing along the way it faces.",
      tip: "The grind is quiet, but not silent. Turn it first, then wake it.",
    },
  },
  chords: {
    name: "Chords",
    kind: "Device",
    blurb: "Glass that needs two or three notes ringing at once. A note outside the chord is a discord, and silences it.",
    lesson: {
      use: "Bring every note of the pane to it within a few seconds: from two keys, or a key and a prism.",
      does: "Each note keeps ringing on the pane for about three seconds; when all of its notes ring together, it shatters. A prism wakes to any sound and always sings its own note.",
      tip: "A note that is not in the chord is a discord: every held note falls silent, and the discord carries far.",
    },
  },
  sluices: {
    name: "Sluices",
    kind: "Device",
    blurb: "A sluice bell floods its drained basins, or drains its flooded ones. Water carries sound; silt swallows it.",
    lesson: {
      use: "Ring a sluice bell — the one with a spout — like any other bell.",
      does: "Its basins fill with water, or drain to silt. Water carries sound, but splashes under every step. Silt swallows your steps — and every sound that crosses it.",
      tip: "Ring it again to turn it back. Choose the ground for what you must do next.",
    },
  },
  metronome: {
    name: "The Metronome",
    kind: "Creature",
    blurb: "It pulses on a strict beat. Anything moving when its pulse passes, it sees — and hunts.",
    lesson: {
      use: "Listen for its tick. Be still when its pulse washes over you, and move between beats.",
      does: "Its pulse lights the hall for you as well. But whatever is moving inside the pulse's front when it passes, it sees, and it comes.",
      tip: "Its tick sounds a moment before every pulse. Stillness at the beat is safety.",
    },
  },
  conductor: {
    name: "The Conductor",
    kind: "Creature",
    blurb: "Slow and relentless. It hears every discord struck anywhere in the Instrument, and goes to it.",
    lesson: {
      use: "Keep out of its hearing — and use what it listens for.",
      does: "It hunts as the others do and never gives up. A discord anywhere in the Instrument draws it straight there, however far.",
      tip: "Strike a wrong note on a chord pane on purpose, and it will go to listen.",
    },
  },
};

/** The devices and creatures present in a level, in teaching order. */
export function codexOf(level: LevelData): CodexId[] {
  const has: Record<CodexId, boolean> = {
    tones: level.keys.some((k) => k >= 0) || level.crystals.some((c) => c.note !== null),
    glass: level.glass.length > 0,
    mimic: level.mimics.length > 0,
    tubes: level.tubes.length > 0,
    dishes: level.crystals.some((c) => c.turnable),
    chords: level.glass.some((g) => g.notes.length > 1) || level.crystals.some((c) => c.prism),
    sluices: level.basins.length > 0,
    metronome: level.wardens.some((w) => w.creature === "metronome"),
    conductor: level.wardens.some((w) => w.creature === "conductor"),
  };
  return (Object.keys(CODEX_INFO) as CodexId[]).filter((id) => has[id]);
}
