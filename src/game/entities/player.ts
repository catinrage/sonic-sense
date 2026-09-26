import { angleDiff, clamp, damp, dampAngle, type Vec2 } from "../../core/math";
import { fxRng } from "../../core/rng";
import { moveCircle } from "../collision";
import { TILE } from "../level-types";
import { callProfile, focusProfile } from "../calls";
import { COLORS } from "../palette";
import type { Wave } from "../waves";
import type { World } from "../world";

export interface PlayerIntent {
  moveX: number;
  moveY: number;
  sneak: boolean;
  pulseHeld: boolean;
  pulseReleased: boolean;
  throwPressed: boolean;
  aimX: number;
  aimY: number;
  /** Focus: charge a narrow, quiet call aimed at (aimX, aimY). */
  focusHeld: boolean;
  focusReleased: boolean;
  /** Muffle: silence the creature's footfalls for a few seconds. */
  mufflePressed: boolean;
}

/** No input at all. */
export const IDLE_INTENT: Readonly<PlayerIntent> = {
  moveX: 0,
  moveY: 0,
  sneak: false,
  pulseHeld: false,
  pulseReleased: false,
  throwPressed: false,
  aimX: 0,
  aimY: 0,
  focusHeld: false,
  focusReleased: false,
  mufflePressed: false,
};

export const MAX_STONES = 3;
/** How far (tiles) a creeping footfall carries to a listening hunter. */
export const SNEAK_LOUDNESS = 1.5;
/** Seconds of stillness before Deep Listen starts, and to reach full depth. */
const LISTEN_DELAY = 0.5;
const LISTEN_RISE = 1.2;
export const MUFFLE_TIME = 4;
/** Measured from activation, so it includes the muffled seconds. */
export const MUFFLE_COOLDOWN = 14;
const WALK_SPEED = 3.3;
const SNEAK_SPEED = 1.55;
const CHARGE_TIME = 1.15;
const PULSE_COOLDOWN = 0.32;

export class Player {
  readonly r = 0.26;
  x: number;
  y: number;
  z = 0;
  vx = 0;
  vy = 0;
  facing = 0;
  charge = 0;
  charging = false;
  /** Which call is charging: an ordinary one, or a focused beam. */
  chargeKind: "call" | "focus" = "call";
  /** Deep Listen depth: 0 .. 1 while the creature stands still and silent. */
  listen = 0;
  private stillFor = 0;
  /** Seconds of Muffle left, and until it can be used again. */
  muffleLeft = 0;
  muffleCooldown = 0;
  cooldown = 0;
  stones = 0;
  walkPhase = 0;
  walkAmt = 0;
  sneakAmt = 0;
  earL = 0;
  earR = 0;
  private earTargetL = 0;
  private earTargetR = 0;
  private earHold = 0;
  tailSway = 0;
  blink = 0;
  private blinkTimer = 2;
  private stepAccum = 0;
  private stepSide = 1;
  alive = true;
  dying: "pit" | "warden" | null = null;
  deathT = 0;
  fade = 0;
  spin = 0;
  entering = 0;
  /** Title-screen demo: the creature cannot die. */
  invulnerable = false;

  constructor(x: number, y: number, stones: number) {
    this.x = x;
    this.y = y;
    this.stones = stones;
  }

  /** Footfalls make no sound and no vibration (the Muffle ability). */
  get muffled(): boolean {
    return this.muffleLeft > 0;
  }

  update(dt: number, intent: PlayerIntent, world: World): void {
    this.animateIdle(dt, world.time);
    if (this.dying) {
      this.listen = 0;
      this.updateDeath(dt);
      return;
    }
    if (this.entering > 0) {
      this.entering = Math.max(0, this.entering - dt);
      this.fade = this.entering;
    }
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.updateMuffle(dt, intent, world);
    this.updateCharge(dt, intent, world);
    this.updateMovement(dt, intent, world);
    this.updateListen(dt, world);
    if (intent.throwPressed) this.tryThrow(intent, world);
    this.checkPit(world);
  }

  /** Ears swivel towards sounds the creature hears. */
  hear(wave: Wave): void {
    if (wave.source === this || this.dying) return;
    const rel = angleDiff(this.facing, Math.atan2(wave.y - this.y, wave.x - this.x));
    const swivel = clamp(rel * 0.35, -0.6, 0.6);
    this.earTargetL = rel < 0 ? swivel * 1.2 : swivel * 0.5;
    this.earTargetR = rel > 0 ? swivel * 1.2 : swivel * 0.5;
    this.earHold = 0.9;
  }

  kill(cause: "pit" | "warden", world: World): void {
    if (this.dying || this.invulnerable) return;
    this.dying = cause;
    this.deathT = 0;
    this.charging = false;
    this.charge = 0;
    world.events.emit("death", { cause, x: this.x, y: this.y });
  }

