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
// uP[1]: song colour, turnable. uP[2].x: seconds since the dish last turned.
void main() {
  vec2 p = vLocal;
  float px = pxSize();
  float glowAmt = uP[0].x;
  float time = uP[0].y;
  vec3 VIOLET = uP[1].rgb;
  float turnable = uP[1].w;
  float turned = uP[2].x;
  Surf s = surfEmpty();

  float sh = sdCircle(p - vec2(-0.04, 0.05), 0.5);
  over(s, vec3(0.0), vec3(0.0, 0.0, 1.0), vec3(0.0), 0.0, 8.0, (1.0 - smoothstep(-0.2, 0.05, sh)) * 0.5);

  // Round stone plinth.
  float plinth = sdCircle(p, 0.3);
  vec3 pn = normalize(vec3(p * 2.0 * smoothstep(-0.08, 0.0, plinth), 1.0));
  over(s, vec3(0.2, 0.19, 0.2) * (0.75 + 0.4 * vnoise(p * 24.0)), pn, vec3(0.0), 0.1, 12.0, cover(plinth, px));
  if (turnable > 0.5) {
    // A turning dish sits in a notched bronze ring: four seats, a quarter step apart.
    float r = length(p);
    float ang = atan(p.y, p.x);
    float ringD = abs(r - 0.34) - 0.022;
    float notch = (1.0 - smoothstep(0.0, 0.05, abs(fract(ang / TAU * 4.0 + 0.5) - 0.5) * r * 4.0)) * (1.0 - smoothstep(0.0, 0.03, abs(r - 0.34)));
    vec3 ringCol = vec3(0.46, 0.32, 0.16) * (0.8 + 0.3 * vnoise(p * 40.0));
    float grind = exp(-turned * 3.0);
    over(s, mix(ringCol, vec3(0.05), notch * 0.8), normalize(vec3(p * 1.5, 1.0)), vec3(1.0, 0.62, 0.25) * grind * 0.5, 1.2, 60.0, cover(ringD, px));
  }

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

/**
 * The Mimic: a rooted mound of grey flesh ringed with small round mouths that
 * gape while it repeats what it heard. uP[0]: voice (1 while echoing), time, seed.
 * uP[1].rgb: the colour of what it last repeated.
 */
export const MIMIC_FS = /* glsl */ `${ENTITY_PRELUDE}
void main() {
  vec2 p = vLocal;
  float px = pxSize();
  float voice = uP[0].x;
  float time = uP[0].y;
  float seed = uP[0].z;
  vec3 tint = uP[1].rgb;
  Surf s = surfEmpty();

  float sh = sdCircle(p - vec2(0.04, 0.06), 0.46);
  over(s, vec3(0.0), vec3(0.0, 0.0, 1.0), vec3(0.0), 0.0, 8.0, (1.0 - smoothstep(-0.2, 0.06, sh)) * 0.55);

  // Root tendrils gripping the floor.
  for (int i = 0; i < 6 + LOOP_ZERO; i++) {
    float a = float(i) * 1.047 + seed * 6.28;
    vec2 d = vec2(cos(a), sin(a));
    vec2 bend = vec2(-d.y, d.x) * 0.06 * sin(a * 3.0);
    vec4 root = vec4(sdSegment(p, d * 0.2, d * 0.46 + bend), 0.0, 0.0, 0.0);
    over(s, vec3(0.2, 0.18, 0.2), vec3(0.0, 0.0, 1.0), vec3(0.0), 0.2, 12.0, cover(root.x - 0.025 * (1.0 - length(p) / 0.5), px));
  }

  // The mound breathes, and swells as it speaks.
  float swell = 1.0 + 0.04 * sin(time * 1.3 + seed * 5.0) + voice * 0.07;
  float lobes = 0.03 * sin(atan(p.y, p.x) * 5.0 + seed * 6.0);
  float body = sdCircle(p, (0.37 + lobes) * swell) + (vnoise(p * 9.0 + seed * 3.0) - 0.5) * 0.05;
  vec3 flesh = vec3(0.5, 0.44, 0.47) * (0.75 + 0.45 * vnoise(p * 22.0 + seed));
  flesh = mix(flesh, vec3(0.62, 0.42, 0.46), smoothstep(0.1, 0.35, length(p)) * 0.35);
  over(s, flesh, domeNormal(p, body, 0.37, 1.6), vec3(0.0), 0.6, 30.0, cover(body, px));

  // Mouths: a ring of lipped throats round a larger central one, gaping while it speaks.
  for (int i = 0; i < 7 + LOOP_ZERO; i++) {
    float a = float(i) * 1.0472 + seed * 3.0;
    vec2 c = i == 6 ? vec2(0.0) : vec2(cos(a), sin(a)) * 0.22;
    float base = i == 6 ? 0.045 : 0.028;
    float open = base + voice * 0.035 * (0.7 + 0.3 * sin(time * 30.0 + float(i) * 2.0));
    float lip = abs(sdCircle(p - c, open + 0.022)) - 0.014;
    float throat = sdCircle(p - c, open);
    over(s, flesh * 1.3, normalize(vec3((p - c) * 10.0, 1.0)), tint * 0.05, 0.9, 40.0, cover(lip, px));
    over(s, vec3(0.02), vec3(0.0, 0.0, 1.0), tint * (0.04 + voice * 1.2), 0.0, 8.0, cover(throat, px));
    gHalo += tint * exp(-length(p - c) * 26.0) * voice * 0.35;
  }
  outColor = finish(s, 0.6, vec3(0.0));
}
`;

/**
 * A speaking-tube mouth: a flared bronze horn set in the floor. Its twin is marked
 * with the same number of rivets. uP[0]: voice (1 just after it speaks), time, pair.
 * uP[1].rgb: the colour of what last came out.
 */
export const TUBE_FS = /* glsl */ `${ENTITY_PRELUDE}
void main() {
  vec2 p = vLocal;
  float px = pxSize();
  float voice = uP[0].x;
  float time = uP[0].y;
  float pair = uP[0].z;
  vec3 tint = uP[1].rgb;
  Surf s = surfEmpty();
  float r = length(p);
  float ang = atan(p.y, p.x);

  float sh = sdCircle(p - vec2(0.03, 0.05), 0.36);
  over(s, vec3(0.0), vec3(0.0, 0.0, 1.0), vec3(0.0), 0.0, 8.0, (1.0 - smoothstep(-0.15, 0.05, sh)) * 0.5);

  // The flare: bronze rings stepping down into the throat.
  float bell = sdCircle(p, 0.33);
  vec3 bronze = vec3(0.52, 0.35, 0.17) * (0.75 + 0.4 * vnoise(vec2(ang * 6.0, r * 40.0)));
  float step = fract(r * 14.0);
  vec3 n = normalize(vec3(-(p / max(r, 1e-4)) * (0.6 + 0.4 * step), 1.0));
  over(s, bronze * (0.7 + 0.3 * step), n, vec3(0.0), 1.4, 70.0, cover(bell, px));
  float lip = abs(r - 0.31) - 0.02;
  over(s, bronze * 1.3, normalize(vec3(p * 2.0, 1.0)), vec3(0.0), 1.6, 90.0, cover(lip, px));

  // Rivets on the lip: as many as its pair number, so twins can be matched.
  for (int i = 0; i < 4 + LOOP_ZERO; i++) {
    if (float(i) > pair) break;
    float a = float(i) * 0.5 - pair * 0.25;
    float rv = length(p - vec2(cos(a), sin(a)) * 0.31) - 0.018;
    over(s, bronze * 1.6, vec3(0.0, 0.0, 1.0), vec3(1.0, 0.7, 0.35) * 0.08, 2.0, 100.0, cover(rv, px));
  }

  float throat = sdCircle(p, 0.12);
  float pulse = voice * (0.7 + 0.3 * sin(time * 24.0 - r * 30.0));
  over(s, vec3(0.01), vec3(0.0, 0.0, 1.0), tint * pulse * 1.1, 0.0, 8.0, cover(throat, px));
  gHalo += tint * exp(-r * 8.0) * voice * 0.3;
  outColor = finish(s, 0.6, vec3(0.0));
}
`;
