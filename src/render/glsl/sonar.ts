/**
 * Sonar lighting: every live sound wave is a moving light whose front is the
 * iso-line of its geodesic distance field. Surfaces flash when the front
 * crosses them, then keep a fading glow that dissolves into grain.
 */
export const SONAR = /* glsl */ `
uniform sampler2DArray uField;

struct Sonar {
  vec3 light;   // sustained revealed light
  vec3 flash;   // bright impact flash right behind the front
  vec3 front;   // glow of the wavefront itself
  vec2 dir;     // energy-weighted propagation direction
  float reveal; // scalar amount of light (sustain + flash)
  float ripple; // signed ripple displacement near fronts (water, dust)
};

float sonarFall(float d, float R) {
  float u = clamp(d / R, 0.0, 1.0);
  float k = 1.0 - u * u;
  return k * k;
}

const float SUSTAIN = 0.66;

float sustainCurve(float tau, float fade) {
  float u = clamp(tau / fade, 0.0, 1.0);
  return pow(1.0 - u, 1.6) * (0.5 + 0.5 * exp(-tau * 2.2));
}

Sonar sonarEmpty() {
  Sonar s;
  s.light = vec3(0.0);
  s.flash = vec3(0.0);
  s.front = vec3(0.0);
  s.dir = vec2(0.0);
  s.reveal = 0.0;
  s.ripple = 0.0;
  return s;
}

/**
 * p: world position, grain: dissolve threshold noise in [0,1] (0 = no dissolve),
 * frontGain: how strongly this surface shows the travelling front.
 */
Sonar sonarAt(vec2 p, float grain, float frontGain) {
  Sonar s = sonarEmpty();
  // Dynamic bound + textureLod: ANGLE/D3D compilers must not unroll this loop.
  int n = min(int(uCam3.x), MAXW);
  for (int i = 0; i < n; i++) {
    vec4 A = uWaveA[i];
    vec4 B = uWaveB[i];
    float R = B.x;
    float lim = R + 2.1;
    float reach = lim * WAVE_REACH;
    vec2 dp = p - A.xy;
    if (dot(dp, dp) > reach * reach) continue;
    vec4 f = textureLod(uField, vec3(p / MAP_SIZE, B.z), 0.0);
    float d = f.x;
    if (d > lim) continue;
    float e = B.y * f.w * sonarFall(d, R) / (1.0 + d * 0.05);
    if (e < 0.002) continue;

    vec4 C = uWaveC[i];
    float speed = A.w;
    float r = A.z * speed;
    float x = d - r;
    float tau = -x / speed;

    // Travelling front: thin chromatic core, soft halo, short trail and ripples.
    float w = 0.04 + 0.009 * r;
    float ca = 0.025 + 0.004 * r;
    vec3 core = vec3(
      exp(-pow((x + ca) / w, 2.0)),
      exp(-pow(x / w, 2.0)),
      exp(-pow((x - ca) / w, 2.0))
    );
    float halo = exp(-x * x / (0.10 + 0.025 * r));
    float trail = tau > 0.0 ? exp(-tau * 5.0) : 0.0;
    float rip = tau > 0.0 ? sin(x * 15.0) * exp(-tau * 11.0) * smoothstep(0.0, 0.03, tau) : 0.0;
    vec3 col = C.rgb;
    vec3 white = mix(col, vec3(1.0), 0.55);
    s.front += (core * col * 1.1 + white * core.g * 0.5 + col * (halo * 0.16 + trail * 0.09 + max(rip, 0.0) * 0.2)) * e * frontGain;
    s.ripple += (exp(-x * x / (w * w * 5.0)) * -sign(x) + rip * 0.6) * e;

    if (tau > 0.0) {
      float fl = exp(-tau * 4.0) * (1.0 - exp(-tau * 60.0));
      float sus = sustainCurve(tau, C.w);
      float vis = grain > 0.0 ? smoothstep(grain * 0.35 - 0.05, grain * 0.35 + 0.02, sus) : 1.0;
      float I = e * sus * vis * SUSTAIN;
      // Phosphor-like decay: fresh echoes are bright, old ones sink into deep blue.
      vec3 tint = mix(col * vec3(0.32, 0.5, 1.25), col, smoothstep(0.0, 0.7, sus));
      s.light += tint * I;
      s.flash += white * e * fl;
      float wgt = I + e * fl;
      s.dir += f.yz * wgt;
      s.reveal += wgt;
    }
  }
  return s;
}

/** Directional light arriving from the wave sources. */
vec3 sonarLightDir(Sonar s) {
  float dl = length(s.dir);
  return dl > 1e-4 ? normalize(vec3(-s.dir / dl, 0.46)) : vec3(0.0, 0.0, 1.0);
}

vec3 sonarShade(Sonar s, vec3 albedo, vec3 N, float spec, float gloss) {
  vec3 L = sonarLightDir(s);
  float ndl = max(dot(N, L), 0.0);
  float diff = 0.18 + 0.95 * ndl;
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float sp = pow(max(dot(N, H), 0.0), gloss) * spec;
  vec3 lc = s.light + s.flash * 1.35;
  return albedo * lc * diff * 0.62 + lc * sp * 0.5;
}
`;
