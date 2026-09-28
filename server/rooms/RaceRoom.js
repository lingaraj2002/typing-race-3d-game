import { Room } from "colyseus";
import { RaceState } from "../schemas/RaceState.js";
import { PlayerState } from "../schemas/PlayerState.js";
import { filterName } from "../filters/profanityFilter.js";
import { INACTIVITY_TIMEOUT, MAX_PLAYERS } from "../../shared/gameConstants.js";
import { generateRoomCode } from "../matchmaking/roomCode.js";

export class RaceRoom extends Room {
  maxClients = MAX_PLAYERS;

  async onCreate(options) {
    this.currentRaceText = "the quick brown fox jumps over the lazy dog";
    this.setState(new RaceState());
    this.state.roomCode = generateRoomCode();
    await this.setMetadata({ roomCode: this.state.roomCode });
    this.state.roomName = options.roomName ?? "Race";
    this.state.isPrivate = !!options.password;
    this.state.maxPlayers = options.maxPlayers ?? MAX_PLAYERS;
    this._password = options.password ?? null;

    this.onMessage("ready", (client, ready) => {
      const p = this.state.players.get(client.sessionId);
      if (p) p.ready = !!ready;
      this.checkAllReady();
    });

    this.onMessage("rematch", (client) => {
      console.log(
        "Rematch message received from:",
        client.sessionId,
        "hostId:",
        this.state.hostId,
      );
      if (client.sessionId !== this.state.hostId) {
        console.log("Rejected — not host");
        return;
      }
      console.log("Resetting state for rematch");

      this.state.players.forEach((p) => {
        p.ready = false;
        p.progress = 0;
        p.typedCharacters = 0;
        p.finished = false;
        p.finishTime = 0;
        p.finishPosition = 0;
        p.wpm = 0;
        p.accuracy = 100;
      });

      this.state.status = "lobby";
      this.state.countdown = 0;
    });

    this.onMessage("typingProgress", (client, data) => {
      this.handleTypingProgress(client, data); // SERVER VALIDATES, see Phase 9
    });

    this.onMessage("startRace", (client) => {
      if (client.sessionId === this.state.hostId) this.startCountdown();
    });
  }

  onAuth(client, options) {
    if (this._password && options.password !== this._password) {
      throw new Error("Invalid password");
    }
    return true;
  }

  onJoin(client, options) {
    const p = new PlayerState();
    p.sessionId = client.sessionId;
    p.displayName = filterName(options.displayName);
    const occupiedSlots = new Set(
      [...this.state.players.values()].map((player) => player.slot),
    );
    p.slot = Array.from({ length: MAX_PLAYERS }, (_, index) => index).find(
      (slot) => !occupiedSlots.has(slot),
    );
    p.lastActivity = Date.now();
    this.state.players.set(client.sessionId, p);

    if (!this.state.hostId) this.state.hostId = client.sessionId;
  }

  onLeave(client, consented) {
    const p = this.state.players.get(client.sessionId);
    if (p) p.connected = false;

    if (!consented) {
      // give a reconnect window (Phase 11)
      this.allowReconnection(client, 20)
        .then(() => {
          p.connected = true;
        })
        .catch(() => {
          this.state.players.delete(client.sessionId);
          this.reassignHostIfNeeded(client.sessionId);
        });
    } else {
      this.state.players.delete(client.sessionId);
      this.reassignHostIfNeeded(client.sessionId);
    }
  }

  onDispose() {
    // Colyseus already frees all in-memory state here — nothing to persist, by design.
  }

  reassignHostIfNeeded(leftId) {
    if (this.state.hostId !== leftId) return;
    const next = [...this.state.players.values()].find((p) => p.connected);
    if (next) this.state.hostId = next.sessionId;
  }

  checkAllReady() {
    const players = [...this.state.players.values()];
    if (players.length >= 2 && players.every((p) => p.ready)) {
      // host can now press start — or auto-start, your call
    }
  }

  startCountdown() {
    this.state.status = "countdown";
    this.state.countdown = 3;
    const interval = setInterval(() => {
      this.state.countdown--;
      if (this.state.countdown <= 0) {
        clearInterval(interval);
        this.state.status = "racing";
        this.state.raceStartTime = Date.now();
      }
    }, 1000);
  }

  checkRaceComplete() {
    const players = [...this.state.players.values()];
    if (players.length > 0 && players.every((p) => p.finished)) {
      this.state.status = "finished";
    }
  }

  handleTypingProgress(client, data) {
    const p = this.state.players.get(client.sessionId);
    if (!p || this.state.status !== "racing") return;

    const text = this.currentRaceText; // server holds the authoritative text
    const clampedTyped = Math.min(data.typedCharacters, text.length);

    p.typedCharacters = clampedTyped;
    p.totalCharacters = text.length;
    p.progress = clampedTyped / text.length;
    p.wpm = Math.max(0, Math.min(data.wpm, 250)); // sanity clamp
    p.accuracy = Math.max(0, Math.min(data.accuracy, 100));
    p.lastActivity = Date.now();

    if (p.progress >= 1 && !p.finished) {
      p.finished = true;
      p.finishTime = Date.now() - this.state.raceStartTime;
      p.finishPosition = [...this.state.players.values()].filter(
        (x) => x.finished,
      ).length;
      this.checkRaceComplete();
    }
  }
}
