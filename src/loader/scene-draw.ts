import type { Ctx2D, LoaderFrame, LoaderWorld, RGB } from "./types";

/**
 * Draws one frame of the loading scene: every sound in flight lights the stone
 * the way the game's sonar does — a bright front, a flash as it passes, a glow
 * that dissolves into grain, and a faint memory of the edges it touched — then
 * the creatures and crystals are drawn over it, lit by the same light.
 *
 * Self-contained, like buildLoaderWorld: it runs inside a Worker from its source text.
 */
export function drawLoaderFrame(ctx: Ctx2D, world: LoaderWorld, frame: LoaderFrame): void {
  const { lw, lh, width: W, height: H, scale, camX, camY } = world;
  const N = lw * lh;
  const light = world.light;
  const front = world.front;
  const mem = world.memory;
  light.fill(0);
  front.fill(0);
  const TAU = Math.PI * 2;
  const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
  const toLx = (x: number) => ((W / 2 + (x - camX) * scale) / W) * lw;
  const toLy = (y: number) => ((H / 2 + (y - camY) * scale) / H) * lh;

  // --------------------------------------------------------------- light
  // Everything a wave does to a point depends only on how far behind its front
  // the point lies, so each wave's shape is tabulated once per frame.
  const STEP = 0.02;
  const lutLit = world.lutLit;
  const lutRing = world.lutRing;
  const lutSustain = world.lutSustain;
  for (const wave of frame.waves) {
    const f = world.fields[wave.field];
    if (!f) continue;
    const age = frame.t - wave.t0;
    if (age <= 0 || age > wave.radius / wave.speed + wave.fade + 0.5) continue;
    const r = age * wave.speed;
    const R = wave.radius;
    const reach = (Math.min(r, R) + 1) * scale * 1.15;
    const cx = toLx(f.x);
    const cy = toLy(f.y);
    const rx = (reach / W) * lw;
    const ry = (reach / H) * lh;
    const x0 = Math.max(0, Math.floor(cx - rx));
    const x1 = Math.min(lw - 1, Math.ceil(cx + rx));
    const y0 = Math.max(0, Math.floor(cy - ry));
    const y1 = Math.min(lh - 1, Math.ceil(cy + ry));
    const cr = wave.color[0] * (wave.glow ?? 1);
    const cg = wave.color[1] * (wave.glow ?? 1);
    const cb = wave.color[2] * (wave.glow ?? 1);
    const invR = 1 / R;
    // Bins from 0.4 tiles ahead of the front to as far behind it as any of it still shows.
    const bins = Math.min(lutLit.length, Math.ceil((Math.min(r, wave.speed * wave.fade + 3) + 0.4) / STEP) + 1);
    for (let b = 0; b < bins; b++) {
      const delta = b * STEP - 0.4;
      lutRing[b] = Math.exp(-delta * delta * 30);
      if (delta <= 0) {
        lutLit[b] = 0;
        lutSustain[b] = 0;
        continue;
      }
      const tau = delta / wave.speed;
      const s = 1 - tau / wave.fade;
      lutSustain[b] = s > 0 ? Math.pow(s, 1.6) * (0.5 + 0.5 * Math.exp(-tau * 2.2)) : 0;
      lutLit[b] = Math.exp(-delta * 2.2) * 0.9;
    }
    const grain = world.grain;
    const fog = world.fog;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const o = y * lw + x;
        const d = f.dist[o]!;
        if (d > r + 0.4 || d >= R) continue;
        const e = f.energy[o]!;
        if (e <= 0.003) continue;
        const u = d * invR;
        const k = 1 - u * u;
        const fall = k * k * wave.strength * e * fog[o]!;
        const b = ((r - d + 0.4) / STEP) | 0;
        if (b >= bins) continue;
        const sustain = lutSustain[b]!;
        // At the very end the glow breaks up into grain instead of dimming evenly.
        let keep = (sustain - grain[o]! * 0.5 + 0.14) * 4;
        keep = keep < 0 ? 0 : keep > 1 ? 1 : keep;
        const lit = (sustain * keep * 0.62 + lutLit[b]!) * fall;
        const ring = lutRing[b]! * fall;
        const q = o * 3;
        light[q] += cr * lit;
        light[q + 1] += cg * lit;
        light[q + 2] += cb * lit;
        front[q] += cr * ring;
        front[q + 1] += cg * ring;
        front[q + 2] += cb * ring;
      }
    }
  }

  // Light, front and memory into their small canvases.
  const decay = Math.exp(-frame.dt / 5.5);
  const images = world.images;
  const put = (canvas: typeof world.lightCanvas, slot: number, fill: (data: Uint8ClampedArray) => void) => {
    const c = canvas.getContext("2d") as Ctx2D;
    const img = (images[slot] ??= c.createImageData(lw, lh));
    fill(img.data);
    c.putImageData(img, 0, 0);
  };
  put(world.lightCanvas, 0, (data) => {
    for (let o = 0; o < N; o++) {
      const q = o * 3;
      const p = o * 4;
      const lr = light[q]!;
      const lg = light[q + 1]!;
      const lb = light[q + 2]!;
      data[p] = lr * 215;
      data[p + 1] = lg * 215;
      data[p + 2] = lb * 215;
      data[p + 3] = 255;
      const luma = lr * 0.3 + lg * 0.55 + lb * 0.15;
      mem[o] = Math.max(mem[o]! * decay, Math.min(1, luma * 1.4));
    }
  });
  put(world.frontCanvas, 1, (data) => {
    for (let o = 0; o < N; o++) {
      const q = o * 3;
      const p = o * 4;
      const fr = front[q]!;
      const fg = front[q + 1]!;
      const fb = front[q + 2]!;
      const m = Math.max(fr, fg, fb);
      // Colour at full strength, and how much of it there is in alpha: the front is also a mask.
      const inv = m > 1e-4 ? 255 / m : 0;
      data[p] = fr * inv;
      data[p + 1] = fg * inv;
      data[p + 2] = fb * inv;
      data[p + 3] = Math.min(255, m * 190);
    }
  });
  put(world.memCanvas, 2, (data) => {
    for (let o = 0; o < N; o++) {
      const p = o * 4;
      const m = mem[o]! * mem[o]! * 255;
      data[p] = m;
      data[p + 1] = m;
      data[p + 2] = m;
      data[p + 3] = 255;
    }
  });

  // ------------------------------------------------------------ composite
  const s = world.scratch.getContext("2d") as Ctx2D;
  s.imageSmoothingEnabled = true;
  ctx.imageSmoothingEnabled = true;
  s.globalAlpha = 1;
  s.globalCompositeOperation = "copy";
  s.drawImage(world.albedo as CanvasImageSource, 0, 0);
  s.globalCompositeOperation = "multiply";
  s.drawImage(world.lightCanvas as CanvasImageSource, 0, 0, W, H);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "copy";
  ctx.drawImage(world.scratch as CanvasImageSource, 0, 0);
  // Memory: a cold sketch of the edges the sound has touched, lingering after the light.
  s.globalCompositeOperation = "copy";
  s.drawImage(world.edges as CanvasImageSource, 0, 0);
  s.globalCompositeOperation = "multiply";
  s.drawImage(world.memCanvas as CanvasImageSource, 0, 0, W, H);
  s.fillStyle = "rgb(77,133,199)";
  s.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.2;
  ctx.drawImage(world.scratch as CanvasImageSource, 0, 0);
  // The fronts: a soft band from the light buffer, and over it a crisp line — drawn as
  // circles, then masked by the band, so it follows the sound round corners and stops at walls.
  ctx.globalAlpha = 0.75;
  ctx.drawImage(world.frontCanvas as CanvasImageSource, 0, 0, W, H);
  ctx.globalAlpha = 1;
  s.globalCompositeOperation = "copy";
  s.fillStyle = "rgba(0,0,0,0)";
  s.fillRect(0, 0, W, H);
  s.globalCompositeOperation = "source-over";
  s.lineWidth = Math.max(1.5, scale * 0.045);
  for (const wave of frame.waves) {
    const f = world.fields[wave.field];
    const r = (frame.t - wave.t0) * wave.speed;
    if (!f || r <= 0.05 || r >= wave.radius) continue;
    const u = r / wave.radius;
    const a = clamp((1 - u * u) * (1 - u * u) * wave.strength * (wave.glow ?? 1), 0, 1);
    s.strokeStyle = `rgba(${Math.round(Math.min(255, wave.color[0] * 255 + 90))},${Math.round(Math.min(255, wave.color[1] * 255 + 90))},${Math.round(Math.min(255, wave.color[2] * 255 + 90))},${a})`;
    s.beginPath();
    s.arc(W / 2 + (f.x - camX) * scale, H / 2 + (f.y - camY) * scale, r * scale, 0, TAU);
    s.stroke();
  }
  s.globalCompositeOperation = "destination-in";
  s.drawImage(world.frontCanvas as CanvasImageSource, 0, 0, W, H);
  ctx.drawImage(world.scratch as CanvasImageSource, 0, 0);

  // ---------------------------------------------------------------- props
  const px = (x: number) => W / 2 + (x - camX) * scale;
  const py = (y: number) => H / 2 + (y - camY) * scale;
  const lightAt = (x: number, y: number): RGB => {
    const i = clamp(Math.floor(toLx(x)), 0, lw - 1);
    const j = clamp(Math.floor(toLy(y)), 0, lh - 1);
    const q = (j * lw + i) * 3;
    return [light[q]!, light[q + 1]!, light[q + 2]!];
  };
  const lum = (c: RGB) => c[0] * 0.3 + c[1] * 0.55 + c[2] * 0.15;
  const col = (r: number, g: number, b: number, m: number, a = 1) =>
    `rgba(${Math.round(clamp(r * m, 0, 255))},${Math.round(clamp(g * m, 0, 255))},${Math.round(clamp(b * m, 0, 255))},${a})`;
  const glowDot = (x: number, y: number, radius: number, c: RGB, a: number) => {
    if (a <= 0.004 || radius <= 0.5) return;
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, col(c[0] * 255, c[1] * 255, c[2] * 255, 1, a));
    g.addColorStop(0.35, col(c[0] * 255, c[1] * 255, c[2] * 255, 1, a * 0.35));
    g.addColorStop(1, col(c[0] * 255, c[1] * 255, c[2] * 255, 1, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  };
  const ellipse = (x: number, y: number, rx: number, ry: number, rot = 0) => {
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, TAU);
  };
  const VIOLET: RGB = [0.74, 0.42, 1.0];
  const CYAN: RGB = [0.35, 0.95, 1.0];

  // Glow-caps: always faintly alight, brighter when a sound passes.
  world.mushrooms.forEach((m, i) => {
    const g = frame.mushrooms[i] ?? 0;
    const pulse = 0.55 + 0.25 * Math.sin(frame.t * 1.7 + m.seed * 20);
    ctx.globalCompositeOperation = "lighter";
    for (let c = 0; c < 4; c++) {
      const a = m.seed * 40 + c * 1.9;
      const d = (0.08 + 0.1 * ((m.seed * (c + 3) * 7.3) % 1)) * scale;
      const x = px(m.x) + Math.cos(a) * d;
      const y = py(m.y) + Math.sin(a) * d;
      const r = (0.05 + 0.03 * ((m.seed * (c + 1) * 13.1) % 1)) * scale;
      glowDot(x, y, r * 4, [0.35, 1.0, 0.75], 0.18 * pulse + g * 0.45);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = col(120, 230, 200, 0.45 * pulse + g * 0.7);
      ellipse(x, y, r, r * 0.9);
      ctx.fill();
      ctx.globalCompositeOperation = "lighter";
    }
    ctx.globalCompositeOperation = "source-over";
  });

  // The pool under each drip.
  for (const d of world.drips) {
    const l = lum(lightAt(d.x, d.y));
    ctx.fillStyle = col(40, 70, 90, 0.4 + l * 1.4, 0.8);
    ellipse(px(d.x), py(d.y), scale * 0.3, scale * 0.22);
    ctx.fill();
  }

  // The Gate: a carved dais with a slow golden vortex.
  if (world.gate) {
    const gx = px(world.gate.x);
    const gy = py(world.gate.y);
    const l = lum(lightAt(world.gate.x, world.gate.y));
    ctx.strokeStyle = col(200, 160, 90, 0.25 + l * 1.5, 0.9);
    ctx.lineWidth = scale * 0.05;
    for (let r = 1; r <= 3; r++) {
      ellipse(gx, gy, scale * 0.16 * r, scale * 0.16 * r);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "lighter";
    for (let a = 0; a < 3; a++) {
      ctx.beginPath();
      for (let q = 0; q <= 24; q++) {
        const u = q / 24;
        const ang = frame.t * 0.8 + a * 2.09 + u * 4;
        const rr = scale * 0.45 * (1 - u);
        const x = gx + Math.cos(ang) * rr;
        const y = gy + Math.sin(ang) * rr;
        if (q === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = col(255, 205, 110, 1, 0.22 + l * 0.5);
      ctx.lineWidth = scale * 0.03;
      ctx.stroke();
    }
    glowDot(gx, gy, scale * 0.9, [1, 0.8, 0.42], 0.12 + l * 0.2);
    ctx.globalCompositeOperation = "source-over";
  }

  // Crystals: seven shards on a rocky base, violet — or their note's colour once tuned.
  world.crystals.forEach((c, i) => {
    const st = frame.crystals[i] ?? { glow: 0, shake: 0, tint: null };
    const tint = st.tint ?? VIOLET;
    const l = lum(lightAt(c.x, c.y));
    const shake = Math.sin(frame.t * 60) * st.shake * 0.03 * scale;
    const x0 = px(c.x) + shake;
    const y0 = py(c.y);
    const unit = scale * 0.62;
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ellipse(x0 + unit * 0.04, y0 + unit * 0.06, unit * 0.36, unit * 0.3);
    ctx.fill();
    ctx.fillStyle = col(60, 56, 62, 0.4 + l * 1.3);
    ellipse(x0, y0, unit * 0.2, unit * 0.18);
    ctx.fill();
    const lift = 0.3 + l * 1.4 + st.glow * 0.8;
    for (let k = 6; k >= 0; k--) {
      const hsh = (c.seed * 997 * (k + 1)) % 1;
      const ang = k * 2.39996 + hsh * 0.6;
      const len = (0.48 - (k / 6) * 0.24 + hsh * 0.06) * unit;
      const wid = (0.085 - (k / 6) * 0.035) * unit;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const P = (u: number, v: number) => [x0 + ca * u - sa * v, y0 + sa * u + ca * v] as const;
      const tip = P(len, 0);
      const s1 = P(len * 0.68, wid);
      const s2 = P(len * 0.68, -wid);
      const b1 = P(unit * 0.05, wid * 0.6);
      const b2 = P(unit * 0.05, -wid * 0.6);
      ctx.beginPath();
      ctx.moveTo(b1[0], b1[1]);
      ctx.lineTo(s1[0], s1[1]);
      ctx.lineTo(tip[0], tip[1]);
      ctx.lineTo(s2[0], s2[1]);
      ctx.lineTo(b2[0], b2[1]);
      ctx.closePath();
      const g = ctx.createLinearGradient(b1[0], b1[1], tip[0], tip[1]);
      g.addColorStop(0, col(tint[0] * 150, tint[1] * 150, tint[2] * 150, lift * 0.55));
      g.addColorStop(1, col(tint[0] * 255, tint[1] * 255, tint[2] * 255, Math.min(1.4, lift)));
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = col(tint[0] * 255, tint[1] * 255, tint[2] * 255, 1, clamp(0.25 + st.glow * 0.8 + l, 0, 1));
      ctx.lineWidth = Math.max(1, unit * 0.012);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "lighter";
    glowDot(x0, y0, unit * (0.9 + st.glow * 0.8), tint, 0.07 + st.glow * 0.5 + (st.tint ? 0.12 : 0));
    ctx.globalCompositeOperation = "source-over";
  });

  // A sleeping hunter: dark chitin, folded red membranes, sensory pits that smoulder.
  world.wardens.forEach((wd, i) => {
    const stir = frame.wardens[i]?.stir ?? 0;
    const l = lum(lightAt(wd.x, wd.y));
    const unit = scale * 1.25 * 1.1 * 0.5;
    ctx.save();
    ctx.translate(px(wd.x), py(wd.y));
    ctx.rotate(wd.heading + Math.sin(frame.t * 0.7) * 0.05 + stir * 0.2);
    const chitin = (m: number) => col(60, 56, 58, m);
    ctx.strokeStyle = chitin(0.35 + l * 1.6);
    ctx.lineWidth = unit * 0.05;
    ctx.lineCap = "round";
    for (const side of [-1, 1]) {
      for (const [hx, fx, fy] of [
        [0.1, 0.62, 0.5],
        [-0.02, 0.08, 0.74],
        [-0.14, -0.5, 0.6],
      ] as const) {
        ctx.beginPath();
        ctx.moveTo(hx * unit, side * 0.12 * unit);
        ctx.quadraticCurveTo(((hx + fx) / 2) * unit, side * (fy + 0.12) * unit, fx * unit, side * fy * unit);
        ctx.stroke();
      }
    }
    const flare = 0.25 + stir * 0.6;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0.2 * unit, side * 0.09 * unit);
      ctx.lineTo(-0.3 * unit, side * (0.2 + flare * 0.35) * unit);
      ctx.lineTo(-0.5 * unit, side * (0.08 + flare * 0.1) * unit);
      ctx.closePath();
      ctx.fillStyle = col(90, 12, 22, 0.4 + l * 1.4 + stir * 0.8, 0.9);
      ctx.fill();
    }
    ctx.fillStyle = chitin(0.4 + l * 1.5);
    ellipse(-0.42 * unit, 0, 0.34 * unit, 0.22 * unit);
    ctx.fill();
    ellipse(-0.04 * unit, 0, 0.2 * unit, 0.16 * unit);
    ctx.fill();
    ctx.fillStyle = col(120, 110, 100, 0.35 + l * 1.4);
    ellipse(0.26 * unit, 0, 0.16 * unit, 0.11 * unit);
    ctx.fill();
    ctx.globalCompositeOperation = "lighter";
    for (let q = 0; q < 6; q++) {
      const side = q & 1 ? 1 : -1;
      const row = q >> 1;
      glowDot((0.3 + row * 0.045) * unit, side * (0.05 - row * 0.012) * unit, unit * 0.09, [1, 0.12, 0.16], 0.25 + stir * 0.6);
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.restore();
  });

  drawCreature();

  // Dust hanging in the air, seen only where the sound lights it.
  ctx.globalCompositeOperation = "lighter";
  for (let q = 0; q < 140; q++) {
    const hx = ((q * 0.618034) % 1) * 24 - 12;
    const hy = ((q * 0.4142135) % 1) * 14 - 7;
    const x = camX + hx + Math.sin(frame.t * 0.13 + q) * 0.4;
    const y = camY + hy + Math.cos(frame.t * 0.11 + q * 1.7) * 0.3;
    const l = lightAt(x, y);
    const b = lum(l);
    if (b < 0.04) continue;
    ctx.fillStyle = col(l[0] * 255 + 60, l[1] * 255 + 60, l[2] * 255 + 60, 1, clamp(b * 0.9, 0, 0.8));
    ctx.fillRect(px(x), py(y), Math.max(1, scale * 0.025), Math.max(1, scale * 0.025));
  }

  // ---------------------------------------------------------------- glow
  const bw = (world.bloomA as { width: number }).width;
  const bh = (world.bloomA as { height: number }).height;
  const b1 = world.bloomA.getContext("2d") as Ctx2D;
  const b2 = world.bloomB.getContext("2d") as Ctx2D;
  const sw = (world.bloomB as { width: number }).width;
  const sh = (world.bloomB as { height: number }).height;
  b1.globalCompositeOperation = "copy";
  b1.drawImage(ctx.canvas as CanvasImageSource, 0, 0, bw, bh);
  b2.globalCompositeOperation = "copy";
  b2.drawImage(world.bloomA as CanvasImageSource, 0, 0, sw, sh);
  // Squaring keeps the bright parts and drops the rest: a cheap threshold.
  b2.globalCompositeOperation = "multiply";
  b2.drawImage(world.bloomA as CanvasImageSource, 0, 0, sw, sh);
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.9;
  ctx.drawImage(world.bloomB as CanvasImageSource, 0, 0, W, H);
  ctx.globalAlpha = 0.22;
  ctx.drawImage(world.bloomA as CanvasImageSource, 0, 0, W, H);
  if (frame.finale > 0) {
    ctx.globalAlpha = frame.finale * 0.35;
    ctx.fillStyle = "rgb(150,230,255)";
    ctx.fillRect(0, 0, W, H);
  }

  // Film grain, then the vignette.
  if (!frame.reduced || frame.t < 0.1) {
    const pattern = ctx.createPattern(world.grainTile as CanvasImageSource, "repeat");
    if (pattern) {
      ctx.globalCompositeOperation = "overlay";
      ctx.globalAlpha = 0.09;
      ctx.save();
      ctx.translate(Math.floor((frame.t * 977) % 160), Math.floor((frame.t * 613) % 160));
      ctx.fillStyle = pattern;
      ctx.fillRect(-160, -160, W + 320, H + 320);
      ctx.restore();
    }
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.drawImage(world.vignette as CanvasImageSource, 0, 0);

  /** Echo: moon fur, enormous listening ears, a glowing spine — the game's creature, in paths. */
  function drawCreature(): void {
    const p = world.player;
    const st = frame.creature;
    const l = lum(lightAt(p.x, p.y));
    const unit = scale * 1.22;
    const cx = px(p.x);
    const cy = py(p.y);
    const breath = 1 + 0.025 * Math.sin(frame.t * 2.3);
    const fur = 0.55 + clamp(l, 0, 1.2) * 0.9;
    const pulse = 0.75 + 0.25 * Math.sin(frame.t * 2.6) + st.charge * 0.8;

    // The charge ring, gathering before a call.
    if (st.charge > 0.01 || st.call > 0.01) {
      ctx.globalCompositeOperation = "lighter";
      const ringR = (0.42 + st.charge * 0.18) * scale;
      ctx.strokeStyle = col(80, 230, 255, 1, 0.55 * st.charge + st.call * 0.6);
      ctx.lineWidth = Math.max(1, scale * 0.02);
      ctx.beginPath();
      ctx.arc(cx, cy, ringR, -Math.PI / 2, -Math.PI / 2 + TAU * st.charge);
      ctx.stroke();
      ctx.setLineDash([scale * 0.03, scale * 0.05]);
      ctx.lineDashOffset = -frame.t * scale * 0.2;
      ctx.beginPath();
      ctx.arc(cx, cy, ringR + scale * 0.05, 0, TAU);
      ctx.strokeStyle = col(80, 230, 255, 1, 0.35 * st.charge);
      ctx.stroke();
      ctx.setLineDash([]);
      glowDot(cx, cy, scale * (0.8 + st.call * 1.4), CYAN, 0.08 + st.charge * 0.12 + st.call * 0.5);
      ctx.globalCompositeOperation = "source-over";
    }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(p.facing);
    ctx.scale(unit, unit);
    const lwUnit = 1 / unit;
    // Contact shadow.
    const sg = ctx.createRadialGradient(-0.06, 0.035, 0, -0.06, 0.035, 0.36);
    sg.addColorStop(0, "rgba(0,0,0,0.55)");
    sg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = sg;
    ctx.fillRect(-0.45, -0.35, 0.8, 0.7);
    // Tail, swaying.
    const sway = Math.sin(frame.t * 1.7) * 0.35;
    const tail = (t: number) => [-0.21 - 0.3 * t, Math.sin(t * 2.4 + 0.4) * sway * 0.17 * t + sway * 0.025] as const;
    ctx.lineCap = "round";
    for (let q = 0; q < 10; q++) {
      const a = tail(q / 10);
      const b = tail((q + 1) / 10);
      const t = (q + 0.5) / 10;
      const r = (0.04 + (0.085 - 0.04) * Math.min(1, t / 0.65)) * (1 - Math.max(0, (t - 0.72) / 0.28) * 0.8);
      ctx.strokeStyle = t > 0.6 ? col(204, 199, 230, fur) : col(92, 87, 128, fur);
      ctx.lineWidth = r * 2;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
    // Paws.
    ctx.fillStyle = col(158, 148, 178, fur);
    for (const [x, y] of [
      [0.1, -0.13],
      [0.1, 0.13],
      [-0.16, -0.135],
      [-0.16, 0.135],
    ] as const) {
      ellipse(x, y, 0.052, 0.04);
      ctx.fill();
    }
    // Body with a darker saddle.
    ellipse(-0.035, 0, 0.2 * breath, 0.17 * breath);
    const bg = ctx.createLinearGradient(0, -0.17, 0, 0.17);
    bg.addColorStop(0, col(204, 199, 230, fur));
    bg.addColorStop(0.5, col(120, 114, 158, fur));
    bg.addColorStop(1, col(204, 199, 230, fur));
    ctx.fillStyle = bg;
    ctx.fill();
    // Ears over the shoulders: fur outside, pink inside, veins that glow while it gathers a call.
    for (const side of [-1, 1]) {
      const swivel = side < 0 ? st.earL : st.earR;
      const ang = side * (2.25 - st.charge * 0.4) + swivel;
      ctx.save();
      ctx.translate(0.13, side * 0.1);
      ctx.rotate(ang);
      const leaf = (len: number, wid: number) => {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(len * 0.25, wid * 1.25, len * 0.75, wid * 0.95, len, 0);
        ctx.bezierCurveTo(len * 0.75, -wid * 0.95, len * 0.25, -wid * 1.25, 0, 0);
        ctx.closePath();
      };
      leaf(0.29, 0.105);
      ctx.fillStyle = col(204, 199, 230, fur);
      ctx.fill();
      ctx.translate(0.03, 0);
      leaf(0.225, 0.066);
      ctx.fillStyle = col(242, 143, 179, fur * 0.9);
      ctx.fill();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = col(90, 240, 255, 1, clamp((0.18 + st.charge * 1.6) * pulse * 0.45, 0, 1));
      ctx.lineWidth = 0.009;
      for (const bend of [0, 0.03, -0.03]) {
        ctx.beginPath();
        ctx.moveTo(0.02, 0);
        ctx.quadraticCurveTo(0.12, bend * 1.5, 0.2, bend * 2.2);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.restore();
    }
    // Head, muzzle, eyes and nose.
    ellipse(0.175, 0, 0.15, 0.142);
    ctx.fillStyle = col(212, 208, 236, fur);
    ctx.fill();
    ellipse(0.285, 0, 0.075, 0.058);
    ctx.fillStyle = col(236, 234, 248, fur);
    ctx.fill();
    for (const side of [-1, 1]) {
      ellipse(0.225, side * 0.066, 0.033, 0.03 * Math.max(0.12, 1 - st.blink));
      ctx.fillStyle = "rgb(4,5,9)";
      ctx.fill();
      if (st.blink < 0.6) {
        ctx.fillStyle = "rgba(150,245,255,0.95)";
        ellipse(0.237, side * 0.066 - 0.011, 0.008, 0.008);
        ctx.fill();
      }
    }
    ellipse(0.352, 0, 0.017, 0.024);
    ctx.fillStyle = col(51, 20, 31, 1);
    ctx.fill();
    // The glowing spine, and a soft rim so the silhouette always reads in the dark.
    ctx.globalCompositeOperation = "lighter";
    for (let q = 0; q < 3; q++) {
      const a = (0.35 + 0.1 * Math.sin(frame.t * 4 - q * 1.2)) * pulse;
      const g = ctx.createRadialGradient(0.03 - q * 0.075, 0, 0, 0.03 - q * 0.075, 0, 0.07);
      g.addColorStop(0, `rgba(90,240,255,${clamp(a, 0, 1)})`);
      g.addColorStop(0.3, `rgba(90,240,255,${clamp(a * 0.45, 0, 1)})`);
      g.addColorStop(1, "rgba(90,240,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(-0.3, -0.1, 0.45, 0.2);
    }
    ctx.strokeStyle = `rgba(90,240,255,${0.16 + st.charge * 0.2})`;
    ctx.lineWidth = lwUnit * Math.max(1, scale * 0.012);
    ellipse(-0.035, 0, 0.205 * breath, 0.175 * breath);
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
    ctx.restore();
  }
}
