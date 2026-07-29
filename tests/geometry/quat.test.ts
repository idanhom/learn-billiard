import { describe, expect, test } from 'vitest';
import { GRAVITY, SLIDING_FRICTION } from '../../src/constants';
import {
  IDENTITY,
  type Quat,
  angleBetween,
  multiply,
  rotateVec3,
  spinBy,
} from '../../src/geometry/quat';
import { BALL_RADIUS } from '../../src/geometry/table';
import { vec } from '../../src/geometry/vec2';

type Vec3 = [number, number, number];

function fromAxisAngle(axis: Vec3, angle: number): Quat {
  const l = Math.hypot(axis[0], axis[1], axis[2]);
  const s = Math.sin(angle / 2) / l;
  return { x: axis[0] * s, y: axis[1] * s, z: axis[2] * s, w: Math.cos(angle / 2) };
}

const angleOf = (q: Quat): number => angleBetween(IDENTITY, q);

describe('turning a ball', () => {
  test('turns at |roll| / radius, whatever direction the roll points', () => {
    const dt = 1 / 240;
    for (const roll of [vec(1, 0), vec(0, 1), vec(-0.6, 0.8), vec(0.3, -0.4)]) {
      const expected = (Math.hypot(roll.x, roll.y) / BALL_RADIUS) * dt;
      expect(angleOf(spinBy(IDENTITY, roll, BALL_RADIUS, dt))).toBeCloseTo(expected, 12);
    }
  });

  test('a ball that is not rolling does not turn', () => {
    const q = spinBy(IDENTITY, vec(2, 3), BALL_RADIUS, 1 / 240);
    expect(spinBy(q, vec(0, 0), BALL_RADIUS, 1 / 240)).toBe(q);
  });

  /**
   * The table frame is right-handed with z out of the cloth, so the top of the
   * ball is at (0, 0, R). On a ball rolling forward the top goes forward — the
   * contact point underneath is the part that is momentarily still.
   */
  test('rolling toward +x carries the top of the ball toward +x', () => {
    const q = spinBy(IDENTITY, vec(1, 0), BALL_RADIUS, 1 / 240);
    const [x, y, z] = rotateVec3(q, [0, 0, BALL_RADIUS]);
    expect(x).toBeGreaterThan(0);
    expect(Math.abs(y)).toBeLessThan(1e-12);
    expect(z).toBeLessThan(BALL_RADIUS);
  });

  test('rolling toward +y carries the top of the ball toward +y', () => {
    const q = spinBy(IDENTITY, vec(0, 1), BALL_RADIUS, 1 / 240);
    const [x, y, z] = rotateVec3(q, [0, 0, BALL_RADIUS]);
    expect(y).toBeGreaterThan(0);
    expect(Math.abs(x)).toBeLessThan(1e-12);
    expect(z).toBeLessThan(BALL_RADIUS);
  });

  /**
   * Successive turns compose in the TABLE frame, not the ball's own. The axis
   * comes from `roll`, which is a table-plane quantity — composing on the other
   * side would spin the ball about an axis that the earlier turns had carried
   * round with it, and the ball would wander off in a direction nothing asked
   * for. Angles here are large on purpose: at small ones the two orders agree.
   */
  test('composes in the table frame, not the body frame', () => {
    const dt = 0.05;
    const rollA = vec(1.7, 0);
    const rollB = vec(0, 1.3);

    const composed = spinBy(spinBy(IDENTITY, rollA, BALL_RADIUS, dt), rollB, BALL_RADIUS, dt);

    const a = fromAxisAngle([0, 1, 0], (1.7 / BALL_RADIUS) * dt);
    const b = fromAxisAngle([-1, 0, 0], (1.3 / BALL_RADIUS) * dt);
    expect(angleBetween(composed, multiply(b, a))).toBeLessThan(1e-12);
    expect(angleBetween(composed, multiply(a, b))).toBeGreaterThan(0.1);
  });
});

/**
 * The one test that must never regress.
 *
 * A struck ball leaves the tip sliding: all velocity, no roll. It covers ground
 * while it is barely turning, and only once the cloth has spun it up do the two
 * lock together. Drive the orientation off the distance travelled instead and
 * the ball turns 2.4x too much over that first half metre — which is the
 * difference between a ball that skids and catches and a ball that was never
 * sliding at all.
 */
describe('the skid off the cue tip', () => {
  test('a 2 m/s launch turns 2.40x less than its travel would imply', () => {
    const launch = 2;
    const decel = SLIDING_FRICTION * GRAVITY;
    const spinUp = 2.5 * SLIDING_FRICTION * GRAVITY;
    const slideTime = launch / (3.5 * SLIDING_FRICTION * GRAVITY);

    const steps = 20000;
    const dt = slideTime / steps;
    let q = IDENTITY;
    let turned = 0;
    let travelled = 0;
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) * dt;
      travelled += (launch - decel * t) * dt;
      const next = spinBy(q, vec(spinUp * t, 0), BALL_RADIUS, dt);
      turned += angleBetween(q, next);
      q = next;
    }

    // The slide is 0.2912 s long and 0.4993 m of it, turning the ball 7.2803
    // rad. Off its travel alone it would be 17.4727 — and the 2.4 is exact:
    // distance is (6/24.5)*v0^2/(mu*g) and the arc is (2.5/24.5) of the same.
    expect(slideTime).toBeCloseTo(0.29125, 5);
    expect(travelled).toBeCloseTo(0.4993, 4);
    expect(turned).toBeCloseTo(7.2803, 4);
    expect(travelled / BALL_RADIUS).toBeCloseTo(17.4727, 4);
    expect(travelled / BALL_RADIUS / turned).toBeCloseTo(2.4, 6);
  });
});
