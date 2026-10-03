import * as THREE from "three";
import { loadModel, createPlaceholderVehicle } from "../utils/assetLoader.js";
import {
  CAR_VARIANT_KEYS,
  DEFAULT_CAR_VARIANT,
  resolveCarVariant,
} from "./carVariants.js";
import { createWheelRig } from "./wheelController.js";

/**
 * Shared-model car factory.
 *
 * `loadBaseCarModel` memoises each GLB URL, and `createCar` deep-clones the
 * loaded result per car, so a rematch or a second race costs no extra requests.
 *
 * Cloning shares geometry and textures by reference — exactly what four cars
 * want — but three.js also shares MATERIALS across a clone, so every car gets
 * its own material instances before anything recolours them. That is the only
 * per-car allocation in here; geometries, textures and the Draco-decoded
 * buffers stay shared.
 *
 * Node references (body, four wheels) are resolved once during creation and
 * handed back on the instance, so nothing walks the graph per frame.
 */

const BODY_NODE_NAME = "Body";
const TAU = Math.PI * 2;
const STEERING_VISUAL_GAIN = 3.5; // amplifies small yaw rates so corners read on screen
const MIN_STEER_SPEED = 0.5; // world units/s below which a frame carries no steering info

// Reused scratch objects. createCar runs four times per grid, never per frame.
const _box = new THREE.Box3();
const _localMatrix = new THREE.Matrix4();
const _localBox = new THREE.Box3();
const _corner = new THREE.Vector3();
const _vertex = new THREE.Vector3();

const baseModelPromises = new Map();

/**
 * Loads each car model once per URL per page session.
 *
 * Rejects (loudly) if the GLB cannot be read — the Draco decoder and the URL
 * both come from the project's single assetLoader, so there is no second
 * loader to disagree with. Pair it with `usePlaceholderCarModel` to keep the
 * race running on the box car the way the rest of the game degrades.
 */
export function loadBaseCarModel(url) {
  if (!baseModelPromises.has(url)) {
    const baseModelPromise = loadModel(url).catch((error) => {
      // Clear the memo so a later attempt can retry instead of replaying the
      // failure for the rest of the session.
      baseModelPromises.delete(url);
      console.error(`[cars] failed to load ${url}`, error);
      throw error;
    });
    baseModelPromises.set(url, baseModelPromise);
  }
  return baseModelPromises.get(url);
}

/**
 * `.catch` handler for `loadBaseCarModel`: logs the real error and hands back
 * the project's existing placeholder car, matching how track props degrade.
 */
export function usePlaceholderCarModel(error) {
  console.warn(
    "[cars] falling back to the placeholder car — car variants and wheel " +
      "animation are unavailable this race.",
    error,
  );
  return createPlaceholderVehicle();
}

/** Body node, preferring the export's transform node over its mesh. */
function findBodyNode(model) {
  let group = null;
  let mesh = null;
  model.traverse((child) => {
    if (child.name.toLowerCase() !== BODY_NODE_NAME.toLowerCase()) return;
    if (child.isMesh) mesh ??= child;
    else group ??= child;
  });
  return group ?? mesh;
}

function findBodyMesh(model) {
  const bodyNode = findBodyNode(model);
  if (bodyNode?.isMesh) return bodyNode;
  let mesh = null;
  model.traverse((child) => {
    if (!mesh && child.isMesh) mesh = child;
  });
  return mesh;
}

function applyBodyScale(bodyNode, bodyScale) {
  if (!bodyNode) return;
  const { x = 1, y = 1, z = 1 } = bodyScale ?? {};
  bodyNode.scale.set(x, y, z);
}

/**
 * Repaints one mesh set, cloning the exported material the first time a source
 * material is seen so each car owns its own paint job.
 *
 * The GLB ships one PBR material carrying base colour, metallic/roughness, AO
 * and a normal map, all sharing one atlas. Cloning keeps every one of those
 * texture references intact — only the paint tint and the surface numbers are
 * replaced, which is what makes the variant colours work without a second
 * texture fetch.
 */
function paintMeshes(meshes, { color, metalness, roughness }, cache) {
  meshes.forEach((mesh) => {
    const source = mesh.material;
    const resolve = (material) => {
      if (!material?.isMaterial) return material;
      let painted = cache.get(material);
      if (!painted) {
        painted = material.clone();
        if (Number.isFinite(color)) painted.color.setHex(color);
        if (Number.isFinite(metalness)) painted.metalness = metalness;
        if (Number.isFinite(roughness)) painted.roughness = roughness;
        // The atlas carries an alpha channel; the cars have always been drawn
        // opaque, and leaving them transparent would sort badly against the road.
        painted.transparent = false;
        painted.opacity = 1;
        painted.depthWrite = true;
        painted.side = THREE.DoubleSide;
        cache.set(material, painted);
      }
      return painted;
    };
    mesh.material = Array.isArray(source) ? source.map(resolve) : resolve(source);
    // Mirrors the shadow setup the cars have always used.
    configureMesh(mesh);
  });
  return cache;
}

