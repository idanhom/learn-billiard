/**
 * Seeded shot generator.
 *
 * Placement is constructive rather than rejection-sampled from thin air: pick a
 * pocket, put the object ball at a legal distance from it, then place the cue
 * ball at the cut angle the level asks for. Every candidate is then checked
 * against the level's invariants, and a candidate that fails is discarded
 * rather than patched. If the brief cannot be met inside the retry budget the
 * level's template shot is used, so the player always gets a playable layout.
 *
 * The seed is part of the layout id, so any shot can be reproduced exactly.
 */

import { SLOWEST_CLOTH, clothRollingFriction } from '../constants';
import { aimPoint, pocketWindow } from '../geometry/pocket-window';
import { analyseShot, ghostBallCenter, isPowerFeasible } from '../geometry/shot';
import {
  BALL_RADIUS,
  TABLE,
  type Pocket,
  isInLegalBounds,
  isInPocketMouth,
  pocketById,
  pocketOnPath,
} from '../geometry/table';
import { type Vec2, add, angleOf, dist, fromAngle, normalize, rotate, scale, sub, vec } from '../geometry/vec2';
import { type ShotLayout, layoutWithCut } from './drills';
import { DEPARTURE_ROOM, ruleDirection } from './departure';
import type { LevelDefinition } from './levels';
import { makeRng } from './random';

export type LayoutViolation =
  | 'pocket-closed'
  | 'cue-off-table'
  | 'object-off-table'
  | 'balls-overlap'
  | 'ghost-off-table'
  | 'cut-out-of-range'
  | 'cut-too-steep'
  | 'cue-path-blocked'
  | 'object-path-blocked'
  | 'underpowered'
  | 'pot-distance-out-of-range'
  | 'cue-distance-out-of-range'
  | 'not-rail-adjacent'
  | 'cue-in-pocket'
  | 'object-in-pocket'
  | 'cue-path-enters-pocket'
  | 'object-path-enters-pocket'
  | 'no-room-for-cue-ball';

export interface GenerateOptions {
  readonly preferredSide?: 'left' | 'right';
  readonly maxAttempts?: number;
}

export interface GeneratedShot {
  readonly layout: ShotLayout;
  readonly seed: number;
  readonly attempts: number;
  readonly fromTemplate: boolean;
}

const DEFAULT_MAX_ATTEMPTS = 400;

/** Keep a little daylight between balls so a layout never starts in contact. */
const SEPARATION_MARGIN = 0.006;

/**
 * Clearance a ball and its route must keep from every pocket it is not aimed
 * at. Without it the generator produced shots the player could not make at any
 * angle or power: the cue ball rolled over a pocket on its way to the object
 * ball and vanished, so the shot reported "missed the object ball" for ever.
 * Half a ball's width keeps layouts off the knife edge as well as out of it.
 */
const POCKET_CLEARANCE = BALL_RADIUS / 2;

/** How wide a fan of object-ball positions to sample in front of each pocket. */
const CORNER_CONE = (100 * Math.PI) / 180;
const SIDE_CONE = (150 * Math.PI) / 180;

export function generateShot(
  level: LevelDefinition,
  seed: number,
  options: GenerateOptions = {},
): GeneratedShot {
  const rng = makeRng(seed);
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const id = `L${level.id}-s${seed}`;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const candidate = propose(level, rng, id, options.preferredSide);
    if (candidate && layoutViolations(candidate, level).length === 0) {
      return { layout: candidate, seed, attempts: attempt, fromTemplate: false };
    }
  }

  return {
    layout: { ...level.template, id: `${id}-template` },
    seed,
    attempts: maxAttempts,
    fromTemplate: true,
  };
}

function propose(
  level: LevelDefinition,
  rng: () => number,
  id: string,
  preferredSide: 'left' | 'right' | undefined,
): ShotLayout | undefined {
  if (level.railAdjacent) return proposeOnRail(level, rng, id, preferredSide);

  const pocket = TABLE.pockets[Math.floor(rng() * TABLE.pockets.length)]!;
  const object = sampleFromPocket(level, pocket, rng);
  if (!object) return undefined;

  const side = preferredSide ?? (rng() < 0.5 ? 'left' : 'right');
  const magnitude = lerp(level.cutRange[0], level.cutRange[1], rng());
  const cutDegrees = side === 'left' ? magnitude : -magnitude;
  const cueDistance = lerp(level.cueDistance[0], level.cueDistance[1], rng());

  return layoutWithCut(id, object, pocket.id, cutDegrees, cueDistance);
}

