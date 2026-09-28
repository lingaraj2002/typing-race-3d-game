export function renderNameEntry(container, onSubmit) {
  container.innerHTML = `
    <div class="kid-screen kid-screen--name">
      <main class="kid-panel">
        <div class="kid-flag" aria-hidden="true">GO!</div>
        <p class="kid-eyebrow">New racer</p>
        <h1 class="kid-heading">What's your name?</h1>
        <input id="name-input" class="kid-input" maxlength="16" autocomplete="nickname" placeholder="Type your name" />
        <button id="name-submit" class="kid-button kid-button--mint" type="button">Continue</button>
      </main>
    </div>
  `;
  const input = document.getElementById("name-input");
  const submit = () => {
    const name = input.value.trim().slice(0, 16) || "Player";
    onSubmit(name);
  };
  document.getElementById("name-submit").addEventListener("click", submit);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") submit();
  });
  input.focus();
}
