import { clamp, lerp } from "../core/math";

/**
 * Shape of the creature's call. This is the single source of truth shared by
 * the simulation (Player) and the static solvability checker: if the checker
 * proves a bell can be rung, it is reasoning about exactly this wave.
 */
export interface CallProfile {
  /** Visual radius in tiles (also the energy falloff distance). */
  radius: number;
  /** How far creatures hear it, in tiles. */
  loudness: number;
  strength: number;
  speed: number;
  fade: number;
}

/** An ordinary call at `charge` (0 = a quick chirp, 1 = a full breath). */
export function callProfile(charge: number): CallProfile {
  const c = clamp(charge, 0, 1);
  const radius = lerp(5.5, 15, c * c * 0.35 + c * 0.65);
  return {
    radius,
    loudness: radius * 1.05,
    strength: lerp(0.9, 1.25, c),
    speed: lerp(8.5, 11, c),
    fade: lerp(2.6, 4.4, c),
  };
}

/** The loudest ordinary call. */
export const FULL_CALL: CallProfile = callProfile(1);

/** A focused call's beam half-angle (radians). */
export const FOCUS_HALF_ANGLE = 0.36;

export interface FocusProfile extends CallProfile {
  halfAngle: number;
}

/**
 * Focus: the same breath squeezed into a narrow beam. It reaches as far and
 * strikes harder along its line, but creatures barely hear it.
 */
export function focusProfile(charge: number): FocusProfile {
  const call = callProfile(charge);
  return {
    radius: call.radius,
    loudness: call.radius * 0.3,
    strength: call.strength * 1.3,
    speed: call.speed * 1.12,
    fade: call.fade,
    halfAngle: FOCUS_HALF_ANGLE,
  };
}

/** Deep Listen: how much further the world's own sounds reveal at full stillness. */
export const LISTEN_GAIN = 2.4;

/** Energy a crystal (or resonator) must receive to start singing. */
export const CRYSTAL_TRIGGER = 0.1;

/** A crystal's answering song: omnidirectional. */
export const CRYSTAL_SONG = { radius: 8.5, loudness: 10, strength: 0.95 } as const;

/**
 * A resonator's song: a crystal backed by a dish, so it sings in one direction
 * only — but the focused beam carries much further.
 */
export const RESONATOR_SONG = { radius: 13, loudness: 9, strength: 1, halfAngle: 0.45 } as const;
