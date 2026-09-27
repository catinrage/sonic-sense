import type { BestiaryEntry, BestiaryId } from "../game/bestiary";
import { escapeHtml } from "./html";

/** One page of the bestiary, as the player has come to know it. */
export interface BestiaryPage {
  entry: BestiaryEntry;
  /** Heard at least once on the way down; otherwise only its number shows. */
  known: boolean;
  /** Where it was first heard. */
  chapter: { numeral: string; title: string } | null;
}

export interface BestiaryHandlers {
  onPick(index: number): void;
  onCall(): void;
}

/** The part of the screen left for the creature itself, in viewport fractions. */
export interface StageRect {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

const NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
const UNHEARD_ACCENT = "#5d7482";
/** Seconds a creature's answer stays under it. */
const CAPTION_TIME = 3.6;

const SENSES: readonly { key: keyof BestiaryEntry["senses"]; label: string; icon: string }[] = [
  {
    key: "air",
    label: "Hears the air",
    icon: '<circle cx="5.5" cy="12" r="1.6"/><path d="M9.5 8.6a4.8 4.8 0 0 1 0 6.8M13 6a8.6 8.6 0 0 1 0 12M16.5 3.4a12.4 12.4 0 0 1 0 17.2"/>',
  },
  { key: "ground", label: "Feels the ground", icon: '<path d="M3 18.5h18M4.5 13.5l2.2-3.2 2.3 3.2 2.3-3.2 2.3 3.2 2.3-3.2 2.3 3.2"/>' },
  { key: "beat", label: "Sees on the beat", icon: '<path d="M2.5 12.5h4.2l2-5.2 3.1 10.4 2.3-7.4 1.3 2.2h6.1"/>' },
  {
    key: "discord",
    label: "Hears discord",
    icon: '<path d="M9 17.5V6.2l8.5-2v11.3"/><circle cx="7" cy="17.5" r="2"/><circle cx="15.5" cy="15.5" r="2"/><path d="M3.5 3.5l17 17"/>',
  },
];

const METERS: readonly { key: keyof BestiaryEntry["meters"]; label: string; about: string }[] = [
  { key: "speed", label: "Speed", about: "How fast it closes on what it heard" },
  { key: "tenacity", label: "Tenacity", about: "How long it keeps hunting before it gives up" },
  { key: "alarm", label: "Alarm", about: "How far its cry carries to other hunters" },
];

/** A short burst of sound at `at` (0..1, wrapping), `w` wide, ringing at `f`. */
function burst(t: number, at: number, w: number, f: number): number {
  const d = ((t - at + 1.5) % 1) - 0.5;
  return Math.exp(-((d / w) ** 2)) * Math.sin(d * f * Math.PI * 2);
}

const sine = (t: number, k: number): number => Math.sin(t * k * Math.PI * 2);

/** Each creature's voice as a trace: -1..1 over one loop (t in 0..1). */
const VOICES: Readonly<Record<BestiaryId, (t: number) => number>> = {
  warden: (t) => [0.08, 0.31, 0.37, 0.66, 0.9].reduce((y, at, i) => y + burst(t, at, 0.011, 55) * (i % 2 ? 0.7 : 0.95), 0),
  tremor: (t) => [0.14, 0.47, 0.8].reduce((y, at) => y + burst(t, at, 0.04, 8) * 0.95, 0),
  sentinel: (t) => sine(t, 16) * (0.2 + 0.72 * Math.sin(t * Math.PI * 2) ** 2),
  chorus: (t) => [0.04, 0.11, 0.16, 0.29, 0.34, 0.42, 0.55, 0.61, 0.73, 0.79, 0.86, 0.95].reduce((y, at, i) => y + burst(t, at, 0.006, 85) * (0.5 + (i % 3) * 0.2), 0),
  stalker: (t) => sine(t, 3) * 0.55 + sine(t, 11) * 0.14,
  mimic: (t) => [0.12, 0.37, 0.62, 0.87].reduce((y, at, i) => y + burst(t, at, 0.02, 38) * (i % 2 ? 0.45 : 0.9), 0),
  metronome: (t) => [0, 0.25, 0.5, 0.75].reduce((y, at) => y + burst(t, at, 0.009, 70) + burst(t, at - 0.06, 0.006, 90) * 0.32, 0),
  conductor: (t) => (sine(t, 5) + sine(t, 7) + sine(t, 9)) * 0.32,
};

/** The trace drawn twice side by side (0..640), so it can scroll forever. */
export function voicePath(id: BestiaryId | null): string {
  const n = 180;
  const pts: string[] = [];
  for (let copy = 0; copy < 2; copy++) {
    for (let i = 0; i <= n; i++) {
      if (copy === 1 && i === 0) continue;
      const t = i / n;
      // Unheard: only the faint hiss of the dark.
      const y = id ? Math.max(-1, Math.min(1, VOICES[id](t))) : sine(t, 29) * sine(t, 11) * 0.06;
      pts.push(`${(copy * 320 + t * 320).toFixed(1)} ${(20 - y * 16).toFixed(2)}`);
    }
  }
  return `M${pts.join("L")}`;
}

/** The bestiary's pages: an index of what listens in the dark, and field notes on each. */
export class BestiaryView {
  private pages: readonly BestiaryPage[] = [];
  private selected = 0;
  private captionTimer = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly handlers: BestiaryHandlers,
  ) {
    root.addEventListener("click", this.onClick);
  }