function configureMesh(mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
}

/** World-space box of `object`, expressed in `frame`'s local space. */
function localBoxOf(object, frame) {
  _box.setFromObject(object);
  _localBox.makeEmpty();
  for (let x = 0; x <= 1; x++) {
    for (let y = 0; y <= 1; y++) {
      for (let z = 0; z <= 1; z++) {
        _corner.set(
          x ? _box.max.x : _box.min.x,
          y ? _box.max.y : _box.min.y,
          z ? _box.max.z : _box.min.z,
        );
        _corner.applyMatrix4(_localMatrix.copy(frame.matrixWorld).invert());
        _localBox.expandByPoint(_corner);
      }
    }
  }
  return _localBox;
}

/**
 * Highest point of the body within a slice of the car's length, measured in
 * `frame`'s local space, plus the widest point of that slice.
 *
 * A single bounding box is no use for seating add-on parts: the roof is the
 * body's tallest point but it sits over the middle of the car, so a rear wing
 * placed at that height would hang in the air above the tail. Sampling the
 * vertices of the actual slice puts each part on the surface under it.
 */
function sampleLocalProfile(bodyMesh, frame, zMin, zMax) {
  const position = bodyMesh.geometry.getAttribute("position");
  if (!position) return { top: 0, halfWidth: 0 };
  _localMatrix.copy(frame.matrixWorld).invert().multiply(bodyMesh.matrixWorld);
  let top = -Infinity;
  let halfWidth = 0;
  for (let index = 0; index < position.count; index++) {
    _vertex.fromBufferAttribute(position, index).applyMatrix4(_localMatrix);
    if (_vertex.z < zMin || _vertex.z > zMax) continue;
    if (_vertex.y > top) top = _vertex.y;
    halfWidth = Math.max(halfWidth, Math.abs(_vertex.x));
  }
  return Number.isFinite(top) ? { top, halfWidth } : { top: 0, halfWidth: 0 };
}

function createExtraMaterial(part) {
  return new THREE.MeshStandardMaterial({
    color: part.color,
    metalness: part.metalness ?? 0.5,
    roughness: part.roughness ?? 0.5,
  });
}

/**
 * Bolts the variant's simple add-on parts onto the car.
 *
 * Deliberately box-level geometry: a rear wing is a blade on two stubs, a taxi
 * sign is one box. Anything more detailed is modelling, not a variant, and
 * would cost draw calls for detail nobody sees from the race camera.
 */
function addVariantExtras(carRoot, bodyMesh, variant, sink) {
  const extras = variant.extras ?? {};
  if (!bodyMesh || (!extras.spoiler && !extras.roofSign)) return;

  carRoot.updateMatrixWorld(true);
  const bodyBox = localBoxOf(bodyMesh, carRoot).clone();
  const length = bodyBox.max.z - bodyBox.min.z;

  if (extras.spoiler) {
    const part = extras.spoiler;
    const deck = sampleLocalProfile(
      bodyMesh,
      carRoot,
      bodyBox.min.z,
      bodyBox.min.z + length * 0.18,
    );
    const wingWidth = Math.max(deck.halfWidth * 2 * 0.92, 0.4);
    const thickness = 0.06;
    const z = bodyBox.min.z + Math.min(0.35, length * 0.06);
    const material = createExtraMaterial(part);

    const wing = new THREE.Mesh(
      new THREE.BoxGeometry(wingWidth, thickness, part.depth ?? 0.32),
      material,
    );
    wing.name = "car-spoiler";
    wing.position.set(0, deck.top + (part.height ?? 0.16), z);
    wing.rotation.x = -0.12; // slight rake so it reads as a wing, not a shelf
    wing.castShadow = true;
    wing.receiveShadow = true;
    carRoot.add(wing);

    const stubHeight = part.height ?? 0.16;
    const stub = new THREE.BoxGeometry(0.09, stubHeight, (part.depth ?? 0.32) * 0.5);
    [-1, 1].forEach((side) => {
      const support = new THREE.Mesh(stub, material);
      support.name = "car-spoiler-support";
      support.position.set(
        side * wingWidth * 0.3,
        deck.top + stubHeight / 2,
        z,
      );
      support.castShadow = true;
      support.receiveShadow = true;
      carRoot.add(support);
    });

    sink.materials.push(material);
    sink.geometries.push(wing.geometry, stub);
  }

  if (extras.roofSign) {
    const part = extras.roofSign;
    const roof = sampleLocalProfile(
      bodyMesh,
      carRoot,
      bodyBox.min.z + length * 0.3,
      bodyBox.min.z + length * 0.62,
    );
    const width = Math.max(roof.halfWidth * 2 * (part.width ?? 0.42), 0.3);
    const height = part.height ?? 0.2;
    const material = createExtraMaterial(part);
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, part.depth ?? 0.26),
      material,
    );
    sign.name = "car-roof-sign";
    sign.position.set(0, roof.top + height / 2 + 0.02, bodyBox.min.z + length * 0.46);
    sign.castShadow = true;
    sign.receiveShadow = true;
    carRoot.add(sign);

    sink.materials.push(material);
    sink.geometries.push(sign.geometry);
  }
}

