import { ENTITY_PRELUDE } from "./entity-common";

/**
 * The hunters. One six-legged body plan with per-creature variants:
 *   0 Warden   — bat-like listening membranes that flare blood-red
 *   1 Chorus   — smaller pack hunter, amber membranes
 *   2 Sentinel — bone-white, crown permanently flared, pale glow
 *   3 Stalker  — near-black with violet membranes
 *   4 Tremor   — deaf: no membranes, a broad armoured dome and ground-feeling whiskers
 *   5 Metronome — brass-banded, no membranes: a pendulum crest that swings to its beat
 *   6 Conductor — tall and pale, a cloak of membranes and a long baton of bone
 *
 * uP[0]: frill (0 folded .. 1 flared), alert, time, moving
 * uP[1]: mandible open, variant, scale, beat clock (beats kept, with the fraction of the next)
 * uExtra[2i] = (hip.xy, knee.xy), uExtra[2i+1] = (foot.xy, lift, 0) for 6 legs
 */
export const WARDEN_FS = /* glsl */ `${ENTITY_PRELUDE}
vec3 CHITIN;
vec3 BONE;
vec3 CREVICE;
vec3 GLOW;
vec3 MEM_DARK;
vec3 MEM_LIGHT;
float SCALE;

void choosePalette(float variant) {
  if (variant < 0.5) {
    CHITIN = vec3(0.24, 0.225, 0.23); BONE = vec3(0.6, 0.56, 0.5); CREVICE = vec3(0.12, 0.015, 0.025);
    GLOW = vec3(1.0, 0.1, 0.14); MEM_DARK = vec3(0.09, 0.012, 0.02); MEM_LIGHT = vec3(0.2, 0.03, 0.045);
  } else if (variant < 1.5) {
    CHITIN = vec3(0.3, 0.24, 0.2); BONE = vec3(0.68, 0.58, 0.44); CREVICE = vec3(0.16, 0.06, 0.012);
    GLOW = vec3(1.0, 0.46, 0.12); MEM_DARK = vec3(0.15, 0.055, 0.01); MEM_LIGHT = vec3(0.34, 0.14, 0.03);
  } else if (variant < 2.5) {
    CHITIN = vec3(0.44, 0.45, 0.47); BONE = vec3(0.8, 0.82, 0.82); CREVICE = vec3(0.08, 0.12, 0.16);
    GLOW = vec3(0.6, 0.9, 1.0); MEM_DARK = vec3(0.1, 0.15, 0.2); MEM_LIGHT = vec3(0.24, 0.36, 0.42);
  } else if (variant < 3.5) {
    CHITIN = vec3(0.12, 0.1, 0.15); BONE = vec3(0.36, 0.3, 0.42); CREVICE = vec3(0.07, 0.02, 0.12);
    GLOW = vec3(0.62, 0.22, 1.0); MEM_DARK = vec3(0.06, 0.02, 0.1); MEM_LIGHT = vec3(0.15, 0.05, 0.24);
  } else if (variant < 4.5) {
    CHITIN = vec3(0.36, 0.23, 0.12); BONE = vec3(0.64, 0.52, 0.34); CREVICE = vec3(0.14, 0.07, 0.02);
    GLOW = vec3(0.9, 0.55, 0.22); MEM_DARK = vec3(0.0); MEM_LIGHT = vec3(0.0);
  } else if (variant < 5.5) {
    CHITIN = vec3(0.3, 0.25, 0.15); BONE = vec3(0.82, 0.7, 0.44); CREVICE = vec3(0.12, 0.08, 0.02);
    GLOW = vec3(1.0, 0.78, 0.35); MEM_DARK = vec3(0.0); MEM_LIGHT = vec3(0.0);
  } else {
    CHITIN = vec3(0.14, 0.13, 0.2); BONE = vec3(0.86, 0.84, 0.92); CREVICE = vec3(0.05, 0.04, 0.1);
    GLOW = vec3(0.95, 0.35, 0.75); MEM_DARK = vec3(0.08, 0.03, 0.1); MEM_LIGHT = vec3(0.24, 0.09, 0.28);
  }
}

vec4 capsule(vec2 p, vec2 a, vec2 b, float ra, float rb) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  vec2 c = a + ba * h;
  return vec4(length(p - c) - mix(ra, rb, h), h, c);
}

vec3 tubeNormal(vec2 p, vec2 c, float r) {
  vec2 d = (p - c) / max(r, 1e-4);
  return normalize(vec3(d * 1.2, sqrt(max(0.05, 1.0 - dot(d, d)))));
}

vec3 ellipseNormal(vec2 q, vec2 r, float steep) {
  vec2 g = q / (r * r);
  float k = clamp(length(q / r), 0.0, 1.0);
  return normalize(vec3(normalize(g + 1e-6) * pow(k, 2.0) * steep, 1.0));
}

void drawLeg(inout Surf s, vec2 p, int i, float px, float alertGlow, float thick) {
  vec4 a = uExtra[i * 2] / vec4(SCALE);
  vec4 b = uExtra[i * 2 + 1] / vec4(SCALE, SCALE, 1.0, 1.0);
  vec4 thigh = capsule(p, a.xy, a.zw, 0.06 * thick, 0.045 * thick);
  vec4 shin = capsule(p, a.zw, b.xy, 0.042 * thick, 0.01 * thick);
  float seg = smoothstep(0.4, 0.5, fract(thigh.y * 2.0));
  over(s, mix(CHITIN, BONE * 0.6, seg * 0.4), tubeNormal(p, thigh.zw, 0.05 * thick), vec3(0.0), 0.7, 40.0, cover(thigh.x, px));
  float band = smoothstep(0.42, 0.5, fract(shin.y * 3.0));
  vec3 shinCol = mix(CHITIN * 1.2, BONE * 0.75, band * 0.6 + smoothstep(0.7, 1.0, shin.y) * 0.5);
  over(s, shinCol, tubeNormal(p, shin.zw, 0.03 * thick), GLOW * alertGlow * 0.08 * (1.0 - shin.y), 0.7, 40.0, cover(shin.x, px));
  vec2 kd = normalize(a.zw - a.xy) * 0.07;
  vec4 spur = capsule(p, a.zw, a.zw + kd + vec2(-kd.y, kd.x) * 0.3, 0.03 * thick, 0.004);
  over(s, BONE * 0.8, tubeNormal(p, spur.zw, 0.025), vec3(0.0), 1.0, 50.0, cover(spur.x, px));
}

void drawMembrane(inout Surf s, vec2 p, float side, float frill, float alertGlow, float time, float px) {
  vec2 pivot = vec2(0.2, side * 0.09);
  vec2 v = p - pivot;
  float r = length(v);
  float th = atan(v.y * side, v.x);
  float th0 = mix(2.35, 0.75, frill);
  float th1 = mix(2.95, 2.7, frill);
  float span = th1 - th0;
  float k = clamp((th - th0) / span, 0.0, 1.0) * 3.0;
  float reach = mix(0.32, 0.66, frill);
  float scallop = 0.72 + 0.28 * pow(abs(cos(PI * k)), 0.6);
  float R = reach * scallop * (1.0 - 0.12 * k / 3.0);
  float inside = step(th0, th) * step(th, th1);
  float dMem = max(r - R, 0.04 - r);
  dMem = max(dMem, -min(th - th0, th1 - th) * r);
  float a = cover(dMem, px) * inside;
  float veinA = 1.0 - smoothstep(0.0, 0.06, abs(fract(k * 2.0) - 0.5) - 0.38);
  float capil = smoothstep(0.6, 0.95, vnoise(vec2(th * 34.0, r * 26.0)));
  float thin = smoothstep(0.0, 1.0, r / max(R, 1e-3));
  vec3 mem = mix(MEM_DARK, MEM_LIGHT, thin);
  float throb = 0.55 + 0.45 * sin(time * 9.0 - r * 18.0);
  vec3 emi = GLOW * alertGlow * throb * (0.12 + veinA * 0.5 + capil * 0.35) * (0.4 + thin);
  vec3 n = normalize(vec3(normalize(v + 1e-5) * 0.3 * sin(k * PI * 2.0), 1.0));
  over(s, mem, n, emi, 0.9, 50.0, a * 0.96);
  for (int i = 0; i <= 3 + LOOP_ZERO; i++) {
    float ti = mix(th0, th1, float(i) / 3.0);
    vec2 dir = vec2(cos(ti), sin(ti) * side);
    float len = reach * (1.0 - 0.12 * float(i) / 3.0) * 1.04;
    vec4 bone = capsule(p, pivot + dir * 0.03, pivot + dir * len, 0.02, 0.005);
    over(s, BONE * 0.9, tubeNormal(p, bone.zw, 0.018), GLOW * alertGlow * 0.12, 1.0, 50.0, cover(bone.x, px));
  }
}

/** Tremor: two long whiskers sweeping forward to feel the floor. */
void drawWhiskers(inout Surf s, vec2 p, float time, float alertGlow, float px) {
  for (int k = 0; k < 2 + LOOP_ZERO; k++) {
    float side = k == 0 ? -1.0 : 1.0;
    float sway = sin(time * 3.1 + side) * 0.04;
    vec2 a = vec2(0.36, side * 0.05);
    vec2 b = vec2(0.62, side * (0.2 + sway));
    vec2 c = vec2(0.8, side * (0.34 + sway * 1.5));
    vec4 w1 = capsule(p, a, b, 0.012, 0.008);
    vec4 w2 = capsule(p, b, c, 0.008, 0.004);
    over(s, BONE, tubeNormal(p, w1.zw, 0.012), vec3(0.0), 0.8, 40.0, cover(w1.x, px));
    over(s, BONE, tubeNormal(p, w2.zw, 0.008), GLOW * alertGlow * 0.4, 0.8, 40.0, cover(w2.x, px));
    float tipD = length(p - c) - 0.018;
    over(s, BONE * 1.1, vec3(0.0, 0.0, 1.0), GLOW * (0.05 + alertGlow * 0.8), 0.6, 30.0, cover(tipD, px));
  }
}

/** Metronome: a weighted pendulum rising from its back, swinging from side to side on the beat. */
void drawPendulum(inout Surf s, vec2 p, float beat, float alertGlow, float px) {
  float swing = 0.6 * cos(PI * beat);
  vec2 pivot = vec2(-0.3, 0.0);
  vec2 dir = vec2(-cos(swing), sin(swing));
  vec2 tip = pivot + dir * 0.55;
  vec4 rod = capsule(p, pivot, tip, 0.022, 0.014);
  over(s, BONE * 0.9, tubeNormal(p, rod.zw, 0.02), vec3(0.0), 1.2, 70.0, cover(rod.x, px));
  float strike = pow(abs(cos(PI * beat)), 12.0);
  float bob = length(p - (pivot + dir * 0.4)) - 0.07;
  over(s, BONE, normalize(vec3((p - (pivot + dir * 0.4)) * 8.0, 1.0)), GLOW * (0.15 + strike * 0.9 + alertGlow * 0.4), 1.4, 80.0, cover(bob, px));
  gHalo += GLOW * exp(-length(p - (pivot + dir * 0.4)) * 14.0) * strike * 0.5;
  float pin = length(p - pivot) - 0.04;
  over(s, CREVICE, vec3(0.0, 0.0, 1.0), GLOW * 0.3, 0.6, 30.0, cover(pin, px));
}

/** Conductor: a long baton of bone held forward, its tip glowing with the last discord it heard. */
void drawBaton(inout Surf s, vec2 p, float time, float alertGlow, float px) {
  float sway = sin(time * 1.3) * 0.12;
  vec2 a = vec2(0.3, -0.1);
  vec2 b = vec2(0.95, -0.28 + sway);
  vec4 baton = capsule(p, a, b, 0.018, 0.006);
  over(s, BONE, tubeNormal(p, baton.zw, 0.016), GLOW * alertGlow * 0.3 * baton.y, 1.2, 70.0, cover(baton.x, px));
  float tipD = length(p - b) - 0.025;
  over(s, BONE, vec3(0.0, 0.0, 1.0), GLOW * (0.25 + alertGlow), 0.8, 40.0, cover(tipD, px));
  gHalo += GLOW * exp(-length(p - b) * 30.0) * (0.2 + alertGlow) * 0.5;
}

void main() {
  float variant = uP[1].y;
  choosePalette(variant);
  bool tremor = variant > 3.5 && variant < 4.5;
  bool metronome = variant > 4.5 && variant < 5.5;
  bool conductor = variant > 5.5;
  bool sentinel = variant > 1.5 && variant < 2.5;
  SCALE = 1.1 * max(uP[1].z, 0.5);
  vec2 p = vLocal / SCALE;
  float px = pxSize() / SCALE;
  float frill = sentinel ? max(uP[0].x, 0.9) : uP[0].x;
  float alertGlow = uP[0].y;
  float time = uP[0].z;
  float mandible = uP[1].x;
  Surf s = surfEmpty();

  float sh = sdEllipse(p - vec2(-0.06, 0.06), tremor ? vec2(0.85, 0.7) : vec2(0.8, 0.55));
  over(s, vec3(0.0), vec3(0.0, 0.0, 1.0), vec3(0.0), 0.0, 8.0, (1.0 - smoothstep(-0.35, 0.1, sh)) * 0.55);

  for (int i = 0; i < 6 + LOOP_ZERO; i++) drawLeg(s, p, i, px, alertGlow, tremor ? 1.45 : 1.0);

  // Abdomen: overlapping armour plates with a spined keel (a broad dome on a tremor).
  vec2 qa = p - (tremor ? vec2(-0.26, 0.0) : vec2(-0.42, 0.0));
  float breath = 1.0 + 0.03 * sin(time * 1.7);
  vec2 ra = (tremor ? vec2(0.44, 0.36) : vec2(0.34, 0.22)) * breath;
  float da = sdEllipse(qa, ra);
  float u = qa.x / ra.x;
  // A tremor's dome is banded crosswise like a pill bug's; a hunter's abdomen overlaps in scales.
  float plate = tremor ? fract(u * 3.6 + 0.5 + (qa.y * qa.y) * 4.0) : fract(u * 2.6 + 0.4 + (qa.y * qa.y) * 6.0);
  float seam = 1.0 - smoothstep(0.0, 0.14, plate);
  vec3 an = ellipseNormal(qa, ra, tremor ? 2.2 : 1.5);
  an.x -= (1.0 - plate) * (tremor ? 0.8 : 0.6);
  vec3 abd = CHITIN * (0.8 + 0.5 * vnoise(qa * 22.0));
  abd = mix(abd, BONE * 0.7, smoothstep(0.75, 1.0, plate) * 0.5);
  abd = mix(abd, CREVICE, seam);
  over(s, abd, normalize(an), GLOW * seam * alertGlow * 0.5, 0.9, 50.0, cover(da, px));
  if (!tremor) {
    for (int i = 0; i < 4 + LOOP_ZERO; i++) {
      vec2 c = vec2(-0.66 + float(i) * 0.12, 0.0);
      vec2 q = p - c;
      float spike = max(abs(q.y) - 0.03 * (1.0 - clamp((q.x + 0.04) / 0.08, 0.0, 1.0)), abs(q.x) - 0.04);
      over(s, BONE, normalize(vec3(0.0, sign(q.y) * 0.8, 1.0)), vec3(0.0), 1.2, 60.0, cover(spike, px));
    }
  }

  // Thorax.
  vec2 qt = p - vec2(-0.04, 0.0);
  vec2 rt = tremor ? vec2(0.24, 0.22) : vec2(0.2, 0.16);
  float dt = sdEllipse(qt, rt);
  vec3 thor = CHITIN * (0.85 + 0.4 * vnoise(qt * 28.0));
  float ridge = 1.0 - smoothstep(0.0, 0.025, abs(qt.y));
  thor = mix(thor, BONE * 0.8, ridge * 0.6);
  over(s, thor, ellipseNormal(qt, rt, 1.6), vec3(0.0), 0.9, 50.0, cover(dt, px));

  if (tremor) {
    drawWhiskers(s, p, time, alertGlow, px);
  } else if (metronome) {
    drawPendulum(s, p, uP[1].w, alertGlow, px);
  } else {
    float cloak = conductor ? 0.35 + frill * 0.65 : frill;
    drawMembrane(s, p, -1.0, cloak, alertGlow, time, px);
    drawMembrane(s, p, 1.0, cloak, alertGlow, time, px);
    if (conductor) drawBaton(s, p, time, alertGlow, px);
  }

  // Mandibles.
  for (int k = 0; k < 2 + LOOP_ZERO; k++) {
    float side = k == 0 ? -1.0 : 1.0;
    float open = mandible * 0.4;
    vec2 base = vec2(0.36, side * 0.06);
    vec2 mid = base + vec2(0.11, side * (0.04 + open * 0.2));
    vec2 tip = mid + vec2(0.08, -side * (0.06 - open * 0.1));
    vec4 m1 = capsule(p, base, mid, 0.03, 0.02);
    vec4 m2 = capsule(p, mid, tip, 0.02, 0.003);
    over(s, CHITIN * 1.3, tubeNormal(p, m1.zw, 0.028), vec3(0.0), 1.0, 60.0, cover(m1.x, px));
    over(s, BONE * 0.85, tubeNormal(p, m2.zw, 0.02), GLOW * alertGlow * 0.15, 1.4, 70.0, cover(m2.x, px));
  }

  // Eyeless, elongated skull with a pale brow ridge and sensory pits.
  vec2 qh = p - vec2(0.26, 0.0);
  vec2 rh = vec2(0.16, 0.11);
  float dh = sdEllipse(qh, rh);
  float brow = 1.0 - smoothstep(0.0, 0.03, abs(length(qh * vec2(0.8, 1.2)) - 0.08));
  vec3 skull = mix(CHITIN * 1.1, BONE * 0.9, 0.35 + brow * 0.5) * (0.85 + 0.3 * vnoise(qh * 40.0));
  over(s, skull, ellipseNormal(qh, rh, 1.7), vec3(0.0), 1.0, 60.0, cover(dh, px));
  for (int i = 0; i < 6 + LOOP_ZERO; i++) {
    float side = (i & 1) == 0 ? -1.0 : 1.0;
    float row = float(i / 2);
    vec2 c = vec2(0.3 + row * 0.045, side * (0.05 - row * 0.012));
    float dp = length(p - c) - (0.015 - row * 0.003);
    float calm = sentinel ? 0.25 : 0.0;
    over(s, CREVICE * 0.3, vec3(0.0, 0.0, 1.0), GLOW * (alertGlow + calm) * 1.2, 0.2, 20.0, cover(dp, px));
    gHalo += GLOW * exp(-length(p - c) * 70.0) * (alertGlow + calm) * 0.4;
  }

  outColor = finish(s, 0.6, vec3(0.0));
}
`;
