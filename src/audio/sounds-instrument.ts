import type { AudioCore } from "./engine";
import type { SampleBank } from "./samples";

/**
 * The Instrument's sounds (Act III). All synthesized: notes must be exactly in
 * tune with each other, and the crystal sample is the only recording retuned.
 */

/** The five tones A C D E G, in the crystals' register (Hz). */
export const NOTE_HZ = [880, 1046.5, 1174.66, 1318.5, 1568];

const hz = (note: number, octave = 0): number => NOTE_HZ[note % NOTE_HZ.length]! * Math.pow(2, octave);

export class InstrumentSfx {
  constructor(
    private readonly core: AudioCore,
    private readonly bank: SampleBank,
  ) {}

  /** A keyed call: the ordinary chirp carries a sung note an octave below the crystals. */
  keyedCall(note: number, charge: number): void {
    const c = this.core;
    const v = c.direct(0.8, 0.5);
    if (!v) return;
    const f = hz(note, -1);
    c.tone(v.input, v.t + 0.02, { type: "triangle", f0: f, attack: 0.03, decay: 0.8 + charge * 0.8, gain: 0.12 });
    c.tone(v.input, v.t + 0.02, { f0: f * 2, attack: 0.03, decay: 0.6 + charge * 0.5, gain: 0.04 });
  }

  /** A pane taking its note: a long, pure glassy ring. */
  glassRing(x: number, y: number, note: number): void {
    const c = this.core;
    const v = c.spatial(x, y, 1, 0.9);
    if (!v) return;
    const f = hz(note, 1);
    c.tone(v.input, v.t, { f0: f, attack: 0.01, decay: 3.2, gain: 0.07 });
    c.tone(v.input, v.t, { f0: f * 2.01, attack: 0.01, decay: 1.6, gain: 0.025 });
    c.tone(v.input, v.t, { f0: f * 3.98, attack: 0.005, decay: 0.5, gain: 0.012 });
  }

  /** A wrong note on a single pane: a dull clink. */
  glassClink(x: number, y: number): void {
    const c = this.core;
    const v = c.spatial(x, y, 0.8, 0.4);
    if (!v) return;
    c.tone(v.input, v.t, { f0: 3100, decay: 0.09, gain: 0.08 });
    c.tone(v.input, v.t, { f0: 4870, decay: 0.05, gain: 0.04 });
    c.burst(v.input, v.t, { freq: 5000, q: 6, decay: 0.02, gain: 0.05 });
  }

  /** Glass breaking: a crash, then its notes falling apart in a spray of shards. */
  glassShatter(x: number, y: number, notes: readonly number[]): void {
    const c = this.core;
    const v = c.spatial(x, y, 1.3, 0.8);
    if (!v) return;
    const t = v.t;
    c.burst(v.input, t, { freq: 5200, freq1: 2400, q: 0.8, decay: 0.5, gain: 0.35 });
    c.burst(v.input, t, { type: "highpass", freq: 7000, q: 0.5, decay: 0.9, gain: 0.12 });
    for (const n of notes) c.tone(v.input, t, { f0: hz(n, 1), f1: hz(n, 1) * 0.94, glide: 1.2, decay: 1.4, gain: 0.06 });
    for (let i = 0; i < 9; i++) {
      const at = t + 0.05 + Math.random() * 0.7;
      const f = 2600 + Math.random() * 5200;
      c.tone(v.input, at, { f0: f, decay: 0.06 + Math.random() * 0.12, gain: 0.02 + Math.random() * 0.03 });
    }
  }

  /** A discord: two tones a semitone apart, beating against each other, over a sour tritone. */
  discord(x: number, y: number): void {
    const c = this.core;
    const v = c.spatial(x, y, 1.2, 0.8);
    if (!v) return;
    const t = v.t;
    c.tone(v.input, t, { type: "sawtooth", f0: 622, decay: 1.1, gain: 0.05, attack: 0.02 });
    c.tone(v.input, t, { type: "sawtooth", f0: 659, decay: 1.1, gain: 0.05, attack: 0.02 });
    c.tone(v.input, t, { type: "triangle", f0: 311, f1: 294, glide: 1, decay: 1.4, gain: 0.08, attack: 0.02 });
    c.burst(v.input, t, { freq: 1800, q: 3, decay: 0.2, gain: 0.06 });
  }

