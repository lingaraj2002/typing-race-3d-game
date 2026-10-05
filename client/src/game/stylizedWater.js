import * as THREE from "three";
import { RACE_CONFIG } from "./raceConfig.js";

// ─── Wave Table ───────────────────────────────────────────────────────────────
//
// The entire animated pattern is one table of long, slow, non-parallel layers.
// A layer is a direction, a wavelength, an amplitude and a speed, baked into a
// GLSL const block at material creation, so the shader stays a handful of sines.
//
// Long wavelengths are the point. Broad sweeping curves read as painted cartoon
// waves; short wavelengths and fine noise are what make procedural water look
// photographic.

const TAU = Math.PI * 2;

const BAND_WAVES = [
  { direction: 0.42, wavelength: 132, amplitude: 1.0, speed: 0.3 },
  { direction: 1.72, wavelength: 78, amplitude: 0.55, speed: 0.44 },
  { direction: -0.62, wavelength: 46, amplitude: 0.26, speed: 0.62 },
];

const f = (value) => value.toFixed(5);

/** `const` declarations for the band table. */
function waveConstants(waves) {
  return waves
    .map((wave, i) => {
      const dirX = Math.cos(wave.direction);
      const dirZ = Math.sin(wave.direction);
      return [
        `  // ${i}: ${wave.wavelength} units, direction ${wave.direction} rad`,
        `  const vec2 W${i}_DIR = vec2(${f(dirX)}, ${f(dirZ)});`,
        `  const float W${i}_K = ${f(TAU / wave.wavelength)};`,
        `  const float W${i}_AMP = ${f(wave.amplitude)};`,
        `  const float W${i}_SPEED = ${f(wave.speed)};`,
      ].join("\n");
    })
    .join("\n");
}

/**
 * Unrolled band accumulation. Each layer adds one sine into `bands`, scaled by
 * `gain` so the caller can fade the whole pattern out with distance in a single
 * multiply. No derivatives are taken anywhere: the surface is flat, so there is
 * no normal to reconstruct and nothing to keep in sync.
 */
function bandBody(waves, { gain = "", phaseOffset = "" } = {}) {
  return waves
    .map(
      (_, i) => `  bands += W${i}_AMP * ${gain} * sin(W${i}_K * dot(W${i}_DIR, world.xz)${phaseOffset} - W${i}_SPEED * uBandSpeed * uTime);`,
    )
    .join("\n");
}

// ─── Shaders ──────────────────────────────────────────────────────────────────

/**
 * The sea surface: flat, world-space, and shared by both sea meshes.
 *
 * Nothing is displaced. The water is a plane and all of its character comes from
 * the colour bands in the fragment shader, which is what keeps the surface
 * visually flat, keeps the waterline exactly where the geometry puts it, and
 * costs one varyingly cheap vertex shader. Both meshes sample the same world
 * position, so the join between the shallow disc and the deep skirt matches
 * colour for colour.
 */
const VERTEX_SHADER = /* glsl */ `
uniform vec4 uShore;

varying vec3 vWorldPosition;
varying float vOffshore;

#include <fog_pars_vertex>

void main() {
  vec3 world = (modelMatrix * vec4(position, 1.0)).xyz;

  // Distance out from the beach, in beach radii: 1 sits on the sand, 2 is far
  // offshore. The fragment shader uses this to run the bands parallel to the
  // shore, to tint the shallows, and to deepen the water offshore.
  vOffshore = length((world.xz - uShore.xy) / uShore.zw);
  vWorldPosition = world;

  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  #include <fog_vertex>
}
`;

/**
 * Cartoon ocean shading.
 *
 * The surface is a four-stop ramp of blues and cyans driven by one broad band
 * field, plus a low-frequency drift that curves the bands, a pale shallow tint
 * along the sand and a gentle deepening offshore.
 *
 * What is deliberately absent is the list of things that make water look real:
 * no specular, no fresnel rim, no reflection, no transparency, no refraction, no
 * caustics, no foam, no normals and no geometry displacement. The bands blend
 * softly between neighbouring shades, so the result is painted rather than
 * glossy, and the only animation is the bands sliding slowly across the surface.
 */
