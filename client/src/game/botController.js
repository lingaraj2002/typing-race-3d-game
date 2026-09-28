import { RACE_CONFIG } from "./raceConfig.js";

const randomBetween = (min, max) => min + Math.random() * (max - min);

/**
 * Bots model short typing bursts, pace changes, and occasional mistakes.
 *
 * Every bot races at an intermediate level: its pace is a fraction of the
 * player's top speed and its progress is measured over the same race distance
 * as the player, so the whole field stays competitive instead of trailing far
 * behind. It never reads the player's input, so stopping or mistyping still
 * lets the field pull ahead naturally.
 */
export function createBotRacer(index = 0, raceDistance = 1) {
  const { paceFactors, mistakeChance, stumbleMultiplier } = RACE_CONFIG.bot;
  const slot = ((index % paceFactors.length) + paceFactors.length) % paceFactors.length;
  const baseSpeed = RACE_CONFIG.maximumSpeed * paceFactors[slot];

  return {
    raceDistance: Math.max(raceDistance, 1),
    baseSpeed,
    currentSpeed: baseSpeed,
    targetSpeed: baseSpeed,
    mistakeChance: mistakeChance[slot],
    stumbleMultiplier: stumbleMultiplier[slot],
    progress: 0,
    decisionTimer: randomBetween(0.35, 1),
    stumbleTimer: 0,
  };
}

export function updateBotProgress(bot, dt) {
  if (bot.progress >= 1) return bot.progress;

  bot.decisionTimer -= dt;
  bot.stumbleTimer = Math.max(0, bot.stumbleTimer - dt);

  if (bot.decisionTimer <= 0) {
    // A short "typing burst" gives each bot a human-looking pace rather than
    // a perfectly constant speed.
    const { burstVariationMin, burstVariationMax } = RACE_CONFIG.bot;
    bot.targetSpeed =
      bot.baseSpeed * randomBetween(burstVariationMin, burstVariationMax);
    bot.decisionTimer = randomBetween(0.55, 1.45);

    if (Math.random() < bot.mistakeChance) {
      bot.stumbleTimer = randomBetween(0.25, 0.7);
    }
  }

  const targetSpeed =
    bot.stumbleTimer > 0
      ? bot.targetSpeed * bot.stumbleMultiplier
      : bot.targetSpeed;
  const response = targetSpeed < bot.currentSpeed ? 7 : 4;
  bot.currentSpeed +=
    (targetSpeed - bot.currentSpeed) * Math.min(response * dt, 1);
  bot.progress = Math.min(
    bot.progress + (bot.currentSpeed / bot.raceDistance) * dt,
    1,
  );
  return bot.progress;
}
