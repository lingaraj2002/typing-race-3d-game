export function renderCreateRoom(container, onSubmit) {
  container.innerHTML = `
    <div style="color:white; font-family:monospace; text-align:center; padding-top:100px;">
      <h2>Create Room</h2>
      <input id="room-name" placeholder="Room name" maxlength="20" style="font-size:16px; padding:8px;" /><br><br>
      <input id="room-password" placeholder="Password (optional)" maxlength="16" style="font-size:16px; padding:8px;" /><br><br>
      <button id="create-submit" style="padding:10px 20px;">Create</button>
    </div>
  `;
  document.getElementById("create-submit").addEventListener("click", () => {
    const roomName =
      document.getElementById("room-name").value.trim() || "Race";
    const password =
      document.getElementById("room-password").value.trim() || undefined;
    onSubmit({ roomName, password });
  });
}
