import { describe, expect, test } from "bun:test";
import { FIELD_RES, FieldJob, SoundGrid, UNREACHED, diffractionLoss, type FieldSample } from "../src/game/geodesic";

function gridFrom(rows: string[]): SoundGrid {
  const h = rows.length;
  const w = rows[0]!.length;
  const grid = new SoundGrid(w, h);
  const mask = new Uint8Array(w * h);
  rows.forEach((row, y) => [...row].forEach((ch, x) => (mask[y * w + x] = ch === "#" ? 1 : 0)));
  grid.setSolidTiles(mask);
  return grid;
}

const sample = (job: FieldJob, x: number, y: number): FieldSample => job.sample(x, y, { d: 0, e: 0, dx: 0, dy: 0 });

describe("SoundGrid.lineOfSight", () => {
  const grid = gridFrom(["#####", "#...#", "#.#.#", "#...#", "#####"]);

  test("sees across open floor", () => {
    expect(grid.lineOfSight(1.5, 1.5, 3.5, 1.5)).toBe(true);
  });

  test("is blocked by a pillar", () => {
    expect(grid.lineOfSight(1.5, 2.5, 3.5, 2.5)).toBe(false);
  });

  test("blocks squeezing through a diagonal corner gap", () => {
    const diag = gridFrom(["####", "#.##", "##.#", "####"]);
    expect(diag.lineOfSight(1.5, 1.5, 2.5, 2.5)).toBe(false);
  });
});

describe("FieldJob", () => {
  test("open room distances are Euclidean", () => {
    const grid = gridFrom(["############", ...Array(10).fill("#..........#"), "############"]);
    const job = new FieldJob(grid, 3.3, 4.1, 12);
    job.advance(Infinity);
    const s = sample(job, 8.4, 9.2);
    expect(Math.abs(s.d - Math.hypot(8.4 - 3.3, 9.2 - 4.1))).toBeLessThan(0.02);
    expect(s.e).toBeCloseTo(1, 3);
  });

  test("bends around a wall with the geodesic length and loses energy", () => {
    const grid = gridFrom([
      "#########",
      "#.......#",
      "#.......#",
      "#####...#",
      "#.......#",
      "#.......#",
      "#########",
    ]);
    // Source top-left, target bottom-left: path must bend around the wall end at x=5.
    const job = new FieldJob(grid, 1.5, 1.5, 20);
    job.advance(Infinity);
    const s = sample(job, 1.5, 5.5);
    const corner = { x: 5, y: 3 };
    const corner2 = { x: 5, y: 4 };
    const geodesic =
      Math.hypot(corner.x - 1.5, corner.y - 1.5) + 1 + Math.hypot(1.5 - corner2.x, 5.5 - corner2.y);
    expect(s.d).toBeGreaterThan(geodesic - 0.35);
    expect(s.d).toBeLessThan(geodesic + 0.5);
    expect(s.e).toBeLessThan(0.7);
  });

  test("never leaks through solid walls", () => {
    const grid = gridFrom(["#######", "#..#..#", "#..#..#", "#######"]);
    const job = new FieldJob(grid, 1.5, 1.5, 10);
    job.advance(Infinity);
    expect(sample(job, 5.5, 1.5).d).toBe(UNREACHED);
  });

  test("progressive advance matches a full solve", () => {
    const rows = ["##########", "#........#", "#..##....#", "#..##....#", "#........#", "##########"];
    const full = new FieldJob(gridFrom(rows), 1.5, 1.5, 12);
    full.advance(Infinity);
    const step = new FieldJob(gridFrom(rows), 1.5, 1.5, 12);
    for (let r = 0; r < 14; r += 0.37) step.advance(r);
    step.advance(Infinity);
    expect(step.done).toBe(true);
    expect(Array.from(step.data)).toEqual(Array.from(full.data));
  });

  test("collects wall hits sorted by distance", () => {
    const grid = gridFrom(["#####", "#...#", "#...#", "#####"]);
    const job = new FieldJob(grid, 2.5, 2.0, 6, true);
    job.advance(Infinity);
    expect(job.hits.length).toBeGreaterThan(0);
    for (let i = 1; i < job.hits.length; i++) expect(job.hits[i]!.d).toBeGreaterThanOrEqual(job.hits[i - 1]!.d);
  });

  test("respects its radius", () => {
    const grid = gridFrom(["#".repeat(40), ...Array(5).fill("#" + ".".repeat(38) + "#"), "#".repeat(40)]);
    const job = new FieldJob(grid, 2.5, 3.5, 6);
    job.advance(Infinity);
    expect(sample(job, 30.5, 3.5).d).toBe(UNREACHED);
  });
});

describe("diffractionLoss", () => {
  test("is lossless going straight and lossy when bending", () => {
    expect(diffractionLoss(1)).toBeCloseTo(1, 5);
    expect(diffractionLoss(0)).toBeLessThan(0.6);
    expect(diffractionLoss(-1)).toBeGreaterThan(0.3);
  });
});

describe("directional emitters", () => {
  const open = gridFrom(["#################", ...Array(13).fill("#...............#"), "#################"]);
  const beam = { x: 1, y: 0, halfAngle: 0.5 };

  test("launch energy only inside their beam", () => {
    const job = new FieldJob(open, 8.5, 7.5, 12, false, beam);
    job.advance(Infinity);
    expect(sample(job, 13.5, 7.5).e).toBeCloseTo(1, 2);
    expect(sample(job, 12.5, 9.0).e).toBeGreaterThan(0.9);
    expect(sample(job, 3.5, 7.5).e).toBeLessThan(1e-3);
    expect(sample(job, 8.5, 12.5).e).toBeLessThan(1e-3);
  });

  test("keep their beam's energy as it bends around a corner", () => {
    const grid = gridFrom(["##########", "#........#", "#######..#", "#......#.#", "#......#.#", "##########"]);
    const job = new FieldJob(grid, 1.5, 1.5, 20, false, beam);
    job.advance(Infinity);
    expect(sample(job, 8.5, 4.5).e).toBeGreaterThan(0.2);
  });

  test("samples report the direction sound travels", () => {
    const job = new FieldJob(open, 8.5, 7.5, 12);
    job.advance(Infinity);
    const s = sample(job, 8.5, 3.5);
    expect(s.dx).toBeCloseTo(0, 2);
    expect(s.dy).toBeCloseTo(-1, 2);
  });
});

describe("wall soak", () => {
  test("does not squeeze diagonally through a concave corner", () => {
    // A one-tile pocket: the wall cell diagonally past its corner must be reached through a side.
    const grid = gridFrom(["####", "#.##", "####"]);
    const job = new FieldJob(grid, 1.5, 1.5, 4);
    job.advance(Infinity);
    const at = (gx: number, gy: number) => job.data[((gy - job.y0) * job.bw + (gx - job.x0)) * 4]!;
    const corner = at(7, 7);
    const beyond = at(8, 8);
    // Not the direct diagonal step from the corner cell (a squeeze through the shared vertex).
    expect(beyond).toBeGreaterThan(corner + Math.SQRT2 / FIELD_RES + 0.05);
  });
});
