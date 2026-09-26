import { describe, expect, test } from "bun:test";
import { DIORAMAS, LEVELS } from "../src/game/levels";
import { parseLevel } from "../src/game/level-parser";
import { checkLevel } from "../src/game/level-check";
import { TILE, type CodexId, type LevelDef } from "../src/game/level-types";
import { codexOf } from "../src/game/codex";

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

describe("Act III puzzle intent", () => {
  const def = (id: string) => LEVELS.find((l) => l.id === id)!;
  const edited = (id: string, edit: (row: string) => string, legend?: LevelDef["legend"]) =>
    parseLevel({ ...def(id), map: def(id).map.map(edit), legend: { ...def(id).legend, ...legend } });
  const without = (id: string, ch: string, fill = ".") => edited(id, (row) => row.replaceAll(ch, fill));
  const errors = (level: ReturnType<typeof parseLevel>, opts = {}) => checkLevel(level, opts).errors;

  test("every Act III chapter keeps the whole kit, and teaches each device and creature where it first appears", () => {
    const act3 = LEVELS.filter((l) => l.act === 3);
    expect(act3.map((l) => l.chapter)).toEqual(["XV", "XVI", "XVII", "XVIII", "XIX", "XX", "XXI"]);
    for (const l of act3) expect([...(l.abilities ?? [])].sort()).toEqual(["deepListen", "focus", "lureStone", "muffle"]);
    const seen = new Set<CodexId>();
    for (const l of act3) {
      const fresh = codexOf(parseLevel(l)).filter((id) => !seen.has(id));
      expect([...(l.introduces ?? [])].sort(), l.id).toEqual(fresh.sort());
      fresh.forEach((id) => seen.add(id));
    }
  });

  test("XV: the first pane needs its key, and the Gate's glass is reached only through its tuned crystal", () => {
    expect(errors(without("the-tuning-hall", "e"))).toContain("exit is unreachable");
    expect(errors(without("the-tuning-hall", "G"))).toContain("exit is unreachable");
  });

  test("XVI: one note has to go through the tube, the other round the bend by the mimic", () => {
    const level = parseLevel(def("echo-of-an-echo"));
    expect(errors(level, { tubes: false })).toContain("exit is unreachable");
    expect(errors(level, { mimics: false })).toContain("exit is unreachable");
  });

  test("XVII: the dishes face the wrong way until a focused call turns them", () => {
    expect(errors(parseLevel(def("the-turning-dishes")), { turning: false })).toContain("exit is unreachable");
    expect(errors(parseLevel({ ...def("the-turning-dishes"), abilities: ["deepListen", "muffle"] }))).toContain("exit is unreachable");
  });

  test("XVIII: the Gate's chord needs the G prism, and the nearest C key wakes the wrong prism", () => {
    expect(errors(without("chord", "P"))).toContain("exit is unreachable");
    const nearKeyOnly = edited("chord", (row) => row.replace(/c(\.{5}#{7})$/, ".$1"));
    expect(errors(nearKeyOnly)).toContain("exit is unreachable");
  });

  test("XIX: the note crosses the channel only while it is flooded", () => {
    const stuck = edited("the-sluices", (row) => row, { S: { kind: "bell", group: 1, toggle: true, threshold: 9 } });
    expect(errors(stuck)).toContain("exit is unreachable");
  });

  test("XX: only the Metronome's pulse wakes the prism the chord needs", () => {
    expect(errors(without("the-metronome", "N"))).toContain("exit is unreachable");
  });

  test("XXI: one vault needs the mimic and the prism, another the tube", () => {
    const level = parseLevel(def("the-conductor"));
    expect(errors(level, { mimics: false }).some((e) => e.startsWith("shard"))).toBe(true);
    expect(errors(level, { tubes: false }).some((e) => e.startsWith("shard"))).toBe(true);
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
