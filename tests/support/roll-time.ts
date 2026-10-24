/**
 * How long a roll-out takes, as opposed to how far it goes.
 *
 * `src/geometry/shot.ts` answers distances, because distances are what aiming
 * and power need. Times are only ever asserted about — the cloth presets are
 * calibrated against a table length of free roll in 4.7 / 4.0 / 3.4 seconds,
 * and `README.md` invites the reader to check that against a real table with a
 * stopwatch. So the formula lives here rather than in `src`.
 *
 * It lives in ONE place because it is piecewise: `TERMINAL_ROLL_SPEED` splits
 * the roll phase in two, and three test files quietly copying the single-rate
 * version would each go stale on their own schedule — exactly the failure
 * `CLAUDE.md` warns about for coupled calibration. (It was split in three while
 * a fast step sat at the other end; that step has gone.)
 */

import {
  GRAVITY,
  SLIDING_FRICTION,
  TERMINAL_ROLL_BOOST,
  TERMINAL_ROLL_SPEED,
} from '../../src/constants';
import { rollPhaseDistance, speedForStoppingDistance } from '../../src/geometry/shot';

/** Seconds for a ball already rolling at `speed` to come to a stop. */
export function rollSeconds(speed: number, rollingFriction: number): number {
  const decel = rollingFriction * GRAVITY;
  let seconds = 0;
  let left = speed;
  if (left > TERMINAL_ROLL_SPEED) {
    seconds += (left - TERMINAL_ROLL_SPEED) / decel;
    left = TERMINAL_ROLL_SPEED;
  }
  return seconds + left / (TERMINAL_ROLL_BOOST * decel);
}

/** Seconds for a struck ball to cover `distance` and die exactly at the end. */
export function rollOutSeconds(distance: number, rollingFriction: number): number {
  const launch = speedForStoppingDistance(distance, rollingFriction);
  const slide = launch / (3.5 * SLIDING_FRICTION * GRAVITY);
  return slide + rollSeconds((5 * launch) / 7, rollingFriction);
}

/**
 * How long the last `speed` of a rolling ball lasts, and how far it drifts.
 *
 * The distance is `src/geometry/shot.ts`'s own roll phase, not a second copy of
 * it — only the *time* is missing from `src`, and only the time is derived here.
 */
export function terminalDrift(
  speed: number,
  rollingFriction: number,
): { seconds: number; metres: number } {
  return {
    seconds: rollSeconds(speed, rollingFriction),
    metres: rollPhaseDistance(speed, rollingFriction),
  };
}
