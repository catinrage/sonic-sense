import { describe, expect, test } from "bun:test";
import { World } from "../src/game/world";
import { parseLevel } from "../src/game/level-parser";
import { checkLevel } from "../src/game/level-check";
import { FULL_CALL } from "../src/game/calls";
import { COLORS } from "../src/game/palette";
import { TILE, type Facing, type LevelDef } from "../src/game/level-types";
import { IDLE_INTENT, type PlayerIntent } from "../src/game/entities/player";

const IDLE: PlayerIntent = IDLE_INTENT;

const def = (map: string[], legend: LevelDef["legend"] = {}): LevelDef => ({ id: "props", chapter: "0", title: "t", tagline: "", map, legend });

function run(world: World, seconds: number, intent: Partial<PlayerIntent> = {}): void {
  for (let t = 0; t < seconds; t += 1 / 60) world.update(1 / 60, { ...IDLE, ...intent });
}

/** A full-breath call from (x, y), exactly as the creature would make it. */
function callFrom(world: World, x: number, y: number): void {
  world.emitSound({ kind: "pulse", x, y, ...FULL_CALL, color: COLORS.pulse, source: world.player, alerts: true, hits: true });
}

describe("baffle", () => {
  const map = ["###########", "#@..%...B.#", "#1#########", "#X........#", "###########"];
  const legend: LevelDef["legend"] = { B: { kind: "bell", group: 1 } };

  test("stops sound dead", () => {
    const open = new World(parseLevel(def(map.map((r) => r.replace("%", ".")), legend)));
    callFrom(open, 1.5, 1.5);
    run(open, 2);
    expect(open.bells[0]!.ring).toBeGreaterThan(0);

    const muffled = new World(parseLevel(def(map, legend)));
    callFrom(muffled, 1.5, 1.5);
    run(muffled, 2);
    expect(muffled.bells[0]!.ring).toBe(0);
  });

  test("lets the creature walk straight through", () => {
    const world = new World(parseLevel(def(map, legend)));
    run(world, 2, { moveX: 1 });
    expect(world.player.x).toBeGreaterThan(5.5);
    expect(checkLevel(parseLevel(def(map, legend))).reachable[1 * 11 + 4]).toBe(1);
  });
});

describe("resonator", () => {
  // The bell lies across a chasm, beyond the reach of any call. A resonator on an
  // island in the chasm can carry the song to it — but only if its dish faces the bell.
  const map = [
    "#######################",
    "#.....ooooooooooooo...#",
    "#@....ooooRoooooooB...#",
    "#.....ooooooooooooo...#",
    "#1#####################",
    "#X....................#",
    "#######################",
  ];
  const aimed = (facing: Facing) => def(map, { R: { kind: "resonator", facing }, B: { kind: "bell", group: 1 } });

  test("the checker proves the level needs the dish aimed at the bell", () => {
    expect(checkLevel(parseLevel(aimed("e"))).errors).toEqual([]);
    expect(checkLevel(parseLevel(aimed("w"))).errors).toContain("exit is unreachable");
    const crystal = def(map.map((r) => r.replace("R", "C")), { B: { kind: "bell", group: 1 } });
    expect(checkLevel(parseLevel(crystal)).errors).toContain("exit is unreachable");
  });

  test("in the game, an aimed resonator rings the far bell and a turned one does not", () => {
    for (const [facing, rings] of [
      ["e", true],
      ["w", false],
    ] as const) {
      const world = new World(parseLevel(aimed(facing)));
      callFrom(world, 5.5, 2.5);
      run(world, 4);
      expect(world.bells[0]!.ring > 0).toBe(rings);
    }
  });
});

describe("wind chime", () => {
  const chimes = (world: World) => {
    let n = 0;
    world.events.on("chime", () => n++);
    return () => n;
  };

  test("rings by itself in a draft, and hangs silent in still air", () => {
    const windy = new World(parseLevel(def(["############", "#@.........#", "#..>>&>>...#", "#..........#", "############"])));
    expect(windy.tileAt(5, 2)).toBe(TILE.Draft);
    const rang = chimes(windy);
    run(windy, 12);
    expect(rang()).toBeGreaterThanOrEqual(2);

    const still = new World(parseLevel(def(["############", "#@.........#", "#.....&....#", "#..........#", "############"])));
    const quiet = chimes(still);
    run(still, 12);
    expect(quiet()).toBe(0);
  });

  test("draws hunters to it", () => {
    const world = new World(parseLevel(def(["##############", "#@...........#", "#..>>&>>.....#", "#.........W..#", "##############"])));
    run(world, 8);
    expect(["alert", "hunt", "search"]).toContain(world.wardens[0]!.state);
  });
});
