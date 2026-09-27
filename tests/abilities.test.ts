import { describe, expect, test } from "bun:test";
import { World } from "../src/game/world";
import { parseLevel } from "../src/game/level-parser";
import { checkLevel } from "../src/game/level-check";
import { LISTEN_GAIN } from "../src/game/calls";
import { UNREACHED } from "../src/game/geodesic";
import { LURE_CHIRPS } from "../src/game/entities/props";
import { ABILITY_INFO, abilityViews, lessonsFor } from "../src/game/abilities";
import { LEVELS } from "../src/game/levels";
import { IDLE_INTENT, MUFFLE_COOLDOWN, MUFFLE_TIME, type PlayerIntent } from "../src/game/entities/player";
import type { Ability, LevelDef } from "../src/game/level-types";
import type { Wave } from "../src/game/waves";

function level(map: string[], abilities: Ability[] = [], legend: LevelDef["legend"] = {}, stones = 0): LevelDef {
  return { id: "kit", chapter: "0", title: "t", tagline: "", map, legend, abilities, stones };
}

function run(world: World, seconds: number, intent: Partial<PlayerIntent> = {}): void {
  for (let t = 0; t < seconds; t += 1 / 60) world.update(1 / 60, { ...IDLE_INTENT, ...intent });
}

function waves(world: World, kind?: Wave["kind"]): Wave[] {
  const out: Wave[] = [];
  world.events.on("wave", (e) => (!kind || e.wave.kind === kind) && out.push(e.wave));
  return out;
}

const HALL = ["###############", "#.............#", "#.............#", "#.............#", "###############"];

describe("Focus", () => {
  // A bell too heavy for any ordinary call: only a focused beam strikes hard enough.
  const heavy = (abilities: Ability[]) =>
    level(["############", "#@...B.....#", "#1##########", "#X.........#", "############"], abilities, {
      B: { kind: "bell", group: 1, threshold: 1.4 },
    });

  test("the checker proves the heavy bell needs Focus", () => {
    expect(checkLevel(parseLevel(heavy(["focus"]))).errors).toEqual([]);
    expect(checkLevel(parseLevel(heavy([]))).errors).toContain("exit is unreachable");
  });

  test("a focused call aimed at the heavy bell rings it; a full ordinary call does not", () => {
    const focused = new World(parseLevel(heavy(["focus"])));
    run(focused, 1.2, { focusHeld: true, aimX: 5.5, aimY: 1.5 });
    run(focused, 1 / 60, { focusReleased: true, aimX: 5.5, aimY: 1.5 });
    run(focused, 1);
    expect(focused.bells[0]!.ring).toBeGreaterThan(0);

    const plain = new World(parseLevel(heavy(["focus"])));
    run(plain, 1.2, { pulseHeld: true });
    run(plain, 1 / 60, { pulseReleased: true });
    run(plain, 1);
    expect(plain.bells[0]!.ring).toBe(0);
  });

  test("does nothing in a chapter that has not granted it", () => {
    const world = new World(parseLevel(level(HALL.map((r, y) => (y === 2 ? "#@............#" : r)))));
    const made = waves(world, "pulse");
    run(world, 1, { focusHeld: true });
    run(world, 1 / 60, { focusReleased: true });
    expect(made).toHaveLength(0);
  });

  test("a hunter in the beam's path barely hears it, though an ordinary call would carry", () => {
    const map = ["###############", "#.............#", "#@......W.....#", "#.............#", "###############"];
    const focused = new World(parseLevel(level(map, ["focus"])));
    run(focused, 1.2, { focusHeld: true, aimX: 8.5, aimY: 2.5 });
    run(focused, 1 / 60, { focusReleased: true, aimX: 8.5, aimY: 2.5 });
    run(focused, 1.5);
    expect(["idle", "patrol"]).toContain(focused.wardens[0]!.state);

    const called = new World(parseLevel(level(map, ["focus"])));
    run(called, 1.2, { pulseHeld: true });
    run(called, 1 / 60, { pulseReleased: true });
    run(called, 1.5);
    expect(["alert", "hunt", "search"]).toContain(called.wardens[0]!.state);
  });
});

