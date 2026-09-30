/**
 * Car variant catalogue.
 *
 * One GLB is shared by every car in the game, so a "variant" is nothing more
 * than a data description of how that one model should be dressed: its paint,
 * how its proportions differ from the export, and any parts bolted on at
 * runtime. Nothing in this module touches Three.js, so adding a fifth car is a
 * data change plus one more key in CAR_VARIANT_KEYS.
 *
 * Units and axes (measured from vehicle_car.glb, which is authored in
 * centimetres and faces +Z):
 *   scale        multiplies the game's RACE_CONFIG.vehicle.*Scale
 *   bodyScale    stretches the body mesh only, about the car's ground centre
 *   wheelScale   grows the wheels about their axles; the rig lifts each wheel
 *                so the tyre still touches the road
 *   wheelOutset  widens the track in centimetres per side
 *   extras       simple runtime geometry (rear wing / roof sign)
 */

const NEUTRAL_SCALE = Object.freeze({ x: 1, y: 1, z: 1 });

export const CAR_VARIANTS = Object.freeze({
  // Low, wide and long: the sharpest nose of the four, but still road legal.
  sports: Object.freeze({
    type: "sports",
    label: "Sports",
    color: 0xe30613,
    wheelColor: 0x3a3d43,
    metalness: 0.75,
    roughness: 0.22,
    scale: 1,
    bodyScale: Object.freeze({ x: 1.02, y: 0.94, z: 1.06 }),
    wheelScale: 1.04,
    wheelOutset: 2,
    extras: null,
  }),

  // The widest and tallest shell: flared arches over big rubber, flat black
  // paint that leans on the sky reflection to stay readable.
  muscle: Object.freeze({
    type: "muscle",
    label: "Muscle",
    color: 0x111111,
    wheelColor: 0x33363c,
    metalness: 0.65,
    roughness: 0.3,
    scale: 1,
    bodyScale: Object.freeze({ x: 1.07, y: 1.02, z: 1.04 }),
    wheelScale: 1.08,
    wheelOutset: 5,
    extras: null,
  }),

  // Lowest roofline, widest stance, plus a rear wing to sell the shape.
  supercar: Object.freeze({
    type: "supercar",
    label: "Supercar",
    color: 0x1565c0,
    wheelColor: 0x2f3238,
    metalness: 0.85,
    roughness: 0.16,
    scale: 0.98,
    bodyScale: Object.freeze({ x: 1.05, y: 0.87, z: 1.09 }),
    wheelScale: 1.06,
    wheelOutset: 6,
    extras: Object.freeze({
      spoiler: Object.freeze({
        color: 0x14181d,
        metalness: 0.7,
        roughness: 0.3,
        height: 0.16,
        depth: 0.32,
      }),
    }),
  }),

  // Upright utility proportions, stock wheels, and a roof sign.
  taxi: Object.freeze({
    type: "taxi",
    label: "Taxi",
    color: 0xf5c400,
    wheelColor: 0x3f4249,
    metalness: 0.35,
    roughness: 0.4,
    scale: 1.02,
    bodyScale: Object.freeze({ x: 1.0, y: 1.06, z: 1.0 }),
    wheelScale: 0.98,
    wheelOutset: 0,
    extras: Object.freeze({
      roofSign: Object.freeze({
        color: 0xfff8df,
        metalness: 0.1,
        roughness: 0.55,
        width: 0.42,
        height: 0.2,
        depth: 0.26,
      }),
    }),
  }),
});

/** Grid order: slot 0 is the player's car, the rest are the opponents. */
export const CAR_VARIANT_KEYS = Object.freeze(Object.keys(CAR_VARIANTS));
export const DEFAULT_CAR_VARIANT = CAR_VARIANT_KEYS[0];

/**
 * Fills a variant config with its defaults.
 *
 * Accepts a catalogue key ("supercar"), a partial override object, or a full
 * config object, so callers can tweak a single field without restating the
 * rest. An unknown key warns and falls back to the default variant rather than
 * throwing, because a typo in a racer slot must not take the whole race down.
 */
export function resolveCarVariant(input = DEFAULT_CAR_VARIANT) {
  if (typeof input === "string") {
    const preset = CAR_VARIANTS[input];
    if (!preset) {
      console.warn(
        `[cars] unknown variant "${input}"; using "${DEFAULT_CAR_VARIANT}"`,
      );
      return CAR_VARIANTS[DEFAULT_CAR_VARIANT];
    }
    return preset;
  }
  if (!input) return CAR_VARIANTS[DEFAULT_CAR_VARIANT];

  const key = Object.keys(CAR_VARIANTS).includes(input.type)
    ? input.type
    : DEFAULT_CAR_VARIANT;
  const base = CAR_VARIANTS[key];
  const overrides = { ...input };
  delete overrides.type;

  return Object.freeze({
    ...base,
    ...overrides,
    type: key,
    bodyScale: Object.freeze({ ...NEUTRAL_SCALE, ...(overrides.bodyScale ?? {}) }),
    extras: Object.freeze({ ...(base.extras ?? {}), ...(overrides.extras ?? {}) }),
  });
}