function measureBounds(root) {
  const bounds = new THREE.Box3().setFromObject(root);
  const center = bounds.getCenter(new THREE.Vector3());
  return {
    min: bounds.min.clone(),
    max: bounds.max.clone(),
    center,
    // The car is centred on X and Z and rests on Y = 0, so the root origin is
    // the ground-contact point the track code expects.
    halfWidth: Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x)),
    height: bounds.max.y - bounds.min.y,
    length: bounds.max.z - bounds.min.z,
  };
}

function shortestAngleDelta(target, current) {
  let delta = (target - current) % TAU;
  if (delta > Math.PI) delta -= TAU;
  if (delta < -Math.PI) delta += TAU;
  return delta;
}

/**
 * Creates one fully independent car from the shared base model.
 *
 * @param {THREE.Object3D} baseModel the loaded GLB; never mutated
 * @param {object} [config] variant key, partial/full variant config, plus:
 *   `worldScale` — multiplier applied to the exported model dimensions to fit
 *   the game's world units.
 * @returns {object} car instance: { type, root, body, wheels, bounds, update, ... }
 */
export function createCar(baseModel, config = {}) {
  if (!baseModel) throw new Error("createCar requires a loaded base model");
  const variant = resolveCarVariant(config);
  const worldScale =
    Number.isFinite(config.worldScale) && config.worldScale > 0
      ? config.worldScale
      : 1;

  const root = new THREE.Group();
  root.name = `car-${variant.type}`;

  // The exported model is not centred on its own ground contact point, so it
  // rides in a holder that drops it onto Y = 0 and centres X/Z. Everything
  // outside the holder therefore works in the frame the track code already
  // uses: origin at the contact patch, +Z forward.
  const holder = new THREE.Group();
  holder.name = "car-model";

  const model = baseModel.clone(true);
  model.scale.setScalar(worldScale * variant.scale);
  model.rotation.y = Number.isFinite(config.modelRotationY)
    ? config.modelRotationY
    : 0;
  holder.add(model);
  root.add(holder);

  applyBodyScale(findBodyNode(model), variant.bodyScale);

  const rig = createWheelRig({
    model,
    wheelScale: variant.wheelScale,
    wheelOutset: variant.wheelOutset,
  });

  const wheelMeshes = Object.values(rig.slots).map((wheel) => wheel.mesh);
  const wheelSet = new Set(wheelMeshes);
  const bodyMeshes = [];
  model.traverse((child) => {
    if (child.isMesh && !wheelSet.has(child)) bodyMeshes.push(child);
  });

  const materialCache = new Map();
  const wheelCache = new Map();
  if (config.preserveMaterials) {
    model.traverse((child) => {
      if (child.isMesh) configureMesh(child);
    });
  } else {
    paintMeshes(
      bodyMeshes,
      {
        color: variant.color,
        metalness: variant.metalness,
        roughness: variant.roughness,
      },
      materialCache,
    );
    paintMeshes(
      wheelMeshes,
      {
        color: variant.wheelColor,
        metalness: variant.metalness,
        roughness: variant.roughness,
      },
      wheelCache,
    );
  }

  const sink = { materials: [], geometries: [] };
  const bodyMesh = bodyMeshes[0] ?? findBodyMesh(model);

  root.updateMatrixWorld(true);
  const seated = measureBounds(root);
  holder.position.set(-seated.center.x, -seated.min.y, -seated.center.z);
  root.updateMatrixWorld(true);

  addVariantExtras(root, bodyMesh, variant, sink);
  root.updateMatrixWorld(true);

  const bounds = measureBounds(root);
  const wheelRadius = rig.slots.frontLeft?.worldRadius ?? 0;

  // Reused per-frame scratch: the update runs for every car, every frame.
  const previousPosition = new THREE.Vector3();
  const travelled = new THREE.Vector3();
  let motionReady = false;
  let lastHeading = null;
  let disposed = false;

  /** Forgets the motion history; call after teleporting a car. */
  function resetMotion() {
    motionReady = false;
    lastHeading = null;
  }

  /**
   * Advances this car's wheels for one frame.
   *
   * Rolling is driven by how far the car actually moved, which keeps the wheels
   * locked to the rendered motion no matter how the caller computes speed (the
   * race advances in fixed 1/120 s steps and interpolates between frames, so a
   * separately tracked speed could drift from what is on screen). Pass `speed`
   * in world units per second to override it.
   *
   * Steering comes from the car's own heading change. The angle is the
   * physical one for the measured wheelbase and the car's actual speed
   * (tan(steer) = wheelbase * yawRate / speed), scaled up so it reads on
   * screen: the oval is one long, constant-radius corner, and the true angle
   * there is barely a degree. Pass `steering` (radians, positive = left) to
   * drive the wheels directly instead.
   */
  function update(delta, state = {}) {
    if (disposed || !(delta > 0)) return;

    let distance = 0;
    if (motionReady) {
      distance = travelled.copy(root.position).sub(previousPosition).length();
    } else {
      // First frame after placement: the car has not moved yet, so there is no
      // distance to roll — only remember where it started.
      motionReady = true;
    }
    previousPosition.copy(root.position);

    const speed = Number.isFinite(state.speed)
      ? state.speed
      : distance / delta;
    const rolled = Number.isFinite(state.speed) ? state.speed * delta : distance;

    let steerTarget = state.steering;
    if (!Number.isFinite(steerTarget)) {
      const heading = root.rotation.y;
      // The track advances in fixed steps, so some frames a car stands still.
      // Speed is what turns a yaw rate into a steer angle, so a frame without
      // motion carries no steering information: hold the last angle (the rig
      // keeps damping toward it) instead of dividing by a near-zero speed.
      if (lastHeading === null || speed < MIN_STEER_SPEED) {
        if (lastHeading === null) steerTarget = 0;
      } else {
        const yawRate = shortestAngleDelta(heading, lastHeading) / delta;
        const grip = rig.wheelbase > 0 ? (rig.wheelbase * yawRate) / speed : 0;
        steerTarget = Math.atan(grip) * STEERING_VISUAL_GAIN;
      }
      lastHeading = heading;
    }

    rig.update(delta, { distance: rolled, steerTarget });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    root.removeFromParent();
    // Only what this car allocated: shared geometry, textures and the memoised
    // base model belong to the factory and outlive individual cars.
    materialCache.forEach((material) => material.dispose());
    wheelCache.forEach((material) => material.dispose());
    sink.materials.forEach((material) => material.dispose());
    sink.geometries.forEach((geometry) => geometry.dispose());
    materialCache.clear();
    wheelCache.clear();
    sink.materials.length = 0;
    sink.geometries.length = 0;
  }

  return {
    type: variant.type,
    label: variant.label,
    variant,
    /** Placed on the track by vehicleController.updateVehiclePosition. */
    root,
    body: bodyMesh,
    wheels: rig.slots,
    wheelRadius,
    wheelbase: rig.wheelbase,
    bounds,
    update,
    resetMotion,
    dispose,
  };
}

