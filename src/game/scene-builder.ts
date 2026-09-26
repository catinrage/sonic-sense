import type { EntityDraw } from "../render/renderer";
import type { EntityShaderId } from "../render/glsl/entities";
import { COLORS, noteColor } from "./palette";
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
      this.add("stone", s.x, s.y, z, s.spin, 0.2, 0.2, 3 + s.y * 0.001, [z, s.resting ? 1 : 0, s.x * 7.3, s.lureGlow]);
    }
    for (const s of world.shards) {
      if (s.collected && s.collectT > 0.6) continue;
      const bob = 0.28 + Math.sin(t * 2 + s.phase) * 0.05 + (s.collected ? s.collectT * 1.5 : 0);
      this.add("shard", s.x, s.y, bob, t * 0.8 + s.phase, 0.42, 0.42, 4, [s.glint, t, s.collected ? s.collectT / 0.6 : 0, bob]);
    }
    for (const c of world.crystals) {
      const tint = noteColor(c.note, COLORS.crystal);
      if (c.beam) {
        const facing = Math.atan2(c.beam.y, c.beam.x);
        this.add("dish", c.x, c.y, 0.02, facing, 0.72, 0.72, 4.9 + c.y * 0.001, [c.glow, t, 0, 0], [...tint, c.turnable ? 1 : 0], undefined, false, [c.turned, 0, 0, 0]);
      }
      const shake = Math.sin(t * 60) * c.shake * 0.03;
      this.add("crystal", c.x + shake, c.y, 0.03, c.seed * 6.28, 0.62, 0.62, 5 + c.y * 0.001, [c.glow, t, c.seed, c.pending >= 0 ? 1 : 0], [...tint, c.prism ? 1 : 0]);
    }
    for (const m of world.mimics) {
      this.add("mimic", m.x, m.y, 0.03, 0, 0.56, 0.56, 5 + m.y * 0.001, [m.voice, t, m.seed, 0], [...noteColor(m.lastNote, COLORS.mimic), 0]);
    }
    world.tubes.forEach((m, i) => {
      this.add("tube", m.x, m.y, 0.012, 0, 0.42, 0.42, 1.5, [m.voice, t, Math.floor(i / 2) % 4, 0], [...noteColor(m.lastNote, COLORS.tube), 0]);
    });
    for (const b of world.bells) {
      const timerFrac = b.timed > 0 ? b.timer / b.timed : 0;
      this.add("bell", b.x, b.y, 0.04, 0, 0.62, 0.62, 5 + b.y * 0.001, [b.ring, t, b.wobble, timerFrac], [b.group, 0, 0, 0]);
    }
    for (let i = 0; i < world.wardens.length; i++) {
      const w = world.wardens[i]!;
      const legs = w.legPose((this.legBuffers[i] ??= new Float32Array(48)));
      const size = 1.25 * w.traits.scale;
      this.add("warden", w.x, w.y, 0.12, w.heading, size, size, 6 + w.y * 0.001, [w.frill, w.alert, t, w.moving], [w.mandible, w.traits.variant, w.traits.scale, w.beatClock], legs);
    }
    for (const c of world.chimes) {
      this.add("chime", c.x, c.y, 1.05, 0, 0.46, 0.46, 8.6, [c.swing, t, (c.x * 0.37 + c.y * 0.61) % 1, 0]);
    }
    for (const b of world.baffles) this.addCurtain(world, b.x, b.y, t);
    const p = world.player;
    const alpha = 1 - p.fade;
    const focusing = p.charging && p.chargeKind === "focus" ? 1 : 0;
    const aimAngle = aim ? Math.atan2(aim.y - p.y, aim.x - p.x) : p.facing;
    const note = world.keyNoteAt(p.x, p.y);
    const keyTint = note === null ? [0, 0, 0, 0] : [...noteColor(note, COLORS.pulse), 1];
    this.add("aura", p.x, p.y, 0.01, 0, 0.75, 0.75, 7, [p.charge, t, p.sneakAmt, alpha], [p.listen, p.muffled ? 1 : 0, focusing, aimAngle], undefined, true, keyTint);
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

  /** A moss curtain, parted around the nearest creature pushing through it. */
  private addCurtain(world: World, x: number, y: number, t: number): void {
    let mx = 0;
    let my = 0;
    let best = 1.1;
    for (const m of [world.player, ...world.wardens]) {
      const d = Math.hypot(m.x - x, m.y - y);
      if (d >= best) continue;
      best = d;
      mx = m.x - x;
      my = m.y - y;
    }
    const part = Math.max(0, 1 - best / 1.1);
    this.add("curtain", x, y, 0.95, 0, 0.62, 0.62, 8.5, [t, (x * 0.73 + y * 0.29) % 1, mx, my], [part, 0, 0, 0]);
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
