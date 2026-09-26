import type { RGB } from "../core/math";
import { FieldJob, UNREACHED, type Cone, type FieldSample, type SoundGrid } from "./geodesic";

export const MAX_WAVES = 16;

export type WaveKind =
  | "pulse"
  | "step"
  | "splash"
  | "stone"
  | "crystal"
  | "bell"
  | "warden"
  | "wardenAlert"
  | "exit"
  | "drip"
  | "door"
  | "sentinel"
  | "chime"
  | "lure"
  | "tremor";

/** Kind ids shared with the shaders (uWaveB.w). */
export const WAVE_KIND_ID: Record<WaveKind, number> = {
  pulse: 0,
  step: 1,
  splash: 2,
  stone: 3,
  crystal: 4,
  bell: 5,
  warden: 6,
  wardenAlert: 7,
  exit: 8,
  drip: 9,
  door: 10,
  sentinel: 11,
  chime: 12,
  lure: 13,
  tremor: 14,
};

/** Lower = evicted first when all texture layers are in use. */
const PRIORITY: Record<WaveKind, number> = {
  step: 0,
  drip: 0,
  // A warden's echolocation click is pure ambience (loudness 0), so it yields
  // its layer before anything that carries gameplay meaning. With several
  // creatures on screen these would otherwise churn layers constantly.
  warden: 0,
  tremor: 0,
  splash: 1,
  lure: 2,
  chime: 2,
  sentinel: 2,
  exit: 1,
  door: 2,
  stone: 3,
  bell: 3,
  crystal: 3,
  wardenAlert: 3,
  pulse: 4,
};

export interface WaveSpec {
  kind: WaveKind;
  x: number;
  y: number;
  /** Visual radius in tiles. */
  radius: number;
  /** Hearing radius for creatures (defaults to the visual radius). */
  loudness?: number;
  strength?: number;
  /** Tiles per second. */
  speed?: number;
  color: RGB;
  /** Seconds the reveal lingers after the front passes. */
  fade?: number;
  source?: object | null;
  /** Whether wardens react to this sound. */
  alerts?: boolean;
  /** Record wall impact points (sparks, audio echoes). */
  hits?: boolean;
  /** Visual brightness multiplier (does not change gameplay energy). */
  glow?: number;
  /** Directional emitter: the sound leaves only within this beam. */
  cone?: Cone;
  /** Made by the player (Deep Listen never amplifies the creature's own sounds). */
  own?: boolean;
  /** Solve the field this many times past the visual radius, so Deep Listen can reveal further. */
  revealHeadroom?: number;
}

let nextWaveId = 1;

export class Wave {
  readonly id = nextWaveId++;
  readonly kind: WaveKind;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly loudness: number;
  readonly strength: number;
  readonly speed: number;
  readonly color: RGB;
  readonly fade: number;
  readonly source: object | null;
  readonly alerts: boolean;
  readonly glow: number;
  readonly own: boolean;
  readonly job: FieldJob;
  readonly t0: number;
  readonly lifetime: number;
  layer = -1;
  /** Objects that already reacted to this wave. */
  readonly heard = new Set<object>();
  /** Index into job.hits of the next wall impact to spawn effects for. */
  hitCursor = 0;

  constructor(spec: WaveSpec, grid: SoundGrid, now: number) {
    this.kind = spec.kind;
    this.radius = spec.radius;
    this.loudness = spec.loudness ?? spec.radius;
    this.strength = spec.strength ?? 1;
    this.speed = spec.speed ?? 9;
    this.color = spec.color;
    this.fade = spec.fade ?? 2.5;
    this.source = spec.source ?? null;
    this.alerts = spec.alerts ?? false;
    this.glow = spec.glow ?? 1;
    this.own = spec.own ?? false;
    this.t0 = now;
    const reach = Math.max(this.radius * (spec.revealHeadroom ?? 1), this.loudness);
    this.job = new FieldJob(grid, spec.x, spec.y, reach, spec.hits ?? false, spec.cone ?? null);
    this.x = this.job.originX;
    this.y = this.job.originY;
    this.lifetime = reach / this.speed + this.fade + 0.4;
  }

