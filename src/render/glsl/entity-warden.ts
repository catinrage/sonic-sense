import { ENTITY_PRELUDE } from "./entity-common";

/**
 * Warden: a blind, six-legged hunter. Two huge bat-like listening membranes
 * flare open and glow blood-red when it hears something.
 *
 * uP[0]: frill (0 folded .. 1 flared), alert, time, moving
 * uP[1]: mandible open
 * uExtra[2i] = (hip.xy, knee.xy), uExtra[2i+1] = (foot.xy, lift, 0) for 6 legs
 */
export const WARDEN_FS = /* glsl */ `${ENTITY_PRELUDE}
const vec3 CHITIN = vec3(0.24, 0.225, 0.23);
const vec3 BONE = vec3(0.6, 0.56, 0.5);
const vec3 CREVICE = vec3(0.12, 0.015, 0.025);
const vec3 BLOOD = vec3(1.0, 0.1, 0.14);
const float SCALE = 1.1;

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

void drawLeg(inout Surf s, vec2 p, int i, float px, float alertGlow) {
  vec4 a = uExtra[i * 2] / vec4(SCALE);
  vec4 b = uExtra[i * 2 + 1] / vec4(SCALE, SCALE, 1.0, 1.0);
  vec4 thigh = capsule(p, a.xy, a.zw, 0.06, 0.045);
  vec4 shin = capsule(p, a.zw, b.xy, 0.042, 0.01);
  float seg = smoothstep(0.4, 0.5, fract(thigh.y * 2.0));
  over(s, mix(CHITIN, BONE * 0.6, seg * 0.4), tubeNormal(p, thigh.zw, 0.05), vec3(0.0), 0.7, 40.0, cover(thigh.x, px));
  float band = smoothstep(0.42, 0.5, fract(shin.y * 3.0));
  vec3 shinCol = mix(CHITIN * 1.2, BONE * 0.75, band * 0.6 + smoothstep(0.7, 1.0, shin.y) * 0.5);
  over(s, shinCol, tubeNormal(p, shin.zw, 0.03), BLOOD * alertGlow * 0.08 * (1.0 - shin.y), 0.7, 40.0, cover(shin.x, px));
  // Knee spur.
  vec2 kd = normalize(a.zw - a.xy) * 0.07;
  vec4 spur = capsule(p, a.zw, a.zw + kd + vec2(-kd.y, kd.x) * 0.3, 0.03, 0.004);
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
  vec3 mem = mix(vec3(0.09, 0.012, 0.02), vec3(0.2, 0.03, 0.045), thin);
  float throb = 0.55 + 0.45 * sin(time * 9.0 - r * 18.0);
  vec3 emi = BLOOD * alertGlow * throb * (0.12 + veinA * 0.5 + capil * 0.35) * (0.4 + thin);
  vec3 n = normalize(vec3(normalize(v + 1e-5) * 0.3 * sin(k * PI * 2.0), 1.0));
  over(s, mem, n, emi, 0.9, 50.0, a * 0.96);
  for (int i = 0; i <= 3 + LOOP_ZERO; i++) {
    float ti = mix(th0, th1, float(i) / 3.0);
    vec2 dir = vec2(cos(ti), sin(ti) * side);
    float len = reach * (1.0 - 0.12 * float(i) / 3.0) * 1.04;
    vec4 bone = capsule(p, pivot + dir * 0.03, pivot + dir * len, 0.02, 0.005);
    over(s, BONE * 0.9, tubeNormal(p, bone.zw, 0.018), BLOOD * alertGlow * 0.12, 1.0, 50.0, cover(bone.x, px));
  }
}

void main() {
  vec2 p = vLocal / SCALE;
  float px = pxSize() / SCALE;
  float frill = uP[0].x;
  float alertGlow = uP[0].y;
  float time = uP[0].z;
  float mandible = uP[1].x;
  Surf s = surfEmpty();

  float sh = sdEllipse(p - vec2(-0.06, 0.06), vec2(0.8, 0.55));
  over(s, vec3(0.0), vec3(0.0, 0.0, 1.0), vec3(0.0), 0.0, 8.0, (1.0 - smoothstep(-0.35, 0.1, sh)) * 0.55);

  for (int i = 0; i < 6 + LOOP_ZERO; i++) drawLeg(s, p, i, px, alertGlow);

  // Abdomen: overlapping armour plates with a spined keel.
  vec2 qa = p - vec2(-0.42, 0.0);
  float breath = 1.0 + 0.03 * sin(time * 1.7);
  vec2 ra = vec2(0.34, 0.22) * breath;
  float da = sdEllipse(qa, ra);
  float u = qa.x / ra.x;
  float plate = fract(u * 2.6 + 0.4 + (qa.y * qa.y) * 6.0);
  float seam = 1.0 - smoothstep(0.0, 0.14, plate);
  vec3 an = ellipseNormal(qa, ra, 1.5);
  an.x -= (1.0 - plate) * 0.6;
  vec3 abd = CHITIN * (0.8 + 0.5 * vnoise(qa * 22.0));
  abd = mix(abd, BONE * 0.7, smoothstep(0.75, 1.0, plate) * 0.5);
  abd = mix(abd, CREVICE, seam);
  over(s, abd, normalize(an), BLOOD * seam * alertGlow * 0.5, 0.9, 50.0, cover(da, px));
  for (int i = 0; i < 4 + LOOP_ZERO; i++) {
    vec2 c = vec2(-0.66 + float(i) * 0.12, 0.0);
    vec2 q = p - c;
    float spike = max(abs(q.y) - 0.03 * (1.0 - clamp((q.x + 0.04) / 0.08, 0.0, 1.0)), abs(q.x) - 0.04);
    over(s, BONE, normalize(vec3(0.0, sign(q.y) * 0.8, 1.0)), vec3(0.0), 1.2, 60.0, cover(spike, px));
  }

  // Thorax.
  vec2 qt = p - vec2(-0.04, 0.0);
  vec2 rt = vec2(0.2, 0.16);
  float dt = sdEllipse(qt, rt);
  vec3 thor = CHITIN * (0.85 + 0.4 * vnoise(qt * 28.0));
  float ridge = 1.0 - smoothstep(0.0, 0.025, abs(qt.y));
  thor = mix(thor, BONE * 0.8, ridge * 0.6);
  over(s, thor, ellipseNormal(qt, rt, 1.6), vec3(0.0), 0.9, 50.0, cover(dt, px));

  drawMembrane(s, p, -1.0, frill, alertGlow, time, px);
  drawMembrane(s, p, 1.0, frill, alertGlow, time, px);

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
    over(s, BONE * 0.85, tubeNormal(p, m2.zw, 0.02), BLOOD * alertGlow * 0.15, 1.4, 70.0, cover(m2.x, px));
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
    over(s, CREVICE * 0.3, vec3(0.0, 0.0, 1.0), BLOOD * alertGlow * 1.2, 0.2, 20.0, cover(dp, px));
    gHalo += BLOOD * exp(-length(p - c) * 70.0) * alertGlow * 0.4;
  }

  outColor = finish(s, 0.6, vec3(0.0));
}
`;
