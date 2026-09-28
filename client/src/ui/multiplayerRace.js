import * as THREE from "three";
import { getStateCallbacks } from "@colyseus/sdk";
import { createScene, addRaceLighting } from "../game/scene.js";
import { createRaceClimate } from "../game/raceClimate.js";
import { buildWorld } from "../game/worldBuilder.js";
import { createThirdPersonCamera } from "../game/thirdPersonCamera.js";
import { createPreRaceCinematicCamera } from "../game/preRaceCinematicCamera.js";
import { updateVehiclePosition } from "../game/vehicleController.js";
import { createRaceLaneCurve } from "../game/track.js";
import { generateWordSet } from "../typing/promptGenerator.js";
import { calculateWPM } from "../typing/wpmCalc.js";
import { calculateAccuracy } from "../typing/accuracyCalc.js";
import { loadVehicleModel } from "../utils/assetLoader.js";
import { RACE_CONFIG } from "../game/raceConfig.js";
import {
  fitRendererToAspect,
  getRenderPixelRatio,
  SCENE_ASPECT_RATIO,
} from "../utils/viewport.js";
const trackTileUrl = "/assets/models/road_track.glb";
const carModelUrl = "/assets/models/vehicle_car.glb";

export async function startMultiplayerRace(container, room) {
  container.innerHTML = `
  <div id="countdown-overlay" style="position:fixed; inset:0; display:flex; align-items:center; justify-content:center; font-size:80px; color:white; font-family:monospace; z-index:10;"></div>
  <div id="typing-ui" style="position:fixed; bottom:20px; left:20px; color:white; font-family:'Cascadia Mono', Consolas, 'Courier New', monospace; font-size:32px; font-variant-ligatures:none; white-space:nowrap; background:rgba(0,0,0,0.5); padding:20px;">
    <div id="prompt-text" style="display:flex; justify-content:center;"></div>
    <div id="stats" style="font-size:16px; margin-top:10px;"></div>
  </div>
  <div id="mp-results" class="result-screen">
    <div class="result-card">
      <span class="result-sunburst" aria-hidden="true"></span>
      <p class="result-kicker">Finish line</p>
      <h1>Race Results</h1>
      <div id="mp-player-result-summary" class="result-summary"></div>
      <div id="mp-results-list" class="result-list"></div>
      <button id="mp-rematch-btn" class="result-button" type="button">Race Again <span>&rarr;</span></button>
      <div id="mp-rematch-wait" class="result-wait"></div>
    </div>
  </div>
`;

  const scene = createScene();
  const lighting = addRaceLighting(scene);

  // Full-window stage: the canvas is letterboxed to 16:9 inside this black
  // container, so any uncovered area reads as black bars.
  const previousContainerStyle = container.getAttribute("style");
  Object.assign(container.style, {
    position: "fixed",
    inset: "0",
    overflow: "hidden",
    background: "#000",
  });

  // ── Build the coastal world ──────────────────────────────────────────────
  const world = await buildWorld(scene, trackTileUrl, { tileCount: 10 });
  const trackSurfaceY = world.surfaceY;
  const vehicleSurfaceY = trackSurfaceY + 0.05;
  const roadCenter = world.layout.roadCenter;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = RACE_CONFIG.lighting.daylightExposure;
  renderer.setPixelRatio(getRenderPixelRatio());
  container.prepend(renderer.domElement);

  const climate = createRaceClimate({
    scene,
    renderer,
    lights: lighting,
    clouds: world.clouds,
  });

  const camera = new THREE.PerspectiveCamera(
    RACE_CONFIG.camera.fieldOfViewDegrees,
    SCENE_ASPECT_RATIO,
    0.1,
    2000,
  );

  fitRendererToAspect(renderer, camera, container);

  // ── Vehicles: reuse the shared car model so every mesh is cheap ─────────
  const loadedCarModel = await loadVehicleModel(carModelUrl);
  loadedCarModel.scale.setScalar(RACE_CONFIG.vehicle.multiplayerScale);
  const carBounds = new THREE.Box3().setFromObject(loadedCarModel);
  const carCenter = carBounds.getCenter(new THREE.Vector3());
  const carModel = new THREE.Group();
  loadedCarModel.position.set(-carCenter.x, -carBounds.min.y, -carCenter.z);
  carModel.add(loadedCarModel);

  function prepareCarMesh(mesh, color) {
    mesh.traverse((child) => {
      if (!child.isMesh) return;
      child.frustumCulled = false;
      const mat = child.material.clone();
      mat.color.set(color);
      mat.transparent = false;
      mat.opacity = 1;
      mat.depthWrite = true;
      mat.side = THREE.DoubleSide;
      child.material = mat;
      child.castShadow = true;
      child.receiveShadow = true;
    });
  }

  // one lane per real player, assigned by their existing "slot" field
  const allPlayers = [...room.state.players.values()];

  const vehicles = new Map(); // sessionId -> { mesh, curve }
  let myVehicleMesh = null;
  allPlayers.forEach((p) => {
    const curve = createRaceLaneCurve(
      roadCenter,
      world.totalLength,
      p.slot ?? 0,
    );

    const mesh = carModel.clone();
    prepareCarMesh(mesh, p.sessionId === room.sessionId ? 0xd946ef : 0x38bdf8);
    scene.add(mesh);
    vehicles.set(p.sessionId, { mesh, curve });
    updateVehiclePosition(mesh, curve, 0, vehicleSurfaceY);
    if (p.sessionId === room.sessionId) myVehicleMesh = mesh;
  });

  if (myVehicleMesh) {
    const followCamera = createThirdPersonCamera(camera, myVehicleMesh, scene, {
      roadHeight: trackSurfaceY,
    });
    const cinematicCamera = createPreRaceCinematicCamera(camera, {
      roadHeight: trackSurfaceY,
      duration: 3.2,
    });
    cinematicCamera.begin(
      [...vehicles.values()].map(({ mesh }) => mesh),
      myVehicleMesh,
    );
    camera.followCamera = followCamera;
    camera.preRaceCinematic = cinematicCamera;
  } else {
    camera.position.set(0, trackSurfaceY + 9, 16);
    camera.lookAt(0, trackSurfaceY, -40);
  }

  const $ = getStateCallbacks(room);
  $(room.state).players.onAdd((p) => {
    // handles anyone who joins mid-setup — simplified for now, full lane logic can improve later
  });

  // --- countdown ---
  const overlayEl = document.getElementById("countdown-overlay");
  $(room.state).listen("countdown", (value) => {
    overlayEl.textContent = value > 0 ? value : "GO!";
    if (value <= 0) setTimeout(() => (overlayEl.textContent = ""), 500);
  });

  // --- typing state, own player only ---
  let words = [];
  let currentWordIndex = 0;
  let currentCharIndex = 0;
  let correctChars = 0;
  let totalTyped = 0;
  let startTime = null;
  let playerFinished = false;
  let cinematicReady = !camera.preRaceCinematic;

  const BASE_SPEED = 0.05,
    MIN_SPEED = 0.015,
    BOOST = 0.01,
    PENALTY = 0.03,
    MAX_SPEED = 0.9;
  let speed = BASE_SPEED;

  const promptEl = document.getElementById("prompt-text");
  const statsEl = document.getElementById("stats");
  const usedWords = new Set();

  async function getNewWordBatch() {
    const batch = await generateWordSet("medium", 25, usedWords);
    batch.forEach((word) => usedWords.add(word));
    return batch;
  }

  getNewWordBatch().then((w) => {
    words = w;
    renderCurrentWord();
  });

  async function ensureMoreWords() {
    if (currentWordIndex >= words.length - 5) {
      const more = await getNewWordBatch();
      words = words.concat(more);
    }
  }

  function renderCurrentWord() {
    if (playerFinished) {
      promptEl.textContent = "Finished! Waiting for other racers...";
      return;
    }
    const target = words[currentWordIndex];
    if (!target) return;
    let html = "";
    for (let i = 0; i < target.length; i++) {
      if (i < currentCharIndex)
        html += `<span style="color:lightgreen">${target[i]}</span>`;
      else if (i === currentCharIndex)
        html += `<span style="color:orange; text-decoration:underline">${target[i]}</span>`;
      else html += `<span style="color:white">${target[i]}</span>`;
    }
    promptEl.innerHTML = html;
  }

  window.addEventListener("keydown", (e) => {
    if (
      room.state.status !== "racing" ||
      !cinematicReady ||
      playerFinished ||
      !words.length ||
      currentWordIndex >= words.length
    )
      return;
    if (e.key.length !== 1) return;
    if (!startTime) startTime = Date.now();

    const target = words[currentWordIndex];
    const expectedChar = target[currentCharIndex];
    totalTyped++;

    if (e.key === expectedChar) {
      correctChars++;
      currentCharIndex++;
      speed = Math.min(speed + BOOST, MAX_SPEED);
      if (currentCharIndex >= target.length) {
        currentWordIndex++;
        currentCharIndex = 0;
        ensureMoreWords();
      }
    } else {
      speed = Math.max(speed - PENALTY, MIN_SPEED);
    }

    renderCurrentWord();

    const wpm = calculateWPM(correctChars, Date.now() - startTime);
    const accuracy = calculateAccuracy(correctChars, totalTyped || 1);
    statsEl.textContent = `WPM: ${wpm} | Accuracy: ${accuracy}%`;

    // send progress to server — throttling comes in a later refinement
    // room.send("typingProgress", {
    //   typedCharacters: correctChars,
    //   wpm,
    //   accuracy,
    // });
  });

  // send typing progress to server ~10x/sec instead of on every keystroke
  let lastSentWpm = -1,
    lastSentAccuracy = -1,
    lastSentChars = -1;

  const syncInterval = setInterval(() => {
    if (room.state.status !== "racing" || playerFinished) return;

    const wpm = startTime
      ? calculateWPM(correctChars, Date.now() - startTime)
      : 0;
    const accuracy = calculateAccuracy(correctChars, totalTyped || 1);

    // only send if something actually changed — avoid pointless identical packets
    if (
      correctChars !== lastSentChars ||
      wpm !== lastSentWpm ||
      accuracy !== lastSentAccuracy
    ) {
      room.send("typingProgress", {
        typedCharacters: correctChars,
        wpm,
        accuracy,
      });
      lastSentChars = correctChars;
      lastSentWpm = wpm;
      lastSentAccuracy = accuracy;
    }
  }, 100); // 10 times per second

  // --- render loop, driven by server state for ALL players ---
  const clock = new THREE.Clock();
  let previousCameraProgress = 0;
  function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();

    if (words.length > 0 && !playerFinished && room.state.status === "racing") {
      const myProgress = room.state.players.get(room.sessionId)?.progress ?? 0;
      if (myProgress >= 1) playerFinished = true;
    }

    vehicles.forEach(({ mesh, curve }, sessionId) => {
      const p = room.state.players.get(sessionId);
      const progress = p?.progress ?? 0;
      updateVehiclePosition(mesh, curve, progress, vehicleSurfaceY);
    });

    if (camera.preRaceCinematic && !cinematicReady) {
      cinematicReady = camera.preRaceCinematic.update(dt);
      if (cinematicReady) camera.followCamera.beginRace();
    }

    if (
      camera.followCamera &&
      room.state.status === "racing" &&
      cinematicReady
    ) {
      const playerProgress =
        room.state.players.get(room.sessionId)?.progress ?? 0;
      const progressVelocity =
        dt > 0
          ? Math.max(0, (playerProgress - previousCameraProgress) / dt)
          : 0;
      const normalizedSpeed = THREE.MathUtils.clamp(
        progressVelocity / 0.08,
        0,
        1,
      );
      previousCameraProgress = playerProgress;
      const myVehicle = vehicles.get(room.sessionId);
      camera.followCamera.updateRace(dt, {
        normalizedSpeed,
        curve: myVehicle?.curve,
        trackProgress: playerProgress,
      });
    }

    climate.update(dt, myVehicleMesh?.position);
    renderer.render(scene, camera);
  }
  animate();

  window.addEventListener("resize", () => {
    renderer.setPixelRatio(getRenderPixelRatio());
    fitRendererToAspect(renderer, camera, container);
  });

  $(room.state).listen("status", (value) => {
    console.log("Status changed to:", value);
    if (value === "finished") {
      clearInterval(syncInterval);
      showMultiplayerResults(room);
    } else if (value === "lobby") {
      clearInterval(syncInterval);
      if (previousContainerStyle === null) container.removeAttribute("style");
      else container.setAttribute("style", previousContainerStyle);
      import("./lobby.js").then(({ renderLobby }) => {
        renderLobby(container, room, () =>
          startMultiplayerRace(container, room),
        );
      });
    }
  });

  function showMultiplayerResults(room) {
    const players = [...room.state.players.values()].sort(
      (a, b) => a.finishPosition - b.finishPosition,
    );
    const player = players.find((p) => p.sessionId === room.sessionId);
    if (player) {
      document.getElementById("mp-player-result-summary").innerHTML = `
        <div><strong>${player.wpm}</strong><span>WPM</span></div>
        <div><strong>${player.accuracy}%</strong><span>Accuracy</span></div>
        <div><strong>${currentWordIndex}</strong><span>Words</span></div>
      `;
    }
    const listEl = document.getElementById("mp-results-list");
    listEl.innerHTML = players
      .map(
        (p, i) =>
          `${i + 1}. ${p.displayName} — ${p.finished ? `${(p.finishTime / 1000).toFixed(1)}s` : "Lose"}`,
      )
      .join("<br>");

    document.getElementById("mp-results").style.display = "flex";

    const waitEl = document.getElementById("mp-rematch-wait");

    if (room.sessionId === room.state.hostId) {
      const oldBtn = document.getElementById("mp-rematch-btn");
      const rematchBtn = oldBtn.cloneNode(true); // strips any previously-attached listeners
      oldBtn.replaceWith(rematchBtn);
      rematchBtn.style.display = "inline-block";
      rematchBtn.addEventListener("click", () => {
        room.send("rematch");
      });
    } else {
      waitEl.textContent = "Waiting for host to start a rematch...";
    }
  }
}
