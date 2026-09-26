/**
 * Production build: bundle the page, then copy the generated audio beside it.
 *
 * The audio is copied rather than imported so the bundle builds with or
 * without it; anything absent falls back to synthesized sound at runtime.
 */
import { rm, mkdir, copyFile } from "node:fs/promises";
import { MANIFEST_FILE } from "../src/audio/sample-manifest";
import { presentSamples } from "../src/audio/serve";

const OUT = "dist";
const AUDIO_SRC = "src/assets/audio";
const AUDIO_OUT = `${OUT}/assets/audio`;

await rm(OUT, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: ["./src/index.html"],
  outdir: OUT,
  minify: true,
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

await mkdir(AUDIO_OUT, { recursive: true });
const names = await presentSamples(`${AUDIO_SRC}/`);
let bytes = 0;
for (const name of names) {
  await copyFile(`${AUDIO_SRC}/${name}`, `${AUDIO_OUT}/${name}`);
  bytes += (await Bun.file(`${AUDIO_SRC}/${name}`).stat()).size;
}
// Always emit the manifest, even when empty: the client reads it instead of
// probing for files that may not be there.
await Bun.write(`${AUDIO_OUT}/${MANIFEST_FILE}`, JSON.stringify(names));
const copied = names.length;

const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
console.log(`\n  bundled ${result.outputs.length} files into ${OUT}/`);
console.log(copied > 0 ? `  copied ${copied} audio samples (${kb(bytes)})` : `  no audio samples found — the game will use synthesized sound`);
