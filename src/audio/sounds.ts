import type { AudioCore } from "./engine";
import type { SampleBank } from "./samples";

export interface EchoTap {
  /** Seconds after the call. */
  delay: number;
  gain: number;
  /** -1 (left) .. 1 (right). */
  pan: number;
  /** Lowpass cutoff (Hz): far echoes are darker. */
  cutoff: number;
}

/** Pentatonic scale for crystals (A minor pentatonic). */
const CRYSTAL_NOTES = [880, 1046.5, 1174.66, 1318.5, 1568];
/** Chime tubes: the same scale an octave up, so chimes and crystals sound kin. */
const CHIME_NOTES = [1760, 2093, 2349.3, 2637, 3136];
const SHARD_ARP = [1046.5, 1318.5, 1568, 2093];
/** Semitones spanned per bell group, matching the synthesized bell's base pitch. */
const BELL_GROUP_SEMITONES = 2;

/** A slight, random pitch/speed offset so repeated one-shots differ. */
function wobble(spread = 0.05): number {
  return 1 + (Math.random() * 2 - 1) * spread;
}

/**
 * Sound recipes. Each one plays a generated sample (ElevenLabs) through the
 * same spatial/direct channel it always used, and falls back to the original
 * synthesis when that sample is missing or not decoded yet.
 */
export class Sfx {
  constructor(
    private readonly core: AudioCore,
    private readonly bank: SampleBank,
  ) {}

  /**
   * The creature's echolocation call, followed by room echoes.
   *
   * Deliberately synthesized: play-testing preferred the generated call, and
   * the synthesized chirp also lets every echo tap be re-rendered at its own
   * delay and charge rather than replaying one fixed recording.
   */
  pulse(charge: number, taps: readonly EchoTap[]): void {
    const c = this.core;
    const v = c.direct(0.9, 0.25);
    if (!v) return;
    const t = v.t;
    this.synthChirp(v.input, t, charge, 1);
    c.tone(v.input, t, { f0: 1760, f1: 1700, decay: 0.9 + charge, gain: 0.05 + charge * 0.05, attack: 0.02 });
    if (charge > 0.35) {
      c.tone(v.input, t, { f0: 90, f1: 42, glide: 0.5, decay: 0.7, gain: 0.35 * charge });
      c.burst(v.input, t, { freq: 300, freq1: 2400, q: 0.9, attack: 0.02, decay: 0.45, gain: 0.18 * charge });
    }

    const ctx = c.ctx!;
    for (const tap of taps) {
      const out = ctx.createGain();
      out.gain.value = tap.gain;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = tap.cutoff;
      const pan = ctx.createStereoPanner();
      pan.pan.value = tap.pan;
      out.connect(lp).connect(pan).connect(c.sfx);
      const send = ctx.createGain();
      send.gain.value = 0.35;
      pan.connect(send).connect(c.reverbIn);
      this.synthChirp(out, t + tap.delay, charge, 0.8);
    }
  }

  /** A focused call: a thin, high whistle that dies quickly, with a single faint echo. */
  focus(charge: number): void {
    const c = this.core;
    const v = c.direct(0.7, 0.15);
    if (!v) return;
    c.tone(v.input, v.t, { f0: 3400 - charge * 500, f1: 1900, glide: 0.12, decay: 0.16, gain: 0.2 });
    c.tone(v.input, v.t, { type: "triangle", f0: 1250, f1: 1100, glide: 0.2, decay: 0.3, gain: 0.06 });
    c.tone(v.input, v.t + 0.22, { f0: 2400, f1: 1500, glide: 0.1, decay: 0.12, gain: 0.04 });
  }

  /** Deep Listen opening: the room's hush swells, and a faint high shimmer rises through it. */
  listen(): void {
    const c = this.core;
    const v = c.direct(0.5, 0.6);
    if (!v) return;
    c.burst(v.input, v.t, { type: "lowpass", freq: 300, freq1: 1400, q: 0.5, attack: 0.5, decay: 0.9, gain: 0.07, brown: true });
    c.tone(v.input, v.t + 0.15, { type: "triangle", f0: 1320, f1: 1760, glide: 0.8, attack: 0.35, decay: 1.1, gain: 0.025 });
  }

  /** Muffle: a soft inward hush when it takes hold, a small exhale when it lifts. */
  muffle(on: boolean): void {
    const c = this.core;
    const v = c.direct(0.6, 0.3);
    if (!v) return;
    c.burst(v.input, v.t, { type: "lowpass", freq: on ? 900 : 1400, freq1: on ? 250 : 2200, q: 0.7, attack: 0.06, decay: on ? 0.55 : 0.3, gain: 0.12, brown: true });
    if (on) c.tone(v.input, v.t, { type: "triangle", f0: 330, f1: 220, glide: 0.4, decay: 0.5, gain: 0.04, attack: 0.05 });
  }

