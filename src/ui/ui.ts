import type { AbilityView } from "../game/abilities";

export type VolumeBus = "master" | "sfx" | "music";
export type SettingKey = "shake" | "gentle";

export interface UIHandlers {
  onPlay(): void;
  onContinue(): void;
  onChapter(index: number): void;
  onOpenChapters(): void;
  onOpenSettings(): void;
  onResume(): void;
  onRestart(): void;
  onQuit(): void;
  onTitle(): void;
  /** Continue past an act's interlude into the next chapter. */
  onDescend(): void;
  /** The player has read a lesson screen. */
  onLearned(): void;
  onVolume(bus: VolumeBus, value: number): void;
  onSetting(key: SettingKey, value: boolean): void;
  onUiSound(kind: "move" | "select"): void;
}

export interface ChapterInfo {
  numeral: string;
  title: string;
  tagline: string;
  unlocked: boolean;
  act: number;
}

/** Content of the closing screen: an act interlude or the final epilogue. */
export interface EndingContent {
  eyebrow: string;
  title: string;
  text: string;
  action: { label: string; id: "title" | "descend" };
  /** Interludes lead further down: cold palette instead of the golden epilogue. */
  interlude: boolean;
}

/** A lesson screen: a new ability, or a device or creature of the Instrument. */
export interface LessonView {
  eyebrow: string;
  /** Inner SVG markup of its 64×64 glyph. */
  glyph: string;
  title: string;
  /** What to do. [Key] tokens render as keycaps. */
  use: string;
  does: string;
  tip: string;
}

/** A row of the pause menu's list of what the chapter is played with. */
export interface KitRow {
  name: string;
  /** Key that uses it, or "" to show `tag` instead. */
  key: string;
  tag: string;
  blurb: string;
}

export interface SettingsState {
  volumes: Record<VolumeBus, number>;
  shake: boolean;
  gentle: boolean;
}

const PANELS = ["title", "chapters", "settings", "pause", "ending", "ability"] as const;
type Panel = (typeof PANELS)[number];



const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Hint text supports [Key] tokens rendered as keycaps. */
export const formatHint = (text: string): string => escapeHtml(text).replace(/\[([^\]]+)\]/g, "<kbd>$1</kbd>");


/** DOM overlay: menus, HUD, chapter cards and messages. */
export class UI {
  private readonly el: Record<string, HTMLElement> = {};
  private readonly binds = new Map<string, HTMLElement>();
  private panelStack: Panel[] = [];
  private hintTimer = 0;
  private cardTimer = 0;
  private hintQueue: { text: string; duration: number }[] = [];

  constructor(
    private readonly root: HTMLElement,
    private readonly handlers: UIHandlers,
  ) {
    for (const id of ["title", "chapters", "settings", "hud", "card", "message", "pause", "ending", "ability", "curtain"]) {
      const node = document.getElementById(id);
      if (!node) throw new Error(`UI: missing #${id}`);
      this.el[id] = node;
    }
    root.querySelectorAll<HTMLElement>("[data-bind]").forEach((n) => this.binds.set(n.dataset.bind!, n));
    root.addEventListener("click", this.onClick);
    root.addEventListener("mouseover", this.onHover);
    root.querySelectorAll<HTMLInputElement>("input[data-volume]").forEach((input) => {
      input.addEventListener("input", () => {
        this.paintSlider(input);
        this.handlers.onVolume(input.dataset.volume as VolumeBus, Number(input.value) / 100);
      });
    });
    root.querySelectorAll<HTMLInputElement>("input[data-setting]").forEach((input) => {
      input.addEventListener("change", () => this.handlers.onSetting(input.dataset.setting as SettingKey, input.checked));
    });
    window.addEventListener("keydown", this.onKey);
  }

  /** True while any menu panel has focus (gameplay input should pause). */
  get menuOpen(): boolean {
    return this.panelStack.length > 0;
  }

  get topPanel(): Panel | null {
    return this.panelStack[this.panelStack.length - 1] ?? null;
  }

  // ------------------------------------------------------------- screens

  showTitle(continueMeta: string | null): void {
    this.panelStack = ["title"];
    const title = this.el.title!;
    title.hidden = false;
    title.classList.remove("is-leaving");
    const cont = title.querySelector<HTMLElement>('[data-action="continue"]')!;
    const begin = title.querySelector<HTMLElement>('[data-action="play"]')!;
    cont.hidden = continueMeta === null;
    this.bind("continue-meta").textContent = continueMeta ?? "";
    begin.querySelector(".menu-label")!.textContent = continueMeta === null ? "Begin" : "New journey";
    this.hideHud();
    this.el.ending!.hidden = true;
    this.focusFirst(title);
  }

