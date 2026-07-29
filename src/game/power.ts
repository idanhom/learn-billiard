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

import {
  DROP_MARGIN,
  MAX_CUE_SPEED,
  MIN_CUE_SPEED,
  NORMAL_TRANSFER,
  POWER_CURVE_EXPONENT,
  ROLLING_FRICTION,
} from '../constants';
import {
  type ShotAnalysis,
  launchSpeedFor,
  objectRollFraction,
  speedForStoppingDistance,
} from '../geometry/shot';

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
 * The meter reading that would leave the object ball dying in the pocket.
 *
 * Chains what the geometry already knows, backwards from where the ball has to
 * finish: the departure speed that dies just past the pocket, the cue-ball
 * speed at contact that produces it after the cut throws cos(theta) of it
 * away, and the launch speed that still has that left after the trip to the
 * ghost ball.
 *
 * Null when no legal stroke can do it — a cut too thin to drive the ball that
 * far — so the HUD omits the marker rather than pinning it at 100% and
 * implying a shot that is not there.
 *
 * Takes the cloth it is played on, unlike shot generation, which validates
 * against the slowest cloth on offer. This is advice for the table you are on.
 *
 * The object ball is assumed to leave the contact with the backspin a ROLLING
 * cue ball gears onto it, while the simulation resolves whatever spin the cue
 * ball actually had. On a very short shot the cue ball is still sliding, so it
 * transfers less backspin than assumed and the object ball runs slightly long.
 * That is the safe direction: `DROP_MARGIN` already aims past the pocket.
 */
export function recommendedPower(
  analysis: ShotAnalysis,
  rollingFriction: number = ROLLING_FRICTION,
): number | null {
  const transfer = NORMAL_TRANSFER * Math.cos(analysis.cutAngle);
  if (transfer <= 0) return null;

  const objectSpeed = speedForStoppingDistance(
    analysis.objectToPocket * DROP_MARGIN,
    rollingFriction,
    objectRollFraction(analysis.cutAngle),
  );
  const launch = launchSpeedFor(objectSpeed / transfer, analysis.cueToGhost, rollingFriction);
  if (!Number.isFinite(launch) || launch > MAX_CUE_SPEED) return null;
  return powerForCueSpeed(launch);
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
