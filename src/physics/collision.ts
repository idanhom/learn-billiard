/**
 * Collision primitives: time-of-impact queries and impulse resolution.
 *
 * Every query answers "when, within the next `maxTime` seconds of straight-line
 * motion, does this contact happen?" so the solver can order events by earliest
 * impact instead of resolving whatever it happens to notice first.
 */

import {
  BALL_CONTACT_FRICTION,
  BALL_RESTITUTION,
  CUSHION_CONTACT_HEIGHT_RATIO,
  CUSHION_CONTACT_RESTITUTION,
  CUSHION_TANGENT_RETENTION,
} from '../constants';
import type { Segment } from '../geometry/table';
import { type Vec2, add, dot, normalize, scale, sub, vec } from '../geometry/vec2';

/** Guards against re-detecting a contact that was just resolved. */
const TOUCHING_EPSILON = 1e-9;

/** Below this the surfaces are not sliding across each other at all. */
const SLIP_EPSILON = 1e-12;

/**
 * Smallest root of |d + t*dv| = radius, restricted to [0, maxTime] and to
 * closing contacts. Shared by ball-ball, cushion nose and pocket queries.
 */
function closingCircleTOI(d: Vec2, dv: Vec2, radius: number, maxTime: number): number | undefined {
  const a = dot(dv, dv);
  if (a === 0) return undefined;
  const b = 2 * dot(d, dv);
  if (b >= 0) return undefined; // separating, or grazing
  const c = dot(d, d) - radius * radius;
  if (c <= 0) return 0; // already inside and still closing
  const disc = b * b - 4 * a * c;
  if (disc < 0) return undefined;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t < 0 || t > maxTime) return undefined;
  return t;
}

/** When two balls of the given diameter first touch, or undefined. */
export function ballBallTOI(
  posA: Vec2,
  velA: Vec2,
  posB: Vec2,
  velB: Vec2,
  diameter: number,
  maxTime: number,
): number | undefined {
  return closingCircleTOI(sub(posB, posA), sub(velB, velA), diameter, maxTime);
}

/** When a ball centre first enters a circle (a pocket's capture area), or undefined. */
export function ballCircleEntryTOI(
  pos: Vec2,
  vel: Vec2,
  center: Vec2,
  radius: number,
  maxTime: number,
): number | undefined {
  return closingCircleTOI(sub(center, pos), scale(vel, -1), radius, maxTime);
}

export interface SegmentHit {
  readonly time: number;
  /** Unit surface normal at the contact point, pointing back at the ball. */
  readonly normal: Vec2;
}

/**
 * When a ball first touches a cushion segment.
 *
 * Two cases: the flat face, and the rounded nose at either end. Segments end at
 * pocket mouths, so the nose case is what stops a ball clipping the cushion tip
 * and passing straight through it.
 */
export function ballSegmentTOI(
  pos: Vec2,
  vel: Vec2,
  segment: Segment,
  radius: number,
  maxTime: number,
): SegmentHit | undefined {
  const face = faceTOI(pos, vel, segment, radius, maxTime);
  const capA = capTOI(pos, vel, segment.a, radius, maxTime);
  const capB = capTOI(pos, vel, segment.b, radius, maxTime);

  let best: SegmentHit | undefined;
  for (const hit of [face, capA, capB]) {
    if (hit && (!best || hit.time < best.time)) best = hit;
  }
  return best;
}

function faceTOI(
  pos: Vec2,
  vel: Vec2,
  segment: Segment,
  radius: number,
  maxTime: number,
): SegmentHit | undefined {
  const approach = dot(vel, segment.normal);
  if (approach >= 0) return undefined; // moving away from the face

  const distance = dot(sub(pos, segment.a), segment.normal);
  const t = distance <= radius ? 0 : (radius - distance) / approach;
  if (t < 0 || t > maxTime) return undefined;

  // The contact must land between the segment's ends, not past a nose.
  const along = sub(segment.b, segment.a);
  const lengthSq = dot(along, along);
  if (lengthSq === 0) return undefined;
  const contact = sub(add(pos, scale(vel, t)), scale(segment.normal, radius));
  const s = dot(sub(contact, segment.a), along) / lengthSq;
  if (s < 0 || s > 1) return undefined;

  return { time: t, normal: segment.normal };
}

function capTOI(
  pos: Vec2,
  vel: Vec2,
  end: Vec2,
  radius: number,
  maxTime: number,
): SegmentHit | undefined {
  const t = closingCircleTOI(sub(end, pos), scale(vel, -1), radius, maxTime);
  if (t === undefined) return undefined;
  const contactCentre = add(pos, scale(vel, t));
  const normal = normalize(sub(contactCentre, end));
  if (normal.x === 0 && normal.y === 0) return undefined;
  return { time: t, normal };
}

export interface PairImpulse {
  readonly velA: Vec2;
  readonly velB: Vec2;
  readonly rollA: Vec2;
  readonly rollB: Vec2;
}