/**
 * Builds a whole grid of variants from the one shared model.
 *
 * @param {THREE.Object3D} baseModel
 * @param {object} [options]
 * @param {number} [options.worldScale] world units per model unit
 * @param {string[]} [options.variants] catalogue keys, dealt out round-robin
 * @param {number} [options.count] how many cars the grid needs
 * @param {boolean} [options.preserveMaterials] keep the GLB's original materials
 * @returns {{cars: object[], halfWidth: number, dispose: Function}}
 */
export function createCarGrid(baseModel, options = {}) {
  const {
    worldScale = 1,
    variants = CAR_VARIANT_KEYS,
    count = variants.length,
    preserveMaterials = false,
  } = options;

  const keys = variants.length ? variants : [DEFAULT_CAR_VARIANT];
  const total = Math.max(1, Math.floor(count));
  const cars = [];
  for (let index = 0; index < total; index++) {
    cars.push(
      createCar(baseModel, {
        ...resolveCarVariant(keys[index % keys.length]),
        worldScale,
        preserveMaterials,
      }),
    );
  }

  return {
    cars,
    // Widest car in the field, which is what decides whether the grid fits
    // inside the painted road.
    halfWidth: cars.reduce(
      (widest, car) => Math.max(widest, car.bounds.halfWidth),
      0,
    ),
    dispose() {
      cars.forEach((car) => car.dispose());
      cars.length = 0;
    },
  };
}