const FRAGMENT_SHADER = /* glsl */ `
uniform float uTime;
uniform vec3 uColorDeep;
uniform vec3 uColorMid;
uniform vec3 uColorShallow;
uniform vec3 uColorHighlight;
uniform float uBandGain;
uniform float uBandSpeed;
uniform float uRadialGain;
uniform float uRadialFrequency;
uniform float uRadialSpeed;
uniform float uNoiseAmount;
uniform float uNoiseScale;
uniform float uNoiseDrift;
uniform float uShoreTint;
uniform float uShoreTintEnd;
uniform float uDepthStrength;
uniform float uDepthStart;
uniform float uDepthEnd;
uniform float uDetailFadeStart;
uniform float uDetailFadeEnd;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform float uFlatLight;

varying vec3 vWorldPosition;
varying float vOffshore;

#include <fog_pars_fragment>

${waveConstants(BAND_WAVES)}

// Hash-based value noise, four corner taps. Single octave on purpose: a second
// octave would add the speckle that reads as photographic noise. Used only to
// curve the band shapes, never to shade.
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z) * 2.0 - 1.0;
}

float valueNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 local = fract(p);
  vec2 blend = local * local * (3.0 - 2.0 * local);
  float a = hash21(cell);
  float b = hash21(cell + vec2(1.0, 0.0));
  float c = hash21(cell + vec2(0.0, 1.0));
  float d = hash21(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
}

void main() {
  vec3 world = vWorldPosition;
  float viewDistance = length(cameraPosition - world);

  // One slow, very low frequency drift. It is what turns a set of straight
  // sines into long curved strokes instead of a grid.
  float drift = uTime * uNoiseDrift;
  float warp =
    valueNoise(world.xz * uNoiseScale + vec2(drift, -drift * 0.6)) * uNoiseAmount;

  // Fade the bands out with distance. Past the fade the sea is one flat tone,
  // which is both cheaper and closer to how a painted horizon looks.
  float detail = 1.0 - smoothstep(uDetailFadeStart, uDetailFadeEnd, viewDistance);

  float bands = 0.0;
${bandBody(BAND_WAVES, { gain: "detail", phaseOffset: " + warp" })}

  // Rings running parallel to the beach, so the water reads as water next to the
  // sand instead of as an arbitrary pattern, and so the pattern carries on
  // unchanged across the join with the deep skirt.
  bands +=
    uRadialGain * detail *
    sin(vOffshore * uRadialFrequency + warp - uRadialSpeed * uBandSpeed * uTime);

  // One value drives the whole ramp: 0 in the troughs, 1 on the crests.
  float t = clamp((bands + warp) * uBandGain * 0.5 + 0.5, 0.0, 1.0);
  t = mix(0.5, t, detail);

  // Four neighbouring shades of blue and cyan, blended with wide soft steps.
  // The stops straddle 0.5 so the mid blue is what the sea mostly is, and the
  // lighter shades only ride the crests. The narrow value range is what keeps
  // this looking painted instead of shaded.
  vec3 color = uColorDeep;
  color = mix(color, uColorMid, smoothstep(0.26, 0.5, t));
  color = mix(color, uColorShallow, smoothstep(0.5, 0.72, t));
  color = mix(color, uColorHighlight, smoothstep(0.72, 0.92, t));

  // Pale shallows along the sand: a simple tint, no foam line and no spray.
  color = mix(
    color,
    uColorHighlight,
    (1.0 - smoothstep(1.0, uShoreTintEnd, vOffshore)) * uShoreTint
  );

  // Gentle deepening as the sea floor drops away. The deep skirt sits entirely
  // inside this ramp, at the same value as the disc's outer edge, so the join
  // between the two meshes stays invisible.
  color = mix(
    color,
    uColorDeep,
    smoothstep(uDepthStart, uDepthEnd, vOffshore) * uDepthStrength
  );

  // The surface is flat, so its lighting is one constant. Sun and sky colour are
  // copied off the race light rig on the CPU each frame, which keeps the sea in
  // step with the climate without costing anything per pixel.
  color *= uSkyColor + uSunColor * uFlatLight;

  gl_FragColor = vec4(color, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

// ─── Water Surface ────────────────────────────────────────────────────────────

/**
 * Creates the sea ShaderMaterial plus the tiny controller that feeds it.
 *
 * One material serves both sea meshes, so they share a single program and a
 * single set of uniforms. Pass the race light rig to keep the water in step with
 * the looping climate: the sun and sky colours are copied straight off those
 * lights each update, so the sea washes out under overcast exactly like the
 * beach does, without the climate knowing it exists.
 *
 * @param {object} options
 * @param {object} options.layout World layout; supplies the shore ellipse the
 *   bands and the depth ramp are measured against.
 * @param {object} [options.lights] Light rig from addRaceLighting(scene).
 * @returns {{ material: THREE.ShaderMaterial, update: (dt: number) => void }}
 */
export function createStylizedWater({ layout, lights = null } = {}) {
  const cfg = RACE_CONFIG.water;
  const palette = RACE_CONFIG.palette;

  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uColorDeep: { value: new THREE.Color(palette.waterDeep) },
      uColorMid: { value: new THREE.Color(palette.waterMid) },
      uColorShallow: { value: new THREE.Color(palette.waterShallow) },
      uColorHighlight: { value: new THREE.Color(palette.waterHighlight) },
      uBandGain: { value: cfg.bandGain },
      uBandSpeed: { value: cfg.bandSpeed },
      uRadialGain: { value: cfg.radialGain },
      uRadialFrequency: { value: cfg.radialFrequency },
      uRadialSpeed: { value: cfg.radialSpeed },
      uNoiseAmount: { value: cfg.noiseAmount },
      uNoiseScale: { value: cfg.noiseScale },
      uNoiseDrift: { value: cfg.noiseDrift },
      uShoreTint: { value: cfg.shoreTint },
      uShoreTintEnd: { value: cfg.shoreTintEnd },
      uDepthStrength: { value: cfg.depthStrength },
      uDepthStart: { value: cfg.depthStart },
      uDepthEnd: { value: cfg.depthEnd },
      uDetailFadeStart: { value: cfg.detailFadeStart },
      uDetailFadeEnd: { value: cfg.detailFadeEnd },
      // Pre-scaled light colours: the shader adds them straight into the
      // surface, so the strengths are folded in here. Seeded from the rig's
      // clear-daylight defaults so the water still reads correctly if no light
      // rig is supplied.
      uSunColor: {
        value: new THREE.Color(RACE_CONFIG.lighting.sunColor).multiplyScalar(
          RACE_CONFIG.lighting.sunIntensity * cfg.sunStrength,
        ),
      },
      uSkyColor: {
        value: new THREE.Color(RACE_CONFIG.lighting.skyColor).multiplyScalar(
          RACE_CONFIG.lighting.skyLightIntensity * cfg.ambientStrength,
        ),
      },
      // Lambert term for a flat, upward-facing surface.
      uFlatLight: { value: 0.65 },
      uShore: {
        value: new THREE.Vector4(
          layout.centerX,
          layout.centerZ,
          layout.beachOuterRadiusX,
          layout.beachOuterRadiusZ,
        ),
      },
    },
  ]);

  const material = new THREE.ShaderMaterial({
    name: "stylized-water",
    uniforms,
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    // The shader does its own lighting, and takes the scene fog through the
    // standard chunks so the sea still melts into the horizon.
    fog: true,
  });

  const sunDirection = new THREE.Vector3();

  /**
   * Advance the band clock and re-read the light rig. Called from the existing
   * render loop with the same clamped frame delta everything else uses, so a
   * stalled tab cannot make the bands jump.
   */
  function update(dt) {
    uniforms.uTime.value += Math.max(dt, 0);

    if (lights?.sun) {
      sunDirection
        .copy(lights.sun.position)
        .sub(lights.sun.target.position)
        .normalize();
      // A flat surface only ever sees the vertical component of the sun.
      uniforms.uFlatLight.value = Math.max(sunDirection.y, 0);
      uniforms.uSunColor.value
        .copy(lights.sun.color)
        .multiplyScalar(lights.sun.intensity * cfg.sunStrength);
    }
    if (lights?.hemisphere) {
      uniforms.uSkyColor.value
        .copy(lights.hemisphere.color)
        .multiplyScalar(lights.hemisphere.intensity * cfg.ambientStrength);
    }
  }

  return { material, update };
}
