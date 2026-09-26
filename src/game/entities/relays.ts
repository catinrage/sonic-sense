import { hash2 } from "../../core/rng";
import { MIMIC_DELAY, MIMIC_SONG, MIMIC_TRIGGER, TUBE_SONG, TUBE_TRIGGER } from "../calls";
import type { FieldSample } from "../geodesic";
import { COLORS, noteColor } from "../palette";
import type { Wave, WaveKind } from "../waves";
import type { World } from "../world";
import { OriginMemory, type Listener } from "./props";

/**
 * What relays pass on: the creature's sounds and the devices it sets off.
 * Ambient sounds (drips, chimes, creatures' clicks) and alarms are never relayed.
 */
const RELAYED: ReadonlySet<WaveKind> = new Set<WaveKind>(["pulse", "step", "splash", "stone", "lure", "crystal", "bell", "mimic", "tube"]);

/** Sounds at least this big come back in the relay's full voice; smaller ones stay small. */
const FULL_VOICE_RADIUS = 4.5;

interface Voice {
  radius: number;
  strength: number;
  loudness: number;
}

/** The voice a relay answers a wave in: its full song for calls and devices, a small echo for small sounds. */
function answerVoice(wave: Wave, song: { radius: number; strength: number; loudnessCap: number }): Voice {
  const loudness = Math.min(wave.loudness, song.loudnessCap);
  if (wave.radius >= FULL_VOICE_RADIUS) return { radius: song.radius, strength: song.strength, loudness };
  return { radius: Math.max(2.5, wave.radius * 1.4), strength: song.strength * 0.5, loudness };
}

interface Echo {
  at: number;
  note: number | null;
  voice: Voice;
  origin: number;
}

/**
 * The Mimic: rooted, many-mouthed. Whatever it hears it repeats a moment later
 * from where it sits — notes (a relay around corners) and footsteps alike. It
 * answers each root sound once and never repeats an alarm cry.
 */
export class Mimic implements Listener {
  /** 1 while echoing, fading after (for the renderer). */
  voice = 0;
  /** The note it last repeated (for the renderer). */
  lastNote: number | null = null;
  readonly seed: number;
  private readonly queue: Echo[] = [];
  private readonly answered = new OriginMemory();

  constructor(
    readonly x: number,
    readonly y: number,
  ) {
    this.seed = hash2(Math.floor(x), Math.floor(y), 37);
  }

  hear(wave: Wave, sample: FieldSample, world: World): void {
    if (wave.source === this || !RELAYED.has(wave.kind) || this.answered.has(wave.origin, wave.note)) return;
    if (wave.energyAt(sample) < MIMIC_TRIGGER) return;
    this.answered.add(wave.origin, wave.note);
    this.queue.push({ at: world.time + MIMIC_DELAY, note: wave.note, voice: answerVoice(wave, MIMIC_SONG), origin: wave.origin });
  }

  update(dt: number, world: World): void {
    this.voice = Math.max(0, this.voice - dt * 1.5);
    while (this.queue.length > 0 && this.queue[0]!.at <= world.time) {
      const echo = this.queue.shift()!;
      this.voice = 1;
      this.lastNote = echo.note;
      world.emitSound({
        kind: "mimic",
        x: this.x,
        y: this.y,
        radius: echo.voice.radius,
        loudness: echo.voice.loudness,
        strength: echo.voice.strength,
        speed: MIMIC_SONG.speed,
        fade: 2.2,
        color: noteColor(echo.note, COLORS.mimic),
        source: this,
        alerts: echo.voice.loudness > 0,
        hits: true,
        note: echo.note,
        origin: echo.origin,
      });
      world.events.emit("mimic", { x: this.x, y: this.y, note: echo.note });
    }
  }
}

/**
 * One mouth of a speaking tube: what strikes it comes out of the other mouth, at
 * once. A tube never hears what it says itself.
 */
export class TubeMouth implements Listener {
  other!: TubeMouth;
  /** 1 just after a sound comes out of it (for the renderer). */
  voice = 0;
  /** The note that last came out of it (for the renderer). */
  lastNote: number | null = null;
  private readonly answered = new OriginMemory();

  constructor(
    readonly x: number,
    readonly y: number,
  ) {}

  hear(wave: Wave, sample: FieldSample, world: World): void {
    if (wave.source === this || wave.source === this.other || !RELAYED.has(wave.kind)) return;
    if (this.answered.has(wave.origin, wave.note) || wave.energyAt(sample) < TUBE_TRIGGER) return;
    this.answered.add(wave.origin, wave.note);
    this.other.speak(wave, world);
  }

  update(dt: number): void {
    this.voice = Math.max(0, this.voice - dt * 1.5);
  }

  private speak(wave: Wave, world: World): void {
    const voice = answerVoice(wave, TUBE_SONG);
    this.voice = 1;
    this.lastNote = wave.note;
    world.emitSound({
      kind: "tube",
      x: this.x,
      y: this.y,
      radius: voice.radius,
      loudness: voice.loudness,
      strength: voice.strength,
      speed: TUBE_SONG.speed,
      fade: 2,
      color: noteColor(wave.note, COLORS.tube),
      source: this,
      alerts: voice.loudness > 0,
      hits: true,
      note: wave.note,
      origin: wave.origin,
    });
    world.events.emit("tube", { x: this.x, y: this.y, note: wave.note });
  }
}
