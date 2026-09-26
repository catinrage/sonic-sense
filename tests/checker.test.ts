import { describe, expect, test } from "bun:test";
import { World } from "../src/game/world";
import { parseLevel } from "../src/game/level-parser";
import { bestEnergy, callProfiles, checkLevel, soundGridFor } from "../src/game/level-check";
import { FULL_CALL } from "../src/game/calls";
import { COLORS } from "../src/game/palette";
import type { LevelDef } from "../src/game/level-types";
import { IDLE_INTENT, type PlayerIntent } from "../src/game/entities/player";
import type { Wave } from "../src/game/waves";

const IDLE: PlayerIntent = IDLE_INTENT;

function worldOf(map: string[]): World {
  return new World(parseLevel({ id: "t", chapter: "0", title: "t", tagline: "", map }));
}

function run(world: World, seconds: number, intent: Partial<PlayerIntent> = {}): void {
  for (let t = 0; t < seconds; t += 1 / 60) world.update(1 / 60, { ...IDLE, ...intent });
}

describe("checker ↔ simulation correspondence", () => {
  test("the checker's loudest call is exactly what the creature emits at full breath", () => {
    const world = worldOf(["###########", "#.........#", "#....@....#", "#.........#", "###########"]);
    const emitted: Wave[] = [];
    world.events.on("wave", (e) => e.wave.kind === "pulse" && emitted.push(e.wave));
    run(world, 1.4, { pulseHeld: true });
    run(world, 1 / 60, { pulseReleased: true });

    expect(emitted).toHaveLength(1);
    const [probe] = callProfiles(new Set());
    expect(probe!.radius).toBeCloseTo(emitted[0]!.radius, 9);
    expect(probe!.strength).toBeCloseTo(emitted[0]!.strength, 9);
  });
});

describe("checker under wind", () => {
  // The bell lies beyond a chasm, out of reach of any call in still air. A draft
  // blowing across an island in the chasm carries the call far enough to ring it.
  const windy: LevelDef = {
    id: "windy",
    chapter: "0",
    title: "t",
    tagline: "",
    map: [
      "######################",
      "#.....################",
      "#@....oo>>>>>>>>>>o.B#",
      "#.....################",
      "#1####################",
      "#X...................#",
      "######################",
    ],
    legend: { B: { kind: "bell", group: 1, threshold: 0.15 } },
  };
  const still: LevelDef = { ...windy, id: "still", map: windy.map.map((row) => row.replaceAll(">", ".")) };

  test("its backwards solve agrees with the wave the game actually propagates", () => {
    const level = parseLevel(windy);
    const bell = level.bells[0]!;
    const stand = { x: 5.5, y: 2.5 };
    const world = new World(level);
    const wave = world.emitSound({ kind: "pulse", ...stand, ...FULL_CALL, color: COLORS.pulse });
    wave.job.advance(Infinity);
    const forward = wave.energyAt(wave.job.sample(bell.x, bell.y, { d: 0, e: 0, dx: 0, dy: 0 }));
    const [probe] = callProfiles(new Set());
    const backward = bestEnergy(soundGridFor(level, new Set()), [stand], bell.x, bell.y, probe!);

    expect(forward).toBeGreaterThan(bell.threshold);
    expect(Math.abs(backward - forward)).toBeLessThan(0.02);
  });

  test("the draft is what makes the level solvable", () => {
    expect(checkLevel(parseLevel(windy)).errors).toEqual([]);
    expect(checkLevel(parseLevel(still)).errors).toContain("exit is unreachable");
  });

  test("silt and drafts are walkable ground", () => {
    const level = parseLevel({ ...windy, id: "ground", map: ["#######", "#@:>v.#", "#######"], legend: {} });
    const { reachable } = checkLevel(level);
    expect([2, 3, 4, 5].map((x) => reachable[level.w + x])).toEqual([1, 1, 1, 1]);
  });
});
