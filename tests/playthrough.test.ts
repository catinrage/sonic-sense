import { describe, expect, test } from "bun:test";
import { LEVELS } from "../src/game/levels";
import type { World } from "../src/game/world";
import { Bot } from "./bot";

const level = (id: string) => LEVELS.find((l) => l.id === id)!;
const doorOpen = (w: World, tx: number, ty: number) => w.doorOpen[ty * w.w + tx]! >= 0.9;

/** Scripted solutions: every chapter must be beatable by the intended strategy. */
describe("playthroughs", () => {
  test("I First Light — follow the corridors to the Gate", () => {
    const bot = new Bot(level("first-light"));
    bot.call(0.4).go(18, 14);
    expect(bot.finished).toBe(true);
  });

  test("II The Hollow Floor — cross the bridges for the shard", () => {
    const bot = new Bot(level("hollow-floor"));
    bot.call(0.8).go(11, 13, { sneak: true }).go(35, 13, { sneak: true });
    expect(bot.world.shardsCollected).toBe(1);
    expect(bot.finished).toBe(true);
  });

  test("III Resonance — ring the near bell, relay through the crystal to the far one", () => {
    const bot = new Bot(level("resonance"));
    bot.go(13, 4).call(0.3);
    bot.waitUntil("door 1", (w) => doorOpen(w, 16, 4), 5);
    bot.go(28, 3).call(1.1);
    bot.waitUntil("door 2", (w) => doorOpen(w, 29, 6), 6);
    bot.go(23, 10).go(37, 7);
    expect(bot.finished).toBe(true);
  });

  test("IV The Listener — look from afar, then creep past the guard", () => {
    const bot = new Bot(level("the-listener"));
    bot.go(11, 10).call(0.2);
    bot.go(13, 6, { sneak: true }).go(19, 3, { sneak: true }).note("shard");
    bot.go(32, 10, { sneak: true });
    expect(bot.world.wardens[0]!.state).toBe("idle");
    expect(bot.finished).toBe(true);
  });

  test("V Still Water — cross while the patrol is far, ring, then run", () => {
    const bot = new Bot(level("still-water"));
    const warden = () => bot.world.wardens[0]!;
    bot.go(13, 5).note("shard");
    // Its clicks show it heading north: cross the south of the pool now.
    bot.waitUntil("patrol heading north", () => warden().y < 6 && Math.sin(warden().heading) < -0.5, 40);
    bot.go(20, 10).go(21, 11, { sneak: true }).call(0.1).note("rang");
    bot.go(23, 8, { sneak: true });
    bot.waitUntil("door", (w) => doorOpen(w, 24, 7), 3);
    bot.go(30, 7);
    expect(bot.finished).toBe(true);
  });

  test("VI Choir of Glass — sing the crystal to draw both hunters away", () => {
    const bot = new Bot(level("choir-of-glass"));
    bot.go(11, 10).call(0.7).note("crystal");
    bot.waitUntil("hunters leave their posts", (w) => w.wardens.every((h) => h.state === "hunt" || h.state === "search"), 4);
    bot.go(12, 15).go(21, 15).go(21, 17).note("shard").go(21, 15).go(29, 14).call(0.1).note("bell");
    bot.waitUntil("door", (w) => doorOpen(w, 32, 10), 3);
    bot.go(38, 10);
    expect(bot.finished).toBe(true);
  });

  test("VII The Deep Gate — three wings, three shards", () => {
    const bot = new Bot(level("deep-gate"));
    const east = () => bot.world.wardens.find((h) => h.x > 32 && h.y > 10)!;
    // West: the chasm bridge.
    bot.go(4, 14, { sneak: true }).note("west shard");
    // North: relay a call through the crystal to open the vault, then creep past its guard.
    bot.go(15, 6).call(0.8);
    bot.waitUntil("vault door", (w) => doorOpen(w, 28, 6), 6);
    bot.go(34, 4, { sneak: true }).note("north shard").go(18, 11, { sneak: true });
    // East: wait for the patrol to reach the far end, wade along the south edge.
    bot.go(32, 16);
    bot.waitUntil("east patrol at the far end", () => east().x > 41.5 && east().state === "idle", 40);
    bot.go(33, 20).go(40, 20).go(40, 16, { sneak: true }).note("east shard");
    bot.go(40, 20).go(33, 20).go(32, 16);
    expect(bot.world.shardsCollected).toBe(3);
    bot.go(22, 14);
    expect(bot.finished).toBe(true);
  });
});
