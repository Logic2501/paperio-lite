import { PLAYER_STATE } from "../core/constants.js";

export function createPlayer({ id, name, color, isHuman, aiProfile, spawn, direction }) {
  return {
    id,
    name,
    color,
    isHuman,
    aiProfile,
    position: { ...spawn },
    direction,
    nextDirection: direction,
    alive: true,
    state: PLAYER_STATE.IN_TERRITORY,
    trail: [],
    trailSet: new Set(),
    territoryCount: 0,
    respawnPreviewTicks: 0,
    respawnPreviewPosition: null,
    respawnStatus: "",
    respawnStatusDirty: "",
    aiTurnCooldown: 0,
    stats: {
      kills: 0,
      deaths: 0,
      captures: 0,
    },
  };
}
