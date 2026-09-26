import { describe, expect, test } from "bun:test";
import { LEVELS, SHOWCASE } from "../src/game/levels";
import { parseLevel } from "../src/game/level-parser";
import { checkLevel } from "../src/game/level-check";
import { TILE } from "../src/game/level-types";

describe("campaign levels", () => {
  for (const def of LEVELS) {
    test(`${def.chapter} ${def.title} parses and is solvable`, () => {
      const level = parseLevel(def);
      expect(checkLevel(level).errors).toEqual([]);
    });
  }

  test("level ids are unique", () => {
    expect(new Set(LEVELS.map((l) => l.id)).size).toBe(LEVELS.length);
  });

  test("the showcase diorama parses", () => {
    expect(() => parseLevel(SHOWCASE)).not.toThrow();
  });
});

describe("puzzle intent", () => {
  const byId = (id: string) => parseLevel(LEVELS.find((l) => l.id === id)!);

  test("Resonance cannot be finished without the crystal relay", () => {
    const report = checkLevel(byId("resonance"), { crystals: false });
    expect(report.errors).toContain("exit is unreachable");
  });

  test("the Deep Gate's north vault needs its crystal", () => {
    const report = checkLevel(byId("deep-gate"), { crystals: false });
    expect(report.errors.some((e) => e.startsWith("shard"))).toBe(true);
  });

  test("the Listener's warden stands between the player and the exit", () => {
    const level = byId("the-listener");
    const w = level.wardens[0]!;
    expect(w.x).toBeGreaterThan(level.player.x);
    expect(w.x).toBeLessThan(level.exit!.x);
  });

  test("Still Water forces a crossing through water", () => {
    const level = byId("still-water");
    const row = Math.floor(level.player.y);
    const crossing = Array.from({ length: 12 }, (_, i) => level.tiles[row * level.w + 8 + i]);
    expect(crossing.every((t) => t === TILE.Water)).toBe(true);
  });
});

describe("parser errors", () => {
  test("rejects unknown characters with their position", () => {
    expect(() => parseLevel({ id: "bad", chapter: "0", title: "", tagline: "", map: ["###", "#@?", "###"] })).toThrow(
      /unknown map character '\?' at \(2, 1\)/,
    );
  });

  test("requires a player start", () => {
    expect(() => parseLevel({ id: "bad", chapter: "0", title: "", tagline: "", map: ["###", "#.#", "###"] })).toThrow(/no player start/);
  });

  test("rejects warden routes with missing waypoints", () => {
    expect(() =>
      parseLevel({
        id: "bad",
        chapter: "0",
        title: "",
        tagline: "",
        map: ["#####", "#@.V#", "#####"],
        legend: { V: { kind: "warden", route: "z" } },
      }),
    ).toThrow(/missing waypoint 'z'/);
  });
});
