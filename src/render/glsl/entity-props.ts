import { ENTITY_PRELUDE } from "./entity-common";

/**
 * Resonance crystal cluster. uP[0]: glow, time, seed, charging.
 * uP[1]: song colour (violet for a white crystal, its note's for a tuned one), prism.
 */
export const CRYSTAL_FS = /* glsl */ `${ENTITY_PRELUDE}
vec3 VIOLET;
float PRISM;

void shard(inout Surf s, vec2 p, float ang, float len, float wid, float px, float glowAmt, float idx) {
  vec2 d = vec2(cos(ang), sin(ang));
  vec2 q = vec2(dot(p, d), dot(p, vec2(-d.y, d.x)));
  float tipStart = len * 0.68;
  float w = wid * min(1.0, (len - q.x) / (len - tipStart));
  float sd = max(abs(q.y) - w, -q.x + 0.05);
  float a = cover(sd, px);
  if (a <= 0.0) return;
  float side = sign(q.y);
  float tip = step(tipStart, q.x);
  vec3 nl = normalize(vec3(tip * 0.9, side * (0.55 + tip * 0.2), 1.0));
  vec3 n = vec3(d * nl.x + vec2(-d.y, d.x) * nl.y, nl.z);
  float ridge = 1.0 - smoothstep(0.0, 0.012, abs(q.y));
  float edge = 1.0 - smoothstep(0.0, 0.02, -sd);
  float inner = 0.55 + 0.45 * vnoise(vec2(q.x * 14.0 + idx * 9.0, q.y * 30.0));
  vec3 body = mix(VIOLET * vec3(0.68, 0.62, 0.9), vec3(0.62, 0.64, 0.7), PRISM * 0.6);
  vec3 alb = body * mix(0.3, 0.7, side * 0.5 + 0.5) * inner;
  float depthGlow = 1.0 - clamp(q.x / len, 0.0, 1.0) * 0.6;
  // A prism splits the light: its facets flash every colour, its core sings one note.
  vec3 spectrum = 0.55 + 0.45 * cos(TAU * (q.x * 3.0 + idx * 0.21 + vec3(0.0, 0.33, 0.67)));
  vec3 edgeCol = mix(VIOLET, spectrum, PRISM * 0.8);
  vec3 emi = VIOLET * glowAmt * 0.55 * depthGlow + edgeCol * glowAmt * (edge * 0.6 + ridge * 0.5);
  emi += mix(vec3(0.8, 0.6, 1.0), spectrum, PRISM) * ridge * (glowAmt * 0.25 + PRISM * 0.05);
  over(s, alb, n, emi, 1.4, 90.0, a);
}

void main() {
  vec2 p = vLocal;
  float px = pxSize();
  float glowAmt = uP[0].x;
  float seed = uP[0].z;
  float charging = uP[0].w;
  VIOLET = uP[1].rgb;
  PRISM = uP[1].w;
  Surf s = surfEmpty();

  float sh = sdCircle(p - vec2(0.03, 0.05), 0.4);
  over(s, vec3(0.0), vec3(0.0, 0.0, 1.0), vec3(0.0), 0.0, 8.0, (1.0 - smoothstep(-0.15, 0.05, sh)) * 0.55);

  // Rocky base.
  float db = sdCircle(p, 0.2) + (vnoise(p * 18.0) - 0.5) * 0.05;
  vec3 bn = normalize(vec3(p * 3.5 * (1.0 - clamp(-db / 0.2, 0.0, 1.0)), 1.0));
  over(s, vec3(0.2, 0.18, 0.2) * (0.7 + 0.5 * vnoise(p * 30.0)), bn, vec3(0.0), 0.1, 10.0, cover(db, px));

  // Shards, longest first so shorter ones sit on top.
  for (int i = 0; i < 7 + LOOP_ZERO; i++) {
    float fi = float(i);
    float h = hash1(ivec2(int(seed * 997.0), i));
    float ang = fi * 2.39996 + h * 0.6;
    float len = mix(0.48, 0.24, fi / 6.0) + h * 0.06;
    float wid = mix(0.085, 0.05, fi / 6.0);
    shard(s, p, ang, len, wid, px, glowAmt + charging * 0.3, fi);
  }
  float r = length(p);
  gHalo = VIOLET * exp(-r * 5.0) * glowAmt * 0.3;
  outColor = finish(s, 0.6, vec3(0.0));
}
`;