  hideTitle(): void {
    const title = this.el.title!;
    title.classList.add("is-leaving");
    this.panelStack = this.panelStack.filter((p) => p !== "title");
    window.setTimeout(() => {
      if (title.classList.contains("is-leaving")) title.hidden = true;
    }, 1300);
  }

  showChapters(chapters: readonly ChapterInfo[], actNames: Readonly<Record<number, string>>): void {
    const acts = [...new Set(chapters.map((c) => c.act))].sort((a, b) => a - b);
    this.bind("chapter-acts").replaceChildren(
      ...acts.map((act) => {
        const section = document.createElement("section");
        section.className = "chapter-act";
        const label = document.createElement("p");
        label.className = "act-label";
        label.textContent = `Act ${"I".repeat(act)} · ${actNames[act] ?? ""}`;
        const grid = document.createElement("div");
        grid.className = "chapter-grid";
        grid.replaceChildren(
          ...chapters.flatMap((c, i) => {
            if (c.act !== act) return [];
            const b = document.createElement("button");
            b.className = "chapter";
            b.disabled = !c.unlocked;
            b.dataset.chapter = String(i);
            b.innerHTML = `<span class="chapter-numeral">${escapeHtml(c.numeral)}</span><span class="chapter-title">${escapeHtml(
              c.unlocked ? c.title : "Unheard",
            )}</span><span class="chapter-tag">${escapeHtml(c.unlocked ? c.tagline : "Reach it to listen.")}</span>`;
            return [b];
          }),
        );
        section.append(label, grid);
        return section;
      }),
    );
    this.openPanel("chapters");
  }

  showSettings(state: SettingsState): void {
    this.root.querySelectorAll<HTMLInputElement>("input[data-volume]").forEach((input) => {
      input.value = String(Math.round(state.volumes[input.dataset.volume as VolumeBus] * 100));
      this.paintSlider(input);
    });
    this.root.querySelectorAll<HTMLInputElement>("input[data-setting]").forEach((input) => {
      input.checked = state[input.dataset.setting as SettingKey];
    });
    this.openPanel("settings");
  }

  /** Pause, listing the abilities this chapter is played with so they can be re-read. */
  showPause(kit: readonly KitRow[] = []): void {
    const box = this.bind("pause-kit");
    box.hidden = kit.length === 0;
    box.replaceChildren(
      ...kit.map((a) => {
        const row = document.createElement("div");
        row.className = "kit-row";
        row.innerHTML = `<p class="kit-name">${a.key ? `<kbd>${escapeHtml(a.key)}</kbd>` : `<span class="ability-trigger">${escapeHtml(a.tag)}</span>`}${escapeHtml(a.name)}</p><p class="kit-blurb">${escapeHtml(a.blurb)}</p>`;
        return row;
      }),
    );
    this.openPanel("pause");
  }

  /** Teach something new on its own screen; the chapter waits until it is dismissed. */
  showLesson(view: LessonView): void {
    this.bind("ability-eyebrow").textContent = view.eyebrow;
    this.bind("ability-glyph").innerHTML = `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">${view.glyph}</svg>`;
    this.bind("ability-title").textContent = view.title;
    this.bind("ability-use").innerHTML = formatHint(view.use);
    this.bind("ability-does").textContent = view.does;
    this.bind("ability-tip").textContent = view.tip;
    this.el.card!.hidden = true;
    this.cardTimer = 0;
    this.openPanel("ability");
  }

  hideLesson(): void {
    this.el.ability!.hidden = true;
    this.panelStack = this.panelStack.filter((p) => p !== "ability");
  }

  hidePause(): void {
    this.panelStack = this.panelStack.filter((p) => p !== "pause" && p !== "settings");
    this.el.pause!.hidden = true;
    this.el.settings!.hidden = true;
  }

  showEnding(content: EndingContent): void {
    this.hideHud();
    for (const id of ["title", "chapters", "settings", "pause", "card", "message", "ability"]) this.el[id]!.hidden = true;
    this.bind("ending-eyebrow").textContent = content.eyebrow;
    this.bind("ending-title").textContent = content.title;
    this.bind("ending-text").textContent = content.text;
    this.bind("ending-action").dataset.action = content.action.id;
    this.bind("ending-action-label").textContent = content.action.label;
    this.el.ending!.classList.toggle("is-interlude", content.interlude);
    this.panelStack = ["ending"];
    this.el.ending!.hidden = false;
    this.focusFirst(this.el.ending!);
  }

  hideEnding(): void {
    this.el.ending!.hidden = true;
    this.panelStack = this.panelStack.filter((p) => p !== "ending");
  }

  // ----------------------------------------------------------------- hud

  showHud(numeral: string, title: string): void {
    this.bind("hud-numeral").textContent = numeral;
    this.bind("hud-title").textContent = title;
    this.el.hud!.hidden = false;
  }

