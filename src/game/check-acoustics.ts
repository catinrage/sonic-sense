import type { Vec2 } from "../core/math";
import {
  BELL_SONG,
  CRYSTAL_DELAY,
  CRYSTAL_SONG,
  CRYSTAL_TRIGGER,
  MIMIC_DELAY,
  MIMIC_SONG,
  MIMIC_TRIGGER,
  RESONATOR_SONG,
  TUBE_SONG,
  TUBE_TRIGGER,
} from "./calls";
import { coneGate, FieldJob, MIN_WIND_FACTOR, UNREACHED, type FieldSample, type SoundGrid } from "./geodesic";
import type { GlassSpawn, LevelData } from "./level-types";

/**
 * The checker's model of sound: how each source sings, where each device
 * listens, and what one call sets off. Shared by the solvability proof
 * (level-check.ts) and its tests.
 */

/** A tone: a note 0..4, or WHITE for unpitched sound. */
export const WHITE = 5;
export const TONES = [0, 1, 2, 3, 4, WHITE] as const;
export const toneOf = (note: number | null): number => note ?? WHITE;

/** How a source sings, as far as the proof cares. */
export interface Voice {
  radius: number;
  strength: number;
  /** Tiles per second (cascade timing). */
  speed: number;
  /** A beam's half-angle; the source then sings along a facing. */
  halfAngle?: number;
}

export const CRYSTAL_VOICE: Voice = CRYSTAL_SONG;
export const RESONATOR_VOICE: Voice = RESONATOR_SONG;
export const MIMIC_VOICE: Voice = MIMIC_SONG;
export const TUBE_VOICE: Voice = TUBE_SONG;
export const BELL_VOICE: Voice = BELL_SONG;

const fall = (d: number, r: number): number => {
  const u = Math.min(1, d / r);
  const k = 1 - u * u;
  return k * k;
};

/** Forward, a beam leaves against the direction the backwards field arrives from. */
export function beamGate(facing: Vec2 | null | undefined, arriveX: number, arriveY: number, voice: Voice): number {
  if (voice.halfAngle === undefined || !facing) return 1;
  const len = Math.hypot(arriveX, arriveY);
  if (len < 1e-6) return 1;
  return coneGate(-(arriveX * facing.x + arriveY * facing.y) / len, voice.halfAngle);
}

export interface Strike {
  /** Energy delivered (the same falloff the game's listeners use). */
  e: number;
  /** Travel distance along the field (the front arrives after d / speed). */
  d: number;
}

/**
 * Sound fields of one state of the level, each solved backwards from a
 * listening point and kept. The grid is built with every wind negated (see
 * soundGridFor), so a backwards field sampled at a source gives exactly the
 * forward source-to-listener costs, and one field serves every source.
 */
export class Acoustics {
  private readonly fields = new Map<number, FieldJob>();
  private readonly s: FieldSample = { d: 0, e: 0, dx: 0, dy: 0 };

  constructor(
    readonly grid: SoundGrid,
    /** Largest radius any voice has: every field is solved that far. */
    private readonly radius: number,
  ) {}

  private field(x: number, y: number): FieldJob {
    const key = Math.round(x * 8) * 1_000_003 + Math.round(y * 8);
    let job = this.fields.get(key);
    if (!job) {
      job = new FieldJob(this.grid, x, y, this.radius);
      job.advance(Infinity);
      this.fields.set(key, job);
    }
    return job;
  }

  /** What `voice`, sung at `from` along `facing`, delivers to (tx, ty). */
  strike(from: Vec2, facing: Vec2 | null, voice: Voice, tx: number, ty: number, out: Strike): Strike {
    out.e = 0;
    out.d = UNREACHED;
    // Downwind, sound covers more ground than its radius: widen the cheap prefilter to match.
    const reach = this.grid.hasWind ? voice.radius / MIN_WIND_FACTOR : voice.radius;
    if (Math.hypot(from.x - tx, from.y - ty) > reach) return out;
    const s = this.field(tx, ty).sample(from.x, from.y, this.s);
    if (s.d >= UNREACHED) return out;
    out.d = s.d;
    out.e = voice.strength * s.e * fall(s.d, voice.radius) * beamGate(facing, s.dx, s.dy, voice);
    return out;
  }

