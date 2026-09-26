/** Small, fast, seedable PRNG (mulberry32). */
export class Rng {
  private state: number;

  constructor(seed = 0x9e3779b9) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(min: number, maxExclusive: number): number {
    return Math.floor(this.range(min, maxExclusive));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)] as T;
  }

  /** Uniformly distributed point on a disc of the given radius. */
  disc(radius: number): { x: number; y: number } {
    const a = this.next() * Math.PI * 2;
    const r = Math.sqrt(this.next()) * radius;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  }
}

/** Stateless integer hash → [0, 1). Stable across runs (used for level decoration). */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Stable 32-bit seed for an entity placed at (x, y). Gameplay randomness is
 * seeded per entity so behaviour never depends on what else was created first.
 */
export function seedFor(x: number, y: number, salt: number): number {
  return Math.floor(hash2(Math.floor(x * 2), Math.floor(y * 2), salt) * 4294967296) >>> 0;
}

/** Shared RNG for cosmetic randomness only (particles, blinks) — never for gameplay. */
export const fxRng = new Rng(1337);