/**
 * Bell in a stone frame. uP[0]: ring, time, wobble, timer fraction. uP[1].x: group.
 * uP[1].y: a sluice bell (a bronze spout, its rim running with water); uP[1].z: its basins flooded.
 */
export const BELL_FS = /* glsl */ `${ENTITY_PRELUDE}
const vec3 AMBER = vec3(1.0, 0.66, 0.26);
const vec3 WATER = vec3(0.35, 0.62, 1.0);

void main() {
  vec2 p = vLocal;
  float px = pxSize();
  float ring = uP[0].x;
  float time = uP[0].y;
  float wobble = uP[0].z;
  float timerFrac = uP[0].w;
  float group = uP[1].x;
  float sluice = uP[1].y;
  float flooded = uP[1].z;
  Surf s = surfEmpty();

  float sh = sdRoundBox(p - vec2(0.04, 0.05), vec2(0.5), 0.12);
  over(s, vec3(0.0), vec3(0.0, 0.0, 1.0), vec3(0.0), 0.0, 8.0, (1.0 - smoothstep(-0.1, 0.06, sh)) * 0.5);

  // Plinth with bevel.
  float plinth = sdRoundBox(p, vec2(0.46), 0.06);
  float bev = clamp(-plinth / 0.06, 0.0, 1.0);
  vec2 g = vec2(sdRoundBox(p + vec2(0.002, 0.0), vec2(0.46), 0.06) - plinth, sdRoundBox(p + vec2(0.0, 0.002), vec2(0.46), 0.06) - plinth);
  vec3 pn = normalize(vec3(-normalize(g + 1e-6) * (1.0 - bev) * 1.5, 1.0));
  vec3 stone = vec3(0.24, 0.23, 0.25) * (0.75 + 0.4 * vnoise(p * 14.0));
  over(s, stone, pn, vec3(0.0), 0.12, 16.0, cover(plinth, px));

  if (sluice > 0.5) {
    // A sluice bell: a bronze spout out of the plinth's side, and a channel round its rim
    // that shows water while its basins are full and dry sand while they are drained.
    float spout = sdRoundBox(p - vec2(0.52, 0.0), vec2(0.12, 0.07), 0.04);
    over(s, vec3(0.5, 0.34, 0.16), normalize(vec3(0.0, -p.y * 10.0, 1.0)), vec3(0.0), 1.4, 60.0, cover(spout, px));
    float lip = abs(sdRoundBox(p, vec2(0.41), 0.05)) - 0.018;
    vec3 channel = mix(vec3(0.3, 0.26, 0.2), WATER * 0.35, flooded);
    float shimmer = flooded * (0.5 + 0.5 * sin(time * 3.0 + (p.x + p.y) * 20.0));
    over(s, channel, vec3(0.0, 0.0, 1.0), WATER * (shimmer * 0.12 + ring * 0.6), mix(0.1, 1.6, flooded), 80.0, cover(lip, px));
  }

  // Group marker: small inlaid dots along the lower edge.
  for (int i = 0; i < 4 + LOOP_ZERO; i++) {
    if (float(i) >= group) break;
    vec2 c = vec2((float(i) - (group - 1.0) * 0.5) * 0.09, 0.38);
    float dd = sdCircle(p - c, 0.022);
    over(s, vec3(0.5, 0.35, 0.15), vec3(0.0, 0.0, 1.0), AMBER * (ring * 1.2 + timerFrac * 0.8), 1.0, 40.0, cover(dd, px));
  }

  // Corner posts.
  for (int i = 0; i < 4 + LOOP_ZERO; i++) {
    vec2 c = vec2(i == 0 || i == 3 ? -0.36 : 0.36, i < 2 ? -0.36 : 0.36);
    float dpost = sdRoundBox(p - c, vec2(0.075), 0.02);
    over(s, vec3(0.3, 0.29, 0.3) * (0.8 + 0.3 * vnoise(p * 20.0)), normalize(vec3(-(p - c) * 3.0, 1.0)), vec3(0.0), 0.15, 16.0, cover(dpost, px));
  }

  // Bronze bell, wobbling while it rings.
  float wob = sin(time * 38.0) * wobble * 0.025;
  vec2 bp = p * (1.0 + wob);
  float rb = length(bp);
  float bell = rb - 0.3;
  float dome = sqrt(max(0.0, 1.0 - pow(rb / 0.3, 2.0)));
  vec3 bnrm = normalize(vec3(bp / 0.3 * 1.3, dome + 0.15));
  float bands = smoothstep(0.012, 0.0, abs(rb - 0.27)) + smoothstep(0.01, 0.0, abs(rb - 0.2)) * 0.8 + smoothstep(0.01, 0.0, abs(rb - 0.12)) * 0.6;
  float patina = smoothstep(0.45, 0.8, vnoise(bp * 9.0) + vnoise(bp * 23.0) * 0.3);
  vec3 bronze = mix(vec3(0.58, 0.38, 0.17), vec3(0.2, 0.42, 0.36), patina * 0.7) * (1.0 - bands * 0.35);
  float glowBands = bands * (ring * 0.6 + timerFrac * 0.35);
  over(s, bronze, bnrm, AMBER * (glowBands + ring * 0.08 * dome), mix(1.8, 0.3, patina), 70.0, cover(bell, px));

  // Wooden crossbeam over the bell.
  float beam = sdBox(p, vec2(0.43, 0.05));
  float grain = vnoise(vec2(p.x * 40.0, p.y * 6.0));
  vec3 wood = vec3(0.26, 0.16, 0.09) * (0.7 + 0.5 * grain);
  vec3 wn = normalize(vec3(0.0, -p.y * 12.0, 1.0));
  over(s, wood, wn, vec3(0.0), 0.15, 14.0, cover(beam, px));

  // Timer arc for doors that close again.
  if (timerFrac > 0.0) {
    float r = length(p);
    float ang = fract(atan(p.x, -p.y) / TAU + 0.5);
    float arc = step(ang, timerFrac) * exp(-pow((r - 0.55) / 0.012, 2.0));
    gHalo += AMBER * arc * 1.4;
  }
  gHalo += AMBER * exp(-length(p) * 7.0) * ring * 0.12;
  outColor = finish(s, 0.6, vec3(0.0));
}
`;

