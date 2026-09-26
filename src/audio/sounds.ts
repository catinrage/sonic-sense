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

  /** The creature's echolocation call, followed by room echoes. */
  pulse(charge: number, taps: readonly EchoTap[]): void {
    const c = this.core;
    const v = c.direct(0.9, 0.25);
    if (!v) return;
    const t = v.t;
    const id = charge > 0.35 ? "call-long" : "call-short";
    // One rate for the whole call so the echoes match the direct sound.
    const rate = wobble() * (charge > 0.35 ? 1 : 1.05 - charge * 0.1);
    const sampled = this.bank.play(v.input, id, t, { rate });

    if (sampled) {
      // A charged call keeps its synthesized low body: the sample alone does
      // not carry the sub-bass thump that sells a loud call.
      if (charge > 0.35) c.tone(v.input, t, { f0: 90, f1: 42, glide: 0.5, decay: 0.7, gain: 0.22 * charge });
    } else {
      this.synthChirp(v.input, t, charge, 1);
      c.tone(v.input, t, { f0: 1760, f1: 1700, decay: 0.9 + charge, gain: 0.05 + charge * 0.05, attack: 0.02 });
      if (charge > 0.35) {
        c.tone(v.input, t, { f0: 90, f1: 42, glide: 0.5, decay: 0.7, gain: 0.35 * charge });
        c.burst(v.input, t, { freq: 300, freq1: 2400, q: 0.9, attack: 0.02, decay: 0.45, gain: 0.18 * charge });
      }
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
      if (sampled) this.bank.play(out, id, t, { when: t + tap.delay, rate, gain: 0.8 });
      else this.synthChirp(out, t + tap.delay, charge, 0.8);
    }
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

  footstep(x: number, y: number, water: boolean, sneak: boolean): void {
    const c = this.core;
    const v = c.spatial(x, y, sneak ? 0.35 : 1, 0.2);
    if (!v) return;
    const t = v.t + Math.random() * 0.01;
    if (this.bank.play(v.input, water ? "step-water" : "step-stone", t, { gain: sneak ? 0.5 : 1 })) return;
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

  crystal(x: number, y: number, pitch: number): void {
    const c = this.core;
    const v = c.spatial(x, y, 1.1, 0.8);
    if (!v) return;
    const base = CRYSTAL_NOTES[pitch % CRYSTAL_NOTES.length]!;
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

  wardenAlert(x: number, y: number): void {
    const c = this.core;
    const ctx = c.ctx;
    const v = c.spatial(x, y, 1.3, 0.55);
    if (!ctx || !v) return;
    const t = v.t;
    if (this.bank.play(v.input, "warden-shriek", t, { rate: wobble(0.04) })) {
      // Keep the low growl under the shriek: it is what makes an alert read as danger.
      c.tone(v.input, t, { type: "sawtooth", f0: 72, f1: 55, decay: 0.6, gain: 0.14 });
      return;
    }
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(520, t);
    osc.frequency.exponentialRampToValueAtTime(1350, t + 0.18);
    osc.frequency.exponentialRampToValueAtTime(760, t + 0.6);
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

  uiMove(): void {
    const c = this.core;
    const v = c.direct(0.4, 0.2);
    if (!v) return;
    if (this.bank.play(v.input, "ui-move", v.t, { rate: wobble(0.03) })) return;
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
