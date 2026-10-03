import { startSinglePlayerRace } from "./game/race.js";

// Keep a direct single-race entry point for development while the browser
// entry uses multiplayerMain.js to show the mode-selection flow.
startSinglePlayerRace(document.getElementById("app"));