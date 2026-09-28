import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";

const loader = new GLTFLoader();

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath("/draco/");

loader.setDRACOLoader(dracoLoader);

export function loadModel(path) {
  return new Promise((resolve, reject) => {
    loader.load(
      path,
      (gltf) => resolve(gltf.scene),
      undefined,
      (error) => reject(error),
    );
  });
}

export function createPlaceholderVehicle() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.55, 3.2),
    new THREE.MeshStandardMaterial({ color: 0xd946ef, roughness: 0.45 }),
  );
  body.position.y = 0.45;
  body.castShadow = true;
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 0.45, 1.4),
    new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.35 }),
  );
  cabin.position.set(0, 0.9, -0.2);
  cabin.castShadow = true;
  group.add(body, cabin);
  return group;
}

export async function loadVehicleModel(path) {
  try {
    return await loadModel(path);
  } catch (error) {
    console.warn("Vehicle GLB unavailable; using placeholder car.", error);
    return createPlaceholderVehicle();
  }
}
