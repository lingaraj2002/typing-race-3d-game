import * as THREE from "three";

/**
 * Free-fly "drone" camera for inspecting the world during development.
 *
 * Controls:
 *   W/A/S/D  - move forward/left/back/right (camera-relative)
 *   Q/E      - move down/up
 *   Shift    - speed boost
 *   Mouse    - click and drag the canvas to look around
 *   Wheel    - adjust move speed
 *
 * Not meant for the actual game camera — this is a dev/inspection tool,
 * swap it out for thirdPersonCamera.js once the world is confirmed correct.
 */
export function createDroneCamera(camera, domElement, options = {}) {
  const { startPosition = { x: 0, y: 15, z: 30 }, baseSpeed = 20 } = options;

  camera.position.set(startPosition.x, startPosition.y, startPosition.z);

  let yaw = 0;
  let pitch = 0;
  let speed = baseSpeed;

  const keys = new Set();
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  function onKeyDown(e) {
    keys.add(e.key.toLowerCase());
  }
  function onKeyUp(e) {
    keys.delete(e.key.toLowerCase());
  }

  function onPointerDown(e) {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  }
  function onPointerUp() {
    dragging = false;
  }
  function onPointerMove(e) {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;

    yaw -= dx * 0.003;
    pitch -= dy * 0.003;
    pitch = THREE.MathUtils.clamp(
      pitch,
      -Math.PI / 2 + 0.05,
      Math.PI / 2 - 0.05,
    );
  }

  function onWheel(e) {
    e.preventDefault();
    speed = THREE.MathUtils.clamp(speed - e.deltaY * 0.02, 2, 200);
  }

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  domElement.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointermove", onPointerMove);
  domElement.addEventListener("wheel", onWheel, { passive: false });
  domElement.style.cursor = "grab";

  function update(dt) {
    camera.rotation.set(pitch, yaw, 0, "YXZ");

    forward.set(0, 0, -1).applyEuler(camera.rotation);
    right.set(1, 0, 0).applyEuler(camera.rotation);

    const moveSpeed = speed * (keys.has("shift") ? 2.5 : 1) * dt;
    const move = new THREE.Vector3();

    if (keys.has("w")) move.add(forward);
    if (keys.has("s")) move.addScaledVector(forward, -1);
    if (keys.has("d")) move.add(right);
    if (keys.has("a")) move.addScaledVector(right, -1);
    if (keys.has("e")) move.add(up);
    if (keys.has("q")) move.addScaledVector(up, -1);

    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(moveSpeed);
      camera.position.add(move);
    }
  }

  function dispose() {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    domElement.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointermove", onPointerMove);
    domElement.removeEventListener("wheel", onWheel);
  }

  return { update, dispose };
}