  /** A lure stone's chirp: small, bright and insistent. */
  lure(x: number, y: number, left: number): void {
    const c = this.core;
    const v = c.spatial(x, y, 0.8, 0.4);
    if (!v) return;
    const f = 2200 + (left % 2) * 260;
    c.tone(v.input, v.t, { f0: f, f1: f * 1.25, glide: 0.04, decay: 0.07, gain: 0.12 });
    c.tone(v.input, v.t + 0.09, { f0: f * 1.2, f1: f * 1.4, glide: 0.04, decay: 0.07, gain: 0.08 });
  }

  private synthChirp(out: AudioNode, at: number, charge: number, level: number): void {
    const c = this.core;
    c.tone(out, at, { f0: 2600 - charge * 700, f1: 820 - charge * 200, glide: 0.07, decay: 0.12, gain: 0.32 * level });
    c.tone(out, at, {
      type: "triangle",
      f0: 520 - charge * 120,
      f1: 430 - charge * 100,
      glide: 0.4,
      decay: 0.45 + charge * 0.5,
      gain: 0.16 * level,
    });
  }

  /** Deliberately synthesized: play-testing preferred it over the samples. */
  footstep(x: number, y: number, water: boolean, sneak: boolean, silt = false): void {
    const c = this.core;
    const v = c.spatial(x, y, sneak || silt ? 0.35 : 1, 0.2);
    if (!v) return;
    const t = v.t + Math.random() * 0.01;
    if (silt) {
      // A soft, dry hush: the ground takes the step.
      c.burst(v.input, t, { type: "lowpass", freq: 420, q: 0.6, attack: 0.02, decay: 0.12, gain: 0.07, brown: true });
      return;
    }
    if (water) {
      c.burst(v.input, t, { freq: 700, freq1: 2600, q: 1.2, decay: 0.16, gain: 0.26 });
      for (let i = 0; i < 3; i++) {
        const f = 500 + Math.random() * 900;
        c.tone(v.input, t + 0.02 + i * 0.035 * Math.random(), { f0: f, f1: f * 1.8, glide: 0.05, decay: 0.05, gain: 0.07 });
      }
      return;
    }
    const pitch = 0.85 + Math.random() * 0.3;
    c.burst(v.input, t, { freq: 1500 * pitch, q: 1.4, decay: sneak ? 0.03 : 0.05, gain: sneak ? 0.05 : 0.12 });
    c.tone(v.input, t, { f0: 110 * pitch, f1: 60, decay: 0.07, gain: sneak ? 0.04 : 0.14 });
  }

  whoosh(x: number, y: number): void {
    const c = this.core;
    const v = c.spatial(x, y, 0.8, 0.1);
    if (!v) return;
    if (this.bank.play(v.input, "stone-throw", v.t)) return;
    c.burst(v.input, v.t, { freq: 500, freq1: 1800, q: 2, attack: 0.05, decay: 0.2, gain: 0.12 });
  }

  stoneHit(x: number, y: number, strength: number, water: boolean): void {
    const c = this.core;
    const v = c.spatial(x, y, 0.6 + strength, 0.45);
    if (!v) return;
    const t = v.t;
    // No generated sample covers a stone landing in water; that stays synthesized.
    if (!water && this.bank.play(v.input, "stone-hit", t, { gain: 0.6 + strength * 0.6 })) return;
    if (water) {
      c.burst(v.input, t, { freq: 600, freq1: 3000, q: 1, decay: 0.25, gain: 0.35 * strength });
      c.tone(v.input, t + 0.01, { f0: 700, f1: 1500, glide: 0.08, decay: 0.08, gain: 0.12 });
      return;
    }
    c.burst(v.input, t, { freq: 2600, q: 8, decay: 0.05, gain: 0.5 * strength });
    c.burst(v.input, t + 0.012, { freq: 3900, q: 10, decay: 0.035, gain: 0.35 * strength });
    c.tone(v.input, t, { type: "triangle", f0: 260, f1: 170, decay: 0.09, gain: 0.25 * strength });
  }

