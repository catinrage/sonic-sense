import { buildLoaderWorld } from "./scene-build";
import { drawLoaderFrame } from "./scene-draw";
import { runLoaderScene, workerLoaderHost, type LoaderHost } from "./scene-boot";
import type { LoaderInbound, LoaderOutbound, LoaderScene } from "./types";

/** How far the game has come in building its shaders. */
export interface LoaderProgress {
  done: number;
  total: number;
  /** Label of a program still being built. */
  building: string;
}

export interface Loader {
  progress(p: LoaderProgress): void;
  /** Sound the final chord; resolves at its peak, when the curtain may open. */
  finish(): Promise<void>;
  /** Stop drawing and let the scene go (once the curtain has opened). */
  dispose(): void;
}

/** What the status line says while each part of the game is being built. */
const PHRASES: readonly [RegExp, string][] = [
  [/^scene$/, "Laying the stone"],
  [/^memory$/, "Remembering"],
  [/^bloom/, "Gathering the glow"],
  [/^composite$/, "Opening its eyes"],
  [/^shock$/, "Bending the air"],
  [/^(particles|dust)$/, "Stirring the dust"],
  [/player|aura/, "Waking the creature"],
  [/warden/, "Waking the hunters"],
  [/crystal|dish/, "Tuning the crystals"],
  [/bell/, "Casting the bells"],
  [/shard|exit/, "Finding the Gate"],
  [/stone|pile/, "Gathering stones"],
  [/mushroom|puddle/, "Lighting the caps"],
  [/curtain|chime/, "Hanging the moss"],
  [/mimic|tube/, "Teaching the mimic"],
];

export function phraseFor(label: string): string {
  const bare = label.replace(/^entity:/, "");
  return PHRASES.find(([re]) => re.test(bare))?.[1] ?? "Tuning the dark";
}

/** The Worker's whole script: the scene's self-contained parts, from their own source text. */
export function workerSource(): string {
  return [
    // A bundler may wrap nested functions in a naming helper; the Worker has none of its own.
    "self.__name = self.__name || ((f) => f);",
    `const build = (${buildLoaderWorld.toString()});`,
    `const draw = (${drawLoaderFrame.toString()});`,
    `(${runLoaderScene.toString()})((${workerLoaderHost.toString()})(), build, draw);`,
  ].join("\n");
}

/** Longest the page waits on the final chord before opening the curtain regardless. */
const FINISH_TIMEOUT_MS = 6000;
/** Drawing-buffer pixels: enough to stay crisp, few enough to composite cheaply. */
const MAX_PIXELS = 2_300_000;

/**
 * The loading screen: the title chamber, drawn with a 2D canvas while the game
 * builds its shaders. It runs in a Worker when the browser can hand it the
 * canvas, so it keeps its pace even while shader compilation blocks the page;
 * otherwise it runs here. If anything about it fails, the plain curtain note
 * shows instead — the loading screen must never stand in the game's way.
 */
export function startLoader(root: HTMLElement, scene: LoaderScene): Loader {
  const canvas = root.querySelector<HTMLCanvasElement>("canvas.loader-canvas");
  const status = root.querySelector<HTMLElement>("[data-loader-status]");
  const notes = [...root.querySelectorAll<HTMLElement>(".loader-note")];
  let finished: () => void = () => {};
  const whenFinished = new Promise<void>((resolve) => (finished = resolve));
  let failed = false;
  let disposed = false;
  let lastPhrase = "";

  const fail = (reason: string) => {
    if (failed) return;
    failed = true;
    // Kept on the element for diagnosis; the plain curtain note takes over.
    root.dataset.loaderError = reason;
    root.classList.add("loader-failed");
    finished();
  };
  const onMessage = (msg: LoaderOutbound) => {
    if (msg.type === "tuned") notes.forEach((n, i) => n.classList.toggle("is-tuned", i < msg.count));
    else if (msg.type === "finished") finished();
    else fail(msg.message);
  };
  if (!canvas) {
    fail("no loader canvas");
    return { progress: () => {}, finish: () => Promise.resolve(), dispose: () => {} };
  }

  const size = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let width = Math.max(1, window.innerWidth * dpr);
    let height = Math.max(1, window.innerHeight * dpr);
    const k = Math.min(1, Math.sqrt(MAX_PIXELS / (width * height)));
    width = Math.round(width * k);
    height = Math.round(height * k);
    return { width, height };
  };
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  let send: (msg: LoaderInbound, transfer?: Transferable[]) => void = () => {};
  let stop: () => void = () => {};

  try {
    if (typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined" && "transferControlToOffscreen" in canvas) {
      // The scene's parts are self-contained functions: their source text is the Worker.
      const url = URL.createObjectURL(new Blob([workerSource()], { type: "text/javascript" }));
      const worker = new Worker(url);
      URL.revokeObjectURL(url);
      worker.onmessage = (e: MessageEvent<LoaderOutbound>) => onMessage(e.data);
      worker.onerror = (e) => fail(e.message || "worker error");
      const offscreen = canvas.transferControlToOffscreen();
      send = (msg, transfer) => worker.postMessage(msg, transfer ?? []);
      stop = () => worker.terminate();
      const init = { type: "init", scene, size: size(), reduced, canvas: offscreen } as LoaderInbound & { canvas: OffscreenCanvas };
      send(init, [offscreen]);
    } else {
      const listeners: ((msg: LoaderInbound) => void)[] = [];
      let raf = 0;
      const host: LoaderHost = {
        canvas: () => canvas,
        makeCanvas: (w, h) => (typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h })),
        now: () => performance.now(),
        frame: (cb) => {
          if (!disposed) raf = requestAnimationFrame(cb);
        },
        post: onMessage,
        listen: (cb) => {
          listeners.push(cb);
        },
      };
      runLoaderScene(host, buildLoaderWorld, drawLoaderFrame);
      send = (msg) => listeners.forEach((l) => l(msg));
      stop = () => cancelAnimationFrame(raf);
      send({ type: "init", scene, size: size(), reduced });
    }
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }

  let resizeTimer = 0;
  const onResize = () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => send({ type: "resize", size: size() }), 120);
  };
  window.addEventListener("resize", onResize);

  return {
    progress(p) {
      if (failed || disposed) return;
      send({ type: "progress", done: p.done, total: p.total });
      const phrase = p.done >= p.total ? "Listen" : phraseFor(p.building);
      if (status && phrase !== lastPhrase) {
        lastPhrase = phrase;
        status.textContent = phrase;
      }
    },
    finish() {
      if (failed || disposed) return Promise.resolve();
      send({ type: "finish" });
      if (status) status.textContent = "Listen";
      return Promise.race([whenFinished, new Promise<void>((resolve) => window.setTimeout(resolve, FINISH_TIMEOUT_MS))]);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      window.removeEventListener("resize", onResize);
      stop();
      root.classList.add("loader-done");
    },
  };
}
