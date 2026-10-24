/**
 * The effective pocket: the band of headings along which the object ball drops
 * clean, and the middle of it, which is where the object ball is aimed.
 *
 * A pocket is not a point. Coming into a corner at a flat angle, a ball sent
 * at the corner of the table catches the rail on its way in, and one sent at
 * the middle of the mouth clips the far facing. What drops is a band of lines,
 * and the line with the most room either side of it is the middle of that
 * band. Straight in, that is the middle of the mouth. Come into a corner at an
 * angle and the far facing closes the band from its far side, so its middle
 * moves toward the rail the ball is running along, though not as far as the
 * corner point this trainer aimed at before its pockets had jaws.
 *
 * A line is clean, in the solver's own terms, when the ball's centre crosses
 * the drop line before it comes within a radius of any cushion or facing. A
 * ball touching a rail and running along it, or away from it, never meets it.
 *
 * One more condition only matters on or near a rail: the cue ball has to be
 * able to send the ball that way. The ghost ball sits a diameter behind the
 * object ball, so turning the line away from a rail the object ball is frozen
 * to puts the ghost ball into the rubber. For a frozen ball sent along its own
 * rail the band closes to the one line along the rail, with the ghost ball
 * frozen too: hit the rail and the ball together, which is what a player is
 * taught for that shot.
 *
 * Pure geometry, like the rest of this directory. Nothing here runs the
 * simulation.
 */

import { BALL_RADIUS, type Pocket, type PocketId, TABLE } from './table';
import {
  type Vec2,
  add,
  angleOf,
  distanceBetweenSegments,
  distanceToSegment,
  dot,
  fromAngle,
  scale,
  signedAngleBetween,
  sub,
} from './vec2';

export interface PocketWindow {
  /** The band of clean headings, in radians: `low` is its clockwise edge, `high` its counter-clockwise one. */
  readonly low: number;
  readonly high: number;
  /** The middle of the band: the heading to send the object ball along. */
  readonly heading: number;
  /** Where that heading crosses the drop line: the point the object ball is aimed at. */
  readonly target: Vec2;
}

/**
 * Allowance on "a radius from the rubber" for the object ball's own path, so a
 * ball frozen to a rail can run along it. The ghost ball gets none: the cue
 * ball has to reach the object ball before it reaches the rail, or the rail
 * takes its share of the stroke first.
 */
const TOUCHING = 1e-9;

/** Spacing of the headings tried across the drop line. A band narrower than this is not worth playing. */
const SCAN_STEP = (0.05 * Math.PI) / 180;

/**
 * How finely the edges of the band are found, in radians. Fine enough to
 * resolve the band of a ball frozen to a rail and sent along it, which is about
 * a nanoradian wide: `TOUCHING` over the length of the rail run. Its middle
 * leaves the ghost ball a few hundredths of a nanometre clear of the rail, so
 * the cue ball reaches the object ball first rather than in a dead heat.
 */
const EDGE_PRECISION = 1e-12;

/**
 * A ball within this of touching a rail tries the rail's own line as well. Its
 * band can be far narrower than the scan step, and for a frozen ball it is the
 * rail's line and nothing else.
 */
const NEAR_RAIL = 0.002;

let last: { readonly x: number; readonly y: number; readonly pocket: PocketId; readonly window?: PocketWindow } | undefined;

/**
 * The band of clean headings from `object` into `pocket`, or undefined when
 * every line meets rubber first. The widest band, if the jaws split it.
 *
 * Remembers its last answer: the session asks for the same layout every frame.
 */
export function pocketWindow(object: Vec2, pocket: Pocket): PocketWindow | undefined {
  if (last && last.x === object.x && last.y === object.y && last.pocket === pocket.id) return last.window;
  const window = findWindow(object, pocket);
  last = { x: object.x, y: object.y, pocket: pocket.id, ...(window ? { window } : {}) };
  return window;
}

