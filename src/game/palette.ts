import type { RGB } from "../core/math";

/** Wave colors per sound source. Saturated, slightly HDR for bloom. */
export const COLORS = {
  pulse: [0.33, 0.9, 1.0],
  focus: [0.62, 0.98, 1.0],
  step: [0.3, 0.72, 0.95],
  sneak: [0.25, 0.55, 0.8],
  splash: [0.35, 0.62, 1.0],
  stone: [0.86, 0.9, 1.0],
  crystal: [0.74, 0.42, 1.0],
  bell: [1.0, 0.66, 0.26],
  warden: [1.0, 0.16, 0.2],
  wardenAlert: [1.0, 0.08, 0.12],
  exit: [1.0, 0.8, 0.42],
  drip: [0.5, 0.78, 1.0],
  door: [1.0, 0.58, 0.28],
  chorus: [1.0, 0.46, 0.12],
  sentinel: [0.78, 0.95, 1.0],
  stalker: [0.62, 0.22, 1.0],
  tremor: [0.85, 0.55, 0.22],
  chime: [0.7, 0.86, 1.0],
  lure: [0.95, 0.95, 0.8],
  mimic: [0.86, 0.8, 0.95],
  tube: [0.9, 0.7, 0.45],
  metronome: [0.95, 0.78, 0.4],
  discord: [1.0, 0.25, 0.55],
} as const satisfies Record<string, RGB>;

/** Colours of the five tones A C D E G (vermillion, gold, green, sky, orchid). */
export const NOTE_COLORS: readonly RGB[] = [
  [1.0, 0.45, 0.22],
  [1.0, 0.84, 0.28],
  [0.24, 0.92, 0.6],
  [0.42, 0.78, 1.0],
  [0.9, 0.5, 1.0],
];

/** A wave's colour: its note's, or the given unpitched colour. */
export function noteColor(note: number | null, white: RGB): RGB {
  return note === null ? white : (NOTE_COLORS[note] ?? white);
}