/** Floating echo shard. uP[0]: glint, time, collect progress, height. */
export const SHARD_FS = /* glsl */ `${ENTITY_PRELUDE}
const vec3 ICE = vec3(0.55, 0.95, 1.0);
void main() {
  vec2 p = vLocal;
  float px = pxSize();
  float glint = uP[0].x;
  float time = uP[0].y;
  float collect = uP[0].z;
  Surf s = surfEmpty();
  float scale = 1.0 - collect * 0.8;
  vec2 q = p / max(scale, 0.05);
  float d = (abs(q.x) + abs(q.y) * 1.6) - 0.13;
  vec2 quadrant = sign(q + 1e-5);
  vec3 n = normalize(vec3(quadrant * vec2(0.8, 0.5), 1.0));
  float ridge = 1.0 - smoothstep(0.0, 0.01, min(abs(q.x), abs(q.y)));
  float pulse = 0.6 + 0.4 * sin(time * 3.0);
  vec3 emi = ICE * (glint * 1.1 * pulse + ridge * glint * 0.8);
  over(s, ICE * 0.5, n, emi * (1.0 - collect * 0.5), 2.0, 120.0, cover(d * scale, px));
  float r = length(p);
  gHalo = ICE * exp(-r * 10.0) * glint * 0.7 + ICE * exp(-r * 4.0) * glint * 0.12;
  outColor = finish(s, 0.9, vec3(0.0));
  outColor *= 1.0 - smoothstep(0.7, 1.0, collect);
}
`;

