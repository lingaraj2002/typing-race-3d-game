import * as THREE from "three";
import { RACE_CONFIG } from "./raceConfig.js";

export function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(RACE_CONFIG.weather.skyHorizon);
  scene.fog = new THREE.Fog(
    RACE_CONFIG.weather.fogColor,
    RACE_CONFIG.weather.fogNear,
    RACE_CONFIG.weather.fogFar,
  );
  return scene;
}

/**
 * Coastal daylight rig — bright sun, hemisphere sky/ground bounce,
 * plus subtle fill and rim lights to keep the countryside readable.
 *
 * Returns the light rig so the looping climate can blend it between clear and
 * overcast without touching the camera or the vehicles.
 */
export function addRaceLighting(scene) {
  const hemisphere = new THREE.HemisphereLight(
    RACE_CONFIG.lighting.skyColor,
    RACE_CONFIG.lighting.groundColor,
    RACE_CONFIG.lighting.skyLightIntensity,
  );
  scene.add(hemisphere);

  const sun = new THREE.DirectionalLight(
    RACE_CONFIG.lighting.sunColor,
    RACE_CONFIG.lighting.sunIntensity,
  );
  sun.castShadow = true;
  sun.shadow.mapSize.set(
    RACE_CONFIG.lighting.shadowMapSize,
    RACE_CONFIG.lighting.shadowMapSize,
  );
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 420;
  sun.shadow.camera.left = -180;
  sun.shadow.camera.right = 180;
  sun.shadow.camera.top = 180;
  sun.shadow.camera.bottom = -180;
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = RACE_CONFIG.lighting.shadowBias;
  sun.shadow.normalBias = RACE_CONFIG.lighting.shadowNormalBias;
  sun.position.set(
    RACE_CONFIG.lighting.sunPosition.x,
    RACE_CONFIG.lighting.sunPosition.y,
    RACE_CONFIG.lighting.sunPosition.z,
  );
  sun.target.position.set(0, 0, 0);
  scene.add(sun, sun.target);

  const fill = new THREE.DirectionalLight(
    RACE_CONFIG.lighting.fillColor,
    RACE_CONFIG.lighting.fillIntensity,
  );
  fill.position.set(24, 14, 14);
  fill.target.position.set(0, 0, 0);
  scene.add(fill, fill.target);

  const rim = new THREE.DirectionalLight(
    RACE_CONFIG.lighting.rimColor,
    RACE_CONFIG.lighting.rimIntensity,
  );
  rim.position.set(0, 12, -30);
  rim.target.position.set(0, 0, 0);
  scene.add(rim, rim.target);

  return { hemisphere, sun, fill, rim };
}

export function configureShadowMesh(
  mesh,
  { cast = true, receive = true } = {},
) {
  mesh.traverse((child) => {
    if (!child.isMesh) return;
    const isTransparent = child.material?.transparent;
    child.castShadow = cast && !isTransparent;
    child.receiveShadow = receive && !isTransparent;
  });
}