  hideHud(): void {
    this.el.hud!.hidden = true;
    this.hintQueue = [];
    this.bind("hud-hint").classList.remove("is-visible");
  }

  setShards(got: number, total: number): void {
    const box = this.bind("hud-shards");
    if (box.childElementCount !== total) {
      box.replaceChildren(
        ...Array.from({ length: total }, () => {
          const s = document.createElement("span");
          s.className = "shard-icon";
          return s;
        }),
      );
    }
    [...box.children].forEach((c, i) => c.classList.toggle("is-lit", i < got));
  }

  setStones(held: number, max: number, visible: boolean): void {
    const box = this.bind("hud-stones");
    box.hidden = !visible;
    if (box.childElementCount !== max) {
      box.replaceChildren(
        ...Array.from({ length: max }, () => {
          const s = document.createElement("span");
          s.className = "stone-icon";
          return s;
        }),
      );
    }
    [...box.children].forEach((c, i) => c.classList.toggle("is-held", i < held));
  }

  /** Queue a hint line; hints show one at a time. */
  hint(text: string, duration = 5.5): void {
    this.hintQueue.push({ text, duration });
    if (this.hintTimer <= 0) this.nextHint();
  }

  clearHints(): void {
    this.hintQueue = [];
    this.hintTimer = 0;
    this.bind("hud-hint").classList.remove("is-visible");
  }

  /** Show a chapter card; `grant` names an ability the chapter gives, announced beneath. */
  /** The chapter card; `news` names what the chapter brings for the first time. */
  card(chapter: string, title: string, tagline: string, news = ""): void {
    const card = this.el.card!;
    this.bind("card-chapter").textContent = chapter;
    this.bind("card-title").textContent = title;
    this.bind("card-tagline").textContent = tagline;
    const newsLine = this.bind("card-grant");
    newsLine.textContent = news;
    newsLine.hidden = !news;
    card.hidden = false;
    card.classList.remove("is-visible");
    void card.offsetWidth;
    card.classList.add("is-visible");
    this.cardTimer = news ? 5.8 : 3.8;
  }

  /** The ability strip under the inventory: key, name and a readiness bar per ability. */
  setAbilities(views: readonly AbilityView[]): void {
    const box = this.bind("hud-abilities");
    box.hidden = views.length === 0;
    const ids = views.map((v) => v.id).join(",");
    if (box.dataset.ids !== ids) {
      box.dataset.ids = ids;
      box.replaceChildren(
        ...views.map((v) => {
          const chip = document.createElement("span");
          chip.className = "ability";
          if (v.key) {
            const key = document.createElement("kbd");
            key.textContent = v.key;
            chip.append(key);
          } else if (v.trigger) {
            const trigger = document.createElement("span");
            trigger.className = "ability-trigger";
            trigger.textContent = v.trigger;
            chip.append(trigger);
          }
          const name = document.createElement("span");
          name.className = "ability-name";
          name.textContent = v.name;
          chip.append(name);
          return chip;
        }),
      );
    }
    views.forEach((v, i) => {
      const chip = box.children[i] as HTMLElement;
      chip.classList.toggle("is-active", v.active);
      chip.classList.toggle("is-cooling", !v.active && v.fill < 0.999);
      chip.style.setProperty("--fill", v.fill.toFixed(3));
    });
  }

  message(kind: "death" | "win", title: string, sub: string): void {
    const m = this.el.message!;
    m.classList.toggle("is-death", kind === "death");
    m.classList.toggle("is-win", kind === "win");
    this.bind("message-title").textContent = title;
    this.bind("message-sub").textContent = sub;
    m.hidden = false;
    m.style.animation = "none";
    void m.offsetWidth;
    m.style.animation = "";
  }

  clearMessage(): void {
    this.el.message!.hidden = true;
  }

  /** Loading note shown on the curtain while shaders build. */
  loading(on: boolean): void {
    this.el.curtain!.classList.toggle("is-loading", on);
  }

  curtain(open: boolean): void {
    this.el.curtain!.classList.toggle("is-open", open);
  }

