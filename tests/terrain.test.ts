import { describe, expect, test } from "bun:test";
import { FieldJob, SoundGrid, WIND_BIAS, type FieldSample } from "../src/game/geodesic";
import { WIND_CHARS, WIND_DIRS } from "../src/game/level-types";

/** '#' blocks sound, ':' is silt, '>' '<' 'v' '^' are drafts; anything else is open floor. */
function gridFrom(rows: string[], windSign: 1 | -1 = 1): SoundGrid {
  const h = rows.length;
  const w = rows[0]!.length;
  const grid = new SoundGrid(w, h);
  const solid = new Uint8Array(w * h);
  const silt = new Uint8Array(w * h);
  const wind = new Int8Array(w * h).fill(-1);
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const i = y * w + x;
      solid[i] = ch === "#" ? 1 : 0;
      silt[i] = ch === ":" ? 1 : 0;
      wind[i] = WIND_CHARS.indexOf(ch);
    }),
  );
  grid.setSolidTiles(solid);
  grid.setSiltTiles(silt);
  grid.setWind(wind, windSign);
  return grid;
}

function solve(grid: SoundGrid, x: number, y: number, radius: number): FieldJob {
  const job = new FieldJob(grid, x, y, radius);
  job.advance(Infinity);
  return job;
}

const sample = (job: FieldJob, x: number, y: number): FieldSample => job.sample(x, y, { d: 0, e: 0, dx: 0, dy: 0 });
const room = (fill: string, w = 20, h = 11): string[] => [
  "#".repeat(w),
  ...Array.from({ length: h - 2 }, () => "#" + fill.repeat(w - 2) + "#"),
  "#".repeat(w),
];

describe("wind directions", () => {
  test("are indexed in map-character order: east, west, south, north", () => {
    expect(WIND_DIRS).toEqual([
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]);
  });
});

describe("silt", () => {
  const hall = (mid: string) => ["############", `#..${mid}..#`, "############"];

  test("drinks the energy of sound that crosses it, without changing the path length", () => {
    const clear = sample(solve(gridFrom(hall("......")), 1.5, 1.5, 14), 10.5, 1.5);
    const muffled = sample(solve(gridFrom(hall("::::::")), 1.5, 1.5, 14), 10.5, 1.5);
    expect(muffled.d).toBeCloseTo(clear.d, 2);
    expect(clear.e).toBeCloseTo(1, 2);
    expect(muffled.e).toBeLessThan(0.1);
    expect(muffled.e).toBeGreaterThan(0.005);
  });

  test("absorbs more the more of it the sound crosses", () => {
    const thin = sample(solve(gridFrom(hall("..::..")), 1.5, 1.5, 14), 10.5, 1.5);
    const thick = sample(solve(gridFrom(hall("::::::")), 1.5, 1.5, 14), 10.5, 1.5);
    expect(thin.e).toBeLessThan(0.6);
    expect(thick.e).toBeLessThan(thin.e * 0.4);
  });
});

describe("drafts", () => {
  test("carry sound further downwind and shorter upwind", () => {
    const job = solve(gridFrom(room(">")), 10.5, 5.5, 14);
    const down = sample(job, 16.5, 5.5).d;
    const up = sample(job, 4.5, 5.5).d;
    const across = sample(job, 10.5, 9.5).d;
    expect(down).toBeCloseTo(6 * (1 - WIND_BIAS), 1);
    expect(up).toBeCloseTo(6 * (1 + WIND_BIAS), 1);
    expect(across).toBeCloseTo(4, 1);
  });

  test("keep wavefronts straight-sided: an oblique path costs its exact wind integral", () => {
    const job = solve(gridFrom(room("v", 24, 20)), 4.5, 3.5, 30);
    const [tx, ty] = [17.5, 15.5];
    const len = Math.hypot(tx - 4.5, ty - 3.5);
    const along = (ty - 3.5) / len;
    expect(sample(job, tx, ty).d).toBeCloseTo(len * (1 - WIND_BIAS * along), 1);
  });

  test("let a wave reach beyond its still-air radius downwind", () => {
    const job = solve(gridFrom(room(">", 30)), 3.5, 5.5, 8);
    const far = sample(job, 3.5 + 11, 5.5);
    expect(far.d).toBeLessThan(8);
  });

  test("are antisymmetric: solving backwards against the negated wind gives the forward cost", () => {
    const map = [
      "####################",
      "#......#...........#",
      "#..>>>>#....^^^....#",
      "#..>>>>.....^^^....#",
      "#..>>>>#....^^^....#",
      "#......#...vvvv....#",
      "####################",
    ];
    const from = { x: 1.5, y: 3.5 };
    const to = { x: 17.5, y: 1.5 };
    const forward = sample(solve(gridFrom(map, 1), from.x, from.y, 30), to.x, to.y);
    const backward = sample(solve(gridFrom(map, -1), to.x, to.y, 30), from.x, from.y);
    expect(Math.abs(forward.d - backward.d)).toBeLessThan(0.15);
    expect(Math.abs(forward.e - backward.e)).toBeLessThan(0.08);
  });
});

describe("wind bed", () => {
  test("swells with the drafts around the listener and is silent in still air", async () => {
    const { draftDensity } = await import("../src/audio/director");
    const { World } = await import("../src/game/world");
    const { parseLevel } = await import("../src/game/level-parser");
    const world = new World(
      parseLevel({ id: "wind", chapter: "0", title: "t", tagline: "", map: ["##################", "#@.......>>>>>>>>#", "#........>>>>>>>>#", "##################"] }),
    );
    expect(draftDensity(world, 13, 2)).toBeGreaterThan(0.5);
    expect(draftDensity(world, 1.5, 1.5)).toBeLessThan(0.1);
    const still = new World(parseLevel({ id: "still", chapter: "0", title: "t", tagline: "", map: ["#####", "#@..#", "#####"] }));
    expect(draftDensity(still, 2, 1.5)).toBe(0);
  });
});
