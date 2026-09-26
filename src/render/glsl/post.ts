import { HEADER, NOISE } from "./common";
import { SONAR } from "./sonar";

/** World-space "what have I heard" buffer: rises with reveals, fades slowly. */
export const MEMORY_FS = /* glsl */ `${HEADER}
${NOISE}
${SONAR}
uniform sampler2D uPrev;
uniform float uDecay;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 p = vUv * MAP_SIZE;
  float prev = textureLod(uPrev, vUv, 0.0).r;
  Sonar s = sonarAt(p, 0.0, 0.0);
  float now = clamp(s.reveal * 0.85, 0.0, 1.0);
  outColor = vec4(max(prev - uDecay, now), 0.0, 0.0, 1.0);
}
`;

/** Dual-filter downsample with optional soft-knee bright pass. */
export const BLOOM_DOWN_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uThreshold;
uniform int uPrefilter;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec3 c = texture(uSrc, vUv).rgb * 4.0;
  c += texture(uSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture(uSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture(uSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  c += texture(uSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  c *= 0.125;
  if (uPrefilter == 1) {
    c = min(c, vec3(40.0));
    float br = max(c.r, max(c.g, c.b));
    float knee = uThreshold * 0.7;
    float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 1e-4);
    c *= max(soft, br - uThreshold) / max(br, 1e-4);
  }
  outColor = vec4(c, 1.0);
}
`;

export const BLOOM_UP_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uWeight;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 o = uTexel;
  vec3 c = texture(uSrc, vUv + vec2(-2.0, 0.0) * o).rgb;
  c += texture(uSrc, vUv + vec2(2.0, 0.0) * o).rgb;
  c += texture(uSrc, vUv + vec2(0.0, -2.0) * o).rgb;
  c += texture(uSrc, vUv + vec2(0.0, 2.0) * o).rgb;
  c += texture(uSrc, vUv + vec2(-1.0, -1.0) * o).rgb * 2.0;
  c += texture(uSrc, vUv + vec2(1.0, -1.0) * o).rgb * 2.0;
  c += texture(uSrc, vUv + vec2(-1.0, 1.0) * o).rgb * 2.0;
  c += texture(uSrc, vUv + vec2(1.0, 1.0) * o).rgb * 2.0;
  outColor = vec4(c / 12.0 * uWeight, 1.0);
}
`;

/**
 * Final image: sound-shock distortion, chromatic aberration, bloom, filmic tone
 * mapping, vignette, danger pulse, grain and fades.
 */
export const COMPOSITE_FS = /* glsl */ `${HEADER}
${NOISE}
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform sampler2D uShock;
uniform vec4 uPost;   // exposure, bloom, chromatic aberration, grain
uniform vec4 uPost2;  // vignette, fade, danger, heartbeat phase
uniform vec4 uPost3;  // flash rgb, flash amount
uniform vec2 uRes;
in vec2 vUv;
out vec4 outColor;

vec3 aces(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec2 uv = vUv;
  vec2 shock = texture(uShock, uv).rg;
  uv += shock;
  vec2 dc = uv - 0.5;
  float r2 = dot(dc, dc);
  vec2 caOff = dc * uPost.z * (0.25 + r2 * 2.5) + shock * 0.6;
  vec3 col;
  col.r = texture(uScene, uv - caOff).r;
  col.g = texture(uScene, uv).g;
  col.b = texture(uScene, uv + caOff).b;
  col += texture(uBloom, uv).rgb * uPost.y;
  col *= uPost.x;
  col += uPost3.rgb * uPost3.a;
  col = aces(col);

  vec2 vv = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float vig = 1.0 - smoothstep(0.3, 1.15, length(vv)) * uPost2.x;
  col *= vig;

  float beat = pow(0.5 + 0.5 * sin(uPost2.w), 6.0);
  float edge = smoothstep(0.5, 1.25, length(vv));
  col = mix(col, col * vec3(1.0, 0.55, 0.6), uPost2.z * edge * 0.6);
  col += vec3(0.24, 0.006, 0.018) * uPost2.z * edge * (0.3 + 0.7 * beat);

  // Deep blue lift in the blacks keeps the void from feeling flat.
  col += vec3(0.0005, 0.0008, 0.0018) * (1.0 - col);
  float g = hash1(ivec2(gl_FragCoord.xy) + ivec2(int(TIME * 60.0) * 131, int(TIME * 60.0) * 71)) - 0.5;
  col += g * uPost.w * (0.25 + 0.75 * smoothstep(0.0, 0.08, col.g + col.b));
  col = mix(col, vec3(0.0), uPost2.y);
  outColor = vec4(pow(max(col, 0.0), vec3(1.0 / 2.2)), 1.0);
}
`;

/**
 * Screen-space displacement from strong wavefronts, rendered at low resolution.
 * Output: rg = uv offset.
 */
export const SHOCK_FS = /* glsl */ `${HEADER}
${NOISE}
${SONAR}
in vec2 vNdc;
out vec4 outColor;
void main() {
  vec2 p = uCam.xy + vec2(vNdc.x, -vNdc.y) * uCam.zw;
  vec2 off = vec2(0.0);
  int n = min(int(uCam3.x), MAXW);
  for (int i = 0; i < n; i++) {
    vec4 A = uWaveA[i];
    vec4 B = uWaveB[i];
    if (B.w != 0.0 && B.w != 7.0) continue; // only player pulses and warden shrieks warp space
    float R = B.x;
    vec2 dp = p - A.xy;
    float lim = R + 1.5;
    float reach = lim * WAVE_REACH;
    if (dot(dp, dp) > reach * reach) continue;
    vec4 f = textureLod(uField, vec3(p / MAP_SIZE, B.z), 0.0);
    if (f.x > lim) continue;
    float r = A.z * A.w;
    float x = f.x - r;
    float e = B.y * f.w * sonarFall(f.x, R);
    float wave = x * exp(-x * x / 0.09) * e;
    off += vec2(f.y, -f.z) * wave;
  }
  outColor = vec4(off * 0.012, 0.0, 1.0);
}
`;
