import * as THREE from "three";

/**
 * Programmatic wheel rig for the shared car GLB.
 *
 * The export ships four static wheel meshes with their geometry baked into car
 * space, so animating them means wrapping each one in its own transform chain:
 *
 *   steering pivot (front wheels only, rotates about the car's up axis)
 *     └── roll pivot (rotates about the wheel's axle)
 *         └── wheel mesh
 *
 * The pivots are inserted at the wheel's own centre and the mesh is pushed back
 * by that same centre, so a rig built with wheelScale = 1 leaves every wheel at
 * exactly the position the artist exported. Scaling then grows the tyre about
 * its axle, and the steering pivot lifts it by the growth of the radius so the
 * tread stays on the road instead of sinking into it.
 *
 * Axes come from the model, not from a guess: the roll axis is the wheel's own
 * local X (the axle, measured from the exported wheel geometry), and the
 * steering axis is the car's up axis.
 */

/** Wheel slots, in the order the rig reports them. */
export const WHEEL_SLOTS = Object.freeze([
  "frontLeft",
  "frontRight",
  "rearLeft",
  "rearRight",
]);

export const STEERING_SLOTS = Object.freeze(["frontLeft", "frontRight"]);

// The export names its wheels F_left_Wheel, F_Right_Wheel, B_left_Wheel and
// B_Right_Wheel, and GLTFLoader appends an index to any name it has already
// seen (each wheel name appears twice in the file, as a transform node and as
// the mesh under it), so the names are matched as words rather than as strings.
const AXLE_TOKENS = Object.freeze([
  ["rear", ["rear", "back"]],
  ["front", ["front", "fwd", "nose"]],
  ["rear", ["b"]],
  ["front", ["f"]],
]);
const SIDE_TOKENS = Object.freeze([
  ["right", ["right", "rgt"]],
  ["left", ["left", "lft"]],
  ["right", ["r"]],
  ["left", ["l"]],
]);

/** The exported names, for the warning shown when a model has no wheels. */
const wheelNamePatterns = Object.freeze({
  frontLeft: "F_left_Wheel",
  frontRight: "F_Right_Wheel",
  rearLeft: "B_left_Wheel",
  rearRight: "B_Right_Wheel",
});

/** Splits "F_Right_Wheel_1" into the words a wheel name is built from. */
function nameWords(name) {
  return String(name)
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
}

function tokenRole(words, table) {
  for (const [role, tokens] of table) {
    if (words.some((word) => tokens.includes(word))) return role;
  }
  return null;
}

function wheelSlotFromName(name) {
  const words = nameWords(name);
  const axle = tokenRole(words, AXLE_TOKENS);
  const side = tokenRole(words, SIDE_TOKENS);
  if (!axle || !side) return null;
  return `${axle}${side[0].toUpperCase()}${side.slice(1)}`;
}

const DEFAULT_MAX_STEERING = 0.42; // radians, ~24 degrees
const DEFAULT_STEERING_RESPONSE = 9; // damping rate toward the target angle
const MIN_WHEEL_RADIUS = 1e-4;

let warnedMissingWheels = false;

const _inverse = new THREE.Matrix4();
const _local = new THREE.Matrix4();
const _scale = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _position = new THREE.Vector3();
const _frontAxle = new THREE.Vector3();
const _center = new THREE.Vector3();
const _pivot = new THREE.Vector3();
const _geometryBox = new THREE.Box3();
const _wheelBox = new THREE.Box3();
const _vertex = new THREE.Vector3();

