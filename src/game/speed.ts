/**
 * Speed: the cue ball on its own, with no object ball to aim at.
 *
 * Speed control asks it to stop in a ring a set distance away, touching no
 * cushion, the ring further at each rung. The lag sends it to the far cushion
 * and back, to stop in a ring by the near one without touching it, as players
 * lag for the break. Both are scored on where the cue ball stops.
 */

import { BALL_RADIUS, PLAY_LENGTH, isInLegalBounds, pocketOnPath } from '../geometry/table';
import { type Vec2, add, dot, fromAngle, normalize, scale, sub, vec } from '../geometry/vec2';
import type { ShotLayout } from './drills';
import { ZONE_RADIUS } from './position';
import { makeRng } from './random';

export type SpeedTarget = 'distance' | 'lag';

/** How far the ring is at each rung of speed control, in metres. */
export const SPEED_RUNGS: readonly number[] = [0.5, 0.85, 1.2, 1.5];

/** Clear table past the ring, so a ball a little long runs on rather than off a cushion. */
export const SPEED_ROOM = 0.25;

/** The lag's ring: its centre this far from the near cushion's nose, to the ball's edge. */
export const LAG_GAP = 0.06;

/** Somewhere for the object ball, out of play, well clear of the cue ball. */
function outOfPlay(cue: Vec2): Vec2 {
  return cue.x < 0 ? vec(0.7, 0.3) : vec(-0.7, 0.3);
}

/**
 * A layout for speed control with the ring `distance` away, or for the lag.
 * The object ball is out of play; the layout carries the ring's centre.
 */
export function speedLayout(target: SpeedTarget, distance: number, seed: number, id: string): ShotLayout {
  const rng = makeRng(seed);
  if (target === 'lag') {
    // Behind the head string, sent to the foot cushion and back down the same line.
    const y = (rng() * 2 - 1) * 0.25;
    const cue = vec(-PLAY_LENGTH / 2 + 0.25 + rng() * 0.2, y);
    const spot = vec(-PLAY_LENGTH / 2 + BALL_RADIUS + LAG_GAP, y);
    return { id, cue, object: outOfPlay(cue), targetPocket: 'top-right', objectAway: true, spot, heading: 0 };
  }
  for (let attempt = 0; attempt < 400; attempt++) {
    const heading = rng() * 2 * Math.PI;
    const cue = vec((rng() * 2 - 1) * (PLAY_LENGTH / 2 - 0.15), (rng() * 2 - 1) * 0.35);
    const spot = add(cue, fromAngle(heading, distance));
    const layout: ShotLayout = { id, cue, object: outOfPlay(cue), targetPocket: 'top-right', objectAway: true, spot, heading };
    if (speedViolations(layout, target).length === 0) return layout;
  }
  // From the head cushion straight up the middle, which always has the room.
  const cue = vec(-PLAY_LENGTH / 2 + 0.09, 0);
  const spot = add(cue, vec(distance, 0));
  return { id, cue, object: outOfPlay(cue), targetPocket: 'top-right', objectAway: true, spot, heading: 0 };
}

export type SpeedViolation = 'cue-off-table' | 'ring-off-table' | 'no-room-past-ring' | 'path-over-pocket';

/**
 * What is wrong with a speed layout: off the table, or, for speed control, no
 * room past the ring. The lag's ring sits against its cushion on purpose.
 */
export function speedViolations(layout: ShotLayout, target: SpeedTarget): SpeedViolation[] {
  const spot = layout.spot;
  if (!spot) return ['ring-off-table'];
  const violations: SpeedViolation[] = [];
  if (!isInLegalBounds(layout.cue, 0.05)) violations.push('cue-off-table');
  if (target === 'lag') {
    if (!isInLegalBounds(spot)) violations.push('ring-off-table');
    return violations;
  }
  if (!isInLegalBounds(spot, ZONE_RADIUS)) violations.push('ring-off-table');
  const beyond = add(spot, scale(normalize(sub(spot, layout.cue)), SPEED_ROOM));
  if (!isInLegalBounds(beyond)) violations.push('no-room-past-ring');
  if (pocketOnPath(layout.cue, beyond, { margin: 0.02 })) violations.push('path-over-pocket');
  return violations;
}

export interface SpeedResult {
  /** How far from the ring's centre the cue ball stopped, in metres. */
  readonly off: number;
  /** Past the centre, the way the ball was last travelling: negative when short. */
  readonly long: number;
  readonly wide: number;
  /** How many cushions the cue ball touched. */
  readonly cushions: number;
  readonly correct: boolean;
}

/**
 * Where the cue ball stopped, against the ring. Speed control may touch no
 * cushion; the lag touches the far one and only that.
 */
export function scoreSpeed(target: SpeedTarget, rest: Vec2, layout: ShotLayout, cushions: number): SpeedResult {
  const spot = layout.spot!;
  // The lag comes back down the table; speed control runs on away from the cue.
  const travel = target === 'lag' ? vec(-1, 0) : normalize(sub(spot, layout.cue));
  const miss = sub(rest, spot);
  const long = dot(miss, travel);
  const wide = Math.abs(miss.x * travel.y - miss.y * travel.x);
  const off = Math.hypot(long, wide);
  const cushionsOk = target === 'lag' ? cushions === 1 : cushions === 0;
  return { off, long, wide, cushions, correct: cushionsOk && off <= ZONE_RADIUS };
}
