import { ENTITY_PRELUDE } from "./entity-common";

/**
 * "Echo", the player: a small moon-furred creature with enormous listening
 * ears, bioluminescent spine spots and ear veins that flare while charging.
 *
 * uP[0]: walk phase, walk amount (0..1), charge (0..1), sneak (0..1)
 * uP[1]: left ear swivel, right ear swivel, tail sway, blink (0..1)
 * uP[2]: time, glow pulse, fade (0..1), unused
 */
export const PLAYER_FS = /* glsl */ `${ENTITY_PRELUDE}

const vec3 FUR = vec3(0.80, 0.78, 0.90);
const vec3 FUR_DARK = vec3(0.36, 0.34, 0.50);
const vec3 EAR_IN = vec3(0.95, 0.56, 0.70);
const vec3 GLOWC = vec3(0.35, 0.95, 1.0);

float charge() { return uP[0].z; }
float sneak() { return uP[0].w; }

float bodySdf(vec2 p) {
  vec2 q = p - vec2(-0.035, 0.0);
  float breath = 1.0 + 0.025 * sin(uP[2].x * 2.3);
  float squash = 1.0 - sneak() * 0.06;
  float d = sdEllipse(q, vec2(0.2, 0.17) * breath * squash);
  vec2 dir = normalize(q + 1e-5);
  float fringe = (vnoise(dir * 3.0 + 7.0) - 0.5) * 0.02 + (vnoise(dir * 11.0) - 0.5) * 0.012;
  return d + fringe * smoothstep(-0.05, 0.0, d);
}

float headSdf(vec2 p) {
  float bob = sin(uP[0].x * 2.0) * 0.006 * uP[0].y;
  vec2 hp = p - vec2(0.175 + bob, 0.0);
  float d = sdEllipse(hp, vec2(0.15, 0.142));
  float snout = sdEllipse(p - vec2(0.29 + bob, 0.0), vec2(0.07, 0.056));
  d = smin(d, snout, 0.05);
  vec2 dir = normalize(hp + 1e-5);
  return d + (vnoise(dir * 4.0 + 3.0) - 0.5) * 0.014 * smoothstep(-0.04, 0.0, d);
}

/** Ear shape: x = signed distance, y = t along ear (0 base .. 1 tip), z = signed normalized width. */
vec3 earSdf(vec2 p, vec2 base, float ang, float len, float wid) {
  vec2 d = vec2(cos(ang), sin(ang));
  vec2 q = p - base;
  float u = dot(q, d);
  float v = dot(q, vec2(-d.y, d.x));
  float t = clamp(u / len, 0.0, 1.0);
  float w = wid * pow(sin(PI * clamp(t * 0.92 + 0.08, 0.0, 1.0)), 0.7) * (1.0 - 0.3 * t) + 0.003;
  float sd = max(abs(v) - w, max(-u, u - len));
  return vec3(sd, t, v / max(w, 1e-3));
}

float earAngle(float side) {
  float swivel = side < 0.0 ? uP[1].x : uP[1].y;
  float spread = 2.25 - charge() * 0.4 + sneak() * 0.35;
  return side * spread + swivel;
}

vec2 earBase(float side) { return vec2(0.13, side * 0.1); }

vec2 tailPoint(float t) {
  float sway = uP[1].z;
  return vec2(-0.21 - 0.3 * t, sin(t * 2.4 + 0.4) * sway * 0.17 * t + sway * 0.025);
}

float tailSdf(vec2 p, out float tt) {
  float best = 1e9;
  tt = 0.0;
  vec2 a = tailPoint(0.0);
  for (int i = 1; i <= 5 + LOOP_ZERO; i++) {
    vec2 b = tailPoint(float(i) / 5.0);
    vec2 st = sdSegmentT(p, a, b);
    float t = (float(i) - 1.0 + st.y) / 5.0;
    float r = mix(0.04, 0.085, smoothstep(0.0, 0.65, t)) * (1.0 - smoothstep(0.72, 1.0, t) * 0.8);
    float d = st.x - r;
    if (d < best) { best = d; tt = t; }
    a = b;
  }
  return best + (vnoise(p * 38.0) - 0.5) * 0.014;
}

float pawsSdf(vec2 p) {
  float ph = uP[0].x;
  float amt = uP[0].y;
  float d = 1e9;
  for (int i = 0; i < 4 + LOOP_ZERO; i++) {
    float side = (i == 0 || i == 2) ? -1.0 : 1.0;
    bool front = i < 2;
    float phase = ph + (front ? 0.0 : PI) + (side > 0.0 ? PI : 0.0);
    vec2 base = front ? vec2(0.1, side * 0.13) : vec2(-0.16, side * 0.135);
    base.x += sin(phase) * 0.055 * amt;
    base.y += side * max(0.0, cos(phase)) * 0.012 * amt;
    d = min(d, sdEllipse(p - base, vec2(0.052, 0.04)));
  }
  return d;
}

float heightField(vec2 p) {
  float h = 0.0;
  float tt;
  float dt = tailSdf(p, tt);
  if (dt < 0.0) h = max(h, 0.04 + dome(dt, 0.06) * 0.05);
  float dp = pawsSdf(p);
  if (dp < 0.0) h = max(h, 0.02 + dome(dp, 0.035) * 0.03);
  float db = bodySdf(p);
  if (db < 0.0) h = max(h, 0.06 + dome(db, 0.16) * 0.15);
  for (int k = 0; k < 2 + LOOP_ZERO; k++) {
    float side = k == 0 ? -1.0 : 1.0;
    vec3 e = earSdf(p, earBase(side), earAngle(side), 0.29, 0.105);
    if (e.x < 0.0) h = max(h, 0.2 - e.y * 0.06 - (1.0 - abs(e.z)) * 0.03 + dome(e.x, 0.02) * 0.02);
  }
  float dh = headSdf(p);
  if (dh < 0.0) h = max(h, 0.15 + dome(dh, 0.13) * 0.12);
  return h;
}

const float SCALE = 1.22;

void main() {
  vec2 p = vLocal / SCALE;
  float px = pxSize() / SCALE;
  float time = uP[2].x;
  float ch = charge();
  float pulse = 0.75 + 0.25 * sin(time * 2.6) + ch * 0.8;
  Surf s = surfEmpty();

  // Contact shadow.
  float sh = sdEllipse(p - vec2(-0.06, 0.035), vec2(0.34, 0.25));
  over(s, vec3(0.0), vec3(0.0, 0.0, 1.0), vec3(0.0), 0.0, 8.0, (1.0 - smoothstep(-0.14, 0.04, sh)) * 0.6);

  // Normal from the combined height field.
  const float e = 0.0045;
  float h0 = heightField(p);
  vec3 n = normalize(vec3(-(heightField(p + vec2(e, 0.0)) - h0) / e, -(heightField(p + vec2(0.0, e)) - h0) / e, 1.0));

  // Tail.
  float tt;
  float dt = tailSdf(p, tt);
  vec3 tailCol = mix(FUR_DARK, FUR, smoothstep(0.55, 0.95, tt)) * (0.85 + 0.25 * vnoise(p * vec2(60.0, 20.0)));
  over(s, tailCol, n, GLOWC * smoothstep(0.8, 1.0, tt) * 0.12 * pulse, 0.05, 10.0, cover(dt, px));

  // Paws.
  float dp = pawsSdf(p);
  over(s, vec3(0.62, 0.58, 0.7), n, vec3(0.0), 0.1, 12.0, cover(dp, px));

  // Body with a darker dorsal saddle and streaky fur.
  float db = bodySdf(p);
  float saddle = 1.0 - smoothstep(0.03, 0.11, abs(p.y + sin(p.x * 9.0) * 0.01)) * smoothstep(0.1, -0.05, p.x);
  vec3 bodyCol = mix(FUR, FUR_DARK, saddle * 0.7);
  bodyCol *= 0.9 + 0.14 * vnoise(vec2(p.x * 26.0, p.y * 60.0));
  over(s, bodyCol, n, vec3(0.0), 0.08, 12.0, cover(db, px));

  // Bioluminescent spine spots.
  for (int i = 0; i < 3 + LOOP_ZERO; i++) {
    vec2 c = vec2(0.03 - float(i) * 0.075, 0.0);
    float r = 0.022 - float(i) * 0.004;
    float dsp = sdCircle(p - c, r);
    float halo = exp(-max(dsp, 0.0) * 55.0) * 0.35;
    float k = cover(dsp, px) + halo * (1.0 - cover(db, px) * 0.4);
    glow(s, GLOWC * k * pulse * (0.35 + 0.1 * sin(time * 4.0 - float(i) * 1.2)) * (1.0 - step(0.0, db) * 0.7));
  }

  // Ears (behind the head).
  for (int k = 0; k < 2 + LOOP_ZERO; k++) {
    float side = k == 0 ? -1.0 : 1.0;
    float ang = earAngle(side);
    vec3 ear = earSdf(p, earBase(side), ang, 0.29, 0.105);
    vec3 inner = earSdf(p, earBase(side) + vec2(cos(ang), sin(ang)) * 0.03, ang, 0.225, 0.066);
    float outerA = cover(ear.x, px);
    vec3 earCol = mix(FUR, FUR_DARK, smoothstep(0.55, 1.0, ear.y) * 0.8);
    over(s, earCol, n, vec3(0.0), 0.06, 10.0, outerA);
    float innerA = cover(inner.x, px) * outerA;
    float veins = 0.0;
    veins = max(veins, 1.0 - smoothstep(0.05, 0.16, abs(inner.z)));
    veins = max(veins, 1.0 - smoothstep(0.04, 0.12, abs(inner.z - 0.55 * inner.y - 0.1)));
    veins = max(veins, 1.0 - smoothstep(0.04, 0.12, abs(inner.z + 0.5 * inner.y + 0.1)));
    veins *= smoothstep(0.02, 0.2, inner.y) * (1.0 - smoothstep(0.85, 1.0, inner.y));
    vec3 innerCol = EAR_IN * (0.8 + 0.25 * vnoise(p * 30.0));
    vec3 veinGlow = GLOWC * veins * (0.18 + ch * 1.6) * pulse;
    over(s, innerCol, n, veinGlow + GLOWC * 0.03, 0.2, 18.0, innerA);
  }

  // Head, muzzle, eyes, nose.
  float dh = headSdf(p);
  float muzzle = smoothstep(0.09, 0.0, length((p - vec2(0.29, 0.0)) * vec2(1.0, 1.4)));
  vec3 headCol = mix(FUR, vec3(0.95, 0.94, 0.98), muzzle * 0.8);
  headCol = mix(headCol, FUR_DARK, smoothstep(0.02, -0.08, p.x - 0.12) * 0.25);
  over(s, headCol, n, vec3(0.0), 0.08, 12.0, cover(dh, px));

  float blink = uP[1].w;
  for (int k = 0; k < 2 + LOOP_ZERO; k++) {
    float side = k == 0 ? -1.0 : 1.0;
    vec2 ec = vec2(0.225, side * 0.066);
    vec2 q = (p - ec) / vec2(1.0, max(1.0 - blink, 0.12));
    float de = sdEllipse(q, vec2(0.033, 0.03));
    vec3 eyeN = normalize(vec3((p - ec) * 14.0, 1.0));
    float catch1 = 1.0 - smoothstep(0.005, 0.011, length(p - ec - vec2(0.012, -0.011)));
    over(s, vec3(0.015, 0.02, 0.035), eyeN, GLOWC * (0.08 + catch1 * 1.2) * (1.0 - blink), 2.5, 140.0, cover(de, px));
  }
  float dn = sdEllipse(p - vec2(0.352, 0.0), vec2(0.017, 0.024));
  over(s, vec3(0.2, 0.08, 0.12), vec3(0.0, 0.0, 1.0), vec3(0.0), 0.8, 60.0, cover(dn, px));

  // Soft rim so the silhouette always reads in the dark.
  float rim = pow(1.0 - clamp(n.z, 0.0, 1.0), 2.5);
  glow(s, GLOWC * rim * 0.18 * (1.0 - step(0.9, 1.0 - s.a)));

  float fade = uP[2].z;
  s.a *= 1.0 - fade;
  s.emi *= 1.0 - fade;
  outColor = finish(s, 0.7, vec3(0.06, 0.075, 0.11));
}
`;

