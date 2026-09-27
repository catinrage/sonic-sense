/**
 * Shapes shared by the loading scene's parts. Only types live here: the scene
 * functions themselves are self-contained (they run inside a Worker from their
 * source text), so nothing at runtime may be imported by them.
 */

export type LoaderCanvas = OffscreenCanvas | HTMLCanvasElement;
export type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
export type MakeCanvas = (width: number, height: number) => LoaderCanvas;
export type RGB = readonly [number, number, number];

/** What the scene shows, and how the game will frame the same room once it is ready. */
export interface LoaderScene {
  /** The title diorama's rows (built-in map characters only). */
  map: readonly string[];
  /** Camera centre relative to the creature, as the title screen frames it. */
  cameraOffset: { x: number; y: number };
  /** Tiles visible from top to bottom. */
  viewHeight: number;
  cameraHeight: number;
  wallHeight: number;
  pitDepth: number;
  facing: number;
}

export interface LoaderSize {
  /** Drawing-buffer pixels. */
  width: number;
  height: number;
}

/** Something that makes sound in the chamber, with its sound field precomputed. */
export interface LoaderField {
  x: number;
  y: number;
  /** Distance travelled and energy left, on the sub-tile grid. */
  gridDist: Float32Array;
  gridEnergy: Float32Array;
  /** The same, sampled at every light-buffer pixel. */
  dist: Float32Array;
  energy: Float32Array;
}

export interface LoaderWorld {
  /** Map size in tiles, and the sub-tile grid the fields are solved on. */
  w: number;
  h: number;
  sub: number;
  solid: Uint8Array;
  width: number;
  height: number;
  /** Pixels per tile at floor level. */
  scale: number;
  camX: number;
  camY: number;
  cameraHeight: number;
  /** Light buffer: coarse, upscaled over the crisp pre-rendered stone. */
  lw: number;
  lh: number;
  /** Per light pixel: 0 floor, 1 water, 2 wall top, 3 wall face, 4 chasm wall, 5 abyss. */
  surface: Uint8Array;
  /** Per light pixel: how far down a chasm wall it is (1 at the rim, darker below). */
  fog: Float32Array;
  /** Per light pixel: the threshold at which fading light dissolves into grain. */
  grain: Float32Array;
  fields: LoaderField[];
  /** Field indices. */
  src: { creature: number; crystals: number[]; mushrooms: number[]; drips: number[]; gate: number; wardens: number[] };
  player: { x: number; y: number; facing: number };
  crystals: { x: number; y: number; seed: number }[];
  mushrooms: { x: number; y: number; seed: number }[];
  drips: { x: number; y: number }[];
  wardens: { x: number; y: number; heading: number }[];
  gate: { x: number; y: number } | null;
  /** Pre-rendered layers and scratch canvases. */
  albedo: LoaderCanvas;
  edges: LoaderCanvas;
  vignette: LoaderCanvas;
  grainTile: LoaderCanvas;
  lightCanvas: LoaderCanvas;
  frontCanvas: LoaderCanvas;
  memCanvas: LoaderCanvas;
  scratch: LoaderCanvas;
  bloomA: LoaderCanvas;
  bloomB: LoaderCanvas;
  /** Working buffers, reused every frame. */
  light: Float32Array;
  front: Float32Array;
  memory: Float32Array;
  /** One wave's shape by distance behind its front: glow, front band, lingering light. */
  lutLit: Float32Array;
  lutRing: Float32Array;
  lutSustain: Float32Array;
  /** Pixel buffers for the light, front and memory canvases. */
  images: ImageData[];
}

/** A sound in flight. */
export interface LoaderWave {
  field: number;
  t0: number;
  radius: number;
  speed: number;
  fade: number;
  strength: number;
  color: RGB;
  /** How brightly it shows (crystals sing softer than they strike, as in the game). */
  glow?: number;
}

export interface LoaderFrame {
  t: number;
  dt: number;
  waves: readonly LoaderWave[];
  creature: { charge: number; earL: number; earR: number; blink: number; call: number };
  crystals: readonly { glow: number; shake: number; tint: RGB | null }[];
  mushrooms: readonly number[];
  wardens: readonly { stir: number }[];
  /** 0..1: the final chord's flare. */
  finale: number;
  reduced: boolean;
}

/** Messages from the page to the scene. */
export type LoaderInbound =
  | { type: "init"; scene: LoaderScene; size: LoaderSize; reduced: boolean }
  | { type: "resize"; size: LoaderSize }
  | { type: "progress"; done: number; total: number }
  | { type: "finish" };

/** Messages from the scene to the page. */
export type LoaderOutbound = { type: "tuned"; count: number } | { type: "finished" } | { type: "failed"; message: string };
