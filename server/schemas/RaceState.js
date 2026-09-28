import { Schema, defineTypes, MapSchema } from "@colyseus/schema";
import { PlayerState } from "./PlayerState.js";

export class RaceState extends Schema {
  constructor() {
    super();
    this.players = new MapSchema();
  }
}

defineTypes(RaceState, {
  roomCode: "string",
  roomName: "string",
  isPrivate: "boolean",
  status: "string",
  hostId: "string",
  maxPlayers: "number",
  currentTextId: "string",
  countdown: "number",
  raceStartTime: "number",
  players: { map: PlayerState },
});
