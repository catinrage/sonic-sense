import { angleDiff, clamp, damp, dampAngle, dist, easeInOutSine, type Vec2 } from "../../core/math";
import { Rng } from "../../core/rng";
import { moveCircle } from "../collision";
import type { FieldSample } from "../geodesic";
import { TILE } from "../level-types";
import { COLORS } from "../palette";
import { findPath, nearestWalkable } from "../pathfinding";
import type { Wave } from "../waves";
import type { World } from "../world";
import type { Listener } from "./props";
import type { WardenTraits } from "./warden-traits";

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

/** Speed at which the leg gait reaches a full stride (tiles/s). */
const STRIDE_SPEED = 2.75;

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
  /** Seconds a patrol leg may take before it is abandoned (a closed door, a blocked route). */
  private legBudget = 0;
  private target: Vec2 | null = null;
  private clickTimer: number;
  private lookAround = 0;
  /** Private randomness: behaviour never depends on anything else in the world. */
  private readonly rng: Rng;
  /** Seconds until an alarm from another creature can move it again. */
  private peerCooldown = 0;
  /** Sentinels: seconds to their next call. Tremors: seconds to their next footfall thump. */
  private cadence: number;
  /** Ground sense re-targets at most this often. */
  private feltCooldown = 0;
  private prowlT = 0;
  private prowlAngle = 0;
  moving = 0;
  frill = 0.15;
  alert = 0;
  mandible = 0;
  readonly legs: Leg[];
  readonly traits: WardenTraits;
  /** Title-screen extra: it clicks and twitches but never hunts. */
  deaf = false;

  constructor(x: number, y: number, route: Vec2[], traits: WardenTraits, seed: number) {
    this.x = x;
    this.y = y;
    this.home = { x, y };
    this.route = route;
    this.traits = traits;
    this.rng = new Rng(seed);
    this.clickTimer = this.rng.range(0.5, 2.5);
    this.heading = this.rng.range(-Math.PI, Math.PI);
    this.cadence = this.rng.range(0.4, 1.6);
    this.state = route.length > 0 ? "patrol" : "idle";
    this.legs = LEG_DEFS.map((d) => {
      const [wx, wy] = this.toWorld(d.rest[0], d.rest[1]);
      return { fx: wx, fy: wy, fromX: wx, fromY: wy, toX: wx, toY: wy, t: -1, lift: 0 };
    });
  }

  hear(wave: Wave, sample: FieldSample, world: World): void {
    if (this.deaf || !wave.alerts || wave.source === this) return;
    const fromPeer = wave.source instanceof Warden;
    if (fromPeer) {
      // Creatures listen to each other only for alarm cries — and never in an endless echo.
      if (wave.kind !== "wardenAlert" || !this.traits.hearsAir || this.peerCooldown > 0) return;
    } else if (!this.traits.hearsAir && wave.kind !== "stone") {
      // Deaf to the air: only a stone striking the floor carries through the ground.
      return;
    }
    const reach = wave.loudness * (this.traits.hearBase + this.traits.hearBend * sample.e);
    if (sample.d > reach) return;
    let tx = wave.x;
    let ty = wave.y;
    if (fromPeer) {
      // Rally to where the caller was going, not to the caller itself.
      this.peerCooldown = this.traits.peerCooldown;
      const caller = wave.source as Warden;
      if (caller.target) {
        tx = caller.target.x;
        ty = caller.target.y;
      }
    }
    this.react(tx, ty, world, !fromPeer);
  }

  /** Something worth hunting happened at (x, y). Only first-hand detections raise a carrying alarm. */
  private react(x: number, y: number, world: World, raiseAlarm: boolean): void {
    const calm = this.state === "idle" || this.state === "patrol" || this.state === "return";
    this.alert = 1;
    if (calm) {
      this.state = "alert";
      this.stateT = this.traits.alertTime;
      this.shriek(world, raiseAlarm);
    } else if (this.state === "search" || this.state === "hunt") {
      this.state = this.traits.anchored ? "search" : "hunt";
      this.stateT = this.traits.anchored ? this.traits.searchTime : this.traits.giveUpAfter;
    }
    this.setTarget(x, y, world);
  }

  update(dt: number, world: World): void {
    this.stateT -= dt;
    this.peerCooldown = Math.max(0, this.peerCooldown - dt);
    this.feltCooldown = Math.max(0, this.feltCooldown - dt);
    this.feelGround(world);
    this.alert = Math.max(0, this.alert - dt * 0.25);
    const hunting = this.state === "alert" || this.state === "hunt";
    this.frill = damp(this.frill, hunting ? 1 : this.state === "search" ? 0.7 : 0.18, hunting ? 9 : 3, dt);
    this.mandible = damp(this.mandible, hunting ? 0.6 + Math.sin(world.time * 18) * 0.4 : 0.1, 8, dt);
    let speed = 0;

    switch (this.state) {
      case "idle":
        this.lookAround -= dt;
        if (this.lookAround <= 0) {
          this.lookAround = this.rng.range(2, 4.5);
          this.target = null;
        }
        this.heading = dampAngle(this.heading, this.heading + Math.sin(world.time * 0.6) * 0.3, 1, dt);
        if (this.route.length > 0 && this.stateT <= 0) this.beginPatrolLeg(world);
        break;
      case "patrol":
        speed = this.traits.patrolSpeed;
        if (this.followPath(dt, speed, world) || this.stateT < -this.legBudget) {
          this.state = "idle";
          this.stateT = 1.4;
        }
        break;
      case "alert":
        if (this.target) this.faceTowards(this.target.x, this.target.y, 7, dt);
        if (this.stateT <= 0) {
          // Anchored creatures cannot give chase: they stare, scream, and listen.
          this.state = this.traits.anchored ? "search" : "hunt";
          this.stateT = this.traits.anchored ? this.traits.searchTime : this.traits.giveUpAfter;
        }
        break;
      case "hunt":
        speed = this.traits.huntSpeed;
        // A closed door or a vanished route: stop and listen instead of pushing forever.
        if (this.followPath(dt, speed, world) || this.stateT <= 0) {
          this.state = "search";
          this.stateT = this.traits.searchTime;
        }
        break;
      case "search":
        if (this.traits.prowls && this.target) {
          // Circle the last place it heard something instead of standing still.
          speed = this.traits.patrolSpeed;
          this.prowlT -= dt;
          if (this.followPath(dt, speed, world) || this.prowlT <= 0) this.nextProwlPoint(world);
        } else if (this.traits.anchored && this.target) {
          this.faceTowards(this.target.x, this.target.y, 2.5, dt);
          this.heading += Math.sin(world.time * 1.6) * dt * 0.8;
        } else {
          this.heading += Math.sin(world.time * 2.2) * dt * 2.2;
        }
        if (this.stateT <= 0) this.returnHome(world);
        break;
      case "return":
        speed = this.traits.patrolSpeed;
        if (this.followPath(dt, speed, world) || this.stateT <= 0) {
          this.state = "idle";
          this.stateT = 1.2;
        }
        break;
    }

    // Only states that walk a path keep their stride; everyone else settles their legs.
    if (speed === 0) this.moving = damp(this.moving, 0, 8, dt);
    this.updateLegs(dt);
    this.updateVoice(dt, world);
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

  /** The alarm cry. Carries to other creatures only for pack hunters and sentinels. */
  private shriek(world: World, raiseAlarm: boolean): void {
    const loudness = raiseAlarm ? this.traits.cryLoudness : 0;
    world.emitSound({
      kind: "wardenAlert",
      x: this.x,
      y: this.y,
      radius: loudness > 0 ? 6 : 4.5,
      loudness,
      strength: 1,
      speed: 9,
      fade: 2,
      color: this.traits.kind === "chorus" ? COLORS.chorus : COLORS.wardenAlert,
      source: this,
      alerts: loudness > 0,
    });
    world.events.emit("wardenAlert", { x: this.x, y: this.y, creature: this.traits.kind });
  }

  /** How the creature sees: echolocation clicks, a sentinel's call, or a tremor's footfalls. */
  private updateVoice(dt: number, world: World): void {
    if (this.traits.pulsePeriod > 0) {
      this.cadence -= dt;
      if (this.cadence <= 0) {
        this.cadence = this.traits.pulsePeriod * this.rng.range(0.9, 1.1);
        world.emitSound({
          kind: "sentinel",
          x: this.x,
          y: this.y,
          radius: this.traits.pulseRadius,
          loudness: 0,
          strength: 0.85,
          speed: 7,
          fade: 2.4,
          color: COLORS.sentinel,
          source: this,
        });
        world.events.emit("sentinelCall", { x: this.x, y: this.y });
      }
      return;
    }
    if (!this.traits.hearsAir) {
      // Tremors never click: their heavy tread is the only thing that shows them.
      this.cadence -= dt * (this.moving > 0.2 ? 1 : 0.3);
      if (this.cadence <= 0) {
        this.cadence = 0.85;
        const walking = this.moving > 0.2;
        world.emitSound({
          kind: "tremor",
          x: this.x,
          y: this.y,
          radius: walking ? 2.3 : 1.5,
          loudness: 0,
          strength: walking ? 0.7 : 0.45,
          speed: 5,
          fade: 1.3,
          color: COLORS.tremor,
          source: this,
        });
        world.events.emit("tremorThump", { x: this.x, y: this.y });
      }
      return;
    }
    this.updateClicks(dt, world);
  }

  /** Tremors feel footfalls through the floor: sneaking, silt and muffling all soften them. */
  private feelGround(world: World): void {
    const range0 = this.traits.feelsSteps;
    if (range0 <= 0 || this.deaf || this.feltCooldown > 0) return;
    const p = world.player;
    if (p.dying || p.entering > 0 || p.muffled || Math.hypot(p.vx, p.vy) < 0.4) return;
    const tile = world.tileAtPos(p.x, p.y);
    let range = range0 * (1 - 0.6 * p.sneakAmt);
    if (tile === TILE.Water) range *= 1.4;
    if (tile === TILE.Silt) range *= 0.3;
    if (dist(p.x, p.y, this.x, this.y) > range) return;
    this.feltCooldown = 0.35;
    this.react(p.x, p.y, world, true);
  }

  private nextProwlPoint(world: World): void {
    const t = this.target!;
    this.prowlAngle += this.rng.range(0.9, 1.6);
    const r = this.rng.range(1.4, 2.8);
    const goal = nearestWalkable(
      world.walkGrid,
      Math.floor(t.x + Math.cos(this.prowlAngle) * r),
      Math.floor(t.y + Math.sin(this.prowlAngle) * r),
      2,
    );
    this.prowlT = 3.2;
    if (goal) this.planTo(goal.x, goal.y, world);
  }

  private updateClicks(dt: number, world: World): void {
    this.clickTimer -= dt;
    if (this.clickTimer > 0) return;
    const agitated = this.state !== "idle" && this.state !== "patrol";
    this.clickTimer = agitated ? this.rng.range(0.7, 1.1) : this.rng.range(1.8, 3.2);
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
    if (d < this.r + p.r + this.traits.catchSlack) p.kill("warden", world);
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
    // Long legs must be allowed to finish; only a leg that stalls well past its walking time is dropped.
    let length = 0;
    let from: Vec2 = this;
    for (const wp of this.path) {
      length += Math.hypot(wp.x - from.x, wp.y - from.y);
      from = wp;
    }
    this.legBudget = Math.max(this.traits.giveUpAfter * 2, (length / (this.traits.patrolSpeed * this.traits.speedMul)) * 1.5 + 4);
  }

  private returnHome(world: World): void {
    const stops = [this.home, ...this.route];
    const stop = stops[this.routeIdx % stops.length]!;
    this.planTo(Math.floor(stop.x), Math.floor(stop.y), world);
    this.state = "return";
    this.stateT = this.traits.giveUpAfter * 2;
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
    const v = speed * this.traits.speedMul * clamp(align, 0, 1) ** 2;
    const res = moveCircle(
      world.walkQuery,
      [],
      this.x,
      this.y,
      this.r * 0.7,
      Math.cos(this.heading) * v * dt,
      Math.sin(this.heading) * v * dt,
    );
    this.moving = damp(this.moving, v / STRIDE_SPEED, 8, dt);
    this.x = res.x;
    this.y = res.y;
    return false;
  }

  private updateLegs(dt: number): void {
    const vx = Math.cos(this.heading) * this.moving * STRIDE_SPEED;
    const vy = Math.sin(this.heading) * this.moving * STRIDE_SPEED;
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
