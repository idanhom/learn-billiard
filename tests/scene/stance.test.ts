import { describe, expect, test } from 'vitest';
import { BALL_RADIUS } from '../../src/geometry/table';
import { STANCE_BACK, STANCE_EYE_HEIGHT, stanceFraming, trueScaleFov } from '../../src/scene/stance';

/** Degrees below level, from the stance eye, to a ball centre this far along the cue line. */
const below = (along: number) => (Math.atan((STANCE_EYE_HEIGHT - BALL_RADIUS) / along) * 180) / Math.PI;

describe('the stance view', () => {
  /** An inch of canvas is 96 CSS pixels, so this is the angle an inch subtends at 60 cm. */
  test('at true scale, the screen is a window: the angle it subtends at the eye', () => {
    expect(trueScaleFov(96, 0.6)).toBeCloseTo((2 * Math.atan(0.0127 / 0.6) * 180) / Math.PI, 9);
    expect(trueScaleFov(760, 0.6)).toBeCloseTo(19.0, 1);
  });

  test('a phone at arm’s length is true scale on an ordinary shot', () => {
    const framing = stanceFraming(750, 0.35, 0.4);
    expect(framing.trueScale).toBe(true);
    expect(framing.fov).toBeCloseTo(trueScaleFov(750, 0.35), 9);
  });

  /** A desktop window at 60 cm is too narrow for a long shot, so the view widens rather than lose a ball. */
  test('widens, rather than lose the cue ball or the object ball, when true scale is too narrow', () => {
    const framing = stanceFraming(760, 0.6, 1.2);
    expect(framing.trueScale).toBe(false);
    expect(framing.fov).toBeGreaterThan(trueScaleFov(760, 0.6));
    const cueBall = below(STANCE_BACK);
    const objectBall = below(STANCE_BACK + 1.2 + 2 * BALL_RADIUS);
    for (const ball of [cueBall, objectBall]) {
      expect(Math.abs(ball - framing.pitch)).toBeLessThan(framing.fov / 2);
    }
  });

  test('looks midway between the two balls', () => {
    const framing = stanceFraming(900, 0.5, 0.6);
    const cueBall = below(STANCE_BACK);
    const objectBall = below(STANCE_BACK + 0.6 + 2 * BALL_RADIUS);
    expect(framing.pitch).toBeCloseTo((cueBall + objectBall) / 2, 9);
  });
});
