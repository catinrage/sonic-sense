/**
 * Names of the generated audio assets (ElevenLabs), grouped by sound id.
 *
 * These are fetched at runtime from `/assets/audio/` rather than imported, so
 * the game builds and plays whether or not the files are present: any sample
 * that is missing simply leaves its synthesized recipe in charge. The dev
 * server serves the directory directly (see `index.ts`) and `bun run build`
 * copies it into `dist/`.
 *
 * Sounds with several variants are picked between at random so repeats do not
 * sound identical.
 *
 * The call, the footsteps and the menu hover tick are absent on purpose:
 * play-testing preferred the synthesized recipes for those, so `Sfx` renders
 * them directly and no sample is shipped. See `pulse()`, `footstep()` and
 * `uiMove()` in sounds.ts.
 */
export const AUDIO_BASE = "/assets/audio";
/** Lists which samples are actually deployed, so nothing absent is requested. */
export const MANIFEST_FILE = "index.json";

export const SAMPLES = {
  "stone-throw": ["stone-throw.mp3"],
  "stone-hit": ["stone-hit-1.mp3", "stone-hit-2.mp3"],
  crystal: ["crystal.mp3"],
  bell: ["bell.mp3"],
  "door-open": ["door-open.mp3"],
  "door-close": ["door-close.mp3"],
  tick: ["tick.mp3"],
  "warden-click": ["warden-click-1.mp3", "warden-click-2.mp3", "warden-click-3.mp3"],
  "warden-shriek": ["warden-shriek.mp3"],
  shard: ["shard.mp3"],
  pickup: ["pickup.mp3"],
  "gate-hum": ["gate-hum.mp3"],
  "gate-awake": ["gate-awake.mp3"],
  drip: ["drip-1.mp3", "drip-2.mp3"],
  "death-pit": ["death-pit.mp3"],
  "death-warden": ["death-warden.mp3"],
  complete: ["complete.mp3"],
  "ui-select": ["ui-select.mp3"],
  "ambience-loop": ["ambience-loop.mp3"],
  "title-loop": ["title-loop.mp3"],
} as const satisfies Record<string, readonly string[]>;

export type SampleId = keyof typeof SAMPLES;

/** Loops are large; they load after the short sounds so gameplay sfx are ready first. */
export const LOOP_IDS: readonly SampleId[] = ["ambience-loop", "title-loop"];

export function sampleUrl(file: string): string {
  return `${AUDIO_BASE}/${file}`;
}