  /** The most `voice` delivers to (tx, ty) from any of `sources`. */
  best(sources: readonly Vec2[], voice: Voice, tx: number, ty: number): number {
    let best = 0;
    const st: Strike = { e: 0, d: 0 };
    for (const p of sources) best = Math.max(best, this.strike(p, null, voice, tx, ty, st).e);
    return best;
  }
}

/** A device that hears a sound and answers it: a crystal, a mimic, one direction of a tube, a bell. */
export interface Relay {
  kind: "crystal" | "mimic" | "tube" | "bell";
  /** The device's index in its level array (both directions of a tube share it). */
  index: number;
  ear: Vec2;
  /** Where the answer comes from (a tube answers from its other mouth). */
  mouth: Vec2;
  trigger: number;
  /** Seconds from being struck to answering. */
  delay: number;
  voice: Voice;
  /** The direction a dish sings along, or null for all round. */
  facing: Vec2 | null;
  /** The tone it answers `tone` with, or -1 when that tone does not wake it. */
  answer(tone: number): number;
  /** Answers each root sound once whatever its tone (crystals, bells); mimics and tubes answer each tone once. */
  once: boolean;
  /** A dish a focused call turns rather than wakes. */
  turnable: boolean;
}

export interface RelayOptions {
  crystals: boolean;
  mimics: boolean;
  tubes: boolean;
}

/** Every relay in a level. Bells are relays too: their ring wakes whatever it reaches. */
export function relaysOf(level: LevelData, opts: RelayOptions): Relay[] {
  const out: Relay[] = [];
  if (opts.crystals) {
    level.crystals.forEach((c, i) => {
      const note = c.note;
      out.push({
        kind: "crystal",
        index: i,
        ear: c,
        mouth: c,
        trigger: CRYSTAL_TRIGGER,
        delay: CRYSTAL_DELAY,
        voice: c.facing ? RESONATOR_VOICE : CRYSTAL_VOICE,
        facing: c.facing,
        answer: note === null ? () => WHITE : c.prism ? () => note : (t) => (t === note ? note : -1),
        once: true,
        turnable: c.turnable && c.facing !== null,
      });
    });
  }
  if (opts.mimics) {
    level.mimics.forEach((m, i) =>
      out.push({ kind: "mimic", index: i, ear: m, mouth: m, trigger: MIMIC_TRIGGER, delay: MIMIC_DELAY, voice: MIMIC_VOICE, facing: null, answer: (t) => t, once: false, turnable: false }),
    );
  }
  if (opts.tubes) {
    level.tubes.forEach((t, i) => {
      for (const [ear, mouth] of [
        [t.a, t.b],
        [t.b, t.a],
      ] as const) {
        out.push({ kind: "tube", index: i, ear, mouth, trigger: TUBE_TRIGGER, delay: 0, voice: TUBE_VOICE, facing: null, answer: (tone) => tone, once: false, turnable: false });
      }
    });
  }
  level.bells.forEach((b, i) =>
    out.push({ kind: "bell", index: i, ear: b, mouth: b, trigger: b.threshold, delay: 0, voice: BELL_VOICE, facing: null, answer: () => WHITE, once: true, turnable: false }),
  );
  return out;
}

/** Whether relay `k` can hear relay `j` at all (a tube never hears itself; nothing hears its own voice). */
export function hears(relays: readonly Relay[], k: number, j: number): boolean {
  if (k === j) return false;
  const a = relays[k]!;
  const b = relays[j]!;
  return !(a.kind === "tube" && b.kind === "tube" && a.index === b.index);
}

/** A pane of glass and the points it listens at. */
export interface PaneEars {
  pane: GlassSpawn;
  faces: Vec2[];
}

/** One arrival of a pitched sound at a pane. */
export interface PaneHit {
  t: number;
  tone: number;
}

