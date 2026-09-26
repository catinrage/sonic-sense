/**
 * Sound propagation fields.
 *
 * Each sound computes a geodesic ("around corners") distance field on a sub-tile
 * grid using an any-angle Dijkstra (Theta*-style virtual sources). Cells that
 * see the emitter directly get the exact Euclidean distance, so wavefronts stay
 * perfectly round in open space and bend smoothly around corners.
 *
 * Per cell we also store the propagation direction (for lighting) and an energy
 * term that drops as the wave diffracts into shadow regions.
 *
 * The job is resumable: `advance(d)` settles every cell up to distance d, so a
 * large wave can be solved progressively just ahead of its visible front.
 */

import { clamp, smoothstep } from "../core/math";

export const FIELD_RES = 4;
/** How far (in tiles) sound "soaks" into walls so their faces and rims can be lit. */
export const WALL_EXT = 1.8;
export const UNREACHED = 1e4;

const STEP = 1 / FIELD_RES;
const DIAG_STEP = Math.SQRT2 / FIELD_RES;
const EPS = 1e-5;
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

export class SoundGrid {
  readonly res = FIELD_RES;
  readonly gw: number;
  readonly gh: number;
  readonly solidTile: Uint8Array;
  readonly solidCell: Uint8Array;

  constructor(
    readonly tilesW: number,
    readonly tilesH: number,
  ) {
    this.gw = tilesW * FIELD_RES;
    this.gh = tilesH * FIELD_RES;
    this.solidTile = new Uint8Array(tilesW * tilesH);
    this.solidCell = new Uint8Array(this.gw * this.gh);
  }

  /** Replace the sound-blocking mask (1 = blocks sound). */
  setSolidTiles(mask: Uint8Array): void {
    if (mask.length !== this.solidTile.length) throw new Error("SoundGrid: solid mask size mismatch");
    this.solidTile.set(mask);
    const { gw, gh, tilesW } = this;
    for (let gy = 0; gy < gh; gy++) {
      const row = ((gy / FIELD_RES) | 0) * tilesW;
      for (let gx = 0; gx < gw; gx++) this.solidCell[gy * gw + gx] = mask[row + ((gx / FIELD_RES) | 0)]!;
    }
  }

  solidAt(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.tilesW || ty >= this.tilesH) return true;
    return this.solidTile[ty * this.tilesW + tx] === 1;
  }

  /** Exact segment-vs-tile test (Amanatides & Woo). Diagonal corner squeezes are blocked. */
  lineOfSight(x0: number, y0: number, x1: number, y1: number): boolean {
    let tx = Math.floor(x0);
    let ty = Math.floor(y0);
    const ex = Math.floor(x1);
    const ey = Math.floor(y1);
    if (this.solidAt(tx, ty)) return false;
    if (tx === ex && ty === ey) return true;

    const dx = x1 - x0;
    const dy = y1 - y0;
    const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const sy = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    const tdx = sx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tdy = sy !== 0 ? Math.abs(1 / dy) : Infinity;
    let tmx = sx > 0 ? (tx + 1 - x0) * tdx : sx < 0 ? (x0 - tx) * tdx : Infinity;
    let tmy = sy > 0 ? (ty + 1 - y0) * tdy : sy < 0 ? (y0 - ty) * tdy : Infinity;

    let steps = Math.abs(ex - tx) + Math.abs(ey - ty) + 2;
    while (steps-- > 0) {
      if (Math.abs(tmx - tmy) < 1e-9) {
        if (this.solidAt(tx + sx, ty) || this.solidAt(tx, ty + sy)) return false;
        tx += sx;
        ty += sy;
        tmx += tdx;
        tmy += tdy;
      } else if (tmx < tmy) {
        tx += sx;
        tmx += tdx;
      } else {
        ty += sy;
        tmy += tdy;
      }
      if (this.solidAt(tx, ty)) return false;
      if (tx === ex && ty === ey) return true;
    }
    return tx === ex && ty === ey;
  }
}

export interface WallHit {
  x: number;
  y: number;
  nx: number;
  ny: number;
  d: number;
  e: number;
}

export interface FieldSample {
  d: number;
  e: number;
}

/** Energy kept when bending by an angle (cosine of the bend) around an obstacle. */
export function diffractionLoss(cosBend: number): number {
  const angle = Math.acos(clamp(cosBend, -1, 1));
  return 1 - 0.62 * smoothstep(0.1, 1.75, angle);
}

