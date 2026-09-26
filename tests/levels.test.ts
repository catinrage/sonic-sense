import { describe, expect, test } from "bun:test";
import { DIORAMAS, LEVELS } from "../src/game/levels";
import { parseLevel } from "../src/game/level-parser";
import { checkLevel } from "../src/game/level-check";
import { TILE, type LevelDef } from "../src/game/level-types";

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

  for (const [id, def] of Object.entries(DIORAMAS)) {
    test(`the ${id} diorama parses`, () => {
      expect(() => parseLevel(def)).not.toThrow();
    });
  }
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

  const withKit = (id: string, abilities: LevelDef["abilities"]) => parseLevel({ ...LEVELS.find((l) => l.id === id)!, abilities });
  const edited = (id: string, edit: (row: string) => string, legend?: LevelDef["legend"]) => {
    const def = LEVELS.find((l) => l.id === id)!;
    return parseLevel({ ...def, map: def.map.map(edit), legend: { ...def.legend, ...legend } });
  };

  test("the Breathing Halls' heavy bell needs Focus", () => {
    expect(checkLevel(withKit("breathing-halls", ["deepListen"])).errors).toContain("exit is unreachable");
  });

  test("the Breathing Halls' far bell is reached only on the wind", () => {
    const still = edited("breathing-halls", (row) => row.replace(/o>+o/, (m) => m.replace(/>/g, "o")));
    expect(checkLevel(still).openedGroups).not.toContain(1);
  });

  test("the last chasm is crossed only by a dish that faces its bell", () => {
    expect(checkLevel(byId("where-the-dark-breathes")).errors).toEqual([]);
    const turned = edited("where-the-dark-breathes", (row) => row, { R: { kind: "resonator", facing: "e" } });
    expect(checkLevel(turned).errors).toContain("exit is unreachable");
    const plain = edited("where-the-dark-breathes", (row) => row.replace("R", "C"));
    expect(checkLevel(plain).errors).toContain("exit is unreachable");
  });

  test("every Act II chapter declares its kit, and each kit only grows", () => {
    const act2 = LEVELS.filter((l) => l.act === 2);
    expect(act2.map((l) => l.chapter)).toEqual(["VIII", "IX", "X", "XI", "XII", "XIII", "XIV"]);
    for (let i = 1; i < act2.length; i++) {
      for (const a of act2[i - 1]!.abilities ?? []) expect(act2[i]!.abilities).toContain(a);
    }
    for (const l of act2) for (const g of l.grants ?? []) expect(l.abilities).toContain(g);
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
