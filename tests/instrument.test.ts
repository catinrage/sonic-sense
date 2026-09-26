import { describe, expect, test } from "bun:test";
import { World, type WorldEvents } from "../src/game/world";
import { parseLevel } from "../src/game/level-parser";
import { checkLevel } from "../src/game/level-check";
import { FULL_CALL, MIMIC_DELAY } from "../src/game/calls";
import { COLORS } from "../src/game/palette";
import { TILE, type Ability, type LevelDef } from "../src/game/level-types";
import { IDLE_INTENT, type PlayerIntent } from "../src/game/entities/player";
import type { Wave } from "../src/game/waves";

const A = 0;
const C = 1;
const E = 3;
const G = 4;

function def(map: string[], legend: LevelDef["legend"] = {}, abilities: Ability[] = []): LevelDef {
  return { id: "instrument", chapter: "0", title: "t", tagline: "", map, legend, abilities };
}

function run(world: World, seconds: number, intent: Partial<PlayerIntent> = {}): void {
  for (let t = 0; t < seconds; t += 1 / 60) world.update(1 / 60, { ...IDLE_INTENT, ...intent });
}

/** Stand at (x, y) and make a full call there. */
function callAt(world: World, x: number, y: number): void {
  world.player.x = x;
  world.player.y = y;
  run(world, 1.2, { pulseHeld: true });
  run(world, 1 / 60, { pulseReleased: true });
}

function collect<K extends keyof WorldEvents>(world: World, kind: K): WorldEvents[K][] {
  const out: WorldEvents[K][] = [];
  world.events.on(kind, (e) => out.push(e));
  return out;
}

function wavesOf(world: World, kind: Wave["kind"]): Wave[] {
  const out: Wave[] = [];
  world.events.on("wave", (e) => e.wave.kind === kind && out.push(e.wave));
  return out;
}

describe("notes", () => {
  const map = ["###########", "#@.a....T.#", "###########"];
  const legend: LevelDef["legend"] = { a: { kind: "key", note: A }, T: { kind: "crystal", note: A } };

  test("a call made on a floor key carries its note; elsewhere calls are white", () => {
    const world = new World(parseLevel(def(map, legend)));
    const calls = wavesOf(world, "pulse");
    callAt(world, 3.5, 1.5);
    run(world, 0.5);
    callAt(world, 1.5, 1.5);
    expect(calls.map((w) => w.note)).toEqual([A, null]);
  });

  test("a tuned crystal wakes only to its own note, and sings it", () => {
    const white = new World(parseLevel(def(map, legend)));
    const whiteSongs = collect(white, "crystal");
    callAt(white, 1.5, 1.5);
    run(white, 2);
    expect(whiteSongs).toHaveLength(0);

    const keyed = new World(parseLevel(def(map, legend)));
    const songs = wavesOf(keyed, "crystal");
    callAt(keyed, 3.5, 1.5);
    run(keyed, 2);
    expect(songs.map((w) => w.note)).toEqual([A]);
  });

  test("a prism wakes to anything and sings its own note; a white crystal sings white", () => {
    const world = new World(parseLevel(def(["############", "#@...P..Q..#", "############"], { P: { kind: "crystal", note: G, prism: true }, Q: { kind: "crystal" } })));
    const songs = wavesOf(world, "crystal");
    callAt(world, 1.5, 1.5);
    run(world, 2.5);
    expect(songs.map((w) => w.note).sort()).toEqual([G, null].sort());
  });
});

describe("singing glass", () => {
  // The Gate is sealed behind a pane that only E breaks.
  const map = ["##########", "#@.e..gX.#", "##########"];
  const legend: LevelDef["legend"] = { e: { kind: "key", note: E }, c: { kind: "key", note: C }, g: { kind: "glass", notes: [E] } };

  test("blocks the creature and sound until struck by its note, then breaks for good", () => {
    const world = new World(parseLevel(def(map, legend)));
    const shattered = collect(world, "glassShatter");
    expect(world.blocksPlayer(6, 1)).toBe(true);
    callAt(world, 1.5, 1.5);
    run(world, 1.5);
    expect(shattered).toHaveLength(0);
    callAt(world, 3.5, 1.5);
    run(world, 1);
    expect(shattered).toHaveLength(1);
    expect(world.tiles[1 * world.w + 6]).toBe(TILE.Floor);
    expect(world.blocksPlayer(6, 1)).toBe(false);
  });

  test("a wrong note only clinks", () => {
    const world = new World(parseLevel(def(map.map((r) => r.replace("e", "c")), legend)));
    const clinks = collect(world, "glassClink");
    callAt(world, 3.5, 1.5);
    run(world, 1);
    expect(clinks).toHaveLength(1);
    expect(world.glass[0]!.shattered).toBe(false);
  });

  test("the checker knows the key is the way through", () => {
    expect(checkLevel(parseLevel(def(map, legend))).errors).toEqual([]);
    expect(checkLevel(parseLevel(def(map.map((r) => r.replace("e", "c")), legend))).errors).toContain("exit is unreachable");
  });
});