/**
 * Equal-mass impulse along the line of centres, plus contact friction.
 *
 * The normal impulse is unchanged and the tangential VELOCITY components still
 * pass through untouched, which is why a struck ball leaves exactly along the
 * line of centres and the cue ball keeps its sideways drift. Ball-to-ball
 * throw is still not modelled — the app says so.
 *
 * What contact friction does change is the spin, and the direction is the part
 * worth reading twice. The two contact faces sit on opposite sides of their
 * respective centres, so they MESH LIKE GEARS: a ball rolling forward has its
 * leading face moving downward, that face drags the object ball's trailing face
 * down with it, and a trailing face moving down is BACKSPIN. So follow
 * transfers as a touch of draw, exactly as left english transfers as right
 * english. Both rolls decrease along `n`; the quantity conserved is their
 * DIFFERENCE, not their sum.
 *
 * That makes the vertical slip the SUM `(rollA + rollB)·n`, and `|W|/5` the
 * impulse that zeros it — the surfaces mesh, and the cap belongs there rather
 * than on the total friction impulse. Passive by construction: the roll energy
 * changes by `(m/5)(-5*Pv*W + 12.5*Pv^2)`, negative for every `|Pv| < 2|W|/5`,
 * and the cap is half of that.
 *
 * Only the vertical share of the friction is applied. The horizontal share, the
 * one the cut angle produces, is precisely throw. Declining it costs
 * `mu*sin(theta)` of deflection — about 1.7 degrees at half-ball, inside the
 * 1-2 degrees the trainer scores against.
 *
 * The vertical LINEAR impulse is discarded rather than applied: it would drive
 * the balls into or out of the cloth, and the table absorbs it.
 */
export function resolveBallPair(
  posA: Vec2,
  velA: Vec2,
  rollA: Vec2,
  posB: Vec2,
  velB: Vec2,
  rollB: Vec2,
): PairImpulse | undefined {
  const n = normalize(sub(posB, posA));
  if (n.x === 0 && n.y === 0) return undefined;

  const closing = dot(sub(velB, velA), n);
  if (closing >= -TOUCHING_EPSILON) return undefined;

  // Equal masses: the exchanged normal speed is (1+e)/2 of the closing speed.
  const exchange = (-(1 + BALL_RESTITUTION) * closing) / 2;

  const vertical = dot(add(rollA, rollB), n);
  const horizontal = dot(sub(velA, velB), vec(-n.y, n.x));
  const slip = Math.hypot(vertical, horizontal);

  // A dead-straight stun contact — no roll on either ball, no cut — slips
  // nowhere. Unguarded the share below is 0*(0/0), which is NaN, and it would
  // poison both rolls from there on.
  let torque = vec(0, 0);
  if (slip > SLIP_EPSILON) {
    const share = (BALL_CONTACT_FRICTION * exchange * Math.abs(vertical)) / slip;
    const applied = Math.sign(vertical) * Math.min(share, Math.abs(vertical) / 5);
    torque = scale(n, 2.5 * applied);
  }

  return {
    velA: sub(velA, scale(n, exchange)),
    velB: add(velB, scale(n, exchange)),
    rollA: sub(rollA, torque),
    rollB: sub(rollB, torque),
  };
}

export interface CushionImpulse {
  readonly vel: Vec2;
  readonly roll: Vec2;
}

/**
 * Cushion rebound as a point impulse applied above the ball's centre.
 *
 * The cushion nose sits at 0.27R above centre, so three things follow, and all
 * three matter:
 *
 *  - The contact point is not the centre. For a rolling ball it is moving 1.27x
 *    faster than the centre, so that is the velocity restitution applies to.
 *  - An impulse there also spins the ball, by `2.5 * (h/R) * j`, toward rolling
 *    in its new direction.
 *  - The ball resists an impulse at that point with a rotational effective
 *    mass, hence the `1 + 2.5c^2` divisor.
 *
 * Getting the first and third wrong is not a rounding error: computing the
 * impulse from the centre velocity and then adding the angular term creates
 * energy — around +58% for a ball whose roll opposes its motion, a state
 * `resolveBallPair` produces routinely, since it changes velocity and leaves
 * roll alone. With the contact-point velocity and effective mass, a rail is
 * passive by construction at every spin state.
 *
 * What is deliberately NOT modelled: tangential cushion friction, and so no
 * cushion-induced sidespin. The tangential retention factor stands in for it.
 */
export function resolveCushion(vel: Vec2, roll: Vec2, normal: Vec2): CushionImpulse | undefined {
  const c = CUSHION_CONTACT_HEIGHT_RATIO;

  // Normal velocity of the contact point, not of the centre.
  const closing = dot(vel, normal) + c * dot(roll, normal);
  if (closing >= 0) return undefined;

  const effectiveMass = 1 + 2.5 * c * c;
  const j = (-(1 + CUSHION_CONTACT_RESTITUTION) * closing) / effectiveMass;

  const bounced = add(vel, scale(normal, j));
  const normalPart = scale(normal, dot(bounced, normal));
  const tangentPart = sub(bounced, normalPart);

  return {
    vel: add(normalPart, scale(tangentPart, CUSHION_TANGENT_RETENTION)),
    roll: add(roll, scale(normal, 2.5 * c * j)),
  };
}

/** Push two overlapping balls apart along their line of centres, sharing the correction. */
export function separateOverlap(
  posA: Vec2,
  posB: Vec2,
  diameter: number,
): { posA: Vec2; posB: Vec2 } | undefined {
  const delta = sub(posB, posA);
  const distance = Math.hypot(delta.x, delta.y);
  if (distance >= diameter) return undefined;

  // Coincident centres: pick an arbitrary axis rather than dividing by zero.
  const n = distance === 0 ? vec(1, 0) : scale(delta, 1 / distance);
  const push = (diameter - distance) / 2 + TOUCHING_EPSILON;
  return { posA: sub(posA, scale(n, push)), posB: add(posB, scale(n, push)) };
}
