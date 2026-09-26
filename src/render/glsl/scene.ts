import { HEADER, NOISE, SDF } from "./common";
import { SONAR } from "./sonar";
import { INSTRUMENT } from "./instrument";

export const FULLSCREEN_VS = /* glsl */ `#version 300 es
out vec2 vNdc;
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  vNdc = p * 2.0 - 1.0;
  gl_Position = vec4(vNdc, 0.0, 1.0);
}
`;

/**
 * Floor, walls, doors, water and pits. Each pixel casts a ray from the overhead
 * camera through a height field of tiles, so walls rise with perspective and
 * chasms fall away into darkness.
 */
export const SCENE_FS = /* glsl */ `${HEADER}
${NOISE}
${SDF}
${SONAR}

uniform sampler2D uTiles;
uniform sampler2D uWallDist;
uniform sampler2D uMemory;

in vec2 vNdc;
out vec4 outColor;

const vec3 VOID_COL = vec3(0.0012, 0.0016, 0.003);
const vec3 MEMORY_COL = vec3(0.30, 0.52, 0.78);

struct Tile { int type; float variant; float open; float aux; int decor; };

Tile tileAt(ivec2 t) {
  Tile ti;
  if (t.x < 0 || t.y < 0 || t.x >= int(MAP_SIZE.x) || t.y >= int(MAP_SIZE.y)) {
    ti.type = 1; ti.variant = 0.5; ti.open = 0.0; ti.aux = 0.0; ti.decor = 0;
    return ti;
  }
  vec4 v = texelFetch(uTiles, t, 0);
  ti.type = int(v.r * 255.0 + 0.5);
  ti.variant = v.g;
  ti.open = v.b;
  ti.aux = v.a;
  ti.decor = int(v.a * 255.0 + 0.5);
  return ti;
}

/** Panes of singing glass stand a little lower than the walls around them. */
const float GLASS_H = WALL_H * 0.88;

float heightOf(Tile ti) {
  if (ti.type == 1) return WALL_H;
  if (ti.type == 2) return -PIT_D;
  if (ti.type == 4) return WALL_H * (1.0 - ti.open);
  if (ti.type == 7) return GLASS_H;
  return 0.0;
}

float heightAt(ivec2 t) { return heightOf(tileAt(t)); }

/** A draft tile's wind direction (the tile texture's B channel holds its index + 1). */
vec2 windOf(Tile ti) {
  int k = int(ti.open * 255.0 + 0.5);
  return k == 1 ? vec2(1.0, 0.0) : k == 2 ? vec2(-1.0, 0.0) : k == 3 ? vec2(0.0, 1.0) : vec2(0.0, -1.0);
}

struct Hit { vec3 pos; vec3 n; ivec2 tile; int face; Tile ti; };

// face: 0 = top surface, 1 = vertical face, 2 = abyss
Hit raycast(vec2 F) {
  Hit h;
  vec2 C = uCam.xy;
  vec2 D = F - C;
  float zTop = WALL_H;
  float zBot = -PIT_D;
  vec2 A = C + D * (1.0 - zTop / CAM_H);
  vec2 B = C + D * (1.0 - zBot / CAM_H);
  vec2 dir = B - A;
  ivec2 t = ivec2(floor(A));
  ivec2 stp = ivec2(dir.x > 0.0 ? 1 : -1, dir.y > 0.0 ? 1 : -1);
  vec2 adir = abs(dir);
  vec2 tDelta = vec2(adir.x > 1e-7 ? 1.0 / adir.x : 1e9, adir.y > 1e-7 ? 1.0 / adir.y : 1e9);
  vec2 fr = A - vec2(t);
  vec2 tMax = vec2(
    adir.x > 1e-7 ? (dir.x > 0.0 ? 1.0 - fr.x : fr.x) * tDelta.x : 1e9,
    adir.y > 1e-7 ? (dir.y > 0.0 ? 1.0 - fr.y : fr.y) * tDelta.y : 1e9
  );
  float sEnter = 0.0;
  int axis = -1;
  for (int i = 0; i < 24 + LOOP_ZERO; i++) {
    Tile ti = tileAt(t);
    float ht = heightOf(ti);
    float sExit = min(min(tMax.x, tMax.y), 1.0);
    float zEnter = mix(zTop, zBot, sEnter);
    float zExit = mix(zTop, zBot, sExit);
    if (ht >= zEnter - 1e-4) {
      h.tile = t;
      h.ti = ti;
      if (axis < 0) {
        h.pos = vec3(A, zTop);
        h.n = vec3(0.0, 0.0, 1.0);
        h.face = 0;
      } else {
        h.pos = vec3(A + dir * sEnter, zEnter);
        h.n = axis == 0 ? vec3(-float(stp.x), 0.0, 0.0) : vec3(0.0, -float(stp.y), 0.0);
        h.face = 1;
      }
      return h;
    }
    if (ht >= zExit) {
      float s = (ht - zTop) / (zBot - zTop);
      h.pos = vec3(A + dir * s, ht);
      h.n = vec3(0.0, 0.0, 1.0);
      h.face = ti.type == 2 ? 2 : 0;
      h.tile = t;
      h.ti = ti;
      return h;
    }
    if (sExit >= 1.0) break;
    if (tMax.x < tMax.y) { sEnter = tMax.x; tMax.x += tDelta.x; t.x += stp.x; axis = 0; }
    else { sEnter = tMax.y; tMax.y += tDelta.y; t.y += stp.y; axis = 1; }
  }
  h.pos = vec3(B, zBot);
  h.n = vec3(0.0, 0.0, 1.0);
  h.face = 2;
  h.tile = t;
  h.ti = tileAt(t);
  return h;
}

struct Mat { vec3 albedo; vec3 n; float spec; float gloss; vec3 emissive; float ao; float edge; };

// ---------------------------------------------------------------- floor ---

/**
 * Flagstones laid over 2x2 tile blocks in one of several bonds so slabs vary in
 * size and the tile grid stays readable without looking like bathroom tiles.
 * x: distance to the slab border, y: slab id, z: slab size factor.
 */
vec3 slabLayout(vec2 p) {
  ivec2 blk = ivec2(floor(p * 0.5));
  vec2 f = p - vec2(blk) * 2.0;
  float h = hash1(blk + ivec2(17, 3));
  float flip = hash1(blk + ivec2(5, 11));
  if (flip > 0.5) f = f.yx;
  vec2 lo = vec2(0.0);
  vec2 hi = vec2(2.0);
  if (h < 0.22) {
  } else if (h < 0.47) {
    if (f.y < 1.0) hi.y = 1.0; else lo.y = 1.0;
  } else if (h < 0.75) {
    if (f.y < 1.0) { hi.y = 1.0; }
    else { lo.y = 1.0; if (f.x < 1.0) hi.x = 1.0; else lo.x = 1.0; }
  } else if (h < 0.9) {
    if (f.x < 1.0) hi.x = 1.0; else lo.x = 1.0;
    if (f.y < 1.0) hi.y = 1.0; else lo.y = 1.0;
  } else {
    // Cobbles: a 2x2 slab split into small setts.
    vec2 c = floor(f * 2.0);
    lo = c * 0.5;
    hi = lo + 0.5;
  }
  vec2 a = f - lo;
  vec2 b = hi - f;
  float e = min(min(a.x, a.y), min(b.x, b.y));
  if (flip > 0.5) { lo = lo.yx; }
  float id = hash1(blk * 8 + ivec2(lo * 4.0) + ivec2(3, 7));
  return vec3(e, id, (hi.x - lo.x) * (hi.y - lo.y));
}

float groutWidth(vec2 p) { return 0.012 + 0.014 * vnoise(p * 5.0 + 3.0) + 0.006 * vnoise(p * 19.0); }

/** Slab edge distance with chipped, irregular borders. */
float chippedEdge(vec2 p, float e) {
  return e + (vnoise(p * 17.0) - 0.5) * 0.022 + (vnoise(p * 4.3 + 11.0) - 0.5) * 0.016;
}

float floorH(vec2 p, Tile ti, out vec3 sl, out float crack) {
  sl = slabLayout(p);
  float e = chippedEdge(p, sl.x) - groutWidth(p);
  float bevel = smoothstep(0.0, 0.075, e);
  float lift = (hash1(ivec2(int(sl.y * 65536.0), 3)) - 0.5) * 0.028;
  float h = bevel * (0.036 + lift);
  vec2 tilt = hash2(ivec2(int(sl.y * 65536.0), 7)) - 0.5;
  h += dot(fract(p * 0.5) - 0.5, tilt) * 0.024 * bevel;
  h += (fbm(p * 4.5, 3) * 0.011 + gnoise(p * 21.0) * 0.0025) * bevel;
  // Worn hollows in the middle of big slabs.
  h -= smoothstep(0.15, 0.6, e) * 0.006 * sl.z;
  crack = 0.0;
  if ((ti.decor & 4) != 0 && sl.y > 0.35) {
    vec2 q = p * 1.2 + sl.y * 17.0;
    q += vec2(gnoise(q * 1.7), gnoise(q * 1.7 + 5.2)) * 0.3;
    float n = gnoise(q * 1.4);
    float w = 0.006 + 0.008 * vnoise(p * 6.0);
    crack = (1.0 - smoothstep(0.0, w, abs(n))) * smoothstep(0.03, 0.12, e) * smoothstep(0.25, 0.55, vnoise(p * 0.9 + sl.y * 5.0));
    h -= crack * 0.008;
  }
  if ((ti.decor & 1) != 0) {
    vec3 v = voronoi(p * 6.5 + 7.0);
    float peb = smoothstep(0.3, 0.12, v.x + vnoise(p * 30.0) * 0.08) * step(0.5, v.z);
    h += peb * 0.022;
  }
  return h;
}

vec3 floorNormal(vec2 p, Tile ti, out vec3 sl, out float crack) {
  const float e = 0.0035;
  vec3 s2;
  float c2;
  float h0 = floorH(p, ti, sl, crack);
  float hx = floorH(p + vec2(e, 0.0), ti, s2, c2);
  float hy = floorH(p + vec2(0.0, e), ti, s2, c2);
  return normalize(vec3(-(hx - h0) / e, -(hy - h0) / e, 1.0));
}

vec3 floorAlbedo(vec2 p, vec3 sl, float crack, Tile ti, float wallD, out float wet) {
  float id = sl.y;
  vec3 c = mix(vec3(0.225, 0.23, 0.25), vec3(0.31, 0.295, 0.285), id);
  vec3 tint = mix(vec3(1.04, 0.98, 0.9), vec3(0.9, 0.97, 1.06), hash1(ivec2(int(id * 9973.0), 5)));
  c *= tint;
  c *= 0.84 + 0.22 * vnoise(p * 1.8 + id * 13.0) + 0.08 * gnoise(p * 14.0);
  // Mineral speckle, pitting and stains.
  c *= 0.93 + 0.14 * step(0.78, hash1(ivec2(floor(p * 60.0))));
  vec3 pit = voronoi(p * 11.0 + id * 7.0);
  c *= 1.0 - (1.0 - smoothstep(0.03, 0.08, pit.x)) * step(0.72, pit.z) * 0.45;
  c *= 1.0 - smoothstep(0.1, 0.55, fbm(p * 0.9 + id * 3.0, 3)) * 0.22;
  float e = chippedEdge(p, sl.x);
  c *= 0.9 + 0.14 * smoothstep(0.05, 0.5, e);
  float gw = groutWidth(p);
  float g = smoothstep(gw - 0.004, gw + 0.014, e);
  vec3 grout = vec3(0.12, 0.11, 0.1) * (0.75 + 0.5 * vnoise(p * 34.0));
  c = mix(grout, c, g);
  // Moss creeps along joints and cracks, in patches, thicker near walls.
  float mossPatch = fbm(p * 0.55 + 21.0, 3) + ((ti.decor & 2) != 0 ? 0.5 : -0.05) + (1.0 - wallD) * 0.35;
  float joint = (1.0 - g) + crack + (1.0 - smoothstep(0.0, 0.12, e)) * 0.5;
  float moss = smoothstep(0.2, 0.55, mossPatch) * clamp(joint + smoothstep(0.45, 0.8, mossPatch) * 0.6, 0.0, 1.0);
  moss *= 0.6 + 0.4 * vnoise(p * 18.0);
  c = mix(c, vec3(0.085, 0.15, 0.08), clamp(moss, 0.0, 1.0) * 0.85);
  float dirt = (1.0 - smoothstep(0.0, 0.3, wallD)) * 0.5;
  c = mix(c, vec3(0.1, 0.09, 0.08), dirt);
  c *= 1.0 - crack * 0.55;
  if ((ti.decor & 1) != 0) {
    vec3 v = voronoi(p * 6.5 + 7.0);
    float jag = vnoise(p * 30.0) * 0.08;
    float peb = smoothstep(0.3, 0.2, v.x + jag) * step(0.5, v.z);
    float rim = smoothstep(0.36, 0.3, v.x + jag) * step(0.5, v.z) * (1.0 - peb);
    c *= 1.0 - rim * 0.5;
    c = mix(c, vec3(0.27, 0.25, 0.23) * (0.7 + 0.6 * fract(v.z * 7.0)), peb);
  }
  wet = smoothstep(0.35, 0.75, fbm(p * 0.4 + 5.0, 2) + 0.15) * (1.0 - moss);
  c *= 1.0 - wet * 0.25;
  return c;
}

/** Wall rune: a carved stave with a few branches, like an ancient runic letter. */
float sigil(vec2 q, float seed) {
  float g = 0.0;
  float stave = sdSegment(q, vec2(0.0, -0.26), vec2(0.0, 0.26));
  g = max(g, 1.0 - smoothstep(0.012, 0.024, stave));
  for (int k = 0; k < 3 + LOOP_ZERO; k++) {
    float h = hash1(ivec2(int(seed * 997.0), k));
    if (h < 0.25 && k > 0) continue;
    float y0 = mix(-0.2, 0.2, hash1(ivec2(k, int(seed * 331.0))));
    float side = h > 0.6 ? 1.0 : -1.0;
    float dy = (hash1(ivec2(k * 7, int(seed * 97.0))) - 0.5) * 0.3;
    float branch = sdSegment(q, vec2(0.0, y0), vec2(side * 0.16, y0 + dy));
    g = max(g, 1.0 - smoothstep(0.01, 0.022, branch));
  }
  float dotR = length(q - vec2(0.12 * (hash1(ivec2(int(seed * 53.0), 9)) > 0.5 ? 1.0 : -1.0), -0.22)) - 0.022;
  return max(g, 1.0 - smoothstep(0.0, 0.012, dotR));
}

/** Door seal glyph: a source point with sound arcs on both sides, inside a notched ring. */
float soundSeal(vec2 q) {
  float r = length(q);
  float a = atan(q.y, q.x);
  float outer = 1.0 - smoothstep(0.007, 0.016, abs(r - 0.33));
  float notch = (1.0 - smoothstep(0.0, 0.028, abs(r - 0.385))) * step(0.82, fract(a / TAU * 8.0 + 0.0625));
  float core = 1.0 - smoothstep(0.035, 0.047, r);
  float arcs = 0.0;
  for (int k = 0; k < 3 + LOOP_ZERO; k++) {
    float rr = 0.1 + float(k) * 0.062;
    float band = 1.0 - smoothstep(0.008, 0.017, abs(r - rr));
    arcs = max(arcs, band * smoothstep(0.5, 0.68, abs(cos(a))));
  }
  return max(max(outer, notch), max(core, arcs));
}

Mat floorMat(Hit h, float wallD, float pitD) {
  Mat m;
  vec3 sl;
  float crack;
  vec2 p = h.pos.xy;
  m.n = floorNormal(p, h.ti, sl, crack);
  float wet;
  m.albedo = floorAlbedo(p, sl, crack, h.ti, wallD, wet);
  // Crumbling rim around chasms.
  float rim = 1.0 - smoothstep(0.0, 0.22, pitD + vnoise(p * 14.0) * 0.08);
  m.albedo *= 1.0 - rim * 0.55;
  m.spec = 0.1 + wet * 0.9;
  m.gloss = mix(18.0, 70.0, wet);
  m.emissive = vec3(0.0);
  m.ao = mix(0.32, 1.0, smoothstep(0.0, 0.5, wallD));
  m.edge = 1.0 - smoothstep(0.0, 0.08, min(wallD, pitD));
  return m;
}

// ----------------------------------------------------------------- silt ---

/** Fine sediment combed into soft ripples. */
float siltH(vec2 p) {
  vec2 q = p + vec2(fbm(p * 0.6, 2), fbm(p * 0.6 + 9.0, 2)) * 1.1;
  float ripple = sin(dot(q, vec2(7.5, 2.6)) + fbm(q * 1.7, 2) * 4.0);
  return ripple * 0.011 + fbm(p * 7.0, 2) * 0.006;
}

/** Dark, matte and soft: the ground that swallows footsteps shows almost nothing. */
Mat siltMat(Hit h) {
  Mat m;
  vec2 p = h.pos.xy;
  const float e = 0.004;
  float h0 = siltH(p);
  m.n = normalize(vec3(-(siltH(p + vec2(e, 0.0)) - h0) / e, -(siltH(p + vec2(0.0, e)) - h0) / e, 1.0));
  vec3 c = mix(vec3(0.16, 0.15, 0.135), vec3(0.22, 0.2, 0.175), vnoise(p * 1.3));
  c *= 0.8 + 0.35 * smoothstep(-0.01, 0.01, h0);
  float mica = step(0.992, hash1(ivec2(floor(p * 70.0))));
  m.albedo = c;
  m.spec = 0.03 + mica * 1.2;
  m.gloss = mix(6.0, 140.0, mica);
  m.emissive = vec3(0.0);
  m.ao = 1.0;
  m.edge = 0.0;
  return m;
}

Mat mixMat(Mat a, Mat b, float t) {
  Mat m;
  m.albedo = mix(a.albedo, b.albedo, t);
  m.n = normalize(mix(a.n, b.n, t));
  m.spec = mix(a.spec, b.spec, t);
  m.gloss = mix(a.gloss, b.gloss, t);
  m.emissive = mix(a.emissive, b.emissive, t);
  m.ao = mix(a.ao, b.ao, t);
  m.edge = mix(a.edge, b.edge, t);
  return m;
}

/** How much silt covers a point, from the signed edge distance (negative inside), with a ragged border. */
float siltCover(vec2 p, float sd) {
  return 1.0 - smoothstep(-0.22, 0.22, sd + (vnoise(p * 4.5) - 0.5) * 0.3 + (vnoise(p * 17.0) - 0.5) * 0.08);
}

// ---------------------------------------------------------------- draft ---

/** Pale dust combed into streaks by moving air, drifting downwind. */
float windStreaks(vec2 p, vec2 w) {
  vec2 side = vec2(-w.y, w.x);
  float along = dot(p, w) - TIME * 0.9;
  float across = dot(p, side);
  float n = vnoise(vec2(along * 0.9, across * 16.0)) * 0.65 + vnoise(vec2(along * 2.1 - TIME * 0.6, across * 34.0 + 7.0)) * 0.35;
  // Gusts: the dust gathers in drifting patches rather than even stripes.
  float gust = smoothstep(0.25, 0.75, vnoise(vec2(along * 0.4 - TIME * 0.3, across * 1.3 + 3.0)));
  return smoothstep(0.5, 0.8, n) * (0.35 + 0.65 * gust);
}

// ---------------------------------------------------------------- water ---

float waterH(vec2 p) {
  float t = TIME;
  return gnoise(p * 2.2 + vec2(t * 0.35, t * 0.21)) * 0.5
    + gnoise(p * 4.7 - vec2(t * 0.42, -t * 0.3)) * 0.3
    + gnoise(p * 9.0 + vec2(-t * 0.6, t * 0.5)) * 0.12;
}

Mat waterMat(Hit h, Sonar s, float shoreD) {
  Mat m;
  vec2 p = h.pos.xy;
  const float e = 0.01;
  float h0 = waterH(p);
  vec3 n = vec3(-(waterH(p + vec2(e, 0.0)) - h0) / e * 0.07, -(waterH(p + vec2(0.0, e)) - h0) / e * 0.07, 1.0);
  float dl = length(s.dir);
  if (dl > 1e-4) n.xy += (s.dir / dl) * clamp(s.ripple, -1.5, 1.5) * 0.5;
  m.n = normalize(n);
  vec3 sl;
  float crack;
  vec2 q = p + m.n.xy * 0.08;
  floorH(q, h.ti, sl, crack);
  float wet;
  vec3 bed = floorAlbedo(q, sl, crack, h.ti, 1.0, wet);
  float depth = smoothstep(0.0, 0.4, shoreD);
  m.albedo = bed * mix(vec3(0.36, 0.46, 0.46), vec3(0.14, 0.24, 0.3), depth);
  m.spec = 1.4;
  m.gloss = 90.0;
  m.emissive = vec3(0.0);
  m.ao = 1.0;
  m.edge = 1.0 - smoothstep(0.0, 0.07, shoreD);
  return m;
}

// ---------------------------------------------------------------- walls ---

/** Distance to the nearest exposed (lower) edge of a wall tile. */
float wallEdgeDist(vec2 f, vec4 expo, vec4 diag) {
  float e = 1.0;
  if (expo.x > 0.5) e = min(e, f.x);
  if (expo.y > 0.5) e = min(e, 1.0 - f.x);
  if (expo.z > 0.5) e = min(e, f.y);
  if (expo.w > 0.5) e = min(e, 1.0 - f.y);
  if (diag.x > 0.5) e = min(e, length(f));
  if (diag.y > 0.5) e = min(e, length(f - vec2(1.0, 0.0)));
  if (diag.z > 0.5) e = min(e, length(f - vec2(0.0, 1.0)));
  if (diag.w > 0.5) e = min(e, length(f - vec2(1.0, 1.0)));
  return e;
}

float wallTopH(vec2 p, vec2 f, vec4 expo, vec4 diag) {
  float e = wallEdgeDist(f, expo, diag) + fbm(p * 7.0, 2) * 0.04;
  float b = 1.0 - smoothstep(0.0, 0.16, e);
  return -b * b * 0.16 + fbm(p * 3.5, 3) * 0.025;
}

Mat wallTopMat(Hit h) {
  Mat m;
  vec2 p = h.pos.xy;
  ivec2 t = h.tile;
  vec2 f = p - vec2(t);
  float top = WALL_H - 0.01;
  vec4 expo = vec4(
    heightAt(t + ivec2(-1, 0)) < top ? 1.0 : 0.0,
    heightAt(t + ivec2(1, 0)) < top ? 1.0 : 0.0,
    heightAt(t + ivec2(0, -1)) < top ? 1.0 : 0.0,
    heightAt(t + ivec2(0, 1)) < top ? 1.0 : 0.0
  );
  vec4 diag = vec4(
    expo.x + expo.z < 0.5 && heightAt(t + ivec2(-1, -1)) < top ? 1.0 : 0.0,
    expo.y + expo.z < 0.5 && heightAt(t + ivec2(1, -1)) < top ? 1.0 : 0.0,
    expo.x + expo.w < 0.5 && heightAt(t + ivec2(-1, 1)) < top ? 1.0 : 0.0,
    expo.y + expo.w < 0.5 && heightAt(t + ivec2(1, 1)) < top ? 1.0 : 0.0
  );
  const float k = 0.004;
  float h0 = wallTopH(p, f, expo, diag);
  float hx = wallTopH(p + vec2(k, 0.0), f + vec2(k, 0.0), expo, diag);
  float hy = wallTopH(p + vec2(0.0, k), f + vec2(0.0, k), expo, diag);
  m.n = normalize(vec3(-(hx - h0) / k, -(hy - h0) / k, 1.0));
  float e = wallEdgeDist(f, expo, diag);

  // Big staggered capstone blocks with joints.
  vec2 bp = p + vec2(float(t.y & 1) * 0.5, 0.0);
  vec2 bf = fract(bp);
  float joint = min(min(bf.x, 1.0 - bf.x), min(bf.y, 1.0 - bf.y));
  float js = smoothstep(0.012, 0.03, joint + fbm(p * 9.0, 2) * 0.01);
  float bid = hash1(ivec2(floor(bp)) + ivec2(41, 3));
  vec3 c = mix(vec3(0.21, 0.21, 0.23), vec3(0.29, 0.275, 0.265), bid);
  c *= 0.8 + 0.3 * vnoise(p * 4.0) + 0.08 * gnoise(p * 16.0);
  c = mix(vec3(0.07), c, js);
  float rimMask = 1.0 - smoothstep(0.0, 0.18, e);
  float moss = smoothstep(0.1, 0.6, fbm(p * 1.1 + 4.0, 3) + rimMask * 0.2) * (1.0 - rimMask * 0.6);
  c = mix(c, vec3(0.1, 0.16, 0.09), moss * 0.55);
  c *= 1.0 + rimMask * 0.55;
  m.albedo = c;
  m.spec = 0.12;
  m.gloss = 20.0;
  m.emissive = vec3(0.0);
  m.ao = 1.0;
  m.edge = rimMask;
  return m;
}

float brickH(vec2 uv, float seed) {
  const float course = WALL_H / 4.0;
  float row = floor(uv.y / course);
  float fz = fract(uv.y / course);
  float off = hash1(ivec2(int(row), 11 + int(seed * 7.0))) + row * 0.5;
  float bu = uv.x / 0.62 + off;
  float fu = fract(bu);
  float mortar = min(min(fz, 1.0 - fz) * course, min(fu, 1.0 - fu) * 0.62);
  float bid = hash1(ivec2(int(floor(bu)), int(row)) + ivec2(int(seed * 255.0), 5));
  return smoothstep(0.006, 0.03, mortar) * (0.03 + bid * 0.012) + fbm(uv * 9.0, 2) * 0.004;
}

Mat wallSideMat(Hit h) {
  Mat m;
  vec3 pos = h.pos;
  bool alongY = abs(h.n.x) > 0.5;
  float u = alongY ? pos.y : pos.x;
  vec3 T = alongY ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 Bt = vec3(0.0, 0.0, 1.0);
  float z = pos.z;
  if (z < 0.0) {
    // Raw bedrock strata inside chasms.
    vec2 uv = vec2(u, z);
    float strata = gnoise(vec2(u * 0.6, z * 5.0 + gnoise(uv * 1.5) * 0.8));
    float r0 = fbm(uv * 4.0, 3);
    const float k = 0.01;
    float rx = fbm((uv + vec2(k, 0.0)) * 4.0, 3);
    float rz = fbm((uv + vec2(0.0, k)) * 4.0, 3);
    vec3 n = h.n - T * (rx - r0) / k * 0.08 - Bt * (rz - r0) / k * 0.08;
    m.n = normalize(n);
    m.albedo = mix(vec3(0.13, 0.11, 0.1), vec3(0.24, 0.21, 0.19), strata * 0.5 + 0.5) * (0.7 + 0.5 * r0);
    m.spec = 0.08;
    m.gloss = 16.0;
    m.emissive = vec3(0.0);
    m.ao = 1.0;
    m.edge = 1.0 - smoothstep(-0.06, 0.0, -abs(z) - 0.0);
    return m;
  }
  vec2 uv = vec2(u, z);
  float seed = h.ti.variant;
  const float k = 0.004;
  float b0 = brickH(uv, seed);
  float bx = brickH(uv + vec2(k, 0.0), seed);
  float bz = brickH(uv + vec2(0.0, k), seed);
  m.n = normalize(h.n - T * (bx - b0) / k * 0.6 - Bt * (bz - b0) / k * 0.6);
  const float course = WALL_H / 4.0;
  float row = floor(z / course);
  float bu = u / 0.62 + hash1(ivec2(int(row), 11 + int(seed * 7.0))) + row * 0.5;
  float bid = hash1(ivec2(int(floor(bu)), int(row)) + ivec2(int(seed * 255.0), 5));
  vec3 c = mix(vec3(0.19, 0.19, 0.21), vec3(0.3, 0.28, 0.26), bid);
  c *= 0.78 + 0.34 * vnoise(uv * vec2(6.0, 9.0));
  float mortar = smoothstep(0.0, 0.03, b0);
  c = mix(vec3(0.05, 0.05, 0.055), c, mortar);
  // Water stains and moss creeping up from the floor.
  float stain = smoothstep(0.3, 0.8, vnoise(vec2(u * 3.0, 0.5)) ) * smoothstep(WALL_H, 0.2, z) * 0.35;
  c *= 1.0 - stain;
  float moss = smoothstep(0.35, 0.0, z + fbm(uv * 3.0, 2) * 0.25) * smoothstep(0.0, 0.6, vnoise(uv * 2.0 + 9.0));
  c = mix(c, vec3(0.08, 0.15, 0.08), moss);
  m.albedo = c;
  m.spec = 0.1 + stain * 0.6;
  m.gloss = 24.0;
  m.emissive = vec3(0.0);
  m.ao = mix(0.45, 1.0, smoothstep(0.0, 0.35, z));
  m.edge = smoothstep(WALL_H - 0.08, WALL_H, z) + (1.0 - smoothstep(0.0, 0.05, z));
  return m;
}

// ---------------------------------------------------------------- doors ---

float doorPlateH(vec2 q) {
  float plate = sdRoundBox(q, vec2(0.4), 0.05);
  return (1.0 - smoothstep(-0.02, 0.0, plate)) * 0.03 - soundSeal(q) * 0.012;
}

Mat doorMat(Hit h) {
  Mat m;
  vec2 p = h.pos.xy;
  vec2 q = p - vec2(h.tile) - 0.5;
  if (h.face == 1) {
    m = wallSideMat(h);
    float band = 1.0 - smoothstep(0.02, 0.035, abs(fract((abs(h.n.x) > 0.5 ? p.y : p.x) * 2.0) - 0.5));
    m.albedo = mix(m.albedo * 0.8, vec3(0.42, 0.28, 0.14), band * 0.8);
    m.spec += band * 0.8;
    m.emissive = vec3(1.0, 0.62, 0.25) * h.ti.aux * band * 0.35;
    return m;
  }
  const float k = 0.004;
  float h0 = doorPlateH(q);
  float hx = doorPlateH(q + vec2(k, 0.0));
  float hy = doorPlateH(q + vec2(0.0, k));
  m.n = normalize(vec3(-(hx - h0) / k, -(hy - h0) / k, 1.0));
  float frame = sdRoundBox(q, vec2(0.47), 0.06);
  float plate = sdRoundBox(q, vec2(0.4), 0.05);
  float g = soundSeal(q);
  vec3 stone = vec3(0.26, 0.25, 0.26) * (0.8 + 0.35 * vnoise(p * 6.0));
  vec3 bronze = vec3(0.45, 0.3, 0.15) * (0.75 + 0.4 * vnoise(p * 11.0));
  float rimBand = smoothstep(0.0, -0.02, frame) * smoothstep(-0.07, -0.05, frame);
  vec3 c = mix(stone, bronze, rimBand);
  c = mix(c, vec3(0.06, 0.05, 0.045), g * 0.85);
  float plateEdge = 1.0 - smoothstep(0.0, 0.02, abs(plate));
  c *= 1.0 - plateEdge * 0.6;
  m.albedo = c;
  m.spec = 0.2 + rimBand * 1.2;
  m.gloss = mix(20.0, 60.0, rimBand);
  float glow = h.ti.aux;
  float pulse = 0.75 + 0.25 * sin(TIME * 3.0 + p.x * 2.0);
  m.emissive = vec3(1.0, 0.62, 0.25) * g * glow * pulse * 1.6 + vec3(1.0, 0.55, 0.2) * rimBand * glow * 0.3;
  m.ao = 1.0;
  m.edge = plateEdge;
  return m;
}

// ----------------------------------------------------------- instrument ---
${INSTRUMENT}

// ----------------------------------------------------------------- main ---

float dissolveGrain(vec2 p) {
  return clamp(0.62 * vnoise(p * 24.0) + 0.38 * vnoise(p * 4.5 + 17.0), 0.0, 1.0);
}

void main() {
  vec2 F = uCam.xy + vec2(vNdc.x, -vNdc.y) * uCam.zw;
  Hit h = raycast(F);
  gl_FragDepth = depthOf(h.pos.z);
  if (h.face == 2) {
    outColor = vec4(VOID_COL * 0.4, 1.0);
    return;
  }
  bool isTop = h.face == 0;
  bool isWall = h.ti.type == 1;
  bool isDoor = h.ti.type == 4;
  bool isGlass = h.ti.type == 7;
  bool isWater = h.ti.type == 3 && isTop;
  bool isGround = isTop && !isWall && !isDoor && !isGlass && !isWater && h.pos.z > -0.01;
  // A floor key keeps its note in the tile's B channel (note + 1).
  int keyNote = isGround && (h.ti.decor & 32) != 0 ? int(h.ti.open * 255.0 + 0.5) - 1 : -1;
  vec2 sp = h.pos.xy + h.n.xy * 0.07;
  vec4 wd = textureLod(uWallDist, h.pos.xy / MAP_SIZE, 0.0);
  float silt = isGround ? siltCover(h.pos.xy, wd.a * 2.0 - 1.0) : 0.0;
  // Edges (slab joints, wall bases, chasm rims, wall faces) linger longer as the echo fades.
  float edgeHint = !isTop ? 0.55 : 1.0 - smoothstep(0.0, 0.1, min(wd.r, wd.g));
  if (isGround) edgeHint = max(edgeHint, (1.0 - smoothstep(0.0, 0.05, slabLayout(h.pos.xy).x)) * (1.0 - silt));
  float grain = dissolveGrain(h.pos.xy + vec2(h.pos.z * 1.7)) * (1.0 - 0.8 * edgeHint);
  // The travelling front sinks into silt instead of skating across it.
  float frontGain = !isTop ? 0.6 : (h.pos.z > 0.3 ? 0.28 : (isWater ? 1.25 : mix(1.0, 0.3, silt)));
  Sonar s = sonarAt(sp, grain, frontGain);
  vec2 muv = sp / MAP_SIZE;
  float mem = textureLod(uMemory, muv, 0.0).r;
  bool runes = isWall && isTop && (h.ti.decor & 8) != 0;
  bool glowDoor = isDoor && h.ti.aux > 0.01;
  bool glowGlass = isGlass && h.ti.decor != 0;
  float lightAmt = s.reveal + mem * 0.1 + dot(s.front, vec3(1.0));
  if (lightAmt < 0.002 && !runes && !glowDoor && !glowGlass && keyNote < 0) {
    outColor = vec4(VOID_COL, 1.0);
    return;
  }

  Mat m;
  if (isGlass) m = glassMat(h, mem, s.reveal);
  else if (isDoor) m = doorMat(h);
  else if (!isTop) m = wallSideMat(h);
  else if (isWall) m = wallTopMat(h);
  else if (isWater) m = waterMat(h, s, wd.b);
  else if (silt > 0.999) m = siltMat(h);
  else {
    m = floorMat(h, wd.r, wd.g);
    if (h.ti.type == 6) {
      float streak = windStreaks(h.pos.xy, windOf(h.ti));
      m.albedo = mix(m.albedo, vec3(0.62, 0.6, 0.55), streak * 0.6);
    }
    if (silt > 0.001) m = mixMat(m, siltMat(h), silt);
    if (keyNote >= 0) keyInlay(m, h.pos.xy, h.tile, keyNote, clamp(mem * 1.2 + s.reveal * 0.6, 0.0, 1.0));
  }

  if (runes) {
    vec2 q = h.pos.xy - vec2(h.tile) - 0.5;
    float g = sigil(q * 1.15, h.ti.variant);
    m.albedo = mix(m.albedo, vec3(0.03), g * 0.8);
    float awake = clamp(mem * 1.2 + s.reveal * 0.5, 0.0, 1.0);
    m.emissive += vec3(0.25, 0.85, 1.0) * g * awake * awake * 0.7 * (0.8 + 0.2 * sin(TIME * 2.0 + h.ti.variant * 20.0));
  }

  float fog = h.pos.z < 0.0 ? exp(h.pos.z * 0.85) : 1.0;
  vec3 col = sonarShade(s, m.albedo, m.n, m.spec, m.gloss) * m.ao;
  col += s.front * (0.12 + m.albedo * 1.4);
  col += s.light * edgeHint * 0.035;
  // Memory: a faint, cold sketch of what was heard, strongest on edges.
  col += MEMORY_COL * mem * mem * (0.0015 + m.edge * 0.05);
  col *= fog;
  col += m.emissive;
  outColor = vec4(col + VOID_COL, 1.0);
}
`;
