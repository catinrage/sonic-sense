/**
 * Print a level with reachability overlay:  bun tools/level-map.ts [levelIndex]
 * Unreachable walkable tiles are shown as '?'.
 */
import { LEVELS } from "../src/game/levels";
import { parseLevel } from "../src/game/level-parser";
import { checkLevel } from "../src/game/level-check";

const which = process.argv[2];
const list = which === undefined ? LEVELS.map((_, i) => i) : [Number(which)];
for (const i of list) {
  const def = LEVELS[i]!;
  const level = parseLevel(def);
  const report = checkLevel(level);
  console.log(`\n=== ${i}: ${def.chapter} ${def.title} (${level.w}x${level.h}) opened groups: [${report.openedGroups.join(",")}]`);
  for (let y = 0; y < level.h; y++) {
    let row = "";
    for (let x = 0; x < level.w; x++) {
      const ch = def.map[y]?.[x] ?? " ";
      const reach = report.reachable[y * level.w + x] === 1;
      const walk = ".,@X*~sdm".includes(ch) || (/[a-z]/.test(ch) && ch !== "o");
      row += walk && !reach ? "?" : ch;
    }
    console.log(`${String(y).padStart(2)} ${row}`);
  }
  console.log(report.errors.length ? `ERRORS:\n  ${report.errors.join("\n  ")}` : "OK");
}
