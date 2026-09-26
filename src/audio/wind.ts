import type { AudioCore } from "./engine";

/** Seconds for the wind to swell or settle as the listener moves in and out of drafts. */
const SWELL = 1.4;
const MAX_GAIN = 0.12;
/** Below this the listener is out of the wind; after QUIET_TEARDOWN seconds of it the graph is released. */
const STILL_AIR = 0.01;
const QUIET_TEARDOWN = SWELL * 3;

/**
 * Moving air: a looping band of brown noise with slow gusts, as loud as the
 * drafts around the listener are dense. Silent (and cheap) everywhere else.
 */
export class WindBed {
  private gain: GainNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private lfo: OscillatorNode | null = null;
  private quietFor = 0;

  constructor(private readonly core: AudioCore) {}

  /** True while the noise graph exists (it is released after the listener leaves the wind). */
  get active(): boolean {
    return this.gain !== null;
  }

  /** `density` 0..1: how much of the listener's surroundings is moving air. */
  update(density: number, dt: number): void {
    const ctx = this.core.ctx;
    if (!ctx) return;
    this.quietFor = density <= STILL_AIR ? this.quietFor + dt : 0;
    if (!this.gain) {
      if (density <= STILL_AIR) return;
      this.build(ctx);
    }
    if (this.quietFor > QUIET_TEARDOWN) {
      this.stop();
      return;
    }
    this.gain!.gain.setTargetAtTime(Math.min(1, density) * MAX_GAIN, ctx.currentTime, SWELL / 3);
  }

  stop(): void {
    const ctx = this.core.ctx;
    if (!ctx || !this.gain) return;
    const end = ctx.currentTime + SWELL;
    this.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, SWELL / 4);
    this.source?.stop(end);
    this.lfo?.stop(end);
    this.gain = null;
    this.source = null;
    this.lfo = null;
  }

  private build(ctx: AudioContext): void {
    const source = ctx.createBufferSource();
    source.buffer = this.core.brown;
    source.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 480;
    band.Q.value = 0.6;
    // Gusts: the band slowly sweeps up and down as the air surges.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const sweep = ctx.createGain();
    sweep.gain.value = 260;
    lfo.connect(sweep).connect(band.frequency);
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    source.connect(band).connect(gain).connect(this.core.music);
    source.start();
    lfo.start();
    this.source = source;
    this.lfo = lfo;
    this.gain = gain;
  }
}
