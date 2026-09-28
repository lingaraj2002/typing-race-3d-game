import { getStateCallbacks } from "@colyseus/sdk";

export function renderLobby(container, room, onRaceStart) {
  container.innerHTML = `
    <div style="color:white; font-family:monospace; text-align:center; padding-top:60px;">
      <h2 id="room-title">Lobby — Room ...</h2>
      <div id="player-list"></div>
      <button id="ready-btn" style="margin-top:20px; padding:10px 20px;">Ready</button>
      <button id="start-btn" style="margin-top:10px; padding:10px 20px; display:none;">Start Race</button>
    </div>
  `;

  const $ = getStateCallbacks(room);
  const listEl = document.getElementById("player-list");
  const titleEl = document.getElementById("room-title");

  function refreshList() {
    const players = [...room.state.players.values()];
    listEl.innerHTML = players
      .map(
        (p) =>
          `${p.displayName} ${p.ready ? "✅" : "⏳"} ${p.sessionId === room.state.hostId ? "(Host)" : ""}`,
      )
      .join("<br>");
  }

  $(room.state).listen("status", (value) => {
    if (value === "countdown" || value === "racing") {
      onRaceStart(); // hand off to the race screen
    }
  });

  // update the title the moment roomCode actually arrives, and any time it changes
  $(room.state).listen("roomCode", (value) => {
    titleEl.textContent = `Lobby — Room ${value}`;
  });

  $(room.state).players.onAdd((player, sessionId) => {
    refreshList();
    // listen for changes on THIS specific player's fields
    $(player).listen("ready", () => refreshList());
    $(player).listen("displayName", () => refreshList());
  });

  $(room.state).players.onAdd(() => refreshList());
  $(room.state).players.onRemove(() => refreshList());
  $(room.state).players.onChange(() => refreshList());

  document.getElementById("ready-btn").addEventListener("click", () => {
    room.send("ready", true);
  });

  document.getElementById("start-btn").addEventListener("click", () => {
    room.send("startRace");
  });

  $(room.state).listen("hostId", (hostId) => {
    const startBtn = document.getElementById("start-btn");
    startBtn.style.display =
      room.sessionId === hostId ? "inline-block" : "none";
  });
}
