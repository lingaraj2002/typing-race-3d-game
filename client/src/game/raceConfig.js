export const RACE_CONFIG = Object.freeze({
  laps: 3,
  wordCount: 50,
  wordLength: 5,
  baseSpeed: 30,
  minimumSpeed: 30,
  maximumSpeed: 50,
  speedStep: 2.5,
  boostLevels: 6,
  idleDelaySeconds: 2,
  idleStepIntervalSeconds: 1,
  // CPU racers all run at an intermediate level. Their pace is a fraction of
  // the player's top speed and uses the same world-distance race model, so the
  // whole field stays competitive. The small spread keeps bots from finishing
  // as a single block.
  bot: {
    paceFactors: [0.8, 0.88, 0.96],
    mistakeChance: [0.18, 0.15, 0.12],
    stumbleMultiplier: [0.5, 0.56, 0.62],
    burstVariationMin: 0.94,
    burstVariationMax: 1.06,
  },
  trackRadius: 88,
  vehicle: {
    singlePlayerScale: 1.4375,
    multiplayerScale: 0.9375,
  },
  camera: {
    heightAboveRoad: 5,
    distanceBehindVehicle: 15,
    lookAheadDistance: 14,
    lookHeightAboveRoad: 1.35,
    fieldOfViewDegrees: 60,
    boostFieldOfViewStepDegrees: 0.35,
    positionSmoothness: 8,
    rotationSmoothness: 7,
    lookTargetSmoothness: 9,
    curveLookAheadExtra: 7,
    curveTurnInAmount: 0.45,
    speedFollowDistance: 1.1,
    speedLookAheadIncrease: 1.5,
    speedHeightLift: 0.3,
    maxBankRadians: 0.02,
    fieldOfViewSmoothing: 4,
    menuFieldOfViewDegrees: 57,
    introFieldOfViewDegrees: 60,
  },
  // Coastal daylight rig. Each clear value has an overcast counterpart that the
  // looping climate blends toward as cloudiness rises.
  lighting: {
    daylightExposure: 1,
    daylightExposureOvercast: 0.88,
    sunIntensity: 1.65,
    sunIntensityOvercast: 0.0825,
    sunColor: 0xfff5e7,
    sunColorOvercast: 0xeff3f5,
    skyLightIntensity: 1.7,
    skyLightIntensityOvercast: 2.2,
    skyColor: 0xe0eef5,
    skyColorOvercast: 0xe2e6e8,
    groundColor: 0x909d80,
    groundColorOvercast: 0x9ba29a,
    fillIntensity: 0.55,
    fillIntensityOvercast: 0.26,
    fillColor: 0xc4dce2,
    rimIntensity: 0.3,
    rimIntensityOvercast: 0.05,
    rimColor: 0xfff7df,
    // Sun direction defines the light angle; the light itself is re-anchored to
    // the active race area every frame so the track stays consistently lit.
    sunPosition: { x: -65, y: 90, z: -80 },
    sunDistance: 180,
    // Visible sun disc + soft halo that fade away as cloud cover builds.
    sunDiscDistance: 700,
    sunDiscDiameter: 60,
    sunGlowDiameter: 240,
    sunDiscColor: 0xfff5e7,
    environmentIntensity: 0.65,
    environmentIntensityOvercast: 0.4,
    shadowMapSize: 1024,
    shadowNormalBias: 0.07,
    shadowBias: -0.00012,
  },
  weather: {
    defaultCloudiness: 0.2,
    minimumCloudiness: 0,
    maximumCloudiness: 1,
    // Seconds for one full clear -> overcast -> clear cycle. Short enough that
    // a single race shows the whole effect, long enough to stay gradual.
    cycleSeconds: 120,
    // Start the loop partway through the ramp so cloud cover is already
    // developing the moment the race begins instead of lingering at clear.
    startPhase: 0.08,
    // Time constant (seconds) for easing the applied cloudiness; larger values
    // make the light rig glide more slowly and evenly.
    smoothingSeconds: 1.4,
    fogNear: 220,
    fogFar: 880,
    fogNearOvercast: 45,
    fogFarOvercast: 300,
    fogColor: 0xc4dce2,
    fogColorOvercast: 0x9da8b2,
    skyTop: 0x8db7ce,
    skyMidHigh: 0xdfedf1,
    skyMid: 0xedf0e6,
    skyLower: 0xb4bda9,
    skyBottom: 0x647e65,
    skyHorizon: 0xc4dce2,
    skyHorizonOvercast: 0x9da8b2,
    cloudScaleClear: 0.9,
    cloudScaleOvercast: 2.6,
    cloudOpacityClear: 0.35,
    cloudOpacityOvercast: 1,
    cloudTopColorClear: 0xf1f3ef,
    cloudTopColorOvercast: 0xd0d8dd,
    cloudUndersideColorClear: 0xd3dfe3,
    cloudUndersideColorOvercast: 0x9caebc,
    cloudDriftSpeed: 0.8,
  },
  palette: {
    treeTrunk: 0xa48060,
    treeLeafDark: 0x5e7c62,
    treeLeafLight: 0x87a077,
    palmTrunk: 0xa48060,
    palmLeaf: 0x5e7c62,
    palmLeafLight: 0x87a077,
    rock: 0xd3c7a8,
    sand: 0xf5dda6,
    soil: 0x9c8357,
    fenceCream: 0xf9f3d9,
    darkTrim: 0x243441,
    metalRail: 0xb9d1d3,
    barnRed: 0xc76b53,
    roof: 0x46676e,
    creamWall: 0xfff7df,
    // Four neighbouring shades of blue and cyan for the sea's band ramp, dark
    // trough to pale crest. They sit close together in value on purpose: a wide
    // range would read as contrast rather than as paint.
    waterDeep: 0x2a80b4,
    waterMid: 0x2a8ec4,
    waterShallow: 0x46b0d6,
    waterHighlight: 0x7ed2e0,
  },
  // Cartoon sea surface, driven entirely by the ShaderMaterial in
  // game/stylizedWater.js. Every knob the shader exposes lives here so the water
  // can be re-tuned without touching any GLSL. The surface itself is flat: there
  // is no displacement, no normal and no specular, only this colour pattern.
  water: {
    // How far the band field swings, which decides how much of the ramp the sea
    // actually travels. Lower = broader, calmer shapes.
    bandGain: 0.4,
    // Global band speed. Every layer's drift is relative to this one value, so it
    // is the single "how fast does the sea flow" control. 0.25 slides the widest
    // band about 1.6 units per second: slow enough to stay calm, fast enough to
    // read as moving water.
    bandSpeed: 0.25,
    // Rings that run parallel to the beach, so the pattern reads as water next
    // to the sand and carries on seamlessly across the deep skirt.
    // Gain is their share of the field, frequency their spacing in beach radii
    // (6.5 puts one ring about every 100 units offshore), speed is their drift
    // relative to bandSpeed.
    radialGain: 0.7,
    radialFrequency: 5.2,
    radialSpeed: 0.4,
    // One very low frequency drift that curves the bands into long strokes
    // instead of a grid. Scale 0.006 means the shapes are ~170 units across;
    // amount is how far they bend.
    noiseAmount: 0.55,
    noiseScale: 0.006,
    noiseDrift: 0.05,
    // Pale shallow tint along the sand: a simple wash, no foam line and no
    // spray. End is the beach radius (1 sits on the sand) where it is gone.
    shoreTint: 0.35,
    shoreTintEnd: 1.4,
    // Gentle deepening as the sea floor drops away. The deep skirt sits entirely
    // past uDepthEnd, at the same value as the disc's outer edge, which is what
    // keeps the join between the two meshes invisible.
    depthStrength: 0.55,
    depthStart: 1.5,
    depthEnd: 2.5,
    // World-space distance band over which the bands fade out, so the far sea
    // becomes one flat tone instead of shimmering. These sit past the ~250 units
    // of water a player can actually see, so the pattern stays legible at the
    // real camera distance.
    detailFadeStart: 260,
    detailFadeEnd: 700,
    // The surface is flat, so its lighting is a single constant. These are how
    // much of the scene's sun and sky light the water picks up; together they
    // land the sea at roughly the same brightness as the sand in daylight.
    sunStrength: 0.42,
    ambientStrength: 0.42,
  },
  world: {
    roadHeight: 4,
    landHeight: 3.5,
    seaLevel: 0,
    trackWidth: 20,
    laneCount: 4,
    palmCount: 18,
    farmCount: 8,
    treeCount: 20,
    streetLightCount: 13,
    windmillCount: 2,
    cloudCount: 10,
  },
  presentation: {
    introDurationSeconds: 4.6,
    countdownDurationSeconds: 3.4,
    goMessageDurationSeconds: 0.85,
    hudRefreshSeconds: 0.08,
    simulationStepSeconds: 1 / 120,
    maxFrameDeltaSeconds: 0.05,
  },
});