describe("Deep Listen", () => {
  const map = HALL.map((r, y) => (y === 2 ? "#@....d.......#" : r));

  test("deepens while the creature is still, and breaks when it moves", () => {
    const world = new World(parseLevel(level(map, ["deepListen"])));
    run(world, 2);
    expect(world.player.listen).toBeCloseTo(1, 5);
    run(world, 0.3, { moveX: 1 });
    expect(world.player.listen).toBe(0);
  });

  test("the world's own sounds are solved far enough to reveal more; the creature's are not", () => {
    const world = new World(parseLevel(level(map, ["deepListen"])));
    const heard = waves(world);
    run(world, 7);
    const drip = heard.find((w) => w.kind === "drip")!;
    drip.job.advance(Infinity);
    const far = drip.job.sample(drip.x + drip.radius * (LISTEN_GAIN - 0.2), drip.y, { d: 0, e: 0, dx: 0, dy: 0 });
    expect(far.d).toBeLessThan(UNREACHED);
    expect(drip.own).toBe(false);

    run(world, 0.2, { pulseHeld: true });
    run(world, 1 / 60, { pulseReleased: true });
    const call = heard.find((w) => w.kind === "pulse")!;
    expect(call.own).toBe(true);
  });

  test("is absent unless granted", () => {
    const world = new World(parseLevel(level(map)));
    run(world, 3);
    expect(world.player.listen).toBe(0);
  });
});

describe("Lure Stone", () => {
  const map = ["################", "#..............#", "#@.............#", "#..........W...#", "################"];

  test("a thrown stone keeps chirping where it lands", () => {
    for (const [abilities, expected] of [
      [["lureStone"], LURE_CHIRPS],
      [[], 0],
    ] as const) {
      const world = new World(parseLevel(level(map, [...abilities], {}, 1)));
      const chirps = waves(world, "lure");
      world.update(1 / 60, { ...IDLE_INTENT, throwPressed: true, aimX: 6.5, aimY: 2.5 });
      run(world, 14);
      expect(chirps).toHaveLength(expected);
    }
  });

  test("draws a hunter to where it lies", () => {
    const world = new World(parseLevel(level(map, ["lureStone"], {}, 1)));
    world.update(1 / 60, { ...IDLE_INTENT, throwPressed: true, aimX: 6.5, aimY: 2.5 });
    const start = world.wardens[0]!.x;
    run(world, 6);
    expect(world.wardens[0]!.x).toBeLessThan(start - 2);
  });
});

