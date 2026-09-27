import { describe, expect, test } from "bun:test";
import { parseLevel } from "../src/game/level-parser";
import { LEVELS } from "../src/game/levels";
import { World } from "../src/game/world";
import { chapterKit, chapterNews } from "../src/ui/lessons";

const kitOf = (chapter: string) => {
  const def = LEVELS.find((l) => l.chapter === chapter)!;
  const world = new World(parseLevel(def));
  return chapterKit(def, world.abilities, world.level);
};

describe("lessons read again", () => {
  test("the pause menu's rows and the lessons they open line up, the chapter's news first with H", () => {
    const kit = kitOf("XV");
    expect(kit.rows.map((r) => r.name)).toEqual(["Deep Listen", "Focus", "Lure Stone", "Muffle", "The Five Tones", "Singing Glass"]);
    expect(kit.lessons.map((l) => l.title)).toEqual(kit.rows.map((r) => r.name));
    expect(kit.lessons[kit.fresh]!.title).toBe("The Five Tones");
    // Abilities learned chapters ago are no longer "new" when read again here.
    expect(kit.lessons[0]!.eyebrow).toBe("Ability");
  });

  test("an ability is still new when read again in the chapter that grants it", () => {
    const kit = kitOf("XIII");
    expect(kit.lessons[kit.fresh]!.title).toBe("Muffle");
    expect(kit.lessons[kit.fresh]!.eyebrow).toBe("New ability");
  });

  test("chapters that bring nothing to learn have nothing to read again", () => {
    const kit = kitOf("I");
    expect(kit.rows).toHaveLength(0);
    expect(kit.lessons).toHaveLength(0);
    expect(kit.fresh).toBe(0);
  });

  test("whatever a chapter teaches on arrival can be found again in it", () => {
    for (const def of LEVELS) {
      const world = new World(parseLevel(def));
      const titles = chapterKit(def, world.abilities, world.level).lessons.map((l) => l.title);
      for (const news of chapterNews(def)) expect(titles).toContain(news.title);
    }
  });
});
