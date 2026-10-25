/**
 * Patterns: two or three balls to pot in order, the cue ball carried from
 * each shot to the next, as a player runs out.
 *
 * Every pattern can be run. It is built forward: an ordinary cut first; then
 * a stroke on its ideal line that pots cleanly and leaves the cue ball in open
 * table; then the next ball placed as an ordinary cut from where the cue ball
 * stopped; and so on. Last, the whole run is replayed with every ball on the
 * table from the start, and kept only if the later balls change nothing about
 * the earlier shots.
 */

import type { ClothPreset } from '../constants';
import { POCKET_IDS, type PocketId } from '../geometry/table';
import { type Vec2, add, dist, fromAngle } from '../geometry/vec2';
import { type ShotLayout, idealAimAngle } from './drills';
import { generateShot, layoutViolations } from './generator';
import type { LevelDefinition } from './levels';
import { powerForCueSpeed } from './power';
import { makeRng } from './random';
import { ShotSession } from './shot-session';
import { isOpen } from './zones';

/** How many balls a pattern has at each tier. */
export const PATTERN_SIZES: readonly number[] = [2, 2, 3, 3];

export interface Pattern {
  /** Where the cue ball starts. */
  readonly cue: Vec2;
  /** The balls, in the order they are to be potted, and the pocket for each. */
  readonly balls: readonly Vec2[];
  readonly pockets: readonly PocketId[];
}

interface Stroke {
  readonly speed: number;
  readonly tip: number;
  readonly rest: Vec2;
}

/** Where a replayed cue ball may stop and still be the same run. */
const SAME_REST = 0.03;

/** Shot `index` of a pattern, from `cue`: the balls still to come are on the table. */
export function patternLayout(pattern: Pattern, index: number, cue: Vec2, id: string): ShotLayout {
  return {
    id,
    cue,
    object: pattern.balls[index]!,
    targetPocket: pattern.pockets[index]!,
    obstacles: pattern.balls.slice(index + 1),
  };
}

/** The shot played on its ideal line at a stroke: where the cue ball stops, if it pots cleanly. */
function play(layout: ShotLayout, speed: number, tip: number, cloth: ClothPreset): Vec2 | undefined {
  const session = new ShotSession(layout, { cloth });
  session.aimTo(idealAimAngle(layout));
  session.setTip(tip);
  session.beginCharge();
  session.setPower(powerForCueSpeed(speed));
  session.release();
  for (let frame = 0; session.phase === 'simulating' && frame < 3600; frame++) session.advance(1 / 60);
  const outcome = session.evaluate();
  if (!outcome?.pottedTarget || outcome.scratch) return undefined;
  // Another ball dropped too, or was moved: not the clean run this is meant to be.
  if (session.balls.slice(2).some((ball, i) => ball.potted || dist(ball.pos, layout.obstacles![i]!) > 1e-6)) return undefined;
  return session.cueBall.pos;
}

/** A stroke that pots this one cleanly and leaves the cue ball in open table. */
function findStroke(layout: ShotLayout, rng: () => number, cloth: ClothPreset): Stroke | undefined {
  for (let attempt = 0; attempt < 16; attempt++) {
    const speed = 1 + rng() * 1.8;
    const tip = -0.3 + rng() * 0.6;
    const rest = play(layout, speed, tip, cloth);
    if (rest && isOpen(rest)) return { speed, tip, rest };
  }
  return undefined;
}

/** The next ball: an ordinary cut for `level` from `cue`, clear of the balls already placed. */
function placeNext(
  cue: Vec2,
  placed: readonly Vec2[],
  level: LevelDefinition,
  rng: () => number,
): { readonly object: Vec2; readonly pocket: PocketId } | undefined {
  for (let attempt = 0; attempt < 80; attempt++) {
    const reach = level.cueDistance[0] + rng() * (level.cueDistance[1] - level.cueDistance[0]);
    const candidate = add(cue, fromAngle(rng() * 2 * Math.PI, reach));
    if (!isOpen(candidate) || placed.some((ball) => dist(ball, candidate) < 0.15)) continue;
    const pocket = POCKET_IDS[Math.floor(rng() * POCKET_IDS.length)]!;
    const layout: ShotLayout = { id: 'next', cue, object: candidate, targetPocket: pocket, obstacles: [] };
    if (layoutViolations(layout, level).length === 0) return { object: candidate, pocket };
  }
  return undefined;
}

/** With every ball on the table from the start, the strokes still run the pattern the same way. */
function replays(pattern: Pattern, strokes: readonly Stroke[], cloth: ClothPreset): boolean {
  let cue = pattern.cue;
  for (let index = 0; index < pattern.balls.length; index++) {
    const stroke = strokes[index]!;
    const rest = play(patternLayout(pattern, index, cue, 'replay'), stroke.speed, stroke.tip, cloth);
    if (!rest || dist(rest, stroke.rest) > SAME_REST) return false;
    cue = rest;
  }
  return true;
}

/** A pattern of `count` balls that can be run, for a level's kind of cut. */
export function dealPattern(count: number, level: LevelDefinition, seed: number, cloth: ClothPreset = 'normal'): Pattern {
  const rng = makeRng((seed ^ 0x51ed270b) >>> 0);
  for (let attempt = 0; attempt < 40; attempt++) {
    const first = generateShot(level, (seed + attempt * 104_729) >>> 0).layout;
    const balls: Vec2[] = [first.object];
    const pockets: PocketId[] = [first.targetPocket];
    const strokes: Stroke[] = [];
    let cue = first.cue;
    for (let index = 0; index < count; index++) {
      const layout: ShotLayout = { id: 'build', cue, object: balls[index]!, targetPocket: pockets[index]!, obstacles: [] };
      const stroke = findStroke(layout, rng, cloth);
      if (!stroke) break;
      strokes.push(stroke);
      if (index === count - 1) break;
      const next = placeNext(stroke.rest, [first.cue, ...balls], level, rng);
      if (!next) break;
      balls.push(next.object);
      pockets.push(next.pocket);
      cue = stroke.rest;
    }
    const pattern = { cue: first.cue, balls, pockets };
    if (strokes.length === count && replays(pattern, strokes, cloth)) return pattern;
  }
  // Nothing ran out: one ball, which is a pattern of one rather than none.
  const only = generateShot(level, seed).layout;
  return { cue: only.cue, balls: [only.object], pockets: [only.targetPocket] };
}
