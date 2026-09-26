import type { AudioCore } from "./engine";
import { AUDIO_BASE, LOOP_IDS, MANIFEST_FILE, SAMPLES, sampleUrl, type SampleId } from "./sample-manifest";

/** Random playback-rate spread applied to one-shots so repeats do not sound identical. */
const RATE_SPREAD = 0.05;

export interface PlayOptions {
  /** Context time to start at. Defaults to the voice's start time. */
  when?: number;
  /** Playback rate multiplier (pitch + speed). */
  rate?: number;
  /** Extra gain applied on top of the channel's own gain. */
  gain?: number;
  /** Pick a specific variant instead of a random one. */
  variant?: number;
}

/**
 * Fetches and decodes the generated audio once the AudioContext exists, and
 * hands out decoded buffers by id. Every lookup returns null until the sample
 * is decoded, which is the signal for callers to fall back to synthesis.
 */
export class SampleBank {
  private readonly buffers = new Map<SampleId, AudioBuffer[]>();
  private started = false;
  private missing = 0;
  private decoded = 0;

  constructor(private readonly core: AudioCore) {}

  /** True once at least one variant of `id` is decoded and playable. */
  has(id: SampleId): boolean {
    return this.buffers.has(id);
  }

  /**
   * Start fetching and decoding. Safe to call repeatedly; only the first call
   * does work. Must be called after the context exists (i.e. after unlock).
   */
  load(): void {
    if (this.started || !this.core.ctx) return;
    this.started = true;
    void this.run();
  }

  private async run(): Promise<void> {
    const present = await this.present();
    if (present.size === 0) {
      console.info("[audio] no generated samples deployed — using synthesis");
      return;
    }
    const ids = Object.keys(SAMPLES) as SampleId[];
    const loops = new Set(LOOP_IDS);
    // Short sounds first so gameplay stops falling back as early as possible.
    await this.loadGroup(
      ids.filter((id) => !loops.has(id)),
      present,
    );
    await this.loadGroup([...loops], present);
    this.report();
  }

  /**
   * Which sample files the server actually has. Asking first means a build
   * without the generated audio makes one request, not one per sample.
   */
  private async present(): Promise<Set<string>> {
    try {
      const res = await fetch(`${AUDIO_BASE}/${MANIFEST_FILE}`);
      if (!res.ok) return new Set();
      const names: unknown = await res.json();
      return Array.isArray(names) ? new Set(names.filter((n): n is string => typeof n === "string")) : new Set();
    } catch {
      return new Set();
    }
  }

  private async loadGroup(ids: SampleId[], present: Set<string>): Promise<void> {
    await Promise.all(ids.map((id) => this.loadOne(id, present)));
  }

  /** One line about what the generated audio layer ended up with. */
  private report(): void {
    const total = this.decoded + this.missing;
    if (this.missing === 0) console.info(`[audio] ${this.decoded} generated samples ready`);
    else if (this.decoded === 0) console.info(`[audio] no generated samples found (${total} expected) — using synthesis`);
    else console.info(`[audio] ${this.decoded}/${total} generated samples ready — synthesis covers the rest`);
  }

  private async loadOne(id: SampleId, present: Set<string>): Promise<void> {
    const ctx = this.core.ctx;
    if (!ctx) return;
    const decoded: AudioBuffer[] = [];
    for (const file of SAMPLES[id]) {
      if (!present.has(file)) {
        this.missing++;
        continue;
      }
      try {
        const res = await fetch(sampleUrl(file));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        decoded.push(await ctx.decodeAudioData(await res.arrayBuffer()));
      } catch {
        // A missing or undecodable sample is not fatal: the synthesized
        // recipe stays in charge for this sound. Counted, not logged, so an
        // install without the generated audio is quiet rather than noisy.
        this.missing++;
      }
    }
    this.decoded += decoded.length;
    if (decoded.length > 0) this.buffers.set(id, decoded);
  }

  /** A decoded buffer for `id`, or null when nothing is loaded for it yet. */
  get(id: SampleId, variant?: number): AudioBuffer | null {
    const list = this.buffers.get(id);
    if (!list || list.length === 0) return null;
    const i = variant === undefined ? Math.floor(Math.random() * list.length) : ((variant % list.length) + list.length) % list.length;
    return list[i] ?? null;
  }

  /**
   * Play a sample into `out`. Returns false when the sample is not available,
   * so callers can fall through to their synthesized recipe.
   */
  play(out: AudioNode, id: SampleId, t: number, opts: PlayOptions = {}): boolean {
    const ctx = this.core.ctx;
    const buf = this.get(id, opts.variant);
    if (!ctx || !buf) return false;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = opts.rate ?? 1 + (Math.random() * 2 - 1) * RATE_SPREAD;
    const at = opts.when ?? t;
    if (opts.gain !== undefined && opts.gain !== 1) {
      const g = ctx.createGain();
      g.gain.value = opts.gain;
      src.connect(g).connect(out);
    } else {
      src.connect(out);
    }
    src.start(at);
    return true;
  }

  /**
   * Start a looping sample on `out` with a fade-in, returning a handle that
   * fades out and stops. Returns null when the sample is not loaded.
   */
  loop(out: AudioNode, id: SampleId, fadeSeconds: number, gain = 1): { stop: (fade?: number) => void } | null {
    const ctx = this.core.ctx;
    const buf = this.get(id, 0);
    if (!ctx || !buf) return null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + fadeSeconds);
    src.connect(g).connect(out);
    src.start(t);
    let stopped = false;
    return {
      stop: (fade = fadeSeconds) => {
        if (stopped) return;
        stopped = true;
        const now = ctx.currentTime;
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.linearRampToValueAtTime(0.0001, now + fade);
        src.stop(now + fade + 0.05);
      },
    };
  }
}
