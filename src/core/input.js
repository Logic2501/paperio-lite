import { DIRECTION_ORDER, OPPOSITE_DIRECTION } from "./constants.js";

const KEY_TO_DIRECTION = {
  ArrowUp: "up",
  KeyW: "up",
  ArrowRight: "right",
  KeyD: "right",
  ArrowDown: "down",
  KeyS: "down",
  ArrowLeft: "left",
  KeyA: "left",
};

export class InputController {
  constructor(target = window) {
    this.target = target;
    this.queuedDirection = null;
    this.pauseRequested = false;
    this.touchStart = null;
    this.boundKeyDown = (event) => this.onKeyDown(event);
    this.boundTouchStart = (event) => this.onTouchStart(event);
    this.boundTouchEnd = (event) => this.onTouchEnd(event);
  }

  attach() {
    this.target.addEventListener("keydown", this.boundKeyDown);
    this.target.addEventListener("touchstart", this.boundTouchStart, { passive: true });
    this.target.addEventListener("touchend", this.boundTouchEnd, { passive: true });
  }

  detach() {
    this.target.removeEventListener("keydown", this.boundKeyDown);
    this.target.removeEventListener("touchstart", this.boundTouchStart);
    this.target.removeEventListener("touchend", this.boundTouchEnd);
  }

  consumeDirection(currentDirection) {
    if (!this.queuedDirection) {
      return null;
    }
    const nextDirection = this.queuedDirection;
    if (currentDirection && OPPOSITE_DIRECTION[currentDirection] === nextDirection) {
      this.queuedDirection = null;
      return null;
    }
    this.queuedDirection = null;
    return nextDirection;
  }

  consumePauseToggle() {
    if (!this.pauseRequested) {
      return false;
    }
    this.pauseRequested = false;
    return true;
  }

  clear() {
    this.queuedDirection = null;
    this.touchStart = null;
  }

  onKeyDown(event) {
    if (event.code === "Escape" || event.code === "Space") {
      event.preventDefault();
      this.pauseRequested = true;
      return;
    }
    const direction = KEY_TO_DIRECTION[event.code];
    if (!direction) {
      return;
    }
    event.preventDefault();
    this.queuedDirection = direction;
  }

  onTouchStart(event) {
    const touch = event.changedTouches[0];
    this.touchStart = { x: touch.clientX, y: touch.clientY };
  }

  onTouchEnd(event) {
    if (!this.touchStart) {
      return;
    }
    const touch = event.changedTouches[0];
    const dx = touch.clientX - this.touchStart.x;
    const dy = touch.clientY - this.touchStart.y;
    if (Math.abs(dx) < 12 && Math.abs(dy) < 12) {
      this.touchStart = null;
      return;
    }
    this.queuedDirection = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
    this.touchStart = null;
  }

  getDirectionOptions() {
    return DIRECTION_ORDER.map((direction) => direction.name);
  }
}
