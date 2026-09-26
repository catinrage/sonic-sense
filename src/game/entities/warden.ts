import { angleDiff, clamp, damp, dampAngle, easeInOutSine, type Vec2 } from "../../core/math";
import { fxRng } from "../../core/rng";
import { moveCircle } from "../collision";
import type { FieldSample } from "../geodesic";
import { COLORS } from "../palette";
import { findPath, nearestWalkable } from "../pathfinding";
import type { Wave } from "../waves";
import type { World } from "../world";
import type { Listener } from "./props";

type WardenState = "idle" | "patrol" | "alert" | "hunt" | "search" | "return";

interface LegDef {
  hip: readonly [number, number];
  rest: readonly [number, number];
  group: number;
}

const L1 = 0.38;
const L2 = 0.5;
const LEG_DEFS: readonly LegDef[] = [
  { hip: [0.1, -0.12], rest: [0.62, -0.5], group: 0 },
  { hip: [-0.02, -0.15], rest: [0.08, -0.74], group: 1 },
  { hip: [-0.14, -0.12], rest: [-0.5, -0.6], group: 0 },
  { hip: [0.1, 0.12], rest: [0.62, 0.5], group: 1 },
  { hip: [-0.02, 0.15], rest: [0.08, 0.74], group: 0 },
  { hip: [-0.14, 0.12], rest: [-0.5, 0.6], group: 1 },
];

interface Leg {
  fx: number;
  fy: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  t: number;
  lift: number;
}

const PATROL_SPEED = 1.1;
const HUNT_SPEED = 2.75;
/** Seconds a warden keeps pushing along a path before giving up. */
const GIVE_UP_AFTER = 12;

export class Warden implements Listener {
  readonly r = 0.4;
  x: number;
  y: number;
  heading: number;
  state: WardenState;
  private stateT = 1.5;
  private readonly home: Vec2;
  private readonly route: Vec2[];
  private routeIdx = 0;
  private path: Vec2[] = [];
  private pathIdx = 0;
  private target: Vec2 | null = null;
  private clickTimer = fxRng.range(0.5, 2.5);
  private lookAround = 0;
  moving = 0;
  frill = 0.15;
  alert = 0;
  mandible = 0;
  readonly legs: Leg[];
  readonly speedMul: number;
  /** Title-screen extra: it clicks and twitches but never hunts. */
  deaf = false;

  constructor(x: number, y: number, route: Vec2[], speedMul: number) {
    this.x = x;
    this.y = y;
    this.home = { x, y };
    this.route = route;
    this.speedMul = speedMul;
    this.heading = fxRng.range(-Math.PI, Math.PI);
    this.state = route.length > 0 ? "patrol" : "idle";
    this.legs = LEG_DEFS.map((d) => {
      const [wx, wy] = this.toWorld(d.rest[0], d.rest[1]);
      return { fx: wx, fy: wy, fromX: wx, fromY: wy, toX: wx, toY: wy, t: -1, lift: 0 };
    });
  }

  hear(wave: Wave, sample: FieldSample, world: World): void {
    if (this.deaf || !wave.alerts || wave.source === this || wave.source instanceof Warden) return;
    const reach = wave.loudness * (0.45 + 0.55 * sample.e);
    if (sample.d > reach) return;
    const calm = this.state === "idle" || this.state === "patrol" || this.state === "return";
    this.alert = 1;
    if (calm) {
      this.state = "alert";
      this.stateT = 0.55;
      this.shriek(world);
    } else if (this.state === "search" || this.state === "hunt") {
      this.state = "hunt";
      this.stateT = GIVE_UP_AFTER;
    }
    this.setTarget(wave.x, wave.y, world);
  }

