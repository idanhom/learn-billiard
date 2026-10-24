/**
 * Whether a ball is where a ball can be, for the containment checks.
 *
 * The legal-bounds rectangle stopped being the answer when pockets got shelves:
 * a ball can roll through a mouth, die on the shelf short of the drop line, and
 * hang there in the jaws, outside the rectangle and on the table. What a ball
 * cannot do is overlap a cushion or leave the slate, so that is the check.
 */

import { BALL_RADIUS, TABLE, hasEscapedSurface, isInLegalBounds } from '../../src/geometry/table';
import { type Vec2, distanceToSegment } from '../../src/geometry/vec2';

/**
 * A ball centre at `p` overlaps no cushion or facing by more than `slack`, and
 * has not left the slate. A ball inside the rectangle is on the table whatever
 * the cushions say, which keeps the check exact for every ball off the shelves.
 */
export function isOnTable(p: Vec2, slack: number): boolean {
  if (isInLegalBounds(p, -slack)) return true;
  if (hasEscapedSurface(p)) return false;
  return TABLE.cushions.every((cushion) => distanceToSegment(p, cushion.a, cushion.b) >= BALL_RADIUS - slack);
}
