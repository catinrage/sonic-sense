import { describe, expect, test } from "bun:test";
import { buildLoaderWorld } from "../src/loader/scene-build";
import { drawLoaderFrame } from "../src/loader/scene-draw";
import { runLoaderScene, type LoaderHost } from "../src/loader/scene-boot";
import { phraseFor, workerSource } from "../src/loader/loader";
import { titleLoaderScene, TITLE_CAMERA_OFFSET } from "../src/game/title";
import type { LoaderFrame, LoaderInbound, LoaderOutbound, LoaderWave, MakeCanvas } from "../src/loader/types";

/** A canvas that accepts every drawing call and remembers nothing: enough to run the scene headless. */
class FakeCanvas {
  private ctx: unknown = null;
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext(): unknown {
    if (this.ctx) return this.ctx;
    const noop = () => {};
    // A browser rejects a colour it cannot parse, and so does this.
    const colour = (v: unknown) => {
      if (typeof v === "string" && /NaN|undefined|Infinity/.test(v)) throw new Error(`bad colour ${v}`);
    };
    const gradient = { addColorStop: (_: number, c: string) => colour(c) };
    const base: Record<string | symbol, unknown> = {
      canvas: this,
      createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      createRadialGradient: () => gradient,
      createLinearGradient: () => gradient,
      createPattern: () => ({}),
    };
    this.ctx = new Proxy(base, {
      get: (t, k) => (k in t ? t[k] : noop),
      set: (t, k, v) => {
        colour(v);
        if (typeof v === "number" && !Number.isFinite(v)) throw new Error(`bad ${String(k)} ${v}`);
        t[k] = v;
        return true;
      },
    });
    return this.ctx;
  }
}
const makeCanvas = ((w: number, h: number) => new FakeCanvas(w, h)) as unknown as MakeCanvas;

/** Rebuilt from its own source text, exactly as the Worker gets it: any reference outside its body fails here. */
const fromSource = <T>(fn: T): T => new Function(`return (${String(fn)});`)() as T;

const scene = titleLoaderScene();
const size = { width: 1280, height: 720 };

