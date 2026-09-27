/**
 * Headless screenshot harness for visual iteration.
 *
 *   bun tools/shot.ts <scenario> [outDir]
 *
 * Serves the game, drives it through a scripted scenario via the debug API
 * (window.__sonic) and writes PNG frames. Console errors are echoed.
 */
import { chromium, type Page } from "playwright-core";
import index from "../src/index.html";
import { audioRoutes } from "../src/audio/serve";

type Scenario = (page: Page, snap: (name: string) => Promise<void>) => Promise<void>;

const run = (page: Page, js: string) => page.evaluate(js);

const scenarios: Record<string, Scenario> = {
  async basic(page, snap) {
    await run(page, "__sonic.debugStep(0.5)");
    await snap("00-dark");
    await run(page, "__sonic.debugPulse(0.9)");
    for (const t of [0.25, 0.35, 0.5, 0.9]) {
      await run(page, `__sonic.debugStep(${t})`);
      await snap(`pulse-${t}`);
    }
  },
  async pulse(page, snap) {
    await run(page, "__sonic.debugStep(0.3)");
    await run(page, "__sonic.debugPulse(1.0)");
    await run(page, "__sonic.debugStep(0.55)");
    await snap("front");
    await run(page, "__sonic.debugStep(0.9)");
    await snap("full");
    await run(page, "__sonic.debugStep(2.0)");
    await snap("fading");
    await run(page, "__sonic.debugStep(3.0)");
    await snap("memory");
  },
  /** Real-time smoke test through the live loop with keyboard input. */
  async play(page, snap) {
    await page.waitForTimeout(1500);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2500);
    await snap("card");
    await page.keyboard.down("KeyD");
    await page.waitForTimeout(1500);
    await page.keyboard.up("KeyD");
    await page.keyboard.down("Space");
    await page.waitForTimeout(1400);
    await snap("charging");
    await page.keyboard.up("Space");
    await page.waitForTimeout(900);
    await snap("called");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
    await snap("paused");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    const state = await page.evaluate("JSON.stringify({ mode: __sonic.mode, player: __sonic.debugPlayer() })");
    console.log("state", state);
  },
  /** The loading screen, frame by frame, until the title takes over. */
  async loading(page, snap) {
    const every = Number(process.env.SHOT_EVERY ?? 500);
    const count = Number(process.env.SHOT_COUNT ?? 16);
    for (let i = 0; i < count; i++) {
      await snap(`t${String(Math.round((i * every) / 100) / 10).padStart(4, "0")}s`);
      await page.waitForTimeout(every);
    }
  },
  async custom(page, snap) {
    const script = process.env.SHOT_SCRIPT ?? "";
    for (const line of script.split(";;")) {
      const cmd = line.trim();
      if (!cmd) continue;
      if (cmd.startsWith("snap ")) await snap(cmd.slice(5).trim());
      else await run(page, cmd);
    }
  },
};

const name = process.argv[2] ?? "basic";
const outDir = process.argv[3] ?? "/tmp/claude-1000/-home-catinrage-projects-game-sonic-sense/a045f72b-6954-4359-a843-be89b4f3618b/scratchpad/shots";
const scenario = scenarios[name];
if (!scenario) throw new Error(`Unknown scenario "${name}". Known: ${Object.keys(scenarios).join(", ")}`);

const server = Bun.serve({ port: 0, routes: { "/": index, ...audioRoutes() }, development: { hmr: false, console: false } });
const width = Number(process.env.SHOT_W ?? 1280);
const height = Number(process.env.SHOT_H ?? 720);
const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"],
});

try {
  // SHOT_VIDEO records the whole run in real time (screenshots are too slow to catch fast animation).
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
    ...(process.env.SHOT_VIDEO ? { recordVideo: { dir: outDir, size: { width, height } } } : {}),
  });
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") console.log(`[browser ${msg.type()}] ${msg.text()}`);
  });
  page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));
  if (process.env.SHOT_NO_PARALLEL) {
    // Simulate browsers without KHR_parallel_shader_compile.
    await page.addInitScript(() => {
      const original = WebGL2RenderingContext.prototype.getExtension;
      WebGL2RenderingContext.prototype.getExtension = function (this: WebGL2RenderingContext, name: string) {
        return name === "KHR_parallel_shader_compile" ? null : Reflect.apply(original, this, [name]);
      } as typeof original;
    });
  }
  const query = process.env.SHOT_QUERY ?? "";
  const manual = name !== "play" && name !== "loading";
  await page.goto(`${server.url}?${manual ? "manual" : "live"}${query ? "&" + query : ""}`);
  await page.waitForFunction("window.__sonic !== undefined || document.getElementById('fatal')?.hidden === false", null, {
    timeout: 60_000,
  });
  // The loading scenario watches the build instead of waiting it out.
  if (name !== "loading") {
    await page.waitForFunction("(window.__sonic && window.__sonic.ready) || document.getElementById('fatal')?.hidden === false", null, {
      timeout: 120_000,
      polling: 100,
    }).catch((e) => console.log(`shader build wait failed: ${e}`));
  }
  const fatal = await page.evaluate("document.getElementById('fatal')?.hidden === false ? document.getElementById('fatal').textContent : ''");
  if (fatal) {
    console.log(`FATAL:\n${fatal}`);
  } else {
    await Bun.$`mkdir -p ${outDir}`;
    let n = 0;
    const snap = async (label: string) => {
      const file = `${outDir}/${name}-${String(n++).padStart(2, "0")}-${label}.png`;
      await page.screenshot({ path: file });
      console.log(`saved ${file}`);
    };
    const t0 = performance.now();
    await scenario(page, snap);
    console.log(`scenario "${name}" finished in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  }
} finally {
  await browser.close();
  if (process.env.SHOT_VIDEO) console.log(`video written to ${outDir}`);
  server.stop(true);
}
