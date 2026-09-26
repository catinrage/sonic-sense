import type { RGB } from "../core/math";
import type { ParticleBatch } from "../render/renderer";

export const PARTICLE_KIND = { Glow: 0, Spark: 1, Ring: 2 } as const;

export interface ParticleSpec {
  x: number;
  y: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  life: number;
  size: number;
  sizeEnd?: number;
  color: RGB;
  alpha?: number;
  drag?: number;
  gravity?: number;
  kind?: number;
  stretch?: number;
  /** Particles bounce off the floor instead of sinking. */
  bounce?: boolean;
}

const MAX_PARTICLES = 6000;
const FIELDS = 18;

/** Pooled CPU particle system; renders as additive instanced quads. */
export class Particles {
  private readonly s = new Float32Array(MAX_PARTICLES * FIELDS);
  private readonly out = new Float32Array(MAX_PARTICLES * 12);
  count = 0;

  spawn(p: ParticleSpec): void {
    if (this.count >= MAX_PARTICLES) return;
    const o = this.count++ * FIELDS;
    const s = this.s;
    s[o] = p.x;
    s[o + 1] = p.y;
    s[o + 2] = p.z ?? 0.05;
    s[o + 3] = p.vx ?? 0;
    s[o + 4] = p.vy ?? 0;
    s[o + 5] = p.vz ?? 0;
    s[o + 6] = p.life;
    s[o + 7] = p.life;
    s[o + 8] = p.size;
    s[o + 9] = p.sizeEnd ?? p.size;
    s[o + 10] = p.color[0];
    s[o + 11] = p.color[1];
    s[o + 12] = p.color[2];
    s[o + 13] = p.alpha ?? 1;
    s[o + 14] = p.drag ?? 0;
    s[o + 15] = p.gravity ?? 0;
    s[o + 16] = (p.kind ?? 0) + (p.bounce ? 8 : 0);
    s[o + 17] = p.stretch ?? 0;
  }

  clear(): void {
    this.count = 0;
  }

  update(dt: number): void {
    const s = this.s;
    let i = 0;
    while (i < this.count) {
      const o = i * FIELDS;
      s[o + 6] -= dt;
      if (s[o + 6]! <= 0) {
        const last = (this.count - 1) * FIELDS;
        if (o !== last) s.copyWithin(o, last, last + FIELDS);
        this.count--;
        continue;
      }
      const drag = Math.exp(-s[o + 14]! * dt);
      s[o + 3] *= drag;
      s[o + 4] *= drag;
      s[o + 5] = s[o + 5]! * drag - s[o + 15]! * dt;
      s[o] += s[o + 3]! * dt;
      s[o + 1] += s[o + 4]! * dt;
      s[o + 2] += s[o + 5]! * dt;
      if (s[o + 16]! >= 8 && s[o + 2]! < 0.01) {
        s[o + 2] = 0.01;
        s[o + 5] = Math.abs(s[o + 5]!) * 0.35;
        s[o + 3] *= 0.6;
        s[o + 4] *= 0.6;
      }
      i++;
    }
  }

  batch(): ParticleBatch {
    const s = this.s;
    const out = this.out;
    for (let i = 0; i < this.count; i++) {
      const o = i * FIELDS;
      const k = i * 12;
      const t = 1 - s[o + 6]! / s[o + 7]!;
      const fadeIn = Math.min(1, t * 12);
      const fadeOut = Math.min(1, (1 - t) * 3);
      out[k] = s[o]!;
      out[k + 1] = s[o + 1]!;
      out[k + 2] = s[o + 2]!;
      out[k + 3] = s[o + 8]! + (s[o + 9]! - s[o + 8]!) * t;
      out[k + 4] = s[o + 10]!;
      out[k + 5] = s[o + 11]!;
      out[k + 6] = s[o + 12]!;
      out[k + 7] = s[o + 13]! * fadeIn * fadeOut;
      out[k + 8] = s[o + 3]!;
      out[k + 9] = s[o + 4]!;
      out[k + 10] = s[o + 17]!;
      out[k + 11] = s[o + 16]! % 8;
    }
    return { count: this.count, data: out };
  }
}