/** The Gate: a carved dais with a golden vortex. uP[0]: awaken, time, hum, active. */
export const EXIT_FS = /* glsl */ `${ENTITY_PRELUDE}
const vec3 GOLD = vec3(1.0, 0.78, 0.4);
void main() {
  vec2 p = vLocal;
  float px = pxSize();
  float awaken = uP[0].x;
  float time = uP[0].y;
  float hum = uP[0].z;
  Surf s = surfEmpty();
  float r = length(p);
  float a = atan(p.y, p.x);

  // Outer carved ring.
  float outer = r - 0.95;
  float ringBand = max(outer, 0.7 - r);
  float bev = clamp(min(-outer, r - 0.7) / 0.05, 0.0, 1.0);
  vec3 rn = normalize(vec3(normalize(p + 1e-5) * (r > 0.82 ? 1.0 : -1.0) * (1.0 - bev) * 1.2, 1.0));
  float seg = fract(a / TAU * 24.0);
  float glyph = step(0.2, seg) * step(seg, 0.8) * step(0.5, hash1(ivec2(int(floor(a / TAU * 24.0 + 24.0)), 3)));
  float glyphLine = glyph * (1.0 - smoothstep(0.004, 0.012, abs(r - 0.82 - 0.04 * sin(seg * PI))));
  vec3 stone = vec3(0.26, 0.24, 0.23) * (0.75 + 0.35 * vnoise(p * 12.0));
  stone = mix(stone, vec3(0.05), glyphLine * 0.8);
  over(s, stone, rn, GOLD * glyphLine * awaken * 1.3 * (0.7 + 0.3 * sin(time * 2.0 + a * 3.0)), 0.2, 20.0, cover(ringBand, px));

  // Gold inlay.
  float inlay = abs(r - 0.68) - 0.018;
  over(s, vec3(0.6, 0.42, 0.18), vec3(0.0, 0.0, 1.0), GOLD * awaken * 0.9, 2.0, 80.0, cover(inlay, px));

  // Inner well with a slow spiral, becoming a vortex when awake.
  float well = r - 0.66;
  float spiral = sin(a * 3.0 + r * 18.0 - time * (0.6 + awaken * 3.5));
  float swirl = fbm(vec2(a * 2.0 + time * 0.3 * (1.0 + awaken * 3.0), r * 6.0 - time * (0.5 + awaken * 2.0)), 3);
  vec3 wellCol = vec3(0.07, 0.065, 0.07) * (0.8 + 0.3 * spiral);
  float vortex = smoothstep(0.66, 0.0, r) * (0.5 + 0.5 * spiral) * (0.6 + swirl);
  vec3 wellEmi = GOLD * vortex * awaken * 1.6 + GOLD * exp(-r * 9.0) * awaken * 3.0;
  over(s, wellCol, vec3(0.0, 0.0, 1.0), wellEmi, 0.8, 60.0, cover(well, px));

  // Hum ring.
  float hr = 0.3 + (1.0 - hum) * 0.7;
  gHalo = GOLD * exp(-pow((r - hr) / 0.03, 2.0)) * hum * (0.3 + awaken) * 0.8;
  gHalo += GOLD * exp(-r * 2.5) * awaken * 0.18;
  outColor = finish(s, 1.0, vec3(0.0));
}
`;


