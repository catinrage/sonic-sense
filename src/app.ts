import type { Input } from "./core/input";
import type { Renderer } from "./render/renderer";
import { Stage } from "./game/game";
import { ABILITY_INFO, abilityViews } from "./game/abilities";
import { CODEX_INFO } from "./game/codex";
import { callProfile } from "./game/calls";
import { ACT_NAMES, DIORAMAS, LEVELS, SHOWCASE } from "./game/levels";
import type { PlayerIntent } from "./game/entities/player";
import { MAX_STONES } from "./game/entities/player";
import { COLORS } from "./game/palette";
import type { World } from "./game/world";
import type { LevelDef, StartHint } from "./game/level-types";
import { AudioDirector } from "./audio/director";
import { UI, type ChapterInfo, type EndingContent, type LessonView, type SettingKey, type VolumeBus } from "./ui/ui";
import { chapterKit, chapterNews, type ChapterKit } from "./ui/lessons";
import { loadSave, persist, type SaveData } from "./save";
import { TITLE_CAMERA_OFFSET, TITLE_FACING } from "./game/title";
import type { Loader } from "./loader/loader";
import { BESTIARY, firstMet } from "./game/bestiary";
import { BestiaryShow } from "./game/bestiary-show";
import type { BestiaryPage } from "./ui/bestiary-view";

const MAX_DT = 1 / 20;
const DEATH_DELAY = 2.2;
const COMPLETE_DELAY = 2.6;
const ATTRACT_PERIOD = 3.6;
/** Matches the curtain's CSS fade. */
const CURTAIN_FADE_MS = 1600;

type Mode = "title" | "playing" | "paused" | "learning" | "dying" | "completing" | "ending" | "bestiary";

/** Seconds into a chapter before a newly granted ability is taught (as its card fades). */
const LESSON_DELAY = 3.4;

const FINAL_EPILOGUE: EndingContent = {
  eyebrow: "Epilogue",
  title: "Out of the Dark",
  text: "The Conductor falls still, and the Instrument sounds one last chord — every note you carried through the dark, ringing at once. The breath of the deep rushes past you, up towards a world that is loud and bright. You follow it into the light, and you will never again mistake silence for emptiness.",
  action: { label: "Return to title", id: "title" },
  interlude: false,
};

