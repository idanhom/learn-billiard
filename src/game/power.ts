/**
 * The power meter, in physical terms.
 *
 * Two jobs. First, decide what a fraction of the bar means in metres per
 * second — a curve rather than a straight line, because the range of speeds a
 * pot actually asks for is a small fraction of the range a cue can deliver,
 * and a linear meter buries all of it in the first fifth of the travel.
 *
 * Second, work out what the shot in front of the player asks for, so the HUD
 * can mark it. That number is the answer to the shot, so it is a tier-0 guide
 * and comes away with the ghost ball; the speed readout beside it is not, and
 * stays on for good.
 */

import { MAX_CUE_SPEED, MIN_CUE_SPEED, POWER_CURVE_EXPONENT, ROLLING_FRICTION } from '../constants';
import { type ShotAnalysis, recommendedLaunchSpeed } from '../geometry/shot';

/**
 * How a stroke reads out loud. The boundaries follow the published shot-speed
 * bands (roughly 1, 2, 4.5 and 8 mph) rather than dividing the meter up into
 * equal pieces, so the words mean the same thing here as they do at a table.
 */
export type SpeedBand = 'soft touch' | 'slow' | 'medium' | 'fast' | 'power';

const BANDS: readonly (readonly [number, SpeedBand])[] = [
  [0.5, 'soft touch'],
  [1, 'slow'],
  [2, 'medium'],
  [3.5, 'fast'],
];

export function speedBand(speed: number): SpeedBand {
  for (const [limit, band] of BANDS) {
    if (speed < limit) return band;
  }
  return 'power';
}

/** Launch speed for a meter reading in [0, 1]. */
export function cueSpeedForPower(power: number): number {
  return MIN_CUE_SPEED + (MAX_CUE_SPEED - MIN_CUE_SPEED) * clamp01(power) ** POWER_CURVE_EXPONENT;
}

/** Where a launch speed sits on the meter. Speeds outside the range pin to its ends. */
export function powerForCueSpeed(speed: number): number {
  const fraction = (speed - MIN_CUE_SPEED) / (MAX_CUE_SPEED - MIN_CUE_SPEED);
  return clamp01(fraction) ** (1 / POWER_CURVE_EXPONENT);
}

/**
 * The meter reading that would leave the object ball dying in the pocket: the
 * stroke `recommendedLaunchSpeed` works out, read off the meter.
 *
 * Null when no legal stroke can do it (a cut too thin to drive the ball that
 * far), so the HUD omits the marker rather than pinning it at 100% and
 * implying a shot that is not there.
 *
 * Takes the cloth it is played on, unlike shot generation, which validates
 * against the slowest cloth on offer. This is advice for the table you are on.
 */
export function recommendedPower(
  analysis: ShotAnalysis,
  rollingFriction: number = ROLLING_FRICTION,
): number | null {
  const launch = recommendedLaunchSpeed(
    analysis.cutAngle,
    analysis.objectToPocket,
    analysis.cueToGhost,
    rollingFriction,
  );
  if (launch === undefined || launch > MAX_CUE_SPEED) return null;
  return powerForCueSpeed(launch);
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
