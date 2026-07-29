/**
 * The figures quoted in prose.
 *
 * `CLAUDE.md`: a measured number in a comment or in the README is a claim
 * someone can check. These are those claims, checked — so that when a constant
 * moves, the sentence describing it fails rather than quietly going stale.
 * Every number asserted here appears verbatim somewhere in `src/constants.ts`,
 * `README.md` or `CLAUDE.md`.
 */

import { describe, expect, test } from 'vitest';
import {
  MAX_CUE_SPEED,
  MIN_CUE_SPEED,
  POWER_CURVE_EXPONENT,
  ROLLING_FRICTION,
  clothRollingFriction,
} from '../src/constants';
import { cueSpeedForPower, recommendedPower } from '../src/game/power';
import { analyseShot } from '../src/geometry/shot';
import { BALL_RADIUS, PLAY_LENGTH, pocketById } from '../src/geometry/table';
import { normalize, scale, sub, vec } from '../src/geometry/vec2';
import { rollOutSeconds, terminalDrift } from './support/roll-time';

const linearMeter = (speed: number): number =>
  (speed - MIN_CUE_SPEED) / (MAX_CUE_SPEED - MIN_CUE_SPEED);

describe('the cloth timings quoted for each preset', () => {
  test('a table length of free roll takes 4.7, 4.0 and 3.4 seconds', () => {
    expect(rollOutSeconds(PLAY_LENGTH, clothRollingFriction('fast'))).toBeCloseTo(4.7, 1);
    expect(rollOutSeconds(PLAY_LENGTH, clothRollingFriction('normal'))).toBeCloseTo(4.0, 1);
    expect(rollOutSeconds(PLAY_LENGTH, clothRollingFriction('slow'))).toBeCloseTo(3.4, 1);
  });

  test('down the table and back takes 5.7 seconds on normal cloth', () => {
    expect(rollOutSeconds(2 * PLAY_LENGTH, ROLLING_FRICTION)).toBeCloseTo(5.7, 1);
  });

  /**
   * The published 0.005-0.015 band, at Alciatore's measured 0.01. This is the
   * number this repo departs from, and the size of the departure is the whole
   * argument for departing.
   *
   * The comparison is not quite like for like and the prose says so: the
   * terminal knee applies on both sides, and the published model has no knee at
   * all. Taking it out of the published side would widen the gap, not close it.
   */
  test('at the published 0.01 both take about 1.45x as long', () => {
    expect(rollOutSeconds(PLAY_LENGTH, 0.01)).toBeCloseTo(5.8, 1);
    expect(rollOutSeconds(2 * PLAY_LENGTH, 0.01)).toBeCloseTo(8.4, 1);
  });

  test('and the ball takes far longer to die at the end of its roll', () => {
    const published = terminalDrift(0.2, 0.01);
    expect(published.seconds).toBeCloseTo(1.4, 1);
    expect(published.metres).toBeCloseTo(0.17, 2);

    const here = terminalDrift(0.2, ROLLING_FRICTION);
    expect(here.seconds).toBeCloseTo(0.65, 2);
    expect(here.metres).toBeCloseTo(0.076, 3);
  });
});

describe('the power meter', () => {
  /**
   * Straight-in, laid out backwards from a corner pocket so it fits on a
   * 7-foot table. `potDistance` is object ball to pocket centre, `cueDistance`
   * cue ball to ghost ball — the two numbers the levels are specified in.
   */
  function shot(potDistance: number, cueDistance: number): ReturnType<typeof analyseShot> {
    const pocket = pocketById('top-right');
    const toPocket = normalize(vec(2, 1));
    const object = sub(pocket.center, scale(toPocket, potDistance));
    const ghost = sub(object, scale(toPocket, 2 * BALL_RADIUS));
    return analyseShot({
      cue: sub(ghost, scale(toPocket, cueDistance)),
      object,
      pocket,
      obstacles: [],
    });
  }

  const strokeFor = (analysis: ReturnType<typeof analyseShot>): number =>
    cueSpeedForPower(recommendedPower(analysis, ROLLING_FRICTION)!);

  /** 0.6 m to the pocket, 0.5 m of cue-ball travel — POWER_CURVE_EXPONENT's shot. */
  const typical = shot(0.6, 0.5);
  /** Level 6's longest: 1.4 m to the pocket, from the far end of its range. */
  const longest = shot(1.4, 1.5);

  test('the layouts are the ones the prose says they are', () => {
    expect(typical.cueToGhost).toBeCloseTo(0.5, 2);
    expect(typical.objectToPocket).toBeCloseTo(0.6, 2);
    expect(longest.cueToGhost).toBeCloseTo(1.5, 2);
    expect(longest.objectToPocket).toBeCloseTo(1.4, 2);
  });

  test('an ordinary pot is a 1.22 m/s stroke, the longest one 1.93', () => {
    expect(strokeFor(typical)).toBeCloseTo(1.22, 2);
    expect(strokeFor(longest)).toBeCloseTo(1.93, 2);
  });

  test('which a linear bar would crush into its bottom quarter, at 21% and 38%', () => {
    expect(linearMeter(strokeFor(typical))).toBeCloseTo(0.21, 2);
    expect(linearMeter(strokeFor(longest))).toBeCloseTo(0.38, 2);
  });

  /**
   * And why the range itself stays: the thin cuts at the top of the curriculum
   * genuinely want three quarters of it, so only the shape is wrong.
   */
  test('but a thin cut wants 3.5 m/s, which is 76% of one', () => {
    expect(linearMeter(3.5)).toBeCloseTo(0.76, 2);
  });

  test('the curve moves the same two shots to 40% and 57%', () => {
    expect(recommendedPower(typical, ROLLING_FRICTION)!).toBeCloseTo(0.4, 2);
    expect(recommendedPower(longest, ROLLING_FRICTION)!).toBeCloseTo(0.57, 2);
  });

  /**
   * The exponent is not chosen, it is solved for: power^n = the typical pot's
   * fraction of the linear range, at power = 0.4. So it moves with the cloth
   * AND with the contact model — the object ball's backspin raises the speed
   * the same pot asks for — and the comment on POWER_CURVE_EXPONENT names where
   * it would land if the cloth ever went back to the published value.
   */
  test('the exponent is 1.70 for this cloth and would be 2.251 at mu = 0.010', () => {
    const exponentFor = (rollingFriction: number): number => {
      const stroke = cueSpeedForPower(recommendedPower(typical, rollingFriction)!);
      return Math.log(linearMeter(stroke)) / Math.log(0.4);
    };
    expect(exponentFor(ROLLING_FRICTION)).toBeCloseTo(POWER_CURVE_EXPONENT, 1);
    expect(exponentFor(0.01)).toBeCloseTo(2.251, 3);
  });
});