  update(dt: number): void {
    this.syncCovered();
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0.5 && this.hintTimer + dt > 0.5) this.bind("hud-hint").classList.remove("is-visible");
      if (this.hintTimer <= 0) this.nextHint();
    }
    if (this.cardTimer > 0) {
      this.cardTimer -= dt;
      if (this.cardTimer <= 0) this.el.card!.hidden = true;
    }
  }

  // ------------------------------------------------------------- internals

  private nextHint(): void {
    const next = this.hintQueue.shift();
    const hint = this.bind("hud-hint");
    if (!next) {
      hint.classList.remove("is-visible");
      this.hintTimer = 0;
      return;
    }
    hint.innerHTML = formatHint(next.text);
    hint.classList.add("is-visible");
    this.hintTimer = next.duration;
  }

  /** Only the top menu panel shows; the ones it was opened from wait, hidden, beneath it. */
  private syncCovered(): void {
    const top = this.topPanel;
    for (const p of PANELS) this.el[p]!.classList.toggle("is-covered", p !== top && this.panelStack.includes(p));
  }

  private openPanel(panel: Panel): void {
    const node = this.el[panel]!;
    node.hidden = false;
    if (this.topPanel !== panel) this.panelStack.push(panel);
    // Stack by depth, not page order: Sound & Sight opened from the pause menu must sit above it.
    node.style.zIndex = String(this.panelStack.indexOf(panel) + 1);
    this.focusFirst(node);
  }

  private back(): void {
    const top = this.panelStack.pop();
    if (!top) return;
    if (top === "pause") {
      this.panelStack.push("pause");
      this.handlers.onResume();
      return;
    }
    if (top === "ability") {
      this.panelStack.push("ability");
      this.handlers.onLearned();
      return;
    }
    if (top === "title" || top === "ending") {
      this.panelStack.push(top);
      return;
    }
    this.el[top]!.hidden = true;
    const under = this.topPanel;
    if (under) this.focusFirst(this.el[under]!);
  }

  private bind(name: string): HTMLElement {
    const n = this.binds.get(name);
    if (!n) throw new Error(`UI: missing [data-bind="${name}"]`);
    return n;
  }

  private focusables(container: HTMLElement): HTMLElement[] {
    return [...container.querySelectorAll<HTMLElement>("button, input")].filter(
      (n) => !n.hidden && !(n as HTMLButtonElement).disabled && n.offsetParent !== null,
    );
  }

  private focusFirst(container: HTMLElement): void {
    requestAnimationFrame(() => this.focusables(container)[0]?.focus({ preventScroll: true }));
  }

  private onKey = (e: KeyboardEvent): void => {
    const top = this.topPanel;
    if (!top) return;
    if (e.code === "Escape" || (e.code === "KeyP" && top === "pause")) {
      e.preventDefault();
      this.back();
      return;
    }
    const vertical = e.code === "ArrowDown" || e.code === "ArrowUp" || e.code === "KeyS" || e.code === "KeyW";
    const horizontal = e.code === "ArrowRight" || e.code === "ArrowLeft";
    if (!vertical && !(horizontal && top === "chapters")) return;
    const active = document.activeElement as HTMLElement | null;
    if (active instanceof HTMLInputElement && active.type === "range" && horizontal) return;
    const items = this.focusables(this.el[top]!);
    if (items.length === 0) return;
    e.preventDefault();
    const idx = active ? items.indexOf(active) : -1;
    const dir = e.code === "ArrowDown" || e.code === "KeyS" || e.code === "ArrowRight" ? 1 : -1;
    const next = items[(idx + dir + items.length) % items.length]!;
    next.focus({ preventScroll: true });
    this.handlers.onUiSound("move");
  };

  private onHover = (e: Event): void => {
    const target = (e.target as HTMLElement).closest<HTMLElement>(".menu-item, .chapter:not([disabled])");
    if (target && document.activeElement !== target) {
      target.focus({ preventScroll: true });
      this.handlers.onUiSound("move");
    }
  };

  private onClick = (e: Event): void => {
    const target = e.target as HTMLElement;
    const chapter = target.closest<HTMLElement>("[data-chapter]");
    if (chapter && !(chapter as HTMLButtonElement).disabled) {
      this.handlers.onUiSound("select");
      this.el.chapters!.hidden = true;
      this.panelStack = this.panelStack.filter((p) => p !== "chapters");
      this.handlers.onChapter(Number(chapter.dataset.chapter));
      return;
    }
    const action = target.closest<HTMLElement>("[data-action]")?.dataset.action;
    if (!action) return;
    this.handlers.onUiSound("select");
    switch (action) {
      case "play":
        this.handlers.onPlay();
        break;
      case "continue":
        this.handlers.onContinue();
        break;
      case "chapters":
        this.handlers.onOpenChapters();
        break;
      case "settings":
        this.handlers.onOpenSettings();
        break;
      case "back":
        this.back();
        break;
      case "resume":
        this.handlers.onResume();
        break;
      case "restart":
        this.handlers.onRestart();
        break;
      case "quit":
        this.handlers.onQuit();
        break;
      case "title":
        this.handlers.onTitle();
        break;
      case "descend":
        this.handlers.onDescend();
        break;
      case "learned":
        this.handlers.onLearned();
        break;
    }
  };

  private paintSlider(input: HTMLInputElement): void {
    input.style.setProperty("--fill", `${input.value}%`);
  }
}
