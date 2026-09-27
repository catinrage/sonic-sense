import type { LoaderScene } from "../loader/types";
import { PIT_DEPTH, WALL_HEIGHT } from "../render/glsl/common";
import { BASE_VIEW_HEIGHT, CAMERA_HEIGHT } from "./camera";
import { SHOWCASE } from "./levels";

/** Where the title screen's camera sits relative to the creature: it leaves room for the menu on the left. */
export const TITLE_CAMERA_OFFSET = { x: -2.6, y: 0.6 } as const;
/** Which way the creature faces on the title screen. */
export const TITLE_FACING = Math.PI * 0.12;

/**
 * The loading screen draws the title's own chamber through the title's own
 * camera, so that when the game takes over, nothing in the room moves.
 */
export function titleLoaderScene(): LoaderScene {
  return {
    map: SHOWCASE.map,
    cameraOffset: TITLE_CAMERA_OFFSET,
    viewHeight: BASE_VIEW_HEIGHT,
    cameraHeight: CAMERA_HEIGHT,
    wallHeight: WALL_HEIGHT,
    pitDepth: PIT_DEPTH,
    facing: TITLE_FACING,
  };
}
