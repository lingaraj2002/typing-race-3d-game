import { renderLanding } from "./ui/landing.js";
import { renderNameEntry } from "./ui/nameEntry.js";
import { renderGameMode } from "./ui/gameMode.js";
import { renderLobby } from "./ui/lobby.js";
import { renderCreateRoom } from "./ui/createRoom.js";
import { renderJoinRoom } from "./ui/joinRoom.js";
import { quickJoin, createRoom, joinRoomByCode } from "./network/roomClient.js";
import { startMultiplayerRace, startSinglePlayerRace } from "./game/race.js";

const app = document.getElementById("app");
const defaultName = "Player";

function showLanding() {
  renderLanding(app, showNameEntry);
}

function showNameEntry() {
  renderNameEntry(app, (name) => showGameMode(name));
}

function showGameMode(name = defaultName) {
  renderGameMode(app, {
    onPlayBots: () => startSinglePlayerRace(app),

    onQuickRace: async () => {
      const room = await quickJoin({ displayName: name });
      renderLobby(app, room, () => startMultiplayerRace(app, room));
    },

    onCreateRoom: () => {
      renderCreateRoom(app, async ({ roomName, password }) => {
        const room = await createRoom({
          roomName,
          password,
          displayName: name,
        });
        renderLobby(app, room, () => startMultiplayerRace(app, room));
      });
    },

    onJoinRoom: () => {
      renderJoinRoom(app, async ({ roomCode, password }) => {
        try {
          const room = await joinRoomByCode(roomCode, {
            displayName: name,
            password,
          });
          renderLobby(app, room, () => startMultiplayerRace(app, room));
        } catch (err) {
          document.getElementById("join-error").textContent =
            "Could not join — check the code/password.";
        }
      });
    },
  });
}

showLanding();
