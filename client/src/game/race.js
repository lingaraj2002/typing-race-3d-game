import * as THREE from "three";
import { getStateCallbacks } from "@colyseus/sdk";
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
import {
  createCar,
  createCarGrid,
  loadBaseCarModel,
  usePlaceholderCarModel,
} from "./carFactory.js";
import { RACE_CONFIG } from "./raceConfig.js";
import {
  createRaceLaneCurve,
  createRandomRaceLaneOrder,
  describeStartGrid,
} from "./track.js";
import {
  fitRendererToAspect,
  getRenderPixelRatio,
  SCENE_ASPECT_RATIO,
} from "../utils/viewport.js";
import { renderLobby } from "../ui/lobby.js";

const playerCarModelUrl = new URL(
  "../../assets/models/vehicles/car_ferrari.glb",
  import.meta.url,
).href;
const rivalCarModelUrl = new URL(
  "../../assets/models/vehicles/car_vortex.glb",
  import.meta.url,
).href;
const trackTileUrl = "/assets/models/road_track.glb";

const FINISHED_PROMPT = "Finished! Waiting for other racers...";

// ─── Shared race UI ────────────────────────────────────────────────────────
//
// One screen design for both race modes: the single-player setup is the
// reference, and multiplayer renders through the very same markup and styles
// instead of keeping a second, staler copy of the HUD.

/**
 * The whole race screen as markup: HUD styles, progress standings, the
 * world-anchored word bubble, the performance panel, countdown and results.
 *
 * `resultsExtra` appends markup inside the results card. Single player passes
 * nothing so its card stays exactly as it was; multiplayer uses the slot for
 * its "waiting for the host" line.
 */
function raceUiMarkup({ resultsExtra = "" } = {}) {
  return `
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
        grid-template-columns: 46px minmax(0, 1fr) 56px;
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

      .race-standing__marker--finished {
        border-radius: 3px;
        background: var(--mint);
        box-shadow: 0 0 0 2px var(--ink-deep), 0 0 8px rgba(104, 224, 160, 0.8);
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
          grid-template-columns: 37px minmax(0, 1fr) 50px;
          gap: 5px;
          font-size: 9px;
        }
        .performance-stat { padding: 10px 4px 9px; }
        .performance-stat__label { font-size: 8px; }
      }

    </style>

    <div id="race-ui" class="race-ui--cinematic" aria-hidden="true">
      <section id="race-progress-hud" class="race-panel">
        <p class="race-hud-title">Race progress</p>
        <div id="race-standings"></div>
      </section>
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
        <button id="rematch-btn" class="result-button" type="button">Race Again <span>&rarr;</span></button>${resultsExtra}
      </div>
    </div>
  `;
}

/**
 * Mounts the race overlay.
 *
 * UI must live OUTSIDE the 3D container: the renderer wipes the container, so a
 * positioned overlay beside the 16:9 stage owns all race UI.
 */
function createRaceOverlay(container, options) {
  const uiRoot = document.createElement("div");
  uiRoot.id = "race-ui-root";
  uiRoot.style.cssText =
    "position:fixed;inset:0;z-index:10;pointer-events:none;";
  (container.parentElement ?? document.body).appendChild(uiRoot);
  uiRoot.innerHTML = raceUiMarkup(options);
  return uiRoot;
}

/** Element handles for the mounted overlay. */
function collectRaceUi(uiRoot) {
  const byId = (id) => uiRoot.querySelector(`#${id}`);
  return {
    root: byId("race-ui"),
    standings: byId("race-standings"),
    worldWord: byId("world-word"),
    prompt: byId("prompt-text"),
    wpm: byId("wpm-value"),
    accuracy: byId("accuracy-value"),
    words: byId("words-value"),
    countdown: byId("countdown"),
    loading: byId("pre-race-loading"),
    results: byId("results-screen"),
    resultsList: byId("results-list"),
    playerSummary: byId("player-result-summary"),
    rematchBtn: byId("rematch-btn"),
    rematchWait: byId("rematch-wait"),
  };
}

// ─── Shared race stage ─────────────────────────────────────────────────────

