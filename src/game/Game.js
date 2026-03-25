import {
  AI_PROFILES,
  DEFAULT_GAME_OPTIONS,
  DIRECTION_ORDER,
  DIRECTIONS,
  ENDLESS_LOCKOUT_VICTORY_SECONDS,
  GAME_MODE,
  INITIAL_TERRITORY_RADIUS,
  MAX_EFFECTS,
  OPPOSITE_DIRECTION,
  PERFORMANCE_SAMPLE_SIZE,
  PLAYER_COLORS,
  PLAYER_STATE,
  RESPAWN_CLEAR_RADIUS,
  RESPAWN_ELIMINATION_SECONDS,
  RESPAWN_PREVIEW_TICKS,
} from "../core/constants.js";
import { clamp, createRng, formatPercent, manhattanDistance, pointKey } from "../core/utils.js";
import { createPlayer } from "./player.js";
import { AIAgent } from "../ai/AIAgent.js";

export class Game {
  constructor(config) {
    this.renderer = config.renderer;
    this.input = config.input;
    this.hud = config.hud;
    this.config = {
      ...DEFAULT_GAME_OPTIONS,
      ...config,
      seed: config.seed ?? Date.now(),
    };
    this.config.aiCount = clamp(this.config.aiCount, 2, 5);
    this.config.gridSize = clamp(this.config.gridSize, 24, 60);
    this.config.tickRate = normalizeTickRate(this.config.tickRate);
    this.config.matchSeconds = clamp(this.config.matchSeconds, 30, 600);

    this.rng = createRng(this.config.seed);
    this.frameId = null;
    this.paused = false;
    this.matchComplete = false;
    this.finalResults = null;
    this.performance = {
      frames: 0,
      frameMs: 0,
      updateMs: 0,
      renderMs: 0,
      effectCount: 0,
      tickRate: this.config.tickRate,
    };

    this.input.attach();
    this.hud.bind(this, this.input);
    this.boundResize = () => this.renderer.resize();
    window.addEventListener("resize", this.boundResize);
    this.restart();
  }

  restart(preserveBanner = false) {
    if (this.frameId) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }

    this.mode = this.config.mode;
    this.paused = false;
    this.matchComplete = false;
    this.finalResults = null;
    this.endlessLockoutTicks = 0;
    this.endlessCountdownText = "";
    this.timedSweepTicks = 0;
    this.input.setRestartOnAnyKey(false);
    this.ticks = 0;
    this.accumulator = 0;
    this.lastTimestamp = 0;
    this.running = false;
    this.bannerTicks = preserveBanner ? this.config.tickRate * 4 : 0;
    this.banner = preserveBanner ? this.banner : "";
    this.statusMessage = "";
    this.statusTicks = 0;
    this.events = preserveBanner && this.banner ? [this.banner, ...(this.events ?? [])].slice(0, 24) : [];
    this.effects = [];
    this.territory = new Uint16Array(this.getCellCount());
    this.trailMap = new Uint16Array(this.getCellCount());
    this.players = [];
    this.playerMap = new Map();
    this.agents = new Map();

