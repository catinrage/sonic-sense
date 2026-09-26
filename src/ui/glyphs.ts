import type { Ability, CodexId } from "../game/level-types";

/** Line-art glyphs (64×64, stroked in the current text colour) for lesson screens. */
export const ABILITY_GLYPHS: Readonly<Record<Ability, string>> = {
  deepListen: `<circle cx="32" cy="32" r="3.5" fill="currentColor"/><path d="M45 19a18 18 0 0 1 0 26M51 13a26 26 0 0 1 0 38M19 19a18 18 0 0 0 0 26M13 13a26 26 0 0 0 0 38" opacity=".55"/><path d="M40 25l4-4M40 39l4 4M24 25l-4-4M24 39l-4 4"/>`,
  focus: `<circle cx="12" cy="32" r="3.5" fill="currentColor"/><path d="M16 30l38-11M16 34l38 11"/><path d="M34 26a14 14 0 0 1 0 12M46 22a22 22 0 0 1 0 20" opacity=".55"/>`,
  lureStone: `<ellipse cx="32" cy="44" rx="11" ry="7" fill="currentColor" opacity=".35"/><ellipse cx="32" cy="44" rx="11" ry="7"/><path d="M26 30a9 9 0 0 1 12 0M21 24a16 16 0 0 1 22 0M16 18a23 23 0 0 1 32 0" opacity=".6"/>`,
  muffle: `<ellipse cx="32" cy="40" rx="8" ry="7" fill="currentColor" opacity=".35"/><circle cx="22" cy="28" r="3.5"/><circle cx="32" cy="24" r="3.5"/><circle cx="42" cy="28" r="3.5"/><path d="M12 52L52 12"/>`,
};

export const CODEX_GLYPHS: Readonly<Record<CodexId, string>> = {
  tones: `<path d="M32 10l22 22-22 22-22-22z"/><circle cx="32" cy="32" r="6" fill="currentColor"/><path d="M20 58h24" opacity=".5"/>`,
  glass: `<rect x="18" y="10" width="28" height="44" rx="2"/><path d="M32 10l-4 14 8 6-6 10 4 14" opacity=".7"/><path d="M10 22l4 2M54 22l-4 2M10 42l4-2M54 42l-4-2" opacity=".5"/>`,
  mimic: `<path d="M16 50c0-20 6-32 16-32s16 12 16 32z"/><circle cx="26" cy="33" r="3"/><circle cx="38" cy="31" r="3"/><circle cx="32" cy="42" r="3"/><path d="M52 18a8 8 0 0 1 0 10M56 13a15 15 0 0 1 0 20" opacity=".55"/>`,
  tubes: `<path d="M8 20h10v8H8zM46 36h10v8H46z"/><path d="M18 24c16 0 12 16 28 16"/><path d="M4 16a9 9 0 0 0 0 16M60 32a9 9 0 0 1 0 16" opacity=".55"/>`,
  dishes: `<path d="M18 16a20 20 0 0 1 0 32"/><circle cx="25" cy="32" r="3.5" fill="currentColor"/><path d="M30 32h20M44 26l6 6-6 6"/><path d="M38 12a22 22 0 0 1 14 10M52 15v7h-7" opacity=".55"/>`,
  chords: `<path d="M12 20h40M12 32h40M12 44h40" opacity=".45"/><circle cx="22" cy="44" r="4.5" fill="currentColor"/><circle cx="32" cy="32" r="4.5" fill="currentColor"/><circle cx="42" cy="20" r="4.5" fill="currentColor"/>`,
  sluices: `<path d="M8 38c6-5 10-5 16 0s10 5 16 0 10-5 16 0M8 49c6-5 10-5 16 0s10 5 16 0 10-5 16 0"/><path d="M26 8v20M38 8v20M22 10h20" opacity=".6"/>`,
  metronome: `<path d="M18 56h28L37 10h-10z"/><path d="M32 48L45 18"/><circle cx="42" cy="25" r="3.5" fill="currentColor"/>`,
  conductor: `<circle cx="30" cy="16" r="6"/><path d="M18 56c0-16 5-28 12-28s12 12 12 28"/><path d="M40 34l16-18"/><circle cx="57" cy="15" r="2" fill="currentColor"/>`,
};
