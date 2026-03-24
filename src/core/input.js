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
  constructor({ keyboardTarget = window, touchTarget = null } = {}) {
    this.keyboardTarget = keyboardTarget;
    this.touchTarget = touchTarget;
    this.queuedDirection = null;
    this.queuedTurn = null;
    this.pauseRequested = false;
    this.restartRequested = false;
    this.restartOnAnyKey = false;
    this.touchStart = null;
    this.touchIdentifier = null;
    this.boundKeyDown = (event) => this.onKeyDown(event);
    this.boundTouchStart = (event) => this.onTouchStart(event);
    this.boundTouchMove = (event) => this.onTouchMove(event);
    this.boundTouchEnd = (event) => this.onTouchEnd(event);
    this.boundTouchCancel = () => this.clearTouch();
  }

  attach() {
    this.keyboardTarget.addEventListener("keydown", this.boundKeyDown);
    if (!this.touchTarget) {
      return;
    }
    this.touchTarget.addEventListener("touchstart", this.boundTouchStart, { passive: false });
    window.addEventListener("touchmove", this.boundTouchMove, { passive: false });
    window.addEventListener("touchend", this.boundTouchEnd, { passive: false });
    window.addEventListener("touchcancel", this.boundTouchCancel);
  }

  detach() {
    this.keyboardTarget.removeEventListener("keydown", this.boundKeyDown);
    if (!this.touchTarget) {
      return;
    }
    this.touchTarget.removeEventListener("touchstart", this.boundTouchStart);
    window.removeEventListener("touchmove", this.boundTouchMove);
    window.removeEventListener("touchend", this.boundTouchEnd);
    window.removeEventListener("touchcancel", this.boundTouchCancel);
  }

  consumeDirection(currentDirection) {
    if (this.queuedTurn) {
      const turn = this.queuedTurn;
      this.queuedTurn = null;
      return this.resolveTurnDirection(currentDirection, turn);
    }

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

  consumeRestart() {
    if (!this.restartRequested) {
      return false;
    }
    this.restartRequested = false;
    return true;
  }

  clear() {
    this.queuedDirection = null;
    this.queuedTurn = null;
    this.clearTouch();
  }

  queueDirection(direction) {
    if (!direction || !this.getDirectionOptions().includes(direction)) {
      return;
    }
    this.queuedTurn = null;
    this.queuedDirection = direction;
  }

  queueTurn(turn) {
    if (turn !== "left" && turn !== "right") {
      return;
    }
    this.queuedDirection = null;
    this.queuedTurn = turn;
  }

  requestPauseToggle() {
    this.pauseRequested = true;
  }

  setRestartOnAnyKey(enabled) {
    this.restartOnAnyKey = enabled;
  }

  onKeyDown(event) {
    if (this.restartOnAnyKey && !isModifierOnly(event)) {
      event.preventDefault();
      this.restartRequested = true;
      return;
    }
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
    this.queueDirection(direction);
  }

  onTouchStart(event) {
    const touch = event.changedTouches[0];
    if (!touch) {
      return;
    }
    event.preventDefault();
    this.touchIdentifier = touch.identifier;
    this.touchStart = { x: touch.clientX, y: touch.clientY };
  }

  onTouchMove(event) {
    const touch = this.findTrackedTouch(event.touches);
    if (!touch) {
      return;
    }
    event.preventDefault();
  }

  onTouchEnd(event) {
    if (!this.touchStart) {
      return;
    }
    const touch = this.findTrackedTouch(event.changedTouches);
    if (!touch) {
      return;
    }
    event.preventDefault();
    const dx = touch.clientX - this.touchStart.x;
    const dy = touch.clientY - this.touchStart.y;
    if (Math.abs(dx) < 12 && Math.abs(dy) < 12) {
      this.clearTouch();
      return;
    }
    this.queueDirection(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up");
    this.clearTouch();
  }

  getDirectionOptions() {
    return DIRECTION_ORDER.map((direction) => direction.name);
  }

  clearTouch() {
    this.touchStart = null;
    this.touchIdentifier = null;
  }

  findTrackedTouch(touchList) {
    if (!touchList || this.touchIdentifier === null) {
      return null;
    }
    return Array.from(touchList).find((touch) => touch.identifier === this.touchIdentifier) || null;
  }

  resolveTurnDirection(currentDirection, turn) {
    const currentIndex = DIRECTION_ORDER.findIndex((direction) => direction.name === currentDirection);
    if (currentIndex < 0) {
      return null;
    }
    const step = turn === "left" ? -1 : 1;
    const nextIndex = (currentIndex + step + DIRECTION_ORDER.length) % DIRECTION_ORDER.length;
    return DIRECTION_ORDER[nextIndex].name;
  }
}

function isModifierOnly(event) {
  return ["ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight"].includes(
    event.code,
  );
}