/** A single pebble. uP[0]: height, resting, seed, lure glow (a lure stone calling). */
export const STONE_FS = /* glsl */ `${ENTITY_PRELUDE}
void pebble(inout Surf s, vec2 p, vec2 c, vec2 r, float seed, float px) {
  vec2 q = p - c;
  float d = sdEllipse(q, r) + (vnoise(q * 40.0 + seed * 10.0) - 0.5) * 0.012;
  float t = clamp(-d / min(r.x, r.y), 0.0, 1.0);
  vec3 n = normalize(vec3(q / (r * r) * 0.02 * (1.0 - t) * 6.0, 1.0));
  vec3 alb = mix(vec3(0.3, 0.29, 0.3), vec3(0.45, 0.42, 0.38), hash1(ivec2(int(seed * 100.0), 1)));
  alb *= 0.75 + 0.4 * vnoise(q * 60.0 + seed * 3.0);
  over(s, alb, n, vec3(0.0), 0.35, 30.0, cover(d, px));
}
void main() {
  vec2 p = vLocal;
  float px = pxSize();
  float h = uP[0].x;
  Surf s = surfEmpty();
  if (uP[0].y > 0.5) {
    float sh = sdEllipse(p - vec2(0.012, 0.015), vec2(0.1, 0.085));
    over(s, vec3(0.0), vec3(0.0, 0.0, 1.0), vec3(0.0), 0.0, 8.0, (1.0 - smoothstep(-0.04, 0.03, sh)) * 0.5);
  }
  pebble(s, p, vec2(0.0), vec2(0.075, 0.06), uP[0].z, px);
  float lure = uP[0].w;
  if (lure > 0.0) {
    vec3 warm = vec3(0.95, 0.95, 0.8);
    s.emi += warm * lure * 0.9 * (1.0 - smoothstep(0.0, 0.08, length(p)));
    gHalo = warm * exp(-length(p) * 18.0) * lure * 0.9;
  }
  outColor = finish(s, 0.7, vec3(0.0));
}
`;

/** Small cairn of pebbles. uP[0]: count, seed. */
export const PILE_FS = /* glsl */ `${ENTITY_PRELUDE}
void pebble(inout Surf s, vec2 p, vec2 c, vec2 r, float seed, float px) {
  vec2 q = p - c;
  float d = sdEllipse(q, r) + (vnoise(q * 40.0 + seed * 10.0) - 0.5) * 0.012;
  float t = clamp(-d / min(r.x, r.y), 0.0, 1.0);
  vec3 n = normalize(vec3(q / (r * r) * 0.02 * (1.0 - t) * 6.0, 1.0));
  vec3 alb = mix(vec3(0.3, 0.29, 0.3), vec3(0.45, 0.42, 0.38), hash1(ivec2(int(seed * 100.0), 1)));
  alb *= 0.75 + 0.4 * vnoise(q * 60.0 + seed * 3.0);
  over(s, alb, n, vec3(0.0), 0.35, 30.0, cover(d, px));
}
void main() {
  vec2 p = vLocal;
  float px = pxSize();
  float count = uP[0].x;
  float seed = uP[0].y;
  Surf s = surfEmpty();
  float sh = sdCircle(p - vec2(0.02, 0.03), 0.27);
  over(s, vec3(0.0), vec3(0.0, 0.0, 1.0), vec3(0.0), 0.0, 8.0, (1.0 - smoothstep(-0.1, 0.05, sh)) * 0.5);
  // Base gravel that stays after the pile is taken.
  for (int i = 0; i < 6 + LOOP_ZERO; i++) {
    float a = float(i) * 1.1 + seed;
    vec2 c = vec2(cos(a), sin(a)) * (0.12 + 0.08 * hash1(ivec2(i, 9)));
    pebble(s, p, c, vec2(0.035, 0.028), seed + float(i), px);
  }
  for (int i = 0; i < 4 + LOOP_ZERO; i++) {
    if (float(i) >= count * 2.0) break;
    float a = float(i) * 2.2 + seed * 3.0;
    vec2 c = vec2(cos(a), sin(a)) * 0.07 * float(i > 0);
    pebble(s, p, c, vec2(0.08, 0.065) * (1.0 - float(i) * 0.1), seed * 7.0 + float(i), px);
  }
  outColor = finish(s, 0.7, vec3(0.0));
}
`;

