import { DIRECTION_ORDER, OPPOSITE_DIRECTION, PLAYER_STATE } from "../core/constants.js";
import { manhattanDistance, shuffleInPlace } from "../core/utils.js";

export class AIAgent {
  constructor(playerId, profile, rng) {
    this.playerId = playerId;
    this.profile = profile;
    this.rng = rng;
  }

  update(snapshot) {
    const self = snapshot.players.find((player) => player.id === this.playerId);
    if (!self || !self.alive) {
      return null;
    }

    const directions = shuffleInPlace(
      DIRECTION_ORDER.map((direction) => direction.name).filter(
        (direction) => OPPOSITE_DIRECTION[self.direction] !== direction,
      ),
      this.rng,
    );

    const enemyTrailTarget = this.findClosestEnemyTrail(self, snapshot);
    const shouldReturn = self.state === PLAYER_STATE.TRAILING && self.trailLength >= this.profile.maxTrail;

    const restrictedChoice = this.chooseDirection({
      self,
      snapshot,
      directions,
      enemyTrailTarget,
      shouldReturn,
      respectRestrictions: true,
    });

    if (restrictedChoice !== null) {
      return restrictedChoice;
    }

    return (
      this.chooseDirection({
        self,
        snapshot,
        directions,
        enemyTrailTarget,
        shouldReturn,
        respectRestrictions: false,
      }) ?? self.direction
    );
  }

  chooseDirection({ self, snapshot, directions, enemyTrailTarget, shouldReturn, respectRestrictions }) {
    let bestDirection = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const direction of directions) {
      if (respectRestrictions && snapshot.isTurnRestricted?.(self.id, direction)) {
        continue;
      }

      const next = project(self.position, direction);
      const evaluation = snapshot.evaluateMove(self.id, direction);
      if (!evaluation.valid) {
        continue;
      }

      let score = evaluation.safe ? 3 : -12;
      if (evaluation.claimsHome) {
        score += 18;
      }
      if (evaluation.entersEmpty) {
        score += this.profile.aggression * 8;
      }
      if (shouldReturn && evaluation.movesTowardHome) {
        score += 12;
      }
      if (!shouldReturn && evaluation.expandsFrontier) {
        score += 6;
      }
      if (enemyTrailTarget) {
        const afterDistance = manhattanDistance(next, enemyTrailTarget);
        score += Math.max(0, this.profile.interceptRange - afterDistance) * this.profile.aggression;
      }
      if (!evaluation.safe) {
        score -= (1 - this.profile.riskTolerance) * 20;
      }

      if (score > bestScore) {
        bestScore = score;
        bestDirection = direction;
      }
    }

    return bestDirection;
  }

  findClosestEnemyTrail(self, snapshot) {
    let closest = null;
    let distance = Infinity;
    for (const player of snapshot.players) {
      if (player.id === self.id || !player.alive) {
        continue;
      }
      for (const cell of player.trail) {
        const nextDistance = manhattanDistance(self.position, cell);
        if (nextDistance < distance) {
          distance = nextDistance;
          closest = cell;
        }
      }
    }
    return distance <= this.profile.interceptRange ? closest : null;
  }
}

function project(position, direction) {
  if (direction === "up") {
    return { x: position.x, y: position.y - 1 };
  }
  if (direction === "down") {
    return { x: position.x, y: position.y + 1 };
  }
  if (direction === "left") {
    return { x: position.x - 1, y: position.y };
  }
  return { x: position.x + 1, y: position.y };
}