describe("loading scene", () => {
  test("its parts run from their source text alone, as they do inside the Worker", () => {
    const build = fromSource(buildLoaderWorld);
    const draw = fromSource(drawLoaderFrame);
    const world = build(scene, size, makeCanvas);
    const frame: LoaderFrame = {
      t: 1,
      dt: 1 / 60,
      waves: [{ field: world.src.creature, t0: 0.2, radius: 12, speed: 10, fade: 4, strength: 1.2, color: [0.3, 0.9, 1] }],
      creature: { charge: 0.5, earL: 0, earR: 0, blink: 0, call: 0.5 },
      crystals: world.crystals.map(() => ({ glow: 0.5, shake: 0.2, tint: null })),
      mushrooms: world.mushrooms.map(() => 0.3),
      wardens: world.wardens.map(() => ({ stir: 0.4 })),
      finale: 0,
      reduced: false,
    };
    for (let i = 0; i < 3; i++) draw(new FakeCanvas(1280, 720).getContext() as never, world, { ...frame, t: 1 + i * 0.5 });
    expect(world.light.some((v) => v > 0)).toBe(true);
    expect(() => new Function(workerSource())).not.toThrow();
  });

  test("frames the room exactly as the title screen's camera does", () => {
    const world = buildLoaderWorld(scene, size, makeCanvas);
    expect(world.camX).toBeCloseTo(world.player.x + TITLE_CAMERA_OFFSET.x, 9);
    expect(world.camY).toBeCloseTo(world.player.y + TITLE_CAMERA_OFFSET.y, 9);
    expect(world.scale).toBeCloseTo(size.height / scene.viewHeight, 9);
    expect(world.crystals).toHaveLength(5);
  });

  test("its sound bends round the walls and loses strength doing it, like the game's", () => {
    // A pillar between the creature and the far side of the room.
    const map = ["##############", "#............#", "#.@...##.....#", "#.....##.....#", "#............#", "##############"];
    const world = buildLoaderWorld({ ...scene, map }, size, makeCanvas);
    const f = world.fields[world.src.creature]!;
    const gw = world.w * world.sub;
    let bent = 0;
    f.gridDist.forEach((d, c) => {
      if (world.solid[c] || d >= 1e8) return;
      const x = ((c % gw) + 0.5) / world.sub;
      const y = (Math.floor(c / gw) + 0.5) / world.sub;
      const straight = Math.hypot(x - f.x, y - f.y);
      // Never shorter than the straight line, however it travels.
      expect(d).toBeGreaterThanOrEqual(straight - 0.02);
      // Round the pillar: further than the straight line, and weaker for the bend.
      if (d > straight + 0.15 && f.gridEnergy[c]! < 0.98) bent++;
    });
    expect(bent).toBeGreaterThan(3);
  });

  test("tunes a crystal for every fifth of the loading, then sounds the chord and hands over", () => {
    const listeners: ((m: LoaderInbound) => void)[] = [];
    const posted: LoaderOutbound[] = [];
    const queue: (() => void)[] = [];
    let now = 0;
    const seen = new Map<string, number>();
    const spyDraw: typeof drawLoaderFrame = (_ctx, world, frame) => {
      for (const w of frame.waves as (LoaderWave & { origin: number })[]) {
        if (!world.src.crystals.includes(w.field)) continue;
        seen.set(`${w.field}:${w.origin}:${w.t0}`, w.origin);
      }
    };
    const host: LoaderHost = {
      canvas: () => new FakeCanvas(size.width, size.height) as unknown as OffscreenCanvas,
      makeCanvas,
      now: () => now,
      frame: (cb) => void queue.push(cb),
      post: (m) => void posted.push(m),
      listen: (cb) => void listeners.push(cb),
    };
    fromSource(runLoaderScene)(host, fromSource(buildLoaderWorld), spyDraw);
    const send = (m: LoaderInbound) => listeners.forEach((l) => l(m));
    send({ type: "init", scene, size, reduced: false });
    const run = (seconds: number) => {
      for (let t = 0; t < seconds; t += 1 / 60) {
        now += 1000 / 60;
        queue.splice(0).forEach((cb) => cb());
      }
    };
    send({ type: "progress", done: 0, total: 20 });
    run(1);
    for (let done = 1; done <= 20; done++) {
      send({ type: "progress", done, total: 20 });
      run(0.1);
    }
    expect(posted.filter((m) => m.type === "tuned").map((m) => (m as { count: number }).count)).toEqual([1, 2, 3, 4, 5]);
    expect(posted.some((m) => m.type === "finished")).toBe(false);
    send({ type: "finish" });
    run(3);
    expect(posted.filter((m) => m.type === "finished")).toHaveLength(1);
    // Past the end of every wave's life, still drawing.
    run(12);
    expect(posted.some((m) => m.type === "failed")).toBe(false);
    // A crystal sings each sound once, however many of its neighbours pass it on.
    const perOrigin = new Map<string, number>();
    for (const key of seen.keys()) {
      const [field, origin] = key.split(":");
      const k = `${field}:${origin}`;
      perOrigin.set(k, (perOrigin.get(k) ?? 0) + 1);
    }
    expect(Math.max(...perOrigin.values())).toBe(1);
  });

  // Paints hundreds of full frames in software: slow by nature, so it gets room beyond the default 5 s.
  test("draws every frame of a long load without a single unreadable colour", () => {
    const listeners: ((m: LoaderInbound) => void)[] = [];
    const posted: LoaderOutbound[] = [];
    const queue: (() => void)[] = [];
    let now = 0;
    const draw = fromSource(drawLoaderFrame);
    runLoaderScene(
      {
        canvas: () => new FakeCanvas(640, 360) as unknown as OffscreenCanvas,
        makeCanvas,
        now: () => now,
        frame: (cb) => void queue.push(cb),
        post: (m) => void posted.push(m),
        listen: (cb) => void listeners.push(cb),
      },
      buildLoaderWorld,
      draw,
    );
    const send = (m: LoaderInbound) => listeners.forEach((l) => l(m));
    send({ type: "init", scene, size: { width: 640, height: 360 }, reduced: false });
    for (let t = 0; t < 26; t += 1 / 30) {
      now += 1000 / 30;
      if (t > 3) send({ type: "progress", done: Math.min(20, Math.floor(t - 3)), total: 20 });
      if (t > 20) send({ type: "finish" });
      queue.splice(0).forEach((cb) => cb());
    }
    expect(posted.filter((m) => m.type === "failed")).toEqual([]);
    expect(posted.some((m) => m.type === "finished")).toBe(true);
  }, 20_000);

  test("never sounds its chord before it has had time to show the room", () => {
    const listeners: ((m: LoaderInbound) => void)[] = [];
    const posted: LoaderOutbound[] = [];
    const queue: (() => void)[] = [];
    let now = 0;
    runLoaderScene(
      {
        canvas: () => new FakeCanvas(size.width, size.height) as unknown as OffscreenCanvas,
        makeCanvas,
        now: () => now,
        frame: (cb) => void queue.push(cb),
        post: (m) => void posted.push(m),
        listen: (cb) => void listeners.push(cb),
      },
      buildLoaderWorld,
      () => {},
    );
    listeners.forEach((l) => l({ type: "init", scene, size, reduced: false }));
    listeners.forEach((l) => l({ type: "progress", done: 20, total: 20 }));
    listeners.forEach((l) => l({ type: "finish" }));
    let finishedAt = -1;
    for (let t = 0; t < 6 && finishedAt < 0; t += 1 / 60) {
      now += 1000 / 60;
      queue.splice(0).forEach((cb) => cb());
      if (posted.some((m) => m.type === "finished")) finishedAt = t;
    }
    expect(finishedAt).toBeGreaterThan(2.3);
    expect(finishedAt).toBeLessThan(4.5);
  });

  test("a rebuild for a new size or a lower quality keeps the fields it already solved", () => {
    const first = buildLoaderWorld(scene, size, makeCanvas);
    const coarse = buildLoaderWorld(scene, { width: 800, height: 600 }, makeCanvas, 0.5, first);
    expect(coarse.fields.map((f) => f.gridDist)).toEqual(first.fields.map((f) => f.gridDist));
    expect(coarse.fields[0]!.gridDist).toBe(first.fields[0]!.gridDist);
    expect(coarse.lw * coarse.lh).toBeLessThan(first.lw * first.lh);
  });

  test("names what the game is building in its own terms", () => {
    expect(phraseFor("entity:warden")).toBe("Waking the hunters");
    expect(phraseFor("entity:crystal")).toBe("Tuning the crystals");
    expect(phraseFor("scene")).toBe("Laying the stone");
    expect(phraseFor("something new")).toBe("Tuning the dark");
  });
});
