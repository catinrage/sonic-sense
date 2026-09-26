/**
 * Per-creature behaviour. Every hunter in the game is a `Warden` driven by one
 * of these trait sets, so new creatures are mostly configuration.
 */

export type CreatureKind = "warden" | "chorus" | "stalker" | "sentinel" | "tremor" | "metronome" | "conductor";

export interface WardenTraits {
  kind: CreatureKind;
  /** Look variant for the creature shader (see render/glsl/entity-warden.ts). */
  variant: number;
  /** Drawn size relative to a Warden. */
  scale: number;
  patrolSpeed: number;
  huntSpeed: number;
  speedMul: number;
  /** Seconds a hunt keeps pushing along its path before giving up. */
  giveUpAfter: number;
  /** Seconds spent listening, frill flared, before the hunt begins. */
  alertTime: number;
  /** Seconds spent searching where the sound came from. */
  searchTime: number;
  /** Hearing reach = loudness × (hearBase + hearBend × energy left after bending round corners). */
  hearBase: number;
  hearBend: number;
  /** Added to the touch distance at which it catches the player. */
  catchSlack: number;
  /** Hears sound through the air (calls, bells, crystals, splashes). Tremors do not. */
  hearsAir: boolean;
  /** Feels the player's footfalls through the ground within this many tiles (0 = never). */
  feelsSteps: number;
  /** How far its alarm cry carries to other creatures (0 = a private cry). */
  cryLoudness: number;
  /** Seconds before an alarm it heard from a peer can move it again (prevents echo loops). */
  peerCooldown: number;
  /** Never walks: turns towards sounds but keeps its post. */
  anchored: boolean;
  /** Seconds between the calls it makes on its own to see (0 = none). */
  pulsePeriod: number;
  /** Visual radius of those calls. */
  pulseRadius: number;
  /** Searches by walking circles around the spot instead of standing still. */
  prowls: boolean;
  /**
   * Seconds between the pulses of a creature that keeps a strict beat (0 = none).
   * It hears nothing: it sees whatever is moving when its pulse passes.
   */
  beat: number;
  /** Hears every discord struck anywhere, however far. */
  hearsDiscord: boolean;
}

export const DEFAULT_TRAITS: Readonly<WardenTraits> = {
  kind: "warden",
  variant: 0,
  scale: 1,
  patrolSpeed: 1.1,
  huntSpeed: 3.1,
  speedMul: 1,
  giveUpAfter: 12,
  alertTime: 0.45,
  searchTime: 3.4,
  hearBase: 0.45,
  hearBend: 0.55,
  catchSlack: -0.02,
  hearsAir: true,
  feelsSteps: 0,
  cryLoudness: 0,
  peerCooldown: 8,
  anchored: false,
  pulsePeriod: 0,
  pulseRadius: 0,
  prowls: false,
  beat: 0,
  hearsDiscord: false,
};

const CREATURES: Record<CreatureKind, Partial<WardenTraits>> = {
  /** The first hunter: hears everything, gives up after a while. */
  warden: {},
  /** Pack hunters: smaller and quicker, and their alarm cry rallies the others. */
  chorus: { variant: 1, scale: 0.86, huntSpeed: 3.25, patrolSpeed: 1.2, searchTime: 2.4, cryLoudness: 7 },
  /** Never gives up. Slow, and circles the last place it heard you. */
  stalker: {
    variant: 3,
    scale: 1.12,
    huntSpeed: 2.3,
    patrolSpeed: 0.9,
    giveUpAfter: Infinity,
    searchTime: 9,
    prowls: true,
    alertTime: 0.9,
  },
  /** Rooted in place. Calls on its own, lighting the room, and screams for help when it hears you. */
  sentinel: {
    variant: 2,
    scale: 1.2,
    anchored: true,
    alertTime: 0.35,
    cryLoudness: 18,
    pulsePeriod: 4.2,
    pulseRadius: 7.5,
    catchSlack: 0.05,
  },
  /** Deaf to the air. Feels footsteps and falling stones through the ground. */
  tremor: { variant: 4, scale: 1.05, hearsAir: false, feelsSteps: 5, huntSpeed: 3.3, patrolSpeed: 1.05, searchTime: 3.6 },
  /** Keeps a strict beat. Deaf, but its pulse sees anything moving as it passes. */
  metronome: {
    variant: 5,
    scale: 1.15,
    hearsAir: false,
    beat: 3,
    pulseRadius: 9,
    huntSpeed: 3.1,
    patrolSpeed: 1,
    searchTime: 2.6,
    giveUpAfter: 9,
    alertTime: 0.3,
  },
  /** The Instrument's keeper: slow, relentless, and it hears every discord. */
  conductor: {
    variant: 6,
    scale: 1.3,
    huntSpeed: 2.45,
    patrolSpeed: 0.95,
    giveUpAfter: Infinity,
    searchTime: 7,
    prowls: true,
    alertTime: 0.8,
    hearsDiscord: true,
  },
};

/** Traits for a creature kind, with optional per-spawn overrides. */
export function creatureTraits(kind: CreatureKind = "warden", overrides: Partial<WardenTraits> = {}): WardenTraits {
  return { ...DEFAULT_TRAITS, ...CREATURES[kind], ...overrides, kind };
}

export const CREATURE_KINDS = Object.keys(CREATURES) as CreatureKind[];
