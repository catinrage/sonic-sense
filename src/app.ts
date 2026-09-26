import type { Input } from "./core/input";
import type { Renderer } from "./render/renderer";
import { Stage } from "./game/game";
import { ABILITY_INFO, abilityViews } from "./game/abilities";
import { callProfile } from "./game/calls";
import { ACT_NAMES, DIORAMAS, LEVELS, SHOWCASE } from "./game/levels";
import type { PlayerIntent } from "./game/entities/player";
import { MAX_STONES } from "./game/entities/player";
import { COLORS } from "./game/palette";
import type { World } from "./game/world";
import type { LevelDef, StartHint } from "./game/level-types";
import { AudioDirector } from "./audio/director";
import { UI, type ChapterInfo, type EndingContent, type SettingKey, type VolumeBus } from "./ui/ui";
import { loadSave, persist, type SaveData } from "./save";

const MAX_DT = 1 / 20;
const DEATH_DELAY = 2.2;
const COMPLETE_DELAY = 2.6;
const ATTRACT_PERIOD = 3.6;

type Mode = "title" | "playing" | "paused" | "dying" | "completing" | "ending";

const FINAL_EPILOGUE: EndingContent = {
  eyebrow: "Epilogue",
  title: "Out of the Dark",
  text: "The last Gate hums, and the breath of the deep rushes past you, up towards a world that is loud and bright — carrying every sound you ever made. You follow it into the light, and you will never again mistake silence for emptiness.",
  action: { label: "Return to title", id: "title" },
  interlude: false,
};

const DEATH_LINES: Record<"pit" | "warden", [string, string]> = {
  pit: ["The floor was not there", "Press R — or wait"],
  warden: ["It heard you", "Press R — or wait"],
};

/** Top-level controller: game modes, level flow, UI and audio wiring. */
export class App {
  readonly stage: Stage;
  readonly audio = new AudioDirector();
  readonly ui: UI;
  private readonly save: SaveData;
  mode: Mode = "title";
  private modeT = 0;
  private levelIndex = 0;
  private levelTime = 0;
  private pendingHints: (StartHint & { at: number })[] = [];
  private attract = { timer: 1.4, hold: 0, charge: 0 };
  private hudStones = -1;
  private hadStones = false;
  private toldNoStones = false;
  private last = 0;
  private running = false;
  private perf = { acc: 0, frames: 0, cooldown: 3 };
  private revealed = false;
  private worldUnsub: (() => void)[] = [];