/**
 * The rail level, built from the ball outward. From a ball on a cushion most
 * pockets are the wrong distance away, have no clean line, or need the cue ball
 * behind the rail. Drawn blind, as the other levels are, about one candidate
 * in two hundred survived and one shot in seven fell back to the level's
 * template (one in ten before the pockets had jaws). So the pocket is drawn
 * only from the ones that work for this ball and this cut, and the cue
 * distance only from the room there is behind the ghost ball.
 */
function proposeOnRail(
  level: LevelDefinition,
  rng: () => number,
  id: string,
  preferredSide: 'left' | 'right' | undefined,
): ShotLayout | undefined {
  const object = sampleNearRail(level, rng);
  if (!object) return undefined;

  const side = preferredSide ?? (rng() < 0.5 ? 'left' : 'right');
  const magnitude = lerp(level.cutRange[0], level.cutRange[1], rng());
  const cutDegrees = side === 'left' ? magnitude : -magnitude;

  const [nearest, farthest] = level.potDistance;
  const options = TABLE.pockets.flatMap((pocket) => {
    const distance = dist(object, pocket.center);
    if (distance < nearest || distance > farthest || !pocketWindow(object, pocket)) return [];
    const room = cueRoom(object, pocket, cutDegrees);
    return room >= level.cueDistance[0] ? [{ pocket, room }] : [];
  });
  if (options.length === 0) return undefined;

  const { pocket, room } = options[Math.floor(rng() * options.length)]!;
  const cueDistance = lerp(level.cueDistance[0], Math.min(level.cueDistance[1], room), rng());
  return layoutWithCut(id, object, pocket.id, cutDegrees, cueDistance);
}

/**
 * How far back along its line of approach the cue ball can sit and still be on
 * the table. Taken from the throw-free ghost ball: the degree or two throw
 * turns the line by is left for the full check to catch.
 */
function cueRoom(object: Vec2, pocket: Pocket, cutDegrees: number): number {
  const target = aimPoint(object, pocket);
  const ghost = ghostBallCenter(object, target);
  const back = rotate(normalize(sub(object, target)), (-cutDegrees * Math.PI) / 180);
  const bounds = TABLE.bounds;
  const toEdge = (from: number, step: number, low: number, high: number): number =>
    step > 0 ? (high - from) / step : step < 0 ? (low - from) / step : Number.POSITIVE_INFINITY;
  return Math.min(
    toEdge(ghost.x, back.x, bounds.minX, bounds.maxX),
    toEdge(ghost.y, back.y, bounds.minY, bounds.maxY),
  );
}

/** An object ball somewhere in the fan of positions this pocket can be potted from. */
function sampleFromPocket(
  level: LevelDefinition,
  pocket: Pocket,
  rng: () => number,
): Vec2 | undefined {
  const cone = pocket.kind === 'corner' ? CORNER_CONE : SIDE_CONE;
  const heading = angleOf(pocket.inward) + (rng() - 0.5) * cone;
  const distance = lerp(level.potDistance[0], level.potDistance[1], rng());
  const object = add(pocket.center, fromAngle(heading, distance));
  return isInLegalBounds(object) ? object : undefined;
}

/**
 * An object ball within the level's band of a cushion, short of touching it.
 *
 * Never frozen to it. Sent along its rail, a frozen ball is thrown into the
 * rubber and comes back off it, because the solver takes the cue ball, the
 * object ball and the rail one pair at a time where the real contact is all
 * three at once; and sent any other way, its ghost ball is inside the rail. So
 * a frozen ball is a shot the model cannot play straight, and it is not dealt.
 */
function sampleNearRail(level: LevelDefinition, rng: () => number): Vec2 | undefined {
  const bounds = TABLE.bounds;
  const offset = rng() * Math.max(0, level.railBand - BALL_RADIUS);
  if (rng() < 0.5) {
    const y = rng() < 0.5 ? bounds.maxY - offset : bounds.minY + offset;
    const object = vec(lerp(bounds.minX, bounds.maxX, rng()), y);
    return isInLegalBounds(object) ? object : undefined;
  }
  const x = rng() < 0.5 ? bounds.maxX - offset : bounds.minX + offset;
  const object = vec(x, lerp(bounds.minY, bounds.maxY, rng()));
  return isInLegalBounds(object) ? object : undefined;
}