/** The point to send the object ball at: the middle of the clean band, or the pocket's centre if there is none. */
export function aimPoint(object: Vec2, pocket: Pocket): Vec2 {
  return pocketWindow(object, pocket)?.target ?? pocket.center;
}

/**
 * Where a ball sent from `object` along `heading` crosses `pocket`'s drop line,
 * if it gets there without meeting rubber and a cue ball could have sent it.
 */
export function cleanDrop(object: Vec2, heading: number, pocket: Pocket): Vec2 | undefined {
  const { a, b, normal } = pocket.drop;
  const direction = fromAngle(heading);
  const ahead = dot(sub(a, object), normal);
  const closing = dot(direction, normal);
  if (ahead <= 0 || closing <= 0) return undefined;

  const at = add(object, scale(direction, ahead / closing));
  const along = sub(b, a);
  const span = dot(sub(at, a), along) / dot(along, along);
  if (span <= 0 || span >= 1) return undefined;

  const ghost = sub(object, scale(direction, 2 * BALL_RADIUS));
  for (const cushion of TABLE.cushions) {
    if (distanceBetweenSegments(object, at, cushion.a, cushion.b) < BALL_RADIUS - TOUCHING) return undefined;
    if (distanceToSegment(ghost, cushion.a, cushion.b) < BALL_RADIUS) return undefined;
  }
  return at;
}

/**
 * Scan the headings that cross the drop line, from one end to the other, then
 * close in on the edges of each run that drops clean. Headings are measured as
 * a sweep `s` from the line to the drop line's first end, so a band never
 * straddles the wrap at pi.
 */
function findWindow(object: Vec2, pocket: Pocket): PocketWindow | undefined {
  const toFirst = sub(pocket.drop.a, object);
  const sweep = signedAngleBetween(toFirst, sub(pocket.drop.b, object));
  if (sweep === 0) return undefined;
  const start = angleOf(toFirst);
  const turn = Math.sign(sweep);
  const width = Math.abs(sweep);
  const heading = (s: number): number => start + turn * s;
  const clean = (s: number): boolean => s > 0 && s < width && cleanDrop(object, heading(s), pocket) !== undefined;

  const samples: number[] = [];
  for (let s = 0; s < width; s += SCAN_STEP) samples.push(s);
  samples.push(width);
  for (const rail of TABLE.rails) {
    if (distanceToSegment(object, rail.a, rail.b) > BALL_RADIUS + NEAR_RAIL) continue;
    for (const along of [sub(rail.b, rail.a), sub(rail.a, rail.b)]) {
      const s = turn * signedAngleBetween(toFirst, along);
      if (s > 0 && s < width) samples.push(s);
    }
  }
  samples.sort((p, q) => p - q);

  // Both ends of the drop line meet a facing, so every run has a failing
  // sample either side of it.
  let best: { readonly low: number; readonly high: number } | undefined;
  for (let i = 1; i < samples.length - 1; i++) {
    if (!clean(samples[i]!)) continue;
    let j = i;
    while (j + 1 < samples.length - 1 && clean(samples[j + 1]!)) j++;
    const low = edge(samples[i - 1]!, samples[i]!, clean);
    const high = edge(samples[j + 1]!, samples[j]!, clean);
    if (!best || high - low > best.high - best.low) best = { low, high };
    i = j;
  }
  if (!best) return undefined;

  const middle = (best.low + best.high) / 2;
  const target = cleanDrop(object, heading(middle), pocket);
  // A run with a gap in it narrower than the scan: no clean middle to aim at.
  if (!target) return undefined;
  const [low, high] = turn > 0 ? [best.low, best.high] : [best.high, best.low];
  return { low: heading(low), high: heading(high), heading: heading(middle), target };
}

/** Bisect between a heading that fails and one that is clean; returns the clean side of the edge. */
function edge(failing: number, passing: number, clean: (s: number) => boolean): number {
  while (Math.abs(passing - failing) > EDGE_PRECISION) {
    const mid = (failing + passing) / 2;
    if (clean(mid)) passing = mid;
    else failing = mid;
  }
  return passing;
}
