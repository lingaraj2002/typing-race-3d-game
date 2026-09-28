export function renderJoinRoom(container, onSubmit) {
  container.innerHTML = `
    <div style="color:white; font-family:monospace; text-align:center; padding-top:100px;">
      <h2>Join Room</h2>
      <input id="join-code" placeholder="Room code" maxlength="10" style="font-size:16px; padding:8px;" /><br><br>
      <input id="join-password" placeholder="Password (if any)" maxlength="16" style="font-size:16px; padding:8px;" /><br><br>
      <button id="join-submit" style="padding:10px 20px;">Join</button>
      <div id="join-error" style="color:red; margin-top:10px;"></div>
    </div>
  `;

  document.getElementById("join-submit").addEventListener("click", () => {
    console.log("Join button clicked");
    const roomCode = document.getElementById("join-code").value.trim();
    const password =
      document.getElementById("join-password").value.trim() || undefined;
    console.log("Submitting join with:", roomCode, password);
    onSubmit({ roomCode, password });
  });
}