  update(dt: number, world: World): void {
    this.stateT -= dt;
    this.alert = Math.max(0, this.alert - dt * 0.25);
    const hunting = this.state === "alert" || this.state === "hunt";
    this.frill = damp(this.frill, hunting ? 1 : this.state === "search" ? 0.7 : 0.18, hunting ? 9 : 3, dt);
    this.mandible = damp(this.mandible, hunting ? 0.6 + Math.sin(world.time * 18) * 0.4 : 0.1, 8, dt);
    let speed = 0;

    switch (this.state) {
      case "idle":
        this.lookAround -= dt;
        if (this.lookAround <= 0) {
          this.lookAround = fxRng.range(2, 4.5);
          this.target = null;
        }
        this.heading = dampAngle(this.heading, this.heading + Math.sin(world.time * 0.6) * 0.3, 1, dt);
        if (this.route.length > 0 && this.stateT <= 0) this.beginPatrolLeg(world);
        break;
      case "patrol":
        speed = PATROL_SPEED;
        if (this.followPath(dt, speed, world) || this.stateT < -GIVE_UP_AFTER * 2) {
          this.state = "idle";
          this.stateT = 1.4;
        }
        break;
      case "alert":
        if (this.target) this.faceTowards(this.target.x, this.target.y, 7, dt);
        if (this.stateT <= 0) {
          this.state = "hunt";
          this.stateT = GIVE_UP_AFTER;
        }
        break;
      case "hunt":
        speed = HUNT_SPEED;
        // A closed door or a vanished route: stop and listen instead of pushing forever.
        if (this.followPath(dt, speed, world) || this.stateT <= 0) {
          this.state = "search";
          this.stateT = 2.6;
        }
        break;
      case "search":
        this.heading += Math.sin(world.time * 2.2) * dt * 2.2;
        if (this.stateT <= 0) this.returnHome(world);
        break;
      case "return":
        speed = PATROL_SPEED;
        if (this.followPath(dt, speed, world) || this.stateT <= 0) {
          this.state = "idle";
          this.stateT = 1.2;
        }
        break;
    }

    // Only states that walk a path keep their stride; everyone else settles their legs.
    if (speed === 0) this.moving = damp(this.moving, 0, 8, dt);
    this.updateLegs(dt);
    this.updateClicks(dt, world);
    this.checkCatch(world);
  }

  /** Leg joints in local space for rendering: [hipX, hipY, kneeX, kneeY, footX, footY, lift, 0] × 6. */
  legPose(out: Float32Array): Float32Array {
    for (let i = 0; i < 6; i++) {
      const def = LEG_DEFS[i]!;
      const leg = this.legs[i]!;
      const [fx, fy] = this.toLocal(leg.fx, leg.fy);
      const hx = def.hip[0];
      const hy = def.hip[1];
      let dx = fx - hx;
      let dy = fy - hy;
      let d = Math.hypot(dx, dy);
      const maxD = L1 + L2 - 0.01;
      if (d > maxD) {
        dx *= maxD / d;
        dy *= maxD / d;
        d = maxD;
      }
      const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
      const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
      const ux = dx / d;
      const uy = dy / d;
      const side = Math.sign(hy) || 1;
      // Bend the knee outward, away from the body axis.
      let kx = hx + ux * a - uy * h;
      let ky = hy + uy * a + ux * h;
      if (Math.sign(ky - hy) !== side) {
        kx = hx + ux * a + uy * h;
        ky = hy + uy * a - ux * h;
      }
      out.set([hx, hy, kx, ky, hx + dx, hy + dy, leg.lift, 0], i * 8);
    }
    return out;
  }

  private shriek(world: World): void {
    world.emitSound({
      kind: "wardenAlert",
      x: this.x,
      y: this.y,
      radius: 4.5,
      loudness: 0,
      strength: 1,
      speed: 9,
      fade: 2,
      color: COLORS.wardenAlert,
      source: this,
    });
    world.events.emit("wardenAlert", { x: this.x, y: this.y });
  }

  private updateClicks(dt: number, world: World): void {
    this.clickTimer -= dt;
    if (this.clickTimer > 0) return;
    const agitated = this.state !== "idle" && this.state !== "patrol";
    this.clickTimer = agitated ? fxRng.range(0.7, 1.1) : fxRng.range(1.8, 3.2);
    world.emitSound({
      kind: "warden",
      x: this.x + Math.cos(this.heading) * 0.3,
      y: this.y + Math.sin(this.heading) * 0.3,
      radius: agitated ? 3.2 : 2.6,
      loudness: 0,
      strength: 0.8,
      speed: 7,
      fade: 1.5,
      color: COLORS.warden,
      source: this,
    });
    world.events.emit("wardenClick", { x: this.x, y: this.y });
  }

  private checkCatch(world: World): void {
    const p = world.player;
    if (p.dying || p.entering > 0) return;
    const d = Math.hypot(p.x - this.x, p.y - this.y);
    if (d < this.r + p.r - 0.02) p.kill("warden", world);
  }

  private setTarget(x: number, y: number, world: World): void {
    const goal = nearestWalkable(world.walkGrid, Math.floor(x), Math.floor(y), 3);
    if (!goal) {
      this.target = { x, y };
      this.path = [];
      return;
    }
    this.target = { x: goal.x + 0.5, y: goal.y + 0.5 };
    this.planTo(goal.x, goal.y, world);
  }

