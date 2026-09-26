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
  onVolume(bus: VolumeBus, value: number): void;
  onSetting(key: SettingKey, value: boolean): void;
  onUiSound(kind: "move" | "select"): void;
}

export interface ChapterInfo {
  numeral: string;
  title: string;
  tagline: string;
  unlocked: boolean;
}

export interface SettingsState {
  volumes: Record<VolumeBus, number>;
  shake: boolean;
  gentle: boolean;
}

type Panel = "title" | "chapters" | "settings" | "pause" | "ending";

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
    for (const id of ["title", "chapters", "settings", "hud", "card", "message", "pause", "ending", "curtain"]) {
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

  showChapters(chapters: readonly ChapterInfo[]): void {
    const grid = this.bind("chapter-grid");
    grid.replaceChildren(
      ...chapters.map((c, i) => {
        const b = document.createElement("button");
        b.className = "chapter";
        b.disabled = !c.unlocked;
        b.dataset.chapter = String(i);
        b.innerHTML = `<span class="chapter-numeral">${escapeHtml(c.numeral)}</span><span class="chapter-title">${escapeHtml(
          c.unlocked ? c.title : "Unheard",
        )}</span><span class="chapter-tag">${escapeHtml(c.unlocked ? c.tagline : "Reach it to listen.")}</span>`;
        return b;
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

  showPause(): void {
    this.openPanel("pause");
  }

  hidePause(): void {
    this.panelStack = this.panelStack.filter((p) => p !== "pause" && p !== "settings");
    this.el.pause!.hidden = true;
    this.el.settings!.hidden = true;
  }

  showEnding(): void {
    this.hideHud();
    for (const id of ["title", "chapters", "settings", "pause", "card", "message"]) this.el[id]!.hidden = true;
    this.panelStack = ["ending"];
    this.el.ending!.hidden = false;
    this.focusFirst(this.el.ending!);
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

  card(chapter: string, title: string, tagline: string): void {
    const card = this.el.card!;
    this.bind("card-chapter").textContent = chapter;
    this.bind("card-title").textContent = title;
    this.bind("card-tagline").textContent = tagline;
    card.hidden = false;
    card.classList.remove("is-visible");
    void card.offsetWidth;
    card.classList.add("is-visible");
    this.cardTimer = 3.8;
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

  private openPanel(panel: Panel): void {
    const node = this.el[panel]!;
    node.hidden = false;
    if (this.topPanel !== panel) this.panelStack.push(panel);
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
    }
  };

  private paintSlider(input: HTMLInputElement): void {
    input.style.setProperty("--fill", `${input.value}%`);
  }
}
