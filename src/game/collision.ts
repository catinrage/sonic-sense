import { clamp } from "../core/math";

export interface BlockQuery {
  /** True when the tile blocks bodies of the given kind. */
  isBlocked(tx: number, ty: number): boolean;
}

export interface CircleObstacle {
  x: number;
  y: number;
  r: number;
}

export interface MoveResult {
  x: number;
  y: number;
  hit: boolean;
}

/** Push a circle out of any blocked tiles it overlaps. */
function resolveTiles(q: BlockQuery, x: number, y: number, r: number): { x: number; y: number; hit: boolean } {
  let hit = false;
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    const tx0 = Math.floor(x - r);
    const tx1 = Math.floor(x + r);
    const ty0 = Math.floor(y - r);
    const ty1 = Math.floor(y + r);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (!q.isBlocked(tx, ty)) continue;
        const cx = clamp(x, tx, tx + 1);
        const cy = clamp(y, ty, ty + 1);
        const dx = x - cx;
        const dy = y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2);
          x += (dx / d) * (r - d);
          y += (dy / d) * (r - d);
        } else {
          // Center inside the tile: exit along the shortest axis.
          const left = x - tx;
          const right = tx + 1 - x;
          const up = y - ty;
          const down = ty + 1 - y;
          const m = Math.min(left, right, up, down);
          if (m === left) x = tx - r;
          else if (m === right) x = tx + 1 + r;
          else if (m === up) y = ty - r;
          else y = ty + 1 + r;
        }
        moved = true;
        hit = true;
      }
    }
    if (!moved) break;
  }
  return { x, y, hit };
}

function resolveCircles(obstacles: readonly CircleObstacle[], x: number, y: number, r: number): { x: number; y: number } {
  for (const o of obstacles) {
    const dx = x - o.x;
    const dy = y - o.y;
    const min = r + o.r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min) continue;
    const d = Math.sqrt(d2) || 1e-4;
    x = o.x + (dx / d) * min;
    y = o.y + (dy / d) * min;
  }
  return { x, y };
}

/** Moves a circle by (dx, dy) with sub-stepping, sliding along walls and round obstacles. */
export function moveCircle(
  q: BlockQuery,
  obstacles: readonly CircleObstacle[],
  x: number,
  y: number,
  r: number,
  dx: number,
  dy: number,
): MoveResult {
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (r * 0.45)));
  let hit = false;
  for (let i = 0; i < steps; i++) {
    x += dx / steps;
    y += dy / steps;
    const c = resolveCircles(obstacles, x, y, r);
    const t = resolveTiles(q, c.x, c.y, r);
    x = t.x;
    y = t.y;
    hit = hit || t.hit;
  }
  return { x, y, hit };
}
