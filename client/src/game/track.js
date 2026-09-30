import * as THREE from "three";
import { loadModel } from "../utils/assetLoader.js";
import { configureShadowMesh } from "./scene.js";
import { RACE_CONFIG } from "./raceConfig.js";

// ─── Track Shape (ellipse, arc-length parameterised) ─────────────────────────

export const TRACK_RADIUS_X = 110;
export const TRACK_RADIUS_Z = 76;
const TRACK_SEGMENTS = 1024;
const TWO_PI = Math.PI * 2;

// Arc-length samples keep forward movement at constant speed through the bends.
const centerlineDistances = new Float64Array(TRACK_SEGMENTS + 1);
for (let i = 1; i <= TRACK_SEGMENTS; i++) {
  const previous = ((i - 1) / TRACK_SEGMENTS) * TWO_PI;
  const current = (i / TRACK_SEGMENTS) * TWO_PI;
  centerlineDistances[i] =
    centerlineDistances[i - 1] +
    Math.hypot(
      TRACK_RADIUS_X * (Math.sin(current) - Math.sin(previous)),
      TRACK_RADIUS_Z * (Math.cos(current) - Math.cos(previous)),
    );
}
export const TRACK_LENGTH = centerlineDistances[TRACK_SEGMENTS];

/** Arc-length fraction (0..1) -> ellipse parameter t in radians. */
function ellipseParam(u) {
  const distance = THREE.MathUtils.euclideanModulo(u, 1) * TRACK_LENGTH;
  let low = 0;
  let high = TRACK_SEGMENTS;
  while (high - low > 1) {
    const middle = (low + high) >>> 1;
    if (centerlineDistances[middle] <= distance) low = middle;
    else high = middle;
  }
  const span = centerlineDistances[high] - centerlineDistances[low] || 1;
  const fraction = (distance - centerlineDistances[low]) / span;
  return ((low + fraction) / TRACK_SEGMENTS) * TWO_PI;
}

class EllipseCurve extends THREE.Curve {
  /**
   * laneOffset keeps the old circle convention: positive = outward (toward the
   * beach), negative = inland. Lanes share the centerline parameter, so cars
   * in different lanes stay side by side at the same progress.
   */
  constructor(centerX, centerZ, laneOffset = 0) {
    super();
    this.centerX = centerX;
    this.centerZ = centerZ;
    this.inland = -laneOffset;

    if (this.inland === 0) {
      this.totalLength = TRACK_LENGTH;
    } else {
      const samples = 512;
      const previous = new THREE.Vector3();
      const current = new THREE.Vector3();
      this._pointAtT(0, previous);
      let length = 0;
      for (let i = 1; i <= samples; i++) {
        this._pointAtT((i / samples) * TWO_PI, current);
        length += previous.distanceTo(current);
        previous.copy(current);
      }
      this.totalLength = length;
    }
  }

  _pointAtT(t, target) {
    const dx = TRACK_RADIUS_X * Math.cos(t);
    const dz = TRACK_RADIUS_Z * Math.sin(t);
    const length = Math.hypot(dx, dz);
    return target.set(
      this.centerX + TRACK_RADIUS_X * Math.sin(t) - (this.inland * dz) / length,
      0,
      this.centerZ - TRACK_RADIUS_Z * Math.cos(t) + (this.inland * dx) / length,
    );
  }

  getPoint(u, target = new THREE.Vector3()) {
    return this._pointAtT(ellipseParam(u), target);
  }

  getTangent(u, target = new THREE.Vector3()) {
    const t = ellipseParam(u);
    return target
      .set(TRACK_RADIUS_X * Math.cos(t), 0, TRACK_RADIUS_Z * Math.sin(t))
      .normalize();
  }

  getLength() {
    return this.totalLength;
  }

  getPointAt(u, target) {
    return this.getPoint(u, target);
  }

  getTangentAt(u, target) {
    return this.getTangent(u, target);
  }
}

export function createCircleTrackLayout(length, trackWidth = 24) {
  const radius = Math.max(16, length / (2 * Math.PI));
  return { radius, straightLength: 0, trackWidth };
}

/** @deprecated Stadium ovals were replaced by an ellipse. */
export function createStadiumTrackLayout(length, trackWidth = 24) {
  return createCircleTrackLayout(length, trackWidth);
}

// `length` is ignored now: the size comes from TRACK_RADIUS_X / TRACK_RADIUS_Z.
export function createTrackCurve(
  laneOffset = 0,
  length = 100,
  centerX = 0,
  centerZ = 0,
) {
  return new EllipseCurve(centerX, centerZ, laneOffset);
}

// ─── Starting Grid Layout ────────────────────────────────────────────────────
//
// The asphalt ribbon is wider than the road the player actually reads as
// drivable: the cream edge lines in the road texture are painted a little
// inboard of the ribbon edges (see createRoadTexture), so the usable width is
// the span between those lines. Laying lanes out on the full ribbon width puts
// the outside cars' wheels past the painted line, which reads as "hanging off
// the road". The edge-line inset is therefore derived from the same constants
// the texture uses, so the two can never drift apart.
const ROAD_TEXTURE_SIZE = 512;
const ROAD_EDGE_LINE_INSET = 20;
const ROAD_EDGE_LINE_WIDTH = 8;
// Inner edge of the left/right cream line, in texture pixels.
const ROAD_DRIVABLE_INSET = ROAD_EDGE_LINE_INSET + ROAD_EDGE_LINE_WIDTH; // 28px
const ROAD_DRIVABLE_WIDTH_RATIO =
  (ROAD_TEXTURE_SIZE - ROAD_DRIVABLE_INSET * 2) / ROAD_TEXTURE_SIZE;

// Breathing room between the outermost car and the painted line.
const LANE_EDGE_MARGIN = 0.3;

/** Usable road width between the painted edge lines, for a given ribbon width. */
export function roadDrivableWidth(trackWidth) {
  return trackWidth * ROAD_DRIVABLE_WIDTH_RATIO;
}

/**
 * Lateral offset of one grid lane centre from the road centre, in world units.
 *
 * The lanes divide the DRIVABLE width (the span between the painted edge
 * lines) evenly, and each car sits centred in its lane. That keeps the grid
 * symmetric about the centreline, keeps every gap equal, and is driven purely
 * by the road width, so it stays correct for any road width. The car's width
 * only decides whether the road is wide ENOUGH — see minimumTrackWidth — and
 * never squeezes the spacing, so a wide car cannot silently push the lanes
 * around.
 */