/**
 * Container, scene, world, renderer, climate and camera: the setup both race
 * modes share, built before any mode-specific racer logic runs.
 */
async function createRaceStage(container) {
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

  const world = await buildWorld(scene, trackTileUrl, {
    tileCount: 10,
    lights: lighting,
  });
  const trackSurfaceY = world.surfaceY;
  const vehicleSurfaceY = trackSurfaceY + 0.05;
  const roadCenter = world.layout.roadCenter;
  const trackWidth = world.layout.trackWidth;

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

  return {
    scene,
    world,
    trackSurfaceY,
    vehicleSurfaceY,
    roadCenter,
    trackWidth,
    renderer,
    climate,
    camera,
    getViewport: () => viewport,
    refit() {
      renderer.setPixelRatio(getRenderPixelRatio());
      viewport = fitRendererToAspect(renderer, camera, container);
    },
    /** Puts the container's inline style back the way the caller found it. */
    restoreContainerStyle() {
      if (previousContainerStyle === null) container.removeAttribute("style");
      else container.setAttribute("style", previousContainerStyle);
    },
  };
}

// ─── Shared race grid ──────────────────────────────────────────────────────

/**
 * Loads the player's dedicated GLB and the shared rival GLB, keeping each
 * asset's authored materials intact. A failed load degrades to the placeholder
 * car rather than taking the whole race down.
 */
async function loadRaceCarModels() {
  let playerModelFallback = false;
  const [playerBaseModel, rivalBaseModel] = await Promise.all([
    loadBaseCarModel(playerCarModelUrl).catch((error) => {
      playerModelFallback = true;
      return usePlaceholderCarModel(error);
    }),
    loadBaseCarModel(rivalCarModelUrl).catch(usePlaceholderCarModel),
  ]);
  return { playerBaseModel, rivalBaseModel, playerModelFallback };
}

/**
 * Builds the starting grid: `carCount` cars in total, the local player on the
 * dedicated player model and every rival on the shared rival model.
 *
 * The combined grid owns the whole field's disposal and reports the widest
 * car, which is what decides whether the grid fits inside the painted road.
 */
function createRaceGrid({
  playerBaseModel,
  rivalBaseModel,
  playerModelFallback,
  carCount,
  hasLocalPlayer = true,
}) {
  const playerCar = hasLocalPlayer
    ? createCar(playerBaseModel, {
        type: "sports",
        worldScale: RACE_CONFIG.vehicle.singlePlayerScale,
        modelRotationY: playerModelFallback ? 0 : Math.PI,
        preserveMaterials: !playerModelFallback,
      })
    : null;
  const rivalGrid = createCarGrid(rivalBaseModel, {
    worldScale: RACE_CONFIG.vehicle.singlePlayerScale,
    variants: ["sports"],
    count: Math.max(0, carCount - (hasLocalPlayer ? 1 : 0)),
    preserveMaterials: true,
  });
  const allCars = playerCar ? [playerCar, ...rivalGrid.cars] : rivalGrid.cars;

  return {
    playerCar,
    rivalCars: rivalGrid.cars,
    cars: allCars,
    halfWidth: allCars.reduce(
      (widest, car) => Math.max(widest, car.bounds.halfWidth),
      0,
    ),
    dispose() {
      playerCar?.dispose();
      rivalGrid.dispose();
      allCars.length = 0;
    },
  };
}

/** The chase camera and the pre-race intro shot, framed the same in both modes. */
function createRaceCameras({ camera, scene, vehicle, trackSurfaceY }) {
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
  return { followCamera, cinematicCamera };
}

// ─── Shared race HUD ───────────────────────────────────────────────────────

/** One standings entry: where progress comes from, plus finish bookkeeping. */
function createRacer({ name, isPlayer = false, key = name, getProgress }) {
  return {
    name,
    key,
    isPlayer,
    finished: false,
    finishTime: null,
    lastProgress: 0,
    didNotFinish: false,
    getProgress,
  };
}

/**
 * Builds one row per racer. Rows are created once and only ever updated in
 * place; the DOM order never changes, so the position label carries the ranking.
 */
function createStandingsHud(standingsEl, racers) {
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
    standingsEl.appendChild(row);
    racerHud.set(racer, { marker, meta });
  });

  return racerHud;
}

