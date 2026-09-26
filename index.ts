import index from "./src/index.html";
import { audioRoutes } from "./src/audio/serve";

const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT ?? 3000);

const server = Bun.serve({
  port,
  routes: {
    "/": index,
    // Generated audio is served from disk rather than bundled, so a build
    // without it still runs (the game falls back to synthesis).
    ...audioRoutes(),
  },
  development: isProduction ? false : { hmr: false, console: true },
});

console.log(`\n  Sonic Sense is listening at ${server.url}\n`);