export interface Cascade {
  /** When each relay first answered (Infinity = never), per relay. */
  answeredAt: number[];
  /** Tones each relay answered with. */
  tones: Set<number>[];
  /** Pitched arrivals at each pane, strong enough to count, by pane index into `panes`. */
  hits: PaneHit[][];
}

interface Emission {
  t: number;
  /** Relay index, or -1 for the call itself. */
  r: number;
  tone: number;
}

/**
 * Everything one call sets off, in time order: the call reaches relays, which
 * answer after their delay and reach further relays, like the game's own
 * waves. Each relay answers the root sound once (once per tone for relays
 * that pass the tone on), so this is a shortest-time search over answers.
 */
export function cascade(
  ac: Acoustics,
  relays: readonly Relay[],
  facings: readonly (Vec2 | null)[],
  panes: readonly PaneEars[],
  from: Vec2,
  tone: number,
  voice: Voice,
): Cascade {
  const answeredAt = relays.map(() => Infinity);
  const tones = relays.map(() => new Set<number>());
  const hits: PaneHit[][] = panes.map(() => []);
  const queue: Emission[] = [{ t: 0, r: -1, tone }];
  const st: Strike = { e: 0, d: 0 };

  while (queue.length > 0) {
    const ev = popEarliest(queue);
    const src = ev.r >= 0 ? relays[ev.r]! : null;
    if (src) {
      const done = tones[ev.r]!;
      if (src.once ? done.size > 0 : done.has(ev.tone)) continue;
      done.add(ev.tone);
      answeredAt[ev.r] = Math.min(answeredAt[ev.r]!, ev.t);
    }
    const mouth = src ? src.mouth : from;
    const facing = src ? facings[ev.r]! : null;
    const v = src ? src.voice : voice;

    for (let k = 0; k < relays.length; k++) {
      if (src && !hears(relays, k, ev.r)) continue;
      const r = relays[k]!;
      const out = r.answer(ev.tone);
      if (out < 0 || (r.once ? tones[k]!.size > 0 : tones[k]!.has(out))) continue;
      if (ac.strike(mouth, facing, v, r.ear.x, r.ear.y, st).e < r.trigger) continue;
      queue.push({ t: ev.t + st.d / v.speed + r.delay, r: k, tone: out });
    }
    if (ev.tone === WHITE) continue;
    panes.forEach((p, i) => {
      let first = Infinity;
      for (const f of p.faces) {
        if (ac.strike(mouth, facing, v, f.x, f.y, st).e >= p.pane.threshold) first = Math.min(first, ev.t + st.d / v.speed);
      }
      if (first < Infinity) hits[i]!.push({ t: first, tone: ev.tone });
    });
  }
  return { answeredAt, tones, hits };
}

function popEarliest(queue: Emission[]): Emission {
  let best = 0;
  for (let i = 1; i < queue.length; i++) if (queue[i]!.t < queue[best]!.t) best = i;
  const ev = queue[best]!;
  queue[best] = queue[queue.length - 1]!;
  queue.pop();
  return ev;
}

/** A discord this close after a chord completes might, with a frame's timing, land first. */
const DISCORD_MARGIN = 0.15;

/**
 * Whether a chord pane rings every one of its notes at once, given the pitched
 * arrivals it hears, played in time order as the pane hears them: each note
 * rings for `sustain` seconds after it arrives, and an off-chord note is a
 * discord that silences every note ringing. The pane breaks the moment all
 * its notes ring together.
 */
export function chordRings(hits: readonly PaneHit[], notes: readonly number[], sustain: number): boolean {
  const events = [...hits].sort((a, b) => a.t - b.t);
  const discord = (h: PaneHit) => !notes.includes(h.tone);
  const rang = new Map<number, number>();
  for (const ev of events) {
    if (discord(ev)) {
      rang.clear();
      continue;
    }
    rang.set(ev.tone, ev.t);
    if (!notes.every((n) => rang.has(n) && ev.t - rang.get(n)! < sustain)) continue;
    if (!events.some((d) => discord(d) && d.t >= ev.t && d.t <= ev.t + DISCORD_MARGIN)) return true;
  }
  return false;
}
