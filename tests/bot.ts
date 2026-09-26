import { World } from "../src/game/world";
import { parseLevel } from "../src/game/level-parser";
import { findPath } from "../src/game/pathfinding";
import type { PlayerIntent } from "../src/game/entities/player";
import type { LevelDef } from "../src/game/level-types";

const DT = 1 / 60;

const IDLE: PlayerIntent = {
  moveX: 0,
  moveY: 0,
  sneak: false,
  pulseHeld: false,
  pulseReleased: false,
  throwPressed: false,
  aimX: 0,
  aimY: 0,
};

export interface GoOptions {
  sneak?: boolean;
  /** Give up after this many simulated seconds. */
  timeout?: number;
}

/**
 * Scripted player for headless playthroughs. Every action advances the real
 * simulation, and any death, stall or timeout throws with the bot's position.
 */
export class Bot {
  readonly world: World;
  readonly log: string[] = [];
  private dead = "";
  private complete = false;

  constructor(def: LevelDef) {
    this.world = new World(parseLevel(def));
    this.world.events.on("death", (e) => (this.dead = e.cause));
    this.world.events.on("complete", () => (this.complete = true));
  }

  get finished(): boolean {
    return this.complete;
  }

  get p() {
    return this.world.player;
  }

  /** Walk to the centre of tile (tx, ty) along an A* path. */
  go(tx: number, ty: number, opts: GoOptions = {}): this {
    const w = this.world;
    const path = findPath(w.walkGrid, Math.floor(this.p.x), Math.floor(this.p.y), tx, ty);
    if (!path) this.fail(`no path to (${tx}, ${ty})`);
    const deadline = w.time + (opts.timeout ?? 40);
    let idx = 0;
    let lastProgress = w.time;
    let best = Infinity;
    while (idx < path!.length) {
      const wp = path![idx]!;
      const last = idx === path!.length - 1;
      const dx = wp.x - this.p.x;
      const dy = wp.y - this.p.y;
      const d = Math.hypot(dx, dy);
      if (d < (last ? 0.08 : 0.22)) {
        idx++;
        best = Infinity;
        continue;
      }
      if (d < best - 0.02) {
        best = d;
        lastProgress = w.time;
      }
      if (w.time - lastProgress > 3) this.fail(`stuck heading to (${wp.x.toFixed(1)}, ${wp.y.toFixed(1)})`);
      if (w.time > deadline) this.fail(`timed out walking to (${tx}, ${ty})`);
      // Slow down for the final approach and for sharp turns so bridges are safe.
      const next = path![idx + 1];
      let scale = last ? Math.min(1, d / 0.6) : 1;
      if (next) {
        const tx2 = next.x - wp.x;
        const ty2 = next.y - wp.y;
        const turn = (dx * tx2 + dy * ty2) / (d * Math.hypot(tx2, ty2) || 1);
        if (turn < 0.5 && d < 0.5) scale = Math.min(scale, 0.45);
      }
      this.step({ moveX: (dx / d) * scale, moveY: (dy / d) * scale, sneak: opts.sneak ?? false });
      if (this.complete) return this;
    }
    this.settle(0.15);
    return this;
  }

  /** Hold the call button for `hold` seconds, then release. */
  call(hold: number): this {
    for (let t = 0; t < hold; t += DT) this.step({ pulseHeld: true });
    this.step({ pulseReleased: true });
    return this;
  }

  throwAt(x: number, y: number): this {
    this.step({ throwPressed: true, aimX: x, aimY: y });
    return this;
  }

  wait(seconds: number): this {
    for (let t = 0; t < seconds; t += DT) this.step({});
    return this;
  }

  /** Wait until `pred` holds (checked every frame). */
  waitUntil(label: string, pred: (w: World) => boolean, timeout = 30): this {
    const deadline = this.world.time + timeout;
    while (!pred(this.world)) {
      if (this.world.time > deadline) this.fail(`timed out waiting for ${label}`);
      this.step({});
    }
    return this;
  }

  note(msg: string): this {
    this.log.push(`[${this.world.time.toFixed(1)}s] ${msg}`);
    return this;
  }

  private settle(seconds: number): void {
    for (let t = 0; t < seconds; t += DT) this.step({});
  }

  private step(intent: Partial<PlayerIntent>): void {
    this.world.update(DT, { ...IDLE, ...intent });
    if (this.dead) this.fail(`died (${this.dead})`);
  }

  private fail(msg: string): never {
    const p = this.p;
    const wardens = this.world.wardens.map((w) => `${w.state}@(${w.x.toFixed(1)},${w.y.toFixed(1)})`).join(" ");
    throw new Error(
      `${msg} at t=${this.world.time.toFixed(1)}s, player (${p.x.toFixed(2)}, ${p.y.toFixed(2)})${wardens ? `, wardens ${wardens}` : ""}\n${this.log.join("\n")}`,
    );
  }
}
