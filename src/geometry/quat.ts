/**
 * Minimal quaternion, for ball orientation.
 *
 * Engine-neutral on purpose. Orientation is simulation state — advanced on the
 * fixed tick, in the table frame — and is only converted to a renderer
 * quaternion at the moment of drawing. That is what keeps rendering idempotent:
 * the same state always produces the same picture, at any frame rate and any
 * time scale.
 *
 * The table frame is right-handed with z out of the cloth, so a ball rolling
 * toward +x turns about +y and the top of it moves the way the ball is going.
 */

import type { Vec2 } from './vec2';

export interface Quat {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

/** Hamilton product. `multiply(a, b)` applies `b` first, then `a`. */
export function multiply(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export function conjugate(q: Quat): Quat {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

/**
 * How far apart two orientations are, in radians, in [0, pi].
 *
 * Wraps, so it measures one turn at a time — sum it per step to follow a ball
 * through more than half a revolution.
 */
export function angleBetween(a: Quat, b: Quat): number {
  const d = multiply(b, conjugate(a));
  return 2 * Math.atan2(Math.hypot(d.x, d.y, d.z), Math.abs(d.w));
}

export function normalize(q: Quat): Quat {
  const l = Math.hypot(q.x, q.y, q.z, q.w);
  if (l === 0 || l === 1) return q;
  return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l };
}

/** Rotate a table-frame vector by an orientation. Test and diagnostic use. */
export function rotateVec3(
  q: Quat,
  v: readonly [number, number, number],
): [number, number, number] {
  // t = 2 * (q_vec x v); v' = v + q.w * t + q_vec x t
  const [x, y, z] = v;
  const tx = 2 * (q.y * z - q.z * y);
  const ty = 2 * (q.z * x - q.x * z);
  const tz = 2 * (q.x * y - q.y * x);
  return [
    x + q.w * tx + (q.y * tz - q.z * ty),
    y + q.w * ty + (q.z * tx - q.x * tz),
    z + q.w * tz + (q.x * ty - q.y * tx),
  ];
}

/**
 * Advance an orientation by the rotation `roll` implies over `dt`.
 *
 * `roll` is r*omega in the table plane. Rolling without slipping means the
 * contact point is stationary, v = r*(omega x zhat), which inverts to
 * omega = (zhat x roll)/r = (-roll.y, roll.x, 0)/r.
 *
 * The delta is PRE-multiplied. The axis is a table-frame direction, not a
 * body-frame one, so composing on the right would spin the ball about an axis
 * that the previous rotations had themselves carried around with the ball.
 */
export function spinBy(q: Quat, roll: Vec2, radius: number, dt: number): Quat {
  const rollSpeed = Math.hypot(roll.x, roll.y);
  if (rollSpeed === 0) return q;

  const half = (rollSpeed / radius) * dt * 0.5;
  const s = Math.sin(half);
  // |(-roll.y, roll.x)| === |roll|, so dividing by rollSpeed normalises the axis.
  const delta: Quat = {
    x: (-roll.y / rollSpeed) * s,
    y: (roll.x / rollSpeed) * s,
    z: 0,
    w: Math.cos(half),
  };
  return normalize(multiply(delta, q));
}
