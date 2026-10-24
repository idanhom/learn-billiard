/**
 * Collision primitives: time-of-impact queries and impulse resolution.
 *
 * Every query answers "when, within the next `maxTime` seconds of straight-line
 * motion, does this contact happen?" so the solver can order events by earliest
 * impact instead of resolving whatever it happens to notice first.
 */

import {
  BALL_RESTITUTION,
  CUSHION_CONTACT_HEIGHT_RATIO,
  CUSHION_FRICTION,
  CUSHION_RESTITUTION,
  contactFriction,
} from '../constants';
import type { Segment } from '../geometry/table';
import { type Vec2, add, dot, normalize, scale, sub, vec } from '../geometry/vec2';

/** Daylight left between two balls pulled apart from an overlap. */
const TOUCHING_EPSILON = 1e-9;

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

/**
 * When a ball centre first crosses a pocket's drop line into the hole, or
 * undefined. A centre already past it, within its span, is over the hole now.
 * Only the span between the facings counts: past either end is rubber, not
 * hole.
 */
export function dropLineTOI(pos: Vec2, vel: Vec2, drop: Segment, maxTime: number): number | undefined {
  const depth = dot(sub(pos, drop.a), drop.normal);
  let time = 0;
  if (depth < 0) {
    const closing = dot(vel, drop.normal);
    if (closing <= 0) return undefined;
    time = -depth / closing;
    if (time > maxTime) return undefined;
  }
  const along = sub(drop.b, drop.a);
  const at = add(pos, scale(vel, time));
  const span = dot(sub(at, drop.a), along) / dot(along, along);
  return span > 0 && span < 1 ? time : undefined;
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
 * The friction is Coulomb, `contactFriction(slip)` times the normal impulse,
 * along the direction the two surfaces slide past each other at the contact.
 * That slide has two parts, and each one is capped at the impulse that would
 * stop it, so the surfaces can come out meshed but never reversed.
 *
 * The vertical part is spin, and its direction is worth reading twice. The two
 * contact faces sit on opposite sides of their respective centres, so they
 * MESH LIKE GEARS: a ball rolling forward has its leading face moving
 * downward, that face drags the object ball's trailing face down with it, and
 * a trailing face moving down is BACKSPIN. So follow transfers as a touch of
 * draw, exactly as left english transfers as right english. Both rolls
 * decrease along `n`; the quantity conserved is their DIFFERENCE, not their
 * sum. That makes the vertical slip the SUM `(rollA + rollB)·n`, and `|W|/5`
 * the impulse that zeros it: only the spins can answer it, since the vertical
 * LINEAR impulse would drive the balls into or out of the cloth, and the table
 * absorbs it. Passive by construction: the roll energy changes by
 * `(m/5)(-5*Pv*W + 12.5*Pv^2)`, negative for every `|Pv| < 2|W|/5`, and the
 * cap is half of that.
 *
 * The horizontal part is THROW: the cue ball's sideways motion across the line
 * of centres drags the object ball with it, so on a cut the object ball leaves
 * a little short of the line of centres, turned toward the way the cue ball
 * was going. It acts at the height of the centres, so it moves both balls
 * sideways and spins them about the vertical, and `|H|/7` is the impulse that
 * stops the slide once both are counted: 1/m of linear and 5/2m of turning,
 * each, on each ball. Nothing here tracks vertical-axis spin, so that share
 * goes nowhere, as the cushions put none on either. This is TP A.14's model,
 * cap and all; it differs only in taking restitution as 0.95 rather than 1.
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

  // Any approach at all, matching the time-of-impact query exactly. A
  // threshold here that the query did not share let a pair closing at under a
  // nanometre a second come back as a contact at t = 0 on every pass, never be
  // resolved, and starve every other contact in the tick.
  const closing = dot(sub(velB, velA), n);
  if (closing >= 0) return undefined;

  // Equal masses: the exchanged normal speed is (1+e)/2 of the closing speed.
  const exchange = (-(1 + BALL_RESTITUTION) * closing) / 2;

  const across = vec(-n.y, n.x);
  const vertical = dot(add(rollA, rollB), n);
  const horizontal = dot(sub(velA, velB), across);
  const slip = Math.hypot(vertical, horizontal);

  // A dead-straight stun contact (no roll on either ball, no cut) slips
  // nowhere, and the shares below would be 0*(0/0): NaN, poisoning both balls
  // from there on.
  let torque = vec(0, 0);
  let thrown = vec(0, 0);
  if (slip > 0) {
    const perSlip = (contactFriction(slip) * exchange) / slip;
    const spun = Math.sign(vertical) * Math.min(perSlip * Math.abs(vertical), Math.abs(vertical) / 5);
    torque = scale(n, 2.5 * spun);
    const dragged = Math.sign(horizontal) * Math.min(perSlip * Math.abs(horizontal), Math.abs(horizontal) / 7);
    thrown = scale(across, dragged);
  }

  return {
    velA: sub(sub(velA, scale(n, exchange)), thrown),
    velB: add(add(velB, scale(n, exchange)), thrown),
    rollA: sub(rollA, torque),
    rollB: sub(rollB, torque),
  };
}

