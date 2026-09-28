export function renderGameMode(
  container,
  { onPlayBots, onQuickRace, onCreateRoom, onJoinRoom },
) {
  container.innerHTML = `
    <div class="kid-screen kid-screen--mode">
      <main class="kid-panel kid-panel--mode">
        <p class="kid-eyebrow">Pick your race</p>
        <h1 class="kid-heading">Select Mode</h1>
        <div class="kid-mode-list">
          <button id="btn-bots" class="kid-mode-button kid-mode-button--yellow" type="button">Single Player</button>
          <button id="btn-quick" class="kid-mode-button kid-mode-button--mint" type="button">Quick Race</button>
          <button id="btn-create" class="kid-mode-button kid-mode-button--coral" type="button">Create Room</button>
          <button id="btn-join" class="kid-mode-button kid-mode-button--blue" type="button">Join Room</button>
        </div>
      </main>
    </div>
  `;
  document.getElementById("btn-bots").addEventListener("click", onPlayBots);
  document.getElementById("btn-quick").addEventListener("click", onQuickRace);
  document.getElementById("btn-create").addEventListener("click", onCreateRoom);
  document.getElementById("btn-join").addEventListener("click", onJoinRoom);
}