// Markers track whole-race progress (0-100% across every lap) so a racer a
// full lap ahead is visibly further along instead of looping back to the start.
function updateRaceProgressHud(racers, racerHud) {
  const orderedRacers = [...racers].sort(
    (a, b) => b.getProgress() - a.getProgress(),
  );
  orderedRacers.forEach((racer, index) => {
    const racerTotalProg = THREE.MathUtils.clamp(racer.getProgress(), 0, 1);
    const hud = racerHud.get(racer);
    const percent = Math.round(racerTotalProg * 100);
    hud.marker.style.left = `${racerTotalProg * 100}%`;
    hud.meta.textContent = `#${index + 1} · ${percent}%`;
    hud.marker.classList.toggle(
      "race-standing__marker--finished",
      racer.finished,
    );
  });
}

/** Live WPM / accuracy / word count, repainted only when a value changes. */
function createPerformanceHud(ui) {
  let lastPerformanceValues = "";

  return function updatePerformanceHud({ wpm, accuracy, words, speed }) {
    const values = `${speed}|${wpm}|${accuracy}|${words}`;
    if (values === lastPerformanceValues) return;
    lastPerformanceValues = values;
    ui.wpm.textContent = wpm;
    ui.accuracy.textContent = `${accuracy}%`;
    ui.words.textContent = words;
  };
}

/** Ranks finishers by time, unfinished racers behind them by distance covered. */
function sortRaceResults(racers) {
  return [...racers].sort((a, b) => {
    if (a.didNotFinish !== b.didNotFinish) return a.didNotFinish ? 1 : -1;
    if (a.didNotFinish) return b.getProgress() - a.getProgress();
    return (
      (a.finishTime ?? Number.POSITIVE_INFINITY) -
      (b.finishTime ?? Number.POSITIVE_INFINITY)
    );
  });
}

// Reused per-frame scratch for the word bubble projection.
const worldWordAnchor = new THREE.Vector3();
const worldWordProjection = new THREE.Vector3();

/**
 * The typing run: the word queue, per-character state and the on-screen prompt.
 * Modes own when a keystroke counts (their own start conditions) and what a
 * keystroke means for the race; this owns the words and how they are shown.
 *
 * `replenish` keeps topping the queue up. Single player runs a fixed-length
 * course and leaves the feed alone; multiplayer tops up because the server
 * owns the finish line.
 */
