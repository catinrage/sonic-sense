import { readdir } from "node:fs/promises";
import { AUDIO_BASE, MANIFEST_FILE } from "./sample-manifest";

const AUDIO_DIR = new URL("../assets/audio/", import.meta.url).pathname;
/** Only ever serve plain sample filenames — no separators, no traversal. */
const SAFE_NAME = /^[a-z0-9-]+\.mp3$/;

/** Filenames of the generated samples actually present on disk. */
export async function presentSamples(dir = AUDIO_DIR): Promise<string[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  return names.filter((n) => SAFE_NAME.test(n)).sort();
}

/**
 * Serves `src/assets/audio` for the dev and production Bun servers, plus a
 * manifest of what is there. The files are deliberately not bundled: a
 * missing sample must degrade to synthesis rather than break the build, and
 * the manifest lets the client request only what exists (so an install with
 * no generated audio produces no failed requests at all).
 */
export function audioRoutes(): Record<string, (req: Bun.BunRequest<string>) => Promise<Response>> {
  return {
    [`${AUDIO_BASE}/${MANIFEST_FILE}`]: async () => Response.json(await presentSamples()),
    [`${AUDIO_BASE}/:file`]: async (req) => {
      const name = req.params.file ?? "";
      if (!SAFE_NAME.test(name)) return new Response("Not found", { status: 404 });
      const file = Bun.file(`${AUDIO_DIR}${name}`);
      if (!(await file.exists())) return new Response("Not found", { status: 404 });
      return new Response(file, { headers: { "Cache-Control": "public, max-age=31536000, immutable" } });
    },
  };
}