  private planTo(tx: number, ty: number, world: World): void {
    const path = findPath(world.walkGrid, Math.floor(this.x), Math.floor(this.y), tx, ty);
    this.path = path ?? [];
    this.pathIdx = 0;
  }

  private beginPatrolLeg(world: World): void {
    const stops = [this.home, ...this.route];
    this.routeIdx = (this.routeIdx + 1) % stops.length;
    const stop = stops[this.routeIdx]!;
    this.planTo(Math.floor(stop.x), Math.floor(stop.y), world);
    this.state = "patrol";
    this.stateT = 0;
  }

  private returnHome(world: World): void {
    const stops = [this.home, ...this.route];
    const stop = stops[this.routeIdx % stops.length]!;
    this.planTo(Math.floor(stop.x), Math.floor(stop.y), world);
    this.state = "return";
    this.stateT = GIVE_UP_AFTER * 2;
  }

  private faceTowards(x: number, y: number, rate: number, dt: number): number {
    const desired = Math.atan2(y - this.y, x - this.x);
    this.heading = dampAngle(this.heading, desired, rate, dt);
    return Math.cos(angleDiff(this.heading, desired));
  }

  /** Steer along the current path; returns true once the path is exhausted. */
  private followPath(dt: number, speed: number, world: World): boolean {
    const wp = this.path[this.pathIdx];
    if (!wp) {
      this.moving = damp(this.moving, 0, 8, dt);
      return true;
    }
    const last = this.pathIdx === this.path.length - 1;
    if (Math.hypot(wp.x - this.x, wp.y - this.y) < (last ? 0.12 : 0.35)) {
      this.pathIdx++;
      return this.pathIdx >= this.path.length;
    }
    const align = this.faceTowards(wp.x, wp.y, 6, dt);
    const v = speed * this.speedMul * clamp(align, 0, 1) ** 2;
    const res = moveCircle(
      world.walkQuery,
      [],
      this.x,
      this.y,
      this.r * 0.7,
      Math.cos(this.heading) * v * dt,
      Math.sin(this.heading) * v * dt,
    );
    this.moving = damp(this.moving, v / HUNT_SPEED, 8, dt);
    this.x = res.x;
    this.y = res.y;
    return false;
  }

  private updateLegs(dt: number): void {
    const vx = Math.cos(this.heading) * this.moving * HUNT_SPEED;
    const vy = Math.sin(this.heading) * this.moving * HUNT_SPEED;
    const stepDur = 0.2 - this.moving * 0.08;
    const groupStepping = [false, false];
    for (let i = 0; i < 6; i++) if (this.legs[i]!.t >= 0) groupStepping[LEG_DEFS[i]!.group] = true;

    for (let i = 0; i < 6; i++) {
      const leg = this.legs[i]!;
      const def = LEG_DEFS[i]!;
      if (leg.t >= 0) {
        leg.t += dt / stepDur;
        const k = easeInOutSine(Math.min(1, leg.t));
        leg.fx = leg.fromX + (leg.toX - leg.fromX) * k;
        leg.fy = leg.fromY + (leg.toY - leg.fromY) * k;
        leg.lift = Math.sin(Math.min(1, leg.t) * Math.PI);
        if (leg.t >= 1) {
          leg.t = -1;
          leg.lift = 0;
        }
        continue;
      }
      const [rx, ry] = this.toWorld(def.rest[0], def.rest[1]);
      const lead = 0.16;
      const tx = rx + vx * lead;
      const ty = ry + vy * lead;
      const other = def.group === 0 ? 1 : 0;
      if (Math.hypot(leg.fx - tx, leg.fy - ty) > 0.3 && !groupStepping[other]) {
        leg.t = 0;
        leg.fromX = leg.fx;
        leg.fromY = leg.fy;
        leg.toX = tx + vx * 0.08;
        leg.toY = ty + vy * 0.08;
        groupStepping[def.group] = true;
      }
    }
  }

  private toWorld(lx: number, ly: number): [number, number] {
    const c = Math.cos(this.heading);
    const s = Math.sin(this.heading);
    return [this.x + c * lx - s * ly, this.y + s * lx + c * ly];
  }

  private toLocal(wx: number, wy: number): [number, number] {
    const c = Math.cos(this.heading);
    const s = Math.sin(this.heading);
    const dx = wx - this.x;
    const dy = wy - this.y;
    return [c * dx + s * dy, -s * dx + c * dy];
  }
}
