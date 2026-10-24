/**
 * The straight-in shot the documented power figures are quoted for.
 */

import { layoutWithCut } from '../../src/game/drills';
import { aimPoint } from '../../src/geometry/pocket-window';
import { type ShotAnalysis, analyseShot } from '../../src/geometry/shot';
import { pocketById } from '../../src/geometry/table';
import { normalize, scale, sub, vec } from '../../src/geometry/vec2';

/**
 * Straight in to the top-right corner, `potDistance` from the object ball to
 * where it is aimed and `cueDistance` from the cue ball to the ghost ball: the
 * two numbers the levels are specified in. Laid along (2, 1) so it fits on a
 * 7-foot table.
 *
 * The aim point is the middle of the pocket's clean band, which moves a little
 * as the object ball does, so the object ball is walked along its own line
 * until the distance to it holds.
 */
export function straightShot(potDistance: number, cueDistance: number): ShotAnalysis {
  const pocket = pocketById('top-right');
  let object = sub(pocket.center, scale(normalize(vec(2, 1)), potDistance));
  for (let i = 0; i < 8; i++) {
    const target = aimPoint(object, pocket);
    object = sub(target, scale(normalize(sub(target, object)), potDistance));
  }
  const { cue } = layoutWithCut('straight-in', object, pocket.id, 0, cueDistance);
  return analyseShot({ cue, object, pocket, obstacles: [] });
}
