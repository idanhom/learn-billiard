/**
 * The curriculum.
 *
 * Levels 1-5 walk the cut angle out from dead straight to a thin cut, and the
 * aim tolerance tightens as they go: a 2-degree error on a straight-in is worth
 * forgiving, the same error on a thin cut is a different shot entirely. Level 6
 * changes distance rather than angle. Level 7 is the exam — no guides, no
 * tiers, scored on pots, because at some point the question stops being "is
 * your aim good" and starts being "can you make the ball".
 */

import { type ShotLayout, layoutWithCut } from './drills';

export interface LevelDefinition {
  readonly id: number;
  readonly name: string;
  readonly description: string;
  /** Inclusive cut-angle band in degrees. */
  readonly cutRange: readonly [number, number];
  /** Aim deviation, in degrees, that still counts as a qualifying shot. */
  readonly toleranceDegrees: number;
  /** Cue-ball to ghost-ball distance, in metres. */
  readonly cueDistance: readonly [number, number];
  /** Object-ball to pocket distance, in metres. */
  readonly potDistance: readonly [number, number];
  /** When set, the object ball must sit within `railBand` of a cushion. */
  readonly railAdjacent: boolean;
  readonly railBand: number;
  readonly exam: boolean;
  /** Shots in one exam run. Zero for the practice levels. */
  readonly examShots: number;
  /** Fallback used when generation cannot satisfy the brief. */
  readonly template: ShotLayout;
}

/** Effectively "anywhere on the table" for levels that do not care about rails. */
const NO_RAIL_CONSTRAINT = 1;

export const LEVELS: readonly LevelDefinition[] = [
  {
    id: 1,
    name: 'Straight in',
    description: 'Dead straight. Learn what a full ball looks like.',
    cutRange: [0, 5],
    toleranceDegrees: 2,
    cueDistance: [0.35, 0.9],
    potDistance: [0.3, 0.9],
    railAdjacent: false,
    railBand: NO_RAIL_CONSTRAINT,
    exam: false,
    examShots: 0,
    template: layoutWithCut('level-1-template', { x: 0.3, y: 0.15 }, 'top-right', 0, 0.5),
  },
  {
    id: 2,
    name: 'Gentle cuts',
    description: 'Up to twenty degrees. The ghost ball starts to move off centre.',
    cutRange: [5, 20],
    toleranceDegrees: 1.75,
    cueDistance: [0.35, 1],
    potDistance: [0.3, 1],
    railAdjacent: false,
    railBand: NO_RAIL_CONSTRAINT,
    exam: false,
    examShots: 0,
    template: layoutWithCut('level-2-template', { x: 0.2, y: 0.1 }, 'top-right', 12, 0.55),
  },
  {
    id: 3,
    name: 'Half ball',
    description: 'Twenty to forty degrees, around the half-ball hit.',
    cutRange: [20, 40],
    toleranceDegrees: 1.5,
    cueDistance: [0.35, 1],
    potDistance: [0.3, 1],
    railAdjacent: false,
    railBand: NO_RAIL_CONSTRAINT,
    exam: false,
    examShots: 0,
    template: layoutWithCut('level-3-template', { x: 0.25, y: 0.05 }, 'top-right', 30, 0.6),
  },
  {
    id: 4,
    name: 'Steep cuts',
    description: 'Forty to sixty degrees. Small aim errors start to cost pots.',
    cutRange: [40, 60],
    toleranceDegrees: 1,
    cueDistance: [0.3, 0.9],
    potDistance: [0.25, 0.8],
    railAdjacent: false,
    railBand: NO_RAIL_CONSTRAINT,
    exam: false,
    examShots: 0,
    template: layoutWithCut('level-4-template', { x: 0.45, y: 0.1 }, 'top-right', -50, 0.5),
  },
  {
    id: 5,
    name: 'Thin cuts',
    description: 'Sixty to eighty degrees. Barely more than an edge.',
    cutRange: [60, 80],
    toleranceDegrees: 0.75,
    cueDistance: [0.3, 0.8],
    potDistance: [0.2, 0.6],
    railAdjacent: false,
    railBand: NO_RAIL_CONSTRAINT,
    exam: false,
    examShots: 0,
    template: layoutWithCut('level-5-template', { x: 0.55, y: 0.2 }, 'top-right', -70, 0.45),
  },
  {
    id: 6,
    name: 'Distance and rails',
    description: 'The same angles, but long, and with the object ball near a cushion.',
    cutRange: [0, 45],
    toleranceDegrees: 1,
    cueDistance: [0.8, 1.5],
    potDistance: [0.7, 1.4],
    railAdjacent: true,
    railBand: 0.09,
    exam: false,
    examShots: 0,
    template: layoutWithCut('level-6-template', { x: -0.1, y: 0.42 }, 'top-right', -20, 0.85),
  },
  {
    id: 7,
    name: 'Exam',
    description: 'No guides, no tiers. Ten shots, scored on what you pot.',
    cutRange: [0, 55],
    toleranceDegrees: 1,
    cueDistance: [0.4, 1.1],
    potDistance: [0.3, 1.1],
    railAdjacent: false,
    railBand: NO_RAIL_CONSTRAINT,
    exam: true,
    examShots: 10,
    template: layoutWithCut('level-7-template', { x: 0.1, y: -0.1 }, 'top-right', 25, 0.7),
  },
];

export function levelById(id: number): LevelDefinition {
  const level = LEVELS.find((l) => l.id === id);
  if (!level) throw new Error(`unknown level: ${id}`);
  return level;
}

export function examLevel(): LevelDefinition {
  const level = LEVELS.find((l) => l.exam);
  if (!level) throw new Error('the curriculum has no exam');
  return level;
}

export const FIRST_LEVEL_ID = LEVELS[0]!.id;
export const LAST_LEVEL_ID = LEVELS[LEVELS.length - 1]!.id;
