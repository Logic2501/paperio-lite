import { GAME_MODE } from "./core/constants.js";
import { InputController } from "./core/input.js";
import { Renderer } from "./render/Renderer.js";
import { Hud } from "./ui/Hud.js";
import { Game } from "./game/Game.js";

const canvas = document.getElementById("gameCanvas");
const hud = new Hud({
  territoryBar: document.getElementById("territoryBar"),
  territoryValue: document.getElementById("territoryValue"),
  timerValue: document.getElementById("timerValue"),
  leaderboard: document.getElementById("leaderboard"),
  eventLog: document.getElementById("eventLog"),
  statusBanner: document.getElementById("statusBanner"),
  restartButton: document.getElementById("restartButton"),
  modeButton: document.getElementById("modeButton"),
});

const game = new Game({
  renderer: new Renderer(canvas),
  input: new InputController(window),
  hud,
  aiCount: 5,
  mode: GAME_MODE.TIMED,
});

window.paperioLite = game;
