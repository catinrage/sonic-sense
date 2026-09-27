import { angleDiff, clamp, dampAngle, type RGB, type Vec2 } from "../core/math";
import { bestiaryStage, hearsCalls, STAGE_CENTRE, type BestiaryEntry } from "./bestiary";
import { callProfile } from "./calls";
import { STRIDE_SPEED, type Warden } from "./entities/warden";
import type { Stage } from "./game";
import { COLORS } from "./palette";
import type { World } from "./world";

/** Where on screen the creature should stand, and the room it has there (viewport fractions). */
export interface StageWindow {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

/** How a creature answers a call on its page. */
export type CallAnswer = "heard" | "unheard" | "echo" | "empty";

/** The round a creature walks on its stage, around the centre; it stops and listens at each point. */
const ROUND: readonly Vec2[] = [
  { x: -0.95, y: 0.15 },
  { x: 0.05, y: -0.4 },
  { x: 1.0, y: 0.05 },
  { x: 0.1, y: 0.45 },
];
/** Calls come from the dark below the creature, where whoever reads the page stands. */
const CALLER: Vec2 = { x: STAGE_CENTRE.x - 0.5, y: STAGE_CENTRE.y + 3.1 };
const CALL_CHARGE = 0.55;
const CALL_COOLDOWN = 0.7;
/** Seconds a creature that heard the call stares towards it. */
const STARE_TIME = 2.4;
/**
 * Soft light that shows the creature without anything hearing it, from either
 * side in turn: its sources sit out of frame (behind the page, past the edge).
 */
const LIGHTS: readonly Vec2[] = [
  { x: STAGE_CENTRE.x - 3.9, y: STAGE_CENTRE.y + 1.3 },
  { x: STAGE_CENTRE.x + 3.7, y: STAGE_CENTRE.y - 1.1 },
];
const LIGHT_COLOR: RGB = [0.52, 0.68, 1.0];
const LIGHT_PERIOD = 1.3;
/** Facing the reader, below. */
const REST_HEADING = Math.PI * 0.5;

/**
 * The bestiary's stage: one creature at a time, alive in a small round chamber
 * — walking its round, clicking, pulsing, thumping as it does in the dark —
 * lit softly, and framed beside its page. Calling to it shows how it answers.
 */
export class BestiaryShow {
  private world: World | null = null;
  private creature: Warden | null = null;
  private entry: BestiaryEntry | null = null;
  private leg = 0;
  private pauseT = 0;
  private lightT = 0;
  private lightSide = 0;
  private callT = 0;
  /** World time the last call reaches the creature (-1: none on its way), and until when it stares back. */
  private hearAt = -1;
  private stareUntil = -1;

  constructor(
    private readonly stage: Stage,
    private readonly aspect: () => number,
  ) {}

  /** Put a creature on stage — or, not heard yet (null), the chamber with nothing in it. */
  show(entry: BestiaryEntry | null, window: StageWindow): World {
    const world = this.stage.enterShowcase(bestiaryStage(entry?.id ?? null));
    this.world = world;
    this.entry = entry;
    this.creature = world.wardens[0] ?? null;
    // Unseen and unharmed, the creature of the game only anchors the camera and the ears.
    const p = world.player;
    p.invulnerable = true;
    p.fade = 1;
    p.x = STAGE_CENTRE.x;
    p.y = STAGE_CENTRE.y + (entry?.id === "mimic" ? 1 : 0);
    const w = this.creature;
    if (w) {
      w.deaf = true;
      w.heading = REST_HEADING;
    }
    this.leg = 0;
    this.pauseT = 0.9;
    this.callT = 0;
    this.hearAt = -1;
    this.stareUntil = -1;
    // Both lamps at once to begin with, so the creature is never first seen in the dark.
    this.lightSide = 1;
    this.lightT = LIGHT_PERIOD;
    this.lamp(world, LIGHTS[0]!);
    this.lamp(world, LIGHTS[1]!);
    this.stage.dangerEnabled = false;
    // A little brighter than the dark of the chapters: this is a place for looking.
    this.stage.post.exposure = 1.2;
    this.stage.post.fade = 0.8;
    this.frame(window, true);
    return world;
  }

  /** Take the stage down; the world it replaced comes back. */
  close(): World | null {
    if (!this.world) return null;
    this.world = null;
    this.creature = null;
    this.entry = null;
    return this.stage.leaveShowcase();
  }

  update(dt: number, window: StageWindow): void {
    const world = this.world;
    if (!world) return;
    this.callT = Math.max(0, this.callT - dt);
    this.frame(window, false);
    this.light(dt, world);
    this.hearCall(world);
    this.walk(dt, world);
    this.stage.update(dt);
    this.stage.post.fade = Math.max(0, this.stage.post.fade - dt * 2.4);
  }

