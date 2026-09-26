import { fxRng } from "../core/rng";
import type { RGB } from "../core/math";
import type { Camera } from "./camera";
import { DRIP_FALL } from "./entities/props";
import { COLORS } from "./palette";
import { PARTICLE_KIND, type Particles } from "./particles";
import type { World } from "./world";

const scale = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

/** Visual reactions (particles, camera shake) to world events. */
export class Effects {
  private readonly unsubscribe: (() => void)[] = [];

  constructor(
    private readonly world: World,
    private readonly particles: Particles,
    private readonly camera: Camera,
  ) {
    const ev = world.events;
    this.unsubscribe.push(
      ev.on("pulse", (e) => this.pulseBurst(e.x, e.y, e.charge)),
      ev.on("step", (e) => this.stepPuff(e.x, e.y, e.water)),
      ev.on("stoneHit", (e) => this.impact(e.x, e.y, e.strength, e.water)),
      ev.on("crystal", (e) => this.crystalBurst(e.x, e.y)),
      ev.on("bell", (e) => this.bellRing(e.x, e.y, e.group)),
      ev.on("door", (e) => e.open && this.camera.shake(0.18)),
      ev.on("shard", (e) => this.shardBurst(e.x, e.y)),
      ev.on("exitAwake", (e) => this.exitAwake(e.x, e.y)),
      ev.on("drip", (e) => this.splash(e.x, e.y, 0.5)),
      ev.on("death", (e) => this.death(e.x, e.y, e.cause)),
      ev.on("complete", (e) => this.complete(e.x, e.y)),
      ev.on("wardenAlert", () => this.camera.shake(0.22)),
      ev.on("pickup", (e) => this.sparkle(e.x, e.y, COLORS.stone, 10)),
    );
  }

  dispose(): void {
    for (const off of this.unsubscribe) off();
  }

  update(dt: number): void {
    this.wallSparks();
    this.ambient(dt);
  }

  private wallSparks(): void {
    const { world, particles } = this;
    for (const wave of world.waves.waves) {
      const hits = wave.job.hits;
      if (hits.length === 0) continue;
      const front = wave.front(world.time);
      const chance = wave.kind === "pulse" ? 0.16 : 0.08;
      while (wave.hitCursor < hits.length && hits[wave.hitCursor]!.d <= front) {
        const h = hits[wave.hitCursor++]!;
        const u = Math.min(1, h.d / wave.radius);
        const e = wave.strength * h.e * (1 - u * u) * (1 - u * u);
        if (e < 0.08 || fxRng.next() > chance) continue;
        const sp = fxRng.range(0.3, 1.4) * e;
        particles.spawn({
          x: h.x + h.nx * 0.03,
          y: h.y + h.ny * 0.03,
          z: fxRng.range(0.1, 0.9),
          vx: h.nx * sp + fxRng.range(-0.4, 0.4),
          vy: h.ny * sp + fxRng.range(-0.4, 0.4),
          vz: fxRng.range(-0.2, 0.5),
          life: fxRng.range(0.35, 0.9),
          size: fxRng.range(0.025, 0.05),
          color: scale(wave.color, 2.2 * e + 0.4),
          drag: 2.5,
          gravity: 0.6,
          kind: PARTICLE_KIND.Spark,
          stretch: 0.25,
        });
      }
    }
  }

  private ambient(dt: number): void {
    const { world, particles } = this;
    for (const d of world.drips) {
      if (d.falling < 0) continue;
      const z = 2.2 * (1 - d.falling / DRIP_FALL);
      particles.spawn({ x: d.x, y: d.y, z, life: 0.05, size: 0.018, color: [0.35, 0.55, 0.8], kind: PARTICLE_KIND.Glow });
    }
    const exit = world.exit;
    if (exit && exit.awaken > 0.05 && fxRng.next() < dt * 18 * exit.awaken) {
      const a = fxRng.range(0, Math.PI * 2);
      const r = fxRng.range(0.15, 0.6);
      particles.spawn({
        x: exit.x + Math.cos(a) * r,
        y: exit.y + Math.sin(a) * r,
        z: 0.05,
        vx: -Math.sin(a) * 0.4,
        vy: Math.cos(a) * 0.4,
        vz: fxRng.range(0.4, 1.1),
        life: fxRng.range(0.8, 1.8),
        size: fxRng.range(0.02, 0.045),
        color: scale(COLORS.exit, 1.6 * exit.awaken),
        drag: 0.8,
        kind: PARTICLE_KIND.Spark,
      });
    }
    const p = world.player;
    if (p.charging && fxRng.next() < dt * (20 + p.charge * 50)) {
      const a = fxRng.range(0, Math.PI * 2);
      const r = fxRng.range(0.7, 1.2);
      particles.spawn({
        x: p.x + Math.cos(a) * r,
        y: p.y + Math.sin(a) * r,
        z: fxRng.range(0.1, 0.5),
        vx: -Math.cos(a) * r * 2.4,
        vy: -Math.sin(a) * r * 2.4,
        life: 0.4,
        size: fxRng.range(0.018, 0.035),
        color: scale(COLORS.pulse, 1.2 + p.charge * 2),
        kind: PARTICLE_KIND.Spark,
        stretch: 0.12,
      });
    }
    for (const c of world.crystals) {
      if (c.glow > 0.2 && fxRng.next() < dt * 10 * c.glow) this.sparkle(c.x, c.y, COLORS.crystal, 1, 0.5);
    }
  }