export function computeLaneOffset(
  laneIndex,
  {
    laneCount = RACE_CONFIG.world.laneCount,
    trackWidth = RACE_CONFIG.world.trackWidth,
  } = {},
) {
  const safeLaneCount = Math.max(1, Math.floor(laneCount));
  const centeredLaneIndex = THREE.MathUtils.clamp(
    Math.floor(laneIndex),
    0,
    safeLaneCount - 1,
  );
  const laneWidth = roadDrivableWidth(trackWidth) / safeLaneCount;
  return -drivableHalfWidth(trackWidth) + laneWidth * (centeredLaneIndex + 0.5);
}

/**
 * Texture-space (0..1 across the road width) position of a lateral offset.
 * Used to paint the dashed lane dividers at the same places the grid sits.
 */
export function roadUForLateralOffset(lateralOffset, trackWidth) {
  return 0.5 + lateralOffset / trackWidth;
}

/** Half the usable width between the painted edge lines. */
export function drivableHalfWidth(trackWidth) {
  return roadDrivableWidth(trackWidth) / 2;
}

/** Minimum ribbon width that fits `laneCount` cars of `carHalfWidth` side by side. */
export function minimumTrackWidth({
  laneCount = RACE_CONFIG.world.laneCount,
  carHalfWidth = 0,
} = {}) {
  const safeLaneCount = Math.max(1, Math.floor(laneCount));
  const neededDrivable =
    safeLaneCount * (carHalfWidth * 2 + LANE_EDGE_MARGIN * 2);
  return neededDrivable / ROAD_DRIVABLE_WIDTH_RATIO;
}

/**
 * Describes how a grid of `laneCount` cars sits on a road of `trackWidth`,
 * using the same numbers the lane curves and the road markings use.
 *
 * Call this with the car's real measured half-width to check the outermost car
 * still fits inside the painted road; it warns and reports `fits: false`
 * instead of silently placing cars off the road.
 */
export function describeStartGrid({
  laneCount = RACE_CONFIG.world.laneCount,
  trackWidth = RACE_CONFIG.world.trackWidth,
  carHalfWidth = 0,
} = {}) {
  const safeLaneCount = Math.max(1, Math.floor(laneCount));
  const drivable = roadDrivableWidth(trackWidth);
  const laneWidth = drivable / safeLaneCount;
  const laneOffsets = Array.from({ length: safeLaneCount }, (_, index) =>
    computeLaneOffset(index, { laneCount, trackWidth }),
  );
  const outerCarEdge =
    Math.max(...laneOffsets.map((offset) => Math.abs(offset))) + carHalfWidth;
  const clearance = drivable / 2 - outerCarEdge;
  const fits = clearance >= 0;

  if (!fits) {
    console.warn(
      `[track] ${safeLaneCount} cars of width ${(carHalfWidth * 2).toFixed(2)} overhang the road: ` +
        `outer car edge ${outerCarEdge.toFixed(2)} vs drivable half-width ${(drivable / 2).toFixed(2)}. ` +
        `Raise world.trackWidth to at least ${minimumTrackWidth({ laneCount, carHalfWidth }).toFixed(2)}.`,
    );
  }

  return {
    trackWidth,
    laneCount: safeLaneCount,
    laneWidth,
    drivableWidth: drivable,
    drivableHalfWidth: drivable / 2,
    laneOffsets,
    carHalfWidth,
    outerCarEdge,
    // Negative means the outer car already sits inside the painted road.
    clearance,
    requiredTrackWidth: minimumTrackWidth({ laneCount, carHalfWidth }),
    fits,
  };
}

export function createRaceLaneCurve(
  roadCenter,
  length,
  laneIndex,
  laneCount = RACE_CONFIG.world.laneCount,
  { trackWidth = RACE_CONFIG.world.trackWidth } = {},
) {
  const laneOffset = computeLaneOffset(laneIndex, { laneCount, trackWidth });
  return createTrackCurve(laneOffset, length, roadCenter, 0);
}

export function createRandomRaceLaneOrder(
  laneCount = RACE_CONFIG.world.laneCount,
) {
  const safeLaneCount = Math.max(1, Math.floor(laneCount));
  const laneOrder = Array.from({ length: safeLaneCount }, (_, index) => index);
  for (let index = laneOrder.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [laneOrder[index], laneOrder[swapIndex]] = [
      laneOrder[swapIndex],
      laneOrder[index],
    ];
  }
  return laneOrder;
}

// ─── Terrain Elevation Profiles ──────────────────────────────────────────────
//
// The coastline meshes built in worldBuilder.js (infield disc + beach ring) are
// displaced vertically by these height offsets. The road itself always stays
// flat at surfaceY; heights are measured from the track centreline in the
// scaled (x / TRACK_RADIUS_X, z / TRACK_RADIUS_Z) space, where the centreline
// is the unit ellipse and positive lateral means inland, negative seaward.
// Because the bands are defined in that space the banks, ridges, and the beach
// slope all follow the curvature of the track at a constant distance on every
// bearing. Every profile holds at 0 across the shoulder/rail apron so the road
// seam, guard rails, and loop props never get buried by the raised land.

