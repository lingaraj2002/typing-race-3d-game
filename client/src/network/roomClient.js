import { client } from "./colyseusClient.js";

export async function createRoom({
  roomName,
  isPrivate,
  password,
  displayName,
}) {
  return client.create("race_room", { roomName, password, displayName });
}

export async function joinRoomByCode(roomCode, { displayName, password } = {}) {
  const res = await fetch(`http://localhost:2567/room-lookup/${roomCode}`);
  if (!res.ok) throw new Error("Room not found");
  const { roomId } = await res.json();
  return client.joinById(roomId, { displayName, password });
}

export async function quickJoin({ displayName }) {
  return client.joinOrCreate("race_room", { displayName });
}
