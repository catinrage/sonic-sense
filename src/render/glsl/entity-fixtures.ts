import { ENTITY_PRELUDE } from "./entity-common";

/**
 * A hanging moss baffle seen from above: a canopy of dangling tufts that parts
 * around whoever pushes through it.
 * uP[0]: time, seed, mover offset xy (tile-local). uP[1].x: how hard the mover parts it.
 */
export const CURTAIN_FS = /* glsl */ `${ENTITY_PRELUDE}
/** Nearest tuft crown: xy = offset from the crown to p, z = the tuft's id. */
vec3 tuft(vec2 p) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float best = 8.0;
  vec3 res = vec3(0.0);
  for (int j = -1; j <= 1 + LOOP_ZERO; j++) {
    for (int i = -1; i <= 1 + LOOP_ZERO; i++) {
      ivec2 c = ivec2(n) + ivec2(i, j);
      vec2 r = f - (vec2(float(i), float(j)) + hash2(c) * 0.8 + 0.1);
      float d = dot(r, r);
      if (d < best) {
        best = d;
        res = vec3(r, hash1(c + ivec2(19, 71)));
      }
    }
  }
  return res;
}

void main() {
  vec2 p = vLocal;
  float px = pxSize();
  float time = uP[0].x;
  float seed = uP[0].y;
  vec2 mover = uP[0].zw;
  float partAmt = uP[1].x;
  Surf s = surfEmpty();

  // Strands are pushed aside around the mover and sway in the still air.
  vec2 dm = p - mover;
  float push = partAmt * exp(-dot(dm, dm) * 7.0);
  vec2 q = p - normalize(dm + 1e-4) * push * 0.22;
  q += vec2(sin(time * 0.8 + q.y * 4.0 + seed * 6.0), cos(time * 0.6 + q.x * 4.0)) * 0.012;

  float border = sdRoundBox(q, vec2(0.47), 0.1) + (vnoise(q * 8.0 + seed * 11.0) - 0.5) * 0.14;
  float canopy = 1.0 - smoothstep(-0.03, 0.03, border);

  // Tufts: each voronoi cell is a clump whose strands fall away from its crown.
  vec3 v = tuft(q * 5.5 + seed * 17.0);
  vec2 toCrown = v.xy;
  float r = length(toCrown);
  float ang = atan(toCrown.y, toCrown.x);
  float fibre = 0.5 + 0.5 * sin(ang * 17.0 + v.z * 40.0 + vnoise(q * 30.0) * 3.0);
  float strands = smoothstep(0.35, 0.9, fibre) * smoothstep(0.62, 0.1, r);
  float gaps = smoothstep(0.35, 0.6, vnoise(q * 13.0 + seed * 3.0));
  float amount = canopy * clamp(strands * 0.7 + 0.55 - gaps * 0.35, 0.0, 1.0) * (1.0 - push * 0.85);

  vec3 moss = mix(vec3(0.07, 0.11, 0.06), vec3(0.2, 0.27, 0.13), smoothstep(0.55, 0.05, r));
  vec3 lichen = vec3(0.42, 0.44, 0.36);
  vec3 alb = mix(moss, lichen, smoothstep(0.93, 0.99, fibre) * step(0.7, v.z) * 0.8);
  alb *= 0.75 + 0.4 * vnoise(q * 22.0);
  vec2 g = r > 1e-4 ? -toCrown / r : vec2(0.0);
  vec3 n = normalize(vec3(g * smoothstep(0.0, 0.5, r) * 0.9, 1.0));
  over(s, alb, n, vec3(0.0), 0.08, 12.0, amount);
  outColor = finish(s, 0.5, vec3(0.0));
}
`;

/**
 * A resonator's dish: a polished bronze reflector behind the crystal, opening
 * along local +x (the entity is rotated to the beam). uP[0]: glow, time.
 */