/** Energy attenuation inside walls, by penetration depth. */
function wallFalloff(depth: number): number {
  const t = 1 - depth / WALL_EXT;
  return t <= 0 ? 0 : t;
}

export class FieldJob {
  readonly x0: number;
  readonly y0: number;
  readonly bw: number;
  readonly bh: number;
  /** RGBA per cell: distance, dirX, dirY, energy. Ready for texture upload. */
  readonly data: Float32Array;
  readonly maxDist: number;
  originX: number;
  originY: number;
  done = false;
  /** Every cell with distance <= frontier holds its final value. */
  frontier = 0;
  /** Set whenever `data` changes; cleared by the renderer after upload. */
  dirty = true;
  hits: WallHit[] = [];

  private readonly dist: Float32Array;
  private readonly vs: Int32Array;
  private readonly energy: Float32Array;
  private readonly wallDepth: Float32Array;
  private readonly vsDirX: Float32Array;
  private readonly vsDirY: Float32Array;
  private readonly vsEnergy: Float32Array;
  private readonly vsSet: Uint8Array;
  private heapKeys: Float64Array;
  private heapVals: Int32Array;
  private heapSize = 0;

  constructor(
    private readonly grid: SoundGrid,
    ox: number,
    oy: number,
    radius: number,
    private readonly collectHits = false,
  ) {
    const S = FIELD_RES;
    this.maxDist = radius + WALL_EXT;
    this.x0 = Math.max(0, Math.floor((ox - this.maxDist) * S) - 1);
    this.y0 = Math.max(0, Math.floor((oy - this.maxDist) * S) - 1);
    const x1 = Math.min(grid.gw - 1, Math.ceil((ox + this.maxDist) * S) + 1);
    const y1 = Math.min(grid.gh - 1, Math.ceil((oy + this.maxDist) * S) + 1);
    this.bw = Math.max(1, x1 - this.x0 + 1);
    this.bh = Math.max(1, y1 - this.y0 + 1);

    const n = this.bw * this.bh;
    this.dist = new Float32Array(n).fill(UNREACHED);
    this.vs = new Int32Array(n).fill(-1);
    this.energy = new Float32Array(n);
    this.wallDepth = new Float32Array(n);
    this.vsDirX = new Float32Array(n);
    this.vsDirY = new Float32Array(n);
    this.vsEnergy = new Float32Array(n);
    this.vsSet = new Uint8Array(n);
    this.data = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) this.data[i * 4] = UNREACHED;

    const cap = Math.max(64, n * 2);
    this.heapKeys = new Float64Array(cap);
    this.heapVals = new Int32Array(cap);

