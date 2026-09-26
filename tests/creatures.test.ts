import { describe, expect, test } from "bun:test";
import { World } from "../src/game/world";
import { parseLevel } from "../src/game/level-parser";
import type { LevelDef } from "../src/game/level-types";
import { IDLE_INTENT, type PlayerIntent } from "../src/game/entities/player";

const IDLE: PlayerIntent = IDLE_INTENT;

function worldOf(map: string[], legend: LevelDef["legend"] = {}, stones = 0): World {
  return new World(parseLevel({ id: "creatures", chapter: "0", title: "t", tagline: "", map, legend, stones }));
}

function run(world: World, seconds: number, intent: Partial<PlayerIntent> = {}): void {
  for (let t = 0; t < seconds; t += 1 / 60) world.update(1 / 60, { ...IDLE, ...intent });
}

function call(world: World, hold: number): void {
  run(world, hold, { pulseHeld: true });
  run(world, 1 / 60, { pulseReleased: true });
}

/** Loud (creature-audible) alarm cries emitted so far. */
function countAlarms(world: World): () => number {
  let n = 0;
  world.events.on("wave", (e) => e.wave.kind === "wardenAlert" && e.wave.loudness > 0 && n++);
  return () => n;
}

const hall = (row: string) => ["##############################", "#............................#", row, "#............................#", "##############################"];

describe("chorus", () => {
  test("one hunter's alarm rallies the pack — and does not echo forever", () => {
    // A hears the quick call (4 tiles); B is too far for the call (10) but inside A's cry (6).
    const world = worldOf(hall("#.@...A.....B................#"), {
      A: { kind: "warden", creature: "chorus" },
      B: { kind: "warden", creature: "chorus" },
    });
    const alarms = countAlarms(world);
    call(world, 0.05);
    run(world, 2);
    const [a, b] = world.wardens;
    expect(a!.state === "hunt" || a!.state === "search").toBe(true);
    expect(b!.state === "hunt" || b!.state === "search" || b!.state === "alert").toBe(true);
    run(world, 25);
    expect(alarms()).toBe(1);
  });
});

describe("sentinel", () => {
  test("never leaves its post, calls on its own, and screams for help", () => {
    // The call reaches the sentinel (4 tiles) but not the warden (16); the scream (12) does.
    const world = worldOf(hall("#.@...S...........W..........#"), {
      S: { kind: "warden", creature: "sentinel" },
    });
    const [sentinel, warden] = world.wardens;
    let calls = 0;
    world.events.on("sentinelCall", () => calls++);
    const home = { x: sentinel!.x, y: sentinel!.y };
    call(world, 0.05);
    run(world, 6);
    expect(sentinel!.x).toBeCloseTo(home.x, 6);
    expect(sentinel!.y).toBeCloseTo(home.y, 6);
    expect(calls).toBeGreaterThan(0);
    // The plain warden was far out of the call's reach; only the scream could move it.
    expect(warden!.x).toBeLessThan(18);
  });
});

describe("stalker", () => {
  test("prowls around the spot it heard you instead of standing still", () => {
    const world = worldOf(hall("#.@.....P.....................#"), { P: { kind: "warden", creature: "stalker" } });
    const stalker = world.wardens[0]!;
    call(world, 0.3);
    run(world, 6);
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      run(world, 0.5);
      if (stalker.state === "search") seen.add(`${Math.round(stalker.x)},${Math.round(stalker.y)}`);
    }
    expect(seen.size).toBeGreaterThan(2);
  });
});

describe("tremor", () => {
  const map = hall("#.@..........T...............#");
  const legend: LevelDef["legend"] = { T: { kind: "warden", creature: "tremor" } };

  test("is deaf to calls, however loud", () => {
    const world = worldOf(map, legend);
    call(world, 1.2);
    run(world, 3);
    expect(world.wardens[0]!.state === "idle" || world.wardens[0]!.state === "patrol").toBe(true);
  });

  test("feels footsteps through the floor", () => {
    const world = worldOf(map, legend);
    run(world, 2.2, { moveX: 1 });
    expect(["alert", "hunt", "search"]).toContain(world.wardens[0]!.state);
  });

  test("does not feel a sneak at the same distance", () => {
    const world = worldOf(map, legend);
    run(world, 4.5, { moveX: 1, sneak: true });
    expect(world.wardens[0]!.state === "idle" || world.wardens[0]!.state === "patrol").toBe(true);
  });

  test("feels a stone striking the floor", () => {
    const world = worldOf(map, legend, 1);
    world.update(1 / 60, { ...IDLE, throwPressed: true, aimX: 9.5, aimY: 3.4 });
    run(world, 2);
    expect(["alert", "hunt", "search"]).toContain(world.wardens[0]!.state);
  });
});

