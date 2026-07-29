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
  GRAVITY,
  MAX_CUE_SPEED,
  NORMAL_TRANSFER,
  ROLLING_FRICTION,
  SLIDING_FRICTION,
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
 * Distance a ball covers before stopping, starting from a pure slide.
 *
 * Slide phase: the ball decelerates at mu_s*g while its roll spins up at
 * (5/2)*mu_s*g, so the slip closes at (7/2)*mu_s*g and the ball is rolling at
 * 5/7 of its launch speed. Roll phase: plain quadratic decay under rolling
 * resistance.
 */
export function stoppingDistance(
  speed: number,
  rollingFriction: number = ROLLING_FRICTION,
): number {
  if (speed <= 0) return 0;
  const slide = (12 * speed * speed) / (49 * SLIDING_FRICTION * GRAVITY);
  const rollSpeed = (5 * speed) / 7;
  const roll = (rollSpeed * rollSpeed) / (2 * rollingFriction * GRAVITY);
  return slide + roll;
}

/**
 * Launch speed whose roll-out ends after exactly `distance`: the inverse of
 * `stoppingDistance`.
 *
 * `stoppingDistance` is exactly quadratic in speed — both phases are — so its
 * value at unit speed is the whole coefficient, and inverting it is one square
 * root. Deriving it that way rather than restating the algebra is what keeps
 * the two functions exact inverses if either ever changes.
 */
export function speedForStoppingDistance(
  distance: number,
  rollingFriction: number = ROLLING_FRICTION,
): number {
  if (distance <= 0) return 0;
  return Math.sqrt(distance / stoppingDistance(1, rollingFriction));
}

/**
 * Launch speed that still has `arrivalSpeed` left after travelling `distance`.
 *
 * Piecewise, because the ball may not have finished sliding when it arrives.
 * Rolling on arrival, the slide phase is spent and the roll phase makes up the
 * rest:
 *
 *   v0^2 = (va^2 + 2*mu_r*g*d) / (25/49 + 24*mu_r/(49*mu_s))
 *
 * Still sliding, the whole trip decelerates at mu_s*g:
 *
 *   v0^2 = va^2 + 2*mu_s*g*d
 *
 * Take the rolling answer first and fall back when the distance turns out to
 * be shorter than that launch's own slide phase. The two agree exactly at the
 * boundary, where va is 5/7 of v0.
 */
export function launchSpeedFor(
  arrivalSpeed: number,
  distance: number,
  rollingFriction: number = ROLLING_FRICTION,
): number {
  const arrival = Math.max(0, arrivalSpeed);
  if (distance <= 0) return arrival;

  const rolling =
    (arrival * arrival + 2 * rollingFriction * GRAVITY * distance) /
    (25 / 49 + (24 * rollingFriction) / (49 * SLIDING_FRICTION));
  const slidePhase = (12 * rolling) / (49 * SLIDING_FRICTION * GRAVITY);
  if (slidePhase <= distance) return Math.sqrt(rolling);

  return Math.sqrt(arrival * arrival + 2 * SLIDING_FRICTION * GRAVITY * distance);
}

/** Can any legal stroke drive the object ball to the pocket at this cut? */
export function isPowerFeasible(
  cut: number,
  objectToPocket: number,
  rollingFriction: number = ROLLING_FRICTION,
): boolean {
  return (
    stoppingDistance(objectSpeedAfterCut(MAX_CUE_SPEED, cut), rollingFriction) >=
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