export const DISH_FS = /* glsl */ `${ENTITY_PRELUDE}
const vec3 VIOLET = vec3(0.74, 0.42, 1.0);
void main() {
  vec2 p = vLocal;
  float px = pxSize();
  float glowAmt = uP[0].x;
  float time = uP[0].y;
  Surf s = surfEmpty();

  float sh = sdCircle(p - vec2(-0.04, 0.05), 0.5);
  over(s, vec3(0.0), vec3(0.0, 0.0, 1.0), vec3(0.0), 0.0, 8.0, (1.0 - smoothstep(-0.2, 0.05, sh)) * 0.5);

  // Round stone plinth.
  float plinth = sdCircle(p, 0.3);
  vec3 pn = normalize(vec3(p * 2.0 * smoothstep(-0.08, 0.0, plinth), 1.0));
  over(s, vec3(0.2, 0.19, 0.2) * (0.75 + 0.4 * vnoise(p * 24.0)), pn, vec3(0.0), 0.1, 12.0, cover(plinth, px));

  // The reflector: a crescent behind the crystal, thickest at its back, its hollow facing the beam.
  vec2 c = vec2(0.26, 0.0);
  vec2 d = p - c;
  float rr = length(d);
  float a = atan(d.y, -d.x);
  float span = 1.35;
  float thick = 0.035 + 0.075 * cos(clamp(a / span, -1.0, 1.0) * 1.5708);
  float arc = max(abs(rr - 0.6) - thick, (abs(a) - span) * rr);
  float inner = smoothstep(0.6, 0.6 - thick * 2.0, rr);
  vec3 bronze = vec3(0.5, 0.34, 0.17) * (0.8 + 0.35 * vnoise(vec2(a * 9.0, rr * 30.0)));
  vec2 radial = rr > 1e-4 ? d / rr : vec2(0.0);
  float bevel = (rr - 0.6) / thick;
  vec3 an = normalize(vec3(radial * clamp(bevel, -1.0, 1.0) * 0.9, 1.0));
  float ribs = 1.0 - smoothstep(0.0, 0.03, abs(fract(a / span * 3.0 + 0.5) - 0.5) * rr * 2.0);
  vec3 emi = VIOLET * glowAmt * (0.2 + inner * 0.8) * (0.7 + 0.3 * sin(time * 5.0 + a * 4.0));
  over(s, mix(bronze, bronze * 0.55, ribs), an, emi, 1.3, 70.0, cover(arc, px));

  // Two struts holding the dish to the plinth.
  for (int k = 0; k < 2 + LOOP_ZERO; k++) {
    float side = k == 0 ? -1.0 : 1.0;
    vec2 a0 = vec2(-0.05, side * 0.12);
    vec2 a1 = c + vec2(-cos(0.9), side * sin(0.9)) * 0.55;
    float strut = sdSegment(p, a0, a1) - 0.022;
    over(s, bronze * 0.7, vec3(0.0, 0.0, 1.0), vec3(0.0), 0.9, 50.0, cover(strut, px));
  }
  gHalo = VIOLET * exp(-length(p - vec2(0.3, 0.0)) * 4.0) * glowAmt * 0.12;
  outColor = finish(s, 0.6, vec3(0.0));
}
`;

/**
 * Wind chime seen from above: bone tubes around a small wooden crown.
 * uP[0]: swing (0..1), time, seed.
 */
export const CHIME_FS = /* glsl */ `${ENTITY_PRELUDE}
const vec3 ICE = vec3(0.7, 0.86, 1.0);
void main() {
  vec2 p = vLocal;
  float px = pxSize();
  float swing = uP[0].x;
  float time = uP[0].y;
  float seed = uP[0].z;
  Surf s = surfEmpty();

  // Faint shadow far below.
  float sh = sdCircle(p - vec2(0.06, 0.08), 0.22);
  over(s, vec3(0.0), vec3(0.0, 0.0, 1.0), vec3(0.0), 0.0, 8.0, (1.0 - smoothstep(-0.1, 0.06, sh)) * 0.3);

  float crown = abs(sdCircle(p, 0.1)) - 0.03;
  vec3 wood = vec3(0.34, 0.23, 0.13) * (0.8 + 0.4 * vnoise(p * 50.0));
  over(s, wood, normalize(vec3(p * 4.0, 1.0)), vec3(0.0), 0.3, 24.0, cover(crown, px));
  float knot = sdCircle(p, 0.03);
  over(s, wood * 0.6, vec3(0.0, 0.0, 1.0), vec3(0.0), 0.2, 20.0, cover(knot, px));

  for (int i = 0; i < 5 + LOOP_ZERO; i++) {
    float fi = float(i);
    float ang = fi * 1.2566 + seed * 6.28;
    float jitter = swing * (0.05 + 0.03 * sin(fi * 3.1)) * sin(time * 7.5 + fi * 1.9);
    vec2 c = vec2(cos(ang), sin(ang)) * (0.24 + fi * 0.012) + vec2(-sin(ang), cos(ang)) * jitter;
    float cord = sdSegment(p, vec2(cos(ang), sin(ang)) * 0.1, c) - 0.007;
    over(s, vec3(0.25, 0.22, 0.18), vec3(0.0, 0.0, 1.0), vec3(0.0), 0.1, 10.0, cover(cord, px) * 0.8);
    float tube = sdCircle(p - c, 0.058);
    float hollow = sdCircle(p - c, 0.028);
    vec2 tq = (p - c) / 0.058;
    vec3 tn = normalize(vec3(tq * 0.8, 1.0));
    vec3 bone = vec3(0.72, 0.7, 0.62) * (0.85 + 0.2 * vnoise((p - c) * 80.0));
    float ring = swing * (0.6 + 0.4 * sin(time * 20.0 + fi));
    over(s, bone, tn, ICE * ring * 0.9, 1.1, 60.0, cover(tube, px));
    over(s, vec3(0.03), vec3(0.0, 0.0, 1.0), ICE * ring * 0.4, 0.0, 8.0, cover(hollow, px));
    gHalo += ICE * exp(-length(p - c) * 18.0) * ring * 0.25;
  }
  outColor = finish(s, 0.6, vec3(0.0));
}
`;