  /** A crystal's song: a tuned crystal sings its note; a white one a bright, unpitched shimmer. */
  crystal(x: number, y: number, note: number | null): void {
    const c = this.core;
    const v = c.spatial(x, y, 1.1, 0.8);
    if (!v) return;
    if (note === null) {
      // Two detuned voices a sixth apart: no single note to mistake for a key.
      if (this.bank.play(v.input, "crystal", v.t, { rate: 1.19 * wobble(0.01), gain: 0.6 })) {
        this.bank.play(v.input, "crystal", v.t + 0.02, { rate: 0.71 * wobble(0.01), gain: 0.45 });
        return;
      }
    }
    const base = CRYSTAL_NOTES[(note ?? 0) % CRYSTAL_NOTES.length]!;
    // Retune the one recorded crystal to the note this crystal sings.
    if (this.bank.play(v.input, "crystal", v.t, { rate: (base / CRYSTAL_NOTES[0]!) * wobble(0.01) })) return;
    const partials = [1, 2.32, 4.25, 6.63];
    partials.forEach((ratio, i) => {
      const f = base * ratio;
      const decay = 2.6 / (1 + i * 0.8);
      const g = 0.12 / (1 + i * 1.3);
      c.tone(v.input, v.t, { f0: f, decay, gain: g, attack: 0.003 });
      c.tone(v.input, v.t, { f0: f * 1.003, decay: decay * 0.8, gain: g * 0.6, attack: 0.003 });
    });
  }

  bell(x: number, y: number, group: number): void {
    const c = this.core;
    const v = c.spatial(x, y, 1.2, 0.7);
    if (!v) return;
    const steps = ((group - 1) % 5) * BELL_GROUP_SEMITONES;
    const base = 196 * Math.pow(2, steps / 12);
    if (this.bank.play(v.input, "bell", v.t, { rate: Math.pow(2, steps / 12) * wobble(0.01) })) return;
    const partials: [number, number, number][] = [
      [0.5, 0.2, 5],
      [1, 0.24, 3.8],
      [1.183, 0.16, 3],
      [1.506, 0.12, 2.6],
      [2, 0.14, 2.2],
      [2.514, 0.07, 1.6],
      [3.011, 0.05, 1.2],
    ];
    for (const [ratio, g, decay] of partials) c.tone(v.input, v.t, { f0: base * ratio, decay, gain: g, attack: 0.002 });
    c.burst(v.input, v.t, { freq: 3000, q: 1, decay: 0.03, gain: 0.25 });
  }

  door(x: number, y: number, open: boolean): void {
    const c = this.core;
    const v = c.spatial(x, y, 1, 0.5);
    if (!v) return;
    const t = v.t;
    if (this.bank.play(v.input, open ? "door-open" : "door-close", t, { rate: wobble(0.02) })) return;
    c.burst(v.input, t, { type: "lowpass", freq: 260, q: 0.7, attack: 0.15, decay: 1.1, gain: 0.55, brown: true });
    c.burst(v.input, t + 0.05, { freq: 900, freq1: 400, q: 3, attack: 0.1, decay: 0.9, gain: 0.08 });
    c.tone(v.input, t + 1.05, { f0: 70, f1: 38, decay: 0.35, gain: 0.35 });
    if (open) c.tone(v.input, t, { type: "triangle", f0: 659, decay: 1.2, gain: 0.05, attack: 0.08 });
  }

  tick(x: number, y: number, urgent: boolean): void {
    const c = this.core;
    const v = c.spatial(x, y, 0.8, 0.3);
    if (!v) return;
    if (this.bank.play(v.input, "tick", v.t, { rate: (urgent ? 1.28 : 1) * wobble(0.03) })) return;
    c.tone(v.input, v.t, { f0: urgent ? 1600 : 1250, decay: 0.05, gain: 0.12 });
    c.burst(v.input, v.t, { freq: 4000, q: 4, decay: 0.01, gain: 0.08 });
  }

