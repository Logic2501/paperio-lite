import {
  AI_PROFILES,
  DEFAULT_MATCH_SECONDS,
  DIRECTIONS,
  DIRECTION_ORDER,
  GAME_MODE,
  GRID_SIZE,
  INITIAL_TERRITORY_RADIUS,
  OPPOSITE_DIRECTION,
  PLAYER_COLORS,
  PLAYER_STATE,
  RESPAWN_TICKS,
  TICK_RATE,
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
      gridSize: GRID_SIZE,
      aiCount: config.aiCount ?? 5,
      tickRate: TICK_RATE,
      mode: config.mode ?? GAME_MODE.TIMED,
      matchSeconds: config.matchSeconds ?? DEFAULT_MATCH_SECONDS,
      seed: config.seed ?? Date.now(),
    };
    this.rng = createRng(this.config.seed);
    this.frameId = null;
    this.paused = false;
    this.input.attach();
    this.hud.bind(this);
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
    this.ticks = 0;
    this.accumulator = 0;
    this.lastTimestamp = 0;
    this.running = false;
    this.bannerTicks = preserveBanner ? this.config.tickRate * 4 : 0;
    this.banner = preserveBanner ? this.banner : "";
    this.events = preserveBanner ? [this.banner, ...this.events].slice(0, 24) : [];
    this.effects = [];
    this.territory = new Uint16Array(GRID_SIZE * GRID_SIZE);
    this.trailMap = new Uint16Array(GRID_SIZE * GRID_SIZE);
    this.players = [];
    this.playerMap = new Map();
    this.agents = new Map();
    this.spawnPlayers();
    this.addEvent("Fresh match started.");
    this.start();
  }

  toggleMode() {
    this.config.mode = this.config.mode === GAME_MODE.TIMED ? GAME_MODE.ENDLESS : GAME_MODE.TIMED;
    this.restart();
  }

  spawnPlayers() {
    const profiles = ["balanced", "cautious", "aggressive", "balanced", "aggressive"];
    const spawnColumns = this.scaleSpawnFractions([0.16, 0.82, 0.82, 0.18, 0.5, 0.5]);
    const spawnRows = this.scaleSpawnFractions([0.16, 0.18, 0.82, 0.82, 0.28, 0.72]);
    const directions = ["right", "left", "left", "right", "down", "up"];

    const human = createPlayer({
      id: 1,
      name: "You",
      color: PLAYER_COLORS[0],
      isHuman: true,
      spawn: { x: spawnColumns[0], y: spawnRows[0] },
      direction: directions[0],
    });
    this.players.push(human);
    this.playerMap.set(human.id, human);

    for (let index = 0; index < this.config.aiCount; index += 1) {
      const player = createPlayer({
        id: index + 2,
        name: `AI-${index + 1}`,
        color: PLAYER_COLORS[index + 1],
        isHuman: false,
        aiProfile: profiles[index % profiles.length],
        spawn: { x: spawnColumns[index + 1], y: spawnRows[index + 1] },
        direction: directions[index + 1],
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
    for (let dy = -INITIAL_TERRITORY_RADIUS; dy <= INITIAL_TERRITORY_RADIUS; dy += 1) {
      for (let dx = -INITIAL_TERRITORY_RADIUS; dx <= INITIAL_TERRITORY_RADIUS; dx += 1) {
        const x = clamp(player.position.x + dx, 0, GRID_SIZE - 1);
        const y = clamp(player.position.y + dy, 0, GRID_SIZE - 1);
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

    while (!this.paused && this.accumulator >= tickLength) {
      this.updateTick();
      this.accumulator -= tickLength;
    }

    this.renderer.render(this.getRenderState());
    this.hud.update(this.getHudState());
    this.frameId = requestAnimationFrame(this.loop);
  };

  togglePause() {
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

    for (const effect of this.effects) {
      effect.life -= 1;
    }
    this.effects = this.effects.filter((effect) => effect.life > 0);

    const intents = [];
    for (const player of this.players) {
      if (!player.alive) {
        this.updateRespawn(player);
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
        direction: resolvedDirection,
        next: this.project(player.position, resolvedDirection),
      });
    }

    for (const intent of intents) {
      intent.player.direction = intent.direction;
      intent.player.position = intent.next;
    }

    this.resolveCollisions(intents);

    for (const player of this.players) {
      if (player.alive) {
        this.resolveTerritoryState(player);
      }
    }

    if (this.mode === GAME_MODE.TIMED) {
      const remaining = this.config.matchSeconds - this.ticks / this.config.tickRate;
      if (remaining <= 0) {
        this.finishTimedMatch();
      }
    }
  }

  updateRespawn(player) {
    if (player.respawnTicks <= 0) {
      return;
    }
    player.respawnTicks -= 1;
    if (player.respawnTicks === 0) {
      this.respawnPlayer(player);
    }
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

    const share = (totalClaimed / (GRID_SIZE * GRID_SIZE)) * 100;
    if (totalClaimed > 0) {
      this.effects.push(this.createPopup(player.position.x + 0.2, player.position.y - 0.2, `+${share.toFixed(2)}%`));
      this.effects.push(this.createBurst(player.position, player.color));
      this.addEvent(`${player.name} claimed ${formatPercent(share)}.`);
    }
  }

  fillEnclosedArea(player) {
    const blocked = new Uint8Array(GRID_SIZE * GRID_SIZE);
    for (let index = 0; index < blocked.length; index += 1) {
      if (this.territory[index] === player.id || this.trailMap[index] === player.id) {
        blocked[index] = 1;
      }
    }

    const visited = new Uint8Array(GRID_SIZE * GRID_SIZE);
    const queue = [];

    for (let x = 0; x < GRID_SIZE; x += 1) {
      this.enqueueFill(x, 0, blocked, visited, queue);
      this.enqueueFill(x, GRID_SIZE - 1, blocked, visited, queue);
    }
    for (let y = 0; y < GRID_SIZE; y += 1) {
      this.enqueueFill(0, y, blocked, visited, queue);
      this.enqueueFill(GRID_SIZE - 1, y, blocked, visited, queue);
    }

    while (queue.length) {
      const current = queue.shift();
      for (const direction of DIRECTION_ORDER) {
        this.enqueueFill(current.x + direction.x, current.y + direction.y, blocked, visited, queue);
      }
    }

    let claimed = 0;
    for (let y = 0; y < GRID_SIZE; y += 1) {
      for (let x = 0; x < GRID_SIZE; x += 1) {
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
    player.respawnTicks = RESPAWN_TICKS;

    const fadedCells = [];
    for (let index = 0; index < this.territory.length; index += 1) {
      if (this.territory[index] !== player.id) {
        continue;
      }
      this.territory[index] = 0;
      const x = index % GRID_SIZE;
      const y = Math.floor(index / GRID_SIZE);
      fadedCells.push({ x, y });
    }

    for (const cell of player.trail) {
      this.trailMap[this.index(cell.x, cell.y)] = 0;
    }
    player.trail = [];
    player.trailSet.clear();
    player.territoryCount = 0;

    this.effects.push(this.createBurst(player.position, player.color));
    if (fadedCells.length) {
      this.effects.push({
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

  respawnPlayer(player) {
    const spawn = this.findSpawnPoint();
    player.position = spawn;
    player.direction = this.pickDirection();
    player.nextDirection = player.direction;
    player.aiTurnCooldown = 0;
    player.alive = true;
    player.state = PLAYER_STATE.RESPAWNING;
    this.claimInitialTerritory(player);
    this.addEvent(`${player.name} respawned.`);
  }

  findSpawnPoint() {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const x = 6 + Math.floor(this.rng() * (GRID_SIZE - 12));
      const y = 6 + Math.floor(this.rng() * (GRID_SIZE - 12));
      let safe = true;
      for (const player of this.players) {
        if (!player.alive) {
          continue;
        }
        if (manhattanDistance({ x, y }, player.position) < 10) {
          safe = false;
          break;
        }
      }
      if (safe) {
        return { x, y };
      }
    }
    return { x: 10, y: 10 };
  }

  scaleSpawnFractions(fractions) {
    return fractions.map((fraction) => clamp(Math.round((GRID_SIZE - 1) * fraction), 6, GRID_SIZE - 7));
  }

  pickDirection() {
    return DIRECTION_ORDER[Math.floor(this.rng() * DIRECTION_ORDER.length)].name;
  }

  finishTimedMatch() {
    const rankings = this.computeRankings();
    const leader = rankings[0] ? this.playerMap.get(rankings[0].id) : null;
    this.banner = leader ? `${leader.name} wins the timed round.` : "Match complete.";
    this.addEvent(this.banner);
    this.restart(true);
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
    for (let index = 0; index < 16; index += 1) {
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
      const point = { x: index % GRID_SIZE, y: Math.floor(index / GRID_SIZE) };
      const distance = manhattanDistance(origin, point);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = point;
      }
    }
    return best;
  }

  getRenderState() {
    return {
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
      players: this.players,
      playerMap: this.playerMap,
      percentages: this.computePercentages(),
      rankings,
      remainingSeconds: Math.max(0, this.config.matchSeconds - this.ticks / this.config.tickRate),
      mode: this.mode,
      events: this.events,
      banner: this.banner,
      paused: this.paused,
    };
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
    const total = GRID_SIZE * GRID_SIZE;
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

  setTerritory(x, y, playerId) {
    this.territory[this.index(x, y)] = playerId;
  }

  project(position, directionName) {
    const projection = this.projectRaw(position, directionName);
    return {
      x: clamp(projection.x, 0, GRID_SIZE - 1),
      y: clamp(projection.y, 0, GRID_SIZE - 1),
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
    return x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE;
  }

  index(x, y) {
    return y * GRID_SIZE + x;
  }
}
