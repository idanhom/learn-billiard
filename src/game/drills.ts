/**
 * Hand-placed layouts. The vertical slice runs on these two; the seeded
 * generator in the curriculum phase produces the rest, and falls back to
 * per-level templates of this shape when generation can't satisfy its
 * invariants.
 */

import { ghostBallCenter } from '../geometry/shot';
import { type PocketId, pocketById } from '../geometry/table';
import { type Vec2, add, angleOf, fromAngle, normalize, rotate, scale, sub, vec } from '../geometry/vec2';

export interface ShotLayout {
  readonly id: string;
  readonly cue: Vec2;
  readonly object: Vec2;
  readonly targetPocket: PocketId;
  /** Centres of any other balls on the table. Empty for the drills. */
  readonly obstacles?: readonly Vec2[];
}

/**
 * Place the cue ball so the shot has exactly `cutDegrees` of cut.
 * Positive cuts the object ball to the left, negative to the right.
 */
export function layoutWithCut(
  id: string,
  object: Vec2,
  targetPocket: PocketId,
  cutDegrees: number,
  cueDistance: number,
): ShotLayout {
  const target = pocketById(targetPocket).center;
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

/** Direction the cue must travel for a perfect hit, as an angle in radians. */
export function idealAimAngle(layout: ShotLayout): number {
  const target = pocketById(layout.targetPocket).center;
  return angleOf(sub(ghostBallCenter(layout.object, target), layout.cue));
}

/** A point one metre down the aim line — handy for drawing guides. */
export function aimLineEnd(from: Vec2, angle: number, length: number): Vec2 {
  return add(from, fromAngle(angle, length));
}
