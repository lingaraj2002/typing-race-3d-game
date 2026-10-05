import * as THREE from "three";
import { createScene, addRaceLighting } from "./scene.js";
import { buildWorld } from "./worldBuilder.js";
const trackTileUrl = "/assets/models/road_track.glb";

export async function startSinglePlayerRace(container) {
  container.innerHTML = `<div id="world-debug" style="position:fixed;top:12px;left:12px;color:#7dd3fc;font-family:monospace;background:rgba(0,0,0,0.6);padding:8px 12px;font-size:12px;">loading world…</div>`;

  const scene = createScene();
  const lighting = addRaceLighting(scene);

  const world = await buildWorld(scene, trackTileUrl, {
    tileCount: 10,
    lights: lighting,
  });

  // Surface these numbers on screen — they tell you immediately whether the
  // artist's export scale matches the game's units.
  document.getElementById("world-debug").innerHTML = `
    tile length: ${world.tileLength.toFixed(2)}<br>
    tile width: ${world.width.toFixed(2)}<br>
    surface Y: ${world.surfaceY.toFixed(2)}<br>
    total length: ${world.totalLength.toFixed(2)}
  `;
  console.log("world measurements:", world);

  // --- temporary flyover camera so you can inspect the whole tiled strip ---
  const camera = new THREE.PerspectiveCamera(
    60,
    container.clientWidth / container.clientHeight,
    0.1,
    2000,
  );
  camera.position.set(0, world.surfaceY + 210, 8);
  camera.lookAt(0, world.surfaceY, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  let camHeight = camera.position.y;
  let lastTime = performance.now();
  function onKey(e) {
    if (e.key === "ArrowUp") camHeight = Math.max(40, camHeight - 15);
    if (e.key === "ArrowDown") camHeight += 15;
    camera.position.set(0, camHeight, 8);
    camera.lookAt(0, world.surfaceY, 0);
  }
  window.addEventListener("keydown", onKey);

  function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    world.update(Math.min((now - lastTime) / 1000, 0.05));
    lastTime = now;
    renderer.render(scene, camera);
  }
  animate();

  function onResize() {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  }
  window.addEventListener("resize", onResize);

  return function cleanup() {
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", onResize);
    renderer.dispose();
    container.innerHTML = "";
  };
}
