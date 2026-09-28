export function renderLanding(container, onStart) {
  container.innerHTML = `
    <div class="kid-screen kid-screen--landing">
      <main class="kid-panel kid-panel--landing">
        <div class="kid-race-mark" aria-hidden="true"><span></span><span></span></div>
        <p class="kid-eyebrow">Ready, set, type!</p>
        <h1 class="kid-title">Typing Race</h1>
        <div class="kid-road" aria-hidden="true"><span></span><span></span><span></span></div>
        <button id="start-btn" class="kid-button kid-button--coral" type="button">Play</button>
      </main>
    </div>
  `;
  document.getElementById("start-btn").addEventListener("click", onStart);
}
