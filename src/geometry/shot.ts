/**
 * ShotGeometry — the analytic authority on aiming.
 *
 * Pure functions over positions. Nothing here runs the simulation, and the
 * simulation never consults it: the sim decides what physically happens, this
 * module decides what the player *should* have done. Teaching, feedback and
 * progression are all scored from here, because a pot confounds aim with power
 * and pocket tuning, and only aim is what we are training.
 */

import {
  BALL_CONTACT_FRICTION,
  GRAVITY,
  MAX_CUE_SPEED,
  NORMAL_TRANSFER,
  ROLLING_FRICTION,
  SLIDING_FRICTION,
  TERMINAL_ROLL_BOOST,
  TERMINAL_ROLL_SPEED,
} from '../constants';
import { BALL_RADIUS, type Pocket, isInLegalBounds } from './table';
import {
  type Vec2,
  add,
  angleBetween,
  cross,
  dot,
  normalize,
  scale,
  signedAngleBetween,
  sub,
} from './vec2';

/** Cuts at or below this are called straight-in; feedback switches to left/right. */
export const STRAIGHT_CUT_LIMIT = (2 * Math.PI) / 180;

/** Beyond this the contact is too thin to drive the object ball anywhere useful. */
export const MAX_CUT_ANGLE = (85 * Math.PI) / 180;

/** Aim deviations under this read as "on line" rather than thick or thin. */
export const ON_LINE_LIMIT = (0.1 * Math.PI) / 180;

/** How much roll-out past the pocket a shot needs before we call it makeable. */
export const POWER_MARGIN = 1.25;

export type CutSide = 'left' | 'right' | 'straight';
export type AimErrorKind = 'on-line' | 'thick' | 'thin' | 'left' | 'right';

export interface AimError {
  /** Signed angle from the ideal line to the player's line; counter-clockwise positive. */
  readonly signed: number;
  /** Absolute deviation in degrees. */
  readonly degrees: number;
  readonly kind: AimErrorKind;
}

export type ShotBlocker =
  | 'ghost-off-table'
  | 'cut-too-steep'
  | 'cue-path-blocked'
  | 'object-path-blocked'
  | 'underpowered';

export interface ShotLayoutQuery {
  readonly cue: Vec2;
  readonly object: Vec2;
  readonly pocket: Pocket;
  /** Centres of every other ball on the table. */
  readonly obstacles: readonly Vec2[];
  /**
   * Cloth to judge power against. Defaults to the normal cloth so ordinary
   * analysis is unaffected; the shot generator passes the slowest, so a layout
   * it produces stays makeable whichever cloth the player picks.
   */
  readonly rollingFriction?: number;
}

export interface ShotAnalysis {
  readonly ghostCenter: Vec2;
  /** Unit vector from the cue ball at the ghost ball. */
  readonly aimDirection: Vec2;
  readonly cutAngle: number;
  readonly cutSide: CutSide;
  /** Fraction of the object ball the cue ball covers: 1 is dead full, 0 is a bare edge. */
  readonly fullness: number;
  readonly cueToGhost: number;
  readonly objectToPocket: number;
  readonly reachable: boolean;
  readonly blockers: readonly ShotBlocker[];
}

/**
 * Where the cue ball's centre must be at the moment of contact for the object
 * ball to set off at the pocket: one diameter behind it, on the far side.
 */
export function ghostBallCenter(objectCenter: Vec2, target: Vec2): Vec2 {
  return add(objectCenter, scale(normalize(sub(objectCenter, target)), 2 * BALL_RADIUS));
}

export function idealAimDirection(cueCenter: Vec2, objectCenter: Vec2, target: Vec2): Vec2 {
  return normalize(sub(ghostBallCenter(objectCenter, target), cueCenter));
}

/** Angle between the cue ball's line and the object ball's departure line. */
export function cutAngle(cueCenter: Vec2, objectCenter: Vec2, target: Vec2): number {
  const approach = idealAimDirection(cueCenter, objectCenter, target);
  const departure = normalize(sub(target, objectCenter));
  return angleBetween(approach, departure);
}

export function cutSide(cueCenter: Vec2, objectCenter: Vec2, target: Vec2): CutSide {
  const approach = idealAimDirection(cueCenter, objectCenter, target);
  const departure = normalize(sub(target, objectCenter));
  const signed = signedAngleBetween(approach, departure);
  if (Math.abs(signed) <= STRAIGHT_CUT_LIMIT) return 'straight';
  return signed > 0 ? 'left' : 'right';
}