  get index(): number {
    return this.selected;
  }

  /** Fill the index and open a page. */
  render(pages: readonly BestiaryPage[], selected: number): void {
    this.pages = pages;
    const heard = pages.filter((p) => p.known).length;
    this.part("count").textContent = `${heard} of ${pages.length} heard`;
    this.part("index").replaceChildren(...pages.map((p, i) => this.tab(p, i)));
    this.select(selected);
  }

  /** Turn to page `index` (the stage changes with it, by the handlers). */
  select(index: number): void {
    const page = this.pages[index];
    if (!page) return;
    this.selected = index;
    const accent = page.known ? page.entry.accent : UNHEARD_ACCENT;
    this.root.style.setProperty("--accent", accent);
    this.part("index")
      .querySelectorAll<HTMLElement>("[data-beast]")
      .forEach((tab, i) => {
        if (i !== index) {
          tab.removeAttribute("aria-current");
          return;
        }
        tab.setAttribute("aria-current", "true");
        // On narrow screens the index is a row that scrolls: keep the chosen one in view.
        tab.scrollIntoView({ block: "nearest", inline: "nearest" });
      });
    const sheet = this.part("page");
    sheet.innerHTML = page.known ? this.notes(page, index) : this.unheard(page, index);
    sheet.scrollTop = 0;
    this.caption("");
  }

  /** Step through the index (arrow keys), keeping keyboard focus on the chosen tab. */
  step(delta: number): number {
    const n = this.pages.length;
    const next = (this.selected + delta + n) % n;
    this.part("index").querySelectorAll<HTMLElement>("[data-beast]")[next]?.focus({ preventScroll: true });
    return next;
  }

  /** What the creature did when called; empty clears it. */
  caption(text: string): void {
    const cap = this.part("caption");
    cap.classList.remove("is-visible", "is-leaving");
    this.captionTimer = 0;
    if (!text) return;
    cap.textContent = text;
    void cap.offsetWidth;
    cap.classList.add("is-visible");
    this.captionTimer = CAPTION_TIME;
  }

  update(dt: number): void {
    if (this.captionTimer <= 0) return;
    this.captionTimer -= dt;
    if (this.captionTimer <= 0) this.part("caption").classList.replace("is-visible", "is-leaving");
  }

  /** Where the creature should stand on screen: the middle of the stage cell. */
  stageRect(): StageRect {
    const r = this.part("stage").getBoundingClientRect();
    const vw = Math.max(1, window.innerWidth);
    const vh = Math.max(1, window.innerHeight);
    if (r.width < 8 || r.height < 8) return { cx: 0.7, cy: 0.5, w: 0.5, h: 0.8 };
    return { cx: (r.left + r.width / 2) / vw, cy: (r.top + r.height / 2) / vh, w: r.width / vw, h: r.height / vh };
  }

  // ------------------------------------------------------------ internals

