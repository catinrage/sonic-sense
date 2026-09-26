import { describe, expect, test } from "bun:test";
import { parseSave } from "../src/save";

describe("parseSave", () => {
  test("returns defaults for missing or malformed data", () => {
    expect(parseSave(null).unlocked).toBe(0);
    expect(parseSave("nonsense").volumes.master).toBe(0.8);
  });

  test("clamps and validates untrusted fields", () => {
    const s = parseSave({ unlocked: 99999, last: -3, volumes: { master: 7, sfx: "loud", music: 0.25 }, shake: "yes" });
    expect(s.unlocked).toBe(0);
    expect(s.last).toBe(0);
    expect(s.volumes).toEqual({ master: 1, sfx: 1, music: 0.25 });
    expect(s.shake).toBe(true);
  });

  test("keeps valid progress", () => {
    const s = parseSave({ unlocked: 4, last: 3, volumes: { master: 0.5, sfx: 0.6, music: 0.1 }, shake: false, gentle: true });
    expect(s).toEqual({ unlocked: 4, last: 3, volumes: { master: 0.5, sfx: 0.6, music: 0.1 }, shake: false, gentle: true });
  });
});