export interface CushionImpulse {
  readonly vel: Vec2;
  readonly roll: Vec2;
}

/**
 * Cushion rebound: Han (2005), "Dynamics in carom and three cushion billiards",
 * as pooltool implements it, restated in this solver's 2D state.
 *
 * The cushion nose touches the ball 0.27R above its centre, so the contact
 * normal, which on a sphere runs through the centre, tilts below horizontal.
 * Two impulses act there:
 *
 *  - Along the normal, (1 + e) times the approach along it. It passes through
 *    the centre, so it turns nothing. Its vertical share pushes the ball into
 *    the cloth, and the table absorbs that.
 *  - Friction at the nose, against the slip of the ball's surface over the
 *    cushion: enough to stop the slip if `CUSHION_FRICTION` allows it, and
 *    `CUSHION_FRICTION` times the normal impulse if not. This is the only thing
 *    that turns the ball, which is the point: it fights a rolling ball's
 *    topspin down and winds a stun ball's up.
 *
 * Han's slip and impulses carry a vertical-axis spin (english) too. This model
 * has no english, so that spin is never read, and the share of the friction
 * that would create it is discarded. That is passive, since it only takes
 * energy away, and it means a cushion still puts no sidespin on a ball. What
 * the friction does to the ball's travel along the rail and to its roll is
 * kept.
 *
 * In the frame used here `a` points into the cushion and `b` along it; with
 * up, they are right-handed, so `roll` maps to Han's angular velocity as
 * roll.a = R*w_b and roll.b = -R*w_a.
 *
 * Undefined when the ball is not moving into the cushion. Han's normal impulse
 * is driven by the centre's approach, so unlike the impulse this replaced, a
 * spinning ball cannot hold the contact open while its centre drives in.
 */
export function resolveCushion(vel: Vec2, roll: Vec2, normal: Vec2): CushionImpulse | undefined {
  const a = scale(normal, -1);
  const b = vec(-a.y, a.x);
  const approach = dot(vel, a);
  if (approach <= 0) return undefined;

  const sin = CUSHION_CONTACT_HEIGHT_RATIO;
  const cos = Math.sqrt(1 - sin * sin);
  const along = dot(vel, b);
  const rollIn = dot(roll, a);
  const rollAlong = dot(roll, b);

  // Everything per unit mass from here on.
  const push = (1 + CUSHION_RESTITUTION) * approach * cos;

  // Slip of the ball's surface over the nose: down the contact plane, and
  // along the rail. Two sevenths of it is the impulse that would stop it.
  const slipDown = approach * sin + rollIn;
  const slipAlong = -along - rollAlong * sin;
  const slip = Math.hypot(slipDown, slipAlong);
  const friction = Math.min((2 / 7) * slip, CUSHION_FRICTION * push);
  const frictionDown = slip === 0 ? 0 : (friction * slipDown) / slip;
  const frictionAlong = slip === 0 ? 0 : (friction * slipAlong) / slip;

  return {
    vel: add(scale(a, approach - frictionDown * sin - push * cos), scale(b, along + frictionAlong)),
    roll: add(scale(a, rollIn - 2.5 * frictionDown), scale(b, rollAlong + 2.5 * frictionAlong * sin)),
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
