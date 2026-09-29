import * as THREE from "three";
import { createScene, addRaceLighting } from "./scene.js";
import { createRaceClimate } from "./raceClimate.js";
import { buildWorld } from "./worldBuilder.js";
import { createThirdPersonCamera } from "./thirdPersonCamera.js";
import { createPreRaceCinematicCamera } from "./preRaceCinematicCamera.js";
import { createBotRacer, updateBotProgress } from "./botController.js";
import { updateVehiclePosition } from "./vehicleController.js";
import { generateWordSet } from "../typing/promptGenerator.js";
import { calculateWPM } from "../typing/wpmCalc.js";
import { calculateAccuracy } from "../typing/accuracyCalc.js";
import { loadVehicleModel } from "../utils/assetLoader.js";
import { RACE_CONFIG } from "./raceConfig.js";
import {
  fitRendererToAspect,
  getRenderPixelRatio,
  SCENE_ASPECT_RATIO,
} from "../utils/viewport.js";
const carModelUrl = "/assets/models/vehicle_car.glb";
const trackTileUrl = "/assets/models/road_track.glb";
import {
  createRaceLaneCurve,
  createRandomRaceLaneOrder,
  calculateLap,
  describeStartGrid,
} from "./track.js";

export async function startSinglePlayerRace(container) {
  // UI must live OUTSIDE the 3D container: the renderer wipes the container,
  // so a positioned overlay inside the 16:9 stage owns all race UI.
  const uiRoot = document.createElement("div");
  uiRoot.id = "singleplayer-ui-root";
  uiRoot.style.cssText =
    "position:fixed;inset:0;z-index:10;pointer-events:none;";
  (container.parentElement ?? document.body).appendChild(uiRoot);
  uiRoot.innerHTML = `
    <style>
      #race-ui {
        --ink: #102a43;
        --ink-deep: #071827;
        --sky: #8ce7f4;
        --sun: #ffe45c;
        --coral: #ff735c;
        --mint: #68e0a0;
        --cream: #fff8df;
        position: fixed;
        inset: 0;
        z-index: 10;
        color: var(--cream);
        font-family: "Trebuchet MS", Arial, sans-serif;
        pointer-events: none;
      }

      #race-ui.race-ui--cinematic #race-progress-hud,
      #race-ui.race-ui--cinematic #performance-hud {
        visibility: hidden;
        opacity: 0;
      }

      #race-ui.race-ui--cinematic #race-progress-hud {
        transform: translate(-50%, -8px);
      }

      #race-ui.race-ui--cinematic #performance-hud {
        transform: translate(50%, 8px);
      }

      #race-ui #race-progress-hud,
      #race-ui #performance-hud {
        transition: opacity 260ms ease, transform 260ms ease, visibility 260ms ease;
      }

      #pre-race-loading {
        position: fixed;
        inset: 0;
        z-index: 300;
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(160deg, #78cde5 0%, #c3f2e5 100%);
        color: #102a43;
        font-family: "Arial Black", "Trebuchet MS", sans-serif;
        font-size: clamp(16px, 3cqw, 24px);
        letter-spacing: 0.08em;
        text-shadow: 2px 2px 0 rgba(255, 255, 255, 0.65);
        text-transform: uppercase;
      }

      #pre-race-loading::after {
        position: absolute;
        bottom: 34%;
        width: 42px;
        height: 12px;
        border: 3px solid #102a43;
        border-radius: 999px;
        border-top-color: #ff735c;
        content: "";
        animation: loading-spin 0.8s linear infinite;
      }

      @keyframes loading-spin {
        to { transform: rotate(360deg); }
      }

      .race-panel {
        position: relative;
        box-sizing: border-box;
        background: linear-gradient(145deg, rgba(19, 53, 76, 0.97), rgba(7, 24, 39, 0.96));
        border: 3px solid var(--ink);
        border-radius: 17px;
        box-shadow: 0 7px 0 rgba(7, 24, 39, 0.55), 0 12px 24px rgba(9, 40, 60, 0.35), inset 0 2px rgba(255, 255, 255, 0.22);
      }

      .race-panel::before {
        position: absolute;
        top: 0;
        right: 14px;
        left: 14px;
        height: 4px;
        border-radius: 0 0 8px 8px;
        background: var(--sun);
        content: "";
      }

      #race-progress-hud {
        position: absolute;
        top: 86px;
        left: 50%;
        width: min(580px, calc(100cqw - 32px));
        transform: translateX(-50%);
        padding: 10px 12px 11px;
      }

      .race-hud-title {
        margin: 0 0 8px;
        color: var(--sun);
        font-family: "Arial Black", "Trebuchet MS", sans-serif;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.12em;
        text-shadow: 2px 2px 0 var(--ink-deep);
        text-transform: uppercase;
      }

      #race-standings {
        display: grid;
        gap: 5px;
      }

      .race-standing {
        display: grid;
        grid-template-columns: 46px minmax(0, 1fr) 64px;
        align-items: center;
        gap: 8px;
        min-width: 0;
        font-family: "Arial Black", "Trebuchet MS", sans-serif;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      .race-standing--player {
        color: var(--sky);
      }

      .race-standing__track {
        position: relative;
        height: 10px;
        overflow: hidden;
        border: 2px solid var(--ink-deep);
        border-radius: 999px;
        background: #17364c;
        box-shadow: inset 0 2px rgba(0, 0, 0, 0.25);
      }

      .race-standing__track::after {
        position: absolute;
        top: 1px;
        right: 3px;
        bottom: 1px;
        width: 2px;
        content: "";
        background: var(--cream);
        box-shadow: 3px 0 rgba(255, 228, 92, 0.55);
      }

      .race-standing__marker {
        position: absolute;
        top: 50%;
        left: 0;
        width: 12px;
        height: 12px;
        border: 2px solid var(--cream);
        border-radius: 50%;
        background: var(--coral);
        box-shadow: 0 0 0 2px var(--ink-deep);
        transform: translate(-50%, -50%);
      }

      .race-standing--player .race-standing__marker {
        background: var(--sky);
      }

      .race-standing__meta {
        color: #a7d9df;
        text-align: right;
        font-variant-numeric: tabular-nums;
      }

      #world-word {
        position: absolute;
        z-index: 2;
        min-width: 148px;
        max-width: min(82cqw, 460px);
        padding: 14px 21px 15px;
        border: 3px solid var(--ink);
        border-radius: 18px;
        background: var(--cream);
        box-shadow: 0 6px 0 rgba(7, 24, 39, 0.7), 0 12px 20px rgba(4, 20, 31, 0.32), inset 0 2px rgba(255, 255, 255, 0.85);
        color: var(--ink);
        font-size: clamp(22px, 4cqw, 34px);
        font-family: "Cascadia Mono", Consolas, "Courier New", monospace;
        font-variant-ligatures: none;
        font-weight: 900;
        letter-spacing: 0;
        line-height: 1;
        text-align: center;
        text-shadow: 1px 1px 0 rgba(255, 255, 255, 0.7);
        white-space: nowrap;
        will-change: transform;
      }

      #world-word #prompt-text {
        display: flex;
        align-items: baseline;
        justify-content: center;
      }

      #world-word #prompt-text > span {
        display: inline-block;
        flex: 0 0 1ch;
        width: 1ch;
        text-align: center;
      }

      #world-word #prompt-text > span + span {
        margin-left: 0.16em;
      }

      #world-word::after {
        position: absolute;
        bottom: -10px;
        left: 50%;
        width: 16px;
        height: 16px;
        border-right: 3px solid var(--ink);
        border-bottom: 3px solid var(--ink);
        background: var(--cream);
        content: "";
        transform: translateX(-50%) rotate(45deg);
      }

      .typed-character { color: #20a86b; }
      .active-character {
        color: var(--coral);
        text-decoration: underline;
        text-decoration-thickness: 3px;
        text-underline-offset: 6px;
      }
      .pending-character { color: #6e8b94; }

      #performance-hud {
        position: absolute;
        right: 50%;
        bottom: 22px;
        display: grid;
        grid-template-columns: repeat(3, minmax(82px, 1fr));
        width: min(390px, calc(100cqw - 32px));
        transform: translateX(50%);
        overflow: hidden;
        background: linear-gradient(145deg, rgba(255, 248, 223, 0.98), rgba(255, 224, 130, 0.96));
      }

      .performance-stat {
        padding: 13px 10px 12px;
        text-align: center;
      }

      .performance-stat + .performance-stat {
        border-left: 2px dashed rgba(16, 42, 67, 0.35);
      }

      .performance-stat__value {
        display: block;
        color: var(--ink);
        font-family: "Arial Black", "Trebuchet MS", sans-serif;
        font-size: clamp(18px, 4.2cqw, 25px);
        font-weight: 800;
        font-variant-numeric: tabular-nums;
        text-shadow: 1px 1px 0 rgba(255, 255, 255, 0.75);
      }

      .performance-stat__label {
        display: block;
        margin-top: 5px;
        color: #23627a;
        font-family: "Arial Black", "Trebuchet MS", sans-serif;
        font-size: 9px;
        font-weight: 800;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }

      #countdown {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-family: monospace;
        font-size: 100px;
        font-weight: bold;
        pointer-events: none;
        text-shadow: 0 4px 15px rgba(0, 0, 0, 0.8);
        z-index: 100;
      }

      #results-screen {
        display: none;
      }

      #rematch-btn {
        pointer-events: auto;
        cursor: pointer;
      }

      @media (max-width: 460px) {
        #performance-hud { bottom: 12px; }
        #race-progress-hud { top: 9px; padding: 8px 9px; }
        .race-hud-title { margin-bottom: 6px; }
        .race-standing {
          grid-template-columns: 37px minmax(0, 1fr) 55px;
          gap: 5px;
          font-size: 9px;
        }
        .performance-stat { padding: 10px 4px 9px; }
        .performance-stat__label { font-size: 8px; }
      }

      .lap-hud-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        background: linear-gradient(135deg, var(--coral), #e11d48);
        color: var(--cream);
        font-family: "Arial Black", "Trebuchet MS", sans-serif;
        font-size: 11px;
        font-weight: 900;
        letter-spacing: 0.08em;
        padding: 4px 11px;
        border-radius: 999px;
        border: 2px solid var(--ink-deep);
        box-shadow: 0 3px 0 var(--ink-deep);
        text-shadow: 1px 1px 0 rgba(0, 0, 0, 0.4);
        text-transform: uppercase;
        transition: transform 0.2s ease, background 0.2s ease;
      }

      .lap-hud-badge--final {
        background: linear-gradient(135deg, #f59e0b, #ea580c);
        color: #fff;
        animation: pulse-lap-badge 0.85s infinite alternate ease-in-out;
      }

      @keyframes pulse-lap-badge {
        from { transform: scale(1); box-shadow: 0 3px 0 var(--ink-deep); }
        to { transform: scale(1.08); box-shadow: 0 3px 10px rgba(245, 158, 11, 0.6); }
      }

      #lap-banner {
        position: fixed;
        top: 38%;
        left: 50%;
        transform: translate(-50%, -50%) scale(0.65);
        opacity: 0;
        pointer-events: none;
        z-index: 250;
        background: linear-gradient(145deg, rgba(16, 42, 67, 0.96), rgba(7, 24, 39, 0.98));
        border: 4px solid var(--sun);
        border-radius: 20px;
        padding: 16px 38px;
        font-family: "Arial Black", "Trebuchet MS", sans-serif;
        font-size: clamp(28px, 6cqw, 56px);
        color: var(--sun);
        text-shadow: 0 4px 14px rgba(0, 0, 0, 0.7), 2px 2px 0 var(--ink-deep);
        letter-spacing: 0.12em;
        box-shadow: 0 14px 40px rgba(0, 0, 0, 0.6), inset 0 2px rgba(255, 255, 255, 0.35);
        text-transform: uppercase;
        transition: transform 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.35s ease;
      }

      #lap-banner.lap-banner--show {
        transform: translate(-50%, -50%) scale(1);
        opacity: 1;
      }

    </style>

    <div id="race-ui" class="race-ui--cinematic" aria-hidden="true">
      <section id="race-progress-hud" class="race-panel">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <p class="race-hud-title" style="margin:0;">Race progress</p>
          <div id="lap-hud-badge" class="lap-hud-badge">LAP 1 / 3</div>
        </div>
        <div id="race-standings"></div>
      </section>
      <div id="lap-banner" class="lap-banner">LAP 1</div>
      <div id="world-word"><div id="prompt-text"></div></div>
      <section id="performance-hud" class="race-panel">
        <div class="performance-stat">
          <span id="wpm-value" class="performance-stat__value">0</span>
          <span class="performance-stat__label">WPM</span>
        </div>
        <div class="performance-stat">
          <span id="accuracy-value" class="performance-stat__value">100%</span>
          <span class="performance-stat__label">Accuracy</span>
        </div>
        <div class="performance-stat">
          <span id="words-value" class="performance-stat__value">0</span>
          <span class="performance-stat__label">Words</span>
        </div>
      </section>
    </div>

    <div id="pre-race-loading" role="status">Preparing the race...</div>

    <div id="countdown" style="display: none;">3</div>
    <div id="results-screen" class="result-screen">
      <div class="result-card">
        <span class="result-sunburst" aria-hidden="true"></span>
        <p class="result-kicker">Finish line</p>
        <h1>Race Results</h1>
        <div id="player-result-summary" class="result-summary"></div>
        <div id="results-list" class="result-list"></div>
        <button id="rematch-btn" class="result-button" type="button">Race Again <span>&rarr;</span></button>
      </div>
    </div>
  `;

  const previousContainerStyle = container.getAttribute("style");
  Object.assign(container.style, {
    position: "fixed",
    inset: "0",
    overflow: "hidden",
    background: "#000",
  });
  container.replaceChildren();

  const scene = createScene();
  const lighting = addRaceLighting(scene);

  // ── World ────────────────────────────────────────────────────────────────
  const world = await buildWorld(scene, trackTileUrl, { tileCount: 10 });
  const trackSurfaceY = world.surfaceY;
  const vehicleSurfaceY = trackSurfaceY + 0.05;
  const roadCenter = world.layout.roadCenter;

  // ── Vehicles ─────────────────────────────────────────────────────────────
  // Loaded before the grid is laid out: the starting lanes depend on the real
  // road width, and the car's measured width is what proves the road is wide
  // enough for every car to sit fully inside the painted road.
  const loadedCarModel = await loadVehicleModel(carModelUrl);
  document.getElementById("pre-race-loading")?.remove();
  loadedCarModel.scale.setScalar(RACE_CONFIG.vehicle.singlePlayerScale);
  const carBounds = new THREE.Box3().setFromObject(loadedCarModel);
  const carTopHeight = carBounds.max.y - carBounds.min.y;
  const carCenter = carBounds.getCenter(new THREE.Vector3());
  const carModel = new THREE.Group();
  loadedCarModel.position.set(-carCenter.x, -carBounds.min.y, -carCenter.z);
  carModel.add(loadedCarModel);

  const gridTrackWidth = world.layout.trackWidth;
  const gridCarHalfWidth = (carBounds.max.x - carBounds.min.x) / 2;
  describeStartGrid({
    trackWidth: gridTrackWidth,
    carHalfWidth: gridCarHalfWidth,
  });

  const laneOrder = createRandomRaceLaneOrder();
  const playerCurve = createRaceLaneCurve(
    roadCenter,
    world.totalLength,
    laneOrder[0],
    undefined,
    { trackWidth: gridTrackWidth },
  );
  const botCurves = laneOrder
    .slice(1)
    .map((laneIndex) =>
      createRaceLaneCurve(roadCenter, world.totalLength, laneIndex, undefined, {
        trackWidth: gridTrackWidth,
      }),
    );

  // ── Renderer & camera ────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = RACE_CONFIG.lighting.daylightExposure;
  renderer.setPixelRatio(getRenderPixelRatio());
  container.appendChild(renderer.domElement);

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

  let viewport = fitRendererToAspect(renderer, camera, container);

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

  const vehicle = carModel.clone();
  prepareCarMesh(vehicle, 0xd946ef);
  scene.add(vehicle);

  const followCamera = createThirdPersonCamera(camera, vehicle, scene, {
    roadHeight: trackSurfaceY,
    cameraHeight: RACE_CONFIG.camera.heightAboveRoad,
    cameraDistance: RACE_CONFIG.camera.distanceBehindVehicle,
  });
  const cinematicCamera = createPreRaceCinematicCamera(camera, {
    roadHeight: trackSurfaceY,
    duration: RACE_CONFIG.presentation.introDurationSeconds,
    endHeight: RACE_CONFIG.camera.heightAboveRoad,
    finalDistance: RACE_CONFIG.camera.distanceBehindVehicle,
    finalLookAhead: RACE_CONFIG.camera.lookAheadDistance,
  });

  const raceDistance = world.totalLength * RACE_CONFIG.laps;
  const botRacers = botCurves.map((curve, i) => {
    const mesh = carModel.clone();
    prepareCarMesh(mesh, i === 0 ? 0x38bdf8 : i === 1 ? 0xef4444 : 0xfbbf24);
    scene.add(mesh);
    return { mesh, curve, bot: createBotRacer(i, raceDistance) };
  });
  const gridVehicles = [vehicle, ...botRacers.map(({ mesh }) => mesh)];

  updateVehiclePosition(vehicle, playerCurve, 0, vehicleSurfaceY);
  botRacers.forEach(({ mesh, curve }) => {
    updateVehiclePosition(mesh, curve, 0, vehicleSurfaceY);
  });

  // ── Typing state ─────────────────────────────────────────────────────────
  let progress = 0;
  let speed = RACE_CONFIG.baseSpeed;
  let words = [];
  let currentWordIndex = 0;
  let currentCharIndex = 0;
  let correctChars = 0;
  let totalTyped = 0;
  let startTime = null;
  let playerFinished = false;
  let raceStarted = false;
  let introComplete = false;
  let countdownStarted = false;
  let countdownFinished = false;
  let raceOver = false;
  let raceElapsed = 0;

  const MIN_SPEED = RACE_CONFIG.minimumSpeed;
  const MAX_SPEED = RACE_CONFIG.maximumSpeed;
  const SPEED_STEP = RACE_CONFIG.speedStep;
  let idleAccumulator = 0;
  let lastInputRaceTime = 0;

  let playerLapSplits = [];
  let currentLapStartTime = 0;
  let lastTrackedLap = 1;
  let bannerTimer = null;

  function triggerLapBanner(lap) {
    const bannerEl = document.getElementById("lap-banner");
    const badgeEl = document.getElementById("lap-hud-badge");
    if (!bannerEl) return;
    if (bannerTimer) clearTimeout(bannerTimer);

    if (lap >= RACE_CONFIG.laps) {
      bannerEl.textContent = "FINAL LAP!";
      bannerEl.style.color = "#f59e0b";
      bannerEl.style.borderColor = "#f59e0b";
      if (badgeEl) {
        badgeEl.textContent = `FINAL LAP! (${lap}/${RACE_CONFIG.laps})`;
        badgeEl.classList.add("lap-hud-badge--final");
      }
    } else {
      bannerEl.textContent = `LAP ${lap}`;
      bannerEl.style.color = "var(--sun)";
      bannerEl.style.borderColor = "var(--sun)";
      if (badgeEl) {
        badgeEl.textContent = `LAP ${lap} / ${RACE_CONFIG.laps}`;
        badgeEl.classList.remove("lap-hud-badge--final");
      }
    }

    bannerEl.classList.add("lap-banner--show");
    bannerTimer = setTimeout(() => {
      bannerEl.classList.remove("lap-banner--show");
    }, 1600);
  }

  const promptEl = document.getElementById("prompt-text");
  const worldWordEl = document.getElementById("world-word");
  const raceStandingsEl = document.getElementById("race-standings");
  const wpmValueEl = document.getElementById("wpm-value");
  const accuracyValueEl = document.getElementById("accuracy-value");
  const wordsValueEl = document.getElementById("words-value");
  const resultsScreenEl = document.getElementById("results-screen");
  const countdownEl = document.getElementById("countdown");
  const raceUiEl = document.getElementById("race-ui");
  const worldWordAnchor = new THREE.Vector3();
  const worldWordProjection = new THREE.Vector3();
  const usedWords = new Set();
  let lastPerformanceValues = "";

  async function getNewWordBatch() {
    const batch = await generateWordSet(
      "medium",
      RACE_CONFIG.wordCount,
      usedWords,
      RACE_CONFIG.wordLength,
    );
    batch.forEach((word) => usedWords.add(word));
    return batch;
  }

  getNewWordBatch().then((w) => {
    words = w;
    renderCurrentWord();
  });

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
        html += `<span class="typed-character">${target[i]}</span>`;
      else if (i === currentCharIndex)
        html += `<span class="active-character">${target[i]}</span>`;
      else html += `<span class="pending-character">${target[i]}</span>`;
    }
    promptEl.innerHTML = html;
  }

  function handleKeydown(e) {
    if (
      !raceStarted ||
      !words.length ||
      currentWordIndex >= words.length ||
      playerFinished
    )
      return;
    if (e.key.length !== 1) return;
    if (!startTime) startTime = Date.now();
    lastInputRaceTime = raceElapsed;
    idleAccumulator = 0;

    const target = words[currentWordIndex];
    const expectedChar = target[currentCharIndex];
    totalTyped++;

    if (e.key === expectedChar) {
      correctChars++;
      currentCharIndex++;
      speed = Math.min(speed + SPEED_STEP, MAX_SPEED);
      if (currentCharIndex >= target.length) {
        currentWordIndex++;
        currentCharIndex = 0;
      }
    } else {
      speed = Math.max(speed - SPEED_STEP, MIN_SPEED);
    }

    renderCurrentWord();
  }
  window.addEventListener("keydown", handleKeydown);

  const racers = [
    {
      name: "You",
      isPlayer: true,
      finished: false,
      finishTime: null,
      lastProgress: 0,
      didNotFinish: false,
      getProgress: () => progress,
    },
    ...botRacers.map((r, i) => ({
      name: `Bot ${i + 1}`,
      isPlayer: false,
      finished: false,
      finishTime: null,
      lastProgress: 0,
      didNotFinish: false,
      getProgress: () => r.bot.progress,
    })),
  ];
  const racerHud = new Map();

  racers.forEach((racer) => {
    const row = document.createElement("div");
    row.className = `race-standing${racer.isPlayer ? " race-standing--player" : ""}`;

    const name = document.createElement("span");
    name.textContent = racer.name;
    const track = document.createElement("div");
    track.className = "race-standing__track";
    const marker = document.createElement("span");
    marker.className = "race-standing__marker";
    track.appendChild(marker);
    const meta = document.createElement("span");
    meta.className = "race-standing__meta";
    row.append(name, track, meta);
    raceStandingsEl.appendChild(row);
    racerHud.set(racer, { marker, meta });
  });

  function updateRaceProgressHud() {
    const orderedRacers = [...racers].sort(
      (a, b) => b.getProgress() - a.getProgress(),
    );
    orderedRacers.forEach((racer, index) => {
      const racerTotalProg = THREE.MathUtils.clamp(racer.getProgress(), 0, 1);
      const lapInfo = calculateLap(racerTotalProg, RACE_CONFIG.laps);
      const hud = racerHud.get(racer);
      hud.marker.style.left = `${lapInfo.lapProgress * 100}%`;
      const lapTag = lapInfo.finished ? "FINISH" : `L${lapInfo.lap}`;
      hud.meta.textContent = `#${index + 1} · ${lapTag} (${Math.round(racerTotalProg * 100)}%)`;
    });
  }

  function updateWorldWordPosition() {
    if (!raceStarted || raceOver || playerFinished) {
      worldWordEl.style.display = "none";
      return;
    }
    worldWordAnchor.copy(vehicle.position);
    worldWordAnchor.y += carTopHeight + 0.7;
    camera.updateMatrixWorld();
    worldWordProjection.copy(worldWordAnchor).project(camera);

    const isOnScreen =
      worldWordProjection.z > -1 &&
      worldWordProjection.z < 1 &&
      Math.abs(worldWordProjection.x) < 1.12 &&
      Math.abs(worldWordProjection.y) < 1.12;
    if (!isOnScreen) {
      worldWordEl.style.display = "none";
      return;
    }

    const screenX =
      viewport.left + (worldWordProjection.x * 0.5 + 0.5) * viewport.width;
    const screenY =
      viewport.top + (-worldWordProjection.y * 0.5 + 0.5) * viewport.height;
    worldWordEl.style.display = "block";
    worldWordEl.style.transform = `translate3d(${screenX}px, ${screenY}px, 0) translate(-50%, -100%)`;
  }

  function updatePerformanceHud() {
    const wpm = startTime
      ? calculateWPM(correctChars, Date.now() - startTime)
      : 0;
    const accuracy = totalTyped
      ? calculateAccuracy(correctChars, totalTyped)
      : 100;
    const values = `${speed.toFixed(2)}|${wpm}|${accuracy}|${currentWordIndex}`;
    if (values === lastPerformanceValues) return;
    lastPerformanceValues = values;
    wpmValueEl.textContent = wpm;
    accuracyValueEl.textContent = `${accuracy}%`;
    wordsValueEl.textContent = currentWordIndex;
  }

  function checkFinishes(dt) {
    raceElapsed += dt;
    racers.forEach((racer) => {
      const currentProgress = racer.getProgress();
      if (!racer.finished && currentProgress >= 1) {
        const progressCovered = currentProgress - racer.lastProgress;
        const crossingFraction =
          progressCovered > 0
            ? THREE.MathUtils.clamp(
                (1 - racer.lastProgress) / progressCovered,
                0,
                1,
              )
            : 1;
        racer.finished = true;
        racer.finishTime = (raceElapsed - dt + dt * crossingFraction) * 1000;
      }
      racer.lastProgress = currentProgress;
    });

    const playerRacer = racers[0];

    // Bots can finish before the player. They remain on the results order,
    // but never end the player's typing run or mark the player as DNF.
    if (!raceOver && playerRacer.finished) {
      raceOver = true;
      showResults();
    }
  }

  function showResults() {
    const playerRacer = racers[0];
    // The player finishing ends the local race. Any bot still on the track is
    // recorded as DNF instead of receiving a fake null finish time.
    racers.forEach((racer) => {
      if (!racer.finished) racer.didNotFinish = true;
    });

    const sorted = [...racers].sort((a, b) => {
      if (a.didNotFinish !== b.didNotFinish) return a.didNotFinish ? 1 : -1;
      if (a.didNotFinish) return b.getProgress() - a.getProgress();
      return (
        (a.finishTime ?? Number.POSITIVE_INFINITY) -
        (b.finishTime ?? Number.POSITIVE_INFINITY)
      );
    });
    document.getElementById("results-list").innerHTML = sorted
      .map((racer, index) => {
        const result = racer.didNotFinish
          ? "Lose"
          : `${(racer.finishTime / 1000).toFixed(1)}s`;
        return `${index + 1}. ${racer.name} — ${result}`;
      })
      .join("<br>");
    const finalWpm = startTime
      ? calculateWPM(correctChars, Date.now() - startTime)
      : 0;
    const finalAccuracy = totalTyped
      ? calculateAccuracy(correctChars, totalTyped)
      : 100;

    const totalRaceTime = ((playerRacer.finishTime || raceElapsed * 1000) / 1000).toFixed(1);
    const bestLapTime =
      playerLapSplits.length > 0
        ? `${Math.min(...playerLapSplits).toFixed(1)}s`
        : "--";

    document.getElementById("player-result-summary").innerHTML = `
      <div><strong>${finalWpm}</strong><span>WPM</span></div>
      <div><strong>${finalAccuracy}%</strong><span>Accuracy</span></div>
      <div><strong>${totalRaceTime}s</strong><span>Total Time</span></div>
      <div><strong>${bestLapTime}</strong><span>Best Lap</span></div>
    `;
    worldWordEl.style.display = "none";
    resultsScreenEl.style.display = "flex";
  }

  document.getElementById("rematch-btn").addEventListener("click", () => {
    cleanup();
    startSinglePlayerRace(container);
  });

  const clock = new THREE.Clock();
  let animationId;
  let simulationAccumulator = 0;

  async function startCountdown() {
    const steps = ["3", "2", "1", "GO!"];
    countdownEl.style.display = "flex";
    for (const step of steps) {
      countdownEl.textContent = step;
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          (RACE_CONFIG.presentation.countdownDurationSeconds / steps.length) *
            1000,
        ),
      );
    }
    countdownFinished = true;
    countdownEl.textContent = "GO!";
  }
  cinematicCamera.begin(gridVehicles, vehicle);

  function animate() {
    animationId = requestAnimationFrame(animate);
    const frameDt = Math.min(
      clock.getDelta(),
      RACE_CONFIG.presentation.maxFrameDeltaSeconds,
    );

    if (raceStarted && !raceOver) {
      simulationAccumulator += frameDt;
      while (
        simulationAccumulator >= RACE_CONFIG.presentation.simulationStepSeconds
      ) {
        const dt = RACE_CONFIG.presentation.simulationStepSeconds;
        simulationAccumulator -= dt;
        if (words.length > 0 && !playerFinished) {
          if (raceElapsed - lastInputRaceTime >= RACE_CONFIG.idleDelaySeconds) {
            idleAccumulator += dt;
            if (idleAccumulator >= RACE_CONFIG.idleStepIntervalSeconds) {
              const idleSteps = Math.floor(
                idleAccumulator / RACE_CONFIG.idleStepIntervalSeconds,
              );
              speed = Math.max(MIN_SPEED, speed - idleSteps * SPEED_STEP);
              idleAccumulator -=
                idleSteps * RACE_CONFIG.idleStepIntervalSeconds;
            }
          }
          progress = Math.min(progress + (speed * dt) / raceDistance, 1);

          // Check lap transitions
          const currentLap = Math.min(
            Math.floor(progress * RACE_CONFIG.laps) + 1,
            RACE_CONFIG.laps,
          );
          if (currentLap > lastTrackedLap && !playerFinished) {
            const splitTime = raceElapsed - currentLapStartTime;
            playerLapSplits.push(splitTime);
            currentLapStartTime = raceElapsed;
            lastTrackedLap = currentLap;
            triggerLapBanner(currentLap);
          }

          if (progress >= 1) {
            playerFinished = true;
            if (playerLapSplits.length < RACE_CONFIG.laps) {
              playerLapSplits.push(raceElapsed - currentLapStartTime);
            }
            renderCurrentWord();
          }
        }
        botRacers.forEach(({ bot }) => updateBotProgress(bot, dt));
        checkFinishes(dt);
      }

      // Render interpolation: the sim advances in coarse fixed steps, but the
      // frame rate may not divide evenly into them. Extrapolating by the
      // leftover accumulator fraction keeps every car gliding smoothly
      // frame-to-frame instead of lurching step-to-step.
      const interpolationFraction =
        simulationAccumulator / RACE_CONFIG.presentation.simulationStepSeconds;
      const playerStepProgress =
        (speed * RACE_CONFIG.presentation.simulationStepSeconds) /
        raceDistance;
      const renderedPlayerProgress = Math.min(
        progress + playerStepProgress * interpolationFraction,
        1,
      );
      const cameraProgress =
        renderedPlayerProgress >= 1
          ? 1
          : (renderedPlayerProgress * RACE_CONFIG.laps) % 1;
      updateVehiclePosition(
        vehicle,
        playerCurve,
        cameraProgress,
        vehicleSurfaceY,
      );
      botRacers.forEach(({ mesh, curve, bot }) => {
        const botStepProgress =
          (bot.currentSpeed / raceDistance) *
          RACE_CONFIG.presentation.simulationStepSeconds;
        const renderedBotProgress = Math.min(
          bot.progress + botStepProgress * interpolationFraction,
          1,
        );
        const botTrackProgress =
          renderedBotProgress >= 1
            ? 1
            : (renderedBotProgress * RACE_CONFIG.laps) % 1;
        updateVehiclePosition(mesh, curve, botTrackProgress, vehicleSurfaceY);
      });
      const normalizedSpeed = (speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED);
      followCamera.updateRace(frameDt, {
        normalizedSpeed,
        curve: playerCurve,
        trackProgress: cameraProgress,
      });
    } else if (!raceOver) {
      // Intro first: the camera flies in to the final framing while the cars
      // stay parked. Only once it settles does the countdown begin.
      if (!introComplete) {
        introComplete = cinematicCamera.update(frameDt);
        if (introComplete) followCamera.beginRace();
      }
      if (introComplete && !countdownStarted) {
        countdownStarted = true;
        startCountdown();
      }
      if (countdownFinished) {
        countdownEl.style.display = "none";
        raceStarted = true;
        currentLapStartTime = raceElapsed;
        triggerLapBanner(1);
        raceUiEl.classList.remove("race-ui--cinematic");
      }
    }

    climate.update(frameDt, vehicle.position);
    updateRaceProgressHud();
    updateWorldWordPosition();
    updatePerformanceHud();
    renderer.render(scene, camera);
  }
  animate();

  function onResize() {
    renderer.setPixelRatio(getRenderPixelRatio());
    viewport = fitRendererToAspect(renderer, camera, container);
  }
  window.addEventListener("resize", onResize);

  function cleanup() {
    cancelAnimationFrame(animationId);
    window.removeEventListener("keydown", handleKeydown);
    window.removeEventListener("resize", onResize);
    uiRoot.remove();
    followCamera.dispose();
    climate.dispose();
    renderer.dispose();
    container.innerHTML = "";
    if (previousContainerStyle === null) container.removeAttribute("style");
    else container.setAttribute("style", previousContainerStyle);
  }

  return cleanup;
}