  wardenClick(x: number, y: number): void {
    const c = this.core;
    const v = c.spatial(x, y, 1.1, 0.35);
    if (!v) return;
    if (this.bank.play(v.input, "warden-click", v.t)) return;
    const n = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const at = v.t + i * (0.045 + Math.random() * 0.03);
      c.burst(v.input, at, { freq: 2800 + Math.random() * 900, q: 6, decay: 0.012, gain: 0.35 });
      c.burst(v.input, at, { type: "lowpass", freq: 500, q: 1, decay: 0.02, gain: 0.12 });
    }
  }

  wardenAlert(x: number, y: number, pitch = 1): void {
    const c = this.core;
    const ctx = c.ctx;
    const v = c.spatial(x, y, 1.3, 0.55);
    if (!ctx || !v) return;
    const t = v.t;
    if (this.bank.play(v.input, "warden-shriek", t, { rate: pitch * wobble(0.04) })) {
      // Keep the low growl under the shriek: it is what makes an alert read as danger.
      c.tone(v.input, t, { type: "sawtooth", f0: 72, f1: 55, decay: 0.6, gain: 0.14 });
      return;
    }
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(520 * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(1350 * pitch, t + 0.18);
    osc.frequency.exponentialRampToValueAtTime(760 * pitch, t + 0.6);
    const vib = ctx.createOscillator();
    vib.frequency.value = 23;
    const vibGain = ctx.createGain();
    vibGain.gain.value = 60;
    vib.connect(vibGain).connect(osc.frequency);
    const formant = ctx.createBiquadFilter();
    formant.type = "bandpass";
    formant.frequency.value = 1700;
    formant.Q.value = 2.5;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.28, t + 0.04);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    osc.connect(formant).connect(env).connect(v.input);
    osc.start(t);
    vib.start(t);
    osc.stop(t + 0.75);
    vib.stop(t + 0.75);
    c.tone(v.input, t, { type: "sawtooth", f0: 72, f1: 55, decay: 0.6, gain: 0.2 });
  }

  /** A sentinel's slow call: a hollow, bone-horn hoot with a glassy overtone. */
  sentinelCall(x: number, y: number): void {
    const c = this.core;
    const v = c.spatial(x, y, 1, 0.9);
    if (!v) return;
    const t = v.t;
    c.tone(v.input, t, { type: "triangle", f0: 233, f1: 207, glide: 0.9, attack: 0.12, decay: 1.3, gain: 0.16 });
    c.tone(v.input, t, { f0: 466, f1: 415, glide: 0.9, attack: 0.15, decay: 0.9, gain: 0.05 });
    c.tone(v.input, t + 0.05, { f0: 1864, decay: 1.4, gain: 0.018, attack: 0.2 });
    c.burst(v.input, t, { freq: 700, q: 1.5, attack: 0.1, decay: 0.5, gain: 0.04, brown: true });
  }

  /** Bone tubes knocking together in a draft: two or three glassy, inharmonic notes. */
  chime(x: number, y: number, note: number): void {
    const c = this.core;
    const v = c.spatial(x, y, 0.9, 0.9);
    if (!v) return;
    const knocks = 2 + (note % 2);
    for (let k = 0; k < knocks; k++) {
      const f = CHIME_NOTES[(note + k * 2) % CHIME_NOTES.length]! * wobble(0.004);
      const at = v.t + k * (0.11 + Math.random() * 0.08);
      const g = 0.07 / (1 + k * 0.5);
      c.tone(v.input, at, { f0: f, decay: 2.4, gain: g, attack: 0.002 });
      c.tone(v.input, at, { f0: f * 2.76, decay: 0.9, gain: g * 0.35, attack: 0.002 });
      c.tone(v.input, at, { f0: f * 5.4, decay: 0.35, gain: g * 0.15, attack: 0.001 });
    }
  }

  /** A tremor's footfall: felt more than heard. */
  tremorThump(x: number, y: number): void {
    const c = this.core;
    const v = c.spatial(x, y, 1.2, 0.3);
    if (!v) return;
    const t = v.t;
    c.tone(v.input, t, { f0: 62, f1: 34, glide: 0.18, decay: 0.32, gain: 0.34 });
    c.burst(v.input, t, { type: "lowpass", freq: 320, q: 0.8, decay: 0.16, gain: 0.3, brown: true });
    c.burst(v.input, t + 0.02, { freq: 1900, q: 3, decay: 0.03, gain: 0.03 });
  }

  shard(index: number): void {
    const c = this.core;
    const v = c.direct(0.8, 0.6);
    if (!v) return;
    // Each shard answers a little brighter than the last.
    if (this.bank.play(v.input, "shard", v.t, { rate: 1 + index * 0.06 })) return;
    SHARD_ARP.forEach((f, i) => {
      c.tone(v.input, v.t + i * 0.07, { f0: f * (1 + index * 0.06), decay: 0.6, gain: 0.08 });
      c.tone(v.input, v.t + i * 0.07, { type: "triangle", f0: f * 2 * (1 + index * 0.06), decay: 0.3, gain: 0.03 });
    });
  }

  pickup(): void {
    const c = this.core;
    const v = c.direct(0.6, 0.2);
    if (!v) return;
    if (this.bank.play(v.input, "pickup", v.t)) return;
    c.burst(v.input, v.t, { freq: 2200, q: 6, decay: 0.03, gain: 0.2 });
    c.burst(v.input, v.t + 0.05, { freq: 2900, q: 6, decay: 0.03, gain: 0.15 });
  }

  empty(): void {
    const c = this.core;
    const v = c.direct(0.5, 0.1);
    if (!v) return;
    c.tone(v.input, v.t, { type: "square", f0: 180, f1: 120, decay: 0.08, gain: 0.05 });
  }

  exitHum(x: number, y: number, active: boolean): void {
    const c = this.core;
    const ctx = c.ctx;
    const v = c.spatial(x, y, active ? 0.9 : 0.5, 0.6);
    if (!ctx || !v) return;
    const t = v.t;
    // A waking Gate hums a fifth higher than a sleeping one.
    if (this.bank.play(v.input, "gate-hum", t, { rate: active ? 1.5 : 1, gain: active ? 1 : 0.7 })) return;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = active ? 1300 : 520;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.14, t + 0.45);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 1.9);
    lp.connect(env).connect(v.input);
    const notes = active ? [110, 164.8, 220, 277.2] : [110, 164.8];
    for (const f of notes) {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = f;
        o.detune.value = det;
        o.connect(lp);
        o.start(t);
        o.stop(t + 2);
      }
    }
  }

  exitAwake(): void {
    const c = this.core;
    const v = c.direct(0.9, 0.8);
    if (!v) return;
    if (this.bank.play(v.input, "gate-awake", v.t, { rate: 1 })) return;
    [220, 277.2, 329.6, 440, 554.4, 659.3].forEach((f, i) => {
      c.tone(v.input, v.t + i * 0.09, { type: "triangle", f0: f, decay: 2.2, gain: 0.07, attack: 0.05 });
    });
  }

  drip(x: number, y: number): void {
    const c = this.core;
    const v = c.spatial(x, y, 0.8, 1);
    if (!v) return;
    if (this.bank.play(v.input, "drip", v.t, { rate: wobble(0.12) })) return;
    const f = 1500 + Math.random() * 700;
    c.tone(v.input, v.t, { f0: f, f1: f * 0.55, glide: 0.035, decay: 0.07, gain: 0.12 });
    c.tone(v.input, v.t + 0.07, { f0: f * 1.3, f1: f * 0.9, glide: 0.03, decay: 0.05, gain: 0.04 });
  }

  death(cause: "pit" | "warden"): void {
    const c = this.core;
    const v = c.direct(1, 0.7);
    if (!v) return;
    if (this.bank.play(v.input, cause === "pit" ? "death-pit" : "death-warden", v.t, { rate: 1 })) return;
    if (cause === "pit") {
      c.tone(v.input, v.t, { f0: 900, f1: 70, glide: 1.4, decay: 1.5, gain: 0.18 });
      c.burst(v.input, v.t, { freq: 1200, freq1: 150, q: 2, attack: 0.1, decay: 1.4, gain: 0.12 });
      return;
    }
    c.burst(v.input, v.t, { type: "lowpass", freq: 1800, q: 0.7, decay: 0.4, gain: 0.7 });
    c.tone(v.input, v.t, { f0: 90, f1: 30, decay: 1.1, gain: 0.55 });
    c.tone(v.input, v.t, { type: "sawtooth", f0: 480, f1: 120, decay: 0.5, gain: 0.12 });
  }

  complete(): void {
    const c = this.core;
    const v = c.direct(0.9, 0.9);
    if (!v) return;
    if (this.bank.play(v.input, "complete", v.t, { rate: 1 })) return;
    [440, 554.4, 659.3, 880, 1108.7, 1318.5].forEach((f, i) => {
      c.tone(v.input, v.t + i * 0.11, { f0: f, decay: 2.5, gain: 0.08, attack: 0.02 });
    });
    c.tone(v.input, v.t, { type: "triangle", f0: 110, decay: 3, gain: 0.15, attack: 0.3 });
  }

  /** Deliberately synthesized: play-testing preferred this soft tick over the generated sample. */
  uiMove(): void {
    const c = this.core;
    const v = c.direct(0.4, 0.2);
    if (!v) return;
    c.tone(v.input, v.t, { f0: 1900, decay: 0.04, gain: 0.05 });
  }

  uiSelect(): void {
    const c = this.core;
    const v = c.direct(0.6, 0.5);
    if (!v) return;
    if (this.bank.play(v.input, "ui-select", v.t, { rate: 1 })) return;
    c.tone(v.input, v.t, { f0: 1320, f1: 880, glide: 0.1, decay: 0.3, gain: 0.1 });
    c.tone(v.input, v.t + 0.06, { f0: 1760, decay: 0.4, gain: 0.05 });
  }
}
