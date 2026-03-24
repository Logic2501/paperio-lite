import { MAX_EVENT_LOG } from "../core/constants.js";
import { formatPercent, formatTime } from "../core/utils.js";

export class Hud {
  constructor(elements) {
    this.elements = elements;
  }

  bind(game) {
    this.elements.restartButton.addEventListener("click", () => game.restart());
    this.elements.modeButton.addEventListener("click", () => game.toggleMode());
  }

  update(state) {
    const player = state.players.find((entry) => entry.isHuman);
    const share = player ? state.percentages.get(player.id) || 0 : 0;
    this.elements.territoryBar.style.width = `${share}%`;
    this.elements.territoryValue.textContent = formatPercent(share);
    this.elements.timerValue.textContent =
      state.mode === "timed" ? formatTime(state.remainingSeconds) : "ENDLESS";
    this.elements.modeButton.textContent = `Mode: ${state.mode === "timed" ? "Timed" : "Endless"}`;
    this.renderLeaderboard(state.rankings, state.playerMap, state.percentages);
    this.renderEvents(state.events);

    const bannerText = state.paused ? "Paused" : state.respawnMessage || state.banner;
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
}
