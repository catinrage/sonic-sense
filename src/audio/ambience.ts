import type { AudioCore } from "./engine";
import type { SampleBank } from "./samples";

/** Which ambient bed belongs under the current screen. */
export type AmbienceScene = "title" | "game";

const SCENE_LOOP = { title: "title-loop", game: "ambience-loop" } as const;
const CROSSFADE = 1.6;

/** Cave drone, air, distant settling stones and the heartbeat of fear. */
export class Ambience {
  private nodes: AudioNode[] = [];
  private sources: (OscillatorNode | AudioBufferSourceNode)[] = [];
  private bus: GainNode | null = null;
  private loop: { stop: (fade?: number) => void } | null = null;
  /** Which scene the currently playing sample loop belongs to. */
  private loopScene: AmbienceScene | null = null;
  private scene: AmbienceScene = "title";
  private nextEvent = 6;
  private nextBeat = 0;
  private running = false;

  constructor(
    private readonly core: AudioCore,
    private readonly bank: SampleBank,
  ) {}

  /** True while the generated loop is carrying the bed (rather than synthesis). */
  private get sampled(): boolean {
    return this.loop !== null;
  }

  start(): void {
    const ctx = this.core.ctx;
    if (!ctx || this.running) return;
    this.running = true;
    const bus = ctx.createGain();
    bus.gain.value = 0.0001;
    bus.connect(this.core.music);
    this.bus = bus;
    this.applyScene(0);
  }

  /** Switch beds (title/ending vs gameplay), crossfading if something is playing. */
  setScene(scene: AmbienceScene): void {
    if (scene === this.scene) return;
    this.scene = scene;
    if (this.running) this.applyScene(CROSSFADE);
  }

  /**
   * Bring the current scene's bed up. Prefers the generated loop and falls
   * back to the synthesized drone until that loop has decoded.
   */
  private applyScene(fade: number): void {
    const ctx = this.core.ctx;
    const bus = this.bus;
    if (!ctx || !bus) return;
    const id = SCENE_LOOP[this.scene];

    if (this.bank.has(id)) {
      if (this.loopScene === this.scene) return;
      this.loop?.stop(fade);
      this.loop = this.bank.loop(bus, id, Math.max(0.05, fade));
      this.loopScene = this.loop ? this.scene : null;
      if (this.loop) {
        this.teardownSynth(fade);
        bus.gain.cancelScheduledValues(ctx.currentTime);
        bus.gain.setValueAtTime(bus.gain.value, ctx.currentTime);
        bus.gain.linearRampToValueAtTime(1, ctx.currentTime + Math.max(0.05, fade));
        return;
      }
    }

    // Sample not ready: keep (or start) the synthesized drone.
    if (this.sources.length === 0) this.buildSynth();
    bus.gain.cancelScheduledValues(ctx.currentTime);
    bus.gain.setValueAtTime(Math.max(0.0001, bus.gain.value), ctx.currentTime);
    bus.gain.setTargetAtTime(1, ctx.currentTime, 1.5);
  }

  private buildSynth(): void {
    const ctx = this.core.ctx;
    const bus = this.bus;
    if (!ctx || !bus) return;

    const drone = ctx.createBiquadFilter();
    drone.type = "lowpass";
    drone.frequency.value = 380;
    drone.connect(bus);
    for (const [f, g] of [
      [55, 0.05],
      [82.4, 0.03],
      [110.3, 0.018],
      [164.2, 0.008],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      const gain = ctx.createGain();
      gain.gain.value = g;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.03 + Math.random() * 0.05;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = g * 0.6;
      lfo.connect(lfoGain).connect(gain.gain);
      o.connect(gain).connect(drone);
      o.start();
      lfo.start();
      this.sources.push(o, lfo);
      this.nodes.push(gain, lfoGain);
    }

    const air = ctx.createBufferSource();
    air.buffer = this.core.noise;
    air.loop = true;
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = "bandpass";
    airFilter.frequency.value = 420;
    airFilter.Q.value = 0.6;
    const sweep = ctx.createOscillator();
    sweep.frequency.value = 0.045;
    const sweepGain = ctx.createGain();
    sweepGain.gain.value = 220;
    sweep.connect(sweepGain).connect(airFilter.frequency);
    const airGain = ctx.createGain();
    airGain.gain.value = 0.018;
    air.connect(airFilter).connect(airGain).connect(bus);
    air.start();
    sweep.start();
    this.sources.push(air, sweep);
    this.nodes.push(drone, airFilter, sweepGain, airGain);
  }

  /** Fade the synthesized drone out and release its nodes. */
  private teardownSynth(fade: number): void {
    if (this.sources.length === 0) return;
    const sources = this.sources;
    this.sources = [];
    this.nodes = [];
    const stopAt = Date.now();
    setTimeout(
      () => {
        for (const s of sources) {
          try {
            s.stop();
          } catch {
            // Already stopped; nothing to do.
          }
        }
      },
      Math.max(0, fade * 1000 + 100 - (Date.now() - stopAt)),
    );
  }

  stop(): void {
    const ctx = this.core.ctx;
    if (!ctx || !this.running) return;
    this.running = false;
    const bus = this.bus;
    bus?.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.4);
    this.loop?.stop(0.4);
    this.loop = null;
    this.loopScene = null;
    const sources = this.sources;
    this.sources = [];
    this.nodes = [];
    setTimeout(() => {
      for (const s of sources) {
        try {
          s.stop();
        } catch {
          // Already stopped; nothing to do.
        }
      }
      bus?.disconnect();
    }, 2000);
  }

  /** Called every frame with the elapsed time and current danger (0..1). */
  update(dt: number, danger: number): void {
    if (!this.running || !this.core.ctx) return;
    // Samples decode after the context unlocks; take the loop over once it lands.
    if (this.loopScene !== this.scene) this.applyScene(CROSSFADE);

    // The generated bed already carries its own far-off drips and rumbles.
    if (!this.sampled) {
      this.nextEvent -= dt;
      if (this.nextEvent <= 0) {
        this.nextEvent = 7 + Math.random() * 14;
        this.distantEvent();
      }
    }

    if (danger > 0.08) {
      this.nextBeat -= dt;
      if (this.nextBeat <= 0) {
        this.nextBeat = 1.05 - danger * 0.6;
        this.heartbeat(danger);
      }
    } else {
      this.nextBeat = 0;
    }
  }

  private heartbeat(danger: number): void {
    const c = this.core;
    const v = c.direct(0.35 + danger * 0.7, 0.05);
    if (!v) return;
    c.tone(v.input, v.t, { f0: 62, f1: 40, decay: 0.12, gain: 0.5 });
    c.tone(v.input, v.t + 0.17, { f0: 55, f1: 38, decay: 0.14, gain: 0.35 });
  }

  private distantEvent(): void {
    const c = this.core;
    const angle = Math.random() * Math.PI * 2;
    const x = c.listenerX + Math.cos(angle) * 14;
    const y = c.listenerY + Math.sin(angle) * 14;
    const v = c.spatial(x, y, 0.6, 1.2);
    if (!v) return;
    if (Math.random() < 0.5) {
      c.burst(v.input, v.t, { type: "lowpass", freq: 300, q: 0.8, attack: 0.3, decay: 1.5, gain: 0.25, brown: true });
    } else {
      for (let i = 0; i < 3; i++) {
        c.burst(v.input, v.t + i * (0.08 + Math.random() * 0.1), { freq: 1400 + Math.random() * 800, q: 5, decay: 0.03, gain: 0.08 });
      }
    }
  }
}
