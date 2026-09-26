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
    bot.go(35, 12, { sneak: true }).call(1.2).note("C from the far key: the G prism answers, the D prism never hears");
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

  test("XIX The Sluices — flood the channel for the note, drain it again to walk past the tremors", () => {
    const bot = new Bot(level("the-sluices"));
    const [first, second] = bot.world.wardens.filter((w) => w.traits.kind === "tremor").sort((a, b) => a.y - b.y);
    const walker = bot.world.wardens.find((w) => w.traits.kind === "warden")!;
    const sluice = bot.world.bells.find((b) => b.toggle)!;
    const flooded = (w: World) => w.flooded.get(1) === true;
    bot.go(3, 16).focus(1.1, sluice.x, sluice.y).note("the sluice bell rings: the channel floods");
    bot.waitUntil("the channel full", flooded, 3);
    bot.go(7, 7).focus(1.1, 19.5, 7.5).note("a quiet C across the water, to the crystal by the Gate's glass");
    bot.waitUntil("the Gate's glass breaks", (w) => pane(w, 19, 3).shattered, 5);
    bot.go(3, 16).focus(1.1, sluice.x, sluice.y).note("and again: the channel drains");
    bot.waitUntil("the channel drained", (w) => !flooded(w), 3);
    // Down the silt, crossing each tremor's sweep while it is at the far side.
    bot.go(9, 4).go(10, 6);
    bot.waitUntil("the first tremor at the channel's east side", () => first!.x > 13.5, 60);
    bot.go(10, 10).go(15, 11).note("shard");
    bot.waitUntil("the second tremor at the channel's west side", () => second!.x < 11.5, 60);
    bot.go(15, 16).go(16, 19);
    bot.waitUntil("the walker heading south, far down the bank", () => Math.sin(walker.heading) > 0.5 && walker.y > 12, 80);
    bot.go(18, 6, { sneak: true }).go(20, 1);
    expect(bot.world.shardsCollected).toBe(1);
    expect(bot.finished).toBe(true);
  });

  test("XX The Metronome — add C to the prism's G, then cross its hall between beats", () => {
    const bot = new Bot(level("the-metronome"));
    const metronome = bot.world.wardens.find((w) => w.traits.kind === "metronome")!;
    // Freeze from just before each beat until its pulse has swept past.
    const onBeat = (w: World) => {
      const since = metronome.traits.beat - metronome.nextBeat;
      const reach = Math.hypot(w.player.x - metronome.x, w.player.y - metronome.y) / 8;
      return metronome.nextBeat < 0.4 || since < reach + 0.25;
    };
    bot.go(11, 10).call(1.2).note("C through the glass, while the prism beyond sings G to the beat");
    bot.waitUntil("the chord breaks the glass wall", (w) => pane(w, 13, 10).shattered, 4);
    bot.go(30, 4, { still: onBeat }).note("shard, moving only between beats");
    bot.go(39, 10, { still: onBeat });
    expect(metronome.state).toBe("idle");
    expect(bot.world.shardsCollected).toBe(1);
    expect(bot.finished).toBe(true);
  });

  test("XXI The Conductor — a wrong note down the tube to clear the hall, then three chords", () => {
    const bot = new Bot(level("the-conductor"));
    const conductor = bot.world.wardens[0]!;
    const tube = bot.world.tubes[0]!;
    const north = () => conductor.y < 9.5 && conductor.state !== "hunt";
    bot.go(28, 22).focus(1.1, tube.x, tube.y).note("a C down the tube: a discord in the far vault");
    bot.waitUntil("the Conductor goes to listen", () => conductor.state === "hunt" && conductor.x > 30, 10);
    bot.go(5, 15).focus(1.1, 5.5, 10.5).go(6, 15).focus(1.1, 5.5, 10.5).note("A, then E, quietly");
    bot.waitUntil("the west chord breaks", (w) => pane(w, 5, 10).shattered, 4);
    bot.go(5, 8).note("first shard").go(47, 14);
    bot.focus(1.1, 50.5, 5.5).note("a quiet C for the mimic; its echo wakes the prism by the glass");
    bot.waitUntil("the east chord breaks", (w) => pane(w, 44, 5).shattered, 6);
    bot.go(41, 5).note("second shard").go(40, 12);
    bot.waitUntil("the Conductor on the north side of the hall", north, 120);
    bot.go(24, 22).focus(1.1, tube.x, tube.y).go(25, 22).focus(1.1, tube.x, tube.y).note("G, then D, down the tube");
    bot.waitUntil("the tube's chord breaks the vault", (w) => pane(w, 43, 20).shattered, 5);
    bot.waitUntil("the Conductor on the north side of the hall", north, 120);
    bot.go(46, 20).note("third shard");
    bot.waitUntil("the Conductor on the south side of the hall", () => conductor.y > 13 && conductor.state !== "hunt", 120);
    bot.go(26, 3);
    expect(bot.world.shardsCollected).toBe(3);
    expect(bot.finished).toBe(true);
  });
});

/** What happens to a player who ignores what each chapter teaches. */
describe("act III naive attempts", () => {
  test("XVIII: calling C on the key right below the Gate's glass wakes the D prism too: a discord", () => {
    const bot = new Bot(level("chord"));
    const discords: number[] = [];
    bot.world.events.on("discord", () => discords.push(bot.world.time));
    bot.go(6, 13).call(1.2).go(7, 13).call(1.2).wait(1);
    bot.p.x = 27.5;
    bot.p.y = 8.5;
    bot.call(1.2).wait(2);
    expect(discords.length).toBeGreaterThan(0);
    expect(pane(bot.world, 29, 3).shattered).toBe(false);
  });

  test("XIX: wading down the flooded channel, the tremors feel every splash", () => {
    const bot = new Bot(level("the-sluices"));
    const tremors = bot.world.wardens.filter((w) => w.traits.kind === "tremor");
    const sluice = bot.world.bells.find((b) => b.toggle)!;
    bot.go(3, 16).focus(1.1, sluice.x, sluice.y).waitUntil("flooded", (w) => w.flooded.get(1) === true, 3);
    try {
      bot.go(9, 4).go(12, 18).wait(3);
    } catch {
      // Caught on the way is the expected outcome too.
    }
    expect(tremors.some((t) => t.state !== "patrol" && t.state !== "idle")).toBe(true);
  });

  test("XX: crossing the Metronome's hall without minding the beat, it sees you", () => {
    const bot = new Bot(level("the-metronome"));
    const metronome = bot.world.wardens.find((w) => w.traits.kind === "metronome")!;
    bot.go(11, 10).call(1.2).waitUntil("the glass wall breaks", (w) => pane(w, 13, 10).shattered, 4);
    try {
      bot.go(30, 4);
    } catch {
      // Caught on the way is the expected outcome too.
    }
    expect(metronome.state).not.toBe("idle");
  });
});
