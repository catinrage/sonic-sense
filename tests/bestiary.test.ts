import { describe, expect, test } from "bun:test";
import { BESTIARY, bestiaryStage, firstMet, hearsCalls, STAGE_CENTRE, type BestiaryId } from "../src/game/bestiary";
import { CREATURE_KINDS, creatureTraits } from "../src/game/entities/warden-traits";
import { IDLE_INTENT } from "../src/game/entities/player";
import { parseLevel } from "../src/game/level-parser";
import { LEVELS } from "../src/game/levels";
import { World } from "../src/game/world";
import type { Wave } from "../src/game/waves";
import { voicePath } from "../src/ui/bestiary-view";

const stageWorld = (id: BestiaryId | null) => new World(parseLevel(bestiaryStage(id)));

function run(world: World, seconds: number): void {
  for (let t = 0; t < seconds; t += 1 / 60) world.update(1 / 60, IDLE_INTENT);
}

describe("bestiary entries", () => {
  test("every creature and the Mimic has exactly one page", () => {
    const ids = BESTIARY.map((e) => e.id);
    const every: BestiaryId[] = [...CREATURE_KINDS, "mimic"];
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(every.sort());
  });

  test("pages run in the order the creatures are first heard on the way down", () => {
    const met = firstMet();
    const order = BESTIARY.map((e) => met.get(e.id));
    for (const at of order) expect(at).toBeDefined();
    expect(order).toEqual([...order].sort((a, b) => a! - b!));
    // The first hunter is met in The Listener; the last is the Conductor, in the final chapter.
    expect(LEVELS[met.get("warden")!]!.title).toBe("The Listener");
    expect(met.get("conductor")).toBe(LEVELS.length - 1);
  });

  test("each page is complete: colour, meters in range, ways and how to live", () => {
    for (const e of BESTIARY) {
      expect(e.accent).toMatch(/^#[0-9a-f]{6}$/i);
      for (const v of Object.values(e.meters)) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(5);
      }
      expect(e.ways.length).toBeGreaterThan(0);
      expect(e.live.length).toBeGreaterThan(0);
      expect(e.heard.length).toBeGreaterThan(0);
    }
  });

  test("its senses agree with how the creature is made", () => {
    for (const e of BESTIARY) {
      if (e.id === "mimic") continue;
      const t = creatureTraits(e.id);
      expect(e.senses.air).toBe(t.hearsAir);
      expect(e.senses.ground).toBe(t.feelsSteps > 0);
      expect(e.senses.beat).toBe(t.beat > 0);
      expect(e.senses.discord).toBe(t.hearsDiscord);
      // Rooted creatures never walk; the page must not say otherwise.
      if (t.anchored) expect(e.meters.speed).toBe(0);
    }
  });

  test("calling on its page only rouses what hears the air", () => {
    expect(hearsCalls("warden")).toBe(true);
    expect(hearsCalls("conductor")).toBe(true);
    expect(hearsCalls("tremor")).toBe(false);
    expect(hearsCalls("metronome")).toBe(false);
    expect(hearsCalls("mimic")).toBe(false);
  });

  test("each voice trace is a finite path that loops seamlessly", () => {
    for (const id of [...BESTIARY.map((e) => e.id), null]) {
      const d = voicePath(id);
      expect(d.startsWith("M")).toBe(true);
      const nums = d.slice(1).split(/[L ]/).map(Number);
      expect(nums.every(Number.isFinite)).toBe(true);
      // Two copies side by side: the first point and the one a loop later sit at the same height.
      const ys = nums.filter((_, i) => i % 2 === 1);
      expect(ys[0]).toBeCloseTo(ys[(ys.length - 1) / 2]!, 1);
    }
  });
});

describe("bestiary stage", () => {
  test("each creature stands alone at the heart of its chamber", () => {
    for (const e of BESTIARY) {
      const world = stageWorld(e.id);
      if (e.id === "mimic") {
        expect(world.wardens).toHaveLength(0);
        expect(world.mimics).toHaveLength(1);
        expect(world.mimics[0]!.x).toBe(STAGE_CENTRE.x);
        expect(world.mimics[0]!.y).toBe(STAGE_CENTRE.y);
        continue;
      }
      expect(world.wardens).toHaveLength(1);
      const w = world.wardens[0]!;
      expect(w.traits.kind).toBe(e.id);
      expect(w.x).toBe(STAGE_CENTRE.x);
      expect(w.y).toBe(STAGE_CENTRE.y);
    }
  });

  test("an unheard page shows the chamber empty", () => {
    const world = stageWorld(null);
    expect(world.wardens).toHaveLength(0);
    expect(world.mimics).toHaveLength(0);
  });

  test("a posed creature walks where it is put, legs striding, and hunts nothing", () => {
    const world = stageWorld("warden");
    const w = world.wardens[0]!;
    w.deaf = true;
    world.player.invulnerable = true;
    for (let i = 0; i < 120; i++) {
      const x = STAGE_CENTRE.x + i * 0.008;
      w.pose(x, STAGE_CENTRE.y, 0, 0.4);
      world.update(1 / 60, IDLE_INTENT);
      expect(w.x).toBeCloseTo(x, 6);
    }
    expect(w.moving).toBeGreaterThan(0.2);
    expect(w.state).toBe("idle");
    expect(world.player.dying).toBeNull();
  });

  test("startled, it flares and cries — a cry that calls no one", () => {
    const world = stageWorld("chorus");
    const w = world.wardens[0]!;
    w.deaf = true;
    const cries: Wave[] = [];
    let alerts = 0;
    world.events.on("wave", (e) => e.wave.kind === "wardenAlert" && cries.push(e.wave));
    world.events.on("wardenAlert", () => alerts++);
    const calm = w.frill;
    w.startle(world);
    run(world, 0.4);
    expect(alerts).toBe(1);
    expect(cries).toHaveLength(1);
    expect(cries[0]!.alerts).toBe(false);
    expect(cries[0]!.loudness).toBe(0);
    expect(w.frill).toBeGreaterThan(calm + 0.4);
    expect(w.state).toBe("idle");
    // The flare passes.
    run(world, 4);
    expect(w.frill).toBeLessThan(0.5);
  });

  test("its own voice still sounds, deaf or not: the sentinel calls and lights its hall", () => {
    const world = stageWorld("sentinel");
    world.wardens[0]!.deaf = true;
    let calls = 0;
    world.events.on("sentinelCall", () => calls++);
    run(world, 6);
    expect(calls).toBeGreaterThan(0);
  });
});
