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
  CUSHION_FRICTION,
  CUSHION_RESTITUTION,
  MAX_CUE_SPEED,
  MIN_CUE_SPEED,
  POWER_CURVE_EXPONENT,
  ROLLING_FRICTION,
  TERMINAL_ROLL_BOOST,
  TERMINAL_ROLL_SPEED,
  clothRollingFriction,
} from '../src/constants';
import { generateShot } from '../src/game/generator';
import { LEVELS } from '../src/game/levels';
import { cueSpeedForPower, recommendedPower } from '../src/game/power';
import { ShotSession } from '../src/game/shot-session';
import { analyseShot, fullness } from '../src/geometry/shot';
import { PLAY_LENGTH } from '../src/geometry/table';
import { add, len, scale, vec } from '../src/geometry/vec2';
import { type CushionImpulse, resolveCushion } from '../src/physics/collision';
import { rollOutSeconds, terminalDrift } from './support/roll-time';
import { straightShot } from './support/shots';

const linearMeter = (speed: number): number =>
  (speed - MIN_CUE_SPEED) / (MAX_CUE_SPEED - MIN_CUE_SPEED);

describe('the cloth timings quoted for each preset', () => {
  test('a table length of free roll takes 4.7, 4.0 and 3.4 seconds', () => {
    expect(rollOutSeconds(PLAY_LENGTH, clothRollingFriction('fast'))).toBeCloseTo(4.7, 1);
    expect(rollOutSeconds(PLAY_LENGTH, clothRollingFriction('normal'))).toBeCloseTo(4.0, 1);
    expect(rollOutSeconds(PLAY_LENGTH, clothRollingFriction('slow'))).toBeCloseTo(3.4, 1);
  });

  /**
   * A trip this long launches at 1.74 m/s and starts its roll at 1.25. While a
   * fast step took ten times the resistance above 1 m/s it read 5.2 s, and with
   * the step gone it reads what it did before the step existed.
   */
  test('down the table and back takes 5.75 seconds on normal cloth', () => {
    expect(rollOutSeconds(2 * PLAY_LENGTH, ROLLING_FRICTION)).toBeCloseTo(5.75, 2);
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
  test('at the published 0.01 a table length takes 5.8 s and the double trip 8.4', () => {
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

/**
 * The two numbers with no published value behind them at all. `README.md` and
 * `src/constants.ts` quote them outright, so they are claims like any other
 * and belong here.
 *
 * `tests/physics/world.test.ts` pins their BEHAVIOUR, but symbolically —
 * against whatever the constants happen to say. That is the right shape for a
 * behaviour test and the wrong shape for a quoted figure: move the knee to
 * 0.15 and every one of those still passes while the prose goes stale, which
 * is the failure this file exists to prevent.
 */
describe('the terminal knee, which is quoted but not published', () => {
  test('the terminal knee sits at 0.12 m/s, and doubles the resistance below it', () => {
    expect(TERMINAL_ROLL_SPEED).toBe(0.12);
    expect(TERMINAL_ROLL_BOOST).toBe(2);
  });
});

describe('the power meter', () => {
  const strokeFor = (analysis: ReturnType<typeof analyseShot>): number =>
    cueSpeedForPower(recommendedPower(analysis, ROLLING_FRICTION)!);

  /** 0.6 m to the pocket, 0.5 m of cue-ball travel — POWER_CURVE_EXPONENT's shot. */
  const typical = straightShot(0.6, 0.5);
  /** Level 6's longest: 1.4 m to the pocket, from the far end of its range. */
  const longest = straightShot(1.4, 1.5);

  test('the layouts are the ones the prose says they are', () => {
    expect(typical.cueToGhost).toBeCloseTo(0.5, 2);
    expect(typical.objectToPocket).toBeCloseTo(0.6, 2);
    expect(longest.cueToGhost).toBeCloseTo(1.5, 2);
    expect(longest.objectToPocket).toBeCloseTo(1.4, 2);
  });

  /**
   * The long one's cue ball has to arrive rolling at 1.2 m/s after a 1.5 m
   * run-up. While a fast step took ten times the resistance above 1 m/s, most of
   * that run-up was paid at the boosted rate and it asked 2.75 m/s.
   */
  test('an ordinary pot is a 1.22 m/s stroke, the longest one 1.93', () => {
    expect(strokeFor(typical)).toBeCloseTo(1.22, 2);
    expect(strokeFor(longest)).toBeCloseTo(1.93, 2);
  });

  test('which a linear bar would put at 21% and 38%', () => {
    expect(linearMeter(strokeFor(typical))).toBeCloseTo(0.21, 2);
    expect(linearMeter(strokeFor(longest))).toBeCloseTo(0.38, 2);
  });

  /**
   * And why the range itself stays: the thin cuts at the top of the curriculum
   * genuinely want most of it, so only the shape is wrong. Built as an analysis
   * rather than laid out on the table, because the recommendation reads only
   * the cut and the two distances.
   */
  test('but an 80 degree cut with 0.4 m to the pocket wants 3.86 m/s, 85% of one', () => {
    const cut = (80 * Math.PI) / 180;
    const thin: ReturnType<typeof analyseShot> = {
      ...typical,
      cutAngle: cut,
      cutSide: 'left',
      fullness: fullness(cut),
      objectToPocket: 0.4,
      cueToGhost: 0.5,
    };
    expect(strokeFor(thin)).toBeCloseTo(3.86, 2);
    expect(linearMeter(strokeFor(thin))).toBeCloseTo(0.85, 2);
  });

  test('the curve moves the same two shots to 40% and 57%', () => {
    expect(recommendedPower(typical, ROLLING_FRICTION)!).toBeCloseTo(0.4, 2);
    expect(recommendedPower(longest, ROLLING_FRICTION)!).toBeCloseTo(0.57, 2);
  });

  /**
   * The spread the README quotes, over the same seeded layouts
   * `tests/zz-calibration.test.ts` prints it from: what each level asks of the
   * meter, on normal cloth.
   */
  test('levels ask 32% to 91% of the meter, the median climbing 38/40/44/50/64%', () => {
    const asked = LEVELS.slice(0, 5).map((level) =>
      Array.from({ length: 200 }, (_, seed) => {
        const { layout } = generateShot(level, 50_000 + seed * 7919, {
          preferredSide: seed % 2 === 0 ? 'left' : 'right',
        });
        return new ShotSession(layout).recommendedPower!;
      }).sort((a, b) => a - b),
    );
    const median = (sorted: number[]): number => (sorted[99]! + sorted[100]!) / 2;
    expect(asked.map(median).map((p) => Math.round(p * 100))).toEqual([38, 40, 44, 50, 64]);
    expect(Math.round(asked[0]![0]! * 100)).toBe(32);
    expect(Math.round(asked[4]![199]! * 100)).toBe(91);
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
    // To two decimals, because the sentence quotes two. At precision 1 this
    // tolerates 1.65-1.75 and the constant could drift out from under the prose
    // without failing, which is the one thing this file exists to stop.
    expect(exponentFor(ROLLING_FRICTION)).toBeCloseTo(POWER_CURVE_EXPONENT, 2);
    expect(exponentFor(0.01)).toBeCloseTo(2.251, 3);
  });
});

/**
 * The cushion, quoted in `README.md` and `src/constants.ts` beside the
 * measurements it is fitted to (Alciatore, HSV B.15: 0.72 and 0.52 rolling,
 * 0.58 and 0.54 stun). These are the model's side of that comparison, square
 * hits through the impulse itself. The angle fit is
 * `tests/physics/world.test.ts`'s.
 */
describe('the cushion', () => {
  test('restitution 0.74 and friction 0.23, the fitted pair', () => {
    expect(CUSHION_RESTITUTION).toBe(0.74);
    expect(CUSHION_FRICTION).toBe(0.23);
  });

  test('a rolling ball comes off at 0.71 and settles at 0.48, a stun ball 0.63 and 0.51', () => {
    const inbound = vec(0, 1);
    const square = (roll: typeof inbound): CushionImpulse => resolveCushion(inbound, roll, vec(0, -1))!;
    const settled = (out: CushionImpulse): number => len(add(scale(out.vel, 5 / 7), scale(out.roll, 2 / 7)));
    const rolling = square(inbound);
    const stun = square(vec(0, 0));
    expect(len(rolling.vel)).toBeCloseTo(0.71, 2);
    expect(settled(rolling)).toBeCloseTo(0.48, 2);
    expect(len(stun.vel)).toBeCloseTo(0.63, 2);
    expect(settled(stun)).toBeCloseTo(0.51, 2);
  });
});
