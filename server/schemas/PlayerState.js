import { Schema, type, defineTypes } from "@colyseus/schema";

export class PlayerState extends Schema {}

defineTypes(PlayerState, {
  sessionId: "string",
  displayName: "string",
  slot: "number",
  ready: "boolean",
  progress: "number",
  typedCharacters: "number",
  totalCharacters: "number",
  wpm: "number",
  accuracy: "number",
  finished: "boolean",
  finishTime: "number",
  finishPosition: "number",
  connected: "boolean",
  lastActivity: "number",
});
