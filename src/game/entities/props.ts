import { clamp, damp, type Vec2 } from "../../core/math";
import { BELL_SONG, CRYSTAL_DELAY, CRYSTAL_SONG, CRYSTAL_TRIGGER, DISH_TURN_TRIGGER, RESONATOR_SONG } from "../calls";
import { fxRng, hash2, Rng, seedFor } from "../../core/rng";
import type { FieldSample } from "../geodesic";
import { COLORS, noteColor } from "../palette";
import type { Wave } from "../waves";
import type { World } from "../world";

/** Anything that reacts when a wavefront reaches it. */
export interface Listener {
  x: number;
  y: number;
  hear(wave: Wave, sample: FieldSample, world: World): void;
}

const GRAVITY = 22;
/** Lure Stone: chirps a resting stone makes, and the pause between them. */
export const LURE_CHIRPS = 10;
const LURE_PERIOD = 1.1;

export interface CrystalTuning {
  /** The note it sings; null for a white crystal. */
  note: number | null;
  /** Wakes to any sound, but sings its own note. */
  prism: boolean;
  /** A dish a focused call turns a quarter step. */
  turnable: boolean;
}

/** How many recent root sounds a relay remembers having answered. */
const ANSWERED_MEMORY = 16;

/**
 * Keeps the root sounds a relay has answered, so it answers each at most once
 * (once per tone, for relays that pass the tone on): echoes cannot feed back.
 */
export class OriginMemory {
  private readonly seen: number[] = [];

  has(origin: number, note: number | null = null): boolean {
    return this.seen.includes(memoryKey(origin, note));
  }

  add(origin: number, note: number | null = null): void {
    this.seen.push(memoryKey(origin, note));
    if (this.seen.length > ANSWERED_MEMORY) this.seen.shift();
  }
}

const memoryKey = (origin: number, note: number | null): number => origin * 8 + (note ?? 7);

/**
 * Resonance crystal: re-emits a wave when struck by sound. Loud — creatures hear it.
 * White crystals answer anything; tuned crystals only their own note; prisms
 * answer anything but sing their note.
 */
export class Crystal implements Listener {
  glow = 0;
  cooldown = 0;
  pending = -1;
  readonly seed: number;
  shake = 0;
  readonly note: number | null;
  readonly prism: boolean;
  readonly turnable: boolean;
  /** A resonator's beam direction: its dish sends the song one way only. */
  beam: Vec2 | null;
  /** Seconds since the dish last turned (animation). */
  turned = 99;
  private readonly answered = new OriginMemory();
  private pendingOrigin = 0;

  constructor(
    readonly x: number,
    readonly y: number,
    beam: Vec2 | null = null,
    tuning: Partial<CrystalTuning> = {},
  ) {
    this.beam = beam;
    this.note = tuning.note ?? null;
    this.prism = tuning.prism ?? false;
    this.turnable = (tuning.turnable ?? false) && beam !== null;
    this.seed = hash2(Math.floor(x), Math.floor(y), 71);
  }

  /** Whether a sound of this note can wake it. */
  accepts(note: number | null): boolean {
    return this.note === null || this.prism || note === this.note;
  }

  hear(wave: Wave, sample: FieldSample, world: World): void {
    // Creatures' own senses — echolocation clicks, a tremor's tread — never set a crystal singing.
    if (wave.source === this || wave.kind === "warden" || wave.kind === "tremor") return;
    const e = wave.energyAt(sample);
    // A focused call turns a dish instead of waking it.
    if (this.turnable && wave.own && wave.cone) {
      if (e >= DISH_TURN_TRIGGER) this.turn(world);
      return;
    }
    if (this.cooldown > 0 || this.pending >= 0 || this.answered.has(wave.origin)) return;
    if (!this.accepts(wave.note) || e < CRYSTAL_TRIGGER) return;
    this.answered.add(wave.origin);
    this.pendingOrigin = wave.origin;
    this.pending = CRYSTAL_DELAY;
    this.shake = 1;
  }