function isDescendantOrSelf(node, ancestor) {
  let current = node;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

/** Nearest node that parents every wheel, so the rig lives in one space. */
function commonAncestor(nodes) {
  let candidate = nodes[0];
  while (!nodes.every((node) => isDescendantOrSelf(node, candidate))) {
    candidate = candidate.parent;
    if (!candidate) return null;
  }
  return candidate;
}

/**
 * Resolves the wheel MESH for each slot.
 *
 * The export duplicates every wheel name across a transform node and the mesh
 * below it, and a plain name lookup would return the transform node, so this
 * only ever matches meshes.
 */
function findWheelMeshes(model) {
  const found = {};
  model.traverse((child) => {
    if (!child.isMesh) return;
    const slot = wheelSlotFromName(child.name);
    if (slot && !found[slot]) found[slot] = child;
  });
  return found;
}

/**
 * Builds the roll + steering rig inside an already-cloned car model.
 *
 * @param {object} options
 * @param {THREE.Object3D} options.model clone of the shared car GLB, mutated in place
 * @param {number} [options.wheelScale=1] tyre size multiplier
 * @param {number} [options.wheelOutset=0] extra track width in model units, per side
 * @param {number} [options.maxSteering] largest steer angle, radians
 * @param {number} [options.steeringResponse] steering damping rate
 * @returns {{slots: object, missing: string[], update: Function}}
 */
export function createWheelRig(options = {}) {
  const {
    model,
    wheelScale = 1,
    wheelOutset = 0,
    maxSteering = DEFAULT_MAX_STEERING,
    steeringResponse = DEFAULT_STEERING_RESPONSE,
  } = options;

  if (!model) throw new Error("createWheelRig requires the cloned car model");

  const meshes = findWheelMeshes(model);
  const slotNames = WHEEL_SLOTS;
  const present = slotNames.filter((slot) => meshes[slot]);
  const missing = slotNames.filter((slot) => !meshes[slot]);

  if (!present.length) {
    // Nothing to rig (placeholder car, or a model without wheels). The rest of
    // the car system treats this as "no wheels", never as an error. One warning
    // per module load: every car in a grid shares one model, so this would
    // otherwise repeat once per car.
    if (!warnedMissingWheels) {
      warnedMissingWheels = true;
      console.warn(
        `[cars] no wheel meshes named like ${slotNames
          .map((slot) => wheelNamePatterns[slot].join("/"))
          .join(", ")} in this model; wheel roll and steering are disabled`,
      );
    }
    return { slots: {}, missing, update: () => {}, setSteerTarget: () => {} };
  }

  // Full-subtree update: the wheel matrices are read below, and a clone starts
  // out with an identity world matrix until something walks the tree.
  model.updateWorldMatrix(true, true);
  const ancestor = commonAncestor(present.map((slot) => meshes[slot]));
  if (!ancestor) throw new Error("createWheelRig could not find a wheel parent");
  _inverse.copy(ancestor.matrixWorld).invert();

  const scale = Number.isFinite(wheelScale) && wheelScale > 0 ? wheelScale : 1;
  const slots = {};
  const originalParents = new Set();

  present.forEach((slot) => {
    const mesh = meshes[slot];
    const originalParent = mesh.parent;

    // The wheel's transform relative to the node the pivots hang from, so the
    // mesh keeps its exported placement even if a future export moves it.
    _local.multiplyMatrices(_inverse, mesh.matrixWorld);
    _local.decompose(_position, _quaternion, _scale);

    const geometry = mesh.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    _geometryBox.copy(geometry.boundingBox).applyMatrix4(_local);
    _geometryBox.getCenter(_center);

    // Radius before scaling: the lift that follows keeps the tread on the road.
    const radius = Math.max(_geometryBox.max.y - _center.y, MIN_WHEEL_RADIUS);
    _pivot.set(
      _center.x + Math.sign(_center.x || 1) * wheelOutset,
      _center.y + (scale - 1) * radius,
      _center.z,
    );

    const steer = new THREE.Group();
    steer.name = `${slot}-steer`;
    steer.position.copy(_pivot);

    const roll = new THREE.Group();
    roll.name = `${slot}-roll`;
    // Undo the pivot move so the exported geometry lands exactly where it was.
    mesh.position.copy(_pivot).negate();
    mesh.quaternion.copy(_quaternion);
    mesh.scale.copy(_scale).multiplyScalar(scale);

    roll.add(mesh);
    steer.add(roll);
    ancestor.add(steer);

    slots[slot] = {
      steer,
      roll,
      mesh,
      radius,
      worldRadius: radius,
      steers: STEERING_SLOTS.includes(slot),
    };
    originalParents.add(originalParent);
  });

  // The export's per-wheel transform nodes are empty once their mesh has moved
  // under a pivot; drop them so the rig's hierarchy stays readable.
  originalParents.forEach((node) => {
    if (node && node !== ancestor && node.children.length === 0) {
      node.removeFromParent();
    }
  });

  model.updateWorldMatrix(true, true);
  present.forEach((slot) => {
    const wheel = slots[slot];
    _wheelBox.setFromObject(wheel.mesh);
    // World-space radius drives the roll rate; car-space is not enough because
    // the game scales the whole model.
    wheel.worldRadius = Math.max(
      (_wheelBox.max.y - _wheelBox.min.y) / 2,
      MIN_WHEEL_RADIUS,
    );
  });

  let steerTarget = 0;

  function setSteerTarget(angle) {
    if (Number.isFinite(angle)) {
      steerTarget = THREE.MathUtils.clamp(angle, -maxSteering, maxSteering);
    }
  }

  /**
   * Advances the rig.
   *
   * @param {number} delta seconds since the previous frame
   * @param {object} [state]
   * @param {number} [state.distance] world-space distance rolled since the last frame
   * @param {number} [state.steerTarget] target steer angle in radians (Y positive = left)
   */
  function update(delta, state = {}) {
    if (!(delta > 0)) return;
    const { distance = 0, steerTarget: target = steerTarget } = state;
    setSteerTarget(target);

    present.forEach((slot) => {
      const wheel = slots[slot];
      // Positive distance rolls the wheels forward: the model's +X axle turns
      // the top of the tyre toward +Z, which is the direction the car faces.
      wheel.roll.rotation.x += distance / wheel.worldRadius;
      if (wheel.steers) {
        wheel.steer.rotation.y = THREE.MathUtils.damp(
          wheel.steer.rotation.y,
          steerTarget,
          steeringResponse,
          delta,
        );
      }
    });
  }

  // Front-to-rear distance and outer-to-outer track, both in world units: the
  // caller derives steering angles from them, and the model is scaled twice
  // (the export's own root scale sits below the game scale), so local-space
  // measurements would be off by orders of magnitude.
  const bodyBox = new THREE.Box3();
  present.forEach((slot) => bodyBox.expandByObject(slots[slot].mesh));
  let wheelbase = 0;
  if (present.includes("frontLeft") && present.includes("rearLeft")) {
    slots.frontLeft.steer.getWorldPosition(_position);
    slots.rearLeft.steer.getWorldPosition(_frontAxle);
    wheelbase = _position.distanceTo(_frontAxle);
  }
  return {
    slots,
    missing,
    update,
    setSteerTarget,
    wheelbase,
    track: bodyBox.max.x - bodyBox.min.x,
  };
}