  age(now: number): number {
    return now - this.t0;
  }

  /** Current front radius (tiles). */
  front(now: number): number {
    return this.age(now) * this.speed;
  }

  /** Visual/trigger energy at a field sample (matches the shader falloff). */
  energyAt(s: FieldSample): number {
    if (s.d >= UNREACHED) return 0;
    const u = Math.min(1, s.d / this.radius);
    const k = 1 - u * u;
    return this.strength * s.e * k * k;
  }
}

/**
 * Owns live waves, assigns them GPU texture layers and advances their
 * propagation fields just ahead of the visible front.
 */
export class WaveSystem {
  readonly waves: Wave[] = [];
  private readonly freeLayers: number[] = [];
  private readonly scratch: FieldSample = { d: 0, e: 0, dx: 0, dy: 0 };

  constructor(private grid: SoundGrid) {
    for (let i = MAX_WAVES - 1; i >= 0; i--) this.freeLayers.push(i);
  }

  setGrid(grid: SoundGrid): void {
    this.grid = grid;
    this.clear();
  }

  clear(): void {
    this.waves.length = 0;
    this.freeLayers.length = 0;
    for (let i = MAX_WAVES - 1; i >= 0; i--) this.freeLayers.push(i);
  }

  emit(spec: WaveSpec, now: number): Wave {
    const wave = new Wave(spec, this.grid, now);
    // Small fields are cheap: solve them at once. Big ones are solved progressively.
    if (Math.max(wave.radius, wave.loudness) <= 4.5) wave.job.advance(Infinity);
    else wave.job.advance(1.5);
    wave.layer = this.allocateLayer();
    this.waves.push(wave);
    return wave;
  }

  update(now: number): void {
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const wave = this.waves[i]!;
      if (wave.age(now) > wave.lifetime) {
        this.release(i);
        continue;
      }
      if (!wave.job.done) wave.job.advance(wave.front(now) + 1.5 + wave.speed * 0.08);
    }
  }

  /** Samples a wave's field; returns null if the front has not reached (x, y) yet. */
  arrival(wave: Wave, x: number, y: number, now: number): FieldSample | null {
    const s = wave.job.sample(x, y, this.scratch);
    if (s.d >= UNREACHED || s.d > wave.front(now)) return null;
    return s;
  }

  /**
   * Claim a texture layer, taking one from the least important visible wave
   * when all are in use.
   *
   * The evicted wave keeps running in the simulation and is still heard — only
   * its reveal is dropped. Listeners are notified as the front reaches them
   * (see World.processHearing), so removing the wave outright would silently
   * swallow every arrival still to come: a bell strike or a crystal relay could
   * simply never land, breaking a puzzle the solvability checker proved.
   */
  private allocateLayer(): number {
    const free = this.freeLayers.pop();
    if (free !== undefined) return free;
    let victim = -1;
    for (let i = 0; i < this.waves.length; i++) {
      const w = this.waves[i]!;
      if (w.layer < 0) continue;
      if (victim < 0) {
        victim = i;
        continue;
      }
      const v = this.waves[victim]!;
      if (PRIORITY[w.kind] < PRIORITY[v.kind] || (PRIORITY[w.kind] === PRIORITY[v.kind] && w.t0 < v.t0)) victim = i;
    }
    if (victim < 0) return -1;
    const evicted = this.waves[victim]!;
    const layer = evicted.layer;
    evicted.layer = -1;
    return layer;
  }

  private release(index: number): void {
    const [wave] = this.waves.splice(index, 1);
    if (wave && wave.layer >= 0) this.freeLayers.push(wave.layer);
  }
}