  private animateIdle(dt: number, time: number): void {
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blink = 1;
      this.blinkTimer = fxRng.range(1.8, 4.5);
    }
    this.blink = Math.max(0, this.blink - dt * 7);
    this.earHold = Math.max(0, this.earHold - dt);
    if (this.earHold <= 0) {
      this.earTargetL = Math.sin(time * 0.7) * 0.05;
      this.earTargetR = Math.sin(time * 0.9 + 1) * 0.05;
    }
    this.earL = damp(this.earL, this.earTargetL, 9, dt);
    this.earR = damp(this.earR, this.earTargetR, 9, dt);
    const sway = Math.sin(time * 1.7) * 0.35 + Math.sin(this.walkPhase * 0.5) * 0.6 * this.walkAmt;
    this.tailSway = damp(this.tailSway, sway, 6, dt);
  }

  private updateCharge(dt: number, intent: PlayerIntent, world: World): void {
    if (!this.charging && this.cooldown <= 0) {
      if (intent.pulseHeld) this.beginCharge("call");
      else if (intent.focusHeld && world.abilities.has("focus")) this.beginCharge("focus");
    }
    if (!this.charging) return;
    this.charge = Math.min(1, this.charge + dt / CHARGE_TIME);
    const held = this.chargeKind === "call" ? intent.pulseHeld && !intent.pulseReleased : intent.focusHeld && !intent.focusReleased;
    if (held) return;
    if (this.chargeKind === "focus") this.releaseFocus(world, intent);
    else this.releasePulse(world);
  }

  private beginCharge(kind: "call" | "focus"): void {
    this.charging = true;
    this.chargeKind = kind;
  }

  /** A focused call: a narrow beam towards the aim point, barely audible to creatures. */
  private releaseFocus(world: World, intent: PlayerIntent): void {
    const c = this.charge;
    this.charging = false;
    this.charge = 0;
    this.cooldown = PULSE_COOLDOWN;
    const aim = this.aimDirection(intent);
    this.facing = Math.atan2(aim.y, aim.x);
    const f = focusProfile(c);
    world.emitSound({
      kind: "pulse",
      x: this.x,
      y: this.y,
      radius: f.radius,
      loudness: f.loudness,
      strength: f.strength,
      speed: f.speed,
      fade: f.fade,
      color: COLORS.focus,
      source: this,
      alerts: true,
      hits: true,
      cone: { x: aim.x, y: aim.y, halfAngle: f.halfAngle },
    });
    world.events.emit("pulse", { x: this.x, y: this.y, charge: c, aim });
  }

  private aimDirection(intent: PlayerIntent): Vec2 {
    const dx = intent.aimX - this.x;
    const dy = intent.aimY - this.y;
    const len = Math.hypot(dx, dy);
    return len > 0.2 ? { x: dx / len, y: dy / len } : { x: Math.cos(this.facing), y: Math.sin(this.facing) };
  }

  /** Deep Listen deepens while the creature is still and silent, and breaks the moment it moves or calls. */
  private updateListen(dt: number, world: World): void {
    if (!world.abilities.has("deepListen")) {
      this.listen = 0;
      return;
    }
    const still = Math.hypot(this.vx, this.vy) < 0.15 && !this.charging;
    this.stillFor = still ? this.stillFor + dt : 0;
    this.listen = this.stillFor > LISTEN_DELAY ? Math.min(1, this.listen + dt / LISTEN_RISE) : Math.max(0, this.listen - dt * 4);
    if (this.listen > 0.5) {
      this.earTargetL = -0.35;
      this.earTargetR = 0.35;
      this.earHold = 0.2;
    }
  }

  private updateMuffle(dt: number, intent: PlayerIntent, world: World): void {
    this.muffleCooldown = Math.max(0, this.muffleCooldown - dt);
    if (this.muffleLeft > 0) {
      this.muffleLeft = Math.max(0, this.muffleLeft - dt);
      if (this.muffleLeft === 0) world.events.emit("muffle", { on: false, x: this.x, y: this.y });
    }
    if (!intent.mufflePressed || this.muffleCooldown > 0 || !world.abilities.has("muffle")) return;
    this.muffleLeft = MUFFLE_TIME;
    this.muffleCooldown = MUFFLE_COOLDOWN;
    world.events.emit("muffle", { on: true, x: this.x, y: this.y });
  }

  private releasePulse(world: World): void {
    const c = this.charge;
    this.charging = false;
    this.charge = 0;
    this.cooldown = PULSE_COOLDOWN;
    const call = callProfile(c);
    world.emitSound({
      kind: "pulse",
      x: this.x,
      y: this.y,
      radius: call.radius,
      loudness: call.loudness,
      strength: call.strength,
      speed: call.speed,
      fade: call.fade,
      color: COLORS.pulse,
      source: this,
      alerts: true,
      hits: true,
    });
    world.events.emit("pulse", { x: this.x, y: this.y, charge: c, aim: null });
  }

  private updateMovement(dt: number, intent: PlayerIntent, world: World): void {
    const sneaking = intent.sneak;
    this.sneakAmt = damp(this.sneakAmt, sneaking ? 1 : 0, 10, dt);
    let speed = sneaking ? SNEAK_SPEED : WALK_SPEED;
    if (this.charging) speed *= 0.55;
    const tx = intent.moveX * speed;
    const ty = intent.moveY * speed;
    const accel = Math.hypot(tx, ty) > 0.01 ? 16 : 11;
    this.vx = damp(this.vx, tx, accel, dt);
    this.vy = damp(this.vy, ty, accel, dt);

    const res = moveCircle(world.moveQuery, world.obstacles, this.x, this.y, this.r, this.vx * dt, this.vy * dt);
    const moved = Math.hypot(res.x - this.x, res.y - this.y);
    this.x = res.x;
    this.y = res.y;
    const actual = moved / Math.max(dt, 1e-6);

    if (actual > 0.2) this.facing = dampAngle(this.facing, Math.atan2(this.vy, this.vx), 12, dt);
    this.walkAmt = damp(this.walkAmt, clamp(actual / WALK_SPEED, 0, 1), 10, dt);
    this.walkPhase += actual * dt * (sneaking ? 7.5 : 6.2);

    this.stepAccum += moved;
    const stride = sneaking ? 0.5 : 0.6;
    if (this.stepAccum >= stride) {
      this.stepAccum -= stride;
      this.footstep(world, sneaking);
    }
  }

  private footstep(world: World, sneaking: boolean): void {
    this.stepSide = -this.stepSide;
    if (this.muffled) return;
    const side = this.stepSide * 0.1;
    const fx = this.x + Math.cos(this.facing + Math.PI / 2) * side;
    const fy = this.y + Math.sin(this.facing + Math.PI / 2) * side;
    const tile = world.tileAtPos(this.x, this.y);
    const water = tile === TILE.Water;
    const silt = tile === TILE.Silt;
    if (silt) {
      // Soft ground swallows the footfall: nothing hears it, and it shows almost nothing.
      world.emitSound({
        kind: "step",
        x: fx,
        y: fy,
        radius: 0.8,
        loudness: 0,
        strength: 0.14,
        speed: 3,
        fade: 0.6,
        color: COLORS.sneak,
        source: this,
      });
    } else if (water) {
      world.emitSound({
        kind: "splash",
        x: fx,
        y: fy,
        radius: 2.6,
        loudness: 5.5,
        strength: 0.6,
        speed: 6,
        fade: 1.4,
        color: COLORS.splash,
        source: this,
        alerts: true,
      });
    } else if (sneaking) {
      // Quiet, not silent: a hunter close enough to touch still hears it.
      world.emitSound({
        kind: "step",
        x: fx,
        y: fy,
        radius: 1.05,
        loudness: SNEAK_LOUDNESS,
        strength: 0.22,
        speed: 4,
        fade: 0.8,
        color: COLORS.sneak,
        source: this,
        alerts: true,
      });
    } else {
      world.emitSound({
        kind: "step",
        x: fx,
        y: fy,
        radius: 1.9,
        loudness: 3.4,
        strength: 0.42,
        speed: 6.5,
        fade: 1.1,
        color: COLORS.step,
        source: this,
        alerts: true,
      });
    }
    world.events.emit("step", { x: fx, y: fy, water, silt, sneak: sneaking });
  }

  private tryThrow(intent: PlayerIntent, world: World): void {
    if (this.stones <= 0) {
      world.events.emit("noStones", { x: this.x, y: this.y });
      return;
    }
    let dx = intent.aimX - this.x;
    let dy = intent.aimY - this.y;
    let len = Math.hypot(dx, dy);
    if (len < 0.5) {
      dx = Math.cos(this.facing);
      dy = Math.sin(this.facing);
      len = 1;
    }
    const range = clamp(len, 1.2, 7.5);
    this.stones--;
    world.throwStone(this.x, this.y, this.x + (dx / len) * range, this.y + (dy / len) * range);
    this.facing = Math.atan2(dy, dx);
  }

  private checkPit(world: World): void {
    const tx = Math.floor(this.x);
    const ty = Math.floor(this.y);
    if (world.tileAt(tx, ty) !== TILE.Pit) return;
    const fx = this.x - tx;
    const fy = this.y - ty;
    // Only fall once the body is clearly over the edge.
    const inset = 0.12;
    const edge = (open: boolean, f: number) => open || f > inset;
    const inside =
      edge(world.tileAt(tx - 1, ty) === TILE.Pit, fx) &&
      edge(world.tileAt(tx + 1, ty) === TILE.Pit, 1 - fx) &&
      edge(world.tileAt(tx, ty - 1) === TILE.Pit, fy) &&
      edge(world.tileAt(tx, ty + 1) === TILE.Pit, 1 - fy);
    if (inside) this.kill("pit", world);
  }

  private updateDeath(dt: number): void {
    this.deathT += dt;
    this.vx *= Math.exp(-dt * 3);
    this.vy *= Math.exp(-dt * 3);
    if (this.dying === "pit") {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.z = -Math.pow(this.deathT, 2) * 6;
      this.spin += dt * 5;
      this.fade = clamp((this.deathT - 0.5) / 0.7, 0, 1);
    } else {
      this.fade = clamp((this.deathT - 0.15) / 0.5, 0, 1);
    }
    this.walkAmt = damp(this.walkAmt, 0, 8, dt);
  }
}
