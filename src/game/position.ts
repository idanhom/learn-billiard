/**
 * Cue ball position: the stop shot, and ladders of follow and draw.
 *
 * Straight-in shots, played with the player's own aim, power and tip. A shot
 * counts when it pots the ball and leaves the cue ball within ZONE_RADIUS of
 * a spot on the shot's line: where the cue ball meets the object ball for a
 * stop shot, so far past it for follow, so far back for draw. A level's tiers
 * are the rungs of its ladder, the spot a little further at each.
 */

import { type Vec2, add, dot, normalize, scale, sub } from '../geometry/vec2';

export type PositionTarget = 'stop' | 'follow' | 'draw';

/** How near the spot the cue ball has to stop, in metres. */
export const ZONE_RADIUS = 0.1;

/** How far past contact (follow) or back from it (draw) the spot is at each rung, in metres. */
export const RUNGS: Readonly<Record<PositionTarget, readonly number[]>> = {
  stop: [0, 0, 0, 0],
  follow: [0.2, 0.4, 0.6, 0.8],
  draw: [0.2, 0.35, 0.5, 0.65],
};

/**
 * The distances a layout needs for a spot `distance` away: room between the
 * ghost ball and the pocket to follow into, or between the cue ball and the
 * ghost ball to draw back into, with a quarter metre to spare.
 */
export function rungDistances(
  target: PositionTarget,
  distance: number,
): { readonly cueDistance: readonly [number, number]; readonly potDistance: readonly [number, number] } {
  switch (target) {
    case 'stop':
      return { cueDistance: [0.3, 0.9], potDistance: [0.3, 0.8] };
    case 'follow':
      return { cueDistance: [0.3, 0.5], potDistance: [distance + 0.25, distance + 0.6] };
    case 'draw':
      return { cueDistance: [distance + 0.25, distance + 0.55], potDistance: [0.3, 0.6] };
  }
}

/** The spot for a target `distance` along the shot, from the ghost ball. */
export function zoneCentre(target: PositionTarget, distance: number, cue: Vec2, ghost: Vec2): Vec2 {
  const along = normalize(sub(ghost, cue));
  if (target === 'stop') return ghost;
  return add(ghost, scale(along, target === 'follow' ? distance : -distance));
}

export interface PositionResult {
  /** How far from the spot the cue ball stopped, in metres. */
  readonly off: number;
  /** Past the spot, the way the cue ball was travelling, in metres: negative when short of it. */
  readonly long: number;
  /** To one side of the shot's line, in metres. */
  readonly wide: number;
  readonly potted: boolean;
  readonly scratch: boolean;
  readonly correct: boolean;
}

/** Where the cue ball came to rest, against the spot. */
export function scorePosition(
  target: PositionTarget,
  rest: Vec2,
  spot: Vec2,
  cue: Vec2,
  ghost: Vec2,
  potted: boolean,
  scratch: boolean,
): PositionResult {
  const line = normalize(sub(ghost, cue));
  // A stop shot and a follow shot travel down the line; a draw shot comes back up it.
  const travel = target === 'draw' ? scale(line, -1) : line;
  const miss = sub(rest, spot);
  const long = dot(miss, travel);
  const wide = Math.abs(miss.x * travel.y - miss.y * travel.x);
  const off = Math.hypot(long, wide);
  return { off, long, wide, potted, scratch, correct: potted && !scratch && off <= ZONE_RADIUS };
}