describe("patrols", () => {
  test("walk the whole of a long leg instead of turning back halfway", () => {
    const row = "#.@" + ".".repeat(34) + "#";
    const map = ["#".repeat(row.length), row.replace("@.", "@a").replace(/\.#$/, "b#"), "#" + ".".repeat(row.length - 2) + "#", "#".repeat(row.length)];
    map[2] = map[2]!.slice(0, 4) + "P" + map[2]!.slice(5);
    const world = worldOf(map, { P: { kind: "warden", route: "ba" }, a: { kind: "waypoint" }, b: { kind: "waypoint" } });
    const warden = world.wardens[0]!;
    let furthest = 0;
    for (let t = 0; t < 45; t += 1 / 60) {
      world.update(1 / 60, IDLE);
      furthest = Math.max(furthest, warden.x);
    }
    expect(furthest).toBeGreaterThan(35);
  });
});

describe("metronome", () => {
  const room = ["##################", "#................#", "#..@......N......#", "#................#", "##################"];
  const legend: LevelDef["legend"] = { N: { kind: "warden", creature: "metronome" } };

  test("keeps a strict beat, with a count-in before each pulse", () => {
    const world = worldOf(room, legend);
    const ticks: number[] = [];
    const pulses: number[] = [];
    world.events.on("metronomeTick", () => ticks.push(world.time));
    world.events.on("metronomePulse", () => pulses.push(world.time));
    run(world, 10);
    expect(pulses.length).toBe(3);
    for (let i = 1; i < pulses.length; i++) expect(pulses[i]! - pulses[i - 1]!).toBeCloseTo(3, 1);
    ticks.forEach((t, i) => expect(pulses[i]! - t).toBeCloseTo(0.7, 1));
  });

  test("is deaf: a full call does not move it", () => {
    const world = worldOf(room, legend);
    call(world, 1.2);
    run(world, 2);
    expect(world.wardens[0]!.state).toBe("idle");
  });

  test("sees what moves as its pulse passes, and not what keeps still", () => {
    const still = worldOf(room, legend);
    run(still, 4);
    expect(still.wardens[0]!.state).toBe("idle");

    const moving = worldOf(room, legend);
    let spotted = false;
    for (let t = 0; t < 4 && !spotted; t += 1 / 60) {
      moving.update(1 / 60, { ...IDLE, moveY: Math.sin(t * 6) > 0 ? 1 : -1 });
      spotted = moving.wardens[0]!.state !== "idle";
    }
    expect(spotted).toBe(true);
  });
});

describe("conductor", () => {
  test("hears a discord struck anywhere, however far, and goes to it", () => {
    const map = [
      "##########################################",
      "#K.....................................###",
      "#.......................................h#",
      "#......................................@e#",
      "##########################################",
    ];
    const world = worldOf(map, { K: { kind: "warden", creature: "conductor" }, h: { kind: "glass", notes: [0, 4] }, e: { kind: "key", note: 3 } });
    const conductor = world.wardens[0]!;
    world.player.x = 40.5;
    world.player.y = 3.5;
    // An E at a pane that wants A and G: far too far away for the call itself to be heard, but a discord.
    const discords: number[] = [];
    world.events.on("discord", () => discords.push(world.time));
    call(world, 1.2);
    run(world, 0.5);
    expect(discords).toHaveLength(1);
    expect(conductor.state === "alert" || conductor.state === "hunt").toBe(true);
    run(world, 3);
    expect(conductor.x).toBeGreaterThan(5);
  });

  test("never gives up a hunt on the way", () => {
    const traits = worldOf(["#####", "#K@.#", "#####"], { K: { kind: "warden", creature: "conductor" } }).wardens[0]!.traits;
    expect(traits.giveUpAfter).toBe(Infinity);
    expect(traits.hearsDiscord).toBe(true);
  });
});
