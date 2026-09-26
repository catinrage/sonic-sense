import { HEADER, NOISE } from "./common";
import { SONAR } from "./sonar";

/** Instanced additive particles: glows, sparks (velocity-stretched) and rings. */
export const PARTICLE_VS = /* glsl */ `${HEADER}
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aPos;   // x, y, z, size
layout(location = 2) in vec4 aColor; // rgb (hdr), alpha
layout(location = 3) in vec4 aVel;   // vx, vy, stretch, kind
out vec2 vLocal;
out vec4 vColor;
flat out int vKind;
void main() {
  vec2 vel = aVel.xy;
  float speed = length(vel);
  vec2 dir = speed > 1e-4 ? vel / speed : vec2(1.0, 0.0);
  vec2 perp = vec2(-dir.y, dir.x);
  float stretch = 1.0 + speed * aVel.z;
  vec2 w = aPos.xy + (dir * aCorner.x * stretch + perp * aCorner.y) * aPos.w;
  vLocal = aCorner;
  vColor = aColor;
  vKind = int(aVel.w + 0.5);
  gl_Position = projectWorld(w, aPos.z);
}
`;

export const PARTICLE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vLocal;
in vec4 vColor;
flat in int vKind;
out vec4 outColor;
void main() {
  float r = length(vLocal);
  float a;
  if (vKind == 1) {
    // Hard-cored spark.
    a = exp(-r * r * 9.0) + exp(-r * r * 2.5) * 0.25;
  } else if (vKind == 2) {
    // Thin ring.
    a = exp(-pow((r - 0.8) / 0.08, 2.0));
  } else {
    // Soft glow.
    a = exp(-r * r * 4.0);
  }
  a *= 1.0 - smoothstep(0.9, 1.0, r);
  outColor = vec4(vColor.rgb * a * vColor.a, 0.0);
}
`;

/** Air-borne dust that glitters when a wavefront passes through it. */
export const DUST_VS = /* glsl */ `${HEADER}
${NOISE}
${SONAR}
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aMote; // x, y, z, seed
out vec2 vLocal;
out vec3 vCol;
void main() {
  float t = TIME;
  float seed = aMote.w;
  vec2 pos = aMote.xy + vec2(sin(t * 0.13 + seed * 37.0), cos(t * 0.11 + seed * 91.0)) * 0.35;
  float z = aMote.z + sin(t * 0.3 + seed * 13.0) * 0.1;
  Sonar s = sonarAt(pos, 0.0, 1.0);
  float twinkle = 0.55 + 0.45 * sin(t * 6.0 + seed * 100.0);
  vCol = (s.front * 2.2 + s.flash * 0.35 + s.light * 0.08) * twinkle;
  vLocal = aCorner;
  if (dot(vCol, vec3(1.0)) < 0.004) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float size = 0.014 + 0.014 * fract(seed * 7.13);
  gl_Position = projectWorld(pos + aCorner * size, z);
}
`;

export const DUST_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vLocal;
in vec3 vCol;
out vec4 outColor;
void main() {
  float r = length(vLocal);
  float a = exp(-r * r * 5.0) * (1.0 - smoothstep(0.85, 1.0, r));
  outColor = vec4(vCol * a, 0.0);
}
`;
