import { GRID_SIZE } from "../core/constants.js";
import { clamp, lerp } from "../core/utils.js";

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.dpr = Math.max(1, window.devicePixelRatio || 1);
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
    this.cellSize = size / GRID_SIZE;
  }

  render(state) {
    const ctx = this.context;
    const size = this.viewportSize;
    ctx.clearRect(0, 0, size, size);
    this.drawBackground(ctx, size);
    this.drawTerritory(ctx, state);
    this.drawTrails(ctx, state);
    this.drawRespawnPreviews(ctx, state);
    this.drawEffects(ctx, state);
    this.drawPlayers(ctx, state);
    this.drawHudDecoration(ctx, state);
  }

  drawBackground(ctx, size) {
    ctx.fillStyle = "#fbfaf5";
    ctx.fillRect(0, 0, size, size);

    for (let index = 0; index <= GRID_SIZE; index += 1) {
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
    for (let y = 0; y < GRID_SIZE; y += 1) {
      for (let x = 0; x < GRID_SIZE; x += 1) {
        const ownerId = state.territory[y * GRID_SIZE + x];
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

      const points = [...player.trail, { ...player.position }];
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
      const px = player.position.x * this.cellSize;
      const py = player.position.y * this.cellSize;
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

      const px = player.respawnPreviewPosition.x * this.cellSize;
      const py = player.respawnPreviewPosition.y * this.cellSize;
      const blinkOn = Math.floor(player.respawnPreviewTicks / 3) % 2 === 0;
      const baseColor = darkenColor(player.color, 0.42);
      const fillAlpha = blinkOn ? 0.34 : 0.16;
      const strokeAlpha = blinkOn ? 0.68 : 0.28;
      const outline = Math.max(1.2, this.cellSize * 0.14);

      ctx.save();
      ctx.fillStyle = withAlpha(baseColor, fillAlpha);
      ctx.fillRect(px, py, this.cellSize, this.cellSize);
      ctx.strokeStyle = withAlpha(baseColor, strokeAlpha);
      ctx.lineWidth = outline;
      ctx.strokeRect(px - outline / 2, py - outline / 2, this.cellSize + outline, this.cellSize + outline);
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
    const x = player.position.x * this.cellSize + this.cellSize * 0.18;
    const y = player.position.y * this.cellSize - this.cellSize * 0.45;
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

function withAlpha(rgb, alpha) {
  return rgb.replace("rgb(", "rgba(").replace(")", `, ${alpha})`);
}
