import { damp } from "../core/math";
import { gnoise1 } from "./noise";
import type { CameraView } from "../render/renderer";

export const BASE_VIEW_HEIGHT = 12.5;
const CAMERA_HEIGHT = 17;

/** Smooth follow camera with look-ahead, zoom and trauma-based shake. */
export class Camera {
  x = 0;
  y = 0;
  viewHeight = BASE_VIEW_HEIGHT;
  zoomTarget = BASE_VIEW_HEIGHT;
  shakeScale = 1;
  private trauma = 0;
  private t = 0;
  private offX = 0;
  private offY = 0;

  snap(x: number, y: number): void {
    this.x = x;
    this.y = y;
  }

  follow(tx: number, ty: number, dt: number, stiffness = 4.5): void {
    this.x = damp(this.x, tx, stiffness, dt);
    this.y = damp(this.y, ty, stiffness, dt);
  }

  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(dt: number): void {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const s = this.trauma * this.trauma * 0.35 * this.shakeScale;
    this.offX = gnoise1(this.t * 22) * s;
    this.offY = gnoise1(this.t * 22 + 91.3) * s;
    this.viewHeight = damp(this.viewHeight, this.zoomTarget, 3, dt);
  }

  view(): CameraView {
    return { x: this.x + this.offX, y: this.y + this.offY, viewHeight: this.viewHeight, height: CAMERA_HEIGHT };
  }

  /** Floor-plane world point under normalized screen coordinates (0..1, y down). */
  screenToWorld(u: number, v: number, aspect: number): { x: number; y: number } {
    return {
      x: this.x + (u - 0.5) * this.viewHeight * aspect,
      y: this.y + (v - 0.5) * this.viewHeight,
    };
  }
}