/** Fraction of the object ball covered at contact. A half-ball hit is a 30 degree cut. */
export function fullness(cut: number): number {
  return 1 - Math.sin(Math.min(Math.abs(cut), Math.PI / 2));
}

/**
 * How far the player's line sits off the ideal one.
 *
 * On a cut, "thick" means aimed nearer the object ball's centre than ideal and
 * "thin" means further from it — the words a player actually uses. On a
 * straight-in shot neither word means anything, so we report left/right.
 */
export function aimError(
  cueCenter: Vec2,
  objectCenter: Vec2,
  target: Vec2,
  aimDirection: Vec2,
): AimError {
  const ideal = idealAimDirection(cueCenter, objectCenter, target);
  const signed = signedAngleBetween(ideal, normalize(aimDirection));
  const degrees = Math.abs((signed * 180) / Math.PI);

  if (Math.abs(signed) <= ON_LINE_LIMIT) return { signed, degrees, kind: 'on-line' };

  const cut = cutAngle(cueCenter, objectCenter, target);
  if (cut <= STRAIGHT_CUT_LIMIT) {
    return { signed, degrees, kind: signed > 0 ? 'left' : 'right' };
  }

  // Which way from the ideal line does the object ball's centre lie?
  const towardCentre = signedAngleBetween(ideal, normalize(sub(objectCenter, cueCenter)));
  const sameSide = signed > 0 === towardCentre > 0;
  return { signed, degrees, kind: sameSide ? 'thick' : 'thin' };
}

/** True when a ball can travel from `from` to `to` without touching any obstacle. */
export function isPathClear(from: Vec2, to: Vec2, obstacles: readonly Vec2[]): boolean {
  const clearance = 2 * BALL_RADIUS;
  for (const obstacle of obstacles) {
    if (distanceToSegment(obstacle, from, to) < clearance) return false;
  }
  return true;
}

export function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const lengthSq = dot(ab, ab);
  const t = lengthSq === 0 ? 0 : clamp(dot(sub(p, a), ab) / lengthSq, 0, 1);
  return Math.hypot(p.x - (a.x + ab.x * t), p.y - (a.y + ab.y * t));
}

/** Object-ball speed after an ideal cut: normal-component transfer, scaled by restitution. */
export function objectSpeedAfterCut(cueSpeed: number, cut: number): number {
  return cueSpeed * NORMAL_TRANSFER * Math.max(0, Math.cos(cut));
}

/**
 * Roll the object ball carries away from a contact with a ROLLING cue ball, as
 * a fraction of its own launch speed.
 *
 * Negative, and that sign is the whole point. Contact friction gears the two
 * balls together — their contact faces sit on opposite sides of their
 * respective centres, so they mesh like teeth — and a cue ball with topspin
 * therefore lays a little BACKSPIN on the object ball, not follow. This is the
 * published direction: left english transfers as right english, and follow
 * transfers as a touch of draw.
 *
 * Free of restitution, because the friction impulse and the object ball's
 * launch speed both scale with the normal impulse and it cancels.
 */
export function objectRollFraction(cut: number): number {
  return -2.5 * BALL_CONTACT_FRICTION * Math.max(0, Math.cos(cut));
}

/**
 * The slide phase: how far a ball goes before its contact point stops slipping,
 * and how fast it is rolling when that happens.
 *
 * `rollFraction` (k) is the ball's roll velocity at launch as a fraction of its
 * launch speed — 0 for a struck ball, negative for one that came off a contact
 * with backspin, above 1 for one over-rolling, which is what the cue ball does
 * after a square hit. The slip closes at (7/2)*mu_s*g whichever way it points,
 * so one pair of formulae covers all three cases: the ball leaves the slide at
 * v*(2.5 + k)/3.5, the familiar 5v/7 at k = 0, and covers
 * v^2*|1 - k|*(6 + k) / (24.5*mu_s*g) getting there. `distance` is a signed
 * displacement along the launch direction, not a path length: at k < -6 the
 * draw is heavy enough that the ball is already behind its launch point when
 * the slip closes, and the formula says so.
 *
 * Below k = -2.5 the exit speed is negative — the ball comes out of the slide
 * travelling BACKWARDS — and everything downstream has to keep that sign.
 * `rollPhaseDistance` does; `speedForStoppingDistance` cannot, and refuses.
 */
function slidePhase(
  speed: number,
  rollFraction: number,
): { readonly exitSpeed: number; readonly distance: number } {
  return {
    exitSpeed: (speed * (2.5 + rollFraction)) / 3.5,
    distance:
      (speed * speed * Math.abs(1 - rollFraction) * (6 + rollFraction)) /
      (24.5 * SLIDING_FRICTION * GRAVITY),
  };
}

