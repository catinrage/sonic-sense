import { describe, expect, test } from "bun:test";
import { World } from "../src/game/world";
import { parseLevel } from "../src/game/level-parser";
import { LEVELS } from "../src/game/levels";
import type { LevelDef } from "../src/game/level-types";
import type { PlayerIntent } from "../src/game/entities/player";
import { TILE } from "../src/game/level-types";
import { MAX_WAVES } from "../src/game/waves";

const IDLE: PlayerIntent = {
  moveX: 0,
  moveY: 0,
  sneak: false,
  pulseHeld: false,
  pulseReleased: false,
  throwPressed: false,
  aimX: 0,
  aimY: 0,
};

function worldOf(map: string[], legend?: LevelDef["legend"], stones = 0): World {
  return new World(parseLevel({ id: "t", chapter: "0", title: "t", tagline: "", map, legend, stones }));
}

function run(world: World, seconds: number, intent: Partial<PlayerIntent> = {}): void {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) world.update(dt, { ...IDLE, ...intent });
}

/** Hold the call button for `hold` seconds, then release. */
function call(world: World, hold: number): void {
  run(world, hold, { pulseHeld: true });
  run(world, 1 / 60, { pulseHeld: false, pulseReleased: true });
}

describe("player", () => {
  test("walks and collides with walls", () => {
    const world = worldOf(["#######", "#.....#", "#..@..#", "#.....#", "#######"]);
    run(world, 3, { moveX: 1 });
    expect(world.player.x).toBeLessThan(6 - world.player.r + 0.01);
    expect(world.player.x).toBeGreaterThan(5.5);
  });

  test("a held call releases a large pulse", () => {
    const world = worldOf(["###########", "#.........#", "#....@....#", "#.........#", "###########"]);
    const pulses: number[] = [];
    world.events.on("pulse", (e) => pulses.push(e.charge));
    call(world, 1.2);
    expect(pulses.length).toBe(1);
    expect(pulses[0]).toBeGreaterThan(0.95);
    const wave = world.waves.waves.find((w) => w.kind === "pulse")!;
    expect(wave.radius).toBeGreaterThan(14);
  });

  test("falls into a pit", () => {
    const world = worldOf(["#######", "#..o..#", "#..@..#", "#.....#", "#######"]);
    let cause = "";
    world.events.on("death", (e) => (cause = e.cause));
    run(world, 1, { moveY: -1 });
    expect(cause).toBe("pit");
  });

  test("sneaking makes no creature-audible footsteps", () => {
    const world = worldOf(["###########", "#.........#", "#.@.......#", "#.........#", "###########"]);
    run(world, 1.5, { moveX: 1, sneak: true });
    expect(world.waves.waves.every((w) => !w.alerts)).toBe(true);
    run(world, 1.5, { moveX: -1 });
    expect(world.waves.waves.some((w) => w.kind === "step" && w.alerts)).toBe(true);
  });
});

describe("resonance", () => {
  test("a crystal re-emits a wave when struck", () => {
    const world = worldOf(["############", "#..........#", "#.@....C...#", "#..........#", "############"]);
    let rang = 0;
    world.events.on("crystal", () => rang++);
    call(world, 0.6);
    run(world, 1.5);
    expect(rang).toBe(1);
    expect(world.waves.waves.some((w) => w.kind === "crystal")).toBe(true);
  });

  test("Resonance: the crystal relay opens the far door", () => {
    const world = new World(parseLevel(LEVELS.find((l) => l.id === "resonance")!));
    // Stand at the trench mouth and call with most of a full breath.
    world.player.x = 28.4;
    world.player.y = 3.5;
    const bells: number[] = [];
    world.events.on("bell", (e) => bells.push(e.group));
    call(world, 1.1);
    run(world, 4);
    expect(bells).toContain(2);
    const doorIdx = 6 * world.w + 29;
    expect(world.tiles[doorIdx]).toBe(TILE.Door);
    expect(world.doorOpen[doorIdx]).toBe(1);
  });

  test("a timed door closes again", () => {
    const world = worldOf(
      ["##########", "#....o...#", "#.@..oA..#", "#....o...#", "####1#####", "#........#", "##########"],
      { A: { kind: "bell", group: 1, timed: 2 } },
    );
    call(world, 0.9);
    run(world, 2);
    const door = 4 * world.w + 4;
    expect(world.doorOpen[door]).toBe(1);
    run(world, 3);
    expect(world.doorOpen[door]).toBe(0);
  });
});

