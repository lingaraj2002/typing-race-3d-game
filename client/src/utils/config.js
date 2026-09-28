const isDev = location.hostname === "localhost";
export const COLYSEUS_URL = isDev
  ? "ws://localhost:2567"
  : "wss://YOUR-APP.colyseus.cloud";