    this.spawnPlayers();
    this.addEvent(this.config.attractMode ? "Demo match running." : "Fresh match started.");
    this.start();
  }

  toggleMode() {
    const wasPaused = this.paused;

    if (this.config.mode === GAME_MODE.TIMED) {
      this.config.mode = GAME_MODE.ENDLESS;
      this.mode = GAME_MODE.ENDLESS;
      this.endlessLockoutTicks = 0;
      this.endlessCountdownText = "";
      this.timedSweepTicks = 0;
      this.paused = wasPaused;
      this.banner = "Endless mode engaged.";
      this.bannerTicks = Math.max(1, Math.round(this.config.tickRate * 1.2));
      this.addEvent(this.banner);
      return;
    }

    this.config.mode = GAME_MODE.TIMED;
    this.mode = GAME_MODE.TIMED;
    this.ticks = 0;
    this.endlessLockoutTicks = 0;
    this.endlessCountdownText = "";
    this.timedSweepTicks = 0;
    this.matchComplete = false;
    this.finalResults = null;
    this.paused = wasPaused;
    this.input.setRestartOnAnyKey(false);
    this.banner = `Timed mode resumed. Clock reset to ${this.config.matchSeconds}s.`;
    this.bannerTicks = Math.max(1, Math.round(this.config.tickRate * 1.2));
    this.addEvent(this.banner);
  }

  setTickRate(nextTickRate) {
    const resolved = normalizeTickRate(nextTickRate);
    if (resolved === this.config.tickRate) {
      return;
    }
    this.config.tickRate = resolved;
    this.performance.tickRate = resolved;
    this.banner = `Speed set to ${resolved}.`;
    this.bannerTicks = Math.max(1, Math.round(this.config.tickRate * 1.2));
    this.addEvent(this.banner);
  }

  setMenuPause(paused) {
    if (this.matchComplete || this.config.attractMode) {
      return;
    }
    this.paused = paused;
    this.input.clear();
  }

  spawnPlayers() {
    const spawnColumns = this.scaleSpawnFractions([0.16, 0.82, 0.82, 0.18, 0.5, 0.5, 0.5, 0.28]);
    const spawnRows = this.scaleSpawnFractions([0.16, 0.18, 0.82, 0.82, 0.28, 0.72, 0.5, 0.5]);
    const directions = ["right", "left", "left", "right", "down", "up", "right", "left"];
    const profiles = ["balanced", "cautious", "aggressive", "balanced", "aggressive", "cautious", "balanced"];

    let nextId = 1;
    let spawnIndex = 0;

    if (this.config.humanEnabled) {
      const human = createPlayer({
        id: nextId,
        name: "You",
        color: PLAYER_COLORS[0],
        isHuman: true,
        spawn: { x: spawnColumns[spawnIndex], y: spawnRows[spawnIndex] },
        direction: directions[spawnIndex],
      });
      this.players.push(human);
      this.playerMap.set(human.id, human);
      nextId += 1;
      spawnIndex += 1;
    }

    for (let index = 0; index < this.config.aiCount; index += 1) {
      const colorIndex = this.config.humanEnabled ? index + 1 : index;
      const player = createPlayer({
        id: nextId + index,
        name: this.config.attractMode && !this.config.humanEnabled ? `Demo-${index + 1}` : `AI-${index + 1}`,
        color: PLAYER_COLORS[colorIndex],
        isHuman: false,
        aiProfile: profiles[index % profiles.length],
        spawn: { x: spawnColumns[spawnIndex + index], y: spawnRows[spawnIndex + index] },
        direction: directions[spawnIndex + index],
      });
      this.players.push(player);
      this.playerMap.set(player.id, player);
      this.agents.set(player.id, new AIAgent(player.id, AI_PROFILES[player.aiProfile], this.rng));
    }

    for (const player of this.players) {
      this.claimInitialTerritory(player);
    }
  }

  claimInitialTerritory(player) {
    const gridSize = this.config.gridSize;
    for (let dy = -INITIAL_TERRITORY_RADIUS; dy <= INITIAL_TERRITORY_RADIUS; dy += 1) {
      for (let dx = -INITIAL_TERRITORY_RADIUS; dx <= INITIAL_TERRITORY_RADIUS; dx += 1) {
        const x = clamp(player.position.x + dx, 0, gridSize - 1);
        const y = clamp(player.position.y + dy, 0, gridSize - 1);
        this.setTerritory(x, y, player.id);
      }
    }
    player.state = PLAYER_STATE.IN_TERRITORY;
    player.territoryCount = this.countTerritory(player.id);
  }

  start() {
    this.running = true;
    this.lastTimestamp = performance.now();
    this.loop(this.lastTimestamp);
  }

  destroy() {
    this.running = false;
    if (this.frameId) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
    this.input.detach();
    window.removeEventListener("resize", this.boundResize);
  }

  loop = (timestamp) => {
    if (!this.running) {
      return;
    }

    const frameStart = performance.now();

    if (this.matchComplete && this.input.consumeRestart()) {
      this.restart();
      return;
    }

    if (this.input.consumePauseToggle()) {
      this.togglePause();
    }

    const delta = Math.min(0.1, (timestamp - this.lastTimestamp) / 1000);
    this.lastTimestamp = timestamp;
    if (!this.paused) {
      this.accumulator += delta;
    } else {
      this.accumulator = 0;
    }

    const tickLength = 1 / this.config.tickRate;
    const updateStart = performance.now();
    while (!this.paused && this.accumulator >= tickLength) {
      this.updateTick();
      this.accumulator -= tickLength;
    }
    const updateEnd = performance.now();

    const renderStart = performance.now();
    const frameAlpha = this.paused || this.matchComplete ? 1 : clamp(this.accumulator / tickLength, 0, 1);
    this.renderer.render(this.getRenderState(frameAlpha));
    this.hud.update(this.getHudState());
    const renderEnd = performance.now();

    this.recordPerformance({
      frameMs: renderEnd - frameStart,
      updateMs: updateEnd - updateStart,
      renderMs: renderEnd - renderStart,
    });

    this.frameId = requestAnimationFrame(this.loop);
  };

  togglePause() {
    if (this.matchComplete || this.config.attractMode) {
      return;
    }
    this.paused = !this.paused;
    this.input.clear();
    this.addEvent(this.paused ? "Paused." : "Resumed.");
  }

  updateTick() {
    this.ticks += 1;
    if (this.bannerTicks > 0) {
      this.bannerTicks -= 1;
      if (this.bannerTicks === 0) {
        this.banner = "";
      }
    }
    if (this.statusTicks > 0) {
      this.statusTicks -= 1;
      if (this.statusTicks === 0) {
        this.statusMessage = "";
      }
    }

    for (const effect of this.effects) {
      effect.life -= 1;
    }
    this.effects = this.effects.filter((effect) => effect.life > 0);

    for (const player of this.players) {
      player.previousPosition = { ...player.position };
    }

    const intents = [];
    const suppressionTier = this.getSuppressionTier();
    for (const player of this.players) {
      if (player.state === PLAYER_STATE.ELIMINATED) {
        continue;
      }

      if (!player.alive) {
        this.updateRespawn(player);
        continue;
      }

      if (!player.isHuman && this.shouldFreezeAiMovement(player, suppressionTier)) {
        continue;
      }

      const direction = player.isHuman
        ? this.input.consumeDirection(player.direction)
        : this.computeAiDirection(player);
      if (direction && OPPOSITE_DIRECTION[player.direction] !== direction) {
        player.nextDirection = direction;
      }

      const resolvedDirection = this.resolveDirection(player);
      intents.push({
        player,
        turned: resolvedDirection !== player.direction,
        turnSide: getTurnSide(player.direction, resolvedDirection),
        direction: resolvedDirection,
        next: this.project(player.position, resolvedDirection),
      });
    }

    for (const intent of intents) {
      intent.player.direction = intent.direction;
      intent.player.position = intent.next;
    }

    this.resolveCollisions(intents);

    for (const intent of intents) {
      if (!intent.player.alive || intent.player.isHuman) {
        continue;
      }
      this.updateAiTurnState(intent.player, intent);
    }

    for (const player of this.players) {
      if (player.alive) {
        this.resolveTerritoryState(player);
      }
    }

    if (this.mode === GAME_MODE.TIMED) {
      if (this.evaluateTimedSweepVictory()) {
        return;
      }

      const remaining = this.config.matchSeconds - this.ticks / this.config.tickRate;
      if (remaining <= 0) {
        this.finishTimedMatch();
        return;
      }
    } else {
      this.evaluateEndlessVictory();
      if (this.matchComplete) {
        return;
      }
    }
  }

  updateRespawn(player) {
    const candidate = player.respawnPreviewPosition;

    if (candidate) {
      if (!this.isRespawnAreaAvailable(candidate.x, candidate.y, player.id)) {
        player.respawnPreviewTicks = 0;
        player.respawnPreviewPosition = null;
        player.state = PLAYER_STATE.DEAD;
        this.setRespawnStatus(player, "Respawn preview cancelled. Searching for a new safe opening.", true);
      } else {
        player.respawnPreviewTicks -= 1;
        if (player.respawnPreviewTicks > 0) {
          const remaining = Math.ceil(player.respawnPreviewTicks / this.config.tickRate);
          this.setRespawnStatus(player, `${player.name} respawning in ${remaining}s...`);
          return;
        }

        this.finishRespawn(player, candidate);
        return;
      }
    }

    const spawn = this.findBestRespawnPoint(player.id);
    if (!spawn) {
      player.state = PLAYER_STATE.DEAD;
      player.respawnBlockedTicks += 1;
      const remainingSeconds = Math.max(
        0,
        Math.ceil(RESPAWN_ELIMINATION_SECONDS - player.respawnBlockedTicks / this.config.tickRate),
      );
      if (player.respawnBlockedTicks >= RESPAWN_ELIMINATION_SECONDS * this.config.tickRate) {
        this.eliminatePlayer(player, `${player.name} was eliminated after 10s without a 9x9 respawn zone.`);
        return;
      }
      this.setRespawnStatus(
        player,
        `${player.name} needs a 9x9 safe respawn zone. Elimination in ${remainingSeconds}s...`,
        true,
      );
      return;
    }

    player.respawnBlockedTicks = 0;
    player.respawnPreviewPosition = spawn;
    player.respawnPreviewTicks = RESPAWN_PREVIEW_TICKS;
    player.state = PLAYER_STATE.RESPAWNING;
    player.respawnStatus = `${player.name} respawning soon...`;
  }

  computeAiDirection(player) {
    const currentEvaluation = this.evaluateMove(player.id, player.direction);
    const mustTurn = !currentEvaluation.valid || !currentEvaluation.safe;

    if (player.aiTurnCooldown > 0 && !mustTurn) {
      player.aiTurnCooldown -= 1;
      return null;
    }

    const direction = this.agents.get(player.id)?.update(this.createAiSnapshot()) ?? null;
    const profile = AI_PROFILES[player.aiProfile];
    player.aiTurnCooldown = Math.max(0, (profile?.turnInterval ?? 2) - 1);
    return direction;
  }

  updateAiTurnState(player, intent) {
    if (!intent.turned) {
      player.aiStepsSinceTurn += 1;
      return;
    }

    if (!intent.turnSide) {
      player.aiLastTurnSide = null;
      player.aiQuickTurnStreak = 0;
      player.aiStepsSinceTurn = 0;
      return;
    }

    const isQuickSameTurn = player.aiLastTurnSide === intent.turnSide && player.aiStepsSinceTurn <= 4;
    player.aiLastTurnSide = intent.turnSide;
    player.aiQuickTurnStreak = isQuickSameTurn ? player.aiQuickTurnStreak + 1 : 1;
    player.aiStepsSinceTurn = 0;
  }

  isAiTurnRestricted(player, direction) {
    if (!player || player.isHuman || !player.alive) {
      return false;
    }

    const turnSide = getTurnSide(player.direction, direction);
    if (!turnSide) {
      return false;
    }

    return player.aiLastTurnSide === turnSide && player.aiQuickTurnStreak >= 3 && player.aiStepsSinceTurn <= 4;
  }

  resetAiTurnState(player) {
    player.aiLastTurnSide = null;
    player.aiQuickTurnStreak = 0;
    player.aiStepsSinceTurn = 99;
  }

  shouldFreezeAiMovement(player, suppressionTier) {
    if (suppressionTier === 0 || player.isHuman) {
      return false;
    }

    const cadence = [1, 4, 3, 2][suppressionTier];
    return cadence > 1 && (this.ticks + player.id) % cadence === 0;
  }

  resolveDirection(player) {
    const preferred = player.nextDirection ?? player.direction;
    const next = this.projectRaw(player.position, preferred);
    if (this.isInside(next.x, next.y)) {
      return preferred;
    }

    for (const candidate of DIRECTION_ORDER.map((direction) => direction.name)) {
      if (candidate === OPPOSITE_DIRECTION[player.direction]) {
        continue;
      }
      const projection = this.projectRaw(player.position, candidate);
      if (this.isInside(projection.x, projection.y)) {
        return candidate;
      }
    }
    return OPPOSITE_DIRECTION[player.direction];
  }

  resolveCollisions(intents) {
    const occupied = new Map();

    for (const { player } of intents) {
      if (!player.alive) {
        continue;
      }
      const index = this.index(player.position.x, player.position.y);
      const trailOwner = this.trailMap[index];
      if (trailOwner) {
        if (trailOwner === player.id) {
          this.killPlayer(player, player.id, `${player.name} crossed their own trail.`);
          continue;
        }
        const owner = this.playerMap.get(trailOwner);
        this.killPlayer(owner, player.id, `${player.name} cut ${owner.name}'s trail.`);
      }

      const key = pointKey(player.position.x, player.position.y);
      if (!occupied.has(key)) {
        occupied.set(key, []);
      }
      occupied.get(key).push(player.id);
    }

    for (const ids of occupied.values()) {
      if (ids.length < 2) {
        continue;
      }
      for (const id of ids) {
        const player = this.playerMap.get(id);
        this.killPlayer(player, null, `${player.name} collided head-on.`);
      }
    }
  }

  resolveTerritoryState(player) {
    const index = this.index(player.position.x, player.position.y);
    const owner = this.territory[index];
    const onOwnTerritory = owner === player.id;

    if (!onOwnTerritory) {
      if (!player.trailSet.has(index)) {
        player.trail.push({ x: player.position.x, y: player.position.y });
        player.trailSet.add(index);
        this.trailMap[index] = player.id;
      }
      player.state = PLAYER_STATE.TRAILING;
      return;
    }

    if (player.trail.length) {
      player.state = PLAYER_STATE.CLOSING;
      this.closeTrail(player);
      player.state = PLAYER_STATE.IN_TERRITORY;
      return;
    }

    player.state = PLAYER_STATE.IN_TERRITORY;
  }

  closeTrail(player) {
    for (const cell of player.trail) {
      this.setTerritory(cell.x, cell.y, player.id);
      this.trailMap[this.index(cell.x, cell.y)] = 0;
    }

    const claimedCells = this.fillEnclosedArea(player);
    const totalClaimed = claimedCells + player.trail.length;
    player.trail = [];
    player.trailSet.clear();
    player.territoryCount = this.countTerritory(player.id);
    player.stats.captures += totalClaimed;

    const share = (totalClaimed / this.getCellCount()) * 100;
    if (totalClaimed > 0) {
      this.pushEffect(this.createPopup(player.position.x + 0.2, player.position.y - 0.2, `+${share.toFixed(2)}%`));
      this.pushEffect(this.createBurst(player.position, player.color));
      this.addEvent(`${player.name} claimed ${formatPercent(share)}.`);
    }
  }

  fillEnclosedArea(player) {
    const gridSize = this.config.gridSize;
    const blocked = new Uint8Array(this.getCellCount());
    for (let index = 0; index < blocked.length; index += 1) {
      if (this.territory[index] === player.id || this.trailMap[index] === player.id) {
        blocked[index] = 1;
      }
    }

    const visited = new Uint8Array(this.getCellCount());
    const queue = [];

    for (let x = 0; x < gridSize; x += 1) {
      this.enqueueFill(x, 0, blocked, visited, queue);
      this.enqueueFill(x, gridSize - 1, blocked, visited, queue);
    }
    for (let y = 0; y < gridSize; y += 1) {
      this.enqueueFill(0, y, blocked, visited, queue);
      this.enqueueFill(gridSize - 1, y, blocked, visited, queue);
    }

    while (queue.length) {
      const current = queue.shift();
      for (const direction of DIRECTION_ORDER) {
        this.enqueueFill(current.x + direction.x, current.y + direction.y, blocked, visited, queue);
      }
    }

    let claimed = 0;
    for (let y = 0; y < gridSize; y += 1) {
      for (let x = 0; x < gridSize; x += 1) {
        const index = this.index(x, y);
        if (!blocked[index] && !visited[index]) {
          this.setTerritory(x, y, player.id);
          claimed += 1;
        }
      }
    }
    return claimed;
  }

  enqueueFill(x, y, blocked, visited, queue) {
    if (!this.isInside(x, y)) {
      return;
    }
    const index = this.index(x, y);
    if (blocked[index] || visited[index]) {
      return;
    }
    visited[index] = 1;
    queue.push({ x, y });
  }

  killPlayer(player, killerId, message) {
    if (!player || !player.alive) {
      return;
    }
    player.alive = false;
    player.state = PLAYER_STATE.DEAD;
    player.stats.deaths += 1;
    player.respawnPreviewTicks = 0;
    player.respawnPreviewPosition = null;
    player.respawnStatus = "";
    player.respawnStatusDirty = "";
    player.respawnBlockedTicks = 0;
    player.eliminationReason = "";
    player.previousPosition = { ...player.position };
    this.resetAiTurnState(player);

    const fadedCells = [];
    for (let index = 0; index < this.territory.length; index += 1) {
      if (this.territory[index] !== player.id) {
        continue;
      }
      this.territory[index] = 0;
      const x = index % this.config.gridSize;
      const y = Math.floor(index / this.config.gridSize);
      fadedCells.push({ x, y });
    }

    for (const cell of player.trail) {
      this.trailMap[this.index(cell.x, cell.y)] = 0;
    }
    player.trail = [];
    player.trailSet.clear();
    player.territoryCount = 0;

    this.pushEffect(this.createBurst(player.position, player.color));
    if (fadedCells.length) {
      this.pushEffect({
        type: "fade",
        color: player.color,
        cells: fadedCells,
        life: 14,
        maxLife: 14,
      });
    }
    this.addEvent(message);

    if (killerId && killerId !== player.id) {
      const killer = this.playerMap.get(killerId);
      if (killer) {
        killer.stats.kills += 1;
      }
    }
  }

  eliminatePlayer(player, message) {
    player.state = PLAYER_STATE.ELIMINATED;
    player.respawnPreviewTicks = 0;
    player.respawnPreviewPosition = null;
    player.respawnBlockedTicks = RESPAWN_ELIMINATION_SECONDS * this.config.tickRate;
    player.eliminationReason = message;
    player.previousPosition = { ...player.position };
    this.resetAiTurnState(player);
    this.setRespawnStatus(player, message, true);
  }

  finishRespawn(player, spawn) {
    player.position = spawn;
    player.previousPosition = { ...spawn };
    player.direction = this.pickDirection();
    player.nextDirection = player.direction;
    player.aiTurnCooldown = 0;
    player.respawnPreviewTicks = 0;
    player.respawnPreviewPosition = null;
    player.respawnBlockedTicks = 0;
    player.eliminationReason = "";
    player.alive = true;
    player.state = PLAYER_STATE.IN_TERRITORY;
    this.resetAiTurnState(player);
    this.claimInitialTerritory(player);
    this.setRespawnStatus(player, "");
    this.addEvent(`${player.name} respawned.`);
  }

  findBestRespawnPoint(playerId) {
    let bestPoint = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    const gridSize = this.config.gridSize;

    for (let y = RESPAWN_CLEAR_RADIUS; y < gridSize - RESPAWN_CLEAR_RADIUS; y += 1) {
      for (let x = RESPAWN_CLEAR_RADIUS; x < gridSize - RESPAWN_CLEAR_RADIUS; x += 1) {
        if (!this.isRespawnAreaAvailable(x, y, playerId)) {
          continue;
        }

        const emptiness = this.measureRespawnEmptiness(x, y);
        const distance = this.measureRespawnDistance(x, y, playerId);
        const score = emptiness * 10 + distance * 6;

        if (score > bestScore) {
          bestScore = score;
          bestPoint = { x, y };
        }
      }
    }
    return bestPoint;
  }

  isRespawnAreaAvailable(centerX, centerY, playerId) {
    for (let dy = -RESPAWN_CLEAR_RADIUS; dy <= RESPAWN_CLEAR_RADIUS; dy += 1) {
      for (let dx = -RESPAWN_CLEAR_RADIUS; dx <= RESPAWN_CLEAR_RADIUS; dx += 1) {
        const x = centerX + dx;
        const y = centerY + dy;
        if (!this.isInside(x, y)) {
          return false;
        }

        const index = this.index(x, y);
        if (this.territory[index] !== 0 || this.trailMap[index] !== 0) {
          return false;
        }

        for (const player of this.players) {
          if (player.id === playerId) {
            continue;
          }
          if (player.alive && player.position.x === x && player.position.y === y) {
            return false;
          }
          if (
            player.respawnPreviewPosition &&
            Math.abs(player.respawnPreviewPosition.x - centerX) <= INITIAL_TERRITORY_RADIUS * 2 &&
            Math.abs(player.respawnPreviewPosition.y - centerY) <= INITIAL_TERRITORY_RADIUS * 2
          ) {
            return false;
          }
        }
      }
    }

    return true;
  }

  measureRespawnEmptiness(centerX, centerY) {
    let emptyCells = 0;
    const radius = RESPAWN_CLEAR_RADIUS + 3;

    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const x = centerX + dx;
        const y = centerY + dy;
        if (!this.isInside(x, y)) {
          continue;
        }
        const index = this.index(x, y);
        if (this.territory[index] === 0 && this.trailMap[index] === 0) {
          emptyCells += 1;
        }
      }
    }

    return emptyCells;
  }

  measureRespawnDistance(centerX, centerY, playerId) {
    let nearestDistance = Infinity;

    for (const player of this.players) {
      if (player.id === playerId) {
        continue;
      }

      const reference = player.alive ? player.position : player.respawnPreviewPosition;
      if (!reference) {
        continue;
      }

      nearestDistance = Math.min(nearestDistance, manhattanDistance({ x: centerX, y: centerY }, reference));
    }

    return nearestDistance === Infinity ? this.config.gridSize : nearestDistance;
  }

  setRespawnStatus(player, message, shouldLog = false) {
    player.respawnStatus = message;
    if (shouldLog && message && player.respawnStatusDirty !== message) {
      this.addEvent(message);
      player.respawnStatusDirty = message;
      this.statusMessage = message;
      this.statusTicks = Math.max(1, Math.round(this.config.tickRate * 1.2));
    }
    if (!message) {
      player.respawnStatusDirty = "";
    } else if (shouldLog) {
      player.respawnStatusDirty = message;
    }
  }

  scaleSpawnFractions(fractions) {
    return fractions.map((fraction) =>
      clamp(Math.round((this.config.gridSize - 1) * fraction), RESPAWN_CLEAR_RADIUS + 2, this.config.gridSize - RESPAWN_CLEAR_RADIUS - 3),
    );
  }

  pickDirection() {
    return DIRECTION_ORDER[Math.floor(this.rng() * DIRECTION_ORDER.length)].name;
  }

  finishTimedMatch() {
    const rankings = this.computeRankings();
    const leader = rankings[0] ? this.playerMap.get(rankings[0].id) : null;
    this.banner = leader ? `${leader.name} wins the timed round.` : "Match complete.";
    this.addEvent(this.banner);
    this.completeMatch({
      title: leader ? `${leader.name} Wins` : "Match Complete",
      subtitle: "Press any key on desktop or tap Restart to run another round.",
      rankings,
    });
  }

  finishTimedSweepVictory() {
    const rankings = this.computeRankings();
    this.banner = "All rivals were fully eliminated.";
    this.addEvent(this.banner);
    this.completeMatch({
      title: "【闪电战】",
      subtitle: "Every rival was fully eliminated before the timer expired.",
      rankings,
    });
  }

  finishEndlessVictory() {
    const rankings = this.computeRankings();
    this.endlessCountdownText = "";
    this.banner = "The player became the Terminus Producer.";
    this.addEvent(this.banner);
    this.completeMatch({
      title: "【终产者】",
      subtitle: "Every rival lost access to a legal 9x9 respawn zone.",
      rankings,
    });
  }

  finishEndlessFailure() {
    const rankings = this.computeRankings();
    this.endlessCountdownText = "";
    this.banner = "The final push collapsed at the finish line.";
    this.addEvent(this.banner);
    this.completeMatch({
      title: "【功亏一篑】",
      subtitle: "The last rival fell, but the player did not survive the final countdown.",
      rankings,
    });
  }

  completeMatch(finalResults) {
    this.paused = true;
    this.matchComplete = true;
    this.finalResults = finalResults;
    this.input.clear();
    this.input.setRestartOnAnyKey(true);
  }

  evaluateEndlessVictory() {
    if (this.matchComplete || this.config.attractMode || !this.config.humanEnabled) {
      this.endlessCountdownText = "";
      return;
    }

    const human = this.getHumanPlayer();
    const opponents = this.players.filter((player) => !player.isHuman);
    if (!opponents.length) {
      this.endlessCountdownText = "";
      return;
    }

    if (opponents.every((player) => player.state === PLAYER_STATE.ELIMINATED)) {
      if (!human || !human.alive) {
        this.finishEndlessFailure();
        return;
      }
      this.endlessLockoutTicks += 1;
    } else {
      this.endlessLockoutTicks = 0;
      this.endlessCountdownText = "";
    }

    const countdownDelayTicks = this.config.tickRate * 3;
    const countdownWindowTicks = ENDLESS_LOCKOUT_VICTORY_SECONDS * this.config.tickRate;
    const countdownTicks = this.endlessLockoutTicks - countdownDelayTicks;

    if (countdownTicks > 0 && countdownTicks < countdownWindowTicks) {
      const remaining = Math.max(0, ENDLESS_LOCKOUT_VICTORY_SECONDS - Math.floor(countdownTicks / this.config.tickRate));
      this.endlessCountdownText = `${remaining}`;
    } else {
      this.endlessCountdownText = "";
    }

    if (this.endlessLockoutTicks >= countdownDelayTicks + countdownWindowTicks) {
      this.finishEndlessVictory();
    }
  }

  evaluateTimedSweepVictory() {
    if (this.matchComplete || this.config.attractMode || !this.config.humanEnabled) {
      this.timedSweepTicks = 0;
      return false;
    }

    const human = this.getHumanPlayer();
    const opponents = this.players.filter((player) => !player.isHuman);
    if (!human || !human.alive || !opponents.length) {
      this.timedSweepTicks = 0;
      return false;
    }

    if (!opponents.every((player) => player.state === PLAYER_STATE.ELIMINATED)) {
      this.timedSweepTicks = 0;
      return false;
    }

    this.timedSweepTicks += 1;
    if (this.timedSweepTicks < this.config.tickRate) {
      return false;
    }

    this.finishTimedSweepVictory();
    return true;
  }

  getSuppressionTier() {
    if (!this.config.suppressionEnabled || !this.config.humanEnabled) {
      return 0;
    }
    const human = this.getHumanPlayer();
    if (!human || !human.alive) {
      return 0;
    }
    const share = this.computePercentages().get(human.id) ?? 0;
    if (share >= 90) {
      return 3;
    }
    if (share >= 75) {
      return 2;
    }
    if (share >= 50) {
      return 1;
    }
    return 0;
  }

  createPopup(x, y, text) {
    return {
      type: "popup",
      x,
      y,
      text,
      life: 14,
      maxLife: 14,
    };
  }

  createBurst(origin, color) {
    const particles = [];
    for (let index = 0; index < 12; index += 1) {
      particles.push({
        x: origin.x + (this.rng() - 0.5) * 4,
        y: origin.y + (this.rng() - 0.5) * 4,
      });
    }
    return {
      type: "burst",
      origin: { ...origin },
      color,
      particles,
      life: 12,
      maxLife: 12,
    };
  }

  pushEffect(effect) {
    this.effects.push(effect);
    if (this.effects.length > MAX_EFFECTS) {
      this.effects.shift();
    }
  }

  addEvent(message) {
    this.events.unshift(message);
    this.events = this.events.slice(0, 24);
  }

  createAiSnapshot() {
    return {
      players: this.players.map((player) => ({
        id: player.id,
        alive: player.alive,
        position: { ...player.position },
        direction: player.direction,
        state: player.state,
        trail: player.trail.map((cell) => ({ ...cell })),
        trailLength: player.trail.length,
      })),
      evaluateMove: (playerId, direction) => this.evaluateMove(playerId, direction),
      isTurnRestricted: (playerId, direction) => this.isAiTurnRestricted(this.playerMap.get(playerId), direction),
    };
  }

  evaluateMove(playerId, direction) {
    const player = this.playerMap.get(playerId);
    const next = this.projectRaw(player.position, direction);
    if (!this.isInside(next.x, next.y)) {
      return { valid: false, safe: false };
    }

    const index = this.index(next.x, next.y);
    const territoryOwner = this.territory[index];
    const trailOwner = this.trailMap[index];
    const safe = !trailOwner || trailOwner !== player.id;
    const homeCell = this.findClosestTerritoryCell(player.id, player.position);
    const nextDistance = homeCell ? manhattanDistance(next, homeCell) : 0;
    const currentDistance = homeCell ? manhattanDistance(player.position, homeCell) : 0;

    return {
      valid: true,
      safe,
      entersEmpty: territoryOwner === 0,
      claimsHome: territoryOwner === player.id && player.trail.length > 0,
      movesTowardHome: nextDistance < currentDistance,
      expandsFrontier: territoryOwner !== player.id,
    };
  }

  findClosestTerritoryCell(playerId, origin) {
    let best = null;
    let bestDistance = Infinity;
    for (let index = 0; index < this.territory.length; index += 1) {
      if (this.territory[index] !== playerId) {
        continue;
      }
      const point = { x: index % this.config.gridSize, y: Math.floor(index / this.config.gridSize) };
      const distance = manhattanDistance(origin, point);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = point;
      }
    }
    return best;
  }

  getRenderState(frameAlpha = 1) {
    return {
      frameAlpha,
      gridSize: this.config.gridSize,
      territory: this.territory,
      players: this.players,
      effects: this.effects,
      playerMap: this.playerMap,
      rankings: this.computeRankings(),
    };
  }

  getHudState() {
    const rankings = this.computeRankings();
    return {
      showHud: this.config.showHud,
      attractMode: this.config.attractMode,
      players: this.players,
      playerMap: this.playerMap,
      percentages: this.computePercentages(),
      rankings,
      remainingSeconds: Math.max(0, this.config.matchSeconds - this.ticks / this.config.tickRate),
      mode: this.mode,
      events: this.events,
      banner: this.banner,
      statusMessage: this.statusMessage,
      centerCountdownText: this.endlessCountdownText,
      paused: this.paused,
      matchComplete: this.matchComplete,
      finalResults: this.finalResults,
      respawnMessage: this.getHumanRespawnMessage(),
      performance: this.getPerformanceSnapshot(),
    };
  }

  getHumanRespawnMessage() {
    const human = this.getHumanPlayer();
    if (!human || human.alive) {
      return "";
    }
    return human.respawnStatus || human.eliminationReason;
  }

  getHumanPlayer() {
    return this.players.find((player) => player.isHuman) ?? null;
  }

  computePercentages() {
    const counts = new Map();
    for (const player of this.players) {
      counts.set(player.id, 0);
    }
    for (const owner of this.territory) {
      if (!owner) {
        continue;
      }
      counts.set(owner, (counts.get(owner) ?? 0) + 1);
    }
    const total = this.getCellCount();
    const percentages = new Map();
    for (const [id, count] of counts.entries()) {
      percentages.set(id, (count / total) * 100);
    }
    return percentages;
  }

  computeRankings() {
    const percentages = this.computePercentages();
    return [...this.players]
      .sort((left, right) => (percentages.get(right.id) ?? 0) - (percentages.get(left.id) ?? 0))
      .map((player) => ({ id: player.id }));
  }

  countTerritory(playerId) {
    let count = 0;
    for (const owner of this.territory) {
      if (owner === playerId) {
        count += 1;
      }
    }
    return count;
  }

  recordPerformance(sample) {
    this.performance.frames += 1;
    this.performance.frameMs = rollingAverage(this.performance.frameMs, sample.frameMs, this.performance.frames);
    this.performance.updateMs = rollingAverage(this.performance.updateMs, sample.updateMs, this.performance.frames);
    this.performance.renderMs = rollingAverage(this.performance.renderMs, sample.renderMs, this.performance.frames);
    this.performance.effectCount = this.effects.length;
    window.paperioLiteDiagnostics = this.getPerformanceSnapshot();
  }

  getPerformanceSnapshot() {
    return {
      frameMs: roundMetric(this.performance.frameMs),
      updateMs: roundMetric(this.performance.updateMs),
      renderMs: roundMetric(this.performance.renderMs),
      effectCount: this.performance.effectCount,
      tickRate: this.config.tickRate,
    };
  }

  setTerritory(x, y, playerId) {
    this.territory[this.index(x, y)] = playerId;
  }

  project(position, directionName) {
    const projection = this.projectRaw(position, directionName);
    return {
      x: clamp(projection.x, 0, this.config.gridSize - 1),
      y: clamp(projection.y, 0, this.config.gridSize - 1),
    };
  }

  projectRaw(position, directionName) {
    const direction = DIRECTIONS[directionName];
    return {
      x: position.x + direction.x,
      y: position.y + direction.y,
    };
  }

  isInside(x, y) {
    return x >= 0 && x < this.config.gridSize && y >= 0 && y < this.config.gridSize;
  }

  index(x, y) {
    return y * this.config.gridSize + x;
  }

  getCellCount() {
    return this.config.gridSize * this.config.gridSize;
  }
}

function rollingAverage(previous, next, count) {
  const boundedCount = Math.min(count, PERFORMANCE_SAMPLE_SIZE);
  return previous + (next - previous) / boundedCount;
}

function normalizeTickRate(value) {
  const clamped = clamp(Number(value), 6, 24);
  const stepped = 6 + Math.round((clamped - 6) / 3) * 3;
  return clamp(stepped, 6, 24);
}

function getTurnSide(fromDirection, toDirection) {
  if (!fromDirection || !toDirection || fromDirection === toDirection) {
    return null;
  }

  const fromIndex = DIRECTION_ORDER.findIndex((direction) => direction.name === fromDirection);
  const toIndex = DIRECTION_ORDER.findIndex((direction) => direction.name === toDirection);
  if (fromIndex < 0 || toIndex < 0) {
    return null;
  }

  const delta = (toIndex - fromIndex + DIRECTION_ORDER.length) % DIRECTION_ORDER.length;
  if (delta === 1) {
    return "right";
  }
  if (delta === DIRECTION_ORDER.length - 1) {
    return "left";
  }
  return null;
}

function roundMetric(value) {
  return Math.round(value * 100) / 100;
}
