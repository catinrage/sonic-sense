import { clamp, damp } from "../core/math";
import type { Input } from "../core/input";
import { LevelTextures } from "../render/level-textures";
import type { FrameView, PostParams, Renderer } from "../render/renderer";
import { BASE_VIEW_HEIGHT, Camera } from "./camera";
import { Effects } from "./effects";
import type { PlayerIntent } from "./entities/player";
import { parseLevel } from "./level-parser";
import type { LevelDef } from "./level-types";
import { Particles } from "./particles";
import { SceneBuilder } from "./scene-builder";
import { World } from "./world";

const IDLE_INTENT: PlayerIntent = {
  moveX: 0,
  moveY: 0,
  sneak: false,
  pulseHeld: false,
  pulseReleased: false,
  throwPressed: false,
  aimX: 0,
  aimY: 0,
};

/** Owns the live world, camera, effects and the per-frame render view. */
export class Stage {
  world!: World;
  readonly camera = new Camera();
  readonly particles = new Particles();
  private readonly builder = new SceneBuilder();
  private effects: Effects | null = null;
  private textures: LevelTextures | null = null;
  private seenSolidity = -1;
  private seenTiles = -1;
  readonly post: PostParams = {
    exposure: 1.0,
    bloom: 0.45,
    chromatic: 0.012,
    grain: 0.014,
    vignette: 0.85,
    fade: 1,
    danger: 0,
    heartbeat: 0,
    flash: [0, 0, 0, 0],
  };
  flashDecay = 3;
  /** Debug: force a view height (tiles). */
  zoomOverride: number | null = null;
  /** World-space offset of the camera target (title framing). */
  cameraOffset = { x: 0, y: 0 };
  shakeScale = 1;
  gentle = false;
  dangerEnabled = true;
  /** Where a thrown stone would land (shown when stones are in hand). */
  readonly aim = { x: 0, y: 0, alpha: 0, lastMove: -10 };

  constructor(
    private readonly renderer: Renderer,
    private readonly input: Input,
  ) {}

  load(def: LevelDef): World {
    this.effects?.dispose();
    this.particles.clear();
    const world = new World(parseLevel(def));
    this.world = world;
    this.effects = new Effects(world, this.particles, this.camera);
    this.textures?.dispose(this.renderer.gl);
    this.textures = new LevelTextures(this.renderer.gl, world);
    this.renderer.setLevel(this.textures);
    this.renderer.setDust(world.dustMotes());
    this.seenSolidity = world.solidityVersion;
    this.seenTiles = world.tilesVersion;
    this.camera.snap(world.player.x + this.cameraOffset.x, world.player.y + this.cameraOffset.y);
    this.camera.zoomTarget = BASE_VIEW_HEIGHT;
    this.camera.viewHeight = BASE_VIEW_HEIGHT;
    return world;
  }

  /** Map the input devices to what the creature wants to do this frame. */
  playerIntent(): PlayerIntent {
    const input = this.input;
    const move = input.moveVector();
    const aspect = this.renderer.width / Math.max(1, this.renderer.height);
    const aim = this.camera.screenToWorld(input.mouseX, input.mouseY, aspect);
    return {
      moveX: move.x,
      moveY: move.y,
      sneak: input.isDown("sneak"),
      pulseHeld: input.isDown("pulse"),
      pulseReleased: input.released("pulse"),
      throwPressed: input.pressed("throw"),
      aimX: input.mouseInside ? aim.x : this.world.player.x + Math.cos(this.world.player.facing) * 4,
      aimY: input.mouseInside ? aim.y : this.world.player.y + Math.sin(this.world.player.facing) * 4,
    };
  }

  update(dt: number, intent: PlayerIntent = IDLE_INTENT): void {
    const world = this.world;
    world.update(dt, intent);
    this.updateAim(dt, intent);
    this.effects?.update(dt);
    this.particles.update(dt);

    const p = world.player;
    const lookX = p.x + p.vx * 0.35 + this.cameraOffset.x;
    const lookY = p.y + p.vy * 0.35 + this.cameraOffset.y;
    this.camera.follow(lookX, lookY, dt, p.dying ? 1.5 : 4.5);
    this.camera.shakeScale = this.shakeScale;
    this.camera.zoomTarget = this.zoomOverride ?? BASE_VIEW_HEIGHT + p.charge * 1.6;
    if (this.zoomOverride) this.camera.viewHeight = this.zoomOverride;
    this.camera.update(dt);

    this.post.danger = damp(this.post.danger, this.dangerEnabled ? this.dangerLevel() : 0, 3, dt);
    this.post.heartbeat += dt * (4 + this.post.danger * 8);
    const f = this.post.flash;
    f[3] = Math.max(0, f[3] - dt * this.flashDecay);

    if (world.solidityVersion !== this.seenSolidity) {
      this.seenSolidity = world.solidityVersion;
      this.textures?.markSolidityDirty();
    } else if (world.tilesVersion !== this.seenTiles) {
      this.seenTiles = world.tilesVersion;
      this.textures?.markTilesDirty();
    }
  }

  private updateAim(dt: number, intent: PlayerIntent): void {
    const p = this.world.player;
    if (this.input.mouseMoved) this.aim.lastMove = this.world.time;
    const dx = intent.aimX - p.x;
    const dy = intent.aimY - p.y;
    const len = Math.hypot(dx, dy);
    const range = Math.min(Math.max(len, 1.2), 7.5);
    if (len > 1e-3) {
      this.aim.x = p.x + (dx / len) * range;
      this.aim.y = p.y + (dy / len) * range;
    }
    const recent = this.world.time - this.aim.lastMove < 2.5;
    const show = p.stones > 0 && !p.dying && this.input.mouseInside && recent;
    this.aim.alpha = damp(this.aim.alpha, show ? 1 : 0, 8, dt);
  }

  flash(r: number, g: number, b: number, amount: number, decay = 3): void {
    this.post.flash = [r, g, b, amount * (this.gentle ? 0.3 : 1)];
    this.flashDecay = decay;
  }

  /** Softer bloom/aberration for players sensitive to flashing light. */
  setGentle(gentle: boolean): void {
    this.gentle = gentle;
    this.post.bloom = gentle ? 0.28 : 0.45;
    this.post.chromatic = gentle ? 0 : 0.012;
  }

  render(dt: number): void {
    const world = this.world;
    const p = world.player;
    const view: FrameView = {
      time: world.time,
      dt,
      camera: this.camera.view(),
      waves: world.waves.waves,
      player: { x: p.x, y: p.y, charge: p.charge, alive: p.dying ? 0 : 1 },
      entities: this.builder.build(world, this.aim),
      particles: this.particles.batch(),
      post: this.post,
    };
    this.renderer.render(view);
  }

  /** 0..1 — how close the nearest hunting warden is. */
  private dangerLevel(): number {
    const world = this.world;
    const p = world.player;
    if (p.dying) return 0;
    let danger = 0;
    for (const w of world.wardens) {
      const d = Math.hypot(w.x - p.x, w.y - p.y);
      const hunting = w.state === "hunt" || w.state === "alert" ? 1 : 0.45;
      danger = Math.max(danger, clamp(1 - (d - 1) / 5, 0, 1) * hunting);
    }
    return danger;
  }
}