/** Additive halo drawn under the player: charge ring and faint aura. uP[0]: charge, time, sneak, alpha. */
export const AURA_FS = /* glsl */ `${ENTITY_PRELUDE}
// uP[0]: charge, time, sneak, alpha. uP[1]: listen, muffled, focusing, aim angle.
// uP[2]: the note of the key the creature stands on (colour), and whether it stands on one.
void main() {
  vec2 p = vLocal;
  float ch = uP[0].x;
  float time = uP[0].y;
  float alpha = uP[0].w;
  float listen = uP[1].x;
  float muffled = uP[1].y;
  float focusing = uP[1].z;
  float aimAng = uP[1].w;
  float r = length(p);
  float onKey = uP[2].w;
  vec3 col = mix(vec3(0.3, 0.9, 1.0), uP[2].rgb, onKey);
  float aura = exp(-r * r * 18.0) * 0.05 * (1.0 - uP[0].z * 0.7);
  float ringR = 0.42 + ch * 0.18;
  float ang = atan(p.y, p.x);
  // A focused call gathers into a wedge pointing where it will fly.
  float rel = abs(mod(ang - aimAng + PI, TAU) - PI);
  float wedge = mix(1.0, 1.0 - smoothstep(0.3, 0.42, rel), focusing);
  float ring = exp(-pow((r - ringR) / 0.012, 2.0)) * ch * wedge;
  float arc = step(fract(ang / TAU + 0.5), ch);
  float ticks = step(0.5, fract(ang / TAU * 24.0 - time * 0.5)) * exp(-pow((r - ringR - 0.05) / 0.008, 2.0)) * ch * 0.6 * wedge;
  float inner = exp(-pow((r - ringR * 0.8 + fract(time * 1.5) * 0.15) / 0.02, 2.0)) * ch * 0.4 * wedge;
  float beam = focusing * ch * (1.0 - smoothstep(0.05, 0.3, rel)) * smoothstep(0.1, 0.25, r) * exp(-r * 2.5) * 0.9;
  vec3 c = col * (aura + ring * (0.5 + arc * 1.5) + ticks + inner + beam);
  // Deep Listen: faint rings drawing inward, the world's sound arriving.
  for (int k = 0; k < 3 + LOOP_ZERO; k++) {
    float rr = 0.72 * (1.0 - fract(time * 0.35 + float(k) / 3.0));
    c += vec3(0.62, 0.8, 1.0) * exp(-pow((r - rr) / 0.01, 2.0)) * listen * smoothstep(0.0, 0.2, rr) * 0.35;
  }
  // Muffle: a hushed, slowly turning dotted ring.
  float dots = step(0.55, fract(ang / TAU * 16.0 + time * 0.15));
  c += vec3(0.4, 0.55, 0.9) * exp(-pow((r - 0.34) / 0.014, 2.0)) * dots * muffled * 0.6;
  // Standing on a key: a steady ring in its note's colour, so the next call's note is never a surprise.
  c += uP[2].rgb * exp(-pow((r - 0.5) / 0.012, 2.0)) * onKey * (0.35 + 0.1 * sin(time * 3.0));
  outColor = vec4(c * alpha, 0.0);
}
`;

/** Where a thrown stone will land. uP[0]: alpha, time. */
export const RETICLE_FS = /* glsl */ `${ENTITY_PRELUDE}
void main() {
  vec2 p = vLocal;
  float r = length(p);
  float a = atan(p.y, p.x);
  float alpha = uP[0].x;
  float ring = exp(-pow((r - 0.2) / 0.008, 2.0)) * step(0.35, fract(a / TAU * 8.0));
  float dotC = exp(-r * r * 900.0);
  float ticks = 0.0;
  for (int k = 0; k < 4 + LOOP_ZERO; k++) {
    float ang = float(k) * PI * 0.5;
    vec2 d = vec2(cos(ang), sin(ang));
    ticks = max(ticks, exp(-pow(sdSegment(p, d * 0.25, d * 0.33) / 0.007, 2.0)));
  }
  vec3 col = vec3(0.75, 0.85, 0.95) * (ring * 0.5 + dotC * 0.8 + ticks * 0.6) * alpha;
  outColor = vec4(col, 0.0);
}
`;
