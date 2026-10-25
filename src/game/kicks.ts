/**
 * Kicks and safeties, centre ball: the shots for when there is no pot.
 *
 * A kick: a ball sits straight between the cue ball and the object ball, so
 * the object ball has to be reached off a cushion first. The mirror system
 * aims at the object ball's reflection in the cushion, on the line the ball's
 * centre rolls along against it; this table's cushions throw a rolling ball
 * a little off a true mirror, as real ones do, so the reflection is a place
 * to start rather than the answer. It scores on the cue ball's contacts: a
 * cushion, then the object ball before anything else.
 *
 * A safety: hit the object ball, and leave the next player no direct pot,
 * from where the cue ball stops, at any pocket, with two other balls on the
 * table to hide behind. "Direct" is the trainer's own test of a shot it would
 * deal: a line to the ghost ball and on to the pocket that nothing blocks, a
 * cut it allows, and a stroke that gets there.
 */

import { BALL_RADIUS, POCKET_IDS, type PocketId, TABLE, isInLegalBounds, nearestPocket, pocketById, pocketOnPath } from '../geometry/table';
import { analyseShot } from '../geometry/shot';
import { type Vec2, dist, distanceToSegment, lerp, vec } from '../geometry/vec2';
import type { SimEvent } from '../physics/world';
import type { ShotLayout } from './drills';
import { makeRng } from './random';

export type Cushion = 'top' | 'bottom' | 'left' | 'right';

/** The object ball reflected in a cushion, across the line its centre rolls along against it. */
export function mirrorIn(cushion: Cushion, object: Vec2): Vec2 {
  const { minX, maxX, minY, maxY } = TABLE.bounds;
  switch (cushion) {
    case 'top':
      return vec(object.x, 2 * maxY - object.y);
    case 'bottom':
      return vec(object.x, 2 * minY - object.y);
    case 'left':
      return vec(2 * minX - object.x, object.y);
    case 'right':
      return vec(2 * maxX - object.x, object.y);
  }
}

/** Where the line from the cue ball to the mirror meets the cushion, if it does between them. */
function bankPoint(cushion: Cushion, cue: Vec2, mirror: Vec2): Vec2 | undefined {
  const { minX, maxX, minY, maxY } = TABLE.bounds;
  const vertical = cushion === 'top' || cushion === 'bottom';
  const line = cushion === 'top' ? maxY : cushion === 'bottom' ? minY : cushion === 'left' ? minX : maxX;
  const from = vertical ? cue.y : cue.x;
  const to = vertical ? mirror.y : mirror.x;
  const t = (line - from) / (to - from);
  if (!(t > 0 && t < 1)) return undefined;
  return lerp(cue, mirror, t);
}

/** Far enough from the balls' paths to leave them clear. */
const PATH_CLEAR = 2 * BALL_RADIUS + 0.03;

/** The longest way round a kick takes, cue ball to cushion to object ball, in metres. */
const KICK_PATH = 1.8;

/**
 * A kick: the object ball blocked from the cue ball by a ball straight
 * between them, and a one-cushion line round it, banking well clear of the
 * pockets. The layout carries the mirror point to aim at.
 */
export function kickLayout(seed: number, id: string): ShotLayout {
  const rng = makeRng(seed);
  const cushions: readonly Cushion[] = ['top', 'bottom', 'left', 'right'];
  for (let attempt = 0; attempt < 500; attempt++) {
    // The long cushions three times as often: most kicks are played off them.
    const cushion = cushions[rng() < 0.75 ? Math.floor(rng() * 2) : 2 + Math.floor(rng() * 2)]!;
    const object = vec((rng() * 2 - 1) * 0.8, (rng() * 2 - 1) * 0.3);
    const cue = vec((rng() * 2 - 1) * 0.8, (rng() * 2 - 1) * 0.3);
    const apart = dist(cue, object);
    if (apart < 0.5 || apart > 1.3) continue;
    const mirror = mirrorIn(cushion, object);
    const bank = bankPoint(cushion, cue, mirror);
    if (!bank || nearPocket(bank, 0.15) || dist(cue, bank) + dist(bank, object) > KICK_PATH) continue;
    const blocker = lerp(cue, object, 0.5);
    if (distanceToSegment(blocker, cue, bank) < PATH_CLEAR || distanceToSegment(blocker, bank, object) < PATH_CLEAR) continue;
    if (pocketOnPath(cue, bank, { margin: 0.02 }) || pocketOnPath(bank, object, { margin: 0.02 })) continue;
    return { id, cue, object, targetPocket: nearestPocket(object).id, obstacles: [blocker], mirror };
  }
  // Up the middle, blocker between, off the top cushion: always there.
  const cue = vec(-0.5, -0.1);
  const object = vec(0.5, -0.1);
  return { id, cue, object, targetPocket: nearestPocket(object).id, obstacles: [vec(0, -0.1)], mirror: mirrorIn('top', object) };
}

