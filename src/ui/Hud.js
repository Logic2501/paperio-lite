import { MAX_EVENT_LOG } from "../core/constants.js";
import { formatPercent, formatTime } from "../core/utils.js";

export class Hud {
  constructor(elements) {
    this.elements = elements;
    this.game = null;
    this.input = null;
    this.bound = false;
  }

  bind(game, input) {
    this.game = game;
    this.input = input;
    if (this.bound) {
      return;
    }
    this.bound = true;
    this.elements.restartButton.addEventListener("click", () => this.game?.restart());
    this.elements.modeButton.addEventListener("click", () => this.game?.toggleMode());
    this.elements.pauseButton.addEventListener("click", () => this.input?.requestPauseToggle());
    this.elements.overlayRestartButton.addEventListener("click", () => this.game?.restart());
    for (const button of this.elements.directionButtons) {
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        this.input?.queueDirection(button.dataset.direction);
      });
    }
  }

  update(state) {
    const player = state.players.find((entry) => entry.isHuman);
    const share = player ? state.percentages.get(player.id) || 0 : 0;
    this.elements.territoryBar.style.width = `${share}%`;
    this.elements.territoryValue.textContent = formatPercent(share);
    this.elements.timerValue.textContent =
      state.mode === "timed" ? formatTime(state.remainingSeconds) : "ENDLESS";
    this.renderModeButton(state.mode);
    this.elements.pauseButton.classList.toggle("is-paused", state.paused && !state.matchComplete);
    this.elements.pauseButton.disabled = state.matchComplete;
    this.renderLeaderboard(state.rankings, state.playerMap, state.percentages);
    this.renderEvents(state.events);
    this.renderFinalResults(state.finalResults, state.playerMap, state.percentages);
    this.renderCenterCountdown(state.centerCountdownText);

    const bannerText = state.matchComplete
      ? ""
      : state.paused
        ? "Paused"
        : state.statusMessage || state.respawnMessage || state.banner;
    if (bannerText) {
      this.elements.statusBanner.textContent = bannerText;
      this.elements.statusBanner.classList.remove("hidden");
    } else {
      this.elements.statusBanner.classList.add("hidden");
    }
  }

  renderLeaderboard(rankings, playerMap, percentages) {
    this.elements.leaderboard.innerHTML = rankings
      .map((entry, index) => {
        const player = playerMap.get(entry.id);
        const crown = index === 0 ? " Crown" : "";
        return `
          <li>
            <div class="leader-entry">
              <span class="leader-name">
                <span class="leader-swatch" style="background:${player.color}"></span>
                ${player.name}${crown}
              </span>
              <strong>${formatPercent(percentages.get(player.id) || 0)}</strong>
            </div>
          </li>
        `;
      })
      .join("");
  }

  renderEvents(events) {
    const recent = events.slice(0, MAX_EVENT_LOG);
    this.elements.eventLog.innerHTML = recent.map((event) => `<div class="event-item">${event}</div>`).join("");
  }

  renderFinalResults(results, playerMap, percentages) {
    if (!results) {
      this.elements.finalResults.classList.add("hidden");
      return;
    }

    this.elements.finalTitle.textContent = results.title;
    this.elements.finalSubtitle.textContent = results.subtitle;
    this.elements.finalRankings.innerHTML = results.rankings
      .map((entry, index) => {
        const player = playerMap.get(entry.id);
        return `
          <li>
            <span class="final-rank-index">${index + 1}</span>
            <span class="leader-name">
              <span class="leader-swatch" style="background:${player.color}"></span>
              ${player.name}
            </span>
            <strong>${formatPercent(percentages.get(player.id) || 0)}</strong>
          </li>
        `;
      })
      .join("");
    this.elements.finalResults.classList.remove("hidden");
  }

  renderCenterCountdown(text) {
    if (!text) {
      this.elements.centerCountdown.classList.add("hidden");
      this.elements.centerCountdown.textContent = "";
      return;
    }
    this.elements.centerCountdown.textContent = text;
    this.elements.centerCountdown.classList.remove("hidden");
  }

  renderModeButton(mode) {
    this.elements.modeButton.dataset.mode = mode;
    this.elements.modeButton.setAttribute("aria-label", "Toggle mode");
  }
}