  /** Call to it from the dark below. Null while the last call is still in the air. */
  call(): CallAnswer | null {
    const world = this.world;
    if (!world || this.callT > 0) return null;
    this.callT = CALL_COOLDOWN;
    const profile = callProfile(CALL_CHARGE);
    world.emitSound({ kind: "pulse", ...CALLER, ...profile, color: COLORS.pulse, source: world.player, alerts: true, hits: true });
    world.events.emit("pulse", { ...CALLER, charge: CALL_CHARGE, aim: null, note: null });
    const entry = this.entry;
    if (!entry) return "empty";
    if (entry.id === "mimic") return "echo";
    if (!hearsCalls(entry.id) || !this.creature) return "unheard";
    const w = this.creature;
    this.hearAt = world.time + Math.hypot(w.x - CALLER.x, w.y - CALLER.y) / profile.speed;
    return "heard";
  }

  /** Frame the creature in the middle of its window, large enough to see it whole as it walks. */
  private frame(window: StageWindow, snap: boolean): void {
    const p = this.world!.player;
    const aspect = this.aspect();
    const walks = this.creature !== null && !this.creature.traits.anchored;
    const needW = walks ? 4.1 : 3;
    const needH = walks ? 3.2 : 2.8;
    const view = clamp(Math.max(needH / Math.max(0.1, window.h), needW / Math.max(0.1, window.w * aspect)), 4, 12);
    const cx = STAGE_CENTRE.x - (window.cx - 0.5) * view * aspect;
    const cy = STAGE_CENTRE.y + 0.05 - (window.cy - 0.5) * view;
    this.stage.zoomOverride = view;
    this.stage.cameraOffset = { x: cx - p.x, y: cy - p.y };
    if (snap) this.stage.camera.snap(cx, cy);
  }

  private light(dt: number, world: World): void {
    this.lightT -= dt;
    if (this.lightT > 0) return;
    this.lightT = LIGHT_PERIOD;
    this.lightSide = 1 - this.lightSide;
    this.lamp(world, LIGHTS[this.lightSide]!);
  }

  private lamp(world: World, at: Vec2): void {
    // A drip's kind: nothing relays it, nothing hunts it.
    world.emitSound({ kind: "drip", ...at, radius: 9, loudness: 0, strength: 1, speed: 6, fade: 5.5, color: LIGHT_COLOR, source: null, glow: 0.72 });
  }

  /** The call arrives: a hunter flares and cries out, and stares at where it came from. */
  private hearCall(world: World): void {
    if (this.hearAt < 0 || world.time < this.hearAt) return;
    this.hearAt = -1;
    this.creature?.startle(world);
    this.stareUntil = world.time + STARE_TIME;
  }

  /** Walk the round, stopping at each point to listen; the rooted only turn. */
  private walk(dt: number, world: World): void {
    const w = this.creature;
    if (!w) return;
    const t = world.time;
    if (t < this.stareUntil || w.traits.anchored) {
      const staring = t < this.stareUntil;
      const face = staring ? Math.atan2(CALLER.y - w.y, CALLER.x - w.x) : REST_HEADING + Math.sin(t * 0.45) * 1.1;
      w.pose(w.x, w.y, dampAngle(w.heading, face, staring ? 8 : 1.4, dt), 0);
      if (staring) this.pauseT = Math.max(this.pauseT, 0.5);
      return;
    }
    const goal = { x: STAGE_CENTRE.x + ROUND[this.leg]!.x, y: STAGE_CENTRE.y + ROUND[this.leg]!.y };
    const toGoal = Math.atan2(goal.y - w.y, goal.x - w.x);
    if (this.pauseT > 0) {
      this.pauseT -= dt;
      // Stopped: it turns its head to listen, then towards where it goes next.
      const look = this.pauseT > 0.45 ? toGoal + Math.sin(t * 1.3) * 0.75 : toGoal;
      w.pose(w.x, w.y, dampAngle(w.heading, look, 2.6, dt), 0);
      return;
    }
    const d = Math.hypot(goal.x - w.x, goal.y - w.y);
    if (d < 0.08) {
      this.leg = (this.leg + 1) % ROUND.length;
      this.pauseT = 0.7 + ((this.leg * 0.61) % 1) * 1.3;
      return;
    }
    const heading = dampAngle(w.heading, toGoal, 5, dt);
    const align = Math.max(0, Math.cos(angleDiff(heading, toGoal)));
    const speed = w.traits.patrolSpeed * w.traits.speedMul * 0.85 * align * align * Math.min(1, 0.35 + d / 0.4);
    const step = Math.min(d, speed * dt);
    w.pose(w.x + Math.cos(heading) * step, w.y + Math.sin(heading) * step, heading, speed / STRIDE_SPEED);
  }
}