/**
 * Everything wrong with a layout for a given level. An empty list is the only
 * acceptable result — the generator does not ship "close enough".
 */
export function layoutViolations(
  layout: ShotLayout,
  level: LevelDefinition,
): LayoutViolation[] {
  const violations: LayoutViolation[] = [];
  const pocket = pocketById(layout.targetPocket);
  const obstacles = layout.obstacles ?? [];

  if (!isInLegalBounds(layout.cue)) violations.push('cue-off-table');
  if (!isInLegalBounds(layout.object)) violations.push('object-off-table');
  if (dist(layout.cue, layout.object) <= 2 * BALL_RADIUS + SEPARATION_MARGIN) {
    violations.push('balls-overlap');
  }

  // Being inside the legal-bounds rectangle is not the same as being on the
  // table: its corners sit out on the corner pockets' shelves, in the jaws.
  if (isInPocketMouth(layout.cue, POCKET_CLEARANCE)) violations.push('cue-in-pocket');
  if (isInPocketMouth(layout.object, POCKET_CLEARANCE)) violations.push('object-in-pocket');

  const analysis = analyseShot({ cue: layout.cue, object: layout.object, pocket, obstacles });
  for (const blocker of analysis.blockers) violations.push(blocker);
  // Power is judged again against the most sluggish cloth on offer, so a
  // layout stays makeable whichever cloth the player switches to afterwards.
  const { cutAngle, objectToPocket, cueToGhost } = analysis;
  const slowest = clothRollingFriction(SLOWEST_CLOTH);
  if (!isPowerFeasible(cutAngle, objectToPocket, cueToGhost, slowest) && !violations.includes('underpowered')) {
    violations.push('underpowered');
  }

  // Neither ball may be required to roll over a pocket on its way. The cue ball
  // has no exception: any pocket it crosses swallows it. The object ball is
  // allowed exactly one: the pocket it is being sent to.
  const ghost = analysis.ghostCenter;
  if (pocketOnPath(layout.cue, ghost, { margin: POCKET_CLEARANCE })) {
    violations.push('cue-path-enters-pocket');
  }
  if (pocketOnPath(layout.object, analysis.target, { ignore: pocket.id, margin: POCKET_CLEARANCE })) {
    violations.push('object-path-enters-pocket');
  }

  const cutDegrees = (analysis.cutAngle * 180) / Math.PI;
  if (cutDegrees < level.cutRange[0] - 1e-9 || cutDegrees > level.cutRange[1] + 1e-9) {
    violations.push('cut-out-of-range');
  }

  const potDistance = analysis.objectToPocket;
  if (potDistance < level.potDistance[0] || potDistance > level.potDistance[1]) {
    violations.push('pot-distance-out-of-range');
  }

  const cueDistance = dist(layout.cue, ghost);
  if (cueDistance < level.cueDistance[0] || cueDistance > level.cueDistance[1]) {
    violations.push('cue-distance-out-of-range');
  }

  if (level.railAdjacent && railClearance(layout.object) > level.railBand) {
    violations.push('not-rail-adjacent');
  }

  // A level about where the cue ball goes leaves it room to go there: clear
  // table along the rule's line, and no pocket on it.
  if (level.scoring?.kind === 'departure') {
    const along = ruleDirection(level.scoring.stroke, layout.cue, ghost, layout.object);
    const end = add(ghost, scale(along, DEPARTURE_ROOM));
    if (!isInLegalBounds(end) || pocketOnPath(ghost, end, { margin: POCKET_CLEARANCE })) {
      violations.push('no-room-for-cue-ball');
    }
  }

  return violations;
}

/** Distance from a ball centre to the nearest cushion line. */
export function railClearance(p: Vec2): number {
  return Math.min(
    TABLE.playWidth / 2 - Math.abs(p.y),
    TABLE.playLength / 2 - Math.abs(p.x),
  );
}

/** A point one ball diameter along a heading — used by the scene for guides. */
export function stepAlong(from: Vec2, heading: number, distance: number): Vec2 {
  return add(from, scale(fromAngle(heading), distance));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
