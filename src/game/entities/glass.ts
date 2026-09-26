import { CHORD_SUSTAIN } from "../calls";
import type { FieldSample } from "../geodesic";
import { TILE, type GlassSpawn } from "../level-types";
import type { Wave } from "../waves";
import type { World } from "../world";
import type { Listener } from "./props";

/**
 * A pane of singing glass. It ignores unpitched sound. Struck hard enough by its
 * note it shatters; a chord pane needs every one of its notes ringing at once,
 * and an off-chord note is a discord that silences it.
 */
export class GlassPane {
  shattered = false;
  /** Seconds each chord note keeps ringing. */
  readonly ringing: number[];
  /** Listening points just outside the pane, on every face. */
  readonly faces: GlassFace[];
  private lastWave = -1;

  constructor(
    readonly spawn: GlassSpawn,
    faces: readonly { x: number; y: number }[],
  ) {
    this.ringing = spawn.notes.map(() => 0);
    this.faces = faces.map((f) => new GlassFace(f.x, f.y, this));
  }

  get x(): number {
    return this.spawn.x;
  }

  get y(): number {
    return this.spawn.y;
  }

  get notes(): readonly number[] {
    return this.spawn.notes;
  }

  get chord(): boolean {
    return this.spawn.notes.length > 1;
  }

  /** Bit i set while the pane's i-th note rings. */
  get heldMask(): number {
    return this.ringing.reduce((m, t, i) => (t > 0 ? m | (1 << i) : m), 0);
  }

  /** Bit n set for each tone n the pane is tuned to (for the renderer). */
  get noteMask(): number {
    return this.spawn.notes.reduce<number>((m, n) => m | (1 << n), 0);
  }

  /** Bit n set for each tone n ringing on the pane now (for the renderer). */
  get ringingMask(): number {
    return this.spawn.notes.reduce<number>((m, n, i) => (this.ringing[i]! > 0 ? m | (1 << n) : m), 0);
  }

  hearAt(wave: Wave, sample: FieldSample, world: World): void {
    // One wave reaches several faces; it counts once.
    if (this.shattered || wave.note === null || wave.id === this.lastWave) return;
    if (wave.energyAt(sample) < this.spawn.threshold) return;
    this.lastWave = wave.id;
    const i = this.spawn.notes.indexOf(wave.note as GlassSpawn["notes"][number]);
    if (i < 0) {
      if (this.chord) this.discord(world);
      else world.events.emit("glassClink", { x: this.x, y: this.y });
      return;
    }
    this.ringing[i] = CHORD_SUSTAIN;
    world.tilesVersion++;
    world.events.emit("glassRing", { x: this.x, y: this.y, note: wave.note });
    if (this.ringing.every((t) => t > 0)) world.shatterGlass(this);
  }

  update(dt: number, world: World): void {
    const before = this.heldMask;
    for (let i = 0; i < this.ringing.length; i++) this.ringing[i] = Math.max(0, this.ringing[i]! - dt);
    if (this.heldMask !== before) world.tilesVersion++;
  }

  /** A wrong note: every held note falls silent, and the discord carries. */
  private discord(world: World): void {
    this.ringing.fill(0);
    world.tilesVersion++;
    world.discordAt(this.x, this.y, this);
  }
}

/** One of a pane's listening points: glass hears through its faces, not its core. */
export class GlassFace implements Listener {
  constructor(
    readonly x: number,
    readonly y: number,
    readonly pane: GlassPane,
  ) {}

  hear(wave: Wave, sample: FieldSample, world: World): void {
    this.pane.hearAt(wave, sample, world);
  }
}

/**
 * Where a pane listens: the centre of every open tile touching it (walls, other
 * glass and doors excluded). The checker listens at exactly the same points.
 */
export function paneFaces(w: number, h: number, tiles: ArrayLike<number>, pane: GlassSpawn): { x: number; y: number }[] {
  const seen = new Set<number>();
  const faces: { x: number; y: number }[] = [];
  for (const i of pane.tiles) {
    const x = i % w;
    const y = Math.floor(i / w);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = ny * w + nx;
      const t = tiles[n];
      if (seen.has(n) || t === TILE.Wall || t === TILE.Glass || t === TILE.Door) continue;
      seen.add(n);
      faces.push({ x: nx + 0.5, y: ny + 0.5 });
    }
  }
  return faces;
}
