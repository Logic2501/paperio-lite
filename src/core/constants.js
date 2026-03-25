export const GRID_SIZE = 36;
export const TICK_RATE = 15;
export const RESPAWN_PREVIEW_TICKS = TICK_RATE * 3;
export const DEFAULT_MATCH_SECONDS = 60;
export const MAX_EVENT_LOG = 6;
export const INITIAL_TERRITORY_RADIUS = 2;
export const RESPAWN_CLEAR_RADIUS = 4;
export const RESPAWN_ELIMINATION_SECONDS = 10;
export const ENDLESS_LOCKOUT_VICTORY_SECONDS = 10;
export const PERFORMANCE_SAMPLE_SIZE = 120;
export const MAX_EFFECTS = 36;
export const PLAYER_COLORS = [
  "#23a6d5",
  "#ff6b6b",
  "#4ecb71",
  "#f7b731",
  "#9b59b6",
  "#ff8a5b",
  "#00c2a8",
  "#3b82f6",
];

export const DIRECTIONS = {
  up: { x: 0, y: -1, name: "up" },
  right: { x: 1, y: 0, name: "right" },
  down: { x: 0, y: 1, name: "down" },
  left: { x: -1, y: 0, name: "left" },
};

export const DIRECTION_ORDER = [
  DIRECTIONS.up,
  DIRECTIONS.right,
  DIRECTIONS.down,
  DIRECTIONS.left,
];

export const OPPOSITE_DIRECTION = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

export const PLAYER_STATE = {
  IN_TERRITORY: "inTerritory",
  TRAILING: "trailing",
  CLOSING: "closing",
  DEAD: "dead",
  RESPAWNING: "respawning",
  ELIMINATED: "eliminated",
};

export const GAME_MODE = {
  TIMED: "timed",
  ENDLESS: "endless",
};

export const DEFAULT_GAME_OPTIONS = {
  aiCount: 3,
  tickRate: TICK_RATE,
  gridSize: GRID_SIZE,
  mode: GAME_MODE.TIMED,
  matchSeconds: DEFAULT_MATCH_SECONDS,
  suppressionEnabled: false,
  humanEnabled: true,
  showHud: true,
  attractMode: false,
  maxDevicePixelRatio: 2,
};

export const AI_PROFILES = {
  cautious: {
    aggression: 0.22,
    maxTrail: 10,
    interceptRange: 6,
    riskTolerance: 0.35,
    turnInterval: 4,
  },
  balanced: {
    aggression: 0.42,
    maxTrail: 16,
    interceptRange: 8,
    riskTolerance: 0.5,
    turnInterval: 3,
  },
  aggressive: {
    aggression: 0.68,
    maxTrail: 22,
    interceptRange: 11,
    riskTolerance: 0.72,
    turnInterval: 2,
  },
};
