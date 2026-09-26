/**
 * The Instrument's surfaces (Act III): floor keys inlaid with their note's
 * colour and mark, and panes of singing glass. Inserted into the scene shader
 * after its Tile, Hit and Mat definitions.
 */
export const INSTRUMENT = /* glsl */ `
/** The five tones A C D E G: vermillion, gold, green, sky, orchid (see palette.ts NOTE_COLORS). */
vec3 noteCol(int n) {
  return n == 0 ? vec3(1.0, 0.45, 0.22) : n == 1 ? vec3(1.0, 0.84, 0.28) : n == 2 ? vec3(0.24, 0.92, 0.6) : n == 3 ? vec3(0.42, 0.78, 1.0) : vec3(0.9, 0.5, 1.0);
}

float sdEquiTriangle(vec2 p, float r) {
  const float k = 1.7320508;
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}

/**
 * Each tone's mark, so no note is told by colour alone: A a triangle, C a ring,
 * D a diamond, E three bars, G a cross. q spans about [-0.5, 0.5]; returns coverage.
 */
float noteGlyph(vec2 q, int n) {
  float w = 0.045;
  float d;
  if (n == 0) d = abs(sdEquiTriangle(vec2(q.x, -q.y + 0.04), 0.3)) - w;
  else if (n == 1) d = abs(length(q) - 0.3) - w;
  else if (n == 2) d = abs((abs(q.x) + abs(q.y)) * 0.7071 - 0.26) - w;
  else if (n == 3) d = min(min(sdSegment(q, vec2(-0.28, -0.22), vec2(0.28, -0.22)), sdSegment(q, vec2(-0.28, 0.0), vec2(0.28, 0.0))), sdSegment(q, vec2(-0.28, 0.22), vec2(0.28, 0.22))) - w;
  else d = min(sdSegment(q, vec2(0.0, -0.32), vec2(0.0, 0.32)), sdSegment(q, vec2(-0.32, 0.0), vec2(0.32, 0.0))) - w;
  return 1.0 - smoothstep(0.0, 0.03, d);
}

/** A floor key: a polished disc of dark stone, ringed and marked in its note's colour. */
void keyInlay(inout Mat m, vec2 p, ivec2 tile, int note, float awake) {
  vec2 q = p - vec2(tile) - 0.5;
  float r = length(q);
  float disc = r - 0.38;
  float inside = 1.0 - smoothstep(-0.012, 0.012, disc);
  float ring = 1.0 - smoothstep(0.0, 0.022, abs(r - 0.33));
  float glyph = noteGlyph(q * 2.3, note) * step(r, 0.3);
  vec3 col = noteCol(note);
  m.albedo = mix(m.albedo, vec3(0.07, 0.07, 0.08), inside * 0.85);
  m.albedo = mix(m.albedo, col * 0.55, max(ring, glyph) * inside);
  m.n = normalize(mix(m.n, vec3(0.0, 0.0, 1.0), inside));
  m.spec = mix(m.spec, 1.1, inside);
  m.gloss = mix(m.gloss, 110.0, inside);
  m.emissive += col * (ring * 0.6 + glyph) * (0.05 + awake * 0.75);
  m.edge = max(m.edge, ring);
}

/** The k-th tone set in a mask of tones (k counts from 0). */
int nthTone(int mask, int k) {
  int seen = 0;
  for (int n = 0; n < 5 + LOOP_ZERO; n++) {
    if ((mask & (1 << n)) == 0) continue;
    if (seen == k) return n;
    seen++;
  }
  return 0;
}

int toneCount(int mask) {
  int c = 0;
  for (int n = 0; n < 5 + LOOP_ZERO; n++) c += (mask >> n) & 1;
  return c;
}

/**
 * Singing glass: dark and glossy, lit from within by its note's colour while
 * sound passes through it. A chord pane is banded, one band per note, and each
 * band blazes while its note rings on it.
 */
Mat glassMat(Hit h, float mem, float reveal) {
  Mat m;
  int mask = int(h.ti.open * 255.0 + 0.5);
  int ringing = h.ti.decor;
  vec2 p = h.pos.xy;
  vec2 f = p - vec2(h.tile);
  bool side = h.face == 1;
  // Bands run up a pane's faces, and diagonally across its top.
  float u = side ? (abs(h.n.x) > 0.5 ? f.y : f.x) : (f.x + f.y) * 0.5;
  int count = max(1, toneCount(mask));
  int k = min(count - 1, int(floor(fract(u) * float(count))));
  int note = nthTone(mask, k);
  vec3 col = noteCol(note);
  bool rings = (ringing & (1 << note)) != 0;
  // Internal fracture planes catch the light; ripples of old sound are frozen in the glass.
  vec3 v = voronoi(vec2(u * 3.0, side ? h.pos.z * 3.0 : dot(f, vec2(0.7, 1.3)) * 3.0) + vec2(h.tile) * 1.7);
  float facet = 1.0 - smoothstep(0.0, 0.035, v.y);
  // Thin seams between a chord pane's bands.
  float band = (1.0 - smoothstep(0.0, 0.03, 0.5 - abs(fract(u * float(count)) - 0.5))) * step(1.5, float(count));
  vec3 tilt = side ? vec3(0.0) : vec3((v.z - 0.5) * 0.25, (fract(v.z * 7.0) - 0.5) * 0.25, 0.0);
  m.n = normalize(h.n + tilt);
  // Bevelled rims catch the light like the edge of a lens.
  vec2 e2 = min(f, 1.0 - f);
  float rimD = side ? min(h.pos.z, GLASS_H - h.pos.z) * 2.0 : min(e2.x, e2.y);
  float rim = 1.0 - smoothstep(0.0, 0.06, rimD);
  m.albedo = col * (0.03 + rim * 0.12) + vec3(0.008);
  // Seen from above the top faces the light almost head-on: keep its highlight for the rims.
  m.spec = side ? 2.2 : 0.12 + rim * 1.4;
  m.gloss = 220.0;
  float depth = 0.5 + 0.5 * vnoise(vec2(u * 5.0, (side ? h.pos.z : f.y) * 5.0) + TIME * 0.05);
  float within = clamp(reveal, 0.0, 1.2) * (0.035 + facet * 0.4 + depth * depth * 0.07) + mem * mem * (0.012 + facet * 0.07);
  float hum = 0.7 + 0.3 * sin(TIME * 16.0 + u * 9.0);
  float blaze = rings ? hum * (0.45 + facet * 0.6 + depth * 0.25) : 0.0;
  m.emissive = col * (within + blaze + rim * 0.03 + band * 0.04);
  m.ao = 1.0;
  m.edge = max(max(facet, band), rim) * 0.6;
  return m;
}
`;
