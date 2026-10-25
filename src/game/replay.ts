/**
 * When a replay can hand back to the shot: once nothing is left to see but
 * balls creeping to a stop. At a quarter speed that last crawl takes seconds
 * to watch and shows nothing new, and where each ball stopped is on the shot
 * screen the replay hands back to, in its trail.
 */

import { len } from '../geometry/vec2';
import type { Ball } from '../physics/world';

/** Below this, in its own speed and in its spin's, a ball only creeps. */
export const CREEP_SPEED = 0.25;

/**
 * How long a replay runs on past the shot's last contact or drop, in simulated
 * seconds: 0.4 s at a quarter speed, long enough to see a potted ball fall.
 */
export const REPLAY_BEAT = 0.1;

/**
 * Whether a replay `elapsed` seconds in can hand back. It must be past the
 * shot's last event by a beat, so no contact, cushion or drop is still to
 * come; a soft stroke creeping up on the object ball has one ahead of it.
 * And every ball on the table must be creeping, its spin included, as `roll`:
 * a slow ball with draw or follow on it is about to go somewhere.
 */
export function onlyCreepingLeft(balls: readonly Ball[], elapsed: number, lastEventTime: number): boolean {
  if (elapsed < lastEventTime + REPLAY_BEAT) return false;
  return balls.every((ball) => ball.potted || (len(ball.vel) < CREEP_SPEED && len(ball.roll) < CREEP_SPEED));
}