describe("Muffle", () => {
  test("silences footfalls for a few seconds, then needs a long rest", () => {
    const world = new World(parseLevel(level(HALL.map((r, y) => (y === 2 ? "#@............#" : r)), ["muffle"])));
    const steps = waves(world, "step");
    run(world, 1 / 60, { mufflePressed: true });
    expect(world.player.muffled).toBe(true);
    run(world, MUFFLE_TIME - 0.5, { moveX: 1 });
    expect(steps).toHaveLength(0);
    run(world, 1, { moveX: -1 });
    expect(world.player.muffled).toBe(false);
    expect(steps.length).toBeGreaterThan(0);

    run(world, 1 / 60, { mufflePressed: true });
    expect(world.player.muffled).toBe(false);
    run(world, MUFFLE_COOLDOWN - MUFFLE_TIME);
    run(world, 1 / 60, { mufflePressed: true });
    expect(world.player.muffled).toBe(true);
  });

  test("its readiness bar drains while muffled and refills without a jump", () => {
    const world = new World(parseLevel(level(HALL.map((r, y) => (y === 2 ? "#@............#" : r)), ["muffle"])));
    const fill = () => abilityViews(world.abilities, world.player).find((v) => v.id === "muffle")!.fill;
    expect(fill()).toBe(1);
    run(world, 1 / 60, { mufflePressed: true });
    run(world, MUFFLE_TIME - 0.05);
    const draining = fill();
    run(world, 0.1);
    expect(world.player.muffled).toBe(false);
    expect(Math.abs(fill() - draining)).toBeLessThan(0.05);
    run(world, (MUFFLE_COOLDOWN - MUFFLE_TIME) / 2);
    expect(fill()).toBeCloseTo(0.5, 1);
  });

  test("muffled, the creature thins into the dark and its steps are only seen, never heard", () => {
    const world = new World(parseLevel(level(HALL.map((r, y) => (y === 2 ? "#@............#" : r)), ["muffle"])));
    let hushed = 0;
    world.events.on("hushedStep", () => hushed++);
    expect(world.player.hush).toBe(0);
    run(world, 1 / 60, { mufflePressed: true });
    run(world, 1.5, { moveX: 1 });
    expect(world.player.hush).toBeGreaterThan(0.95);
    expect(hushed).toBeGreaterThan(0);
    run(world, MUFFLE_TIME);
    expect(world.player.muffled).toBe(false);
    run(world, 2);
    expect(world.player.hush).toBeLessThan(0.05);
  });

  test("a tremor cannot feel muffled steps", () => {
    const map = ["##############################", "#............................#", "#.@..........T...............#", "#............................#", "##############################"];
    const legend: LevelDef["legend"] = { T: { kind: "warden", creature: "tremor" } };
    const muffled = new World(parseLevel(level(map, ["muffle"], legend)));
    run(muffled, 1 / 60, { mufflePressed: true });
    run(muffled, 2.2, { moveX: 1 });
    expect(["idle", "patrol"]).toContain(muffled.wardens[0]!.state);
  });
});

describe("teaching the abilities", () => {
  test("every ability says how to use it, what it does and what to watch for", () => {
    for (const [id, info] of Object.entries(ABILITY_INFO)) {
      expect(info.name.length, id).toBeGreaterThan(0);
      // Either a key or a stated trigger, so the HUD can always show how it is set off.
      expect(info.key.length + info.trigger.length, id).toBeGreaterThan(0);
      expect(info.blurb.length, id).toBeGreaterThan(20);
      for (const part of [info.lesson.use, info.lesson.does, info.lesson.tip]) expect(part.length, id).toBeGreaterThan(10);
      if (info.key) expect(info.lesson.use, id).toContain(`[${info.key}]`);
    }
  });

  test("each Act II ability is taught in exactly one chapter, the first that has it", () => {
    const taught = LEVELS.flatMap((l) => lessonsFor(l.grants).map((info) => info.name));
    expect(new Set(taught).size).toBe(taught.length);
    expect(taught).toEqual(["Deep Listen", "Focus", "Lure Stone", "Muffle"]);
    for (const [i, l] of LEVELS.entries()) {
      for (const a of l.abilities ?? []) {
        const first = LEVELS.findIndex((m) => (m.abilities ?? []).includes(a));
        if (first === i) expect(l.grants ?? []).toContain(a);
      }
    }
  });

  test("Deep Listen sounds its cue once, when the ears have fully opened", () => {
    const world = new World(parseLevel(level(HALL.map((r, y) => (y === 2 ? "#@............#" : r)), ["deepListen"])));
    let cues = 0;
    world.events.on("listen", () => cues++);
    run(world, 3);
    expect(cues).toBe(1);
    run(world, 0.3, { moveX: 1 });
    run(world, 3);
    expect(cues).toBe(2);
  });

  test("a lure stone glows while it calls, and a plain stone does not", () => {
    const map = ["################", "#@.............#", "#..............#", "################"];
    for (const [abilities, glows] of [
      [["lureStone"], true],
      [[], false],
    ] as const) {
      const world = new World(parseLevel(level(map, [...abilities], {}, 1)));
      world.update(1 / 60, { ...IDLE_INTENT, throwPressed: true, aimX: 7.5, aimY: 1.5 });
      run(world, 2.5);
      expect(world.stones[0]!.lureGlow > 0).toBe(glows);
    }
  });
});