  private pulseBurst(x: number, y: number, charge: number): void {
    const n = 24 + Math.floor(charge * 40);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + fxRng.range(-0.1, 0.1);
      const sp = fxRng.range(2, 5) * (0.6 + charge);
      this.particles.spawn({
        x,
        y,
        z: fxRng.range(0.15, 0.4),
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        vz: fxRng.range(-0.3, 0.6),
        life: fxRng.range(0.25, 0.55),
        size: fxRng.range(0.02, 0.04),
        color: scale(COLORS.pulse, 2.5),
        drag: 4,
        kind: PARTICLE_KIND.Spark,
        stretch: 0.08,
      });
    }
    this.particles.spawn({ x, y, z: 0.05, life: 0.35, size: 0.3, sizeEnd: 1.4 + charge, color: scale(COLORS.pulse, 1.5), kind: PARTICLE_KIND.Ring });
    this.particles.spawn({ x, y, z: 0.2, life: 0.25, size: 0.9, sizeEnd: 0.2, color: scale(COLORS.pulse, 1.4), kind: PARTICLE_KIND.Glow });
    this.camera.shake(0.08 + charge * 0.3);
  }

  private stepPuff(x: number, y: number, water: boolean): void {
    if (water) {
      this.splash(x, y, 0.7);
      return;
    }
    for (let i = 0; i < 3; i++) {
      this.particles.spawn({
        x: x + fxRng.range(-0.05, 0.05),
        y: y + fxRng.range(-0.05, 0.05),
        z: 0.03,
        vx: fxRng.range(-0.3, 0.3),
        vy: fxRng.range(-0.3, 0.3),
        vz: fxRng.range(0.05, 0.2),
        life: fxRng.range(0.3, 0.6),
        size: fxRng.range(0.012, 0.022),
        color: [0.2, 0.45, 0.6],
        drag: 3,
      });
    }
  }

  private splash(x: number, y: number, k: number): void {
    const n = Math.floor(8 * k) + 3;
    for (let i = 0; i < n; i++) {
      const a = fxRng.range(0, Math.PI * 2);
      const sp = fxRng.range(0.4, 1.3) * k;
      this.particles.spawn({
        x,
        y,
        z: 0.02,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        vz: fxRng.range(0.8, 2.2) * k,
        life: fxRng.range(0.35, 0.6),
        size: fxRng.range(0.012, 0.024),
        color: scale(COLORS.splash, 1.3),
        gravity: 7,
        kind: PARTICLE_KIND.Spark,
        stretch: 0.05,
      });
    }
    this.particles.spawn({ x, y, z: 0.01, life: 0.6, size: 0.05, sizeEnd: 0.45 * k + 0.1, color: scale(COLORS.splash, 0.9), kind: PARTICLE_KIND.Ring });
  }

  private impact(x: number, y: number, strength: number, water: boolean): void {
    if (water) {
      this.splash(x, y, 0.6 + strength * 0.6);
      return;
    }
    const n = Math.floor(6 + strength * 14);
    for (let i = 0; i < n; i++) {
      const a = fxRng.range(0, Math.PI * 2);
      const sp = fxRng.range(0.8, 3) * strength;
      this.particles.spawn({
        x,
        y,
        z: 0.04,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        vz: fxRng.range(0.5, 2) * strength,
        life: fxRng.range(0.25, 0.6),
        size: fxRng.range(0.015, 0.03),
        color: scale(COLORS.stone, 2.2),
        gravity: 6,
        drag: 1.5,
        kind: PARTICLE_KIND.Spark,
        stretch: 0.1,
        bounce: true,
      });
    }
    this.particles.spawn({ x, y, z: 0.02, life: 0.3, size: 0.1, sizeEnd: 0.6, color: scale(COLORS.stone, 1.2), kind: PARTICLE_KIND.Ring });
    this.camera.shake(0.05 * strength);
  }

  private sparkle(x: number, y: number, color: RGB, n: number, spread = 0.35): void {
    for (let i = 0; i < n; i++) {
      this.particles.spawn({
        x: x + fxRng.range(-spread, spread),
        y: y + fxRng.range(-spread, spread),
        z: fxRng.range(0.1, 0.7),
        vz: fxRng.range(0.2, 0.7),
        vx: fxRng.range(-0.2, 0.2),
        vy: fxRng.range(-0.2, 0.2),
        life: fxRng.range(0.5, 1.1),
        size: fxRng.range(0.015, 0.035),
        color: scale(color, 2),
        drag: 1,
        kind: PARTICLE_KIND.Spark,
      });
    }
  }

  private crystalBurst(x: number, y: number): void {
    this.sparkle(x, y, COLORS.crystal, 26, 0.45);
    this.particles.spawn({ x, y, z: 0.3, life: 0.5, size: 0.2, sizeEnd: 1.6, color: scale(COLORS.crystal, 1.3), kind: PARTICLE_KIND.Ring });
    this.camera.shake(0.06);
  }

  private bellRing(x: number, y: number, group: number): void {
    this.sparkle(x, y, COLORS.bell, 18, 0.3);
    for (let k = 0; k < 3; k++) {
      this.particles.spawn({ x, y, z: 0.4, life: 0.5 + k * 0.25, size: 0.2, sizeEnd: 1.2 + k * 0.5, color: scale(COLORS.bell, 0.7), kind: PARTICLE_KIND.Ring });
    }
    // Trace a line of light from the bell to each of its doors.
    const w = this.world;
    for (let i = 0; i < w.doorGroup.length; i++) {
      if (w.doorGroup[i] !== group) continue;
      const dx = (i % w.w) + 0.5;
      const dy = Math.floor(i / w.w) + 0.5;
      const len = Math.hypot(dx - x, dy - y);
      const steps = Math.ceil(len * 3);
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        this.particles.spawn({
          x: x + (dx - x) * t,
          y: y + (dy - y) * t,
          z: 0.35 + Math.sin(t * Math.PI) * len * 0.12,
          vz: 0.3,
          life: 0.3 + t * 0.9,
          size: 0.035,
          color: scale(COLORS.bell, 1.6),
          kind: PARTICLE_KIND.Glow,
        });
      }
    }
    this.camera.shake(0.1);
  }

  private shardBurst(x: number, y: number): void {
    this.sparkle(x, y, [0.6, 0.95, 1.0], 36, 0.25);
    this.particles.spawn({ x, y, z: 0.3, life: 0.6, size: 0.1, sizeEnd: 1.3, color: [1.2, 1.8, 2.0], kind: PARTICLE_KIND.Ring });
  }

  private exitAwake(x: number, y: number): void {
    this.sparkle(x, y, COLORS.exit, 60, 0.8);
    for (let k = 0; k < 4; k++) {
      this.particles.spawn({ x, y, z: 0.05, life: 0.8 + k * 0.3, size: 0.3, sizeEnd: 2 + k, color: scale(COLORS.exit, 1.5), kind: PARTICLE_KIND.Ring });
    }
    this.camera.shake(0.25);
  }

  private death(x: number, y: number, cause: "pit" | "warden"): void {
    const color: RGB = cause === "warden" ? [2.4, 0.2, 0.25] : [0.5, 1.4, 1.8];
    for (let i = 0; i < 40; i++) {
      const a = fxRng.range(0, Math.PI * 2);
      const sp = fxRng.range(0.5, 3);
      this.particles.spawn({
        x,
        y,
        z: 0.25,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        vz: fxRng.range(-0.5, 1),
        life: fxRng.range(0.4, 1.2),
        size: fxRng.range(0.02, 0.05),
        color,
        drag: 2,
        kind: PARTICLE_KIND.Spark,
        stretch: 0.1,
      });
    }
    this.camera.shake(cause === "warden" ? 0.6 : 0.3);
  }

  private complete(x: number, y: number): void {
    for (let i = 0; i < 80; i++) {
      const a = fxRng.range(0, Math.PI * 2);
      const r = fxRng.range(0, 0.5);
      this.particles.spawn({
        x: x + Math.cos(a) * r,
        y: y + Math.sin(a) * r,
        z: 0.1,
        vx: Math.cos(a) * 0.3,
        vy: Math.sin(a) * 0.3,
        vz: fxRng.range(1, 3.5),
        life: fxRng.range(0.8, 2),
        size: fxRng.range(0.02, 0.05),
        color: scale(COLORS.exit, 2.2),
        drag: 0.5,
        kind: PARTICLE_KIND.Spark,
        stretch: 0.15,
      });
    }
    this.camera.shake(0.3);
  }
}
