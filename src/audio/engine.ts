import { clamp } from "../core/math";

export interface Voice {
  /** Input node of a spatialized channel (connect sources here). */
  input: AudioNode;
  /** Start time (context seconds). */
  t: number;
}

const MASTER_LEVEL = 0.8;

/**
 * Web Audio core: buses, generated cave reverb, spatial channels and small
 * synthesis helpers. All sounds in the game are synthesized at runtime.
 */
export class AudioCore {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  sfx!: GainNode;
  music!: GainNode;
  private reverb!: ConvolverNode;
  reverbIn!: GainNode;
  noise!: AudioBuffer;
  brown!: AudioBuffer;
  listenerX = 0;
  listenerY = 0;
  private volumes = { master: 0.8, sfx: 1, music: 0.7 };

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === "running";
  }

  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /** Must be called from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (!this.ctx) this.build();
    if (this.ctx && this.ctx.state !== "running") void this.ctx.resume();
  }

  setVolume(bus: "master" | "sfx" | "music", value: number): void {
    this.volumes[bus] = clamp(value, 0, 1);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (bus === "master") this.master.gain.setTargetAtTime(this.volumes.master * MASTER_LEVEL, t, 0.05);
    if (bus === "sfx") this.sfx.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
    if (bus === "music") this.music.gain.setTargetAtTime(this.volumes.music, t, 0.05);
  }

  getVolume(bus: "master" | "sfx" | "music"): number {
    return this.volumes[bus];
  }

  /** A channel positioned in the world relative to the listener. */
  spatial(x: number, y: number, gain = 1, reverb = 0.35): Voice | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const dx = x - this.listenerX;
    const dy = y - this.listenerY;
    const d = Math.hypot(dx, dy);
    const g = ctx.createGain();
    g.gain.value = gain / (1 + d * 0.16);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = clamp(18000 / (1 + d * 0.35), 700, 18000);
    const pan = ctx.createStereoPanner();
    pan.pan.value = clamp(dx / 8, -0.85, 0.85);
    g.connect(lp).connect(pan).connect(this.sfx);
    const send = ctx.createGain();
    send.gain.value = reverb * (0.6 + Math.min(1, d / 10) * 0.6);
    pan.connect(send).connect(this.reverbIn);
    return { input: g, t: ctx.currentTime };
  }

  /** A non-positional channel (UI, player-centred sounds). */
  direct(gain = 1, reverb = 0.3, bus: GainNode = this.sfx): Voice | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const g = ctx.createGain();
    g.gain.value = gain;
    g.connect(bus);
    const send = ctx.createGain();
    send.gain.value = reverb;
    g.connect(send).connect(this.reverbIn);
    return { input: g, t: ctx.currentTime };
  }

  /** Oscillator with an exponential pitch glide and a percussive envelope. */
  tone(
    out: AudioNode,
    t: number,
    opts: { type?: OscillatorType; f0: number; f1?: number; glide?: number; attack?: number; decay: number; gain: number; detune?: number },
  ): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? "sine";
    osc.frequency.setValueAtTime(opts.f0, t);
    if (opts.f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.f1), t + (opts.glide ?? opts.decay));
    if (opts.detune) osc.detune.value = opts.detune;
    const env = ctx.createGain();
    const attack = opts.attack ?? 0.004;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(opts.gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + attack + opts.decay);
    osc.connect(env).connect(out);
    osc.start(t);
    osc.stop(t + attack + opts.decay + 0.05);
  }

  /** Filtered noise burst. */
  burst(
    out: AudioNode,
    t: number,
    opts: {
      type?: BiquadFilterType;
      freq: number;
      freq1?: number;
      q?: number;
      attack?: number;
      decay: number;
      gain: number;
      brown?: boolean;
    },
  ): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = opts.brown ? this.brown : this.noise;
    src.loop = true;
    const offset = Math.random() * (src.buffer.duration - 0.5);
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? "bandpass";
    f.frequency.setValueAtTime(opts.freq, t);
    if (opts.freq1 !== undefined) f.frequency.exponentialRampToValueAtTime(opts.freq1, t + (opts.attack ?? 0.002) + opts.decay);
    f.Q.value = opts.q ?? 1;
    const env = ctx.createGain();
    const attack = opts.attack ?? 0.002;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(opts.gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + attack + opts.decay);
    src.connect(f).connect(env).connect(out);
    src.start(t, offset);
    src.stop(t + attack + opts.decay + 0.05);
  }

  private build(): void {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor({ latencyHint: "interactive" });
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    this.master = ctx.createGain();
    this.master.gain.value = this.volumes.master * MASTER_LEVEL;
    this.master.connect(comp).connect(ctx.destination);

    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.volumes.sfx;
    this.sfx.connect(this.master);
    this.music = ctx.createGain();
    this.music.gain.value = this.volumes.music;
    this.music.connect(this.master);

    this.noise = this.makeNoise(false);
    this.brown = this.makeNoise(true);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(3.6);
    this.reverbIn = ctx.createGain();
    this.reverbIn.gain.value = 0.9;
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.reverbIn.connect(this.reverb).connect(wet).connect(this.master);
  }

  private makeNoise(brown: boolean): AudioBuffer {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      } else {
        data[i] = white;
      }
    }
    return buf;
  }

  /** Cavernous stereo impulse: sparse early reflections into a dense, darkening tail. */
  private makeImpulse(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / rate;
        const decay = Math.pow(1 - t / seconds, 2.2) * Math.exp(-t * 1.1);
        const darken = 0.18 + 0.8 * Math.exp(-t * 2.2);
        lp += ((Math.random() * 2 - 1) - lp) * darken;
        data[i] = lp * decay * (t < 0.012 ? 0 : 1);
      }
      for (let k = 0; k < 14; k++) {
        const t = 0.015 + Math.random() * 0.12;
        const idx = Math.floor(t * rate);
        if (idx < len) data[idx] += (Math.random() < 0.5 ? -1 : 1) * (0.5 - t * 2.5);
      }
    }
    return buf;
  }
}
