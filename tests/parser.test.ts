import { describe, expect, test } from "bun:test";
import { parseLevel } from "../src/game/level-parser";
import type { LevelDef } from "../src/game/level-types";

const level = (map: string[], legend: LevelDef["legend"] = {}): LevelDef => ({ id: "p", chapter: "0", title: "t", tagline: "", map, legend });

describe("level parser", () => {
  test("a legend key may not shadow a built-in map character", () => {
    const def = level(["#####", "#@C.#", "#####"], { C: { kind: "warden", creature: "chorus" } });
    expect(() => parseLevel(def)).toThrow(/legend key 'C' shadows a built-in/);
  });

  test("legend creatures spawn with their kind", () => {
    const data = parseLevel(level(["#####", "#@A.#", "#####"], { A: { kind: "warden", creature: "chorus" } }));
    expect(data.wardens.map((w) => w.creature)).toEqual(["chorus"]);
  });
});
