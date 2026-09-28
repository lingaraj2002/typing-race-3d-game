import * as THREE from "three";
import { RACE_CONFIG } from "./raceConfig.js";

/**
 * Third-person race camera.
 *
 * Composition goals:
 * - player car stays near the horizontal center of the screen while riding
 *   slightly below the vertical center, with the typing word just above it
 * - a long stretch of road ahead stays visible so upcoming curves read early
 * - terrain stays visible on both sides for depth and sense of speed
 *
 * Follow behavior:
 * - the camera sits behind the car at cameraHeight/cameraDistance and looks at
 *   a point ahead (cameraLookAhead/cameraLookHeight)
 * - when the car's track curve + progress are supplied, the camera heading
 *   anticipates the road ahead instead of swinging after the car, so corners
 *   feel smooth and the car never slides off-center
 * - every degree of freedom (heading, position, look-target, FOV, bank) is
 *   smoothed with exponential damping, never snapped
 */
export function createThirdPersonCamera(camera, vehicle, scene, options = {}) {
  const {
    cameraHeight = RACE_CONFIG.camera.heightAboveRoad,
    cameraDistance = RACE_CONFIG.camera.distanceBehindVehicle,
    cameraLookAhead = RACE_CONFIG.camera.lookAheadDistance,
    cameraLookHeight = RACE_CONFIG.camera.lookHeightAboveRoad,
    baseFov = RACE_CONFIG.camera.fieldOfViewDegrees,
    maxFovIncrease = RACE_CONFIG.camera.boostFieldOfViewStepDegrees *
      RACE_CONFIG.boostLevels,
    maxSpeedPullback = RACE_CONFIG.camera.speedFollowDistance,
    maxSpeedHeight = RACE_CONFIG.camera.speedHeightLift,
    roadHeight = 0, // pass in your real trackSurfaceY here
    positionSmoothing = RACE_CONFIG.camera.positionSmoothness,
    lookAtSmoothing = RACE_CONFIG.camera.lookTargetSmoothness,
    headingSmoothing = RACE_CONFIG.camera.rotationSmoothness,
    // How much the camera rotates toward the road direction ahead when
    // following the car curve (0 = pure car heading, 1 = fully look-ahead).
    turnInAmount = RACE_CONFIG.camera.curveTurnInAmount,
    // Damping for the curve-anticiating heading blend. Higher = faster follow.
    lookAheadHeadingSmoothing = RACE_CONFIG.camera.rotationSmoothness,
    // Extra arc distance beyond cameraLookAhead used to sample the road
    // direction for curve anticipation.
    curveLookAheadExtra = RACE_CONFIG.camera.curveLookAheadExtra,
    fovSmoothing = RACE_CONFIG.camera.fieldOfViewSmoothing,
    bankSmoothing = RACE_CONFIG.camera.rotationSmoothness,
    maxBank = RACE_CONFIG.camera.maxBankRadians,
    speedLookAheadIncrease = RACE_CONFIG.camera.speedLookAheadIncrease,
    speedShake = 0,
    shakeFrequency = 19,
  } = options;

  camera.fov = baseFov;
  camera.updateProjectionMatrix();

  let smoothedHeading = 0;
  let cameraHeading = 0;
  let smoothedFov = baseFov;
  let zoomDistance = cameraDistance;
  let headingInitialized = false;
  let smoothedTurnRate = 0;
  let smoothedBank = 0;
  let shakeTime = 0;
  let shakeStrength = 0;

  const forwardVec = new THREE.Vector3();
  const desiredPosition = new THREE.Vector3();
  const desiredLookAt = new THREE.Vector3();
  const currentLookAt = new THREE.Vector3(0, 0, 1);
  const smoothedPosition = new THREE.Vector3();
  const handoffDirection = new THREE.Vector3();
  const shakeOffset = new THREE.Vector3();
  const gridCenter = new THREE.Vector3();
  const roadAheadPoint = new THREE.Vector3();
  const carToRoadAhead = new THREE.Vector3();

  function getVehicleHeading() {
    forwardVec.set(0, 0, 1).applyQuaternion(vehicle.quaternion);
    return Math.atan2(forwardVec.x, forwardVec.z);
  }

  function shortestAngleDelta(target, current) {
    let delta = (target - current) % (Math.PI * 2);
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    return delta;
  }

  /**
   * Heading from the car to the road point `arcAhead` units further along the
   * same curve. This is what lets the camera ease into a corner instead of
   * waiting for the car to swing around it.
   */
  function getRoadAheadHeading(
    carPoint,
    curve,
    trackProgress,
    lookAheadDistance = cameraLookAhead + curveLookAheadExtra,
  ) {
    const totalLength = curve.getLength();
    if (totalLength <= 0) return null;

    const aheadFraction = lookAheadDistance / totalLength;
    curve.getPointAt(trackProgress + aheadFraction, roadAheadPoint);

    carToRoadAhead.set(
      carPoint.x - roadAheadPoint.x,
      0,
      carPoint.z - roadAheadPoint.z,
    );
    if (carToRoadAhead.lengthSq() < 0.0001) return null;
    // NEGATE: heading of the direction car -> road point ahead.
    return Math.atan2(-carToRoadAhead.x, -carToRoadAhead.z);
  }

  function updateRace(dt, { normalizedSpeed = 0, curve = null, trackProgress = null } = {}) {
    const safeDt = Math.min(Math.max(dt, 0), 0.1);
    const speedAmount = THREE.MathUtils.clamp(normalizedSpeed, 0, 1);
    const point = vehicle.position;
    const rawHeading = getVehicleHeading();

    if (!headingInitialized) {
      smoothedHeading = rawHeading;
      cameraHeading = rawHeading;
      headingInitialized = true;
    } else {
      // damp the SHORTEST angular path, not the raw value, to avoid spins at the +-PI wrap
      const delta = shortestAngleDelta(rawHeading, smoothedHeading);
      const turnRate =
        safeDt > 0 ? THREE.MathUtils.clamp(delta / safeDt, -4, 4) : 0;
      smoothedTurnRate = THREE.MathUtils.damp(
        smoothedTurnRate,
        turnRate,
        headingSmoothing,
        safeDt,
      );
      smoothedHeading += THREE.MathUtils.damp(
        0,
        delta,
        headingSmoothing,
        safeDt,
      );
    }

    // Blend the (already smooth) car heading with the direction to the road
    // ahead, then smooth that blend so turns are anticipated, not chased.
    const speedLookAhead = speedAmount * speedLookAheadIncrease;
    const roadLookAhead = cameraLookAhead + speedLookAhead + curveLookAheadExtra;
    let targetHeading = smoothedHeading;
    if (curve && trackProgress != null) {
      const roadHeading = getRoadAheadHeading(
        point,
        curve,
        trackProgress,
        roadLookAhead,
      );
      if (roadHeading != null) {
        targetHeading =
          smoothedHeading +
          shortestAngleDelta(roadHeading, smoothedHeading) * turnInAmount;
      }
    }
    cameraHeading += THREE.MathUtils.damp(
      0,
      shortestAngleDelta(targetHeading, cameraHeading),
      lookAheadHeadingSmoothing,
      safeDt,
    );

    const heading = cameraHeading;
    const speedPull = speedAmount * maxSpeedPullback;
    const speedHeightLift = speedAmount * maxSpeedHeight;
    // Height grows more slowly than distance at speed, so the car stays in
    // roughly the same vertical spot while the road ahead opens up.
    const distance = zoomDistance + speedPull;
    const height = roadHeight + cameraHeight + speedHeightLift;
    const sinH = Math.sin(heading);
    const cosH = Math.cos(heading);

    desiredPosition.set(
      point.x - sinH * distance,
      height,
      point.z - cosH * distance,
    );

    desiredLookAt.set(
      point.x + sinH * (cameraLookAhead + speedLookAhead),
      roadHeight + cameraLookHeight + speedHeightLift * 0.4,
      point.z + cosH * (cameraLookAhead + speedLookAhead),
    );

    const dampingDt = safeDt || 1 / 60;
    smoothedPosition.lerp(
      desiredPosition,
      1 - Math.exp(-positionSmoothing * dampingDt),
    );
    currentLookAt.lerp(
      desiredLookAt,
      1 - Math.exp(-lookAtSmoothing * dampingDt),
    );
    smoothedBank = THREE.MathUtils.damp(
      smoothedBank,
      THREE.MathUtils.clamp(
        -smoothedTurnRate * 0.012,
        -maxBank,
        maxBank,
      ),
      bankSmoothing,
      dampingDt,
    );

    shakeTime += dampingDt;
    const speedShakeAmount = speedAmount * speedShake;
    const activeShake = speedShakeAmount + shakeStrength;
    shakeStrength = THREE.MathUtils.damp(shakeStrength, 0, 10, dampingDt);
    shakeOffset.set(
      Math.sin(shakeTime * shakeFrequency) * activeShake,
      Math.cos(shakeTime * shakeFrequency * 1.37) * activeShake * 0.65,
      Math.sin(shakeTime * shakeFrequency * 0.73) * activeShake * 0.35,
    );
    camera.position.copy(smoothedPosition).add(shakeOffset);
    camera.lookAt(currentLookAt);
    camera.rotateZ(smoothedBank);

    const targetFov = baseFov + speedAmount * maxFovIncrease;
    smoothedFov = THREE.MathUtils.damp(
      smoothedFov,
      targetFov,
      fovSmoothing,
      dampingDt,
    );
    if (Math.abs(camera.fov - smoothedFov) > 0.001) {
      camera.fov = smoothedFov;
      camera.updateProjectionMatrix();
    }
  }

  function updateCountdown(dt, gridVehicles) {
    // simple slow orbit around the grid while cars wait for the countdown
    gridCenter.set(0, 0, 0);
    gridVehicles.forEach((v) => gridCenter.add(v.position));
    gridCenter.divideScalar(gridVehicles.length || 1);

    const t = performance.now() * 0.0002;
    camera.position.set(
      gridCenter.x + Math.sin(t) * (zoomDistance + 4),
      roadHeight + cameraHeight + 2,
      gridCenter.z + Math.cos(t) * (zoomDistance + 4),
    );
    camera.lookAt(gridCenter.x, roadHeight + cameraLookHeight, gridCenter.z);
  }

  function triggerShake(intensity = 0.08) {
    shakeStrength = Math.max(shakeStrength, Math.max(0, intensity));
  }

  function beginRace() {
    smoothedHeading = getVehicleHeading();
    camera.getWorldDirection(handoffDirection);
    cameraHeading = Math.atan2(handoffDirection.x, handoffDirection.z);
    headingInitialized = true;
    smoothedTurnRate = 0;
    smoothedBank = 0;
    shakeTime = 0;
    shakeStrength = 0;
    smoothedFov = baseFov;
    camera.fov = baseFov;
    camera.updateProjectionMatrix();
    smoothedPosition.copy(camera.position);
    currentLookAt
      .copy(camera.position)
      .addScaledVector(handoffDirection, cameraLookAhead);
  }

  function reset() {
    headingInitialized = false;
    smoothedTurnRate = 0;
    smoothedBank = 0;
    shakeTime = 0;
    shakeStrength = 0;
    smoothedFov = baseFov;
    camera.fov = baseFov;
    camera.updateProjectionMatrix();
  }

  function dispose() {}

  return {
    beginRace,
    updateRace,
    updateCountdown,
    triggerShake,
    reset,
    dispose,
  };
}