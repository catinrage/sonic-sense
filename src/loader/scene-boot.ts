import type { buildLoaderWorld } from "./scene-build";
import type { drawLoaderFrame } from "./scene-draw";
import type { Ctx2D, LoaderCanvas, LoaderInbound, LoaderOutbound, LoaderScene, LoaderWave, LoaderWorld, MakeCanvas, RGB } from "./types";

/** Where the loading scene runs: a Worker (drawing on a transferred canvas) or the page itself. */
export interface LoaderHost {
  /** The canvas to draw on (in a Worker it arrives with the init message). */
  canvas(): LoaderCanvas | null;
  makeCanvas: MakeCanvas;
  now(): number;
  frame(cb: () => void): void;
  post(msg: LoaderOutbound): void;
  listen(cb: (msg: LoaderInbound) => void): void;
}

/**
 * The loading scene's life: the creature gathers its breath and calls, the
 * crystals answer (each once per sound, so their songs chain round the room
 * without ever feeding back), the five tones are tuned into them as the game
 * loads, and when it is ready they all sing at once.
 *
 * Self-contained, like the scene's other parts: it runs inside a Worker from
 * its source text and receives the builder and the painter as arguments.
 */
export function runLoaderScene(host: LoaderHost, build: typeof buildLoaderWorld, draw: typeof drawLoaderFrame): void {
  const NOTES: RGB[] = [
    [1.0, 0.45, 0.22],
    [1.0, 0.84, 0.28],
    [0.24, 0.92, 0.6],
    [0.42, 0.78, 1.0],
    [0.9, 0.5, 1.0],
  ];
  const CYAN: RGB = [0.33, 0.9, 1.0];
  const VIOLET: RGB = [0.74, 0.42, 1.0];
  const GOLD: RGB = [1.0, 0.8, 0.42];
  const RED: RGB = [1.0, 0.16, 0.2];
  const DRIP: RGB = [0.5, 0.78, 1.0];
  const WHITE: RGB = [0.8, 0.97, 1.0];
  /** Seconds the scene plays before its final chord may sound, however fast the game loads. */
  const MIN_SHOW = 2.3;
  const CRYSTAL_TRIGGER = 0.1;

  let world: LoaderWorld | null = null;
  let ctx: Ctx2D | null = null;
  /** Share of the full light resolution; lowered when frames run long. */
  let quality = 1;
  let frameCost = 0;
  let lastSize = { width: 1, height: 1 };
  let scene: LoaderScene | null = null;
  let reduced = false;
  let started = -1;
  let last = 0;
  let stopped = false;
  type Wave = LoaderWave & { origin: number };
  type Event = { at: number; kind: "strike" | "sing" | "glint" | "stir" | "ear"; i: number; origin: number };
  const waves: Wave[] = [];
  let events: Event[] = [];
  let crystals: { glow: number; shake: number; tint: RGB | null; answered: number[]; cooldown: number }[] = [];
  let mushrooms: number[] = [];
  let stirs: number[] = [];
  let order: number[] = [];
  let nextOrigin = 1;
  const creature = { charge: 0, earL: 0, earR: 0, blink: 0, call: 0 };
  const ears = { l: 0, r: 0, hold: 0 };
  let charging = false;
  let chargeFrom = 0;
  let chargeLen = 1;
  let nextCall = 0.3;
  let calls = 0;
  let nextBlink = 2.2;
  let nextHum = 1.6;
  let nextDrip = 2.4;
  let nextClick = 1.2;
  let done = 0;
  let total = 0;
  let tuned = 0;
  let nextTune = 0;
  let finishRequested = false;
  let finaleAt = -1;
  let finaleCalled = false;
  let finishedSent = false;

  const sample = (fi: number, x: number, y: number): { d: number; e: number } => {
    const w = world!;
    const f = w.fields[fi]!;
    const gw = w.w * w.sub;
    const gh = w.h * w.sub;
    const fx = x * w.sub - 0.5;
    const fy = y * w.sub - 0.5;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    let d = 0;
    let e = 0;
    let wt = 0;
    for (let q = 0; q < 4; q++) {
      const cx = ix + (q & 1);
      const cy = iy + (q >> 1);
      if (cx < 0 || cy < 0 || cx >= gw || cy >= gh) continue;
      const c = cy * gw + cx;
      if (f.gridDist[c]! >= 1e8) continue;
      const k = (q & 1 ? fx - ix : 1 - (fx - ix)) * (q >> 1 ? fy - iy : 1 - (fy - iy));
      d += f.gridDist[c]! * k;
      e += f.gridEnergy[c]! * k;
      wt += k;
    }
    return wt > 1e-6 ? { d: d / wt, e: e / wt } : { d: 1e9, e: 0 };
  };

  /** A sound starts: everything it will reach is told when its front arrives. */
  const emit = (field: number, radius: number, speed: number, fade: number, strength: number, color: RGB, origin: number, t: number) => {
    const w = world!;
    // Crystals sing softer than they strike, as they do in the game.
    const glow = w.src.crystals.includes(field) ? 0.62 : 1;
    waves.push({ field, t0: t, radius, speed, fade, strength, color, origin, glow });
    w.crystals.forEach((c, i) => {
      if (w.src.crystals[i] === field) return;
      const s = sample(field, c.x, c.y);
      if (s.d >= radius) return;
      const u = s.d / radius;
      if (strength * s.e * (1 - u * u) * (1 - u * u) < CRYSTAL_TRIGGER) return;
      events.push({ at: t + s.d / speed, kind: "strike", i, origin });
    });
    w.mushrooms.forEach((m, i) => {
      const s = sample(field, m.x, m.y);
      if (s.d < radius) events.push({ at: t + s.d / speed, kind: "glint", i, origin });
    });
    if (field === w.src.creature) {
      w.wardens.forEach((wd, i) => {
        const s = sample(field, wd.x, wd.y);
        if (s.d < radius) events.push({ at: t + s.d / speed, kind: "stir", i, origin });
      });
    } else {
      const s = sample(field, w.player.x, w.player.y);
      if (s.d < radius) events.push({ at: t + s.d / speed, kind: "ear", i: field, origin });
    }
  };

  const onEvent = (ev: Event, t: number) => {
    const w = world!;
    if (ev.kind === "strike") {
      const c = crystals[ev.i]!;
      if (c.answered.includes(ev.origin) || t < c.cooldown) return;
      c.answered.push(ev.origin);
      if (c.answered.length > 16) c.answered.shift();
      c.shake = 1;
      events.push({ at: t + 0.18, kind: "sing", i: ev.i, origin: ev.origin });
    } else if (ev.kind === "sing") {
      const c = crystals[ev.i]!;
      c.glow = 1;
      c.cooldown = t + 2.4;
      emit(w.src.crystals[ev.i]!, 8.5, 8, 3.2, 0.95, c.tint ?? VIOLET, ev.origin, t);
    } else if (ev.kind === "glint") {
      mushrooms[ev.i] = 1;
    } else if (ev.kind === "stir") {
      stirs[ev.i] = 1;
    } else {
      // Ears swivel towards what the creature hears.
      const f = w.fields[ev.i]!;
      const toward = Math.atan2(f.y - w.player.y, f.x - w.player.x);
      const rel = Math.atan2(Math.sin(toward - w.player.facing), Math.cos(toward - w.player.facing));
      const swivel = Math.max(-0.6, Math.min(0.6, rel * 0.35));
      ears.l = rel < 0 ? swivel * 1.2 : swivel * 0.5;
      ears.r = rel > 0 ? swivel * 1.2 : swivel * 0.5;
      ears.hold = 0.9;
    }
  };

  const tune = (t: number) => {
    const w = world!;
    const ci = order[tuned];
    if (ci !== undefined) {
      const c = crystals[ci]!;
      c.tint = NOTES[tuned]!;
      c.glow = 1;
      c.shake = 0.7;
      c.cooldown = t + 1.2;
      const origin = nextOrigin++;
      c.answered.push(origin);
      emit(w.src.crystals[ci]!, 8.5, 8, 3.2, 1.0, c.tint, origin, t);
    }
    tuned++;
    host.post({ type: "tuned", count: tuned });
  };

  const update = (t: number, dt: number) => {
    const w = world!;
    // The creature gathers a breath, then calls.
    if (!charging && finaleAt < 0 && t >= nextCall) {
      charging = true;
      chargeFrom = t;
      chargeLen = calls === 0 ? 0.7 : reduced ? 1.4 : 0.8 + Math.random() * 0.5;
    }
    if (charging) {
      creature.charge = Math.min(1, (t - chargeFrom) / chargeLen);
      if (creature.charge >= 1) {
        charging = false;
        creature.charge = 0;
        creature.call = 1;
        const k = calls === 0 ? 1 : 0.55 + Math.random() * 0.45;
        emit(w.src.creature, 9 + 4 * k, 9.5 + 1.5 * k, 3.4 + k, 1.05 + 0.2 * k, CYAN, nextOrigin++, t);
        calls++;
        nextCall = t + (reduced ? 7.5 : 3.8 + Math.random() * 1.2);
      }
    }
    creature.call = Math.max(0, creature.call - dt * 2.2);
    if (t >= nextBlink) {
      creature.blink = 1;
      nextBlink = t + 1.8 + Math.random() * 2.7;
    }
    creature.blink = Math.max(0, creature.blink - dt * 7);
    ears.hold = Math.max(0, ears.hold - dt);
    const idleL = Math.sin(t * 0.7) * 0.05;
    const idleR = Math.sin(t * 0.9 + 1) * 0.05;
    const k = 1 - Math.exp(-9 * dt);
    creature.earL += ((ears.hold > 0 ? ears.l : idleL) - creature.earL) * k;
    creature.earR += ((ears.hold > 0 ? ears.r : idleR) - creature.earR) * k;

    // The room's own sounds.
    if (w.src.gate >= 0 && t >= nextHum) {
      emit(w.src.gate, 4.2, 6, 2, 0.7, GOLD, nextOrigin++, t);
      nextHum = t + 4.5;
    }
    if (w.src.drips.length > 0 && t >= nextDrip) {
      emit(w.src.drips[Math.floor(Math.random() * w.src.drips.length)]!, 2.6, 6, 1.4, 0.55, DRIP, nextOrigin++, t);
      nextDrip = t + 2.6 + Math.random() * 1.8;
    }
    if (w.src.wardens.length > 0 && t >= nextClick) {
      emit(w.src.wardens[0]!, 2.8, 7, 1.5, 0.8, RED, nextOrigin++, t);
      nextClick = t + 2.2 + Math.random() * 1.2;
    }

    // Tuning keeps pace with the loading; at the end, whatever is left is tuned in a quick run.
    const target = finishRequested ? 5 : total > 0 ? Math.floor((5 * done) / total + 1e-9) : 0;
    if (tuned < Math.min(5, target) && t >= nextTune) {
      tune(t);
      nextTune = t + (finishRequested ? 0.16 : 0.45);
    }
    if (finishRequested && finaleAt < 0 && tuned >= 5 && t >= MIN_SHOW && t >= nextTune) {
      // The final chord: every tuned crystal at once, then the creature's loudest call.
      finaleAt = t;
      charging = false;
      creature.charge = 0;
      const origin = nextOrigin++;
      crystals.forEach((c, i) => {
        if (!c.tint) return;
        c.glow = 1;
        c.shake = 1;
        c.answered.push(origin);
        emit(w.src.crystals[i]!, 9.5, 8.5, 3.6, 1.1, c.tint, origin, t);
      });
    }
    if (finaleAt >= 0 && !finaleCalled && t >= finaleAt + 0.3) {
      finaleCalled = true;
      creature.call = 1;
      emit(w.src.creature, 17, 12, 4.2, 1.35, WHITE, nextOrigin++, t);
    }
    if (finaleAt >= 0 && !finishedSent && t >= finaleAt + 1.05) {
      finishedSent = true;
      host.post({ type: "finished" });
    }

    events.sort((a, b) => a.at - b.at);
    while (events.length > 0 && events[0]!.at <= t) onEvent(events.shift()!, t);
    for (const c of crystals) {
      c.glow = Math.max(0, c.glow - dt * 0.45);
      c.shake = Math.max(0, c.shake - dt * 2.5);
    }
    mushrooms = mushrooms.map((g) => Math.max(0, g - dt * 0.8));
    stirs = stirs.map((g) => Math.max(0, g - dt * 0.5));
    for (let i = waves.length - 1; i >= 0; i--) {
      const wv = waves[i]!;
      if (t - wv.t0 > wv.radius / wv.speed + wv.fade + 0.6) waves.splice(i, 1);
    }
  };

  const finale = (t: number) => {
    if (finaleAt < 0) return 0;
    const u = t - finaleAt - 0.3;
    return u < 0 ? Math.max(0, (u + 0.3) / 0.3) * 0.3 : Math.max(0, 1 - u / 1.1);
  };

  const tick = () => {
    if (stopped || !world || !ctx) return;
    try {
      const t = (host.now() - started) / 1000;
      const dt = Math.min(0.1, Math.max(0, t - last));
      last = t;
      update(t, dt);
      const before = host.now();
      draw(ctx, world, {
        t,
        dt,
        waves,
        creature,
        crystals,
        mushrooms,
        wardens: stirs.map((stir) => ({ stir })),
        finale: finale(t),
        reduced,
      });
      // A slow machine gets a coarser light buffer rather than a stuttering scene.
      frameCost = frameCost * 0.95 + (host.now() - before) * 0.05;
      if (t > 1.5 && frameCost > 20 && quality > 0.3) {
        quality *= 0.65;
        frameCost = 0;
        setup(lastSize);
      }
    } catch (err) {
      stopped = true;
      host.post({ type: "failed", message: err instanceof Error ? err.message : String(err) });
      return;
    }
    host.frame(tick);
  };

  const setup = (size: { width: number; height: number }) => {
    const canvas = host.canvas();
    if (!canvas || !scene) return;
    lastSize = size;
    const width = Math.max(1, Math.round(size.width));
    const height = Math.max(1, Math.round(size.height));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx = canvas.getContext("2d") as Ctx2D | null;
    world = build(scene, size, host.makeCanvas, quality, world);
    if (crystals.length !== world.crystals.length) {
      crystals = world.crystals.map(() => ({ glow: 0, shake: 0, tint: null, answered: [], cooldown: 0 }));
      mushrooms = world.mushrooms.map(() => 0);
      stirs = world.wardens.map(() => 0);
      // Tuned in turn round the creature, from the one straight above it, clockwise.
      const p = world.player;
      order = world.crystals
        .map((c, i) => ({ i, a: (Math.atan2(c.y - p.y, c.x - p.x) + Math.PI * 2.5) % (Math.PI * 2) }))
        .sort((a, b) => a.a - b.a)
        .map((c) => c.i);
    }
  };

  host.listen((msg) => {
    try {
      if (msg.type === "init") {
        scene = msg.scene;
        reduced = msg.reduced;
        setup(msg.size);
        started = host.now();
        last = 0;
        host.frame(tick);
      } else if (msg.type === "resize") {
        setup(msg.size);
      } else if (msg.type === "progress") {
        done = msg.done;
        total = msg.total;
      } else if (msg.type === "finish") {
        finishRequested = true;
      }
    } catch (err) {
      stopped = true;
      host.post({ type: "failed", message: err instanceof Error ? err.message : String(err) });
    }
  });
}

/**
 * The Worker side of the host. Self-contained: it becomes part of the Worker's
 * source text, where `self` is the worker scope.
 */
export function workerLoaderHost(): LoaderHost {
  const scope = self as unknown as {
    onmessage: ((e: MessageEvent) => void) | null;
    postMessage(msg: unknown): void;
    requestAnimationFrame?: (cb: () => void) => number;
  };
  let canvas: LoaderCanvas | null = null;
  const listeners: ((msg: LoaderInbound) => void)[] = [];
  scope.onmessage = (e: MessageEvent) => {
    const data = e.data as LoaderInbound & { canvas?: OffscreenCanvas };
    if (data.type === "init" && data.canvas) canvas = data.canvas;
    for (const l of listeners) l(data);
  };
  return {
    canvas: () => canvas,
    makeCanvas: (w, h) => new OffscreenCanvas(w, h),
    now: () => performance.now(),
    frame: (cb) => {
      if (scope.requestAnimationFrame) scope.requestAnimationFrame(cb);
      else setTimeout(cb, 16);
    },
    post: (msg) => scope.postMessage(msg),
    listen: (cb) => {
      listeners.push(cb);
    },
  };
}