/** Bioluminescent fungi cluster. uP[0]: glow, time, seed. */
export const MUSHROOM_FS = /* glsl */ `${ENTITY_PRELUDE}
const vec3 BIO = vec3(0.25, 1.0, 0.72);
void main() {
  vec2 p = vLocal;
  float px = pxSize();
  float glowAmt = uP[0].x;
  float time = uP[0].y;
  float seed = uP[0].z;
  Surf s = surfEmpty();
  vec3 halo = vec3(0.0);
  for (int i = 0; i < 7 + LOOP_ZERO; i++) {
    float h1 = hash1(ivec2(int(seed * 1000.0), i));
    float h2 = hash1(ivec2(i, int(seed * 777.0)));
    vec2 c = (vec2(h1, h2) - 0.5) * 0.46;
    float r = 0.03 + 0.045 * hash1(ivec2(i * 3, int(seed * 55.0)));
    vec2 q = p - c;
    float d = length(q) - r;
    // Stem shadow and the glowing gill fringe peeking out under the cap.
    float sh = length(q - vec2(0.012, 0.018)) - r * 1.15;
    over(s, vec3(0.0), vec3(0.0, 0.0, 1.0), vec3(0.0), 0.0, 8.0, (1.0 - smoothstep(-0.02, 0.02, sh)) * 0.45);
    float flick = 0.8 + 0.2 * sin(time * 3.0 + float(i) * 2.0);
    // Domed cap: bright crown, darker rim, pale speckles that glow when the fungus is excited.
    float t = clamp(-d / r, 0.0, 1.0);
    float crown = sqrt(t);
    vec3 n = normalize(vec3(q / r * (1.0 - crown) * 2.2, 1.0));
    float spots = step(0.68, vnoise(q * 70.0 + float(i) * 7.0)) * smoothstep(0.15, 0.6, t);
    vec3 cap = mix(vec3(0.16, 0.13, 0.12), vec3(0.5, 0.44, 0.36), crown) * (0.85 + 0.3 * vnoise(q * 40.0));
    cap = mix(cap, vec3(0.78, 0.84, 0.76), spots * 0.8);
    vec3 capGlow = BIO * glowAmt * flick * (spots * 0.9 + crown * 0.18);
    over(s, cap, n, capGlow, 0.5, 40.0, cover(d, px));
    // Light spilling from the gills underneath: soft, never a crisp ring.
    halo += BIO * exp(-max(d, 0.0) * 38.0) * (1.0 - cover(d, px)) * glowAmt * flick * 0.35;
  }
  gHalo = halo;
  outColor = finish(s, 0.7, vec3(0.0));
}
`;

/** Puddle under a ceiling drip. uP[0]: time, seconds since last drop. */
export const PUDDLE_FS = /* glsl */ `${ENTITY_PRELUDE}
void main() {
  vec2 p = vLocal;
  float px = pxSize();
  float since = uP[0].y;
  Surf s = surfEmpty();
  float d = sdEllipse(p, vec2(0.34, 0.26)) + (vnoise(p * 7.0) - 0.5) * 0.1;
  float r = length(p);
  float rip = sin((r - since * 0.5) * 60.0) * exp(-since * 2.2) * exp(-abs(r - since * 0.5) * 12.0);
  vec3 n = normalize(vec3(normalize(p + 1e-5) * rip * 0.5, 1.0));
  over(s, vec3(0.04, 0.06, 0.08), n, vec3(0.0), 1.8, 110.0, cover(d, px) * 0.55);
  outColor = finish(s, 1.2, vec3(0.0));
}
`;
