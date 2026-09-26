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
const doorOpen = (w: World, tx: number, ty: number) => w.doorOpen[ty * w.w + tx]! >= 0.9;

/** Scripted solutions for the Act II chapters whose danger the static checker cannot see. */
describe("act II playthroughs", () => {
  test("VIII The Silt Flats — watch the patrols by their clicks, cross each causeway behind them", () => {
    const bot = new Bot(level("silt-flats"));
    const [westPatrol, eastPatrol] = [...bot.world.wardens].sort((a, b) => a.x - b.x);
    const west = () => westPatrol!;
    const east = () => eastPatrol!;
    bot.wait(2).note("listening");
    bot.go(13, 16).note("first shard").go(15, 11);
    bot.waitUntil("the western patrol climbs the island", () => west().y < 6 && west().x > 25, 60);
    bot.go(24, 9).go(27, 16).note("hidden in the island's silt");
    bot.waitUntil("the western patrol back on the west rim", () => west().x < 17, 60);
    bot.go(27, 3).note("second shard").go(28, 11).go(31, 14);
    bot.waitUntil("the eastern patrol at its north end", () => east().y < 7.5, 60);
    bot.go(42, 10);
    expect(bot.world.shardsCollected).toBe(2);
    expect(bot.finished).toBe(true);
  });

  test("IX What Walks Below — move while they walk away, freeze while they pass", () => {
    const bot = new Bot(level("what-walks-below"));
    const lower = bot.world.wardens.find((w) => w.y > 12)!;
    const upper = bot.world.wardens.find((w) => w.y < 12)!;
    const eastbound = (w: Warden) => Math.cos(w.heading) > 0.5;
    const westbound = (w: Warden) => Math.cos(w.heading) < -0.5;
    bot.call(0.8).note("calls are safe");
    // Lower hall: trail the walker east, freeze in a niche while it comes back, then take the shard.
    bot.waitUntil("lower walker far down the hall", () => eastbound(lower) && lower.x > 26, 80);
    bot.go(29, 19).note("in a niche");
    bot.waitUntil("lower walker back past the niche", () => westbound(lower) && lower.x < 24, 60);
    bot.go(40, 17).note("first shard").go(24, 16);
    // Up the flooded shaft, only while nothing walks above it.
    bot.waitUntil("upper hall quiet above the shaft", () => Math.abs(upper.x - 24.5) > 7, 60);
    bot.go(24, 9, { sneak: true }).note("upper hall");
    bot.waitUntil("upper walker heading east", () => eastbound(upper) && upper.x > 30, 80);
    bot.go(8, 7).note("second shard").go(9, 9);
    // Let it come all the way back past us and turn, then follow it to the Gate's door.
    bot.waitUntil("upper walker coming back", () => westbound(upper) && upper.x < 20, 90);
    bot.waitUntil("upper walker heading east again", () => eastbound(upper) && upper.x > 33, 90);
    bot.go(35, 2);
    expect(bot.world.shardsCollected).toBe(2);
    expect(bot.finished).toBe(true);
  });

  test("X The Breathing Halls — ride the wind, whisper to the heavy bell, slip between the pacing listeners", () => {
    const bot = new Bot(level("breathing-halls"));
    const [upper, lower] = [...bot.world.wardens].sort((a, b) => a.y - b.y);
    const northbound = (w: Warden) => Math.sin(w.heading) < -0.5;
    const southbound = (w: Warden) => Math.sin(w.heading) > 0.5;
    bot.go(13, 4).call(1.2).note("the ridge carries the call");
    bot.waitUntil("door 1", (w) => doorOpen(w, 5, 9), 6);
    bot.go(8, 13).focus(1, 10.5, 13.5).note("heavy bell");
    bot.waitUntil("door 2", (w) => doorOpen(w, 13, 13), 4);
    // Round the top of the maze and down its middle, to wait by the first listener's crossing.
    bot.go(17, 10, { sneak: true }).go(24, 10, { sneak: true }).go(24, 17, { sneak: true }).go(27, 17, { sneak: true });
    bot.waitUntil("the lower listener leaving the causeway", () => (lower!.y < 16 && northbound(lower!)) || (lower!.y > 19 && southbound(lower!)), 40);
    bot.go(33, 17, { sneak: true }).go(33, 10, { sneak: true }).note("by the second crossing");
    bot.waitUntil("the upper listener at its south end", () => upper!.y > 12.4, 40);
    bot.go(37, 9, { sneak: true }).note("shard");
    bot.waitUntil("the upper listener back at its north end", () => upper!.y < 8.8 && upper!.state === "idle", 40);
    bot.go(41, 14, { sneak: true });
    expect(bot.world.shardsCollected).toBe(1);
    expect(bot.finished).toBe(true);
  });

  test("XI The Watcher — borrow its light, take the shard from under it, slip past both patrols", () => {
    const bot = new Bot(level("the-watcher"));
    const hunters = bot.world.wardens.filter((w) => w.traits.kind === "warden");
    const north = hunters.find((w) => w.y < 7)!;
    const south = hunters.find((w) => w.y > 17)!;
    const west = hunters.find((w) => w.x > 14 && w.x < 16)!;
    const sentinel = bot.world.wardens.find((w) => w.traits.kind === "sentinel")!;
    const northbound = (w: Warden) => Math.sin(w.heading) < -0.5;
    const southbound = (w: Warden) => Math.sin(w.heading) > 0.5;
    const eastbound = (w: Warden) => Math.cos(w.heading) > 0.5;
    const westbound = (w: Warden) => Math.cos(w.heading) < -0.5;
    bot.wait(4).note("listening by the Watcher's light");
    bot.waitUntil("south patrol heading east, far away", () => eastbound(south!) && south!.x > 20, 60);
    bot.go(11, 12, { sneak: true }).note("beside the west patrol's beat");
    bot.waitUntil("west patrol heading to its north end", () => northbound(west) && west.y < 10, 60);
    bot.go(20, 12, { sneak: true }).note("island shard");
    bot.waitUntil("west patrol heading to its south end", () => southbound(west) && west.y > 14, 60);
    bot.go(16, 7, { sneak: true });
    // Follow the north patrol along its corridor, and step aside onto the east side before it turns.
    bot.waitUntil("north patrol just past us, walking east", () => north!.state === "patrol" && eastbound(north!) && north!.x > 22 && north!.x < 25, 90);
    bot.go(29, 9, { sneak: true }).note("aside");
    bot.go(33, 12, { sneak: true }).note("east shard");
    bot.waitUntil("north patrol walking away west", () => westbound(north!) && north!.x < 25, 60);
    bot.go(40, 6, { sneak: true });
    expect(sentinel.state).toBe("idle");
    expect(bot.world.shardsCollected).toBe(2);
    expect(bot.finished).toBe(true);
  });

  test("XII Choir of Many — take the loft's shard in silence, lure the choir down, ring and run", () => {
    const bot = new Bot(level("choir-of-many"));
    const patrol = bot.world.wardens.find((w) => w.y < 6)!;
    const choir = bot.world.wardens.filter((w) => w !== patrol);
    const eastbound = (w: Warden) => Math.cos(w.heading) > 0.5;
    const westbound = (w: Warden) => Math.cos(w.heading) < -0.5;
    bot.waitUntil("the north voice walking east, past the shard", () => eastbound(patrol) && patrol.x > 21, 60);
    bot.go(16, 4, { sneak: true }).note("first shard").go(16, 9, { sneak: true });
    bot.go(27, 16, { sneak: true }).go(33, 20, { sneak: true }).note("loft shard, beside the choir");
    bot.go(27, 18, { sneak: true }).go(25, 15, { sneak: true });
    bot.waitUntil("the north voice heading back west", () => westbound(patrol) && patrol.x < 26, 60);
    bot.throwAt(30.5, 19.5).note("lure thrown");
    bot.waitUntil("the whole choir goes down into the loft", () => choir.every((h) => h.y > 17), 12);
    bot.waitUntil("the north voice far west", () => patrol.x < 20, 20);
    bot.go(28, 5).focus(1, 32.5, 4.5).note("bell");
    bot.waitUntil("door", (w) => doorOpen(w, 34, 13), 4);
    bot.go(39, 13);
    expect(bot.world.shardsCollected).toBe(2);
    expect(bot.finished).toBe(true);
  });

  test("XII Choir of Many — ringing the bell under their noses brings the choir down", () => {
    const bot = new Bot(level("choir-of-many"));
    bot.go(16, 4, { sneak: true }).go(26, 8, { sneak: true }).call(0.3);
    bot.waitUntil("the choir answers as one", () => bot.world.wardens.every((h) => h.state !== "idle"), 3);
  });

  test("XII Choir of Many — a plain stone falls silent in the silt, and the choir holds its post", () => {
    const bot = new Bot({ ...level("choir-of-many"), abilities: ["deepListen", "focus"] });
    bot.go(25, 15, { sneak: true }).throwAt(30.5, 19.5).wait(4);
    expect(bot.world.wardens.every((h) => h.state === "idle" || h.state === "patrol")).toBe(true);
  });

  test("XIII The Patient One — two silences, two shards, two patient ones", () => {
    const bot = new Bot(level("the-patient-one"));
    const stalkers = bot.world.wardens.filter((w) => w.traits.kind === "stalker");
    const [north, south] = [...stalkers].sort((a, b) => a.y - b.y);
    const eastbound = (w: Warden) => Math.cos(w.heading) > 0.5;
    const westbound = (w: Warden) => Math.cos(w.heading) < -0.5;
    // Silence runs out after a few breaths: walk while it lasts, then creep the rest of the way out of reach.
    bot.go(8, 11, { sneak: true }).muffle().go(19, 11).go(23, 11, { sneak: true }).note("past the first tremor, out of its reach");
    bot.waitUntil("the south one walking east", () => eastbound(south!) && south!.x > 25, 60);
    bot.go(19, 17, { sneak: true }).note("south shard").go(23, 10, { sneak: true });
    bot.waitUntil("the north one walking west", () => westbound(north!) && north!.x < 25, 60);
    bot.go(30, 10).go(29, 5).note("north shard").go(29, 10, { sneak: true });
    bot.go(31, 11, { sneak: true }).muffle().go(39, 11).go(42, 10).note("past the second tremor");
    expect(stalkers.every((w) => w.state === "idle" || w.state === "patrol")).toBe(true);
    expect(bot.world.shardsCollected).toBe(2);
    expect(bot.finished).toBe(true);
  });

  test("XIII The Patient One — even a creeping step wakes the thing on the bridge", () => {
    const bot = new Bot(level("the-patient-one"));
    const tremor = () => bot.world.wardens.find((w) => w.traits.kind === "tremor")!;
    expect(() => bot.go(7, 11, { sneak: true }).go(19, 11, { sneak: true })).toThrow();
    expect(tremor().state).not.toBe("idle");
  });

  test("XIV Where the Dark Breathes — everything at once", () => {
    const bot = new Bot(level("where-the-dark-breathes"));
    const tremors = bot.world.wardens.filter((w) => w.traits.kind === "tremor");
    const lane = tremors.find((w) => w.x < 12)!;
    const strip = tremors.find((w) => w.x > 12)!;
    const hallWalker = bot.world.wardens.find((w) => w.traits.kind === "warden" && w.y < 6)!;
    const choir = bot.world.wardens.filter((w) => w.traits.kind === "chorus");
    const pacer = choir.find((w) => w.y < 8)!;
    const gateGuards = choir.filter((w) => w !== pacer);
    const westbound = (w: Warden) => Math.cos(w.heading) < -0.5;
    // 1. Cross the stone lane in silence, then wade for the shard while both walkers are far north.
    bot.waitUntil("the lane clear", () => Math.abs(lane.y - 12.5) > 3, 40);
    bot.go(6, 12, { sneak: true }).muffle().go(14, 12).note("across the lane");
    bot.waitUntil("both walkers at their north ends", () => lane.y < 9 && strip.y < 9, 120);
    bot.go(13, 21).note("first shard, then still as stone in the pool");
    bot.waitUntil("both walkers north again", () => lane.y < 10 && strip.y < 9, 120);
    bot.go(14, 17, { sneak: true }).go(15, 12, { sneak: true });
    // 2. A full call wakes the dish, and the dish rings the bell across the chasm. The walkers are deaf to it.
    bot.go(17, 9, { sneak: true }).call(1.2);
    bot.waitUntil("bridge door", (w) => doorOpen(w, 23, 18), 6);
    // 3. Creep up the Watcher's hall, and take the shard while its walker is at the far end.
    bot.go(30, 17, { sneak: true }).go(31, 9, { sneak: true });
    bot.waitUntil("the hall's walker heading back west", () => westbound(hallWalker) && hallWalker.x < 35, 60);
    bot.go(43, 6, { sneak: true }).note("second shard");
    bot.go(44, 12, { sneak: true }).go(47, 14, { sneak: true });
    // 4. Lure the choir into the silt, take the last shard from behind the moss, walk to the Gate.
    bot.throwAt(52.5, 19.5);
    bot.waitUntil("the Gate's guards go down into the silt", () => gateGuards.every((h) => h.y > 16), 12);
    bot.waitUntil("the pacer away from the curtain", () => pacer.y > 16 || pacer.x > 52, 20);
    bot.go(47, 2).note("third shard").go(56, 12);
    expect(bot.world.shardsCollected).toBe(3);
    expect(bot.finished).toBe(true);
  });

  test("XI The Watcher — a call in its hall brings the hunters", () => {
    const bot = new Bot(level("the-watcher"));
    bot.go(12, 17, { sneak: true }).call(0.9);
    bot.waitUntil("the Watcher screams", (w) => w.wardens.some((h) => h.traits.kind === "sentinel" && h.state !== "idle"), 4);
    bot.waitUntil("a hunter answers", (w) => w.wardens.some((h) => h.traits.kind === "warden" && h.state === "hunt"), 6);
  });
});