  /** The Mimic's echo: a wet, many-throated warble of what it heard, in its note if it had one. */
  mimic(x: number, y: number, note: number | null): void {
    const c = this.core;
    const v = c.spatial(x, y, 1, 0.9);
    if (!v) return;
    const t = v.t;
    const f = note === null ? 620 : hz(note, -1);
    for (let i = 0; i < 3; i++) {
      c.tone(v.input, t + i * 0.035, { type: "triangle", f0: f * (1 + (i - 1) * 0.012), f1: f * 0.97, glide: 0.5, attack: 0.03, decay: 0.7, gain: 0.05 });
    }
    c.burst(v.input, t, { freq: f * 2, q: 4, attack: 0.03, decay: 0.35, gain: 0.05 });
  }

  /** Sound leaving a speaking tube: a hollow, piped version of what went in. */
  tube(x: number, y: number, note: number | null): void {
    const c = this.core;
    const v = c.spatial(x, y, 1, 0.7);
    if (!v) return;
    const t = v.t;
    c.burst(v.input, t, { freq: 420, q: 9, attack: 0.02, decay: 0.6, gain: 0.3 });
    c.burst(v.input, t, { freq: 840, q: 12, attack: 0.02, decay: 0.4, gain: 0.12 });
    if (note !== null) c.tone(v.input, t + 0.01, { type: "triangle", f0: hz(note, -1), attack: 0.02, decay: 0.9, gain: 0.07 });
  }

  /** A dish turning a quarter step: a short stony grind and a seat-click. */
  dishTurn(x: number, y: number): void {
    const c = this.core;
    const v = c.spatial(x, y, 0.9, 0.4);
    if (!v) return;
    const t = v.t;
    c.burst(v.input, t, { type: "lowpass", freq: 380, freq1: 220, q: 1.2, attack: 0.04, decay: 0.35, gain: 0.3, brown: true });
    c.burst(v.input, t + 0.34, { freq: 2100, q: 5, decay: 0.03, gain: 0.12 });
    c.tone(v.input, t + 0.34, { f0: 180, f1: 120, decay: 0.08, gain: 0.08 });
  }

  /** Sluice gates: water rushing in, or draining away with a gurgle. */
  sluice(x: number, y: number, flooded: boolean): void {
    const c = this.core;
    const v = c.spatial(x, y, 1.1, 0.8);
    if (!v) return;
    const t = v.t;
    if (flooded) {
      c.burst(v.input, t, { freq: 500, freq1: 1400, q: 0.7, attack: 0.3, decay: 1.6, gain: 0.25 });
      c.burst(v.input, t, { type: "lowpass", freq: 300, q: 0.6, attack: 0.2, decay: 1.8, gain: 0.3, brown: true });
    } else {
      c.burst(v.input, t, { freq: 1200, freq1: 350, q: 0.9, attack: 0.1, decay: 1.4, gain: 0.2 });
      for (let i = 0; i < 5; i++) {
        const f = 300 + Math.random() * 400;
        c.tone(v.input, t + 0.2 + i * 0.22 + Math.random() * 0.1, { f0: f, f1: f * 1.6, glide: 0.06, decay: 0.08, gain: 0.05 });
      }
    }
    c.tone(v.input, t, { f0: 70, f1: 50, decay: 0.6, gain: 0.12 });
  }

  /** The Metronome's count-in: a dry wooden tick. */
  metronomeTick(x: number, y: number): void {
    const c = this.core;
    const v = c.spatial(x, y, 0.9, 0.3);
    if (!v) return;
    if (this.bank.play(v.input, "tick", v.t, { rate: 0.8, gain: 0.8 })) return;
    c.burst(v.input, v.t, { freq: 1900, q: 7, decay: 0.025, gain: 0.3 });
    c.tone(v.input, v.t, { f0: 950, decay: 0.03, gain: 0.08 });
  }

  /** The Metronome's beat: a deep knock with a ringing body. */
  metronomePulse(x: number, y: number): void {
    const c = this.core;
    const v = c.spatial(x, y, 1.2, 0.6);
    if (!v) return;
    const t = v.t;
    c.tone(v.input, t, { f0: 150, f1: 95, glide: 0.1, decay: 0.35, gain: 0.3 });
    c.burst(v.input, t, { freq: 800, q: 4, decay: 0.05, gain: 0.25 });
    c.tone(v.input, t, { type: "triangle", f0: 440, decay: 0.7, gain: 0.04, attack: 0.01 });
  }
}
