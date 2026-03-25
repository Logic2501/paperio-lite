import { INITIAL_TERRITORY_RADIUS, RESPAWN_CLEAR_RADIUS } from "../core/constants.js";
import { clamp, lerp } from "../core/utils.js";

export class Renderer {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.maxDevicePixelRatio = options.maxDevicePixelRatio ?? 2;
    this.gridSize = options.gridSize ?? 64;
    this.dpr = Math.max(1, Math.min(this.maxDevicePixelRatio, window.devicePixelRatio || 1));
    this.backgroundCanvas = document.createElement("canvas");
    this.backgroundContext = this.backgroundCanvas.getContext("2d");
    this.resize();
  }

  resize() {
    const parent = this.canvas.parentElement;
    const bounds = this.canvas.getBoundingClientRect();
    const parentWidth = parent?.clientWidth ?? bounds.width ?? 960;
    const parentStyle = parent ? window.getComputedStyle(parent) : null;
    const horizontalPadding = parentStyle
      ? parseFloat(parentStyle.paddingLeft || "0") + parseFloat(parentStyle.paddingRight || "0")
      : 0;
    const contentWidth = Math.max(1, parentWidth - horizontalPadding);
    const maxViewportHeight = Math.floor(window.innerHeight * 0.66);
    const size = Math.max(1, Math.floor(Math.min(contentWidth, maxViewportHeight)));

    this.canvas.style.width = `${size}px`;
    this.canvas.style.height = `${size}px`;
    this.canvas.width = size * this.dpr;
    this.canvas.height = size * this.dpr;
    this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.viewportSize = size;
    this.cellSize = size / this.gridSize;
    this.cacheBackground();
  }

  render(state) {
    if (state.gridSize !== this.gridSize) {
      this.gridSize = state.gridSize;
      this.cellSize = this.viewportSize / this.gridSize;
      this.cacheBackground();
    }
    const ctx = this.context;
    const size = this.viewportSize;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(this.backgroundCanvas, 0, 0, size, size);
    this.drawTerritory(ctx, state);
    this.drawTrails(ctx, state);
    this.drawRespawnPreviews(ctx, state);
    this.drawEffects(ctx, state);
    this.drawPlayers(ctx, state);
    this.drawHudDecoration(ctx, state);
  }

  cacheBackground() {
    const ctx = this.backgroundContext;
    const size = this.viewportSize;
    this.backgroundCanvas.width = this.canvas.width;
    this.backgroundCanvas.height = this.canvas.height;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawBackground(ctx, size);
  }

  drawBackground(ctx, size) {
    ctx.fillStyle = "#fbfaf5";
    ctx.fillRect(0, 0, size, size);

    for (let index = 0; index <= this.gridSize; index += 1) {
      const offset = Math.floor(index * this.cellSize) + 0.5;
      const isMajor = index % 4 === 0;
      ctx.strokeStyle = isMajor ? "rgba(79, 58, 48, 0.055)" : "rgba(79, 58, 48, 0.024)";
      ctx.lineWidth = isMajor ? 0.9 : 0.55;
      ctx.beginPath();
      ctx.moveTo(offset, 0);
      ctx.lineTo(offset, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, offset);
      ctx.lineTo(size, offset);
      ctx.stroke();
    }
  }

  drawTerritory(ctx, state) {
    for (let y = 0; y < state.gridSize; y += 1) {
      for (let x = 0; x < state.gridSize; x += 1) {
        const ownerId = state.territory[y * state.gridSize + x];
        if (!ownerId) {
          continue;
        }
        const player = state.playerMap.get(ownerId);
        const px = x * this.cellSize;
        const py = y * this.cellSize;
        ctx.fillStyle = `${player.color}76`;
        ctx.fillRect(px, py, this.cellSize, this.cellSize);
        ctx.strokeStyle = `${player.color}92`;
        ctx.lineWidth = Math.max(0.85, this.cellSize * 0.08);
        ctx.strokeRect(px + 0.35, py + 0.35, this.cellSize - 0.7, this.cellSize - 0.7);
      }
    }
  }

  drawTrails(ctx, state) {
    for (const player of state.players) {
      if (!player.trail.length) {
        continue;
      }

      const headPosition = this.getPlayerRenderPosition(player, state.frameAlpha);
      const settledTrail = player.trail.map((cell) => ({ ...cell }));
      const lastTrailCell = settledTrail[settledTrail.length - 1];
      if (lastTrailCell && lastTrailCell.x === player.position.x && lastTrailCell.y === player.position.y) {
        settledTrail.pop();
      }
      const points = [...settledTrail, headPosition];
      const trailWidth = this.cellSize;

      if (!points.length) {
        continue;
      }

      ctx.save();
      ctx.fillStyle = `${player.color}48`;

      for (const point of points) {
        const cx = (point.x + 0.5) * this.cellSize;
        const cy = (point.y + 0.5) * this.cellSize;
        ctx.fillRect(cx - trailWidth / 2, cy - trailWidth / 2, trailWidth, trailWidth);
      }

      for (let index = 1; index < points.length; index += 1) {
        const previous = points[index - 1];
        const current = points[index];
        const startX = (previous.x + 0.5) * this.cellSize;
        const startY = (previous.y + 0.5) * this.cellSize;
        const endX = (current.x + 0.5) * this.cellSize;
        const endY = (current.y + 0.5) * this.cellSize;

        if (startX === endX) {
          const top = Math.min(startY, endY) - trailWidth / 2;
          const height = Math.abs(endY - startY) + trailWidth;
          ctx.fillRect(startX - trailWidth / 2, top, trailWidth, height);
        } else {
          const left = Math.min(startX, endX) - trailWidth / 2;
          const width = Math.abs(endX - startX) + trailWidth;
          ctx.fillRect(left, startY - trailWidth / 2, width, trailWidth);
        }
      }
      ctx.restore();
    }
  }

  drawPlayers(ctx, state) {
    for (const player of state.players) {
      if (!player.alive) {
        continue;
      }
      const renderPosition = this.getPlayerRenderPosition(player, state.frameAlpha);
      const px = renderPosition.x * this.cellSize;
      const py = renderPosition.y * this.cellSize;
      const outline = Math.max(1.4, this.cellSize * 0.16);
      ctx.fillStyle = player.color;
      ctx.fillRect(px, py, this.cellSize, this.cellSize);
      ctx.strokeStyle = darkenColor(player.color, player.isHuman ? 0.64 : 0.58);
      ctx.lineWidth = outline;
      ctx.strokeRect(px - outline / 2, py - outline / 2, this.cellSize + outline, this.cellSize + outline);
    }
  }

  drawRespawnPreviews(ctx, state) {
    for (const player of state.players) {
      if (player.alive || !player.respawnPreviewPosition) {
        continue;
      }

      const blinkOn = Math.floor(player.respawnPreviewTicks / 3) % 2 === 0;
      const baseColor = toRgb(player.color);
      const outlineColor = darkenColor(player.color, 0.66);
      const fillAlpha = blinkOn ? 0.46 : 0.24;
      const strokeAlpha = blinkOn ? 0.84 : 0.44;
      const outline = Math.max(1.2, this.cellSize * 0.14);
      const territorySize = INITIAL_TERRITORY_RADIUS * 2 + 1;
      const previewLeft = (player.respawnPreviewPosition.x - INITIAL_TERRITORY_RADIUS) * this.cellSize;
      const previewTop = (player.respawnPreviewPosition.y - INITIAL_TERRITORY_RADIUS) * this.cellSize;
      const previewPixels = territorySize * this.cellSize;
      const clearSize = RESPAWN_CLEAR_RADIUS * 2 + 1;
      const clearLeft = (player.respawnPreviewPosition.x - RESPAWN_CLEAR_RADIUS) * this.cellSize;
      const clearTop = (player.respawnPreviewPosition.y - RESPAWN_CLEAR_RADIUS) * this.cellSize;
      const clearPixels = clearSize * this.cellSize;
      const centerLeft = player.respawnPreviewPosition.x * this.cellSize;
      const centerTop = player.respawnPreviewPosition.y * this.cellSize;
      const centerOutline = Math.max(1.3, this.cellSize * 0.15);

      ctx.save();
      ctx.strokeStyle = withAlpha(baseColor, blinkOn ? 0.52 : 0.24);
      ctx.lineWidth = Math.max(1, this.cellSize * 0.08);
      ctx.strokeRect(clearLeft, clearTop, clearPixels, clearPixels);
      ctx.fillStyle = withAlpha(baseColor, fillAlpha);
      ctx.fillRect(previewLeft, previewTop, previewPixels, previewPixels);
      ctx.strokeStyle = withAlpha(baseColor, strokeAlpha);
      ctx.lineWidth = outline;
      ctx.strokeRect(
        previewLeft - outline / 2,
        previewTop - outline / 2,
        previewPixels + outline,
        previewPixels + outline,
      );
      ctx.fillStyle = withAlpha(baseColor, blinkOn ? 0.92 : 0.64);
      ctx.fillRect(centerLeft, centerTop, this.cellSize, this.cellSize);
      ctx.strokeStyle = withAlpha(outlineColor, blinkOn ? 0.96 : 0.72);
      ctx.lineWidth = centerOutline;
      ctx.strokeRect(
        centerLeft - centerOutline / 2,
        centerTop - centerOutline / 2,
        this.cellSize + centerOutline,
        this.cellSize + centerOutline,
      );
      ctx.restore();
    }
  }

  drawEffects(ctx, state) {
    for (const effect of state.effects) {
      if (effect.type === "popup") {
        const alpha = clamp(effect.life / effect.maxLife, 0, 1);
        ctx.fillStyle = `rgba(50, 38, 31, ${alpha})`;
        ctx.font = `700 ${Math.max(12, this.cellSize * 1.6)}px Trebuchet MS`;
        ctx.fillText(effect.text, effect.x * this.cellSize, effect.y * this.cellSize);
      }

      if (effect.type === "burst") {
        const alpha = clamp(effect.life / effect.maxLife, 0, 1);
        for (const particle of effect.particles) {
          const progress = 1 - alpha;
          const x = lerp(effect.origin.x, particle.x, progress) * this.cellSize;
          const y = lerp(effect.origin.y, particle.y, progress) * this.cellSize;
          ctx.fillStyle = `${effect.color}${Math.round(alpha * 255)
            .toString(16)
            .padStart(2, "0")}`;
          ctx.fillRect(x, y, Math.max(2, this.cellSize * 0.22), Math.max(2, this.cellSize * 0.22));
        }
      }

      if (effect.type === "fade") {
        const alpha = clamp(effect.life / effect.maxLife, 0, 1);
        ctx.fillStyle = `${effect.color}${Math.round(alpha * 128)
          .toString(16)
          .padStart(2, "0")}`;
        for (const cell of effect.cells) {
          ctx.fillRect(cell.x * this.cellSize, cell.y * this.cellSize, this.cellSize, this.cellSize);
        }
      }
    }
  }

  drawHudDecoration(ctx, state) {
    const leader = state.rankings[0];
    if (!leader) {
      return;
    }
    const player = state.playerMap.get(leader.id);
    if (!player || !player.alive) {
      return;
    }
    const renderPosition = this.getPlayerRenderPosition(player, state.frameAlpha);
    const x = renderPosition.x * this.cellSize + this.cellSize * 0.18;
    const y = renderPosition.y * this.cellSize - this.cellSize * 0.45;
    ctx.fillStyle = "#ffcd58";
    ctx.beginPath();
    ctx.moveTo(x, y + this.cellSize * 0.42);
    ctx.lineTo(x + this.cellSize * 0.12, y);
    ctx.lineTo(x + this.cellSize * 0.3, y + this.cellSize * 0.18);
    ctx.lineTo(x + this.cellSize * 0.5, y);
    ctx.lineTo(x + this.cellSize * 0.64, y + this.cellSize * 0.42);
    ctx.closePath();
    ctx.fill();
  }

  getPlayerRenderPosition(player, frameAlpha = 1) {
    const previous = player.previousPosition ?? player.position;
    return {
      x: lerp(previous.x, player.position.x, frameAlpha),
      y: lerp(previous.y, player.position.y, frameAlpha),
    };
  }
}

function darkenColor(hex, factor) {
  const normalized = hex.replace("#", "");
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((char) => char + char)
          .join("")
      : normalized;

  const red = Math.max(0, Math.floor(parseInt(expanded.slice(0, 2), 16) * factor));
  const green = Math.max(0, Math.floor(parseInt(expanded.slice(2, 4), 16) * factor));
  const blue = Math.max(0, Math.floor(parseInt(expanded.slice(4, 6), 16) * factor));

  return `rgb(${red}, ${green}, ${blue})`;
}

function toRgb(hex) {
  return darkenColor(hex, 1);
}

function withAlpha(rgb, alpha) {
  return rgb.replace("rgb(", "rgba(").replace(")", `, ${alpha})`);
}