function createTypingSession({
  promptEl,
  wordCount,
  wordLength,
  replenish = false,
}) {
  const usedWords = new Set();
  let words = [];
  let currentWordIndex = 0;
  let currentCharIndex = 0;
  let correctChars = 0;
  let totalTyped = 0;
  let startTime = null;
  let finished = false;

  async function getNewWordBatch() {
    const batch = await generateWordSet(
      "medium",
      wordCount,
      usedWords,
      wordLength,
    );
    batch.forEach((word) => usedWords.add(word));
    return batch;
  }

  function renderCurrentWord() {
    if (finished) {
      promptEl.textContent = FINISHED_PROMPT;
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

  async function ensureMoreWords() {
    if (!replenish) return;
    if (currentWordIndex >= words.length - 5) {
      words = words.concat(await getNewWordBatch());
    }
  }

  /**
   * Applies one printable keystroke.
   * @returns {"correct"|"wrong"|"ignored"} what the keystroke was worth.
   */
  function applyKey(key) {
    if (finished || !words.length || currentWordIndex >= words.length) {
      return "ignored";
    }
    if (key.length !== 1) return "ignored";
    if (!startTime) startTime = Date.now();

    const target = words[currentWordIndex];
    const expectedChar = target[currentCharIndex];
    totalTyped++;

    if (key === expectedChar) {
      correctChars++;
      currentCharIndex++;
      if (currentCharIndex >= target.length) {
        currentWordIndex++;
        currentCharIndex = 0;
        ensureMoreWords();
      }
    }

    renderCurrentWord();
    return key === expectedChar ? "correct" : "wrong";
  }

  return {
    load() {
      return getNewWordBatch().then((batch) => {
        words = batch;
        renderCurrentWord();
      });
    },
    applyKey,
    get finished() {
      return finished;
    },
    /** The car only moves once words are on screen. */
    get hasWords() {
      return words.length > 0;
    },
    /** Correct keystrokes so far — the figure multiplayer reports upward. */
    get correctCharacters() {
      return correctChars;
    },
    /** Marks the run over; the prompt switches to the waiting-for-racers line. */
    finish() {
      finished = true;
      renderCurrentWord();
    },
    /** WPM / accuracy / words, sampled the way the HUD and results read them. */
    readPerformance() {
      return {
        wpm: startTime
          ? calculateWPM(correctChars, Date.now() - startTime)
          : 0,
        accuracy: totalTyped
          ? calculateAccuracy(correctChars, totalTyped)
          : 100,
        words: currentWordIndex,
      };
    },
  };
}

/**
 * Keeps the word bubble pinned above the player's car, hiding it whenever the
 * race is not in a state where typing is the player's focus.
 */
function updateWorldWordPosition({
  visible,
  worldWordEl,
  vehicle,
  camera,
  carTopHeight,
  viewport,
}) {
  if (!visible) {
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

/** Runs the 3-2-1-GO countdown on the shared overlay. */
async function playCountdown(countdownEl) {
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
  countdownEl.textContent = "GO!";
}

/** Records each racer crossing the line, interpolating the exact moment. */
function checkRaceFinishes(racers, raceElapsed, dt) {
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
}

// ─── Single player race ────────────────────────────────────────────────────
//
// The reference race: a local simulation against CPU bots. Every other race
// mode borrows its scene, HUD and camera setup from the helpers above.

export async function startSinglePlayerRace(container) {
  const uiRoot = createRaceOverlay(container);
  const ui = collectRaceUi(uiRoot);

  const stage = await createRaceStage(container);
  const {
    scene,
    world,
    trackSurfaceY,
    vehicleSurfaceY,
    roadCenter,
    trackWidth,
    renderer,
    climate,
    camera,
  } = stage;

  // ── Vehicles ─────────────────────────────────────────────────────────────
  // The grid is laid out before the cars exist so the starting lanes depend on
  // the real road width, and the widest car's measured width is what proves the
  // road is wide enough for the whole field to sit inside the painted road.
  const { playerBaseModel, rivalBaseModel, playerModelFallback } =
    await loadRaceCarModels();
  ui.loading?.remove();

  const carGrid = createRaceGrid({
    playerBaseModel,
    rivalBaseModel,
    playerModelFallback,
    carCount: RACE_CONFIG.world.laneCount,
  });
  const playerCar = carGrid.playerCar;
  const vehicle = playerCar.root;
  const carTopHeight = playerCar.bounds.height;

  describeStartGrid({
    trackWidth,
    carHalfWidth: carGrid.halfWidth,
  });

  const laneOrder = createRandomRaceLaneOrder();
  const playerCurve = createRaceLaneCurve(
    roadCenter,
    world.totalLength,
    laneOrder[0],
    undefined,
    { trackWidth },
  );
  const botCurves = laneOrder
    .slice(1)
    .map((laneIndex) =>
      createRaceLaneCurve(roadCenter, world.totalLength, laneIndex, undefined, {
        trackWidth,
      }),
    );

  scene.add(vehicle);

  const { followCamera, cinematicCamera } = createRaceCameras({
    camera,
    scene,
    vehicle,
    trackSurfaceY,
  });

  const raceDistance = world.totalLength * RACE_CONFIG.laps;
  const botRacers = botCurves.map((curve, i) => {
    const car = carGrid.rivalCars[i];
    scene.add(car.root);
    return { car, mesh: car.root, curve, bot: createBotRacer(i, raceDistance) };
  });
  const gridVehicles = [vehicle, ...botRacers.map(({ mesh }) => mesh)];

  updateVehiclePosition(vehicle, playerCurve, 0, vehicleSurfaceY);
  botRacers.forEach(({ mesh, curve }) => {
    updateVehiclePosition(mesh, curve, 0, vehicleSurfaceY);
  });
  // The cars have just been placed, so drop the motion history the wheel rig
  // keeps: the first update after this must not read the jump from the origin.
  playerCar.resetMotion();
  botRacers.forEach(({ car }) => car.resetMotion());

  // ── Typing state ─────────────────────────────────────────────────────────
  let progress = 0;
  let speed = RACE_CONFIG.baseSpeed;
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

  const typing = createTypingSession({
    promptEl: ui.prompt,
    wordCount: RACE_CONFIG.wordCount,
    wordLength: RACE_CONFIG.wordLength,
  });
  typing.load();

  function handleKeydown(e) {
    if (!raceStarted || typing.finished) return;
    const outcome = typing.applyKey(e.key);
    if (outcome === "ignored") return;
    lastInputRaceTime = raceElapsed;
    idleAccumulator = 0;
    speed =
      outcome === "correct"
        ? Math.min(speed + SPEED_STEP, MAX_SPEED)
        : Math.max(speed - SPEED_STEP, MIN_SPEED);
  }
  window.addEventListener("keydown", handleKeydown);

  const racers = [
    createRacer({
      name: "You",
      isPlayer: true,
      getProgress: () => progress,
    }),
    ...botRacers.map((r, i) =>
      createRacer({
        name: `Bot ${i + 1}`,
        getProgress: () => r.bot.progress,
      }),
    ),
  ];
  const racerHud = createStandingsHud(ui.standings, racers);
  const updatePerformanceHud = createPerformanceHud(ui);

  function showResults() {
    const playerRacer = racers[0];
    // The player finishing ends the local race. Any bot still on the track is
    // recorded as DNF instead of receiving a fake null finish time.
    racers.forEach((racer) => {
      if (!racer.finished) racer.didNotFinish = true;
    });

    ui.resultsList.innerHTML = sortRaceResults(racers)
      .map((racer, index) => {
        const result = racer.didNotFinish
          ? "Lose"
          : `${(racer.finishTime / 1000).toFixed(1)}s`;
        return `${index + 1}. ${racer.name} — ${result}`;
      })
      .join("<br>");

    const { wpm, accuracy } = typing.readPerformance();
    const totalRaceTime = (
      (playerRacer.finishTime || raceElapsed * 1000) /
      1000
    ).toFixed(1);
    const bestLapTime =
      playerLapSplits.length > 0
        ? `${Math.min(...playerLapSplits).toFixed(1)}s`
        : "--";

    ui.playerSummary.innerHTML = `
      <div><strong>${wpm}</strong><span>WPM</span></div>
      <div><strong>${accuracy}%</strong><span>Accuracy</span></div>
      <div><strong>${totalRaceTime}s</span><span>Total Time</span></div>
      <div><strong>${bestLapTime}</strong><span>Best Lap</span></div>
    `;
    ui.worldWord.style.display = "none";
    ui.results.style.display = "flex";
  }

  ui.rematchBtn.addEventListener("click", () => {
    cleanup();
    startSinglePlayerRace(container);
  });

  const clock = new THREE.Clock();
  let animationId;
  let simulationAccumulator = 0;

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
        if (typing.hasWords && !typing.finished) {
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
          if (currentLap > lastTrackedLap && !typing.finished) {
            const splitTime = raceElapsed - currentLapStartTime;
            playerLapSplits.push(splitTime);
            currentLapStartTime = raceElapsed;
            lastTrackedLap = currentLap;
          }

          if (progress >= 1) {
            typing.finish();
            if (playerLapSplits.length < RACE_CONFIG.laps) {
              playerLapSplits.push(raceElapsed - currentLapStartTime);
            }
          }
        }
        botRacers.forEach(({ bot }) => updateBotProgress(bot, dt));
        raceElapsed += dt;
        checkRaceFinishes(racers, raceElapsed, dt);

        // Bots can finish before the player. They remain on the results order,
        // but never end the player's typing run or mark the player as DNF.
        if (!raceOver && racers[0].finished) {
          raceOver = true;
          showResults();
        }
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
        playCountdown(ui.countdown).then(() => {
          countdownFinished = true;
          ui.countdown.textContent = "GO!";
        });
      }
      if (countdownFinished) {
        ui.countdown.style.display = "none";
        raceStarted = true;
        currentLapStartTime = raceElapsed;
        ui.root.classList.remove("race-ui--cinematic");
      }
    }

    // Wheels follow the cars that were just placed above: rolling is derived
    // from the distance each car actually covered, steering from its heading
    // change, so parked cars during the intro and countdown stay still.
    playerCar.update(frameDt);
    botRacers.forEach(({ car }) => car.update(frameDt));

    climate.update(frameDt, vehicle.position);
    updateRaceProgressHud(racers, racerHud);
    updateWorldWordPosition({
      visible: raceStarted && !raceOver && !typing.finished,
      worldWordEl: ui.worldWord,
      vehicle,
      camera,
      carTopHeight,
      viewport: stage.getViewport(),
    });
    updatePerformanceHud({
      ...typing.readPerformance(),
      speed: speed.toFixed(2),
    });
    world.update(frameDt);
    renderer.render(scene, camera);
  }
  animate();

  function onResize() {
    stage.refit();
  }
  window.addEventListener("resize", onResize);

  function cleanup() {
    cancelAnimationFrame(animationId);
    window.removeEventListener("keydown", handleKeydown);
    window.removeEventListener("resize", onResize);
    uiRoot.remove();
    followCamera.dispose();
    climate.dispose();
    // Frees this grid's cloned materials and add-on parts. The shared base
    // model, its geometry and its textures stay cached for the next race.
    carGrid.dispose();
    renderer.dispose();
    container.innerHTML = "";
    stage.restoreContainerStyle();
  }

  return cleanup;
}

// ─── Multiplayer race ──────────────────────────────────────────────────────
//
// Same scene, HUD, cameras and race feel as the single-player run. Only the
// ownership changes: the server decides when the race starts, every car is
// placed from the room's progress values, and local keystrokes are reported
// back instead of driving a local simulation.

export async function startMultiplayerRace(container, room) {
  const uiRoot = createRaceOverlay(container, {
    resultsExtra: '\n        <div id="rematch-wait" class="result-wait"></div>',
  });
  const ui = collectRaceUi(uiRoot);

  const stage = await createRaceStage(container);
  const {
    scene,
    world,
    trackSurfaceY,
    vehicleSurfaceY,
    roadCenter,
    trackWidth,
    renderer,
    climate,
    camera,
  } = stage;

  // ── Vehicles ─────────────────────────────────────────────────────────────
  const { playerBaseModel, rivalBaseModel, playerModelFallback } =
    await loadRaceCarModels();
  ui.loading?.remove();

  const players = [...room.state.players.values()];
  const hasLocalPlayer = players.some((p) => p.sessionId === room.sessionId);

  const carGrid = createRaceGrid({
    playerBaseModel,
    rivalBaseModel,
    playerModelFallback,
    carCount: players.length,
    hasLocalPlayer,
  });
  const carTopHeight = carGrid.playerCar?.bounds.height ?? 0;

  // Lanes follow the real road width; the widest car's measured width proves
  // the road is wide enough for the grid.
  describeStartGrid({
    laneCount: Math.max(RACE_CONFIG.world.laneCount, players.length),
    trackWidth,
    carHalfWidth: carGrid.halfWidth,
  });

  // The local player takes the dedicated player car; every other seat shares
  // the rival model, dealt out in the order the room lists its players.
  const vehicles = new Map(); // sessionId -> { car, mesh, curve }
  let rivalIndex = 0;
  let myVehicle = null;

  players.forEach((p) => {
    const isLocal = p.sessionId === room.sessionId;
    const car = isLocal ? carGrid.playerCar : carGrid.rivalCars[rivalIndex++];
    const curve = createRaceLaneCurve(
      roadCenter,
      world.totalLength,
      p.slot ?? 0,
      RACE_CONFIG.world.laneCount,
      { trackWidth },
    );
    scene.add(car.root);
    vehicles.set(p.sessionId, { car, mesh: car.root, curve });
    if (isLocal) myVehicle = vehicles.get(p.sessionId);
    updateVehiclePosition(car.root, curve, 0, vehicleSurfaceY);
    car.resetMotion();
  });

  // ── Cameras ──────────────────────────────────────────────────────────────
  // A seat that is not in the room yet (a late join watching the countdown)
  // gets a fixed framing instead of a chase camera.
  let followCamera = null;
  let cinematicCamera = null;
  if (myVehicle) {
    const cameras = createRaceCameras({
      camera,
      scene,
      vehicle: myVehicle.mesh,
      trackSurfaceY,
    });
    followCamera = cameras.followCamera;
    cinematicCamera = cameras.cinematicCamera;
    cinematicCamera.begin(
      [...vehicles.values()].map(({ mesh }) => mesh),
      myVehicle.mesh,
    );
  } else {
    camera.position.set(0, trackSurfaceY + 9, 16);
    camera.lookAt(0, trackSurfaceY, -40);
  }

  const $ = getStateCallbacks(room);
  const unsubscribers = [];
  /** Registers a schema listener and remembers how to detach it again. */
  function listen(path, handler) {
    const off = $(room.state).listen(path, handler);
    if (typeof off === "function") unsubscribers.push(off);
  }

  const offPlayerAdded = $(room.state).players.onAdd((p) => {
    // handles anyone who joins mid-setup — simplified for now, full lane logic can improve later
  });
  if (typeof offPlayerAdded === "function") unsubscribers.push(offPlayerAdded);

  // --- countdown, driven by the server ---
  listen("countdown", (value) => {
    ui.countdown.style.display = "flex";
    ui.countdown.textContent = value > 0 ? value : "GO!";
    if (value <= 0) setTimeout(() => (ui.countdown.textContent = ""), 500);
  });

  // --- typing state, own player only ---
  let raceStarted = false;
  let introComplete = !cinematicCamera;
  let raceOver = false;

  const typing = createTypingSession({
    promptEl: ui.prompt,
    wordCount: 25,
    wordLength: null,
    replenish: true,
  });
  typing.load();

  function handleKeydown(e) {
    if (room.state.status !== "racing" || !introComplete || typing.finished) {
      return;
    }
    typing.applyKey(e.key);
  }
  window.addEventListener("keydown", handleKeydown);

  const racers = players.map((p) =>
    createRacer({
      name:
        p.sessionId === room.sessionId
          ? `${p.displayName} (You)`
          : p.displayName,
      key: p.sessionId,
      isPlayer: p.sessionId === room.sessionId,
      getProgress: () => room.state.players.get(p.sessionId)?.progress ?? 0,
    }),
  );
  const racerHud = createStandingsHud(ui.standings, racers);
  const updatePerformanceHud = createPerformanceHud(ui);

  // Send typing progress to the server ~10x/sec instead of on every keystroke.
  let lastSentWpm = -1,
    lastSentAccuracy = -1,
    lastSentChars = -1;

  const syncInterval = setInterval(() => {
    if (room.state.status !== "racing" || typing.finished) return;

    const { wpm, accuracy } = typing.readPerformance();
    const correctCharacters = typing.correctCharacters;

    // only send if something actually changed — avoid pointless identical packets
    if (
      correctCharacters !== lastSentChars ||
      wpm !== lastSentWpm ||
      accuracy !== lastSentAccuracy
    ) {
      room.send("typingProgress", { typedCharacters: correctCharacters, wpm, accuracy });
      lastSentChars = correctCharacters;
      lastSentWpm = wpm;
      lastSentAccuracy = accuracy;
    }
  }, 100); // 10 times per second

  function showMultiplayerResults() {
    const finishedPlayers = [...room.state.players.values()].sort(
      (a, b) => a.finishPosition - b.finishPosition,
    );
    const player = finishedPlayers.find((p) => p.sessionId === room.sessionId);
    if (player) {
      ui.playerSummary.innerHTML = `
        <div><strong>${player.wpm}</strong><span>WPM</span></div>
        <div><strong>${player.accuracy}%</strong><span>Accuracy</span></div>
        <div><strong>${typing.readPerformance().words}</strong><span>Words</span></div>
      `;
    }
    ui.resultsList.innerHTML = finishedPlayers
      .map(
        (p, i) =>
          `${i + 1}. ${p.displayName} — ${p.finished ? `${(p.finishTime / 1000).toFixed(1)}s` : "Lose"}`,
      )
      .join("<br>");

    ui.results.style.display = "flex";

    if (room.sessionId === room.state.hostId) {
      // Cloning the button strips any previously-attached listeners.
      const rematchBtn = ui.rematchBtn.cloneNode(true);
      ui.rematchBtn.replaceWith(rematchBtn);
      rematchBtn.style.display = "inline-block";
      rematchBtn.addEventListener("click", () => {
        room.send("rematch");
      });
    } else if (ui.rematchWait) {
      ui.rematchWait.textContent = "Waiting for host to start a rematch...";
    }
  }

  listen("status", (value) => {
    if (value === "finished") {
      raceOver = true;
      clearInterval(syncInterval);
      ui.worldWord.style.display = "none";
      showMultiplayerResults();
    } else if (value === "lobby") {
      // Hand the screen back to the lobby: this race stops here and the lobby
      // takes the container over again.
      cleanup();
      renderLobby(container, room, () => startMultiplayerRace(container, room));
    }
  });

  const clock = new THREE.Clock();
  let animationId;
  let previousCameraProgress = 0;

  function animate() {
    animationId = requestAnimationFrame(animate);
    const frameDt = Math.min(
      clock.getDelta(),
      RACE_CONFIG.presentation.maxFrameDeltaSeconds,
    );

    if (cinematicCamera && !introComplete) {
      introComplete = cinematicCamera.update(frameDt);
      if (introComplete) followCamera.beginRace();
    }

    if (room.state.status === "racing" && introComplete && !raceStarted) {
      raceStarted = true;
      ui.countdown.style.display = "none";
      ui.root.classList.remove("race-ui--cinematic");
    }

    if (raceStarted && !raceOver) {
      const myProgress = room.state.players.get(room.sessionId)?.progress ?? 0;
      if (myProgress >= 1 && !typing.finished) typing.finish();

      vehicles.forEach(({ car, mesh, curve }, sessionId) => {
        const p = room.state.players.get(sessionId);
        const progress = p?.progress ?? 0;
        updateVehiclePosition(mesh, curve, progress, vehicleSurfaceY);
        // Wheels roll from the distance each car actually covered, so they stay
        // locked to the movement the server drives.
        car.update(frameDt);
      });

      if (followCamera) {
        const progressVelocity =
          frameDt > 0
            ? Math.max(0, (myProgress - previousCameraProgress) / frameDt)
            : 0;
        previousCameraProgress = myProgress;
        followCamera.updateRace(frameDt, {
          normalizedSpeed: THREE.MathUtils.clamp(
            progressVelocity / 0.08,
            0,
            1,
          ),
          curve: myVehicle.curve,
          trackProgress: myProgress,
        });
      }

      racers.forEach((racer) => {
        racer.finished = !!room.state.players.get(racer.key)?.finished;
      });
    }

    climate.update(frameDt, myVehicle?.mesh.position);
    updateRaceProgressHud(racers, racerHud);
    if (myVehicle) {
      updateWorldWordPosition({
        visible: raceStarted && !raceOver && !typing.finished,
        worldWordEl: ui.worldWord,
        vehicle: myVehicle.mesh,
        camera,
        carTopHeight,
        viewport: stage.getViewport(),
      });
    } else {
      ui.worldWord.style.display = "none";
    }
    updatePerformanceHud({
      ...typing.readPerformance(),
      // Server-driven motion, so there is no local speed to fold into the
      // change-detection key.
      speed: 0,
    });
    world.update(frameDt);
    renderer.render(scene, camera);
  }
  animate();

  function onResize() {
    stage.refit();
  }
  window.addEventListener("resize", onResize);

  function cleanup() {
    cancelAnimationFrame(animationId);
    clearInterval(syncInterval);
    window.removeEventListener("keydown", handleKeydown);
    window.removeEventListener("resize", onResize);
    unsubscribers.forEach((off) => off());
    unsubscribers.length = 0;
    uiRoot.remove();
    followCamera?.dispose();
    climate.dispose();
    carGrid.dispose();
    renderer.dispose();
    container.innerHTML = "";
    stage.restoreContainerStyle();
  }

  return cleanup;
}