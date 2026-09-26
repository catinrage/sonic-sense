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
    const s = parseSave({ version: 2, unlocked: 4, last: 3, volumes: { master: 0.5, sfx: 0.6, music: 0.1 }, shake: false, gentle: true });
    expect(s).toEqual({
      version: 2,
      unlocked: 4,
      last: 3,
      volumes: { master: 0.5, sfx: 0.6, music: 0.1 },
      shake: false,
      gentle: true,
    });
  });

  test("opens Act II for version-1 saves that reached the Act I finale", () => {
    expect(parseSave({ unlocked: 6, last: 0 }).unlocked).toBe(7);
    expect(parseSave({ unlocked: 3, last: 3 }).unlocked).toBe(3);
  });

  test("does not bump current-version saves", () => {
    expect(parseSave({ version: 2, unlocked: 6, last: 6 }).unlocked).toBe(6);
  });
});
