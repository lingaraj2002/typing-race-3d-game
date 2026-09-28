import { Client } from "@colyseus/sdk";

const isDev = location.hostname === "localhost";
const COLYSEUS_URL = isDev
  ? "ws://localhost:2567"
  : "wss://YOUR-APP.colyseus.cloud"; // update once deployed, Phase 17

export const client = new Client(COLYSEUS_URL);
