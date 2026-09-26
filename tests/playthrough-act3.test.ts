import { describe, expect, test } from "bun:test";
import { LEVELS } from "../src/game/levels";
import type { World } from "../src/game/world";
import type { Warden } from "../src/game/entities/warden";
import { Bot } from "./bot";

const level = (id: string) => {
  const def = LEVELS.find((l) => l.id === id);
  if (!def) throw new Error(`no level "${id}"`);
  return def;
};
/** The pane with a tile at (tx, ty). */
const pane = (w: World, tx: number, ty: number) => w.glass.find((g) => g.spawn.tiles.includes(ty * w.w + tx))!;

/** Scripted solutions for the Act III chapters, played through the real simulation. */
describe("act III playthroughs", () => {
  test("XV The Tuning Hall — the right key for each pane, and a quiet voice where the patrol walks", () => {
    const bot = new Bot(level("the-tuning-hall"));
    const walker = bot.world.wardens[0]!;
    bot.go(7, 11).call(1.2).note("E, on the E key");
    bot.waitUntil("the first pane shatters", (w) => pane(w, 9, 9).shattered, 3);
    bot.go(13, 9).waitUntil("the walker far to the east", () => walker.x > 28, 60);
    bot.go(21, 6).focus(1.1, 20.5, 3.5).note("a quiet D at the shard's pane");
    bot.waitUntil("the shard's pane shatters", (w) => pane(w, 20, 3).shattered, 3);
    bot.go(20, 1).note("shard").go(20, 2);
    bot.waitUntil("the walker back at its west end", () => walker.x < 20, 60);
    bot.go(27, 13).focus(1.1, 37.5, 6.5).note("a quiet G at the tuned crystal");
    bot.waitUntil("the Gate's pane shatters", (w) => pane(w, 37, 3).shattered, 5);
    bot.go(37, 1);
    expect(bot.world.shardsCollected).toBe(1);
    expect(bot.finished).toBe(true);
  });

  test("XVI Echo of an Echo — two notes down one tube, one round the bend by the mimic, past a sleeper", () => {
    const bot = new Bot(level("echo-of-an-echo"));
    const sleeper = bot.world.wardens[0]!;
    bot.go(5, 14).call(1.2).note("C into the tube");
    bot.waitUntil("the way on opens", (w) => pane(w, 24, 12).shattered, 3);
    bot.go(3, 14).call(1.2).note("A into the tube");
    bot.waitUntil("the shard room opens", (w) => pane(w, 21, 11).shattered, 3);
    bot.go(21, 9).note("shard").go(29, 13);
    bot.focus(1.1, 33, 8.2).note("a quiet E up the passage, for the mimic");
    bot.waitUntil("the mimic's echo breaks the Gate's glass", (w) => pane(w, 38, 2).shattered, 5);
    expect(sleeper.state).toBe("idle");
    bot.go(33, 6, { sneak: true }).go(41, 2);
    expect(bot.world.shardsCollected).toBe(1);
    expect(bot.finished).toBe(true);
  });

  test("XVII The Turning Dishes — turn one dish from the ledge, the other from the far end, then sing", () => {
    const bot = new Bot(level("the-turning-dishes"));
    const walker = bot.world.wardens[0]!;
    const [near, far] = bot.world.crystals;
    const east = (w: Warden) => Math.cos(w.heading) > 0.5;
    const west = (w: Warden) => Math.cos(w.heading) < -0.5;
    bot.go(18, 9).focus(1.1, near!.x, near!.y).note("the near dish turns to face the far one");
    bot.wait(1);
    expect(near!.beam).toEqual({ x: 1, y: 0 });
    // Slip into the corridor behind the walker, and let it pass back in an alcove.
    bot.go(3, 3).waitUntil("the walker heading east, well ahead", () => east(walker) && walker.x > 19, 60);
    bot.go(22, 1).note("in an alcove").waitUntil("the walker gone back west", () => west(walker) && walker.x < 18, 60);
    bot.go(37, 2).note("past the patrol");
    for (let i = 0; i < 2; i++) bot.focus(1.1, far!.x, far!.y).wait(0.8);
    expect(far!.beam).toEqual({ x: 0, y: -1 });
    // Back to the ledge: into an alcove while it turns at its west end, then out behind it.
    bot.waitUntil("the walker near its west end", () => west(walker) && walker.x < 16, 60);
    bot.go(22, 1).note("in an alcove").waitUntil("the walker gone east past the alcove", () => east(walker) && walker.x > 26, 60);
    bot.go(19, 9).waitUntil("the walker at the far end", () => walker.x > 27, 60);
    bot.call(1.2).note("G: the near dish sings to the far one, and the far one to the glass");
    bot.waitUntil("the Gate's glass shatters", (w) => pane(w, 39, 2).shattered, 6);
    bot.go(3, 3).waitUntil("the walker heading east, well ahead", () => east(walker) && walker.x > 19, 60);
    bot.go(22, 1).waitUntil("the walker gone back west", () => west(walker) && walker.x < 18, 60);
    bot.go(42, 2);
    expect(bot.finished).toBe(true);
  });

  test("XVIII Chord — two quick notes, a prism's note on a far key, and nothing that sings the wrong one", () => {
    const bot = new Bot(level("chord"));
    const walker = bot.world.wardens[0]!;
    const west = (w: Warden) => Math.cos(w.heading) < -0.5;
    bot.go(6, 13).call(1.2).go(7, 13).call(1.2).note("A, then E, while the A still rings");
    bot.waitUntil("the chord breaks the first pane", (w) => pane(w, 10, 11).shattered, 3);
    bot.go(17, 13).waitUntil("the walker at its west end", () => walker.x < 20.5, 60);
    bot.go(36, 12, { sneak: true }).call(1.2).note("C from the far key: the G prism answers, the D prism never hears");
    bot.waitUntil("the Gate's chord breaks", (w) => pane(w, 29, 3).shattered, 4);
    bot.waitUntil("the walker back at its west end", () => walker.x < 20.5, 60);
    bot.go(30, 13).focus(1.1, 39.5, 6.5).note("a quiet E at the tuned crystal and the prism beside it");
    bot.waitUntil("the thick glass breaks", (w) => pane(w, 41, 6).shattered, 5);
    bot.go(44, 4).note("shard");
    bot.waitUntil("the walker heading back west", () => west(walker) && walker.x < 25, 80);
    bot.go(29, 1);
    expect(bot.world.shardsCollected).toBe(1);
    expect(bot.finished).toBe(true);
  });
});
