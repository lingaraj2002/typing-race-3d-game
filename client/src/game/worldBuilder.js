import * as THREE from "three";
import { RACE_CONFIG } from "./raceConfig.js";
import {
  assembleTrackModel,
  beachHeightOffset,
  createGroundTexture,
  infieldHeightOffset,
  mesh,
  polarPoint,
  randomInAnnulus,
  seededRandom,
  TRACK_RADIUS_X,
  TRACK_RADIUS_Z,
} from "./track.js";
import { createStylizedWater } from "./stylizedWater.js";

// ─── Terrain Geometry ────────────────────────────────────────────────────────

/**
 * Ellipse band lying on the XZ plane (inner radii 0 -> solid ellipse disc).
 * The track is an ellipse (TRACK_RADIUS_X x TRACK_RADIUS_Z), so every terrain
 * layer is built as a concentric ellipse too; circular discs would leave water
 * gaps that follow the orbit instead of hugging the road.
 *
 * `rows` lists radial fractions from the inner edge (0) to the outer edge (1);
 * more rows let `heightAt(x, z)` carve banks and slopes into what used to be a
 * single flat quad strip. Defaults reproduce the original two-row flat ring.
 */
function createEllipseRingGeometry(
  outerX,
  outerZ,
  innerX = 0,
  innerZ = 0,
  segments = 96,
  { rows = [0, 1], heightAt = null } = {},
) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const step = (Math.PI * 2) / segments;

  for (const fraction of rows) {
    const scaleX = innerX + (outerX - innerX) * fraction;
    const scaleZ = innerZ + (outerZ - innerZ) * fraction;
    for (let i = 0; i <= segments; i++) {
      const angle = i * step;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const x = scaleX * cos;
      const z = scaleZ * sin;
      positions.push(x, heightAt ? heightAt(x, z) : 0, z);
      uvs.push(x / (outerX * 2) + 0.5, z / (outerZ * 2) + 0.5);
    }
  }

  const ringSize = segments + 1;
  for (let row = 0; row < rows.length - 1; row++) {
    const innerStart = row * ringSize;
    const outerStart = (row + 1) * ringSize;
    for (let i = 0; i < segments; i++) {
      const inner0 = innerStart + i;
      const inner1 = inner0 + 1;
      const outer0 = outerStart + i;
      const outer1 = outer0 + 1;
      indices.push(outer0, inner0, outer1, outer1, inner0, inner1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// The sea shader displaces its vertices, so the visible water needs enough
// radial rows for the swell to read as a surface rather than a fan of
// triangles. Roughly half of these rows land past the beach edge, which is the
// only water the player ever sees; the rest sit hidden under the land.
const OCEAN_SEGMENTS = 128;
const OCEAN_ROWS = 52;

function createOceanRows(count) {
  const rows = new Array(count + 1);
  for (let i = 0; i <= count; i++) rows[i] = i / count;
  return rows;
}

/**
 * The sea: a shallow disc carrying the stylized water shader, plus a slightly
 * larger and lower skirt that carries the same material out to the horizon.
 *
 * Both meshes share one material and both sample their waves from world
 * coordinates, so the skirt continues the swell exactly where the disc ends
 * and no seam shows at the join.
 *
 * The shader does its own lighting and never samples the shadow map, so the
 * meshes stay out of both shadow passes.
 */
function createOcean(worldGroup, layout, lights) {
  const water = createStylizedWater({ layout, lights });
  const oceanRows = createOceanRows(OCEAN_ROWS);

  const ocean = mesh(
    createEllipseRingGeometry(
      layout.oceanRadiusX,
      layout.oceanRadiusZ,
      0,
      0,
      OCEAN_SEGMENTS,
      { rows: oceanRows },
    ),
    water.material,
    { cast: false, receive: false },
  );
  ocean.position.set(layout.centerX, layout.waterY, layout.centerZ);
  ocean.name = "ocean";
  worldGroup.add(ocean);

  const deepOcean = mesh(
    createEllipseRingGeometry(
      layout.oceanRadiusX + 80,
      layout.oceanRadiusZ + 80,
      0,
      0,
      48,
    ),
    water.material,
    { cast: false, receive: false },
  );
  deepOcean.position.set(layout.centerX, layout.waterY - 1.2, layout.centerZ);
  deepOcean.name = "ocean-deep";
  worldGroup.add(deepOcean);

  return water;
}

// Radial rows for the sculpted land meshes (fractions, inner edge -> outer
// edge). Each mesh's road edge is held exactly flat by the height profiles so
// it seams into the shoulder ribbons; extra rows are concentrated on the bands
// where the bank, ridge ramp, and beach slope change fastest so the displaced
// geometry stays smooth instead of faceted.
const BEACH_ROWS = [
  0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.36, 0.42, 0.48, 0.54, 0.6, 0.66, 0.72,
  0.78, 0.84, 0.9, 0.95, 0.98, 1,
];
const INFIELD_ROWS = [
  0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65,
  0.7, 0.75, 0.79, 0.83, 0.87, 0.9, 0.93, 0.955, 0.975, 0.99, 1,
];

function createBeach(worldGroup, layout) {
  const beach = mesh(
    createEllipseRingGeometry(
      layout.beachOuterRadiusX,
      layout.beachOuterRadiusZ,
      layout.beachInnerRadiusX,
      layout.beachInnerRadiusZ,
      192,
      { rows: BEACH_ROWS, heightAt: beachHeightOffset },
    ),
    new THREE.MeshStandardMaterial({
      map: createGroundTexture(
        `#${RACE_CONFIG.palette.sand.toString(16).padStart(6, "0")}`,
        "rgba(255,255,255,0.12)",
        `rgba(${RACE_CONFIG.palette.soil >> 16}, ${(RACE_CONFIG.palette.soil >> 8) & 0xff}, ${RACE_CONFIG.palette.soil & 0xff}, 0.18)`,
      ),
      color: 0xffffff,
      roughness: 0.95,
    }),
    { cast: false, receive: true },
  );
  beach.position.set(layout.centerX, layout.surfaceY - 0.08, layout.centerZ);
  beach.name = "coastal-beach";
  worldGroup.add(beach);
  return beach;
}

function createInfieldGround(worldGroup, layout) {
  const grass = mesh(
    createEllipseRingGeometry(
      layout.innerLandRadiusX,
      layout.innerLandRadiusZ,
      0,
      0,
      192,
      { rows: INFIELD_ROWS, heightAt: infieldHeightOffset },
    ),
    new THREE.MeshStandardMaterial({
      map: createGroundTexture(
        "#87996b",
        "rgba(255,255,255,0.05)",
        "rgba(62,76,52,0.10)",
      ),
      color: 0xffffff,
      roughness: 0.92,
    }),
    { cast: false, receive: true },
  );
  grass.position.set(layout.centerX, layout.surfaceY - 0.02, layout.centerZ);
  grass.name = "infield-ground";
  worldGroup.add(grass);
  return grass;
}

const UP = new THREE.Vector3(0, 1, 0);
const MAX_PROP_SLOPE = 0.6;

/**
 * Settle a prop onto the sculpted infield so nothing hovers over it.
 *
 * The infield bank climbs steeply just behind the road, and these props are
 * wide enough to straddle that climb — `tree_grp` is a rigid cluster of a
 * dozen trees spanning ~11 units, not a single trunk. Planting one at the
 * ground height under its origin leaves its downhill end hanging in mid-air,
 * which is what the driver sees on the right-hand side of the track.
 *
 * Two steps fix that. First lean the prop until its base runs parallel to the
 * slope, the way a tree or boulder on a bank actually stands; the base is
 * planar and the tilt pivots on the prop's origin, so the base plane still
 * passes through the origin afterwards. Then drop it onto the lowest ground
 * under its footprint, so every part of the base ends up touching or below the
 * terrain.
 *
 * A rigid flat base cannot sit flush along its whole width on a curved bank,
 * so the last step necessarily trades the hover for depth: the four widest tree
 * clusters, which straddle the ridge flank where the ground falls up to 6 units
 * across their span, end up bedded into the slope instead. That is the correct
 * side to err on — a tree bedded into a bank reads as terrain, a tree hanging in
 * the air with daylight under it reads as a bug.
 */
function groundInfieldProps(trackGroup, infieldGround) {
  trackGroup.updateMatrixWorld(true);
  infieldGround.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const scratch = new THREE.Vector3();
  const up = new THREE.Vector3();
  const tilt = new THREE.Quaternion();
  const yaw = new THREE.Quaternion();

  trackGroup.traverse((prop) => {
    if (!prop.userData.groundToInfield) return;
    const patch = prop.userData.contactPatch;
    if (!patch) return;

    const bounds = new THREE.Box3().setFromObject(prop);
    const cos = Math.cos(prop.rotation.y);
    const sin = Math.sin(prop.rotation.y);
    // Where the prop's own local X and Z axes point, in world space.
    const axisX = { x: cos, z: -sin };
    const axisZ = { x: sin, z: cos };

    const STEPS = [-1, -0.5, 0, 0.5, 1];
    const grid = STEPS.map(() => new Array(STEPS.length).fill(null));
    for (let i = 0; i < STEPS.length; i++) {
      for (let j = 0; j < STEPS.length; j++) {
        const lx = STEPS[i] * patch.halfX;
        const lz = STEPS[j] * patch.halfZ;
        const x = prop.position.x + lx * axisX.x + lz * axisZ.x;
        const z = prop.position.z + lx * axisX.z + lz * axisZ.z;
        raycaster.set(scratch.set(x, bounds.max.y + 40, z), down);
        const hit = raycaster.intersectObject(infieldGround, false)[0];
        if (hit) grid[i][j] = { x, z, y: hit.point.y };
      }
    }
    const last = STEPS.length - 1;
    const at = (i, j) => grid[i][j];
    const samples = grid.flat().filter(Boolean);
    if (samples.length < 3) return;

    // Least-squares ground plane y = a*x + b*z + c. On a regular grid the
    // central differences give the gradient that minimises the residual.
    let gradeX = 0;
    let gradeZ = 0;
    if (patch.halfX > 0.001) {
      const near = at(0, Math.floor(last / 2));
      const far = at(last, Math.floor(last / 2));
      if (near && far) gradeX = (far.y - near.y) / (2 * patch.halfX);
    }
    if (patch.halfZ > 0.001) {
      const near = at(Math.floor(last / 2), 0);
      const far = at(Math.floor(last / 2), last);
      if (near && far) gradeZ = (far.y - near.y) / (2 * patch.halfZ);
    }

    // Keep an absurdly steep reading from tipping a prop onto its side.
    const grade = Math.hypot(gradeX, gradeZ);
    if (grade > MAX_PROP_SLOPE) {
      const trim = MAX_PROP_SLOPE / grade;
      gradeX *= trim;
      gradeZ *= trim;
    }

    let offset = 0;
    for (const s of samples) offset += s.y - (gradeX * s.x + gradeZ * s.z);
    offset /= samples.length;
    const planeAt = (x, z) => gradeX * x + gradeZ * z + offset;

    yaw.setFromAxisAngle(UP, prop.rotation.y);
    up.set(-gradeX, 1, -gradeZ).normalize();
    tilt.setFromUnitVectors(UP, up);
    prop.quaternion.copy(tilt).multiply(yaw);

    // The bank is curved, so a flat base can never sit flush along its whole
    // width. Lowering to the lowest residual keeps every part of the base in
    // contact with or below the ground — nothing hovers — and the only thing
    // left over is the unavoidable misfit, which reads as a tree or boulder
    // bedded into the slope.
    let lowest = Infinity;
    for (const s of samples) lowest = Math.min(lowest, s.y - planeAt(s.x, s.z));
    prop.position.y = planeAt(prop.position.x, prop.position.z) + lowest - 0.015;
  });
}

// ─── Clouds ──────────────────────────────────────────────────────────────────

function createCloudPuffGeometry(radius) {
  const geometry = new THREE.SphereGeometry(radius, 7, 5);
  const position = geometry.attributes.position;
  const index = geometry.index;
  const topIndices = [];
  const undersideIndices = [];

  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i);
    const b = index.getX(i + 1);
    const c = index.getX(i + 2);
    const averageY =
      (position.getY(a) + position.getY(b) + position.getY(c)) / 3;
    const target = averageY >= 0 ? topIndices : undersideIndices;
    target.push(a, b, c);
  }

  geometry.setIndex([...topIndices, ...undersideIndices]);
  geometry.clearGroups();
  geometry.addGroup(0, topIndices.length, 0);
  geometry.addGroup(topIndices.length, undersideIndices.length, 1);
  return geometry;
}

function createClouds(worldGroup, layout) {
  const rand = seededRandom(55);
  const cloudTopMaterial = new THREE.MeshStandardMaterial({
    name: "cloud-top",
    color: RACE_CONFIG.weather.cloudTopColorClear,
    roughness: 1,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  const cloudUndersideMaterial = new THREE.MeshStandardMaterial({
    name: "cloud-underside",
    color: RACE_CONFIG.weather.cloudUndersideColorClear,
    roughness: 1,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });

  const cloudGroups = [];
  for (let i = 0; i < RACE_CONFIG.world.cloudCount; i++) {
    const cloud = new THREE.Group();
    const puffs = 3 + Math.floor(rand() * 3);
    for (let j = 0; j < puffs; j++) {
      const r = 2.5 + rand() * 4.5;
      const puff = new THREE.Mesh(createCloudPuffGeometry(r), [
        cloudTopMaterial,
        cloudUndersideMaterial,
      ]);
      puff.position.set(
        (rand() - 0.5) * 12,
        (rand() - 0.5) * 2,
        (rand() - 0.5) * 6,
      );
      puff.scale.y = 0.45 + rand() * 0.25;
      puff.updateMatrix();
      cloud.add(puff);
    }
    const { angle, radius } = randomInAnnulus(
      rand,
      layout.innerLandRadiusX * 0.25,
      layout.oceanRadiusX * 0.85,
    );
    cloud.position.copy(polarPoint(layout, radius, angle, 50 + rand() * 25));
    worldGroup.add(cloud);
    cloudGroups.push(cloud);
  }

  return cloudGroups;
}

// ─── World Builder ───────────────────────────────────────────────────────────

/**
 * Build the coastal race world. The full track model and all track props are
 * assembled by track.js (assembleTrackModel); this module only renders the
 * assembled track and builds the surrounding terrain (ocean, beach, infield
 * ground) and clouds so track asset maintenance stays in one file.
 *
 * Pass the race light rig in as `lights` so the water shader can read the live
 * sun and sky values each frame; call `update(dt)` from the render loop to
 * advance the waves.
 */
export async function buildWorld(
  scene,
  tileUrl,
  { tileCount = 10, lights = null } = {},
) {
  const {
    group: trackGroup,
    layout,
    surfaceY,
    totalLength,
    tileLength,
    tileWidth,
  } = await assembleTrackModel({ tileUrl, tileCount });

  const worldGroup = new THREE.Group();
  worldGroup.name = "world";

  const water = createOcean(worldGroup, layout, lights);
  createBeach(worldGroup, layout);
  const infieldGround = createInfieldGround(worldGroup, layout);
  groundInfieldProps(trackGroup, infieldGround);
  worldGroup.add(trackGroup);

  const clouds = createClouds(worldGroup, layout);

  scene.add(worldGroup);

  return {
    worldGroup,
    surfaceY,
    tileLength,
    width: tileWidth,
    totalLength,
    layout,
    clouds,
    water,
    /** Per-frame world animation; the sea shader's clock is the only one. */
    update(dt) {
      water.update(dt);
    },
  };
}
