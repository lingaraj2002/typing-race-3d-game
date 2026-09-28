export const SCENE_ASPECT_RATIO = 16 / 9;

// Every screen is authored at this 16:9 design resolution and then scaled to
// fit the window, so all content shrinks/grows together without overflowing.
export const STAGE_WIDTH = 1920;
export const STAGE_HEIGHT = 1080;

const MAX_PIXEL_RATIO = 3;

export function getStageScale() {
  return Math.max(
    Math.min(
      window.innerWidth / STAGE_WIDTH,
      window.innerHeight / STAGE_HEIGHT,
    ),
    0.01,
  );
}

/**
 * Keeps the renderer's drawing buffer matched to the scaled stage so the 3D
 * view stays sharp on large screens and cheap on small ones.
 */
export function getRenderPixelRatio() {
  const devicePixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  return Math.min(devicePixelRatio * getStageScale(), MAX_PIXEL_RATIO);
}

function syncStageScale() {
  document.documentElement.style.setProperty(
    "--stage-scale",
    String(getStageScale()),
  );
}

if (typeof window !== "undefined") {
  syncStageScale();
  window.addEventListener("resize", syncStageScale);
}

/**
 * Sizes the renderer and camera to the largest 16:9 rectangle that fits the
 * container and centers the canvas inside it. The canvas is already scaled by
 * the stage, so this just normalizes the camera viewport.
 */
export function fitRendererToAspect(renderer, camera, container) {
  const availableWidth = Math.max(container.clientWidth, 1);
  const availableHeight = Math.max(container.clientHeight, 1);

  let width = availableWidth;
  let height = Math.round(width / SCENE_ASPECT_RATIO);
  if (height > availableHeight) {
    height = availableHeight;
    width = Math.round(height * SCENE_ASPECT_RATIO);
  }
  width = Math.max(width, 1);
  height = Math.max(height, 1);

  const left = Math.round((availableWidth - width) / 2);
  const top = Math.round((availableHeight - height) / 2);

  const canvas = renderer.domElement;
  canvas.style.position = "absolute";
  canvas.style.left = `${left}px`;
  canvas.style.top = `${top}px`;
  canvas.style.display = "block";

  renderer.setSize(width, height, true);

  camera.aspect = SCENE_ASPECT_RATIO;
  camera.updateProjectionMatrix();

  return { left, top, width, height };
}
