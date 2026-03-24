import { DEFAULT_GAME_OPTIONS, GAME_MODE } from "./core/constants.js";
import { InputController } from "./core/input.js";
import { Renderer } from "./render/Renderer.js";
import { Hud } from "./ui/Hud.js";
import { Game } from "./game/Game.js";

const canvas = document.getElementById("gameCanvas");
const input = new InputController({
  keyboardTarget: window,
  touchTarget: canvas,
});
const renderer = new Renderer(canvas, {
  gridSize: DEFAULT_GAME_OPTIONS.gridSize,
  maxDevicePixelRatio: DEFAULT_GAME_OPTIONS.maxDevicePixelRatio,
});
const hud = new Hud({
  territoryBar: document.getElementById("territoryBar"),
  territoryValue: document.getElementById("territoryValue"),
  timerValue: document.getElementById("timerValue"),
  leaderboard: document.getElementById("leaderboard"),
  eventLog: document.getElementById("eventLog"),
  statusBanner: document.getElementById("statusBanner"),
  restartButton: document.getElementById("restartButton"),
  modeButton: document.getElementById("modeButton"),
  pauseButton: document.getElementById("pauseButton"),
  directionButtons: document.querySelectorAll("[data-direction]"),
  centerCountdown: document.getElementById("centerCountdown"),
  finalResults: document.getElementById("finalResults"),
  finalTitle: document.getElementById("finalTitle"),
  finalSubtitle: document.getElementById("finalSubtitle"),
  finalRankings: document.getElementById("finalRankings"),
  overlayRestartButton: document.getElementById("overlayRestartButton"),
});

const menuElements = {
  startScreen: document.getElementById("startScreen"),
  startButton: document.getElementById("menuStartButton"),
  openButtonDesktop: document.getElementById("menuOpenButtonDesktop"),
  openButtonMobile: document.getElementById("menuOpenButtonMobile"),
  modeTimedButton: document.getElementById("menuModeTimed"),
  modeEndlessButton: document.getElementById("menuModeEndless"),
  aiCountInput: document.getElementById("aiCountInput"),
  aiCountValue: document.getElementById("aiCountValue"),
  tickRateInput: document.getElementById("tickRateInput"),
  gridSizeSelect: document.getElementById("gridSizeSelect"),
  suppressionToggle: document.getElementById("suppressionToggle"),
};

const menuState = {
  mode: GAME_MODE.TIMED,
  editingInGame: false,
  resumeAfterClose: false,
};

let game = null;

function readMenuConfig() {
  return {
    ...DEFAULT_GAME_OPTIONS,
    aiCount: Number(menuElements.aiCountInput.value),
    tickRate: Number(menuElements.tickRateInput.value),
    gridSize: Number(menuElements.gridSizeSelect.value),
    mode: menuState.mode,
    suppressionEnabled: menuElements.suppressionToggle.checked,
    humanEnabled: true,
    showHud: true,
    attractMode: false,
  };
}

function createGame(options) {
  if (game) {
    game.destroy();
  }

  game = new Game({
    renderer,
    input,
    hud,
    ...options,
  });

  window.paperioLite = game;
}

function createDemoGame() {
  createGame({
    ...DEFAULT_GAME_OPTIONS,
    mode: GAME_MODE.ENDLESS,
    aiCount: DEFAULT_GAME_OPTIONS.aiCount,
    gridSize: DEFAULT_GAME_OPTIONS.gridSize,
    humanEnabled: false,
    showHud: true,
    attractMode: true,
    suppressionEnabled: false,
  });
}

function applyConfigToMenu(options) {
  menuState.mode = options.mode ?? GAME_MODE.TIMED;
  menuElements.aiCountInput.value = String(options.aiCount ?? DEFAULT_GAME_OPTIONS.aiCount);
  menuElements.tickRateInput.value = String(options.tickRate ?? DEFAULT_GAME_OPTIONS.tickRate);
  menuElements.gridSizeSelect.value = String(options.gridSize ?? DEFAULT_GAME_OPTIONS.gridSize);
  menuElements.suppressionToggle.checked = Boolean(options.suppressionEnabled);
  syncMenuUi();
}

function syncMenuUi() {
  menuElements.aiCountValue.textContent = menuElements.aiCountInput.value;
  menuElements.modeTimedButton.classList.toggle("active", menuState.mode === GAME_MODE.TIMED);
  menuElements.modeEndlessButton.classList.toggle("active", menuState.mode === GAME_MODE.ENDLESS);
  menuElements.startButton.textContent = menuState.editingInGame ? "Continue" : "Start Match";

  const disableRestartSettings = menuState.editingInGame;
  menuElements.aiCountInput.disabled = disableRestartSettings;
  menuElements.gridSizeSelect.disabled = disableRestartSettings;
  menuElements.suppressionToggle.disabled = disableRestartSettings;
  menuElements.modeTimedButton.disabled = disableRestartSettings;
  menuElements.modeEndlessButton.disabled = disableRestartSettings;
}

function openMenu() {
  if (game && !game.config.attractMode && !game.matchComplete) {
    menuState.editingInGame = true;
    menuState.resumeAfterClose = !game.paused;
    applyConfigToMenu(game.config);
    game.setMenuPause(true);
  } else {
    menuState.editingInGame = false;
    menuState.resumeAfterClose = false;
    applyConfigToMenu(DEFAULT_GAME_OPTIONS);
    createDemoGame();
  }
  document.body.classList.add("menu-open");
  menuElements.startScreen.classList.remove("hidden");
}

function startConfiguredGame() {
  if (menuState.editingInGame && game && !game.config.attractMode) {
    game.setTickRate(Number(menuElements.tickRateInput.value));
    document.body.classList.remove("menu-open");
    menuElements.startScreen.classList.add("hidden");
    if (menuState.resumeAfterClose) {
      game.setMenuPause(false);
    }
    menuState.editingInGame = false;
    menuState.resumeAfterClose = false;
    syncMenuUi();
    return;
  }

  document.body.classList.remove("menu-open");
  menuElements.startScreen.classList.add("hidden");
  menuState.editingInGame = false;
  menuState.resumeAfterClose = false;
  createGame(readMenuConfig());
}

menuElements.aiCountInput.addEventListener("input", syncMenuUi);
menuElements.tickRateInput.addEventListener("input", syncMenuUi);
menuElements.modeTimedButton.addEventListener("click", () => {
  menuState.mode = GAME_MODE.TIMED;
  syncMenuUi();
});
menuElements.modeEndlessButton.addEventListener("click", () => {
  menuState.mode = GAME_MODE.ENDLESS;
  syncMenuUi();
});
menuElements.startButton.addEventListener("click", startConfiguredGame);
menuElements.openButtonDesktop.addEventListener("click", openMenu);
menuElements.openButtonMobile.addEventListener("click", openMenu);

document.body.classList.add("menu-open");
syncMenuUi();
createDemoGame();