/** What the chapter card announces as new. */
function newsOf(def: LevelDef): string {
  const lines: string[] = [];
  if (def.grants?.length) lines.push(`New ability \u00b7 ${def.grants.map((g) => ABILITY_INFO[g].name).join(" \u00b7 ")}`);
  if (def.introduces?.length) lines.push(`New \u00b7 ${def.introduces.map((c) => CODEX_INFO[c].name).join(" \u00b7 ")}`);
  return lines.join("   ");
}

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
  /** What this chapter brings for the first time that has not been taught yet. */
  private lessons: LessonView[] = [];
  /** Lessons being read again (with H, or from the pause menu), and the mode to go back to. */
  private revisit: { from: "playing" | "paused"; lessons: LessonView[]; index: number } | null = null;
  private attract = { timer: 1.4, hold: 0, charge: 0 };
  private hudStones = -1;
  private hadStones = false;
  private toldNoStones = false;
  private last = 0;
  private running = false;
  private perf = { acc: 0, frames: 0, cooldown: 3 };
  private revealed = false;
  /** Shaders are built; the loading scene is sounding its last chord. */
  private revealing = false;
  private worldUnsub: (() => void)[] = [];
  /** The bestiary's stage, the menu it was opened from, and its pages as the player knows them. */
  private readonly bestiary: BestiaryShow;
  private bestiaryFrom: "title" | "paused" = "title";
  private bestiaryPages: BestiaryPage[] = [];
  /** Debug: every page of the bestiary open, as if every creature had been heard. */
  private knowAll = false;

  constructor(
    private readonly renderer: Renderer,
    private readonly input: Input,
    private readonly loader: Loader | null = null,
  ) {
    this.stage = new Stage(renderer, input);
    this.bestiary = new BestiaryShow(this.stage, () => renderer.width / Math.max(1, renderer.height));
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
      onLearned: () => this.learned(),
      onOpenLesson: (i) => this.readAgain(i),
      onLessonPage: (step) => this.pageLesson(step),
      onOpenBestiary: () => this.openBestiary(),
      onBestiaryPick: (i) => this.showCreature(i, true),
      onBestiaryCall: () => this.callCreature(),
      onBestiaryClose: () => this.closeBestiary(),
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

  /**
   * Keep the curtain (and the loading scene on it) up until every shader is
   * built; then let the scene sound its last chord and lift the curtain on the
   * same room, now drawn by the game.
   */
  private reveal(): boolean {
    if (this.revealed) return true;
    // The game stays still while the loading scene sounds its chord: it has the machine to itself.
    if (this.revealing) return false;
    const ready = this.renderer.ready;
    this.loader?.progress(this.renderer.buildStatus);
    if (!ready) return false;
    const open = () => {
      this.revealed = true;
      this.revealing = false;
      this.perf.cooldown = 2;
      this.ui.loading(false);
      this.ui.curtain(true);
      if (this.mode === "title") {
        // The same room is already there under the curtain, and the creature calls as it lifts.
        this.stage.post.fade = 0;
        this.attract.hold = 0.45;
        this.attract.timer = ATTRACT_PERIOD;
      }
      window.setTimeout(() => this.loader?.dispose(), CURTAIN_FADE_MS + 200);
    };
    if (!this.loader) {
      open();
      return true;
    }
    this.revealing = true;
    void this.loader.finish().then(open);
    return false;
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
      case "learning":
        break;
      case "bestiary":
        this.bestiary.update(dt, this.ui.bestiary.stageRect());
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
    if (this.lessons.length > 0 && this.levelTime >= LESSON_DELAY) {
      this.teach();
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
    this.stage.cameraOffset = { ...TITLE_CAMERA_OFFSET };
    this.stage.dangerEnabled = false;
    const world = this.loadWorld(SHOWCASE);
    world.player.invulnerable = true;
    world.player.facing = TITLE_FACING;
    for (const w of world.wardens) w.deaf = true;
    this.stage.post.fade = 1;
    this.attract = { timer: 1.2, hold: 0, charge: 0 };
    this.ui.showTitle(this.continueMeta());
    const pages = this.readBestiary();
    this.ui.setBestiaryMeta(`${pages.filter((p) => p.known).length} of ${pages.length}`);
  }

  private beginJourney(index: number): void {
    this.ui.hideEnding();
    this.audio.unlock();
    this.audio.ambience.start();
    this.ui.hideTitle();
    this.ui.hidePause();
    this.startLevel(Math.max(0, Math.min(index, LEVELS.length - 1)), true);
  }

  private startLevel(index: number, withCard: boolean, teach = withCard): void {
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
    this.ui.hideLesson();
    this.revisit = null;
    this.ui.showHud(def.chapter, def.title);
    this.ui.setLessonsKey(this.kit().lessons.length > 0);
    this.ui.setShards(0, world.shards.length);
    this.hudStones = -1;
    this.hadStones = (def.stones ?? 0) > 0;
    this.toldNoStones = false;
    if (withCard) this.ui.card(`Chapter ${def.chapter}`, def.title, def.tagline, newsOf(def));
    // Each new thing is taught on its own screen once the card fades; the chapter's own hints follow.
    this.lessons = teach ? chapterNews(def) : [];
    const after = this.lessons.length > 0 ? LESSON_DELAY : 0;
    this.pendingHints = withCard ? (def.startHints ?? []).map((h) => ({ ...h, at: (h.delay ?? 1) + after })) : [];
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
    this.ui.showPause(this.kit().rows);
    this.audio.core.setVolume("sfx", this.save.volumes.sfx * 0.4);
  }

  /** Everything the chapter is played with, as pause-menu rows and as their lessons. */
  private kit(): ChapterKit {
    const world = this.stage.world;
    return chapterKit(LEVELS[this.levelIndex]!, world.abilities, world.level);
  }

  /** Open a lesson again: row `index` of the pause menu's kit, or (null) the chapter's own news. */
  private readAgain(index: number | null): void {
    const from = this.mode;
    if (from !== "playing" && from !== "paused") return;
    const kit = this.kit();
    if (kit.lessons.length === 0) return;
    this.revisit = { from, lessons: kit.lessons, index: Math.min(index ?? kit.fresh, kit.lessons.length - 1) };
    this.mode = "learning";
    this.input.enabled = false;
    if (from === "playing") {
      this.ui.clearHints();
      this.audio.core.setVolume("sfx", this.save.volumes.sfx * 0.4);
    }
    this.showRevisit();
  }

  private showRevisit(): void {
    const r = this.revisit;
    if (r) this.ui.showLesson(r.lessons[r.index]!, { index: r.index, count: r.lessons.length });
  }

  private pageLesson(step: number): void {
    const r = this.revisit;
    if (!r || this.mode !== "learning" || r.lessons.length < 2) return;
    this.revisit = { ...r, index: (r.index + step + r.lessons.length) % r.lessons.length };
    this.audio.sfx.uiMove();
    this.showRevisit();
  }

  /** Freeze the chapter and teach the next new thing it brings. */
  private teach(): void {
    const lesson = this.lessons[0];
    if (lesson === undefined) return;
    this.mode = "learning";
    this.input.enabled = false;
    this.ui.clearHints();
    this.ui.showLesson(lesson);
    this.audio.core.setVolume("sfx", this.save.volumes.sfx * 0.4);
  }

  private learned(): void {
    if (this.mode !== "learning") return;
    this.ui.hideLesson();
    const again = this.revisit;
    if (again) {
      this.revisit = null;
      // Back to the pause menu it was opened from (still there, beneath), or straight back to the dark.
      if (again.from === "paused") this.mode = "paused";
      else this.backToPlay();
      return;
    }
    this.lessons.shift();
    if (this.lessons.length > 0) {
      this.teach();
      return;
    }
    this.backToPlay();
  }

  private resume(): void {
    if (this.mode !== "paused") return;
    this.ui.hidePause();
    this.backToPlay();
  }

  private backToPlay(): void {
    this.mode = "playing";
    this.input.enabled = true;
    this.audio.core.setVolume("sfx", this.save.volumes.sfx);
    document.getElementById("view")?.focus({ preventScroll: true });
  }

  private onKey = (e: KeyboardEvent): void => {
    // The UI consumes Escape itself when a menu is open (e.g. to resume).
    if (e.defaultPrevented || this.mode !== "playing") return;
    if (e.code === "KeyH" && !e.repeat) {
      e.preventDefault();
      this.readAgain(null);
    } else if (e.code === "Escape" || e.code === "KeyP") {
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

  // ------------------------------------------------------------ bestiary

  /** Every creature, known once the player has reached the chapter it is first heard in. */
  private readBestiary(): BestiaryPage[] {
    const met = firstMet();
    return BESTIARY.map((entry) => {
      const at = met.get(entry.id);
      const def = at === undefined ? undefined : LEVELS[at];
      const known = at !== undefined && (this.knowAll || at <= this.save.unlocked);
      return { entry, known, chapter: def ? { numeral: def.chapter, title: def.title } : null };
    });
  }

  private openBestiary(): void {
    if (this.mode !== "title" && this.mode !== "paused") return;
    this.bestiaryFrom = this.mode;
    this.mode = "bestiary";
    this.modeT = 0;
    this.bestiaryPages = this.readBestiary();
    // Open on the creature met most recently.
    const latest = this.bestiaryPages.reduce((at, p, i) => (p.known ? i : at), 0);
    this.ui.showBestiary(this.bestiaryPages, latest);
    this.audio.core.setVolume("sfx", this.save.volumes.sfx);
    this.showCreature(latest, false);
  }

  /** Turn to page `index`: its creature takes the stage. */
  private showCreature(index: number, picked: boolean): void {
    const page = this.bestiaryPages[index];
    if (this.mode !== "bestiary" || !page) return;
    if (picked) {
      this.audio.sfx.uiMove();
      this.ui.bestiary.select(index);
    }
    const world = this.bestiary.show(page.known ? page.entry : null, this.ui.bestiary.stageRect());
    this.audio.attach(world);
  }

  private callCreature(): void {
    const page = this.bestiaryPages[this.ui.bestiary.index];
    if (this.mode !== "bestiary" || !page) return;
    const answer = this.bestiary.call();
    if (answer === null) return;
    this.ui.bestiary.caption(answer === "empty" ? "Nothing answers. Not yet." : page.entry.heard);
  }

  private closeBestiary(): void {
    if (this.mode !== "bestiary") return;
    const world = this.bestiary.close();
    if (world) this.audio.attach(world);
    this.ui.hideBestiary();
    this.mode = this.bestiaryFrom;
    // The pause menu keeps the world's sounds low, as it did before.
    if (this.mode === "paused") this.audio.core.setVolume("sfx", this.save.volumes.sfx * 0.4);
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
    this.stage.world.events.emit("pulse", { x: p.x, y: p.y, charge, aim: null, note: null });
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

  debugLevel(index: number, withLessons = false): void {
    this.ui.hideTitle();
    this.startLevel(index, true, withLessons);
    this.stage.post.fade = 0;
  }

  /** Open the bestiary from the title on page `index`, every page known unless told otherwise. */
  debugBestiary(index: number, knowAll = true): void {
    this.knowAll = knowAll;
    if (this.mode !== "bestiary") this.openBestiary();
    this.bestiaryPages = this.readBestiary();
    this.ui.bestiary.render(this.bestiaryPages, index);
    this.showCreature(index, false);
  }

  debugPlayer(): { x: number; y: number } {
    const p = this.stage.world.player;
    return { x: p.x, y: p.y };
  }
}
