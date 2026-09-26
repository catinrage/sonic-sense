export type Action = "up" | "down" | "left" | "right" | "pulse" | "focus" | "muffle" | "sneak" | "throw" | "restart" | "pause" | "confirm";

const KEY_BINDINGS: Record<string, Action[]> = {
  KeyW: ["up"],
  ArrowUp: ["up"],
  KeyS: ["down"],
  ArrowDown: ["down"],
  KeyA: ["left"],
  ArrowLeft: ["left"],
  KeyD: ["right"],
  ArrowRight: ["right"],
  Space: ["pulse", "confirm"],
  ShiftLeft: ["sneak"],
  ShiftRight: ["sneak"],
  KeyE: ["throw"],
  KeyQ: ["focus"],
  KeyF: ["muffle"],
  KeyR: ["restart"],
  Escape: ["pause"],
  KeyP: ["pause"],
  Enter: ["confirm"],
};

const PREVENT_DEFAULT = new Set(["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"]);

/**
 * Tracks keyboard/mouse/gamepad state. `pressed`/`released` are edge-triggered
 * and cleared by `endFrame()`.
 */
export class Input {
  private down = new Set<Action>();
  private pressedSet = new Set<Action>();
  private releasedSet = new Set<Action>();
  private keysDown = new Set<string>();
  private padPrev = new Set<Action>();

  mouseX = 0;
  mouseY = 0;
  mouseInside = false;
  mouseMoved = false;
  anyKeyPressed = false;
  enabled = true;

  constructor(private readonly target: HTMLElement) {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    target.addEventListener("pointermove", this.onPointerMove);
    target.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointerup", this.onPointerUp);
    target.addEventListener("pointerleave", () => (this.mouseInside = false));
    target.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  isDown(action: Action): boolean {
    return this.down.has(action);
  }

  pressed(action: Action): boolean {
    return this.pressedSet.has(action);
  }

  released(action: Action): boolean {
    return this.releasedSet.has(action);
  }

  /** Movement vector from keys / left stick, length <= 1. */
  moveVector(): { x: number; y: number } {
    let x = (this.isDown("right") ? 1 : 0) - (this.isDown("left") ? 1 : 0);
    let y = (this.isDown("down") ? 1 : 0) - (this.isDown("up") ? 1 : 0);
    const pad = this.gamepad();
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      if (Math.hypot(ax, ay) > 0.2) {
        x = ax;
        y = ay;
      }
    }
    const len = Math.hypot(x, y);
    return len > 1 ? { x: x / len, y: y / len } : { x, y };
  }

  endFrame(): void {
    this.pressedSet.clear();
    this.releasedSet.clear();
    this.anyKeyPressed = false;
    this.mouseMoved = false;
  }

  /** Poll gamepad buttons once per frame (before reading input). */
  pollGamepad(): void {
    const pad = this.gamepad();
    if (!pad) return;
    const now = new Set<Action>();
    if (pad.buttons[0]?.pressed) now.add("pulse").add("confirm");
    if (pad.buttons[1]?.pressed || pad.buttons[7]?.pressed) now.add("throw");
    if (pad.buttons[6]?.pressed || pad.buttons[4]?.pressed) now.add("sneak");
    if (pad.buttons[9]?.pressed) now.add("pause");
    if (pad.buttons[3]?.pressed) now.add("restart");
    if (pad.buttons[2]?.pressed) now.add("focus");
    if (pad.buttons[5]?.pressed) now.add("muffle");
    for (const a of now) if (!this.padPrev.has(a)) this.press(a);
    for (const a of this.padPrev) if (!now.has(a)) this.release(a);
    this.padPrev = now;
  }

  private gamepad(): Gamepad | null {
    if (typeof navigator.getGamepads !== "function") return null;
    for (const pad of navigator.getGamepads()) if (pad && pad.connected) return pad;
    return null;
  }

  private press(action: Action): void {
    if (!this.down.has(action)) this.pressedSet.add(action);
    this.down.add(action);
  }

  private release(action: Action): void {
    if (this.down.has(action)) this.releasedSet.add(action);
    this.down.delete(action);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.enabled) return;
    if (PREVENT_DEFAULT.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.keysDown.add(e.code);
    this.anyKeyPressed = true;
    for (const action of KEY_BINDINGS[e.code] ?? []) this.press(action);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keysDown.delete(e.code);
    for (const action of KEY_BINDINGS[e.code] ?? []) {
      const stillHeld = [...this.keysDown].some((code) => KEY_BINDINGS[code]?.includes(action));
      if (!stillHeld) this.release(action);
    }
  };

  private onBlur = (): void => {
    for (const action of [...this.down]) this.release(action);
    this.keysDown.clear();
  };

  private onPointerMove = (e: PointerEvent): void => {
    const rect = this.target.getBoundingClientRect();
    this.mouseX = (e.clientX - rect.left) / rect.width;
    this.mouseY = (e.clientY - rect.top) / rect.height;
    this.mouseInside = true;
    this.mouseMoved = true;
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.enabled) return;
    this.anyKeyPressed = true;
    if (e.button === 0) this.press("throw");
    if (e.button === 2) this.press("pulse");
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.button === 0) this.release("throw");
    if (e.button === 2) this.release("pulse");
  };
}