function nearPocket(point: Vec2, clear: number): boolean {
  return TABLE.pockets.some((pocket) => dist(point, pocket.center) < clear + 0.06);
}

export type KickResult = 'kicked' | 'no-cushion' | 'other-ball' | 'missed';

/** A kick, from the cue ball's contacts: a cushion first, then the object ball before any other. */
export function kickResult(events: readonly SimEvent[]): KickResult {
  const touch = events.find((event) => event.type === 'ball-ball' && (event.a === 0 || event.b === 0));
  if (!touch || touch.type !== 'ball-ball') return 'missed';
  const other = touch.a === 0 ? touch.b : touch.a;
  if (other !== 1) return 'other-ball';
  const cushioned = events.some((event) => event.type === 'cushion' && event.ball === 0 && event.time <= touch.time);
  return cushioned ? 'kicked' : 'no-cushion';
}

/**
 * A safety to play: an object ball the cue ball can hit straight, and two
 * other balls to hide behind, all clear of each other and of the cushions.
 */
export function safetyLayout(seed: number, id: string): ShotLayout {
  const rng = makeRng(seed);
  const spot = (): Vec2 => vec((rng() * 2 - 1) * 0.8, (rng() * 2 - 1) * 0.35);
  for (let attempt = 0; attempt < 500; attempt++) {
    const [cue, object, first, second] = [spot(), spot(), spot(), spot()];
    const balls = [cue, object, first, second];
    if (balls.some((a, i) => balls.some((b, j) => j > i && dist(a, b) < 0.18))) continue;
    if (dist(cue, object) > 1.1) continue;
    // A direct hit on the object ball, so the safety is the player's to play.
    if (distanceToSegment(first, cue, object) < PATH_CLEAR || distanceToSegment(second, cue, object) < PATH_CLEAR) continue;
    const layout: ShotLayout = { id, cue, object, targetPocket: nearestPocket(object).id, obstacles: [first, second] };
    // And a pot there now, so playing safe is a choice rather than a given.
    if (directPot(cue, object, [first, second]) === undefined) continue;
    return layout;
  }
  const cue = vec(-0.4, 0);
  const object = vec(0.2, 0.1);
  return { id, cue, object, targetPocket: nearestPocket(object).id, obstacles: [vec(0.5, -0.25), vec(-0.2, 0.3)] };
}

/** The pocket a direct pot of the object ball goes to from `cue`, if any pocket has one. */
export function directPot(cue: Vec2, object: Vec2, others: readonly Vec2[]): PocketId | undefined {
  if (!isInLegalBounds(cue) || !isInLegalBounds(object)) return undefined;
  return POCKET_IDS.find((id) => analyseShot({ cue, object, pocket: pocketById(id), obstacles: others }).reachable);
}

export type SafetyResult =
  | { readonly kind: 'safe' }
  | { readonly kind: 'pot-left'; readonly pocket: PocketId }
  | { readonly kind: 'potted' | 'scratch' | 'foul' };

/**
 * A safety, from where the balls stopped: the object ball hit first, nothing
 * potted, and no direct pot left from the cue ball.
 */
export function safetyResult(
  events: readonly SimEvent[],
  cue: { readonly pos: Vec2; readonly potted: boolean },
  object: { readonly pos: Vec2; readonly potted: boolean },
  others: readonly Vec2[],
): SafetyResult {
  if (cue.potted) return { kind: 'scratch' };
  if (kickResult(events) === 'missed' || kickResult(events) === 'other-ball') return { kind: 'foul' };
  if (object.potted) return { kind: 'potted' };
  const pocket = directPot(cue.pos, object.pos, others);
  return pocket === undefined ? { kind: 'safe' } : { kind: 'pot-left', pocket };
}
