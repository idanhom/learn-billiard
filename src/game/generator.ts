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

import { analyseShot, cutAngle, ghostBallCenter } from '../geometry/shot';
import { BALL_RADIUS, TABLE, type Pocket, isInLegalBounds, pocketById } from '../geometry/table';
import { type Vec2, add, angleOf, dist, fromAngle, scale, vec } from '../geometry/vec2';
import { type ShotLayout, layoutWithCut } from './drills';
import type { LevelDefinition } from './levels';

export type LayoutViolation =
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
  | 'not-rail-adjacent';

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

/** How wide a fan of object-ball positions to sample in front of each pocket. */
const CORNER_CONE = (100 * Math.PI) / 180;
const SIDE_CONE = (150 * Math.PI) / 180;

/** mulberry32 — small, fast, and reproducible across machines. */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
  const pocket = TABLE.pockets[Math.floor(rng() * TABLE.pockets.length)]!;
  const object = level.railAdjacent ? sampleNearRail(level, rng) : sampleFromPocket(level, pocket, rng);
  if (!object) return undefined;

  const side = preferredSide ?? (rng() < 0.5 ? 'left' : 'right');
  const magnitude = lerp(level.cutRange[0], level.cutRange[1], rng());
  const cutDegrees = side === 'left' ? magnitude : -magnitude;
  const cueDistance = lerp(level.cueDistance[0], level.cueDistance[1], rng());

  return layoutWithCut(id, object, pocket.id, cutDegrees, cueDistance);
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

/** An object ball parked within the level's band of a cushion. */
function sampleNearRail(level: LevelDefinition, rng: () => number): Vec2 | undefined {
  const bounds = TABLE.bounds;
  const offset = rng() * Math.max(0, level.railBand - BALL_RADIUS);
  if (rng() < 0.5) {
    const y = (rng() < 0.5 ? bounds.maxY : bounds.minY) + (rng() < 0.5 ? -offset : offset);
    const x = lerp(bounds.minX, bounds.maxX, rng());
    const object = vec(x, clamp(y, bounds.minY, bounds.maxY));
    return isInLegalBounds(object) ? object : undefined;
  }
  const x = (rng() < 0.5 ? bounds.maxX : bounds.minX) + (rng() < 0.5 ? -offset : offset);
  const y = lerp(bounds.minY, bounds.maxY, rng());
  const object = vec(clamp(x, bounds.minX, bounds.maxX), y);
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

  const analysis = analyseShot({
    cue: layout.cue,
    object: layout.object,
    pocket,
    obstacles,
  });
  for (const blocker of analysis.blockers) violations.push(blocker);

  const cutDegrees = (cutAngle(layout.cue, layout.object, pocket.center) * 180) / Math.PI;
  if (cutDegrees < level.cutRange[0] - 1e-9 || cutDegrees > level.cutRange[1] + 1e-9) {
    violations.push('cut-out-of-range');
  }

  const potDistance = dist(layout.object, pocket.center);
  if (potDistance < level.potDistance[0] || potDistance > level.potDistance[1]) {
    violations.push('pot-distance-out-of-range');
  }

  const cueDistance = dist(layout.cue, ghostBallCenter(layout.object, pocket.center));
  if (cueDistance < level.cueDistance[0] || cueDistance > level.cueDistance[1]) {
    violations.push('cue-distance-out-of-range');
  }

  if (level.railAdjacent && railClearance(layout.object) > level.railBand) {
    violations.push('not-rail-adjacent');
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

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