  /** A quarter turn clockwise, with a soft grind hunters nearby can hear. */
  private turn(world: World): void {
    const b = this.beam;
    if (!b) return;
    // `|| 0` keeps the axes free of negative zeros.
    this.beam = { x: -b.y || 0, y: b.x || 0 };
    this.turned = 0;
    world.emitSound({ kind: "door", x: this.x, y: this.y, radius: 1.6, loudness: 3, strength: 0.4, speed: 5, fade: 0.9, color: COLORS.door, source: this, alerts: true });
    world.events.emit("dishTurn", { x: this.x, y: this.y });
  }

  update(dt: number, world: World): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.glow = Math.max(0, this.glow - dt * 0.45);
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.turned += dt;
    if (this.pending < 0) return;
    this.pending -= dt;
    this.glow = Math.max(this.glow, 0.35);
    if (this.pending > 0) return;
    this.pending = -1;
    this.cooldown = 2.4;
    this.glow = 1;
    const { beam } = this;
    const song = beam ? RESONATOR_SONG : CRYSTAL_SONG;
    world.emitSound({
      kind: "crystal",
      x: this.x,
      y: this.y,
      radius: song.radius,
      loudness: song.loudness,
      strength: song.strength,
      speed: song.speed,
      fade: 3.2,
      color: noteColor(this.note, COLORS.crystal),
      source: this,
      alerts: true,
      hits: true,
      glow: 0.62,
      cone: beam ? { x: beam.x, y: beam.y, halfAngle: RESONATOR_SONG.halfAngle } : undefined,
      note: this.note,
      origin: this.pendingOrigin,
    });
    world.events.emit("crystal", { x: this.x, y: this.y, note: this.note, beam });
  }
}

/** Bronze bell on a stone frame: opens its door group when rung hard enough. */
export class Bell implements Listener {
  ring = 0;
  wobble = 0;
  timer = 0;
  cooldown = 0;
  /** A bell rings once per root sound, so an echo of its own ring cannot ring it again. */
  private readonly answered = new OriginMemory();

  constructor(
    readonly x: number,
    readonly y: number,
    readonly group: number,
    readonly timed: number,
    readonly threshold: number,
    /** A sluice bell: each ring floods or drains its group's basins. */
    readonly toggle = false,
  ) {}

  hear(wave: Wave, sample: FieldSample, world: World): void {
    if (wave.source === this || this.cooldown > 0 || this.answered.has(wave.origin)) return;
    const e = wave.energyAt(sample);
    if (e < this.threshold) {
      if (e > 0.05) this.wobble = Math.max(this.wobble, e * 0.8);
      return;
    }
    this.answered.add(wave.origin);
    this.strike(world, wave.origin);
  }

  strike(world: World, origin?: number): void {
    this.ring = 1;
    this.wobble = 1;
    this.cooldown = 0.6;
    if (this.timed > 0) this.timer = this.timed;
    world.emitSound({
      kind: "bell",
      x: this.x,
      y: this.y,
      radius: BELL_SONG.radius,
      loudness: BELL_SONG.loudness,
      strength: BELL_SONG.strength,
      speed: BELL_SONG.speed,
      fade: 2.6,
      color: COLORS.bell,
      source: this,
      alerts: true,
      origin,
    });
    if (this.toggle) world.toggleBasins(this.group);
    else world.setGroupOpen(this.group, true, this);
    world.events.emit("bell", { x: this.x, y: this.y, group: this.group });
  }

  update(dt: number, world: World): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.ring = Math.max(0, this.ring - dt * 0.35);
    this.wobble = Math.max(0, this.wobble - dt * 0.8);
    if (this.timer > 0) {
      const before = Math.ceil(this.timer);
      this.timer -= dt;
      if (Math.ceil(this.timer) !== before && this.timer > 0) world.events.emit("tick", { x: this.x, y: this.y, left: this.timer });
      if (this.timer <= 0) {
        this.timer = 0;
        world.setGroupOpen(this.group, false, this);
      }
    }
  }
}