/**
 * How far a ball already rolling at `speed` goes before it stops.
 *
 * Two constant decelerations, not one. `TERMINAL_ROLL_SPEED` is a knee below
 * which rolling resistance is `TERMINAL_ROLL_BOOST` times larger, so a slow
 * ball dies rather than trailing off. Each rung stays a plain quadratic PLUS a
 * fixed offset, which is what keeps each branch of the inverse a single square
 * root:
 *
 *   v <= K            v^2 / (2*B*a)
 *   v > K             v^2 / (2*a)   - terminalOffset
 *
 * Signed, because `speed` is: a ball that came out of its slide reversed (heavy
 * draw, `rollFraction` below -2.5) rolls on BACKWARDS, and dropping that at
 * zero would leave `stoppingDistance` reporting a ball ending up in front of
 * where it actually finishes.
 */
export function rollPhaseDistance(speed: number, rollingFriction: number): number {
  if (speed === 0) return 0;
  const decel = rollingFriction * GRAVITY;
  if (decel <= 0) return speed > 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;

  const magnitude = Math.abs(speed);
  const distance =
    magnitude <= TERMINAL_ROLL_SPEED
      ? (magnitude * magnitude) / (2 * TERMINAL_ROLL_BOOST * decel)
      : (magnitude * magnitude) / (2 * decel) - terminalOffset(rollingFriction);
  return speed > 0 ? distance : -distance;
}

/** What the knee takes off every roll-out that reaches it: K^2/(2*mu_r*g)*(1 - 1/B). */
function terminalOffset(rollingFriction: number): number {
  return (
    (TERMINAL_ROLL_SPEED * TERMINAL_ROLL_SPEED * (1 - 1 / TERMINAL_ROLL_BOOST)) /
    (2 * rollingFriction * GRAVITY)
  );
}

/** Launch speed at which a ball leaves its slide exactly at `rollSpeed`. */
function launchSpeedAtRoll(rollSpeed: number, rollFraction: number): number {
  return (3.5 * rollSpeed) / (2.5 + rollFraction);
}

/**
 * Distance a ball covers before stopping.
 *
 * Slide phase then roll phase; `rollFraction` says what the ball was doing at
 * launch (see `slidePhase`) and defaults to a pure slide.
 */
export function stoppingDistance(
  speed: number,
  rollingFriction: number = ROLLING_FRICTION,
  rollFraction = 0,
): number {
  if (speed <= 0) return 0;
  const slide = slidePhase(speed, rollFraction);
  return slide.distance + rollPhaseDistance(slide.exitSpeed, rollingFriction);
}

/**
 * Launch speed whose roll-out ends after exactly `distance`: the inverse of
 * `stoppingDistance`.
 *
 * Both phases are quadratic in launch speed, so `stoppingDistance` is
 * `C*v^2 + constant` with a different C and a different constant on each side
 * of the knee. Reading each C back OUT of `stoppingDistance` at a speed known
 * to be on the side in question — rather than restating the algebra here — is
 * what keeps the two functions exact inverses if either ever changes.
 *
 * Tried above the knee first. An answer that falls below the knee is the wrong
 * branch, so it is rejected and the other one taken.
 *
 * NaN at `rollFraction` at or below -2.5, where `stoppingDistance` stops being
 * monotonic in launch speed — the ball comes out of the slide backwards, so a
 * harder stroke ends up SHORTER and there is no single inverse to return. That
 * is well outside the -0.15 a contact produces, and it is stated rather than
 * clamped because a clamp here returned 2.2e9 m/s and looked like an answer.
 */
export function speedForStoppingDistance(
  distance: number,
  rollingFriction: number = ROLLING_FRICTION,
  rollFraction = 0,
): number {
  if (distance <= 0) return 0;
  if (rollFraction <= -2.5) return Number.NaN;
  // No rolling resistance: a ball rolls for ever, so any distance is reached by
  // an arbitrarily gentle stroke.
  if (rollingFriction <= 0) return 0;

  const knee = launchSpeedAtRoll(TERMINAL_ROLL_SPEED, rollFraction);
  const terminal = terminalOffset(rollingFriction);

  const above = 2 * knee;
  const aboveCoefficient =
    (stoppingDistance(above, rollingFriction, rollFraction) + terminal) / above ** 2;
  const aboveSpeed = Math.sqrt((distance + terminal) / aboveCoefficient);
  if (aboveSpeed >= knee) return aboveSpeed;

  // Too slow to ever leave the knee: the whole roll phase runs boosted.
  const below = knee / 2;
  const slowCoefficient = stoppingDistance(below, rollingFriction, rollFraction) / below ** 2;
  return Math.sqrt(distance / slowCoefficient);
}

