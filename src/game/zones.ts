/**
 * Position zones: pot the ball, and leave the cue ball in a zone, as a player
 * plays for the next shot.
 *
 * Every zone is one the cue ball can reach. The layout is dealt as an
 * ordinary cut, then strokes are tried on its ideal line, at a spread of
 * speeds and tips, until one pots the ball cleanly and leaves the cue ball
 * in open table; the zone is centred where that one stopped. Finding a
 * stroke that does it is the drill, so the line is shown and the speed and
 * tip are left to the player.
 */

import type { ClothPreset } from '../constants';
import { TABLE, isInLegalBounds } from '../geometry/table';
import { type Vec2, dist } from '../geometry/vec2';
import { type ShotLayout, idealAimAngle } from './drills';
import { generateShot } from './generator';
import type { LevelDefinition } from './levels';
import { powerForCueSpeed } from './power';
import { makeRng } from './random';
import { ShotSession } from './shot-session';

/** The zone's radius, in metres: about the room a player gives themselves for the next shot. */
export const ZONE_SIZE = 0.15;

/** A zone keeps this far from every pocket, so it is somewhere to play from rather than into. */
const POCKET_CLEAR = 0.2;

/** Layouts tried before settling for a zone against a cushion, and strokes tried on each. */
const DEALS = 4;
const STROKES = 12;

/** Where the cue ball stops after the ideal line at `speed` and `tip`, if it pots cleanly. */
export function restAfter(layout: ShotLayout, speed: number, tip: number, cloth: ClothPreset): Vec2 | undefined {
  const session = new ShotSession(layout, { cloth });
  session.aimTo(idealAimAngle(layout));
  session.setTip(tip);
  session.beginCharge();
  session.setPower(powerForCueSpeed(speed));
  session.release();
  for (let frame = 0; session.phase === 'simulating' && frame < 3600; frame++) session.advance(1 / 60);
  const outcome = session.evaluate();
  if (!outcome?.pottedTarget || outcome.scratch) return undefined;
  return session.cueBall.pos;
}

/** Open table: off the cushions by the zone's size, and clear of every pocket. */
export function isOpen(point: Vec2): boolean {
  return isInLegalBounds(point, ZONE_SIZE) && TABLE.pockets.every((pocket) => dist(point, pocket.center) > POCKET_CLEAR + ZONE_SIZE);
}

/** A cut with a zone the cue ball can be played into. */
export function zoneLayout(level: LevelDefinition, seed: number, cloth: ClothPreset = 'normal'): ShotLayout {
  const rng = makeRng((seed ^ 0x2545f491) >>> 0);
  let fallback: ShotLayout | undefined;
  for (let deal = 0; deal < DEALS; deal++) {
    const { layout } = generateShot(level, (seed + deal * 104_729) >>> 0, { preferredSide: deal % 2 === 0 ? 'left' : 'right' });
    for (let stroke = 0; stroke < STROKES; stroke++) {
      const rest = restAfter(layout, 1.2 + rng() * 2, -0.4 + rng() * 0.8, cloth);
      if (!rest) continue;
      const zoned = { ...layout, spot: rest, spotRadius: ZONE_SIZE };
      if (isOpen(rest)) return zoned;
      fallback ??= zoned;
    }
  }
  // Every stroke tried left it against a cushion or by a pocket: a zone there is still a reachable one.
  return fallback ?? { ...generateShot(level, seed).layout };
}