/** Echo shard collectible. Glints when a wave passes. */
export class Shard implements Listener {
  collected = false;
  glint = 0;
  collectT = 0;
  readonly phase: number;

  constructor(
    readonly x: number,
    readonly y: number,
  ) {
    this.phase = hash2(Math.floor(x), Math.floor(y), 5) * 10;
  }

  hear(wave: Wave, sample: FieldSample): void {
    this.glint = Math.max(this.glint, clamp(wave.energyAt(sample) * 2, 0.3, 1));
  }

  update(dt: number): void {
    this.glint = Math.max(0, this.glint - dt * 0.6);
    if (this.collected) this.collectT += dt;
  }
}

/** The Gate: hums to guide the player, awakens once all shards are gathered. */
export class ExitGate {
  active: boolean;
  awaken = 0;
  hum = 0;
  private humTimer = 1.2;

  constructor(
    readonly x: number,
    readonly y: number,
    requiresShards: boolean,
  ) {
    this.active = !requiresShards;
    this.awaken = this.active ? 1 : 0;
  }

  activate(world: World): void {
    if (this.active) return;
    this.active = true;
    this.humTimer = 0.1;
    world.events.emit("exitAwake", { x: this.x, y: this.y });
  }

  update(dt: number, world: World): void {
    this.awaken = damp(this.awaken, this.active ? 1 : 0, 1.5, dt);
    this.hum = Math.max(0, this.hum - dt * 0.8);
    this.humTimer -= dt;
    if (this.humTimer > 0) return;
    this.humTimer = this.active ? 3.2 : 5.5;
    this.hum = 1;
    world.emitSound({
      kind: "exit",
      x: this.x,
      y: this.y,
      radius: this.active ? 4.2 : 2.4,
      loudness: 0,
      strength: this.active ? 0.7 : 0.45,
      speed: 4.5,
      fade: 1.8,
      color: COLORS.exit,
      source: this,
    });
    world.events.emit("exitHum", { x: this.x, y: this.y, active: this.active });
  }
}

/** A pebble: thrown in an arc, clacks on landing (loud), can be picked up again. */
export class Stone {
  vx = 0;
  vy = 0;
  vz = 0;
  z = 0.3;
  resting = false;
  lost = false;
  bounces = 0;
  spin = fxRng.range(0, Math.PI * 2);
  pickupDelay = 0.5;
  /** Chirps left once it lands (the Lure Stone ability). */
  lureLeft = 0;
  private lureTimer = 0;
  /** 1 at each chirp, fading between them. */
  private chirpFlash = 0;

  /** How brightly a calling lure stone glows (0 once it has fallen quiet). */
  get lureGlow(): number {
    return this.lureLeft > 0 ? 0.35 + 0.65 * this.chirpFlash : this.chirpFlash * 0.5;
  }

  constructor(
    public x: number,
    public y: number,
  ) {}

  launch(tx: number, ty: number): void {
    const flight = 0.34 + Math.hypot(tx - this.x, ty - this.y) * 0.045;
    this.vx = (tx - this.x) / flight;
    this.vy = (ty - this.y) / flight;
    this.vz = (GRAVITY * flight) / 2 - this.z / flight;
    this.resting = false;
  }

