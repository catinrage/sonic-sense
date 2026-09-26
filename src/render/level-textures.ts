import { TILE } from "../game/level-types";
import { createTexture, type GL } from "./gl";

/** Texels per tile of the wall-distance texture. */
export const WALLDIST_RES = 8;

/** Read-only view of the world the level textures are built from. */
export interface TileSource {
  readonly w: number;
  readonly h: number;
  readonly tiles: Uint8Array;
  readonly variant: Uint8Array;
  readonly decor: Uint8Array;
  /** Door open amount per tile (0 closed .. 1 sunk into the floor). */
  readonly doorOpen: Float32Array;
  /** Door sigil glow per tile (0..1). */
  readonly doorGlow: Float32Array;
}

/**
 * GPU copies of the tile map:
 *  - tiles:    RGBA8 per tile (type, variant, door open, decor | door glow)
 *  - wallDist: RGBA8 at WALLDIST_RES per tile (distance to walls, pits, shore)
 */
export class LevelTextures {
  readonly w: number;
  readonly h: number;
  readonly tiles: WebGLTexture;
  readonly wallDist: WebGLTexture;
  private readonly tileData: Uint8Array;
  private readonly distData: Uint8Array;
  private tilesDirty = true;
  private distDirty = true;
  private lastWalls: Uint8Array = new Uint8Array(0);

  constructor(
    gl: GL,
    private readonly src: TileSource,
  ) {
    this.w = src.w;
    this.h = src.h;
    this.tileData = new Uint8Array(src.w * src.h * 4);
    this.distData = new Uint8Array(src.w * WALLDIST_RES * src.h * WALLDIST_RES * 4);
    this.tiles = createTexture(gl, {
      width: src.w,
      height: src.h,
      internalFormat: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      filter: gl.NEAREST,
    });
    this.wallDist = createTexture(gl, {
      width: src.w * WALLDIST_RES,
      height: src.h * WALLDIST_RES,
      internalFormat: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
    });
    this.lastWalls = this.wallMask();
    this.rebuildDistances();
  }

  dispose(gl: GL): void {
    gl.deleteTexture(this.tiles);
    gl.deleteTexture(this.wallDist);
  }

  /** Door animation or glow changed. */
  markTilesDirty(): void {
    this.tilesDirty = true;
  }

  /** Solidity changed (a door crossed its open threshold): refresh only around changed tiles. */
  markSolidityDirty(): void {
    this.tilesDirty = true;
    const next = this.wallMask();
    const prev = this.lastWalls;
    for (let i = 0; i < next.length; i++) {
      if (next[i] === prev[i]) continue;
      const tx = i % this.w;
      const ty = (i / this.w) | 0;
      this.rebuildDistances(tx - 1, ty - 1, tx + 1, ty + 1);
    }
    this.lastWalls = next;
  }

  sync(gl: GL): void {
    if (this.tilesDirty) {
      this.packTiles();
      gl.bindTexture(gl.TEXTURE_2D, this.tiles);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.w, this.h, gl.RGBA, gl.UNSIGNED_BYTE, this.tileData);
      this.tilesDirty = false;
    }
    if (this.distDirty) {
      gl.bindTexture(gl.TEXTURE_2D, this.wallDist);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        this.w * WALLDIST_RES,
        this.h * WALLDIST_RES,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        this.distData,
      );
      this.distDirty = false;
    }
  }

  private packTiles(): void {
    const { src, tileData } = this;
    for (let i = 0; i < src.w * src.h; i++) {
      const type = src.tiles[i]!;
      const o = i * 4;
      tileData[o] = type;
      tileData[o + 1] = src.variant[i]!;
      tileData[o + 2] = Math.round(src.doorOpen[i]! * 255);
      tileData[o + 3] = type === TILE.Door ? Math.round(Math.min(1, src.doorGlow[i]!) * 255) : src.decor[i]!;
    }
  }

  /** 1 where the tile blocks like a wall (walls, closed doors). */
  private wallMask(): Uint8Array {
    const { src } = this;
    const mask = new Uint8Array(src.w * src.h);
    for (let i = 0; i < mask.length; i++) {
      const t = src.tiles[i];
      mask[i] = t === TILE.Wall || (t === TILE.Door && src.doorOpen[i]! < 0.5) ? 1 : 0;
    }
    return mask;
  }

  /** Recompute distance texels for tiles in [tx0..tx1] x [ty0..ty1] (clamped). */
  private rebuildDistances(tx0 = 0, ty0 = 0, tx1 = this.w - 1, ty1 = this.h - 1): void {
    const { src, distData } = this;
    const R = WALLDIST_RES;
    const W = src.w * R;
    const walls = this.lastWalls.length ? this.lastWalls : this.wallMask();
    const n = src.w * src.h;
    const pits = new Uint8Array(n);
    const dry = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      pits[i] = src.tiles[i] === TILE.Pit ? 1 : 0;
      dry[i] = src.tiles[i] === TILE.Water ? 0 : 1;
    }
    const x0 = Math.max(0, tx0);
    const y0 = Math.max(0, ty0);
    const x1 = Math.min(src.w - 1, tx1);
    const y1 = Math.min(src.h - 1, ty1);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const inWater = dry[ty * src.w + tx] === 0;
        for (let sy = 0; sy < R; sy++) {
          for (let sx = 0; sx < R; sx++) {
            const x = tx + (sx + 0.5) / R;
            const y = ty + (sy + 0.5) / R;
            const o = ((ty * R + sy) * W + tx * R + sx) * 4;
            distData[o] = encode(nearest(walls, src.w, src.h, x, y, tx, ty, 1));
            distData[o + 1] = encode(nearest(pits, src.w, src.h, x, y, tx, ty, 0));
            distData[o + 2] = inWater ? encode(nearest(dry, src.w, src.h, x, y, tx, ty, 1)) : 0;
            distData[o + 3] = 255;
          }
        }
      }
    }
    this.distDirty = true;
  }
}

/**
 * Distance from (x, y) to the nearest flagged tile among the 3x3 neighbourhood of
 * (tx, ty), capped at one tile. Out-of-bounds tiles count as `outside`.
 */
function nearest(mask: Uint8Array, w: number, h: number, x: number, y: number, tx: number, ty: number, outside: number): number {
  let best = 1;
  for (let dy = -1; dy <= 1; dy++) {
    const ny = ty + dy;
    for (let dx = -1; dx <= 1; dx++) {
      const nx = tx + dx;
      const flagged = nx < 0 || ny < 0 || nx >= w || ny >= h ? outside : mask[ny * w + nx];
      if (!flagged) continue;
      const qx = Math.max(Math.abs(x - (nx + 0.5)) - 0.5, 0);
      const qy = Math.max(Math.abs(y - (ny + 0.5)) - 0.5, 0);
      const d = Math.sqrt(qx * qx + qy * qy);
      if (d < best) best = d;
    }
  }
  return best;
}

const encode = (d: number): number => Math.round(Math.min(1, Math.max(0, d)) * 255);
