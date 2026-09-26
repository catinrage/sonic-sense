import type { RGB } from "../core/math";

/** Wave colors per sound source. Saturated, slightly HDR for bloom. */
export const COLORS = {
  pulse: [0.33, 0.9, 1.0],
  step: [0.3, 0.72, 0.95],
  sneak: [0.25, 0.55, 0.8],
  splash: [0.35, 0.62, 1.0],
  stone: [0.86, 0.9, 1.0],
  crystal: [0.74, 0.42, 1.0],
  bell: [1.0, 0.66, 0.26],
  warden: [1.0, 0.16, 0.2],
  wardenAlert: [1.0, 0.08, 0.12],
  exit: [1.0, 0.8, 0.42],
  drip: [0.5, 0.78, 1.0],
  door: [1.0, 0.58, 0.28],
} as const satisfies Record<string, RGB>;