  update(dt: number, world: World): void {
    this.pickupDelay = Math.max(0, this.pickupDelay - dt);
    if (this.lost) return;
    if (this.resting) {
      this.chirp(dt, world);
      return;
    }
    this.spin += dt * Math.hypot(this.vx, this.vy) * 3;
    this.vz -= GRAVITY * dt;
    const nx = this.x + this.vx * dt;
    const ny = this.y + this.vy * dt;
    if (world.stoneBlocked(Math.floor(nx), Math.floor(this.y))) this.vx = -this.vx * 0.45;
    else this.x = nx;
    if (world.stoneBlocked(Math.floor(this.x), Math.floor(ny))) this.vy = -this.vy * 0.45;
    else this.y = ny;
    this.z += this.vz * dt;
    if (this.z > 0) return;

    if (world.isPitAt(this.x, this.y)) {
      this.lost = true;
      world.events.emit("stoneLost", { x: this.x, y: this.y });
      return;
    }
    this.z = 0;
    const impact = Math.abs(this.vz);
    world.stoneImpact(this, impact);
    this.bounces++;
    this.vz = impact * 0.32;
    this.vx *= 0.45;
    this.vy *= 0.45;
    if (impact < 2.2 || this.bounces >= 3) {
      this.resting = true;
      this.vx = this.vy = this.vz = 0;
      if (world.abilities.has("lureStone")) {
        this.lureLeft = LURE_CHIRPS;
        this.lureTimer = LURE_PERIOD * 0.6;
      }
    }
  }

  /** A lure stone keeps calling where it lies: a decoy creatures come to investigate. */
  private chirp(dt: number, world: World): void {
    this.chirpFlash = Math.max(0, this.chirpFlash - dt * 2.5);
    if (this.lureLeft <= 0) return;
    this.lureTimer -= dt;
    if (this.lureTimer > 0) return;
    this.lureTimer = LURE_PERIOD;
    this.lureLeft--;
    this.chirpFlash = 1;
    world.emitSound({
      kind: "lure",
      x: this.x,
      y: this.y,
      radius: 3.2,
      loudness: 9,
      strength: 0.6,
      speed: 7,
      fade: 1.6,
      color: COLORS.lure,
      source: this,
      alerts: true,
    });
    world.events.emit("lure", { x: this.x, y: this.y, left: this.lureLeft });
  }
}


/** A small cairn of pebbles the player can pick from. */
export class StonePile {
  constructor(
    readonly x: number,
    readonly y: number,
    public count: number,
  ) {}
}

/** Sound-sensitive fungi: glow after being struck by a wave, fading slowly. */
export class Mushroom implements Listener {
  glow = 0;
  readonly seed: number;

  constructor(
    readonly x: number,
    readonly y: number,
  ) {
    this.seed = hash2(Math.floor(x), Math.floor(y), 13);
  }

  hear(wave: Wave, sample: FieldSample): void {
    this.glow = Math.min(1.2, Math.max(this.glow, wave.energyAt(sample) * 1.8));
  }

  update(dt: number): void {
    this.glow = Math.max(0, this.glow - dt * 0.12 * (0.4 + this.glow));
  }
}

/** Water dripping from the ceiling: periodic faint splashes reveal small areas. */
export class Drip {
  timer: number;
  falling = -1;
  /** Seconds since the last drop landed. */
  since = 99;
  private readonly rng: Rng;

  constructor(
    readonly x: number,
    readonly y: number,
  ) {
    this.rng = new Rng(seedFor(x, y, 0xd41));
    this.timer = this.rng.range(0.5, 4);
  }

  update(dt: number, world: World): void {
    this.since += dt;
    if (this.falling >= 0) {
      this.falling += dt;
      if (this.falling >= DRIP_FALL) {
        this.falling = -1;
        this.since = 0;
        world.emitSound({
          kind: "drip",
          x: this.x,
          y: this.y,
          radius: 2.2,
          loudness: 0,
          strength: 0.55,
          speed: 4.2,
          fade: 1.5,
          color: COLORS.drip,
          source: this,
        });
        world.events.emit("drip", { x: this.x, y: this.y });
      }
      return;
    }
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = this.rng.range(2.8, 6.5);
      this.falling = 0;
    }
  }
}

export const DRIP_FALL = 0.55;