describe("chords", () => {
  // A pane that needs A and E ringing together; the keys are a step apart.
  const map = ["############", "#@.ae.c.hX.#", "############"];
  const legend: LevelDef["legend"] = {
    a: { kind: "key", note: A },
    e: { kind: "key", note: E },
    c: { kind: "key", note: C },
    h: { kind: "glass", notes: [A, E] },
  };

  test("two notes held at once break the pane", () => {
    const world = new World(parseLevel(def(map, legend)));
    callAt(world, 3.5, 1.5);
    callAt(world, 4.5, 1.5);
    run(world, 1);
    expect(world.glass[0]!.shattered).toBe(true);
  });

  test("a note that has died away does not count", () => {
    const world = new World(parseLevel(def(map, legend)));
    callAt(world, 3.5, 1.5);
    run(world, 4);
    callAt(world, 4.5, 1.5);
    run(world, 1);
    expect(world.glass[0]!.shattered).toBe(false);
  });

  test("an off-chord note is a discord: the pane falls silent, and the discord carries", () => {
    const world = new World(parseLevel(def(map, legend)));
    const discords = wavesOf(world, "discord");
    callAt(world, 3.5, 1.5);
    callAt(world, 6.5, 1.5);
    run(world, 0.6);
    expect(discords).toHaveLength(1);
    expect(discords[0]!.alerts).toBe(true);
    expect(world.glass[0]!.heldMask).toBe(0);
    callAt(world, 4.5, 1.5);
    run(world, 1);
    expect(world.glass[0]!.shattered).toBe(false);
  });

  test("the checker proves two quick calls from neighbouring keys", () => {
    expect(checkLevel(parseLevel(def(map, legend))).errors).toEqual([]);
    const oneKey = def(map.map((r) => r.replace("e", ".")), legend);
    expect(checkLevel(parseLevel(oneKey)).errors).toContain("exit is unreachable");
  });

  test("keys too far apart to reach in time do not prove a chord", () => {
    const far = ["##############################", "#@.a..................e..h..X#", "##############################"];
    expect(checkLevel(parseLevel(def(far, legend))).errors).toContain("exit is unreachable");
  });
});

describe("the Mimic", () => {
  const hall = ["################", "#@.a.......M...#", "################"];
  const legend: LevelDef["legend"] = { a: { kind: "key", note: A }, M: { kind: "mimic" } };

  test("repeats what it hears a moment later, in the same note", () => {
    const world = new World(parseLevel(def(hall, legend)));
    const echoes = wavesOf(world, "mimic");
    callAt(world, 3.5, 1.5);
    const called = world.time;
    run(world, 0.8);
    expect(echoes).toHaveLength(0);
    run(world, MIMIC_DELAY);
    expect(echoes).toHaveLength(1);
    expect(echoes[0]!.note).toBe(A);
    expect(echoes[0]!.t0 - called).toBeGreaterThan(MIMIC_DELAY);
    run(world, 4);
    expect(echoes).toHaveLength(1);
  });

  test("echoes footsteps too, small but loud enough to hear", () => {
    const world = new World(parseLevel(def(hall, legend)));
    const echoes = wavesOf(world, "mimic");
    world.player.x = 8.5;
    run(world, 2.5, { moveX: 1 });
    expect(echoes.length).toBeGreaterThan(0);
    expect(echoes.every((w) => w.radius < FULL_CALL.radius / 2 && w.alerts)).toBe(true);
  });

  test("carries a note round a corner to glass the creature cannot reach", () => {
    // The pane is round two corners and out of the call's reach; the mimic sits by the bend.
    const map = [
      "################",
      "#@a............#",
      "#############M.#",
      "#############..#",
      "#X.........g...#",
      "################",
    ];
    const legend2: LevelDef["legend"] = { ...legend, g: { kind: "glass", notes: [A] } };
    const world = new World(parseLevel(def(map, legend2)));
    callAt(world, 2.5, 1.5);
    run(world, 4);
    expect(world.glass[0]!.shattered).toBe(true);
    expect(checkLevel(parseLevel(def(map, legend2))).errors).toEqual([]);
    expect(checkLevel(parseLevel(def(map, legend2)), { mimics: false }).errors).toContain("exit is unreachable");
  });
});

describe("speaking tubes", () => {
  // Two rooms sealed from each other; a tube joins them through the rock.
  const map = ["###########", "#@....p...#", "#1#########", "#X........#", "###########", "#q...B....#", "###########"];
  const legend: LevelDef["legend"] = { p: { kind: "tube", pair: "t" }, q: { kind: "tube", pair: "t" }, B: { kind: "bell", group: 1 } };

  test("what goes in one mouth comes out of the other, at once", () => {
    const world = new World(parseLevel(def(map, legend)));
    const tubes = wavesOf(world, "tube");
    const bells = collect(world, "bell");
    callAt(world, 3.5, 1.5);
    run(world, 2.5);
    expect(tubes).toHaveLength(1);
    expect(tubes[0]!.x).toBeLessThan(3);
    expect(bells).toHaveLength(1);
  });

  test("the checker follows the tube", () => {
    expect(checkLevel(parseLevel(def(map, legend))).errors).toEqual([]);
    expect(checkLevel(parseLevel(def(map, legend)), { tubes: false }).errors).toContain("exit is unreachable");
  });
});

