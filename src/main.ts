import { Input } from "./core/input";
import { Renderer } from "./render/renderer";
import { App } from "./app";
import { startLoader } from "./loader/loader";
import { titleLoaderScene } from "./game/title";

function showFatal(message: string): void {
  const el = document.getElementById("fatal");
  if (el) {
    el.textContent = message;
    el.hidden = false;
  }
  console.error(message);
}

function boot(): void {
  const canvas = document.getElementById("view") as HTMLCanvasElement | null;
  if (!canvas) throw new Error("Missing #view canvas");
  const params = new URLSearchParams(location.search);
  // The loading scene starts first, so it is already playing while the shaders are handed to the driver.
  const curtain = document.getElementById("curtain");
  const loader = curtain && !params.has("manual") ? startLoader(curtain, titleLoaderScene()) : null;
  let renderer: Renderer;
  try {
    renderer = new Renderer(canvas);
  } catch (err) {
    loader?.dispose();
    showFatal(err instanceof Error ? err.message : String(err));
    return;
  }
  const input = new Input(canvas);
  const app = new App(renderer, input, loader);
  app.onFatal = showFatal;
  (window as unknown as { __sonic: App }).__sonic = app;
  window.addEventListener("resize", () => renderer.resize());
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    showFatal("The graphics context was lost (the GPU may have been reset). Please reload the page to keep listening.");
  });
  if (params.has("manual")) return;
  app.start();
}

try {
  boot();
} catch (err) {
  showFatal(err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err));
}
