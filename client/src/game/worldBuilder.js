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
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createOcean(worldGroup, layout) {
  const ocean = mesh(
    createEllipseRingGeometry(layout.oceanRadiusX, layout.oceanRadiusZ, 0, 0, 72),
    new THREE.MeshStandardMaterial({
      color: RACE_CONFIG.palette.waterShallow,
      roughness: 0.15,
      metalness: 0.35,
      transparent: true,
      opacity: 0.9,
    }),
    { cast: false, receive: true },
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
    new THREE.MeshStandardMaterial({
      color: RACE_CONFIG.palette.waterDeep,
      roughness: 0.25,
    }),
    { cast: false, receive: true },
  );
  deepOcean.position.set(layout.centerX, layout.waterY - 1.2, layout.centerZ);
  worldGroup.add(deepOcean);
  return ocean;
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
      map: createGroundTexture("#87996b", "rgba(255,255,255,0.05)", "rgba(62,76,52,0.10)"),
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
    const averageY = (position.getY(a) + position.getY(b) + position.getY(c)) / 3;
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
      puff.position.set((rand() - 0.5) * 12, (rand() - 0.5) * 2, (rand() - 0.5) * 6);
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
 */
export async function buildWorld(scene, tileUrl, { tileCount = 10 } = {}) {
  const { group: trackGroup, layout, surfaceY, totalLength, tileLength, tileWidth } =
    await assembleTrackModel({ tileUrl, tileCount });

  const worldGroup = new THREE.Group();
  worldGroup.name = "world";

  createOcean(worldGroup, layout);
  createBeach(worldGroup, layout);
  createInfieldGround(worldGroup, layout);
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
  };
}