describe("turning dishes", () => {
  // The dish faces north, away from the bell across the chasm. Focus turns it.
  const map = [
    "#######################",
    "#.....ooooooooooooo...#",
    "#@....ooooRoooooooB...#",
    "#.....ooooooooooooo...#",
    "#1#####################",
    "#X....................#",
    "#######################",
  ];
  const legend: LevelDef["legend"] = { R: { kind: "crystal", facing: "n", turnable: true }, B: { kind: "bell", group: 1 } };

  test("a focused call turns the dish a quarter step clockwise, and wakes nothing", () => {
    const world = new World(parseLevel(def(map, legend, ["focus"])));
    const dish = world.crystals[0]!;
    const songs = collect(world, "crystal");
    world.player.x = 5.5;
    world.player.y = 2.5;
    run(world, 1.2, { focusHeld: true, aimX: dish.x, aimY: dish.y });
    run(world, 1 / 60, { focusReleased: true, aimX: dish.x, aimY: dish.y });
    run(world, 1.5);
    expect(dish.beam).toEqual({ x: 1, y: 0 });
    expect(songs).toHaveLength(0);
    callAt(world, 5.5, 2.5);
    run(world, 3);
    expect(world.bells[0]!.ring).toBeGreaterThan(0);
  });

  test("the checker proves the turn is needed", () => {
    expect(checkLevel(parseLevel(def(map, legend, ["focus"]))).errors).toEqual([]);
    expect(checkLevel(parseLevel(def(map, legend, []))).errors).toContain("exit is unreachable");
    expect(checkLevel(parseLevel(def(map, legend, ["focus"])), { turning: false }).errors).toContain("exit is unreachable");
  });
});

describe("sluices", () => {
  // Drained silt between the creature and the far bell swallows every call; flooding it lets the call through.
  // Chasms keep the creature from simply wading out to the bell.
  const map = ["####################", "#@......oobbbbbboB.#", "#1#S################", "#X.................#", "####################"];
  const legend: LevelDef["legend"] = { S: { kind: "bell", group: 5, toggle: true }, b: { kind: "basin", group: 5, flooded: false }, B: { kind: "bell", group: 1 } };
  const sluice = (world: World) => world.bells.find((b) => b.toggle)!;

  test("a sluice bell floods drained basins and drains flooded ones", () => {
    const world = new World(parseLevel(def(map, legend)));
    const basin = 1 * world.w + 12;
    expect(world.tiles[basin]).toBe(TILE.Silt);
    sluice(world).strike(world);
    expect(world.tiles[basin]).toBe(TILE.Water);
    run(world, 1);
    sluice(world).strike(world);
    expect(world.tiles[basin]).toBe(TILE.Silt);
  });

  test("sound already travelling keeps the ground it started on", () => {
    const world = new World(parseLevel(def(map, legend)));
    const before = world.emitSound({ kind: "pulse", x: 7.5, y: 1.5, ...FULL_CALL, color: COLORS.pulse });
    sluice(world).strike(world);
    const after = world.emitSound({ kind: "pulse", x: 7.5, y: 1.5, ...FULL_CALL, color: COLORS.pulse });
    for (const w of [before, after]) w.job.advance(Infinity);
    const at = (w: Wave) => w.energyAt(w.job.sample(17.5, 1.5, { d: 0, e: 0, dx: 0, dy: 0 }));
    expect(at(after)).toBeGreaterThan(at(before) * 2);
  });

  test("the checker floods the basin to ring the far bell", () => {
    expect(checkLevel(parseLevel(def(map, legend))).errors).toEqual([]);
    const stuck = def(map, { ...legend, S: { kind: "bell", group: 5, toggle: true, threshold: 9 } });
    expect(checkLevel(parseLevel(stuck)).errors).toContain("exit is unreachable");
  });
});

describe("no feedback", () => {
  test("a bell's own ring, echoed back to it, does not ring it again", () => {
    const map = ["############", "#@....BM...#", "#1##########", "#X.........#", "############"];
    const world = new World(parseLevel(def(map, { B: { kind: "bell", group: 1 }, M: { kind: "mimic" } })));
    const bells = collect(world, "bell");
    callAt(world, 1.5, 1.5);
    run(world, 8);
    expect(bells).toHaveLength(1);
  });

  test("two mimics facing each other answer once each", () => {
    const map = ["##############", "#@...M....N..#", "##############"];
    const world = new World(parseLevel(def(map, { M: { kind: "mimic" }, N: { kind: "mimic" } })));
    const echoes = wavesOf(world, "mimic");
    callAt(world, 1.5, 1.5);
    run(world, 10);
    expect(echoes).toHaveLength(2);
  });
});
