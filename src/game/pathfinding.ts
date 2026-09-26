import type { Vec2 } from "../core/math";

export interface WalkGrid {
  readonly w: number;
  readonly h: number;
  isWalkable(tx: number, ty: number): boolean;
}

const DIRS: readonly (readonly [number, number, number])[] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/** Nearest walkable tile to (tx, ty) within `radius`, or null. */
export function nearestWalkable(grid: WalkGrid, tx: number, ty: number, radius = 3): Vec2 | null {
  if (grid.isWalkable(tx, ty)) return { x: tx, y: ty };
  let best: Vec2 | null = null;
  let bestD = Infinity;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const d = dx * dx + dy * dy;
      if (d < bestD && grid.isWalkable(tx + dx, ty + dy)) {
        bestD = d;
        best = { x: tx + dx, y: ty + dy };
      }
    }
  }
  return best;
}

/**
 * A* over tiles with 8-way movement (no corner cutting).
 * Returns tile centers from start (exclusive) to goal (inclusive), or null.
 */
export function findPath(grid: WalkGrid, sx: number, sy: number, gx: number, gy: number, maxNodes = 4000): Vec2[] | null {
  const { w, h } = grid;
  if (!grid.isWalkable(gx, gy)) return null;
  const n = w * h;
  const start = sy * w + sx;
  const goal = gy * w + gx;
  if (start === goal) return [];
  const g = new Float32Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const open: { i: number; f: number }[] = [];
  const heur = (i: number) => {
    const dx = Math.abs((i % w) - gx);
    const dy = Math.abs(((i / w) | 0) - gy);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  const push = (i: number, f: number) => {
    open.push({ i, f });
    let k = open.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (open[p]!.f <= open[k]!.f) break;
      [open[p], open[k]] = [open[k]!, open[p]!];
      k = p;
    }
  };
  const pop = () => {
    const top = open[0]!;
    const last = open.pop()!;
    if (open.length > 0) {
      open[0] = last;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1;
        const r = l + 1;
        let m = k;
        if (l < open.length && open[l]!.f < open[m]!.f) m = l;
        if (r < open.length && open[r]!.f < open[m]!.f) m = r;
        if (m === k) break;
        [open[m], open[k]] = [open[k]!, open[m]!];
        k = m;
      }
    }
    return top;
  };

  g[start] = 0;
  push(start, heur(start));
  let expanded = 0;
  while (open.length > 0 && expanded < maxNodes) {
    const { i } = pop();
    if (closed[i]) continue;
    if (i === goal) break;
    closed[i] = 1;
    expanded++;
    const x = i % w;
    const y = (i / w) | 0;
    for (const [dx, dy, cost] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (!grid.isWalkable(nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (!grid.isWalkable(x + dx, y) || !grid.isWalkable(x, y + dy))) continue;
      const ni = ny * w + nx;
      const ng = g[i]! + cost;
      if (ng < g[ni]!) {
        g[ni] = ng;
        came[ni] = i;
        push(ni, ng + heur(ni));
      }
    }
  }
  if (came[goal] === -1) return null;
  const path: Vec2[] = [];
  for (let i = goal; i !== start; i = came[i]!) path.push({ x: (i % w) + 0.5, y: ((i / w) | 0) + 0.5 });
  return path.reverse();
}