  private tab(page: BestiaryPage, i: number): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = "beast-tab";
    b.dataset.beast = String(i);
    b.classList.toggle("is-unheard", !page.known);
    b.style.setProperty("--tab-accent", page.known ? page.entry.accent : UNHEARD_ACCENT);
    const name = page.known ? page.entry.name : "Unheard";
    b.innerHTML = `<span class="beast-tab-num">${NUMERALS[i] ?? i + 1}</span><span class="beast-tab-name">${escapeHtml(name)}</span><span class="beast-tab-dot" aria-hidden="true"></span>`;
    return b;
  }

  private voice(id: BestiaryId | null): string {
    return `<svg class="beast-voice" viewBox="0 0 320 40" preserveAspectRatio="none" aria-hidden="true"><path class="beast-voice-trace" d="${voicePath(id)}"/></svg>`;
  }

  private notes(page: BestiaryPage, i: number): string {
    const e = page.entry;
    const senses = SENSES.map(
      (s) =>
        `<li class="beast-sense${e.senses[s.key] ? " is-on" : ""}" title="${s.label}"><svg viewBox="0 0 24 24" aria-hidden="true">${s.icon}</svg><span class="sr-only">${s.label}${e.senses[s.key] ? "" : ": no"}</span></li>`,
    ).join("");
    const sensed = SENSES.filter((s) => e.senses[s.key]).map((s) => s.label);
    if (!e.senses.air) sensed.push("Deaf to the air");
    const meters = METERS.map((m) => {
      const v = e.meters[m.key];
      const cells = Array.from({ length: 5 }, (_, k) => `<i${k < v ? ' class="is-on"' : ""} style="--k:${k}"></i>`).join("");
      return `<div class="beast-meter" title="${m.about}"><dt>${m.label}</dt><dd aria-label="${v} of 5">${cells}</dd></div>`;
    }).join("");
    const list = (items: readonly string[]) => items.map((t, k) => `<li style="--k:${k}">${escapeHtml(t)}</li>`).join("");
    const met = page.chapter ? `First heard in Chapter ${escapeHtml(page.chapter.numeral)} &middot; ${escapeHtml(page.chapter.title)}` : "";
    return `
      <p class="beast-epithet"><span class="beast-no">No. ${NUMERALS[i] ?? i + 1}</span>${escapeHtml(e.epithet)}</p>
      <h2 class="beast-name">${escapeHtml(e.name)}</h2>
      ${this.voice(e.id)}
      <p class="beast-met">${met}</p>
      <div class="beast-stats">
        <div class="beast-sensing">
          <ul class="beast-senses" aria-label="Senses">${senses}</ul>
          <p class="beast-sensed">${sensed.join(" &middot; ")}</p>
        </div>
        <dl class="beast-meters">${meters}</dl>
      </div>
      <h3 class="beast-heading">Its ways</h3>
      <ul class="beast-list beast-list--ways">${list(e.ways)}</ul>
      <h3 class="beast-heading beast-heading--live">How to live</h3>
      <ul class="beast-list beast-list--live">${list(e.live)}</ul>`;
  }

  private unheard(page: BestiaryPage, i: number): string {
    return `
      <p class="beast-epithet"><span class="beast-no">No. ${NUMERALS[i] ?? i + 1}</span>Not yet heard</p>
      <h2 class="beast-name">Unheard</h2>
      ${this.voice(null)}
      <p class="beast-met">Something waits deeper in the dark than you have gone.</p>
      <p class="beast-unheard-note">Go further down, and listen. When you have heard it, its page will fill.</p>`;
  }

  private part(name: string): HTMLElement {
    const n = this.root.querySelector<HTMLElement>(`[data-bestiary="${name}"]`);
    if (!n) throw new Error(`Bestiary: missing [data-bestiary="${name}"]`);
    return n;
  }

  private onClick = (e: Event): void => {
    const target = e.target as HTMLElement;
    const tab = target.closest<HTMLElement>("[data-beast]");
    if (tab) {
      const i = Number(tab.dataset.beast);
      if (i !== this.selected) this.handlers.onPick(i);
      return;
    }
    if (target.closest("[data-bestiary-call]")) this.handlers.onCall();
  };
}
