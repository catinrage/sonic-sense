import { ABILITY_INFO } from "../game/abilities";
import { CODEX_INFO, codexOf } from "../game/codex";
import type { Ability, CodexId, LevelData, LevelDef } from "../game/level-types";
import { ABILITY_GLYPHS, CODEX_GLYPHS } from "./glyphs";
import type { KitRow, LessonView } from "./ui";

/** An ability's lesson screen; `fresh` when the chapter grants it for the first time. */
export function abilityLesson(id: Ability, fresh = true): LessonView {
  const info = ABILITY_INFO[id];
  return { eyebrow: fresh ? "New ability" : "Ability", glyph: ABILITY_GLYPHS[id], title: info.name, ...info.lesson };
}

/** The lesson screen of a device or creature of the Instrument. */
export function codexLesson(id: CodexId): LessonView {
  const info = CODEX_INFO[id];
  return { eyebrow: info.kind === "Creature" ? "In the Instrument · a creature" : "In the Instrument", glyph: CODEX_GLYPHS[id], title: info.name, ...info.lesson };
}

/** What a chapter teaches for the first time, one screen each, once its card fades. */
export function chapterNews(def: LevelDef): LessonView[] {
  return [...(def.grants ?? []).map((id) => abilityLesson(id)), ...(def.introduces ?? []).map(codexLesson)];
}

/** Everything a chapter is played with: pause-menu rows, and their lessons in the same order. */
export interface ChapterKit {
  rows: KitRow[];
  lessons: LessonView[];
  /** The first lesson about something new in this chapter (0 if nothing is new). */
  fresh: number;
}

export function chapterKit(def: LevelDef, abilities: ReadonlySet<Ability>, level: LevelData): ChapterKit {
  const owned = (Object.keys(ABILITY_INFO) as Ability[]).filter((id) => abilities.has(id));
  const codex = codexOf(level);
  const rows: KitRow[] = [
    ...owned.map((id) => ({ name: ABILITY_INFO[id].name, key: ABILITY_INFO[id].key, tag: ABILITY_INFO[id].trigger, blurb: ABILITY_INFO[id].blurb })),
    ...codex.map((id) => ({ name: CODEX_INFO[id].name, key: "", tag: CODEX_INFO[id].kind, blurb: CODEX_INFO[id].blurb })),
  ];
  const news = new Set<string>([...(def.grants ?? []), ...(def.introduces ?? [])]);
  const lessons = [...owned.map((id) => abilityLesson(id, news.has(id))), ...codex.map(codexLesson)];
  const fresh = Math.max(0, [...owned, ...codex].findIndex((id) => news.has(id)));
  return { rows, lessons, fresh };
}
