import type { EntityDraw } from "../render/renderer";
import type { EntityShaderId } from "../render/glsl/entities";
import type { World } from "./world";

/** Converts world entities into renderer draw calls, reusing draw objects between frames. */
export class SceneBuilder {
  private readonly pool: EntityDraw[] = [];
  private used = 0;
  private readonly out: EntityDraw[] = [];
  private readonly legBuffers: Float32Array[] = [];

  build(world: World, aim?: { x: number; y: number; alpha: number }): EntityDraw[] {
    this.used = 0;
    this.out.length = 0;
    const t = world.time;
    if (aim && aim.alpha > 0.01) {
      this.add("reticle", aim.x, aim.y, 0.02, t * 0.6, 0.4, 0.4, 9, [aim.alpha, t, 0, 0], undefined, undefined, true);
    }

    for (const m of world.mushrooms) {
      this.add("mushroom", m.x, m.y, 0.01, m.seed * 6.28, 0.42, 0.42, 1, [m.glow, t, m.seed, 0]);
    }
    for (const d of world.drips) {
      this.add("puddle", d.x, d.y, 0.005, d.x * 2.7, 0.5, 0.5, 0, [t, d.since, 0, 0]);
    }
    const exit = world.exit;
    if (exit) {
      this.add("exit", exit.x, exit.y, 0.004, 0, 1.05, 1.05, 0.5, [exit.awaken, t, exit.hum, exit.active ? 1 : 0]);
    }
    for (const pile of world.piles) {
      this.add("pile", pile.x, pile.y, 0.02, pile.x * 3.1, 0.4, 0.4, 2, [pile.count, pile.x + pile.y, 0, 0]);
    }
    for (const s of world.stones) {
      const z = Math.max(0.02, s.z);
      this.add("stone", s.x, s.y, z, s.spin, 0.2, 0.2, 3 + s.y * 0.001, [z, s.resting ? 1 : 0, s.x * 7.3, 0]);
    }
    for (const s of world.shards) {
      if (s.collected && s.collectT > 0.6) continue;
      const bob = 0.28 + Math.sin(t * 2 + s.phase) * 0.05 + (s.collected ? s.collectT * 1.5 : 0);
      this.add("shard", s.x, s.y, bob, t * 0.8 + s.phase, 0.42, 0.42, 4, [s.glint, t, s.collected ? s.collectT / 0.6 : 0, bob]);
    }
    for (const c of world.crystals) {
      const shake = Math.sin(t * 60) * c.shake * 0.03;
      this.add("crystal", c.x + shake, c.y, 0.03, c.seed * 6.28, 0.62, 0.62, 5 + c.y * 0.001, [c.glow, t, c.seed, c.pending >= 0 ? 1 : 0]);
    }
    for (const b of world.bells) {
      const timerFrac = b.timed > 0 ? b.timer / b.timed : 0;
      this.add("bell", b.x, b.y, 0.04, 0, 0.62, 0.62, 5 + b.y * 0.001, [b.ring, t, b.wobble, timerFrac], [b.group, 0, 0, 0]);
    }
    for (let i = 0; i < world.wardens.length; i++) {
      const w = world.wardens[i]!;
      const legs = w.legPose((this.legBuffers[i] ??= new Float32Array(48)));
      this.add("warden", w.x, w.y, 0.12, w.heading, 1.25, 1.25, 6 + w.y * 0.001, [w.frill, w.alert, t, w.moving], [w.mandible, 0, 0, 0], legs);
    }
    const p = world.player;
    const alpha = 1 - p.fade;
    this.add("aura", p.x, p.y, 0.01, 0, 0.75, 0.75, 7, [p.charge, t, p.sneakAmt, alpha], undefined, undefined, true);
    this.add(
      "player",
      p.x,
      p.y,
      Math.max(p.z, -3.1) + 0.02,
      p.facing + p.spin,
      0.7,
      0.7,
      8,
      [p.walkPhase, p.walkAmt, p.charge, p.sneakAmt],
      [p.earL, p.earR, p.tailSway, p.blink],
      undefined,
      false,
      [t, 0, p.fade, 0],
    );
    return this.out;
  }

  private add(
    shader: EntityShaderId,
    x: number,
    y: number,
    z: number,
    rot: number,
    hw: number,
    hh: number,
    order: number,
    p0: readonly number[],
    p1?: readonly number[],
    extra?: Float32Array,
    additive = false,
    p2?: readonly number[],
  ): void {
    let d = this.pool[this.used];
    if (!d) {
      d = { shader, x, y, z, rot, hw, hh, order, params: new Float32Array(16) };
      this.pool.push(d);
    }
    this.used++;
    d.shader = shader;
    d.x = x;
    d.y = y;
    d.z = z;
    d.rot = rot;
    d.hw = hw;
    d.hh = hh;
    d.order = order;
    d.additive = additive;
    d.params.fill(0);
    d.params.set(p0, 0);
    if (p1) d.params.set(p1, 4);
    if (p2) d.params.set(p2, 8);
    d.extra = extra;
    this.out.push(d);
  }
}