    this.originX = ox;
    this.originY = oy;
    this.seed(ox, oy);
  }

  /** Settle all cells up to distance `until` (tiles). */
  advance(until: number): void {
    if (this.done) return;
    const limit = Math.min(until, this.maxDist);
    while (this.heapSize > 0) {
      const d = this.heapKeys[0]!;
      if (d > this.maxDist) break;
      if (d > limit) {
        this.frontier = limit;
        return;
      }
      const c = this.pop();
      if (d > this.dist[c]! + EPS) continue;
      this.expand(c, d);
    }
    this.finish();
  }

  /** Bilinear sample of distance/energy at a world position. */
  sample(x: number, y: number, out: FieldSample): FieldSample {
    const fx = x * FIELD_RES - 0.5 - this.x0;
    const fy = y * FIELD_RES - 0.5 - this.y0;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    let dSum = 0;
    let eSum = 0;
    let wSum = 0;
    let dMin = UNREACHED;
    for (let k = 0; k < 4; k++) {
      const cx = ix + (k & 1);
      const cy = iy + (k >> 1);
      if (cx < 0 || cy < 0 || cx >= this.bw || cy >= this.bh) continue;
      const o = (cy * this.bw + cx) * 4;
      const d = this.data[o]!;
      if (d >= UNREACHED) continue;
      const w = ((k & 1) ? tx : 1 - tx) * ((k >> 1) ? ty : 1 - ty);
      dSum += d * w;
      eSum += this.data[o + 3]! * w;
      wSum += w;
      if (d < dMin) dMin = d;
    }
    if (wSum < 1e-6) {
      out.d = UNREACHED;
      out.e = 0;
    } else {
      out.d = wSum > 0.999 ? dSum : Math.max(dSum / wSum, dMin);
      out.e = eSum / wSum;
    }
    return out;
  }

  private seed(ox: number, oy: number): void {
    const { grid } = this;
    let gx = clamp(Math.floor(ox * FIELD_RES), 0, grid.gw - 1);
    let gy = clamp(Math.floor(oy * FIELD_RES), 0, grid.gh - 1);
    if (grid.solidCell[gy * grid.gw + gx]) {
      const free = this.nearestFreeCell(gx, gy);
      if (!free) {
        this.done = true;
        return;
      }
      [gx, gy] = free;
      this.originX = (gx + 0.5) / FIELD_RES;
      this.originY = (gy + 0.5) / FIELD_RES;
    }
    const s = (gx - this.x0) + (gy - this.y0) * this.bw;
    this.dist[s] = Math.hypot((gx + 0.5) / FIELD_RES - this.originX, (gy + 0.5) / FIELD_RES - this.originY);
    this.vs[s] = -1;
    this.energy[s] = 1;
    this.writeOut(s);
    this.push(s, this.dist[s]!);
  }

  private nearestFreeCell(gx: number, gy: number): [number, number] | null {
    const { grid } = this;
    for (let r = 1; r <= FIELD_RES * 2; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = gx + dx;
          const y = gy + dy;
          if (x < this.x0 || y < this.y0 || x >= this.x0 + this.bw || y >= this.y0 + this.bh) continue;
          if (!grid.solidCell[y * grid.gw + x]) return [x, y];
        }
      }
    }
    return null;
  }

  private expand(c: number, d: number): void {
    const { grid, bw, bh, dist, vs } = this;
    const gw = grid.gw;
    const solid = grid.solidCell;
    const lx = c % bw;
    const ly = (c / bw) | 0;
    const gx = lx + this.x0;
    const gy = ly + this.y0;
    const gIdx = gy * gw + gx;
    const cSolid = solid[gIdx] === 1;
    if (this.collectHits && !cSolid) this.recordHits(c, gx, gy, gIdx, d);

    for (let k = 0; k < 8; k++) {
      const dx = DX[k]!;
      const dy = DY[k]!;
      const nlx = lx + dx;
      const nly = ly + dy;
      if (nlx < 0 || nly < 0 || nlx >= bw || nly >= bh) continue;
      const n = nly * bw + nlx;
      const diag = dx !== 0 && dy !== 0;
      const step = diag ? DIAG_STEP : STEP;

      if (solid[gIdx + dy * gw + dx]) {
        const wd = (cSolid ? this.wallDepth[c]! : 0) + step;
        const nd = d + step;
        if (wd > WALL_EXT || nd >= dist[n]! - EPS) continue;
        dist[n] = nd;
        vs[n] = vs[c]!;
        this.energy[n] = this.energy[c]!;
        this.wallDepth[n] = wd;
        this.writeOut(n);
        this.push(n, nd);
        continue;
      }
      // Walls never feed sound back into open space.
      if (cSolid) continue;
      if (diag && (solid[gIdx + dx] || solid[gIdx + dy * gw])) continue;

      const cur = dist[n]!;
      const px = (gx + dx + 0.5) / FIELD_RES;
      const py = (gy + dy + 0.5) / FIELD_RES;
      const v = vs[c]!;
      let vx = this.originX;
      let vy = this.originY;
      let vd = 0;
      if (v >= 0) {
        vx = ((v % bw) + this.x0 + 0.5) / FIELD_RES;
        vy = (((v / bw) | 0) + this.y0 + 0.5) / FIELD_RES;
        vd = dist[v]!;
      }
      const nd1 = vd + Math.hypot(px - vx, py - vy);
      // The straight path is never longer than the bent one: nothing to gain.
      if (nd1 >= cur - EPS) continue;

      if (grid.lineOfSight(vx, vy, px, py)) {
        dist[n] = nd1;
        vs[n] = v;
        this.energy[n] = this.energyVia(v, vx, vy, px, py);
      } else {
        const nd2 = d + step;
        if (nd2 >= cur - EPS) continue;
        this.markVirtualSource(c);
        const cx = (gx + 0.5) / FIELD_RES;
        const cy = (gy + 0.5) / FIELD_RES;
        dist[n] = nd2;
        vs[n] = c;
        this.energy[n] = this.energyVia(c, cx, cy, px, py);
      }
      this.wallDepth[n] = 0;
      this.writeOut(n);
      this.push(n, dist[n]!);
    }
  }

  private markVirtualSource(c: number): void {
    if (this.vsSet[c]) return;
    this.vsSet[c] = 1;
    const cx = ((c % this.bw) + this.x0 + 0.5) / FIELD_RES;
    const cy = (((c / this.bw) | 0) + this.y0 + 0.5) / FIELD_RES;
    const [vx, vy] = this.vsPosition(this.vs[c]!);
    const len = Math.hypot(cx - vx, cy - vy);
    this.vsDirX[c] = len > 1e-6 ? (cx - vx) / len : 0;
    this.vsDirY[c] = len > 1e-6 ? (cy - vy) / len : 0;
    this.vsEnergy[c] = this.energy[c]!;
  }

  private energyVia(v: number, vx: number, vy: number, px: number, py: number): number {
    if (v < 0) return 1;
    const ix = this.vsDirX[v]!;
    const iy = this.vsDirY[v]!;
    const e = this.vsEnergy[v]!;
    if (ix === 0 && iy === 0) return e;
    const dx = px - vx;
    const dy = py - vy;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return e;
    return e * diffractionLoss((dx * ix + dy * iy) / len);
  }

  private vsPosition(v: number): [number, number] {
    if (v < 0) return [this.originX, this.originY];
    return [((v % this.bw) + this.x0 + 0.5) / FIELD_RES, (((v / this.bw) | 0) + this.y0 + 0.5) / FIELD_RES];
  }

  private writeOut(n: number): void {
    const o = n * 4;
    const px = ((n % this.bw) + this.x0 + 0.5) / FIELD_RES;
    const py = (((n / this.bw) | 0) + this.y0 + 0.5) / FIELD_RES;
    const [vx, vy] = this.vsPosition(this.vs[n]!);
    const dx = px - vx;
    const dy = py - vy;
    const len = Math.hypot(dx, dy);
    const wd = this.wallDepth[n]!;
    this.data[o] = this.dist[n]!;
    this.data[o + 1] = len > 1e-6 ? dx / len : 0;
    this.data[o + 2] = len > 1e-6 ? dy / len : 0;
    this.data[o + 3] = wd > 0 ? this.energy[n]! * wallFalloff(wd) : this.energy[n]!;
    this.dirty = true;
  }

  private finish(): void {
    this.heapSize = 0;
    this.done = true;
    this.frontier = Infinity;
  }

  /** Wall faces touched by this cell; cells settle in distance order so hits stay sorted. */
  private recordHits(c: number, gx: number, gy: number, gIdx: number, d: number): void {
    const { grid } = this;
    for (let k = 0; k < 4; k++) {
      const nx = gx + DX[k]!;
      const ny = gy + DY[k]!;
      if (nx < 0 || ny < 0 || nx >= grid.gw || ny >= grid.gh) continue;
      if (!grid.solidCell[gIdx + DY[k]! * grid.gw + DX[k]!]) continue;
      this.hits.push({
        x: (gx + 0.5 + DX[k]! * 0.5) / FIELD_RES,
        y: (gy + 0.5 + DY[k]! * 0.5) / FIELD_RES,
        nx: -DX[k]!,
        ny: -DY[k]!,
        d,
        e: this.energy[c]!,
      });
    }
  }

  private push(value: number, key: number): void {
    if (this.heapSize >= this.heapKeys.length) {
      const keys = new Float64Array(this.heapKeys.length * 2);
      const vals = new Int32Array(this.heapVals.length * 2);
      keys.set(this.heapKeys);
      vals.set(this.heapVals);
      this.heapKeys = keys;
      this.heapVals = vals;
    }
    const keys = this.heapKeys;
    const vals = this.heapVals;
    let i = this.heapSize++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p]! <= key) break;
      keys[i] = keys[p]!;
      vals[i] = vals[p]!;
      i = p;
    }
    keys[i] = key;
    vals[i] = value;
  }

  private pop(): number {
    const keys = this.heapKeys;
    const vals = this.heapVals;
    const top = vals[0]!;
    const n = --this.heapSize;
    if (n > 0) {
      const key = keys[n]!;
      const val = vals[n]!;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= n) break;
        const r = l + 1;
        const m = r < n && keys[r]! < keys[l]! ? r : l;
        if (keys[m]! >= key) break;
        keys[i] = keys[m]!;
        vals[i] = vals[m]!;
        i = m;
      }
      keys[i] = key;
      vals[i] = val;
    }
    return top;
  }
}