/**
 * Launch speed that still has `arrivalSpeed` left after travelling `distance`.
 *
 * A ball that is ROLLING when it arrives would carry that speed a further
 * `rollPhaseDistance(arrivalSpeed)` if left alone, so the launch we want is
 * simply the one that stops after `distance` plus that — which folds the whole
 * ladder in for free, wherever its crossings fall on the trip.
 *
 * Piecewise, because the ball may not have finished sliding when it arrives.
 * Still sliding, the whole trip decelerates at mu_s*g and the knee never comes
 * into it:
 *
 *   v0^2 = va^2 + 2*mu_s*g*d
 *
 * Take the rolling answer first and fall back when the distance turns out to
 * be shorter than that launch's own slide phase. The two agree exactly at the
 * boundary, where va is 5/7 of v0. The cue ball launches at roll 0 — the cue
 * gives it speed, not spin — so no roll fraction here.
 */
export function launchSpeedFor(
  arrivalSpeed: number,
  distance: number,
  rollingFriction: number = ROLLING_FRICTION,
): number {
  const arrival = Math.max(0, arrivalSpeed);
  if (distance <= 0) return arrival;

  const rolling = speedForStoppingDistance(
    distance + rollPhaseDistance(arrival, rollingFriction),
    rollingFriction,
  );
  if (slidePhase(rolling, 0).distance <= distance) return rolling;

  return Math.sqrt(arrival * arrival + 2 * SLIDING_FRICTION * GRAVITY * distance);
}

/**
 * Can any legal stroke drive the object ball to the pocket at this cut?
 *
 * Takes the backspin the contact leaves on the object ball, which costs about
 * 9% of its reach on a full hit and 4% at 60 degrees.
 *
 * The backspin it takes is the one a ROLLING cue ball gears on, and at
 * `MAX_CUE_SPEED` the cue ball is not rolling: 4.5 m/s slides 2.53 m before the
 * slip closes, and the table is 1.98 m long. So this is deliberately the
 * pessimistic end — the real contact at full power transfers less backspin than
 * this assumes, and the ball reaches slightly further than the check allows.
 * Erring the other way would declare feasible a layout that is not, which is
 * the one thing `POWER_MARGIN` exists to prevent. Closing the gap honestly
 * needs the cue-ball run-up, which this signature does not take.
 */
export function isPowerFeasible(
  cut: number,
  objectToPocket: number,
  rollingFriction: number = ROLLING_FRICTION,
): boolean {
  return (
    stoppingDistance(
      objectSpeedAfterCut(MAX_CUE_SPEED, cut),
      rollingFriction,
      objectRollFraction(cut),
    ) >=
    objectToPocket * POWER_MARGIN
  );
}

export function analyseShot(query: ShotLayoutQuery): ShotAnalysis {
  const { cue, object, pocket, obstacles } = query;
  const target = pocket.center;
  const ghostCenter = ghostBallCenter(object, target);
  const aimDirection = normalize(sub(ghostCenter, cue));
  const cut = cutAngle(cue, object, target);
  const objectToPocket = Math.hypot(target.x - object.x, target.y - object.y);

  const blockers: ShotBlocker[] = [];
  if (!isInLegalBounds(ghostCenter)) blockers.push('ghost-off-table');
  if (cut > MAX_CUT_ANGLE) blockers.push('cut-too-steep');
  if (!isPathClear(cue, ghostCenter, obstacles)) blockers.push('cue-path-blocked');
  if (!isPathClear(object, target, obstacles)) blockers.push('object-path-blocked');
  if (!isPowerFeasible(cut, objectToPocket, query.rollingFriction)) blockers.push('underpowered');

  return {
    ghostCenter,
    aimDirection,
    cutAngle: cut,
    cutSide: cutSide(cue, object, target),
    fullness: fullness(cut),
    cueToGhost: Math.hypot(ghostCenter.x - cue.x, ghostCenter.y - cue.y),
    objectToPocket,
    reachable: blockers.length === 0,
    blockers,
  };
}

/** Which side of the ideal line the cue ball is being sent; used by the HUD arrows. */
export function aimSideSign(cueCenter: Vec2, objectCenter: Vec2, target: Vec2): number {
  const ideal = idealAimDirection(cueCenter, objectCenter, target);
  return Math.sign(cross(ideal, sub(objectCenter, cueCenter)));
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
