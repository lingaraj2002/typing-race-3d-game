import * as THREE from "three";
import { RACE_CONFIG } from "./raceConfig.js";

function easeInOutCubic(value) {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Intro camera choreography for the starting grid.
 *
 * The shot opens pulled back and up from the final chase-camera spot — a
 * wide, elevated three-quarter view (roughly a 45-50 degree angle down to
 * the car, not a top-down/bird's-eye shot) — already looking at the same
 * forward focus point the gameplay camera uses. It then moves in a single
 * straight line (no sideways S-curve, no Bezier handles) down and in to the
 * exact third-person gameplay framing, with FOV easing in sync so the
 * handoff is seamless.
 */
export function createPreRaceCinematicCamera(camera, options = {}) {
  const {
    roadHeight = 0,
    duration = RACE_CONFIG.presentation.introDurationSeconds,
    // Opening pose: pulled back and up from the final chase pose, at
    // roughly a 45-50 degree elevation angle (not a top-down look).
    // startHeight is how high above the final camera it starts; startSetback
    // is how much further behind the car it starts. Keep the two roughly
    // equal (or startHeight a touch bigger) to land in the 45-50 deg range.
    startHeight = 16,
    startSetback = 14,
    // Final pose: matches the third-person camera.
    endHeight = RACE_CONFIG.camera.heightAboveRoad,
    finalDistance = RACE_CONFIG.camera.distanceBehindVehicle,
    finalLookAhead = RACE_CONFIG.camera.lookAheadDistance,
    finalLookHeight = RACE_CONFIG.camera.lookHeightAboveRoad,
    // Lens: cinematic opening -> normal race-camera view.
    startFov = RACE_CONFIG.camera.introFieldOfViewDegrees,
    endFov = RACE_CONFIG.camera.fieldOfViewDegrees,
  } = options;

  const playerForward = new THREE.Vector3();

  const startPoint = new THREE.Vector3();
  const endPoint = new THREE.Vector3();

  const finalLookAt = new THREE.Vector3();
  const currentLookAt = new THREE.Vector3();

  let gridVehicles = [];
  let playerVehicle = null;
  let elapsed = 0;
  let progress = 0;
  let active = false;

  function begin(vehicles, player) {
    gridVehicles = vehicles.filter(Boolean);
    playerVehicle = player || gridVehicles[0] || null;
    elapsed = 0;
    progress = 0;
    active = true;

    if (!playerVehicle || !gridVehicles.length) return;
    computePath();
    camera.position.copy(startPoint);
    currentLookAt.copy(finalLookAt);
    camera.lookAt(currentLookAt);
    camera.fov = startFov;
    camera.updateProjectionMatrix();
  }

  function getFinalPose() {
    playerForward
      .set(0, 0, 1)
      .applyQuaternion(playerVehicle.quaternion)
      .normalize();
    playerForward.y = 0;
    playerForward.normalize();

    endPoint
      .copy(playerVehicle.position)
      .addScaledVector(playerForward, -finalDistance);
    endPoint.y = roadHeight + endHeight;

    finalLookAt
      .copy(playerVehicle.position)
      .addScaledVector(playerForward, finalLookAhead);
    finalLookAt.y = roadHeight + finalLookHeight;
  }

  // Straight-line path: start pulled back and up at a wide, elevated angle,
  // already aimed at the same forward focus point, then move in one
  // straight line down and in to the final chase pose. No lateral swing,
  // no Bezier handles, no top-down look angle.
  function computePath() {
    getFinalPose();

    startPoint.copy(endPoint).addScaledVector(playerForward, -startSetback);
    startPoint.y = roadHeight + endHeight + startHeight;
  }

  function update(dt) {
    if (!active || !playerVehicle || !gridVehicles.length) return true;

    elapsed = Math.min(elapsed + Math.max(dt, 0), duration);
    progress = duration > 0 ? elapsed / duration : 1;
    const eased = easeInOutCubic(progress);

    computePath();
    camera.position.lerpVectors(startPoint, endPoint, eased);

    // Look target stays fixed on the same forward focus point the whole
    // time, so the camera reads as "pulled back at a wide angle, looking
    // ahead" rather than a top-down shot, and simply moves into the
    // gameplay framing.
    currentLookAt.copy(finalLookAt);
    camera.lookAt(currentLookAt);

    // FOV transitions from the cinematic opening to the normal race-camera view.
    const nextFov = THREE.MathUtils.lerp(startFov, endFov, eased);
    if (Math.abs(camera.fov - nextFov) > 0.001) {
      camera.fov = nextFov;
      camera.updateProjectionMatrix();
    }

    return progress >= 1;
  }

  function isComplete() {
    return elapsed >= duration;
  }

  function getProgress() {
    return progress;
  }

  return { begin, update, isComplete, getProgress };
}
