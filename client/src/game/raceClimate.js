import * as THREE from "three";
import { RACE_CONFIG } from "./raceConfig.js";

const EQUIRECT = THREE.EquirectangularReflectionMapping;
// The sky gradient repaints on tiny deltas (silky smooth), while the more
// expensive PMREM environment bake refreshes only on larger, harder-to-notice
// steps. Both are far below the perceptual threshold.
const SKY_PAINT_STEP = 0.001;
const ENV_BAKE_STEP = 0.04;

/**
 * Looping coastal climate.
 *
 * A smooth clear -> overcast -> clear cloudiness cycle drives the daylight rig:
 * the sun fades while the diffuse sky light grows, shadows lose contrast,
 * reflections soften, the procedural sky turns from bright blue to muted
 * gray-blue, and the cloud props swell into view. The day stays bright — only
 * the light balance changes — and the camera/vehicles are never touched.
 *
 * The sun is re-anchored to the active race area every frame so the track stays
 * consistently lit as the player laps the circuit.
 */
export function createRaceClimate({ scene, renderer, lights, clouds = [] } = {}) {
  const cfg = RACE_CONFIG.weather;
  const light = RACE_CONFIG.lighting;

  const { canvas, ctx, texture } = createSkyTexture();
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  let envTarget = null;
  let cloudiness = THREE.MathUtils.clamp(
    cfg.defaultCloudiness,
    cfg.minimumCloudiness,
    cfg.maximumCloudiness,
  );
  let elapsed = 0;
  let paintedCloudiness = Number.NEGATIVE_INFINITY;
  let bakedCloudiness = Number.NEGATIVE_INFINITY;
  let disposed = false;

  const sunDirection = new THREE.Vector3(
    light.sunPosition.x,
    light.sunPosition.y,
    light.sunPosition.z,
  ).normalize();

  const colors = {
    sunClear: new THREE.Color(light.sunColor),
    sunOvercast: new THREE.Color(light.sunColorOvercast),
    skyClear: new THREE.Color(light.skyColor),
    skyOvercast: new THREE.Color(light.skyColorOvercast),
    groundClear: new THREE.Color(light.groundColor),
    groundOvercast: new THREE.Color(light.groundColorOvercast),
    fogClear: new THREE.Color(cfg.fogColor),
    fogOvercast: new THREE.Color(cfg.fogColorOvercast),
    topClear: new THREE.Color(cfg.skyTop),
    midHighClear: new THREE.Color(cfg.skyMidHigh),
    midClear: new THREE.Color(cfg.skyMid),
    lowerClear: new THREE.Color(cfg.skyLower),
    bottomClear: new THREE.Color(cfg.skyBottom),
    horizonClear: new THREE.Color(cfg.skyHorizon),
    horizonOvercast: new THREE.Color(cfg.skyHorizonOvercast),
    cloudTopClear: new THREE.Color(cfg.cloudTopColorClear),
    cloudTopOvercast: new THREE.Color(cfg.cloudTopColorOvercast),
    cloudUndersideClear: new THREE.Color(cfg.cloudUndersideColorClear),
    cloudUndersideOvercast: new THREE.Color(cfg.cloudUndersideColorOvercast),
  };
  const mix = new THREE.Color();
  const cloudTopColor = new THREE.Color();
  const cloudUndersideColor = new THREE.Color();
  const skySunColor = new THREE.Color();

  const cloudMaterials = {
    top: new Set(),
    underside: new Set(),
  };
  const cloudBasePositions = [];
  clouds.forEach((cloud) => {
    cloudBasePositions.push(cloud.position.clone());
    cloud.traverse((node) => {
      if (!node.material) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.filter(Boolean).forEach((material) => {
        const role = material.name === "cloud-top" ? "top" : "underside";
        cloudMaterials[role].add(material);
      });
    });
  });

  // Visible light source: a bright disc with a soft halo. Both fade out as the
  // sky fills in, which is the clearest possible read on the cloud cover.
  const sunDisc = createSunSprite({
    diameter: light.sunDiscDiameter,
    color: light.sunDiscColor,
    glow: false,
  });
  const sunGlow = createSunSprite({
    diameter: light.sunGlowDiameter,
    color: light.sunDiscColor,
    glow: true,
  });
  const sunAnchor = new THREE.Vector3()
    .copy(sunDirection)
    .multiplyScalar(light.sunDiscDistance);
  sunDisc.position.copy(sunAnchor);
  sunGlow.position.copy(sunAnchor);
  scene.add(sunGlow, sunDisc);

  scene.background = texture;

  function mixHex(clear, overcast, amount) {
    mix.copy(clear).lerp(overcast, amount);
    return `#${mix.getHexString()}`;
  }

  function paintSky(amount) {
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, mixHex(colors.topClear, colors.horizonOvercast, amount));
    gradient.addColorStop(
      0.25,
      mixHex(colors.midHighClear, colors.horizonOvercast, amount),
    );
    gradient.addColorStop(
      0.5,
      mixHex(colors.midClear, colors.horizonOvercast, amount),
    );
    gradient.addColorStop(
      0.75,
      mixHex(colors.lowerClear, colors.horizonOvercast, amount),
    );
    gradient.addColorStop(1, mixHex(colors.bottomClear, colors.horizonOvercast, amount));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const sunLongitude = Math.atan2(sunDirection.z, sunDirection.x);
    const sunLatitude = Math.asin(THREE.MathUtils.clamp(sunDirection.y, -1, 1));
    const sunX = (sunLongitude / (Math.PI * 2) + 0.5) * canvas.width;
    const sunY = (0.5 - sunLatitude / Math.PI) * canvas.height;
    const glowRadius = canvas.width * 0.42;
    const glow = ctx.createRadialGradient(
      sunX,
      sunY,
      0,
      sunX,
      sunY,
      glowRadius,
    );
    skySunColor.copy(colors.sunClear).lerp(colors.sunOvercast, amount);
    const sunGlowHex = skySunColor.getHexString();
    const sunGlowRgb = `${parseInt(sunGlowHex.slice(0, 2), 16)}, ${parseInt(
      sunGlowHex.slice(2, 4),
      16,
    )}, ${parseInt(sunGlowHex.slice(4, 6), 16)}`;
    const glowOpacity = THREE.MathUtils.lerp(0.22, 0.08, amount);
    glow.addColorStop(0, `rgba(${sunGlowRgb}, ${glowOpacity})`);
    glow.addColorStop(0.35, `rgba(${sunGlowRgb}, ${glowOpacity * 0.55})`);
    glow.addColorStop(1, `rgba(${sunGlowRgb}, 0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    texture.needsUpdate = true;
  }

  function rebuildEnvironment() {
    const next = pmrem.fromEquirectangular(texture);
    if (envTarget) envTarget.dispose();
    envTarget = next;
    scene.environment = next.texture;
  }

  function applyLighting(amount) {
    if (lights) {
      if (lights.sun) {
        lights.sun.intensity = THREE.MathUtils.lerp(
          light.sunIntensity,
          light.sunIntensityOvercast,
          amount,
        );
        lights.sun.color.copy(colors.sunClear).lerp(colors.sunOvercast, amount);
      }
      if (lights.hemisphere) {
        lights.hemisphere.intensity = THREE.MathUtils.lerp(
          light.skyLightIntensity,
          light.skyLightIntensityOvercast,
          amount,
        );
        lights.hemisphere.color.copy(colors.skyClear).lerp(colors.skyOvercast, amount);
        lights.hemisphere.groundColor
          .copy(colors.groundClear)
          .lerp(colors.groundOvercast, amount);
      }
      if (lights.fill) {
        lights.fill.intensity = THREE.MathUtils.lerp(
          light.fillIntensity,
          light.fillIntensityOvercast,
          amount,
        );
      }
      if (lights.rim) {
        lights.rim.intensity = THREE.MathUtils.lerp(
          light.rimIntensity,
          light.rimIntensityOvercast,
          amount,
        );
      }
    }

    skySunColor.copy(colors.sunClear).lerp(colors.sunOvercast, amount);
    sunDisc.material.color.copy(skySunColor);
    sunGlow.material.color.copy(skySunColor);

    if (scene.fog) {
      scene.fog.near = THREE.MathUtils.lerp(
        cfg.fogNear,
        cfg.fogNearOvercast,
        amount,
      );
      scene.fog.far = THREE.MathUtils.lerp(cfg.fogFar, cfg.fogFarOvercast, amount);
      scene.fog.color.copy(colors.fogClear).lerp(colors.fogOvercast, amount);
    }

    scene.environmentIntensity = THREE.MathUtils.lerp(
      light.environmentIntensity,
      light.environmentIntensityOvercast,
      amount,
    );
    if (renderer) {
      renderer.toneMappingExposure = THREE.MathUtils.lerp(
        light.daylightExposure,
        light.daylightExposureOvercast,
        amount,
      );
    }

    const cloudOpacity = THREE.MathUtils.lerp(
      cfg.cloudOpacityClear,
      cfg.cloudOpacityOvercast,
      amount,
    );
    cloudTopColor.copy(colors.cloudTopClear).lerp(colors.cloudTopOvercast, amount);
    cloudUndersideColor
      .copy(colors.cloudUndersideClear)
      .lerp(colors.cloudUndersideOvercast, amount);
    cloudMaterials.top.forEach((material) => {
      material.opacity = cloudOpacity;
      material.color.copy(cloudTopColor);
    });
    cloudMaterials.underside.forEach((material) => {
      material.opacity = cloudOpacity;
      material.color.copy(cloudUndersideColor);
    });
  }

  function driftClouds(amount) {
    const scale = THREE.MathUtils.lerp(
      cfg.cloudScaleClear,
      cfg.cloudScaleOvercast,
      amount,
    );
    clouds.forEach((cloud, index) => {
      const base = cloudBasePositions[index];
      if (!base) return;
      const phase = elapsed * cfg.cloudDriftSpeed * 0.02 + index * 1.7;
      cloud.position.x = base.x + Math.sin(phase) * 4;
      cloud.position.z = base.z + Math.cos(phase * 0.8) * 4;
      cloud.scale.setScalar(scale);
    });
  }

  function updateSun(focus) {
    const visibility = Math.pow(Math.max(0, 1 - cloudiness), 1.6);
    sunDisc.material.opacity = visibility;
    sunGlow.material.opacity = visibility * 0.7;

    if (!focus) return;
    sunDisc.position
      .copy(focus)
      .addScaledVector(sunDirection, light.sunDiscDistance);
    sunGlow.position.copy(sunDisc.position);

    if (!lights?.sun) return;
    lights.sun.position
      .copy(focus)
      .addScaledVector(sunDirection, light.sunDistance);
    lights.sun.target.position.copy(focus);
    lights.sun.target.updateMatrixWorld();
  }

  function update(dt, focus) {
    if (disposed) return;
    const step = Math.max(dt, 0);
    elapsed += step;

    const phase =
      ((cfg.startPhase || 0) + elapsed / Math.max(cfg.cycleSeconds, 1)) % 1;
    const wave = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
    const target = THREE.MathUtils.clamp(
      cfg.minimumCloudiness +
        (cfg.maximumCloudiness - cfg.minimumCloudiness) * wave,
      cfg.minimumCloudiness,
      cfg.maximumCloudiness,
    );

    // Temporal smoothing: ease the applied value toward the target so the light
    // rig glides continuously instead of tracking the wave frame-for-frame.
    const tau = Math.max(cfg.smoothingSeconds || 0, 0.0001);
    cloudiness += (target - cloudiness) * (1 - Math.exp(-step / tau));

    applyLighting(cloudiness);
    driftClouds(cloudiness);
    updateSun(focus);

    if (Math.abs(cloudiness - paintedCloudiness) >= SKY_PAINT_STEP) {
      paintSky(cloudiness);
      paintedCloudiness = cloudiness;
    }
    if (Math.abs(cloudiness - bakedCloudiness) >= ENV_BAKE_STEP) {
      rebuildEnvironment();
      bakedCloudiness = cloudiness;
    }
  }

  function setCloudiness(value) {
    cloudiness = THREE.MathUtils.clamp(
      value,
      cfg.minimumCloudiness,
      cfg.maximumCloudiness,
    );
    applyLighting(cloudiness);
    paintSky(cloudiness);
    rebuildEnvironment();
    paintedCloudiness = cloudiness;
    bakedCloudiness = cloudiness;
  }

  function getCloudiness() {
    return cloudiness;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (envTarget) envTarget.dispose();
    pmrem.dispose();
    texture.dispose();
    [sunDisc, sunGlow].forEach((sprite) => {
      scene.remove(sprite);
      sprite.material.map?.dispose();
      sprite.material.dispose();
    });
    if (scene.background === texture) scene.background = null;
    if (scene.environment === envTarget?.texture) scene.environment = null;
  }

  paintSky(cloudiness);
  rebuildEnvironment();
  applyLighting(cloudiness);
  paintedCloudiness = cloudiness;
  bakedCloudiness = cloudiness;

  return { update, setCloudiness, getCloudiness, dispose };
}

function createSunSprite({ diameter, color, glow }) {
  const texture = createRadialTexture(glow);
  const material = new THREE.SpriteMaterial({
    map: texture,
    color,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.setScalar(diameter);
  sprite.renderOrder = -1;
  return sprite;
}

function createRadialTexture(glow) {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  if (glow) {
    gradient.addColorStop(0, "rgba(255,255,255,0.32)");
    gradient.addColorStop(0.25, "rgba(255,255,255,0.2)");
    gradient.addColorStop(0.6, "rgba(255,255,255,0.08)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
  } else {
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.35, "rgba(255,255,255,0.95)");
    gradient.addColorStop(0.7, "rgba(255,255,255,0.25)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createSkyTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = EQUIRECT;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return { canvas, ctx, texture };
}
