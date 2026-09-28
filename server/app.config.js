import { Server, matchMaker } from "colyseus";
import { createServer } from "http";
import express from "express";
import cors from "cors";
import { RaceRoom } from "./rooms/RaceRoom.js";

const app = express();
app.use(cors()); // allow requests from your Vite dev server on a different port
app.use(express.json());

app.get("/room-lookup/:code", async (req, res) => {
  try {
    const rooms = await matchMaker.query({ name: "race_room" });
    const match = rooms.find((r) => r.metadata?.roomCode === req.params.code);
    if (!match) return res.status(404).json({ error: "Room not found" });
    res.json({ roomId: match.roomId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const server = createServer(app);
const gameServer = new Server({ server });

gameServer.define("race_room", RaceRoom);

gameServer.listen(process.env.PORT || 2567);
console.log("Colyseus server listening on ws://localhost:2567");
