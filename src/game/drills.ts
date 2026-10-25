/**
 * Hand-placed layouts. The vertical slice runs on these two; the seeded
 * generator in the curriculum phase produces the rest, and falls back to
 * per-level templates of this shape when generation can't satisfy its
 * invariants.
 */

import { aimPoint } from '../geometry/pocket-window';
import { analyseShot, ghostBallCenter } from '../geometry/shot';
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
  /** The object ball is out of play: a drill for the cue ball alone. */
  readonly objectAway?: boolean;
  /** Where a drill asks the cue ball to stop: on its own, or after a pot. */
  readonly spot?: Vec2;
  /** How near the spot counts, in metres, where it is not the ring's 10 cm. */
  readonly spotRadius?: number;
  /** Which way the cue starts pointing in a drill for the cue ball alone, as a heading. */
  readonly heading?: number;
}

/**
 * Place the cue ball so the shot has exactly `cutDegrees` of cut, `cueDistance`
 * short of the ghost ball. Positive cuts the object ball to the left, negative
 * to the right.
 *
 * The cut is the one the player aims: between the cue ball's line and the line
 * of centres, which throw turns away from where the object ball goes. Throw in
 * turn depends on where the cue ball sits, so the placement starts from the
 * throw-free ghost ball and is moved round to the analysed one until it
 * settles.
 */
export function layoutWithCut(
  id: string,
  object: Vec2,
  targetPocket: PocketId,
  cutDegrees: number,
  cueDistance: number,
): ShotLayout {
  const pocket = pocketById(targetPocket);
  const turn = (-cutDegrees * Math.PI) / 180;
  const place = (ghost: Vec2): Vec2 =>
    sub(ghost, scale(rotate(normalize(sub(object, ghost)), turn), cueDistance));

  let cue = place(ghostBallCenter(object, aimPoint(object, pocket)));
  for (let pass = 0; pass < PLACEMENT_PASSES; pass++) {
    cue = place(analyseShot({ cue, object, pocket, obstacles: [] }).ghostCenter);
  }
  return { id, cue, object, targetPocket };
}

/** Passes moving the cue ball round to the throw-corrected ghost ball; each shrinks the miss about twentyfold. */
const PLACEMENT_PASSES = 8;

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

/**
 * Direction the cue must travel for a perfect hit, as an angle in radians: at
 * the throw-corrected ghost ball, for the recommended stroke on normal cloth
 * unless told otherwise.
 */
export function idealAimAngle(
  layout: ShotLayout,
  stroke: { readonly rollingFriction?: number; readonly cueSpeed?: number } = {},
): number {
  return angleOf(
    analyseShot({
      cue: layout.cue,
      object: layout.object,
      pocket: pocketById(layout.targetPocket),
      obstacles: layout.obstacles ?? [],
      ...stroke,
    }).aimDirection,
  );
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
  // With no object ball the drill is the speed, not the line: it starts pointed the way to go.
  if (layout.heading !== undefined) return layout.heading;
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