describe("wardens", () => {
  const hall = [
    "####################",
    "#..................#",
    "#.@................#",
    "#..........W.......#",
    "#..................#",
    "####################",
  ];

  test("hunt towards a sound they hear", () => {
    const world = worldOf(hall);
    const w = world.wardens[0]!;
    const startX = w.x;
    call(world, 0.9);
    run(world, 2.5);
    expect(w.state === "hunt" || w.state === "search").toBe(true);
    expect(w.x).toBeLessThan(startX - 2);
  });

  test("ignore sounds beyond their hearing", () => {
    const world = worldOf(hall);
    const w = world.wardens[0]!;
    call(world, 0.05);
    run(world, 1.5);
    expect(w.state === "idle" || w.state === "patrol").toBe(true);
  });

  test("catch a player that walks into them", () => {
    const world = worldOf(["####################", "#..................#", "#.@........W.......#", "#..................#", "####################"]);
    let cause = "";
    world.events.on("death", (e) => (cause = e.cause));
    run(world, 4, { moveX: 1 });
    expect(cause).toBe("warden");
  });

  test("are lured by a thrown stone", () => {
    const world = worldOf(hall, undefined, 1);
    const w = world.wardens[0]!;
    world.update(1 / 60, { ...IDLE, throwPressed: true, aimX: 9.5, aimY: 1.2 });
    run(world, 3.5);
    expect(world.player.stones).toBe(0);
    expect(w.y).toBeLessThan(2.4);
    expect(w.state === "hunt" || w.state === "search").toBe(true);
  });
});

describe("goals", () => {
  test("shards wake the gate and the gate completes the level", () => {
    const world = worldOf(["#########", "#.@.*.X.#", "#########"]);
    expect(world.exit!.active).toBe(false);
    let complete = false;
    world.events.on("complete", () => (complete = true));
    run(world, 2.5, { moveX: 1 });
    expect(world.shardsCollected).toBe(1);
    expect(world.exit!.active).toBe(true);
    expect(complete).toBe(true);
  });
});

describe("wave layers", () => {
  /**
   * Texture layers are a rendering budget, not a simulation one. A wave that
   * loses its layer must still be heard, or a relayed sound can vanish and
   * break a puzzle the solvability checker proved solvable.
   */
  test("a wave evicted from its texture layer is still heard", () => {
    // A long corridor, so the front is still travelling when eviction happens.
    // 12 tiles: far enough that the front is still in flight, near enough to
    // still carry threshold energy when it lands.
    const map = ["#".repeat(16), "#@" + ".".repeat(12) + "C#", "#".repeat(16)];
    const world = worldOf(map);
    const crystal = world.crystals[0]!;
    let sang = false;
    world.events.on("crystal", () => (sang = true));

    // A low-priority wave, so the flood below will take its layer.
    const travelling = world.emitSound({
      kind: "step",
      x: world.player.x,
      y: world.player.y,
      radius: 26,
      strength: 1.25,
      speed: 8,
      fade: 4,
      color: [1, 1, 1],
    });
    expect(travelling.layer).toBeGreaterThanOrEqual(0);
    expect(crystal.pending).toBe(-1); // front has not reached it yet

    // Fill every layer with higher-priority waves.
    for (let i = 0; i < MAX_WAVES; i++) {
      world.emitSound({ kind: "pulse", x: 2, y: 1, radius: 1, color: [1, 1, 1] });
    }

    expect(travelling.layer).toBe(-1); // lost its reveal...
    expect(world.waves.waves).toContain(travelling); // ...but not its physics

    run(world, 3.5);
    expect(sang).toBe(true);
  });
});