function smoothstep(edge0, edge1, value) {
  const t = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Signed lateral distance from the track centreline (+ inland, - seaward). */
export function trackLateralDistance(x, z) {
  const u = x / TRACK_RADIUS_X;
  const v = z / TRACK_RADIUS_Z;
  const radius = Math.hypot(u, v);
  const phi = Math.atan2(v, u);
  const centreDistance = Math.hypot(
    TRACK_RADIUS_X * Math.cos(phi),
    TRACK_RADIUS_Z * Math.sin(phi),
  );
  return (1 - radius) * centreDistance;
}

/** 0..1 swell of the track-following ridges as they travel around the lap. */
function ridgeWave(theta) {
  const wave =
    0.5 +
    0.3 * Math.sin(3 * theta + 0.9) +
    0.2 * Math.sin(7 * theta + 2.4) +
    0.12 * Math.sin(11 * theta - 1.2);
  return THREE.MathUtils.clamp(wave, 0, 1);
}

/** 0..1 rolling land undulation, wavelength ~50-70 world units. */
function rollingField(x, z) {
  const wave =
    0.5 +
    0.5 *
      (0.5 * Math.sin(x * 0.075 + z * 0.052 + 0.6) +
        0.3 * Math.sin(x * 0.034 - z * 0.092 + 2.2) +
        0.2 * Math.sin(x * 0.107 + z * 0.081 - 1.4));
  return THREE.MathUtils.clamp(wave, 0, 1);
}

// Inland bands, in lateral units inboard of the centreline. The inner guard
// rail stands at ~9.3 and the nearest trees just past ~15, so the ground holds
// flat across the shoulder/rail apron, rises into a raised roadside bank
// right behind the rail, swells into a broad ridge that follows the track
// curvature, then eases into rolling fields that reach the middle of the
// infield. Elevation changes gradually at every step so the land reads as
// smooth coastal hills rather than walls.
const INLAND_BANK_START = 10;
const INLAND_BANK_UP = 17.5;
const INLAND_BANK_TOP = 22;
const INLAND_BANK_END = 31;
const INLAND_BANK_AMP = 4.2;
const INLAND_RIDGE_START = 24;
const INLAND_RIDGE_UP = 44;
const INLAND_RIDGE_TOP = 57;
const INLAND_RIDGE_END = 82;
const INLAND_RIDGE_AMP = 8.6;
const INLAND_ROLL_START = 18;
const INLAND_ROLL_FULL = 27;
const INLAND_ROLL_AMP = 2.3;
const INLAND_SWELL_START = 60;
const INLAND_SWELL_FULL = 82;
const INLAND_SWELL_AMP = 2.6;

/**
 * Height offset for the infield land disc: a raised bank beside the road, a
 * broad track-following ridge swelling around the lap, plus rolling hills and
 * a gentle interior swell so the whole green interior is uneven instead of a
 * flat plane. Falls to exactly 0 at the road edge so the shoulder seams flat.
 */
export function infieldHeightOffset(x, z) {
  const lateral = trackLateralDistance(x, z);
  const theta = Math.atan2(z, x);
  const bankSwell = 0.55 + 0.45 * ridgeWave(theta);
  const ridgeSwell = 0.45 + 0.55 * ridgeWave(theta + 1.7);

  const bank =
    INLAND_BANK_AMP *
    bankSwell *
    smoothstep(INLAND_BANK_START, INLAND_BANK_UP, lateral) *
    (1 - smoothstep(INLAND_BANK_TOP, INLAND_BANK_END, lateral));

  const ridge =
    INLAND_RIDGE_AMP *
    ridgeSwell *
    smoothstep(INLAND_RIDGE_START, INLAND_RIDGE_UP, lateral) *
    (1 - smoothstep(INLAND_RIDGE_TOP, INLAND_RIDGE_END, lateral));

  const rolling =
    INLAND_ROLL_AMP *
    rollingField(x, z) *
    smoothstep(INLAND_ROLL_START, INLAND_ROLL_FULL, lateral);

  const interiorSwell =
    INLAND_SWELL_AMP *
    (0.3 + 0.7 * rollingField(x * 0.5 + 6.4, z * 0.5 - 2.7)) *
    smoothstep(INLAND_SWELL_START, INLAND_SWELL_FULL, lateral);

  return bank + ridge + rolling + interiorSwell;
}

// Beach-side bands, in lateral units seaward of the centreline. The outer
// guard rail sits at ~9.3 and the fence line at ~12-14, so the sand stays
// level across them, rises into a low coastal bank behind the shore road,
// then descends as one long sandy slope that meets the waterline just past
// the beach ring's outer edge. A soft undulation keeps the sand from reading
// as a single flat plane.
const BEACH_DUNE_START = 14.5;
const BEACH_DUNE_UP = 20;
const BEACH_DUNE_TOP = 25;
const BEACH_DUNE_END = 33;
const BEACH_DUNE_AMP = 3.6;
const BEACH_SLOPE_START = 27;
const BEACH_SLOPE_END = 48.5;
const BEACH_SLOPE_BOTTOM = -0.78; // water sits ~0.82 below the sand ring base
const BEACH_SAND_START = 16;
const BEACH_SAND_FULL = 24;
const BEACH_SAND_AMP = 0.22;

function beachUndulation(x, z) {
  const wave =
    0.6 * Math.sin(x * 0.052 + z * 0.041 + 1.1) +
    0.34 * Math.sin(x * 0.029 - z * 0.071 + 0.3) +
    0.22 * Math.sin((x + z) * 0.082 + 2.2);
  return THREE.MathUtils.clamp(wave, -1, 1);
}

/**
 * Height offset for the beach ring: a bank at the road, then a gentle slope
 * down to the sand. The outer edge dips to just above the waterline so land
 * meets ocean without a flat plateau or a cliff.
 */
export function beachHeightOffset(x, z) {
  const seaward = -trackLateralDistance(x, z);
  const theta = Math.atan2(z, x);
  const duneSwell = 0.5 + 0.5 * ridgeWave(theta + 1.15);

  const dune =
    BEACH_DUNE_AMP *
    duneSwell *
    smoothstep(BEACH_DUNE_START, BEACH_DUNE_UP, seaward) *
    (1 - smoothstep(BEACH_DUNE_TOP, BEACH_DUNE_END, seaward));

  const slope =
    BEACH_SLOPE_BOTTOM *
    smoothstep(BEACH_SLOPE_START, BEACH_SLOPE_END, seaward);

  const sandUndulation =
    BEACH_SAND_AMP *
    beachUndulation(x, z) *
    smoothstep(BEACH_SAND_START, BEACH_SAND_FULL, seaward) *
    (1 - smoothstep(44, 48.2, seaward));

  return dune + slope + sandUndulation;
}

/**
 * World-space point at a real distance along the curve, with optional
 * sideways offset (positive = inland, negative = toward the beach).
 */
export function trackPointAt(curve, distance, lateralOffset = 0) {
  const totalLength = curve.getLength();
  const clamped = THREE.MathUtils.clamp(distance, 0, totalLength);
  const t = totalLength > 0 ? clamped / totalLength : 0;

  const point = curve.getPointAt(t);
  if (lateralOffset === 0) return point.clone();

  const tangent = curve.getTangentAt(t);
  const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
  return point.clone().addScaledVector(side, lateralOffset);
}

/**
 * Calculate current lap, lap progress fraction, and whether it is the final lap.
 * @param {number} totalProgress Normalized race progress (0 to 1)
 * @param {number} totalLaps Total laps in race (default 3)
 */
export function calculateLap(totalProgress, totalLaps = 3) {
  const clamped = THREE.MathUtils.clamp(totalProgress, 0, 1);
  if (clamped >= 1) {
    return {
      lap: totalLaps,
      totalLaps,
      lapProgress: 1,
      isFinalLap: true,
      finished: true,
    };
  }
  const currentLap = Math.min(Math.floor(clamped * totalLaps) + 1, totalLaps);
  const lapProgress = (clamped * totalLaps) % 1;
  return {
    lap: currentLap,
    totalLaps,
    lapProgress,
    isFinalLap: currentLap === totalLaps,
    finished: false,
  };
}

// ─── Shared Helpers ──────────────────────────────────────────────────────────

export function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Circular point around the center (still used for small infield items). */
export function polarPoint(layout, radius, angle, y) {
  return new THREE.Vector3(
    layout.centerX + Math.cos(angle) * radius,
    y,
    layout.centerZ - Math.sin(angle) * radius,
  );
}

export function randomInAnnulus(rand, innerRadius, outerRadius) {
  const angle = rand() * Math.PI * 2;
  const minSq = innerRadius * innerRadius;
  const maxSq = outerRadius * outerRadius;
  const radius = Math.sqrt(rand() * (maxSq - minSq) + minSq);
  return { angle, radius };
}

/**
 * Point on an ellipse that is `grow` units larger (positive, toward the beach)
 * or smaller (negative, inland) than the track centerline.
 */
export function ellipsePoint(layout, grow, angle, y) {
  return new THREE.Vector3(
    layout.centerX + (layout.radiusX + grow) * Math.cos(angle),
    y,
    layout.centerZ + (layout.radiusZ + grow) * Math.sin(angle),
  );
}

/** Uniform random point inside an ellipse (minFrac hollows out the middle). */
export function randomInEllipse(rand, radiusX, radiusZ, minFrac = 0) {
  const angle = rand() * Math.PI * 2;
  const s = Math.sqrt(rand() * (1 - minFrac * minFrac) + minFrac * minFrac);
  return {
    x: Math.cos(angle) * radiusX * s,
    z: Math.sin(angle) * radiusZ * s,
  };
}

export function mesh(geometry, material, { cast = true, receive = true } = {}) {
  const item = new THREE.Mesh(geometry, material);
  item.castShadow = cast;
  item.receiveShadow = receive;
  return item;
}

function loopPoint(curve, progress, offset, surfaceY) {
  const wrapped = THREE.MathUtils.euclideanModulo(progress, 1);
  const point = curve.getPointAt(wrapped);
  const tangent = curve.getTangentAt(wrapped);
  const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
  return point.addScaledVector(side, offset).setY(surfaceY);
}

// ─── Procedural Canvas Textures ──────────────────────────────────────────────

export function createGroundTexture(base, speckleA, speckleB) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1800; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? speckleA : speckleB;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(18, 18);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// One texture tile = one dash period (10.4 world units, dash 3.9 long).
const DASH_PERIOD = 10.4;
const DASH_FRACTION = 3.9 / 10.4;

function createRoadTexture(repeatV) {
  const size = ROAD_TEXTURE_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  // Slate asphalt with fine grain.
  ctx.fillStyle = "#556772";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
  for (let i = 0; i < 3500; i++) {
    ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
  ctx.fillStyle = "rgba(0, 0, 0, 0.07)";
  for (let i = 0; i < 2000; i++) {
    ctx.fillRect(Math.random() * size, Math.random() * size, 3, 3);
  }

  // Solid warm cream edge lines. Positioned from the same constants the grid
  // layout uses, so the painted road edge and the lane spacing stay in sync.
  ctx.fillStyle = "#f9f3d9";
  ctx.fillRect(ROAD_EDGE_LINE_INSET, 0, ROAD_EDGE_LINE_WIDTH, size);
  ctx.fillRect(
    size - ROAD_EDGE_LINE_INSET - ROAD_EDGE_LINE_WIDTH,
    0,
    ROAD_EDGE_LINE_WIDTH,
    size,
  );

  // Dashed lane dividers, painted midway between adjacent grid lanes so the
  // markings line up with where the cars actually sit.
  ctx.fillStyle = "rgba(249, 243, 217, 0.95)";
  const dashHeight = size * DASH_FRACTION;
  for (
    let laneIndex = 1;
    laneIndex < RACE_CONFIG.world.laneCount;
    laneIndex++
  ) {
    const boundary =
      (computeLaneOffset(laneIndex - 1) + computeLaneOffset(laneIndex)) / 2;
    const x = Math.round(
      roadUForLateralOffset(boundary, RACE_CONFIG.world.trackWidth) * size,
    );
    ctx.fillRect(x - 3, 0, 6, dashHeight);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, repeatV);
  texture.anisotropy = 8;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createCheckerTexture(cols = 16, rows = 2) {
  const cell = 32;
  const canvas = document.createElement("canvas");
  canvas.width = cols * cell;
  canvas.height = rows * cell;
  const ctx = canvas.getContext("2d");
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      ctx.fillStyle = (col + row) % 2 ? "#556772" : "#f9f3d9";
      ctx.fillRect(col * cell, row * cell, cell, cell);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 8;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// ─── Track Ribbons ───────────────────────────────────────────────────────────

export function createTrackRibbon(
  curve,
  width,
  surfaceY,
  material,
  name,
  options = {},
) {
  const segmentCount = options.segmentCount || 256;
  const halfWidth = width / 2;
  const lateralOffset = options.lateralOffset || 0;
  const positions = [];
  const uvs = [];
  const indices = [];
  const point = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();

  for (let index = 0; index <= segmentCount; index++) {
    const progress = index / segmentCount;
    curve.getPointAt(progress, point);
    curve.getTangentAt(progress, tangent);
    side.set(-tangent.z, 0, tangent.x).normalize();

    const center = point.clone().addScaledVector(side, lateralOffset);
    positions.push(
      center.x + side.x * halfWidth,
      surfaceY,
      center.z + side.z * halfWidth,
      center.x - side.x * halfWidth,
      surfaceY,
      center.z - side.z * halfWidth,
    );
    uvs.push(1, progress, 0, progress);
  }

  for (let index = 0; index < segmentCount; index++) {
    const left = index * 2;
    const nextLeft = (index + 1) * 2;
    indices.push(left, nextLeft, left + 1, left + 1, nextLeft, nextLeft + 1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const ribbon = new THREE.Mesh(geometry, material);
  ribbon.name = name;
  ribbon.receiveShadow = true;
  return ribbon;
}

// ─── Start Line, Gantry ───────────────────────────────────────────────────────

function createStartLine(curve, tileWidth, surfaceY) {
  const group = new THREE.Group();
  group.name = "start-finish";

  const start = trackPointAt(curve, 0);
  const tangent = curve.getTangentAt(0);
  const heading = Math.atan2(tangent.x, tangent.z);

  // Checkered strip across the road.
  const strip = new THREE.Mesh(
    new THREE.PlaneGeometry(tileWidth, 2.4),
    new THREE.MeshStandardMaterial({
      map: createCheckerTexture(16, 2),
      roughness: 0.85,
    }),
  );
  strip.rotation.order = "YXZ";
  strip.rotation.set(-Math.PI / 2, heading, 0);
  strip.position.set(start.x, surfaceY + 0.045, start.z);
  strip.receiveShadow = true;
  group.add(strip);

  // Gantry: two posts and a top beam.
  const gantry = new THREE.Group();
  gantry.position.set(start.x, surfaceY, start.z);
  gantry.rotation.y = heading;

  const cream = new THREE.MeshStandardMaterial({
    color: RACE_CONFIG.palette.fenceCream,
    roughness: 0.8,
  });
  const accent = new THREE.MeshStandardMaterial({
    color: RACE_CONFIG.palette.darkTrim,
    roughness: 0.7,
  });
  const postX = tileWidth / 2 + 1.4;
  const postHeight = 10;

  for (const side of [-1, 1]) {
    const post = mesh(new THREE.BoxGeometry(0.38, postHeight, 0.42), cream);
    post.position.set(side * postX, postHeight / 2, 0);
    gantry.add(post);

    const base = mesh(new THREE.BoxGeometry(0.44, 2, 0.48), accent);
    base.position.set(side * postX, 1, 0);
    gantry.add(base);
  }
  const beam = mesh(new THREE.BoxGeometry(postX * 2 + 0.4, 0.5, 0.5), cream);
  beam.position.set(0, postHeight, 0);
  gantry.add(beam);

  group.add(gantry);
  return group;
}

// ─── Track Prop Models ───────────────────────────────────────────────────────

const PROP_URLS = {
  bush: "/assets/models/bush.glb",
  fence: "/assets/models/fence.glb",
  grass: "/assets/models/grass.glb",
  palm01: "/assets/models/palm_01.glb",
  palm02: "/assets/models/palm_02.glb",
  palm03: "/assets/models/palm_03.glb",
  plant: "/assets/models/plant.glb",
  rock1: "/assets/models/rock_1.glb",
  rock2: "/assets/models/rock_2.glb",
  stoneGrp: "/assets/models/stone_grp.glb",
  treeGrp: "/assets/models/tree_grp.glb",
  fisherBoat: "/assets/models/boat_fisher.glb",
  scoutBoat: "/assets/models/boat_scout.glb",
  speedBoat: "/assets/models/boat_speed.glb",
  woodBoatV1: "/assets/models/boat_wood_v1.glb",
  woodBoatV2: "/assets/models/boat_wood_v2.glb",
  floatplane: "/assets/models/floatplane.glb",
};

const PROP_TINTS = Object.freeze({
  bush: 0xe3e1d2,
  fence: 0xe8d5b8,
  grass: 0xe0dfd1,
  palm01: 0xe3ddcb,
  palm02: 0xe3ddcb,
  palm03: 0xe3ddcb,
  plant: 0xe3e1d2,
  rock1: 0xe4d5ad,
  rock2: 0xe4d5ad,
  stoneGrp: 0xe4d5ad,
  treeGrp: 0xe0ddcc,
});

// The source models carry far more saturation than the slate road, warm sand
// and hazy sky they sit against, so foliage and stone are pulled toward a warm
// neutral after tinting. Higher values mute more; anything omitted (the fence,
// the boats) keeps its original color.
const PROP_MUTING = Object.freeze({
  bush: 0.45,
  grass: 0.45,
  palm01: 0.42,
  palm02: 0.42,
  palm03: 0.42,
  plant: 0.45,
  rock1: 0.38,
  rock2: 0.38,
  stoneGrp: 0.38,
  treeGrp: 0.5,
});

// Foliage and stone still read as dark masses next to the pale sand and hazy
// sky, so those props get lifted toward white after tinting. Anything omitted
// (the fence, the palms, the boats) keeps its current value.
const PROP_LIGHTENING = Object.freeze({
  bush: 0.5,
  grass: 0.52,
  rock1: 0.44,
  rock2: 0.44,
  stoneGrp: 0.44,
  treeGrp: 0.46,
});

const WHITE = new THREE.Color(0xffffff);

function tintPropModel(model, tint, muting = 0, lightening = 0) {
  if (!tint) return;
  const tintColor = new THREE.Color(tint);
  const mutedColor = new THREE.Color();
  const materials = new Set();
  model.traverse((node) => {
    if (!node.isMesh || !node.material) return;
    const materialList = Array.isArray(node.material)
      ? node.material
      : [node.material];
    materialList.forEach((material) => {
      if (material?.isMaterial) materials.add(material);
    });
  });
  materials.forEach((material) => {
    material.color.multiply(tintColor);
    if (muting > 0) {
      const luma =
        material.color.r * 0.2126 +
        material.color.g * 0.7152 +
        material.color.b * 0.0722;
      // Noticeably warm, slightly lifted neutral rather than flat gray: it
      // brightens dark shadowed foliage, strips the lime out of the grass, and
      // kills the blue-gray the sky light leaves on upward-facing stone.
      mutedColor.setRGB(luma * 1.06, luma, luma * 0.9);
      material.color.lerp(mutedColor, muting);
    }
    if (lightening > 0) {
      // Lerping toward white raises the whole value range while keeping the
      // muted warm hue, so shadows fill in instead of crushing to black.
      material.color.lerp(WHITE, lightening);
    }
  });
}

function createFallbackProp(kind) {
  const group = new THREE.Group();
  group.name = `fallback-${kind}`;
  // Fallbacks stand in for a failed GLB load, so they need the same lift the
  // tinted models get or a prop would visibly darken the moment it swapped in.
  const lit = (material) => {
    if (PROP_LIGHTENING[kind] > 0)
      material.color.lerp(WHITE, PROP_LIGHTENING[kind]);
    return material;
  };

  const bark = new THREE.MeshStandardMaterial({
    color: kind.startsWith("palm")
      ? RACE_CONFIG.palette.palmTrunk
      : RACE_CONFIG.palette.treeTrunk,
    roughness: 0.9,
  });
  const leaf = new THREE.MeshStandardMaterial({
    color: RACE_CONFIG.palette.treeLeafLight,
    roughness: 0.85,
  });
  const palmLeaf = new THREE.MeshStandardMaterial({
    color: RACE_CONFIG.palette.palmLeaf,
    roughness: 0.8,
  });
  const palmLeafLight = new THREE.MeshStandardMaterial({
    color: RACE_CONFIG.palette.palmLeafLight,
    roughness: 0.8,
  });
  const sandRock = new THREE.MeshStandardMaterial({
    color: RACE_CONFIG.palette.rock,
    roughness: 0.95,
  });
  const wood = new THREE.MeshStandardMaterial({
    color: 0x8b5a2b,
    roughness: 0.8,
  });
  const hull = new THREE.MeshStandardMaterial({
    color: 0xc9a36a,
    roughness: 0.7,
  });

  if (kind === "treeGrp") {
    group.add(mesh(new THREE.CylinderGeometry(0.35, 0.5, 3.2, 8), lit(bark)));
    group.children[0].position.y = 1.6;
    const canopy = mesh(new THREE.SphereGeometry(2.1, 10, 8), lit(leaf));
    canopy.position.y = 4.1;
    canopy.scale.y = 0.85;
    group.add(canopy);
  } else if (kind.startsWith("palm")) {
    const trunk = mesh(new THREE.CylinderGeometry(0.18, 0.28, 6.2, 8), bark);
    trunk.position.y = 3.1;
    group.add(trunk);
    for (let i = 0; i < 6; i++) {
      const frond = mesh(
        new THREE.ConeGeometry(0.15, 3.4, 6),
        i % 2 ? palmLeafLight : palmLeaf,
      );
      frond.position.y = 6.1;
      frond.rotation.z = 1.05;
      frond.rotation.y = (i / 6) * Math.PI * 2;
      group.add(frond);
    }
  } else if (kind === "bush" || kind === "plant" || kind === "grass") {
    const color =
      kind === "grass"
        ? RACE_CONFIG.palette.treeLeafLight
        : RACE_CONFIG.palette.treeLeafDark;
    const shrub = mesh(
      new THREE.SphereGeometry(kind === "grass" ? 0.55 : 0.9, 8, 6),
      lit(new THREE.MeshStandardMaterial({ color, roughness: 0.9 })),
    );
    shrub.position.y = kind === "grass" ? 0.35 : 0.7;
    shrub.scale.y = 0.7;
    group.add(shrub);
  } else if (kind === "rock1" || kind === "rock2" || kind === "stoneGrp") {
    const rock = mesh(
      new THREE.DodecahedronGeometry(kind === "stoneGrp" ? 1.4 : 0.9, 0),
      lit(sandRock),
    );
    rock.position.y = 0.4;
    rock.scale.set(1.2, 0.7, 1);
    group.add(rock);
  } else if (kind === "fence") {
    const post = mesh(
      new THREE.BoxGeometry(0.18, 1.4, 0.18),
      new THREE.MeshStandardMaterial({
        color: RACE_CONFIG.palette.fenceCream,
        roughness: 0.8,
      }),
    );
    post.position.y = 0.7;
    const rail = mesh(
      new THREE.BoxGeometry(2.2, 0.12, 0.12),
      new THREE.MeshStandardMaterial({
        color: RACE_CONFIG.palette.metalRail,
        roughness: 0.5,
        metalness: 0.4,
      }),
    );
    rail.position.y = 0.85;
    group.add(post, rail);
  } else if (
    kind.includes("Boat") ||
    kind === "fisherBoat" ||
    kind === "scoutBoat" ||
    kind === "speedBoat" ||
    kind === "woodBoatV1" ||
    kind === "woodBoatV2"
  ) {
    const body = mesh(new THREE.BoxGeometry(3.4, 0.7, 1.2), hull);
    body.position.y = 0.2;
    const cabin = mesh(new THREE.BoxGeometry(1.1, 0.7, 0.9), wood);
    cabin.position.set(-0.4, 0.7, 0);
    group.add(body, cabin);
  } else if (kind === "floatplane") {
    const body = mesh(
      new THREE.BoxGeometry(4.2, 0.7, 1.1),
      new THREE.MeshStandardMaterial({ color: 0xdce7f2 }),
    );
    body.position.y = 0.5;
    const wing = mesh(
      new THREE.BoxGeometry(5.4, 0.12, 1.4),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc }),
    );
    wing.position.y = 0.7;
    group.add(body, wing);
  }

  return group;
}

function addPropAt(worldGroup, model, position, scale, rotationY) {
  const prop = model.clone();
  prop.scale.setScalar(scale);
  prop.position.copy(position);
  prop.rotation.y = rotationY;
  worldGroup.add(prop);
  return prop;
}

const propContactCache = new WeakMap();

/**
 * Horizontal half-extents of a model's ground-contact patch: the span of the
 * geometry sitting within a hand's width of the model's own base.
 *
 * This is deliberately not the model's bounding box. A tree's box is dominated
 * by a canopy held metres above the ground, so re-seating a tree on the lowest
 * ground beneath its box would bury its trunk on every slope. The lowest band
 * of geometry gives the part that actually has to be supported: a tree yields
 * just its trunk, while a boulder or a stone cluster — wide and low — yields
 * its whole footprint, which is exactly what was left hanging in the air.
 */
function propContactPatch(model, scale) {
  let raw = propContactCache.get(model);
  if (!raw) {
    const box = new THREE.Box3().setFromObject(model);
    const band = Math.min(0.4, (box.max.y - box.min.y) * 0.2);
    const cutoff = box.min.y + band;
    // A contact patch can never be wider than the asset it belongs to, which also
    // catches a stray wide mesh sitting at the model's base.
    const modelHalfX = Math.max(Math.abs(box.min.x), Math.abs(box.max.x));
    const modelHalfZ = Math.max(Math.abs(box.min.z), Math.abs(box.max.z));
    let halfX = 0;
    let halfZ = 0;
    const vertex = new THREE.Vector3();
    const toModel = new THREE.Matrix4();
    const meshToModel = new THREE.Matrix4();
    model.updateMatrixWorld(true);
    toModel.copy(model.matrixWorld).invert();
    model.traverse((mesh) => {
      if (!mesh.isMesh) return;
      const position = mesh.geometry.getAttribute("position");
      if (!position) return;
      // Vertices live in each mesh's own space, so bring them into the model's
      // space before measuring; a GLB's sub-meshes carry their own transforms.
      meshToModel.multiplyMatrices(toModel, mesh.matrixWorld);
      for (let i = 0; i < position.count; i++) {
        vertex.fromBufferAttribute(position, i).applyMatrix4(meshToModel);
        if (vertex.y > cutoff) continue;
        halfX = Math.max(halfX, Math.abs(vertex.x));
        halfZ = Math.max(halfZ, Math.abs(vertex.z));
      }
    });
    // Measured in model units, so one traversal serves every scale of the asset.
    raw = {
      halfX: Math.min(halfX, modelHalfX),
      halfZ: Math.min(halfZ, modelHalfZ),
    };
    propContactCache.set(model, raw);
  }
  return { halfX: raw.halfX * scale, halfZ: raw.halfZ * scale };
}

// Props drop onto the sculpted terrain, not the old flat surface: their (x, z)
// placement stays exactly as before, only the ground height they stand on
// follows the elevation profiles above so nothing floats or sinks into the
// newly raised banks and slopes.
function addInfieldProp(
  worldGroup,
  model,
  layout,
  rand,
  minClear,
  minFrac,
  scale,
  groundToInfield = false,
) {
  const rx = Math.max(layout.innerRadiusX - minClear, 8);
  const rz = Math.max(layout.innerRadiusZ - minClear, 8);
  const { x, z } = randomInEllipse(rand, rx, rz, minFrac);
  const worldX = layout.centerX + x;
  const worldZ = layout.centerZ + z;
  const prop = addPropAt(
    worldGroup,
    model,
    new THREE.Vector3(
      worldX,
      layout.surfaceY - 0.02 + infieldHeightOffset(worldX, worldZ),
      worldZ,
    ),
    scale,
    rand() * Math.PI * 2,
  );
  if (groundToInfield) {
    // Trees and rock clusters are wide or low enough that planting them at the
    // ground directly beneath their origin left them hovering over the infield
    // bank. Hand the world builder the contact patch so it can re-seat them on
    // the lowest ground their base actually covers.
    prop.userData.groundToInfield = true;
    prop.userData.contactPatch = propContactPatch(model, scale);
  }
}

function addBeachProp(
  worldGroup,
  model,
  layout,
  rand,
  growMin,
  growMax,
  y,
  scale,
) {
  const grow = growMin + rand() * (growMax - growMin);
  const position = ellipsePoint(layout, grow, rand() * Math.PI * 2, y);
  position.y =
    layout.surfaceY - 0.08 + beachHeightOffset(position.x, position.z);
  addPropAt(worldGroup, model, position, scale, rand() * Math.PI * 2);
}

function addLoopProp(
  worldGroup,
  model,
  curve,
  progress,
  offset,
  surfaceY,
  scale,
  rotation,
  heightAt = null,
) {
  const prop = model.clone();
  prop.scale.setScalar(scale);
  const point = loopPoint(curve, progress, offset, surfaceY);
  // Loop props (the shoreline fences) sit on the seaward terrain slope.
  if (heightAt) {
    point.y = surfaceY - 0.08 + heightAt(point.x, point.z);
  }
  prop.position.copy(point);
  prop.rotation.y = rotation;
  worldGroup.add(prop);
}

// ─── Track Prop Placement ────────────────────────────────────────────────────

function placeVegetation(worldGroup, layout, models) {
  const rand = seededRandom(42);
  const infieldClear = 4;
  const beachGrowMin = layout.edgeMargin + 2;
  const beachGrowMax = layout.edgeMargin + layout.beachWidth - 3;

  if (models.treeGrp) {
    for (let i = 0; i < RACE_CONFIG.world.treeCount; i++) {
      addInfieldProp(
        worldGroup,
        models.treeGrp,
        layout,
        rand,
        infieldClear,
        0.1,
        0.42 + rand() * 0.32,
        true,
      );
    }
  }

  if (models.bush) {
    for (let i = 0; i < 36; i++) {
      addInfieldProp(
        worldGroup,
        models.bush,
        layout,
        rand,
        infieldClear,
        0.05,
        0.32 + rand() * 0.3,
      );
    }
  }

  if (models.plant) {
    for (let i = 0; i < 22; i++) {
      addInfieldProp(
        worldGroup,
        models.plant,
        layout,
        rand,
        infieldClear,
        0.08,
        0.28 + rand() * 0.28,
      );
    }
  }

  if (models.grass) {
    for (let i = 0; i < 34; i++) {
      addInfieldProp(
        worldGroup,
        models.grass,
        layout,
        rand,
        infieldClear,
        0.05,
        0.25 + rand() * 0.28,
      );
    }
  }

  const palms = [models.palm01, models.palm02, models.palm03].filter(Boolean);
  if (palms.length) {
    const palmCount = RACE_CONFIG.world.palmCount;
    for (let i = 0; i < palmCount; i++) {
      const angle =
        (i / palmCount) * Math.PI * 2 +
        (i % 2 ? 1 : -1) * (Math.PI / (palmCount * 2));
      const grow = beachGrowMin + rand() * (beachGrowMax - beachGrowMin);
      const position = ellipsePoint(layout, grow, angle, layout.surfaceY);
      position.y =
        layout.surfaceY - 0.08 + beachHeightOffset(position.x, position.z);
      addPropAt(
        worldGroup,
        palms[i % palms.length],
        position,
        0.38 + rand() * 0.25,
        rand() * Math.PI * 2,
      );
    }
  }
}

function placeFences(worldGroup, totalLength, layout, models) {
  if (!models.fence) return;
  const rand = seededRandom(123);
  const count = Math.floor(totalLength / 10);

  for (let i = 0; i < count; i++) {
    if (rand() > 0.72) continue;
    addLoopProp(
      worldGroup,
      models.fence,
      layout.trackCurve,
      i / count,
      -(layout.trackWidth / 2 + 4.2 + rand() * 1.8),
      layout.surfaceY,
      0.38 + rand() * 0.12,
      rand() * Math.PI * 2,
      beachHeightOffset,
    );
  }
}

function placeRocks(worldGroup, layout, models) {
  const rand = seededRandom(77);
  const rockModels = [models.rock1, models.rock2, models.stoneGrp].filter(
    Boolean,
  );
  if (!rockModels.length) return;

  for (let i = 0; i < 16; i++) {
    addInfieldProp(
      worldGroup,
      rockModels[Math.floor(rand() * rockModels.length)],
      layout,
      rand,
      6,
      0.1,
      0.12 + rand() * 0.18,
      true,
    );
  }

  for (let i = 0; i < 18; i++) {
    addBeachProp(
      worldGroup,
      rockModels[Math.floor(rand() * rockModels.length)],
      layout,
      rand,
      layout.edgeMargin + 3,
      layout.edgeMargin + layout.beachWidth - 2,
      layout.surfaceY,
      0.14 + rand() * 0.2,
    );
  }
}

function placeWatercraft(worldGroup, layout, models) {
  const rand = seededRandom(99);
  const boats = [
    models.fisherBoat,
    models.scoutBoat,
    models.speedBoat,
    models.woodBoatV1,
    models.woodBoatV2,
  ].filter(Boolean);

  const waterGrowMin = layout.edgeMargin + layout.beachWidth + 8;
  const waterGrowMax = layout.edgeMargin + layout.beachWidth + 42;

  boats.forEach((boat, idx) => {
    const clone = boat.clone();
    const s = 0.32 + rand() * 0.18;
    clone.scale.set(s, s, s);
    const grow = waterGrowMin + rand() * (waterGrowMax - waterGrowMin);
    const angle = rand() * Math.PI * 2 + idx * 0.35;
    clone.position.copy(
      ellipsePoint(layout, grow, angle, layout.waterY + 0.05),
    );
    clone.rotation.y = rand() * Math.PI * 2;
    worldGroup.add(clone);
  });

  if (models.floatplane) {
    const plane = models.floatplane.clone();
    plane.scale.set(0.32, 0.32, 0.32);
    plane.position.copy(
      ellipsePoint(
        layout,
        waterGrowMin + 20,
        Math.PI * 0.66,
        layout.waterY + 0.45,
      ),
    );
    plane.rotation.y = Math.PI * 0.18;
    worldGroup.add(plane);
  }
}

function createVillage(worldGroup, layout) {
  const barnMaterial = new THREE.MeshStandardMaterial({
    color: RACE_CONFIG.palette.barnRed,
    roughness: 0.9,
  });
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: RACE_CONFIG.palette.creamWall,
    roughness: 0.9,
  });
  const roofMaterial = new THREE.MeshStandardMaterial({
    color: RACE_CONFIG.palette.roof,
    roughness: 0.95,
  });
  const village = new THREE.Group();
  village.name = "infield-village";

  const housePositions = [
    [8, 0.2],
    [11, 2.1],
    [6, 3.6],
  ];
  housePositions.forEach(([radius, angle], index) => {
    const house = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(6.5, 4.2, 5.5),
      index % 2 ? wallMaterial : barnMaterial,
    );
    body.position.y = 2.1;
    body.castShadow = true;
    body.receiveShadow = true;
    house.add(body);

    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(4.8, 2.8, 4),
      roofMaterial,
    );
    roof.position.y = 5.6;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    roof.receiveShadow = true;
    house.add(roof);
    const housePos = polarPoint(layout, radius, angle, layout.surfaceY);
    housePos.y =
      layout.surfaceY - 0.02 + infieldHeightOffset(housePos.x, housePos.z);
    house.position.copy(housePos);
    house.rotation.y = index % 2 ? 0.15 : -0.12;
    village.add(house);
  });

  worldGroup.add(village);
}

