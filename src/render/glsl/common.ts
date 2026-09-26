import { MAX_WAVES } from "../../game/waves";

/** World constants shared between TypeScript and GLSL. */
export const WALL_HEIGHT = 1.15;
export const PIT_DEPTH = 3.2;

export const HEADER = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler2DArray;

#define MAXW ${MAX_WAVES}
#define PI 3.14159265359
#define TAU 6.28318530718
#define WALL_H ${WALL_HEIGHT.toFixed(4)}
#define PIT_D ${PIT_DEPTH.toFixed(4)}

layout(std140) uniform Frame {
  vec4 uCam;     // camera center xy, half view size xy (floor plane, tiles)
  vec4 uCam2;    // camera height, time, map width, map height
  vec4 uCam3;    // wave count, field res, px size (tiles), unused
  vec4 uPlayer;  // player xy, charge, alive
  vec4 uWaveA[MAXW]; // origin xy, age, speed
  vec4 uWaveB[MAXW]; // radius, strength, layer, kind
  vec4 uWaveC[MAXW]; // color rgb, fade
};

#define TIME uCam2.y
/** Always 0 at runtime; adding it to a loop bound stops shader compilers from unrolling the loop. */
#define LOOP_ZERO int(uCam3.w)
#define MAP_SIZE uCam2.zw
#define CAM_H uCam2.x

float depthOf(float z) { return clamp((CAM_H - z) / (CAM_H + PIT_D + 1.0), 0.0, 1.0); }

/** Project a world point at height z to clip space (camera looks straight down). */
vec4 projectWorld(vec2 w, float z) {
  vec2 p = uCam.xy + (w - uCam.xy) * (CAM_H / (CAM_H - z));
  vec2 ndc = (p - uCam.xy) / uCam.zw;
  return vec4(ndc.x, -ndc.y, depthOf(z) * 2.0 - 1.0, 1.0);
}
`;

export const NOISE = /* glsl */ `
uint hashU(uint x) {
  x ^= x >> 16u; x *= 0x7feb352du;
  x ^= x >> 15u; x *= 0x846ca68bu;
  x ^= x >> 16u;
  return x;
}
uint hashI2(ivec2 c) { return hashU(uint(c.x) * 1597334677u ^ hashU(uint(c.y) + 0x9e3779b9u)); }
float hash1(ivec2 c) { return float(hashI2(c)) * (1.0 / 4294967296.0); }
vec2 hash2(ivec2 c) {
  uint h = hashI2(c);
  return vec2(float(h & 0xffffu), float(h >> 16u)) * (1.0 / 65535.0);
}
float hashF(vec2 p) { return hash1(ivec2(floor(p))); }

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  ivec2 c = ivec2(i);
  float a = hash1(c);
  float b = hash1(c + ivec2(1, 0));
  float d = hash1(c + ivec2(0, 1));
  float e = hash1(c + ivec2(1, 1));
  return mix(mix(a, b, u.x), mix(d, e, u.x), u.y);
}

/** Gradient noise, roughly in [-1, 1]. */
float gnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  ivec2 c = ivec2(i);
  vec2 ga = hash2(c) * 2.0 - 1.0;
  vec2 gb = hash2(c + ivec2(1, 0)) * 2.0 - 1.0;
  vec2 gc = hash2(c + ivec2(0, 1)) * 2.0 - 1.0;
  vec2 gd = hash2(c + ivec2(1, 1)) * 2.0 - 1.0;
  float va = dot(ga, f);
  float vb = dot(gb, f - vec2(1.0, 0.0));
  float vc = dot(gc, f - vec2(0.0, 1.0));
  float vd = dot(gd, f - vec2(1.0, 1.0));
  return mix(mix(va, vb, u.x), mix(vc, vd, u.x), u.y) * 1.5;
}

float fbm(vec2 p, int octaves) {
  float s = 0.0;
  float a = 0.5;
  const mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < octaves + LOOP_ZERO; i++) {
    s += a * gnoise(p);
    p = m * p + vec2(3.1, 1.7);
    a *= 0.5;
  }
  return s;
}

/** x: distance to nearest feature, y: F2 - F1 (edge proximity), z: cell id. */
vec3 voronoi(vec2 p) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float f1 = 8.0;
  float f2 = 8.0;
  float id = 0.0;
  for (int j = -1; j <= 1 + LOOP_ZERO; j++) {
    for (int i = -1; i <= 1 + LOOP_ZERO; i++) {
      ivec2 c = ivec2(n) + ivec2(i, j);
      vec2 o = hash2(c) * 0.8 + 0.1;
      vec2 r = vec2(float(i), float(j)) + o - f;
      float d = dot(r, r);
      if (d < f1) { f2 = f1; f1 = d; id = hash1(c + ivec2(19, 71)); }
      else if (d < f2) { f2 = d; }
    }
  }
  f1 = sqrt(f1);
  return vec3(f1, sqrt(f2) - f1, id);
}

mat2 rot2(float a) { float c = cos(a); float s = sin(a); return mat2(c, s, -s, c); }
`;

/** SDF helpers for procedurally drawn entities. */
export const SDF = /* glsl */ `
float sdCircle(vec2 p, float r) { return length(p) - r; }
float sdEllipse(vec2 p, vec2 r) {
  // Cheap, good-enough ellipse distance (scaled by the smaller radius).
  float k = length(p / r);
  return (k - 1.0) * min(r.x, r.y);
}
float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
float sdRoundBox(vec2 p, vec2 b, float r) { return sdBox(p, b - r) - r; }
float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
/** Segment distance that also returns the parameter along the segment. */
vec2 sdSegmentT(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return vec2(length(pa - ba * h), h);
}
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
/** Anti-aliased coverage from a signed distance. */
float cover(float d, float px) { return clamp(0.5 - d / px, 0.0, 1.0); }
/** Dome height for a shape of given signed distance and "radius". */
float dome(float d, float r) { float t = clamp(-d / r, 0.0, 1.0); return sqrt(1.0 - (1.0 - t) * (1.0 - t)); }
`;