  constructor(
    private readonly renderer: Renderer,
    private readonly input: Input,
  ) {
    this.stage = new Stage(renderer, input);
    this.save = loadSave();
    this.ui = new UI(document.getElementById("ui")!, {
      onPlay: () => this.beginJourney(0),
      onContinue: () => this.beginJourney(this.save.last),
      onChapter: (i) => this.beginJourney(i),
      onOpenChapters: () => this.ui.showChapters(this.chapterList(), ACT_NAMES),
      onOpenSettings: () => this.ui.showSettings({ volumes: this.save.volumes, shake: this.save.shake, gentle: this.save.gentle }),
      onResume: () => this.resume(),
      onRestart: () => this.restartLevel(true),
      onQuit: () => this.enterTitle(),
      onTitle: () => this.enterTitle(),
      onDescend: () => this.beginJourney(this.save.last),
      onVolume: (bus, v) => this.setVolume(bus, v),
      onSetting: (key, v) => this.setSetting(key, v),
      onUiSound: (kind) => (kind === "move" ? this.audio.sfx.uiMove() : this.audio.sfx.uiSelect()),
    });
    for (const bus of ["master", "sfx", "music"] as const) this.audio.core.setVolume(bus, this.save.volumes[bus]);
    this.stage.shakeScale = this.save.shake ? 1 : 0;
    this.stage.setGentle(this.save.gentle);

    const unlock = () => {
      this.audio.unlock();
      this.audio.ambience.start();
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    window.addEventListener("keydown", this.onKey);
    // Never let the hunt continue while the player is looking elsewhere.
    window.addEventListener("blur", () => this.pause());
    document.addEventListener("visibilitychange", () => document.hidden && this.pause());

    this.enterTitle();
    this.ui.loading(true);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  /** Called with a message when something unrecoverable happens (shader errors, lost context). */
  onFatal: (message: string) => void = () => {};

  /** Shaders are built and the first frame can be drawn. */
  get ready(): boolean {
    return this.renderer.ready;
  }

  private frame = (now: number): void => {
    const raw = Math.max(0, (now - this.last) / 1000);
    this.last = now;
    try {
      if (!this.reveal()) {
        requestAnimationFrame(this.frame);
        return;
      }
      this.adaptResolution(raw);
      this.tick(Math.min(MAX_DT, raw));
    } catch (err) {
      this.onFatal(err instanceof Error ? err.message : String(err));
      return;
    }
    requestAnimationFrame(this.frame);
  };

  /** Keep the curtain closed (with its loading note) until every shader is built. */
  private reveal(): boolean {
    if (this.revealed) return true;
    if (!this.renderer.ready) return false;
    this.revealed = true;
    this.perf.cooldown = 2;
    this.ui.loading(false);
    this.ui.curtain(true);
    return true;
  }

  /** Lower the internal resolution when frames run long; creep back up when there is headroom. */
  private adaptResolution(frameSeconds: number): void {
    const p = this.perf;
    // Ignore hidden-tab gaps; react at once to a single catastrophically slow frame.
    if (frameSeconds > 1) return;
    const r = this.renderer;
    if (frameSeconds > 0.12 && p.cooldown <= 0 && r.renderScale > 0.5) {
      r.renderScale = Math.max(0.5, r.renderScale - 0.2);
      p.cooldown = 2;
      p.acc = 0;
      p.frames = 0;
      return;
    }
    p.cooldown -= frameSeconds;
    p.acc += frameSeconds;
    p.frames++;
    if (p.acc < 1) return;
    const avg = p.acc / p.frames;
    p.acc = 0;
    p.frames = 0;
    if (p.cooldown > 0) return;
    if (avg > 0.024 && r.renderScale > 0.5) {
      r.renderScale = Math.max(0.5, r.renderScale - 0.1);
      p.cooldown = 4;
    } else if (avg < 0.0175 && r.renderScale < 1) {
      r.renderScale = Math.min(1, r.renderScale + 0.05);
      p.cooldown = 12;
    }
  }

  tick(dt: number): void {
    this.input.pollGamepad();
    this.update(dt);
    this.stage.render(dt);
    this.input.endFrame();
  }

  private update(dt: number): void {
    this.modeT += dt;
    switch (this.mode) {
      case "title":
      case "ending":
        this.stage.update(dt, this.attractIntent(dt));
        this.stage.post.fade = Math.max(0, this.stage.post.fade - dt * 0.8);
        break;
      case "playing":
        this.tickPlaying(dt);
        break;
      case "paused":
        break;
      case "dying":
        this.stage.update(dt);
        if (this.modeT > DEATH_DELAY) this.restartLevel(false);
        break;
      case "completing": {
        const p = this.stage.world.player;
        const exit = this.stage.world.exit;
        if (exit) {
          p.x += (exit.x - p.x) * Math.min(1, dt * 3);
          p.y += (exit.y - p.y) * Math.min(1, dt * 3);
        }
        p.fade = Math.min(1, this.modeT / 1.3);
        this.stage.update(dt);
        this.stage.post.fade = Math.min(1, Math.max(0, (this.modeT - 1.1) / (COMPLETE_DELAY - 1.1)));
        if (this.modeT > COMPLETE_DELAY) this.advance();
        break;
      }
    }
    this.audio.update(dt, this.mode === "playing" ? this.stage.post.danger : 0);
    this.ui.update(dt);
  }

  private tickPlaying(dt: number): void {
    this.levelTime += dt;
    this.stage.post.fade = Math.max(0, this.stage.post.fade - dt * 0.9);
    if (this.input.pressed("restart")) {
      this.restartLevel(false);
      return;
    }
    this.stage.update(dt, this.stage.playerIntent());
    for (let i = this.pendingHints.length - 1; i >= 0; i--) {
      const h = this.pendingHints[i]!;
      if (this.levelTime >= h.at) {
        this.ui.hint(h.text, h.duration);
        this.pendingHints.splice(i, 1);
      }
    }
    const p = this.stage.world.player;
    this.ui.setAbilities(abilityViews(this.stage.world.abilities, p));
    if (p.stones !== this.hudStones) {
      this.hudStones = p.stones;
      this.hadStones ||= p.stones > 0;
      this.ui.setStones(p.stones, MAX_STONES, this.hadStones || this.stage.world.piles.length > 0);
    }
  }

  // --------------------------------------------------------------- modes

  private enterTitle(): void {
    this.mode = "title";
    this.modeT = 0;
    this.input.enabled = false;
    this.audio.setScene("title");
    this.ui.hidePause();
    this.ui.clearMessage();
    this.ui.clearHints();
    this.stage.cameraOffset = { x: -2.6, y: 0.6 };
    this.stage.dangerEnabled = false;
    const world = this.loadWorld(SHOWCASE);
    world.player.invulnerable = true;
    world.player.facing = Math.PI * 0.12;
    for (const w of world.wardens) w.deaf = true;
    this.stage.post.fade = 1;
    this.attract = { timer: 1.2, hold: 0, charge: 0 };
    this.ui.showTitle(this.continueMeta());
  }

  private beginJourney(index: number): void {
    this.ui.hideEnding();
    this.audio.unlock();
    this.audio.ambience.start();
    this.ui.hideTitle();
    this.ui.hidePause();
    this.startLevel(Math.max(0, Math.min(index, LEVELS.length - 1)), true);
  }

  private startLevel(index: number, withCard: boolean): void {
    const def = LEVELS[index]!;
    this.levelIndex = index;
    this.mode = "playing";
    this.modeT = 0;
    this.audio.setScene("game");
    this.levelTime = 0;
    this.input.enabled = true;
    this.stage.cameraOffset = { x: 0, y: 0 };
    this.stage.dangerEnabled = true;
    const world = this.loadWorld(def);
    world.player.entering = 0.9;
    this.stage.post.fade = 1;
    this.ui.clearMessage();
    this.ui.clearHints();
    this.ui.showHud(def.chapter, def.title);
    this.ui.setShards(0, world.shards.length);
    this.hudStones = -1;
    this.hadStones = (def.stones ?? 0) > 0;
    this.toldNoStones = false;
    const granted = (def.grants ?? []).map((id) => ABILITY_INFO[id]);
    if (withCard) this.ui.card(`Chapter ${def.chapter}`, def.title, def.tagline, granted.map((g) => g.name).join(" \u00b7 "));
    const grantHints = granted.map((g, i) => ({ text: g.blurb, duration: 7, at: 4.5 + i * 7.5 }));
    this.pendingHints = withCard ? [...grantHints, ...(def.startHints ?? []).map((h) => ({ ...h, at: (h.delay ?? 1) + grantHints.length * 7.5 }))] : [];
    this.save.last = index;
    persist(this.save);
    document.getElementById("view")?.focus({ preventScroll: true });
  }

  private restartLevel(fromMenu: boolean): void {
    if (fromMenu) this.ui.hidePause();
    this.startLevel(this.levelIndex, false);
  }

  private advance(): void {
    const done = LEVELS[this.levelIndex]!;
    const next = this.levelIndex + 1;
    this.save.unlocked = Math.max(this.save.unlocked, Math.min(next, LEVELS.length - 1));
    if (next >= LEVELS.length) {
      this.save.last = 0;
      persist(this.save);
      this.enterEnding(FINAL_EPILOGUE);
      return;
    }
    this.save.last = next;
    persist(this.save);
    if (done.endsAct) {
      // The act is over: pause on its interlude before the descent continues.
      this.enterEnding({
        eyebrow: "Interlude",
        title: done.endsAct.title,
        text: done.endsAct.text,
        action: { label: done.endsAct.next, id: "descend" },
        interlude: true,
      });
      return;
    }
    this.startLevel(next, true);
  }

  private enterEnding(content: EndingContent): void {
    this.mode = "ending";
    this.modeT = 0;
    this.input.enabled = false;
    this.audio.setScene("title");
    this.ui.clearMessage();
    // Frame the creature below the epilogue text.
    this.stage.cameraOffset = { x: 0, y: -3.4 };
    this.stage.dangerEnabled = false;
    const world = this.loadWorld(SHOWCASE);
    world.player.invulnerable = true;
    for (const w of world.wardens) w.deaf = true;
    this.stage.post.fade = 1;
    this.ui.showEnding(content);
  }

  private pause(): void {
    if (this.mode !== "playing") return;
    this.mode = "paused";
    this.input.enabled = false;
    this.ui.showPause();
    this.audio.core.setVolume("sfx", this.save.volumes.sfx * 0.4);
  }

  private resume(): void {
    if (this.mode !== "paused") return;
    this.mode = "playing";
    this.input.enabled = true;
    this.ui.hidePause();
    this.audio.core.setVolume("sfx", this.save.volumes.sfx);
    document.getElementById("view")?.focus({ preventScroll: true });
  }

  private onKey = (e: KeyboardEvent): void => {
    // The UI consumes Escape itself when a menu is open (e.g. to resume).
    if (e.defaultPrevented || (e.code !== "Escape" && e.code !== "KeyP")) return;
    if (this.mode === "playing") {
      e.preventDefault();
      this.pause();
    }
  };

  // --------------------------------------------------------------- world

  private loadWorld(def: LevelDef): World {
    for (const off of this.worldUnsub) off();
    const world = this.stage.load(def);
    this.audio.attach(world);
    const ev = world.events;
    this.worldUnsub = [
      ev.on("hint", (e) => this.ui.hint(e.text)),
      ev.on("shard", (e) => {
        this.ui.setShards(e.got, e.total);
        if (e.got === e.total) this.ui.hint("The Gate stirs. Its hum grows warm and bright.", 4.5);
      }),
      ev.on("exitAwake", () => this.stage.flash(1, 0.75, 0.4, 0.35, 2)),
      ev.on("noStones", () => {
        if (this.toldNoStones) return;
        this.toldNoStones = true;
        this.ui.hint("Your paws are empty. Stones rest in small cairns — or where they last fell.", 4);
      }),
      ev.on("death", (e) => this.onDeath(e.cause)),
      ev.on("complete", () => this.onComplete()),
    ];
    return world;
  }

  private onDeath(cause: "pit" | "warden"): void {
    if (this.mode !== "playing") return;
    this.mode = "dying";
    this.modeT = 0;
    this.input.enabled = true;
    if (cause === "warden") this.stage.flash(1, 0.05, 0.08, 0.9, 1.6);
    else this.stage.flash(0.2, 0.6, 1, 0.25, 1.2);
    const [title, sub] = DEATH_LINES[cause];
    this.ui.message("death", title, sub);
  }

  private onComplete(): void {
    if (this.mode !== "playing") return;
    this.mode = "completing";
    this.modeT = 0;
    this.input.enabled = false;
    this.stage.world.player.entering = 0;
    this.stage.flash(1, 0.8, 0.45, 0.6, 1.2);
    this.ui.message("win", "The echo carries on", LEVELS[this.levelIndex + 1] ? "" : "The last gate");
  }

  /** Title-screen demo: the creature calls into the dark on its own. */
  private attractIntent(dt: number): PlayerIntent {
    const a = this.attract;
    const intent = this.stage.playerIntent();
    const base: PlayerIntent = { ...intent, moveX: 0, moveY: 0, sneak: false, throwPressed: false, pulseHeld: false, pulseReleased: false };
    if (a.hold > 0) {
      a.hold -= dt;
      return { ...base, pulseHeld: a.hold > 0, pulseReleased: a.hold <= 0 };
    }
    a.timer -= dt;
    if (a.timer <= 0) {
      a.timer = ATTRACT_PERIOD + Math.random() * 1.5;
      a.charge = 0.35 + Math.random() * 0.65;
      a.hold = a.charge * 1.15;
    }
    return base;
  }

  // ------------------------------------------------------------ settings

  private setVolume(bus: VolumeBus, value: number): void {
    this.save.volumes[bus] = value;
    this.audio.core.setVolume(bus, value);
    persist(this.save);
  }

  private setSetting(key: SettingKey, value: boolean): void {
    this.save[key] = value;
    if (key === "shake") this.stage.shakeScale = value ? 1 : 0;
    if (key === "gentle") this.stage.setGentle(value);
    persist(this.save);
  }

  private continueMeta(): string | null {
    if (this.save.last <= 0 && this.save.unlocked <= 0) return null;
    const def = LEVELS[this.save.last] ?? LEVELS[0]!;
    return `Chapter ${def.chapter}`;
  }

  private chapterList(): ChapterInfo[] {
    return LEVELS.map((l, i) => ({
      numeral: l.chapter,
      title: l.title,
      tagline: l.tagline,
      unlocked: i <= this.save.unlocked,
      act: l.act ?? 1,
    }));
  }

  // ------------------------------------------------------------ debug API

  /** Advance the whole app deterministically (optionally forcing player input), then render one frame. */
  debugStep(seconds: number, fps = 60, intent?: Partial<PlayerIntent>): void {
    this.reveal();
    const frames = Math.max(1, Math.round(seconds * fps));
    const intentFn = this.stage.playerIntent.bind(this.stage);
    if (intent) this.stage.playerIntent = () => ({ ...intentFn(), ...intent });
    try {
      for (let i = 0; i < frames; i++) this.update(1 / fps);
    } finally {
      if (intent) this.stage.playerIntent = intentFn;
    }
    this.stage.render(1 / fps);
  }

  debugPulse(charge = 0.5): void {
    const p = this.stage.world.player;
    this.stage.world.emitSound({
      kind: "pulse",
      x: p.x,
      y: p.y,
      ...callProfile(charge),
      color: COLORS.pulse,
      source: p,
      alerts: true,
      hits: true,
    });
    this.stage.world.events.emit("pulse", { x: p.x, y: p.y, charge, aim: null });
  }

  /** Teleport the player and camera for close-up inspection. */
  debugFocus(x: number, y: number, zoom: number | null = null): void {
    const p = this.stage.world.player;
    p.x = x;
    p.y = y;
    this.stage.camera.snap(x, y);
    this.stage.zoomOverride = zoom;
  }

  /** Load a non-campaign diorama (see DIORAMAS) with an invulnerable player. */
  debugDiorama(id: string): void {
    const def = DIORAMAS[id];
    if (!def) throw new Error(`Unknown diorama "${id}"`);
    this.ui.hideTitle();
    this.mode = "playing";
    this.input.enabled = true;
    this.stage.cameraOffset = { x: 0, y: 0 };
    const world = this.loadWorld(def);
    world.player.invulnerable = true;
    this.stage.post.fade = 0;
  }

  debugLevel(index: number): void {
    this.ui.hideTitle();
    this.startLevel(index, true);
    this.stage.post.fade = 0;
  }

  debugPlayer(): { x: number; y: number } {
    const p = this.stage.world.player;
    return { x: p.x, y: p.y };
  }
}
