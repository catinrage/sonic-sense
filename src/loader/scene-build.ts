import type { Ctx2D, LoaderCanvas, LoaderField, LoaderScene, LoaderSize, LoaderWorld, MakeCanvas } from "./types";

/**
 * Builds everything the loading scene draws, once per size: the chamber's
 * tiles, the sound field of everything in it that makes a sound (solved around
 * corners, like the game's), what every light-buffer pixel sees through the
 * game's own camera, and the stone itself, pre-rendered with the same wall
 * perspective the game uses — so that when the real renderer takes over, the
 * room does not move.
 *
 * Self-contained on purpose: the loading screen runs it inside a Worker from
 * its source text, so that it keeps animating while the page compiles
 * shaders. It must not refer to anything outside its own body.
 */
export function buildLoaderWorld(scene: LoaderScene, size: LoaderSize, makeCanvas: MakeCanvas, quality = 1, previous: LoaderWorld | null = null): LoaderWorld {
  const SUB = 3;
  const INF = 1e9;
  const WALL_EXT = 1.8;
  const LIGHT_PIXELS = 64000 * quality;
  const { map, cameraHeight: CAM_H, wallHeight: WALL_H, pitDepth: PIT_D } = scene;
  const W = Math.max(1, Math.round(size.width));
  const H = Math.max(1, Math.round(size.height));

  // ---------------------------------------------------------------- tiles
  const h = map.length;
  const w = Math.max(...map.map((r) => r.length));
  const FLOOR = 0;
  const WALL = 1;
  const PIT = 2;
  const WATER = 3;
  const tiles = new Uint8Array(w * h);
  const rubble = new Uint8Array(w * h);
  let player = { x: w / 2, y: h / 2, facing: scene.facing };
  const crystals: { x: number; y: number; seed: number }[] = [];
  const mushrooms: { x: number; y: number; seed: number }[] = [];
  const drips: { x: number; y: number }[] = [];
  const wardens: { x: number; y: number; heading: number }[] = [];
  let gate: { x: number; y: number } | null = null;
  const hash = (x: number, y: number, s: number): number => {
    let n = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = map[y]![x] ?? "#";
      const i = y * w + x;
      const c = { x: x + 0.5, y: y + 0.5 };
      tiles[i] = ch === "#" || ch === " " ? WALL : ch === "o" ? PIT : ch === "~" ? WATER : FLOOR;
      if (ch === ",") rubble[i] = 1;
      if (ch === "@") player = { ...c, facing: scene.facing };
      if (ch === "C") crystals.push({ ...c, seed: hash(x, y, 71) });
      if (ch === "m") mushrooms.push({ ...c, seed: hash(x, y, 13) });
      if (ch === "d") drips.push(c);
      if (ch === "W") wardens.push({ ...c, heading: Math.PI * (0.8 + hash(x, y, 3) * 0.4) });
      if (ch === "X") gate = c;
    }
  }
  const tileAt = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? WALL : tiles[y * w + x]!);
  const camX = player.x + scene.cameraOffset.x;
  const camY = player.y + scene.cameraOffset.y;
  const scale = H / scene.viewHeight;

  // ------------------------------------------------------- sound fields
  const gw = w * SUB;
  const gh = h * SUB;
  const solid = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) solid[gy * gw + gx] = tiles[((gy / SUB) | 0) * w + ((gx / SUB) | 0)] === WALL ? 1 : 0;
  const cellX = (c: number) => ((c % gw) + 0.5) / SUB;
  const cellY = (c: number) => (((c / gw) | 0) + 0.5) / SUB;
  const smooth = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  /** Line of sight between two points, walked cell by cell through the sub-tile grid. */
  const sees = (ax: number, ay: number, bx: number, by: number): boolean => {
    let x = Math.floor(ax * SUB);
    let y = Math.floor(ay * SUB);
    const ex = Math.floor(bx * SUB);
    const ey = Math.floor(by * SUB);
    const dx = (bx - ax) * SUB;
    const dy = (by - ay) * SUB;
    const sx = dx > 0 ? 1 : -1;
    const sy = dy > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(1 / dx) : INF;
    const tdy = dy !== 0 ? Math.abs(1 / dy) : INF;
    let tmx = dx !== 0 ? (sx > 0 ? Math.floor(ax * SUB) + 1 - ax * SUB : ax * SUB - Math.floor(ax * SUB)) * tdx : INF;
    let tmy = dy !== 0 ? (sy > 0 ? Math.floor(ay * SUB) + 1 - ay * SUB : ay * SUB - Math.floor(ay * SUB)) * tdy : INF;
    for (let n = 0; n < 4 * (gw + gh); n++) {
      if (x < 0 || y < 0 || x >= gw || y >= gh || solid[y * gw + x]) return false;
      if (x === ex && y === ey) return true;
      if (tmx < tmy) {
        tmx += tdx;
        x += sx;
      } else {
        tmy += tdy;
        y += sy;
      }
    }
    return true;
  };
  const DX = [1, -1, 0, 0, 1, 1, -1, -1];
  const DY = [0, 0, 1, -1, 1, -1, 1, -1];
  /**
   * Any-angle shortest paths from (sx, sy): a cell sees its parent's parent
   * whenever it can, so fronts stay round in the open and bend round corners,
   * and energy is lost at every bend the way the game loses it.
   */
  const solve = (sx: number, sy: number, maxD: number): { dist: Float32Array; energy: Float32Array } => {
    const n = gw * gh;
    const dist = new Float32Array(n).fill(INF);
    const energy = new Float32Array(n);
    const parent = new Int32Array(n).fill(-1);
    const SRC = -2;
    const heapK: number[] = [];
    const heapV: number[] = [];
    const push = (k: number, v: number) => {
      let i = heapK.length;
      heapK.push(k);
      heapV.push(v);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heapK[p]! <= k) break;
        heapK[i] = heapK[p]!;
        heapV[i] = heapV[p]!;
        i = p;
      }
      heapK[i] = k;
      heapV[i] = v;
    };
    const pop = (): number => {
      const top = heapV[0]!;
      const k = heapK.pop()!;
      const v = heapV.pop()!;
      if (heapK.length > 0) {
        let i = 0;
        for (;;) {
          const l = i * 2 + 1;
          if (l >= heapK.length) break;
          const r = l + 1;
          const c = r < heapK.length && heapK[r]! < heapK[l]! ? r : l;
          if (heapK[c]! >= k) break;
          heapK[i] = heapK[c]!;
          heapV[i] = heapV[c]!;
          i = c;
        }
        heapK[i] = k;
        heapV[i] = v;
      }
      return top;
    };
    const px = (p: number) => (p === SRC ? sx : cellX(p));
    const py = (p: number) => (p === SRC ? sy : cellY(p));
    let start = Math.floor(sy * SUB) * gw + Math.floor(sx * SUB);
    if (solid[start]) {
      for (let k = 0; k < 8; k++) {
        const c = start + DY[k]! * gw + DX[k]!;
        if (c >= 0 && c < n && !solid[c]) {
          start = c;
          break;
        }
      }
    }
    dist[start] = Math.hypot(cellX(start) - sx, cellY(start) - sy);
    energy[start] = 1;
    parent[start] = SRC;
    push(dist[start]!, start);
    while (heapK.length > 0) {
      const d0 = heapK[0]!;
      const c = pop();
      if (d0 > dist[c]! + 1e-6 || d0 > maxD) continue;
      const cx = c % gw;
      const cy = (c / gw) | 0;
      const p = parent[c]!;
      for (let k = 0; k < 8; k++) {
        const nx = cx + DX[k]!;
        const ny = cy + DY[k]!;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const m = ny * gw + nx;
        if (solid[m]) continue;
        const mx = cellX(m);
        const my = cellY(m);
        let via = c;
        let cand = dist[c]! + Math.hypot(mx - cellX(c), my - cellY(c));
        if (sees(px(p), py(p), mx, my)) {
          via = p;
          cand = (p === SRC ? 0 : dist[p]!) + Math.hypot(mx - px(p), my - py(p));
        }
        if (cand >= dist[m]! - 1e-6) continue;
        dist[m] = cand;
        parent[m] = via;
        if (via === SRC) energy[m] = 1;
        else {
          // The bend at the virtual source: incoming direction against outgoing.
          const g = parent[via]!;
          const ix = px(via) - px(g);
          const iy = py(via) - py(g);
          const ox = mx - px(via);
          const oy = my - py(via);
          const len = Math.hypot(ix, iy) * Math.hypot(ox, oy);
          const cos = len > 1e-9 ? (ix * ox + iy * oy) / len : 1;
          const angle = Math.acos(Math.min(1, Math.max(-1, cos)));
          energy[m] = energy[via]! * (1 - 0.62 * smooth(0.1, 1.75, angle));
        }
        push(cand, m);
      }
    }
    // Sound soaks a little way into the walls it strikes, so their rims catch the light.
    const depth = new Float32Array(n).fill(INF);
    const queue: number[] = [];
    for (let c = 0; c < n; c++) {
      if (!solid[c]) continue;
      const cx = c % gw;
      const cy = (c / gw) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = cx + DX[k]!;
        const ny = cy + DY[k]!;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const m = ny * gw + nx;
        if (solid[m] || dist[m]! >= INF) continue;
        const d = dist[m]! + 1 / SUB;
        if (d < dist[c]!) {
          dist[c] = d;
          energy[c] = energy[m]! * (1 - 1 / SUB / WALL_EXT);
          depth[c] = 1 / SUB;
        }
      }
      if (depth[c]! < INF) queue.push(c);
    }
    for (let q = 0; q < queue.length; q++) {
      const c = queue[q]!;
      const cx = c % gw;
      const cy = (c / gw) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = cx + DX[k]!;
        const ny = cy + DY[k]!;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const m = ny * gw + nx;
        const dd = depth[c]! + 1 / SUB;
        if (!solid[m] || dd >= depth[m]! || dd > WALL_EXT) continue;
        depth[m] = dd;
        dist[m] = dist[c]! + 1 / SUB;
        energy[m] = (energy[c]! / Math.max(1e-3, 1 - depth[c]! / WALL_EXT)) * (1 - dd / WALL_EXT);
        queue.push(m);
      }
    }
    return { dist, energy };
  };

  // ----------------------------------------- what each light pixel sees
  const k = Math.min(0.5, Math.sqrt(LIGHT_PIXELS / (W * H)));
  const lw = Math.max(8, Math.round(W * k));
  const lh = Math.max(8, Math.round(H * k));
  const N = lw * lh;
  const surface = new Uint8Array(N);
  const fog = new Float32Array(N).fill(1);
  const sampleX = new Float32Array(N);
  const sampleY = new Float32Array(N);
  const heightOf = (t: number) => (t === WALL ? WALL_H : t === PIT ? -PIT_D : 0);
  for (let j = 0; j < lh; j++) {
    for (let i = 0; i < lw; i++) {
      const o = j * lw + i;
      // The floor point under this pixel, then the game's ray through the height field.
      const Fx = camX + (((i + 0.5) / lw) * W - W / 2) / scale;
      const Fy = camY + (((j + 0.5) / lh) * H - H / 2) / scale;
      const Ax = camX + (Fx - camX) * (1 - WALL_H / CAM_H);
      const Ay = camY + (Fy - camY) * (1 - WALL_H / CAM_H);
      const Bx = camX + (Fx - camX) * (1 + PIT_D / CAM_H);
      const By = camY + (Fy - camY) * (1 + PIT_D / CAM_H);
      const dx = Bx - Ax;
      const dy = By - Ay;
      let tx = Math.floor(Ax);
      let ty = Math.floor(Ay);
      const stx = dx > 0 ? 1 : -1;
      const sty = dy > 0 ? 1 : -1;
      const tdx = Math.abs(dx) > 1e-7 ? 1 / Math.abs(dx) : INF;
      const tdy = Math.abs(dy) > 1e-7 ? 1 / Math.abs(dy) : INF;
      let tmx = Math.abs(dx) > 1e-7 ? (dx > 0 ? 1 - (Ax - tx) : Ax - tx) * tdx : INF;
      let tmy = Math.abs(dy) > 1e-7 ? (dy > 0 ? 1 - (Ay - ty) : Ay - ty) * tdy : INF;
      let sEnter = 0;
      let axis = -1;
      surface[o] = 5;
      for (let step = 0; step < 32; step++) {
        const t = tileAt(tx, ty);
        const ht = heightOf(t);
        const sExit = Math.min(tmx, tmy, 1);
        const zEnter = WALL_H + (-PIT_D - WALL_H) * sEnter;
        const zExit = WALL_H + (-PIT_D - WALL_H) * sExit;
        if (ht >= zEnter - 1e-4) {
          const hx = Ax + dx * sEnter;
          const hy = Ay + dy * sEnter;
          if (axis < 0) {
            surface[o] = t === WALL ? 2 : t === WATER ? 1 : 0;
            sampleX[o] = hx;
            sampleY[o] = hy;
          } else {
            const nx = axis === 0 ? -stx : 0;
            const ny = axis === 1 ? -sty : 0;
            surface[o] = zEnter > 0 ? 3 : 4;
            fog[o] = zEnter > 0 ? 1 : Math.exp(zEnter * 0.85);
            sampleX[o] = hx + nx * 0.12;
            sampleY[o] = hy + ny * 0.12;
          }
          break;
        }
        if (ht >= zExit) {
          const s = (ht - WALL_H) / (-PIT_D - WALL_H);
          surface[o] = t === PIT ? 5 : t === WALL ? 2 : t === WATER ? 1 : 0;
          sampleX[o] = Ax + dx * s;
          sampleY[o] = Ay + dy * s;
          break;
        }
        if (sExit >= 1) break;
        if (tmx < tmy) {
          sEnter = tmx;
          tmx += tdx;
          tx += stx;
          axis = 0;
        } else {
          sEnter = tmy;
          tmy += tdy;
          ty += sty;
          axis = 1;
        }
      }
    }
  }
  const grain = new Float32Array(N);
  for (let o = 0; o < N; o++) grain[o] = hash(o % lw, (o / lw) | 0, 9);

  const sampleField = (f: { dist: Float32Array; energy: Float32Array }, x: number, y: number, out: { d: number; e: number }) => {
    const fx = x * SUB - 0.5;
    const fy = y * SUB - 0.5;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    let dSum = 0;
    let eSum = 0;
    let wSum = 0;
    for (let q = 0; q < 4; q++) {
      const cx = ix + (q & 1);
      const cy = iy + (q >> 1);
      if (cx < 0 || cy < 0 || cx >= gw || cy >= gh) continue;
      const c = cy * gw + cx;
      if (f.dist[c]! >= INF) continue;
      const wt = (q & 1 ? tx : 1 - tx) * (q >> 1 ? ty : 1 - ty);
      dSum += f.dist[c]! * wt;
      eSum += f.energy[c]! * wt;
      wSum += wt;
    }
    out.d = wSum > 1e-6 ? dSum / wSum : INF;
    out.e = wSum > 1e-6 ? eSum / wSum : 0;
    return out;
  };
  const fields: LoaderField[] = [];
  const addField = (x: number, y: number, reach: number): number => {
    // The fields depend on the map alone: a rebuild for a new size or quality keeps them.
    const old = previous?.fields[fields.length];
    const g = old && old.x === x && old.y === y && previous!.w === w && previous!.h === h ? { dist: old.gridDist, energy: old.gridEnergy } : solve(x, y, reach);
    const dist = new Float32Array(N).fill(INF);
    const energy = new Float32Array(N);
    const s = { d: 0, e: 0 };
    for (let o = 0; o < N; o++) {
      if (surface[o] === 5) continue;
      sampleField(g, sampleX[o]!, sampleY[o]!, s);
      dist[o] = s.d;
      energy[o] = s.e;
    }
    fields.push({ x, y, gridDist: g.dist, gridEnergy: g.energy, dist, energy });
    return fields.length - 1;
  };
  const src = {
    creature: addField(player.x, player.y, 21),
    crystals: crystals.map((c) => addField(c.x, c.y, 11)),
    mushrooms: [] as number[],
    drips: drips.map((d) => addField(d.x, d.y, 4)),
    gate: gate ? addField(gate.x, gate.y, 6) : -1,
    wardens: wardens.map((d) => addField(d.x, d.y, 4.5)),
  };

  // ------------------------------------------------ the stone, pre-rendered
  const albedo = makeCanvas(W, H);
  const edges = makeCanvas(W, H);
  const a = albedo.getContext("2d") as Ctx2D;
  const e = edges.getContext("2d") as Ctx2D;
  /** Screen position of a world point at height z, through the game's camera. */
  const sx = (x: number, z = 0) => W / 2 + ((x - camX) * scale) / (1 - z / CAM_H);
  const sy = (y: number, z = 0) => H / 2 + ((y - camY) * scale) / (1 - z / CAM_H);
  const rgb = (r: number, g: number, b: number, m = 1) => `rgb(${Math.round(Math.min(255, r * m))},${Math.round(Math.min(255, g * m))},${Math.round(Math.min(255, b * m))})`;
  const poly = (ctx: Ctx2D, pts: number[]) => {
    ctx.beginPath();
    ctx.moveTo(pts[0]!, pts[1]!);
    for (let q = 2; q < pts.length; q += 2) ctx.lineTo(pts[q]!, pts[q + 1]!);
    ctx.closePath();
  };
  a.fillStyle = "#010207";
  a.fillRect(0, 0, W, H);
  e.fillStyle = "#000";
  e.fillRect(0, 0, W, H);
  const visible = (x: number, y: number, pad: number) => Math.abs(sx(x) - W / 2) < W / 2 + pad * scale && Math.abs(sy(y) - H / 2) < H / 2 + pad * scale;
  const isGround = (t: number) => t === FLOOR;
  e.lineCap = "round";

  /** A flagstone: grout gap, colour drift, a chipped bevel and the odd crack. */
  const slab = (x0: number, y0: number, x1: number, y1: number, seed: number) => {
    const g = 0.016 + 0.01 * hash(seed, 1, 5);
    const X0 = sx(x0 + g);
    const Y0 = sy(y0 + g);
    const X1 = sx(x1 - g);
    const Y1 = sy(y1 - g);
    const tone = 0.84 + 0.3 * hash(seed, 2, 5);
    const warm = hash(seed, 3, 5) - 0.5;
    a.fillStyle = rgb(118 + warm * 14, 121, 132 - warm * 16, tone);
    a.fillRect(X0, Y0, X1 - X0, Y1 - Y0);
    a.fillStyle = "rgba(255,255,255,0.07)";
    a.fillRect(X0, Y0, X1 - X0, Math.max(1, scale * 0.035));
    a.fillRect(X0, Y0, Math.max(1, scale * 0.035), Y1 - Y0);
    a.fillStyle = "rgba(0,0,0,0.16)";
    a.fillRect(X0, Y1 - scale * 0.04, X1 - X0, scale * 0.04);
    a.fillRect(X1 - scale * 0.04, Y0, scale * 0.04, Y1 - Y0);
    e.strokeStyle = "rgba(255,255,255,0.5)";
    e.lineWidth = Math.max(1, scale * 0.02);
    e.strokeRect(X0, Y0, X1 - X0, Y1 - Y0);
    if (hash(seed, 4, 5) < 0.3) {
      a.strokeStyle = "rgba(10,10,12,0.55)";
      a.lineWidth = Math.max(1, scale * 0.012);
      a.beginPath();
      let cx = x0 + (x1 - x0) * (0.2 + 0.6 * hash(seed, 5, 5));
      let cy = y0 + (y1 - y0) * 0.15;
      a.moveTo(sx(cx), sy(cy));
      for (let q = 0; q < 4; q++) {
        cx += (hash(seed, 6 + q, 5) - 0.5) * 0.3;
        cy += (y1 - y0) * 0.18;
        a.lineTo(sx(cx), sy(cy));
      }
      a.stroke();
    }
  };
  // Grout first: the joints between the slabs are dark mortar, not a gap into the void.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (tileAt(x, y) !== FLOOR || !visible(x + 0.5, y + 0.5, 3)) continue;
      a.fillStyle = rgb(46, 43, 41);
      a.fillRect(sx(x) - 0.5, sy(y) - 0.5, scale + 1, scale + 1);
    }
  }
  for (let by = 0; by < h; by += 2) {
    for (let bx = 0; bx < w; bx += 2) {
      if (!visible(bx + 1, by + 1, 3)) continue;
      const block = [tileAt(bx, by), tileAt(bx + 1, by), tileAt(bx, by + 1), tileAt(bx + 1, by + 1)];
      const hb = hash(bx, by, 29);
      if (block.every(isGround) && hb < 0.9) {
        // The game's bonds: one big slab, two long ones, or a long one and two small.
        const s = hash(bx, by, 31) * 1000;
        const flip = hash(bx, by, 37) > 0.5;
        const R = (x0: number, y0: number, x1: number, y1: number, q: number) =>
          flip ? slab(bx + y0, by + x0, bx + y1, by + x1, s + q) : slab(bx + x0, by + y0, bx + x1, by + y1, s + q);
        if (hb < 0.22) R(0, 0, 2, 2, 0);
        else if (hb < 0.47) {
          R(0, 0, 2, 1, 1);
          R(0, 1, 2, 2, 2);
        } else if (hb < 0.75) {
          R(0, 0, 2, 1, 3);
          R(0, 1, 1, 2, 4);
          R(1, 1, 2, 2, 5);
        } else {
          for (let q = 0; q < 4; q++) R(q & 1, q >> 1, (q & 1) + 1, (q >> 1) + 1, 6 + q);
        }
        continue;
      }
      for (let q = 0; q < 4; q++) {
        const x = bx + (q & 1);
        const y = by + (q >> 1);
        const t = tileAt(x, y);
        if (t === FLOOR) {
          if (hb >= 0.9 && block.every(isGround)) {
            for (let c = 0; c < 4; c++) slab(x + (c & 1) * 0.5, y + (c >> 1) * 0.5, x + (c & 1) * 0.5 + 0.5, y + (c >> 1) * 0.5 + 0.5, hash(x, y, 40 + c) * 1000);
          } else slab(x, y, x + 1, y + 1, hash(x, y, 41) * 1000);
        } else if (t === WATER) {
          a.fillStyle = rgb(30, 58, 70);
          a.fillRect(sx(x), sy(y), scale + 1, scale + 1);
          a.strokeStyle = "rgba(160,220,255,0.10)";
          a.lineWidth = Math.max(1, scale * 0.015);
          for (let r = 0; r < 3; r++) {
            a.beginPath();
            const yy = y + 0.2 + r * 0.3 + hash(x, y, r) * 0.1;
            a.moveTo(sx(x + 0.1), sy(yy));
            a.quadraticCurveTo(sx(x + 0.5), sy(yy - 0.06), sx(x + 0.9), sy(yy));
            a.stroke();
          }
        }
      }
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = tileAt(x, y);
      if (!visible(x + 0.5, y + 0.5, 2)) continue;
      if (rubble[y * w + x]) {
        for (let q = 0; q < 7; q++) {
          const px = x + 0.15 + hash(x, y, 50 + q) * 0.7;
          const py = y + 0.15 + hash(x, y, 60 + q) * 0.7;
          const r = (0.04 + hash(x, y, 70 + q) * 0.05) * scale;
          a.fillStyle = rgb(96, 92, 88, 0.9 + hash(x, y, 80 + q) * 0.3);
          a.beginPath();
          a.ellipse(sx(px), sy(py), r, r * 0.8, hash(x, y, q) * 3, 0, Math.PI * 2);
          a.fill();
        }
      }
      // Moss creeps out from the walls.
      if (t === FLOOR && hash(x >> 1, y >> 1, 90) < 0.45) {
        const near = [tileAt(x - 1, y), tileAt(x + 1, y), tileAt(x, y - 1), tileAt(x, y + 1)].filter((n) => n === WALL).length;
        if (near > 0 || hash(x, y, 91) < 0.25) {
          const gr = a.createRadialGradient(sx(x + 0.5), sy(y + 0.5), 0, sx(x + 0.5), sy(y + 0.5), scale * 0.8);
          gr.addColorStop(0, "rgba(40,78,38,0.55)");
          gr.addColorStop(1, "rgba(40,78,38,0)");
          a.fillStyle = gr;
          a.fillRect(sx(x - 0.3), sy(y - 0.3), scale * 1.6, scale * 1.6);
        }
      }
    }
  }

  // Chasms: the far walls of each pit fall away into the dark.
  const faces = (x: number, y: number) => [
    { nx: -1, ny: 0, x0: x, y0: y + 1, x1: x, y1: y, ox: -1, oy: 0 },
    { nx: 1, ny: 0, x0: x + 1, y0: y, x1: x + 1, y1: y + 1, ox: 1, oy: 0 },
    { nx: 0, ny: -1, x0: x, y0: y, x1: x + 1, y1: y, ox: 0, oy: -1 },
    { nx: 0, ny: 1, x0: x + 1, y0: y + 1, x1: x, y1: y + 1, ox: 0, oy: 1 },
  ];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (tileAt(x, y) !== PIT || !visible(x + 0.5, y + 0.5, 2)) continue;
      a.fillStyle = "#000";
      a.fillRect(sx(x) - 0.5, sy(y) - 0.5, scale + 1, scale + 1);
      for (const f of faces(x, y)) {
        const nb = tileAt(x + f.ox, y + f.oy);
        if (nb === PIT) continue;
        // The face belongs to the neighbour; seen from inside the pit, it faces back towards us.
        const mx = (f.x0 + f.x1) / 2;
        const my = (f.y0 + f.y1) / 2;
        if (-f.nx * (camX - mx) - f.ny * (camY - my) <= 0) continue;
        const z = -PIT_D;
        const grd = a.createLinearGradient(sx(mx), sy(my), sx(mx, z), sy(my, z));
        grd.addColorStop(0, "rgb(96,84,74)");
        grd.addColorStop(0.35, "rgb(40,34,30)");
        grd.addColorStop(1, "rgb(0,0,0)");
        a.fillStyle = grd;
        poly(a, [sx(f.x0), sy(f.y0), sx(f.x1), sy(f.y1), sx(f.x1, z), sy(f.y1, z), sx(f.x0, z), sy(f.y0, z)]);
        a.fill();
        a.strokeStyle = "rgba(0,0,0,0.35)";
        a.lineWidth = Math.max(1, scale * 0.02);
        for (let q = 1; q < 4; q++) {
          const zz = (-PIT_D * q) / 7;
          a.beginPath();
          a.moveTo(sx(f.x0, zz), sy(f.y0, zz));
          a.lineTo(sx(f.x1, zz), sy(f.y1, zz));
          a.stroke();
        }
        e.strokeStyle = "rgba(255,255,255,0.9)";
        e.lineWidth = Math.max(1, scale * 0.035);
        e.beginPath();
        e.moveTo(sx(f.x0), sy(f.y0));
        e.lineTo(sx(f.x1), sy(f.y1));
        e.stroke();
      }
    }
  }

  // Walls, farthest first, so nearer ones rise over them: faces, then capstones.
  const walls: { x: number; y: number; d: number }[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (tileAt(x, y) === WALL && visible(x + 0.5, y + 0.5, 3)) walls.push({ x, y, d: Math.hypot(x + 0.5 - camX, y + 0.5 - camY) });
  walls.sort((p, q) => q.d - p.d);
  const z = WALL_H;
  for (const { x, y } of walls) {
    for (const f of faces(x, y)) {
      if (tileAt(x + f.ox, y + f.oy) === WALL) continue;
      const mx = (f.x0 + f.x1) / 2;
      const my = (f.y0 + f.y1) / 2;
      if (f.nx * (camX - mx) + f.ny * (camY - my) <= 0) continue;
      const grd = a.createLinearGradient(sx(mx), sy(my), sx(mx, z), sy(my, z));
      grd.addColorStop(0, "rgb(52,50,54)");
      grd.addColorStop(1, "rgb(104,100,104)");
      a.fillStyle = grd;
      poly(a, [sx(f.x0), sy(f.y0), sx(f.x1), sy(f.y1), sx(f.x1, z), sy(f.y1, z), sx(f.x0, z), sy(f.y0, z)]);
      a.fill();
      // Brick courses, each with its joints staggered.
      a.strokeStyle = "rgba(8,8,10,0.55)";
      a.lineWidth = Math.max(1, scale * 0.018);
      for (let c = 1; c < 4; c++) {
        const zz = (z * c) / 4;
        a.beginPath();
        a.moveTo(sx(f.x0, zz), sy(f.y0, zz));
        a.lineTo(sx(f.x1, zz), sy(f.y1, zz));
        a.stroke();
      }
      for (let c = 0; c < 4; c++) {
        const off = (c % 2) * 0.31 + hash(x, y, c) * 0.1;
        for (let u = off; u < 1; u += 0.62) {
          const ex = f.x0 + (f.x1 - f.x0) * u;
          const ey = f.y0 + (f.y1 - f.y0) * u;
          a.beginPath();
          a.moveTo(sx(ex, (z * c) / 4), sy(ey, (z * c) / 4));
          a.lineTo(sx(ex, (z * (c + 1)) / 4), sy(ey, (z * (c + 1)) / 4));
          a.stroke();
        }
      }
      e.strokeStyle = "rgba(255,255,255,0.8)";
      e.lineWidth = Math.max(1, scale * 0.03);
      e.beginPath();
      e.moveTo(sx(f.x0), sy(f.y0));
      e.lineTo(sx(f.x1), sy(f.y1));
      e.stroke();
    }
    const tone = 0.85 + hash(x, y, 7) * 0.3;
    a.fillStyle = rgb(72, 72, 78, tone);
    poly(a, [sx(x, z), sy(y, z), sx(x + 1, z), sy(y, z), sx(x + 1, z), sy(y + 1, z), sx(x, z), sy(y + 1, z)]);
    a.fill();
    // Capstones: a joint across the middle, staggered row by row.
    a.strokeStyle = "rgba(6,6,8,0.6)";
    a.lineWidth = Math.max(1, scale * 0.02);
    a.beginPath();
    const jx = x + (y % 2 ? 0.5 : 0.0) + 0.001;
    a.moveTo(sx(jx, z), sy(y, z));
    a.lineTo(sx(jx, z), sy(y + 1, z));
    a.stroke();
    for (const f of faces(x, y)) {
      if (tileAt(x + f.ox, y + f.oy) === WALL) continue;
      a.strokeStyle = "rgba(210,210,220,0.35)";
      a.lineWidth = Math.max(1, scale * 0.04);
      a.beginPath();
      a.moveTo(sx(f.x0, z), sy(f.y0, z));
      a.lineTo(sx(f.x1, z), sy(f.y1, z));
      a.stroke();
      e.strokeStyle = "rgba(255,255,255,1)";
      e.lineWidth = Math.max(1, scale * 0.04);
      e.beginPath();
      e.moveTo(sx(f.x0, z), sy(f.y0, z));
      e.lineTo(sx(f.x1, z), sy(f.y1, z));
      e.stroke();
    }
  }

  // Stone grain: a soft value-noise mottle multiplied over everything.
  const noise = makeCanvas(128, 128);
  const nc = noise.getContext("2d") as Ctx2D;
  const img = nc.createImageData(128, 128);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const v = 0.4 * hash(x >> 3, y >> 3, 101) + 0.35 * hash(x >> 1, y >> 1, 103) + 0.25 * hash(x, y, 107);
      const c = 178 + v * 77;
      const q = (y * 128 + x) * 4;
      img.data[q] = c;
      img.data[q + 1] = c;
      img.data[q + 2] = c;
      img.data[q + 3] = 255;
    }
  }
  nc.putImageData(img, 0, 0);
  a.globalCompositeOperation = "multiply";
  const pattern = a.createPattern(noise as CanvasImageSource, "repeat");
  if (pattern) {
    a.fillStyle = pattern;
    a.fillRect(0, 0, W, H);
  }
  a.globalCompositeOperation = "source-over";

  // Vignette and film grain, drawn over every frame.
  const vignette = makeCanvas(W, H);
  const vc = vignette.getContext("2d") as Ctx2D;
  const vg = vc.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) * 0.62);
  vg.addColorStop(0, "rgba(2,3,10,0)");
  vg.addColorStop(1, "rgba(2,3,10,0.88)");
  vc.fillStyle = vg;
  vc.fillRect(0, 0, W, H);
  const grainTile = makeCanvas(160, 160);
  const gc = grainTile.getContext("2d") as Ctx2D;
  const gimg = gc.createImageData(160, 160);
  for (let q = 0; q < 160 * 160; q++) {
    const v = hash(q, 7, 211) * 255;
    gimg.data[q * 4] = v;
    gimg.data[q * 4 + 1] = v;
    gimg.data[q * 4 + 2] = v;
    gimg.data[q * 4 + 3] = 255;
  }
  gc.putImageData(gimg, 0, 0);

  const canvas = (cw: number, ch: number): LoaderCanvas => makeCanvas(Math.max(1, Math.round(cw)), Math.max(1, Math.round(ch)));
  return {
    w,
    h,
    sub: SUB,
    solid,
    width: W,
    height: H,
    scale,
    camX,
    camY,
    cameraHeight: CAM_H,
    lw,
    lh,
    surface,
    fog,
    grain,
    fields,
    src,
    player,
    crystals,
    mushrooms,
    drips,
    wardens,
    gate,
    albedo,
    edges,
    vignette,
    grainTile,
    lightCanvas: canvas(lw, lh),
    frontCanvas: canvas(lw, lh),
    memCanvas: canvas(lw, lh),
    scratch: canvas(W, H),
    bloomA: canvas(W / 4, H / 4),
    bloomB: canvas(W / 12, H / 12),
    light: new Float32Array(N * 3),
    front: new Float32Array(N * 3),
    memory: new Float32Array(N),
    lutLit: new Float32Array(4096),
    lutRing: new Float32Array(4096),
    lutSustain: new Float32Array(4096),
    images: [],
  };
}