/**
 * Assemble the full elliptical coastal track model and its props into a single
 * THREE.Group ready to be added to the scene. Includes the asphalt ribbon,
 * edge banks, guard rails, start line, infield village, and all placed prop
 * models. Terrain (ocean/beach/infield/clouds) is handled by worldBuilder.
 */
export async function assembleTrackModel({ tileUrl, tileCount = 10 } = {}) {
  let tileWidth = RACE_CONFIG.world.trackWidth;
  let surfaceY = 0.59;

  const modelUrl = tileUrl || "/assets/models/road_track.glb";
  try {
    const tile = await loadModel(modelUrl);
    const bounds = new THREE.Box3().setFromObject(tile);
    if (bounds.max.y > 0) surfaceY = bounds.max.y;
  } catch (err) {
    console.warn(
      "Road tile GLB unavailable; using procedural placeholder track.",
      err,
    );
  }

  const group = new THREE.Group();
  group.name = "track-model";

  const centerX = 0;
  const centerZ = 0;
  const trackCurve = createTrackCurve(0, 0, centerX, centerZ);
  const totalLength = trackCurve.getLength();

  const bankWidth = 2.2;
  const edgeMargin = tileWidth / 2 + bankWidth + 0.8;
  const beachWidth = 38;

  const layout = {
    centerX,
    centerZ,
    roadCenter: centerX,
    roadLeft: -tileWidth / 2,
    roadRight: tileWidth / 2,
    surfaceY,
    waterY: surfaceY - 0.9,
    // Ellipse radii (use these instead of a single circle radius).
    radiusX: TRACK_RADIUS_X,
    radiusZ: TRACK_RADIUS_Z,
    trackRadius: TRACK_RADIUS_X,
    trackStraightLength: 0,
    straightLength: 0,
    trackWidth: tileWidth,
    laneCount: RACE_CONFIG.world.laneCount,
    laneWidth: tileWidth / RACE_CONFIG.world.laneCount,
    trackCurve,
    edgeMargin,
    beachWidth,
    innerRadiusX: TRACK_RADIUS_X - edgeMargin,
    innerRadiusZ: TRACK_RADIUS_Z - edgeMargin,
    innerLandRadius: Math.max(TRACK_RADIUS_Z - tileWidth / 2, 8),
    innerLandRadiusX: Math.max(TRACK_RADIUS_X - tileWidth / 2, 8),
    innerLandRadiusZ: Math.max(TRACK_RADIUS_Z - tileWidth / 2, 8),
    beachInnerRadius: TRACK_RADIUS_X + tileWidth / 2,
    beachInnerRadiusX: TRACK_RADIUS_X + tileWidth / 2,
    beachInnerRadiusZ: TRACK_RADIUS_Z + tileWidth / 2,
    beachOuterRadius: TRACK_RADIUS_X + edgeMargin + beachWidth,
    beachOuterRadiusX: TRACK_RADIUS_X + edgeMargin + beachWidth,
    beachOuterRadiusZ: TRACK_RADIUS_Z + edgeMargin + beachWidth,
    oceanRadius: TRACK_RADIUS_X + edgeMargin + beachWidth + 220,
    oceanRadiusX: TRACK_RADIUS_X + edgeMargin + beachWidth + 220,
    oceanRadiusZ: TRACK_RADIUS_Z + edgeMargin + beachWidth + 220,
  };

  const asphaltRepeat = Math.max(1, Math.round(totalLength / DASH_PERIOD));
  const bankMaterial = new THREE.MeshStandardMaterial({
    color: RACE_CONFIG.palette.sand,
    roughness: 0.94,
  });
  const asphaltMaterial = new THREE.MeshStandardMaterial({
    map: createRoadTexture(asphaltRepeat),
    roughness: 0.85,
    metalness: 0.05,
  });

  // Narrow shoulder banks on both sides of the road (no curbs).
  const bankOffset = tileWidth / 2 + bankWidth / 2;
  group.add(
    createTrackRibbon(
      trackCurve,
      bankWidth,
      surfaceY + 0.012,
      bankMaterial,
      "track-bank-outer",
      {
        lateralOffset: -bankOffset,
        segmentCount: 256,
      },
    ),
    createTrackRibbon(
      trackCurve,
      bankWidth,
      surfaceY + 0.012,
      bankMaterial,
      "track-bank-inner",
      {
        lateralOffset: bankOffset,
        segmentCount: 256,
      },
    ),
  );

  group.add(
    createTrackRibbon(
      trackCurve,
      tileWidth,
      surfaceY + 0.03,
      asphaltMaterial,
      "ellipse-track",
      {
        segmentCount: 256,
      },
    ),
  );

  group.add(createStartLine(trackCurve, tileWidth, surfaceY));

  createVillage(group, layout);

  const modelEntries = await Promise.allSettled(
    Object.entries(PROP_URLS).map(async ([key, url]) => {
      const modelScene = await loadModel(url);
      tintPropModel(
        modelScene,
        PROP_TINTS[key],
        PROP_MUTING[key],
        PROP_LIGHTENING[key],
      );
      configureShadowMesh(modelScene);
      return [key, modelScene];
    }),
  );

  const models = {};
  modelEntries.forEach((result) => {
    if (result.status === "fulfilled") {
      models[result.value[0]] = result.value[1];
    }
  });

  Object.keys(PROP_URLS).forEach((key) => {
    if (!models[key]) {
      const fallback = createFallbackProp(key);
      configureShadowMesh(fallback);
      models[key] = fallback;
    }
  });

  placeVegetation(group, layout, models);
  placeRocks(group, layout, models);
  placeWatercraft(group, layout, models);

  return {
    group,
    layout,
    surfaceY,
    totalLength,
    tileLength: totalLength / Math.max(tileCount, 1),
    tileWidth,
  };
}
