import { Rng, seedFor } from "../../core/rng";
import { TILE } from "../level-types";
import { COLORS } from "../palette";
import type { World } from "../world";

/** Hollow bone tubes on a cord. Hung in a draft they ring by themselves — a light you cannot silence. */
export class Chime {
  /** Swing of the tubes after a ring (0 still .. 1 wild), for the renderer. */
  swing = 0;
  /** Which of the tubes sounded last, for the audio. */
  note = 0;
  private timer: number;
  private readonly rng: Rng;

  constructor(
    readonly x: number,
    readonly y: number,
  ) {
    this.rng = new Rng(seedFor(x, y, 0xc41e));
    this.timer = this.rng.range(1.5, 4);
  }

  update(dt: number, world: World): void {
    this.swing = Math.max(0, this.swing - dt * 0.6);
    if (world.tileAtPos(this.x, this.y) !== TILE.Draft) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = this.rng.range(3.4, 5.8);
    this.note = this.rng.int(0, 4);
    this.swing = 1;
    world.emitSound({
      kind: "chime",
      x: this.x,
      y: this.y,
      radius: 5,
      loudness: 7,
      strength: 0.75,
      speed: 7,
      fade: 2.4,
      color: COLORS.chime,
      source: this,
      alerts: true,
      hits: true,
    });
    world.events.emit("chime", { x: this.x, y: this.y, note: this.note });
  }
}
