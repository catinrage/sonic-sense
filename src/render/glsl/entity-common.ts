import { HEADER, NOISE, SDF } from "./common";
import { SONAR } from "./sonar";

export const ENTITY_VS = /* glsl */ `${HEADER}
layout(location = 0) in vec2 aCorner;
uniform vec4 uEnt;  // world x, y, height z, rotation
uniform vec2 uHalf; // half extents in tiles
out vec2 vLocal;
out vec2 vWorld;
void main() {
  vec2 local = aCorner * uHalf;
  float c = cos(uEnt.w);
  float s = sin(uEnt.w);
  vec2 w = uEnt.xy + vec2(c * local.x - s * local.y, s * local.x + c * local.y);
  vLocal = local;
  vWorld = w;
  gl_Position = projectWorld(w, uEnt.z);
}
`;

/**
 * Shared fragment prelude for procedurally drawn entities. Parts are layered
 * with `over()` into a single surface which is then lit once by the sonar.
 */
export const ENTITY_PRELUDE = /* glsl */ `${HEADER}
${NOISE}
${SDF}
${SONAR}
uniform vec4 uEnt;
uniform vec2 uHalf;
uniform vec4 uP[4];
uniform vec4 uExtra[12];
in vec2 vLocal;
in vec2 vWorld;
out vec4 outColor;

struct Surf { vec3 alb; vec3 n; vec3 emi; float spec; float gloss; float a; };

/** Purely additive light (halos) that ignores coverage. */
vec3 gHalo = vec3(0.0);

Surf surfEmpty() {
  Surf s;
  s.alb = vec3(0.0);
  s.n = vec3(0.0, 0.0, 1.0);
  s.emi = vec3(0.0);
  s.spec = 0.0;
  s.gloss = 8.0;
  s.a = 0.0;
  return s;
}

void over(inout Surf s, vec3 alb, vec3 n, vec3 emi, float spec, float gloss, float a) {
  s.alb = mix(s.alb, alb, a);
  s.n = mix(s.n, n, a);
  s.emi = mix(s.emi, emi, a);
  s.spec = mix(s.spec, spec, a);
  s.gloss = mix(s.gloss, gloss, a);
  s.a = s.a + a * (1.0 - s.a);
}

/** Additive glow painted on top of the surface (keeps alpha). */
void glow(inout Surf s, vec3 emi) { s.emi += emi; }

float pxSize() { return max(length(fwidth(vLocal)) * 0.8, 1e-4); }

vec3 toWorldN(vec3 n) {
  float c = cos(uEnt.w);
  float s = sin(uEnt.w);
  return normalize(vec3(c * n.x - s * n.y, s * n.x + c * n.y, n.z));
}

/** Normal of a dome-shaped part from its signed distance gradient. */
vec3 domeNormal(vec2 grad, float d, float r, float steep) {
  float t = clamp(-d / r, 0.0, 1.0);
  float slope = (1.0 - t) * steep;
  vec2 g = length(grad) > 1e-5 ? normalize(grad) : vec2(0.0);
  return normalize(vec3(g * slope, 1.0));
}

vec4 finish(Surf s, float frontGain, vec3 selfLight) {
  gHalo *= 1.0 - smoothstep(0.55, 1.0, length(vLocal / uHalf));
  if (s.a < 0.002) return vec4(gHalo, 0.0);
  vec3 N = toWorldN(normalize(s.n));
  Sonar so = sonarAt(vWorld, 0.0, frontGain);
  vec3 col = sonarShade(so, s.alb, N, s.spec, s.gloss);
  col += so.front * (0.2 + s.alb * 1.6);
  col += s.alb * selfLight;
  col += s.emi;
  return vec4(col * s.a + gHalo, s.a);
}
`;
