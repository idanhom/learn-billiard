/**
 * Hand-placed layouts. The vertical slice runs on these two; the seeded
 * generator in the curriculum phase produces the rest, and falls back to
 * per-level templates of this shape when generation can't satisfy its
 * invariants.
 */

import { aimPoint } from '../geometry/pocket-window';
import { ghostBallCenter } from '../geometry/shot';
import { type PocketId, pocketById } from '../geometry/table';
import {
  type Vec2,
  add,
  angleOf,
  fromAngle,
  normalize,
  rotate,
  scale,
  signedAngleBetween,
  sub,
  vec,
} from '../geometry/vec2';
import { hashString, makeRng } from './random';

export interface ShotLayout {
  readonly id: string;
  readonly cue: Vec2;
  readonly object: Vec2;
  readonly targetPocket: PocketId;
  /** Centres of any other balls on the table. Empty for the drills. */
  readonly obstacles?: readonly Vec2[];
}

/**
 * Place the cue ball so the shot has exactly `cutDegrees` of cut, measured to
 * the middle of the pocket's clean band. Positive cuts the object ball to the
 * left, negative to the right.
 */
export function layoutWithCut(
  id: string,
  object: Vec2,
  targetPocket: PocketId,
  cutDegrees: number,
  cueDistance: number,
): ShotLayout {
  const target = aimPoint(object, pocketById(targetPocket));
  const departure = normalize(sub(target, object));
  const ghost = ghostBallCenter(object, target);
  const approach = rotate(departure, (-cutDegrees * Math.PI) / 180);
  return { id, cue: sub(ghost, scale(approach, cueDistance)), object, targetPocket };
}

export const STRAIGHT_IN_DRILL: ShotLayout = layoutWithCut(
  'drill-straight-in',
  vec(0.3, 0.15),
  'top-right',
  0,
  0.5,
);

export const CUT_30_DRILL: ShotLayout = layoutWithCut(
  'drill-cut-30',
  vec(0.3, 0.15),
  'top-right',
  30,
  0.6,
);

export const SLICE_DRILLS: readonly ShotLayout[] = [STRAIGHT_IN_DRILL, CUT_30_DRILL];

/** Where the object ball is aimed: the middle of its pocket's clean band. */
export function aimTarget(layout: ShotLayout): Vec2 {
  return aimPoint(layout.object, pocketById(layout.targetPocket));
}

/** Direction the cue must travel for a perfect hit, as an angle in radians. */
export function idealAimAngle(layout: ShotLayout): number {
  return angleOf(sub(ghostBallCenter(layout.object, aimTarget(layout)), layout.cue));
}

/** How far off the object ball's centre the cue starts, in degrees. */
export const START_AIM_OFFSET_DEGREES: readonly [number, number] = [3, 8];

/**
 * Where the cue points when a shot is dealt: at the object ball's centre,
 * turned a seeded 3-8 degrees off it to one side or the other.
 *
 * Never the ideal line. Starting there handed over the answer — Space alone
 * scored 0.00 degrees, at the last tier and in the exam. Turned toward the
 * ghost ball, a large enough offset could still land on it by chance on a thin
 * cut, so a start within 3 degrees of the ideal line takes the other side
 * instead. That side never can: it is the offset plus the cut's own lean the
 * opposite way.
 *
 * The seed is mixed with the layout id, so the same layout dealt again — a
 * retry — starts somewhere new if the caller moves the seed on.
 */
export function startingAimAngle(layout: ShotLayout, seed: number): number {
  const rng = makeRng((seed ^ hashString(layout.id)) >>> 0);
  const [low, high] = START_AIM_OFFSET_DEGREES;
  const offset = ((low + (high - low) * rng()) * Math.PI) / 180;
  const sign = rng() < 0.5 ? -1 : 1;

  const centre = angleOf(sub(layout.object, layout.cue));
  const ideal = fromAngle(idealAimAngle(layout));
  const candidate = centre + sign * offset;
  const fromIdeal = Math.abs(signedAngleBetween(ideal, fromAngle(candidate)));
  return fromIdeal >= (low * Math.PI) / 180 ? candidate : centre - sign * offset;
}

/** A point one metre down the aim line — handy for drawing guides. */
export function aimLineEnd(from: Vec2, angle: number, length: number): Vec2 {
  return add(from, fromAngle(angle, length));
}
