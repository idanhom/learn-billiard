/**
 * The curriculum.
 *
 * Levels 1-5 each practise one of the ball fractions players aim by (full,
 * three quarters, half, a quarter, an eighth: see `src/geometry/fractions.ts`),
 * with cuts from halfway to the fraction below up to halfway to the one above,
 * so the fraction a level is named for is always the nearest to its shots.
 * A shot qualifies on how much of the pocket its aim used: where the object ball
 * would go, against how far it could go either side of the ideal line and
 * still drop. That window already shrinks, in aim, as the cut thins and the
 * shot lengthens, so the share allowed only tightens a little on top. Level 6
 * changes distance rather than angle. Level 7 is the exam: no guides, no tiers,
 * scored on pots, because at some point the question stops being "is your aim
 * good" and starts being "can you make the ball". Level 8 is a mixed review of
 * the five fractions, leaning on the ones missed most, level 9 reads shots
 * without playing them, level 10 deals the angles mastered least, and level 11
 * is the daily set.
 */

import { FRACTIONS, type FractionName } from '../geometry/fractions';
import { type ShotLayout, layoutWithCut } from './drills';

export interface LevelDefinition {
  readonly id: number;
  readonly name: string;
  readonly description: string;
  /** Inclusive cut-angle band in degrees. */
  readonly cutRange: readonly [number, number];
  /**
   * How much of the pot window a qualifying shot may use, on the side the
   * object ball went: 1 is anything that would have dropped at the right
   * stroke, 0.5 the middle half of it.
   */
  readonly pocketAllowance: number;
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
  /** The ball fraction a practice level is built on, for the five that are. */
  readonly fraction?: FractionName;
  /**
   * Deals from the fraction levels rather than a band of its own, more often
   * from the ones whose shots miss most.
   */
  readonly review?: boolean;
  /** Reads shots without playing them: the perception drills, dealt from the fraction levels. */
  readonly perception?: boolean;
  /** Deals from the ten-degree bands of cut least mastered, rather than a band of its own. */
  readonly weak?: boolean;
  /** The daily set: the same ten shots for everyone on a day, dealt from levels 1 to 6. */
  readonly daily?: boolean;
  /** Fallback used when generation cannot satisfy the brief. */
  readonly template: ShotLayout;
}

/** Effectively "anywhere on the table" for levels that do not care about rails. */
const NO_RAIL_CONSTRAINT = 1;

/**
 * The cuts nearer one fraction than any other: from halfway to the fraction
 * below it to halfway to the one above, in degrees, to a tenth. Full starts at
 * dead straight; an eighth runs as far above itself as it reaches below.
 */
function bandAround(name: FractionName): readonly [number, number] {
  const i = FRACTIONS.findIndex((f) => f.name === name);
  const at = FRACTIONS[i]!.cutDegrees;
  const below = i === 0 ? at : (at + FRACTIONS[i - 1]!.cutDegrees) / 2;
  const above = i === FRACTIONS.length - 1 ? 2 * at - below : (at + FRACTIONS[i + 1]!.cutDegrees) / 2;
  const tenth = (degrees: number): number => Math.round(degrees * 10) / 10;
  return [tenth(below), tenth(above)];
}

export const LEVELS: readonly LevelDefinition[] = [
  {
    id: 1,
    name: 'Full ball',
    description: 'Straight in: the cue ball covers the whole of the object ball.',
    cutRange: bandAround('full'),
    fraction: 'full',
    pocketAllowance: 1,
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
    name: 'Three-quarter ball',
    description: 'About 15 degrees: the cue ball covers three quarters of the object ball.',
    cutRange: bandAround('three-quarter'),
    fraction: 'three-quarter',
    pocketAllowance: 0.9,
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
    description: 'About 30 degrees: the centre of the cue ball at the edge of the object ball.',
    cutRange: bandAround('half'),
    fraction: 'half',
    pocketAllowance: 0.8,
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
    name: 'Quarter ball',
    description: 'About 49 degrees: a quarter of the object ball covered.',
    cutRange: bandAround('quarter'),
    fraction: 'quarter',
    pocketAllowance: 0.8,
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
    name: 'Eighth ball',
    description: 'About 61 degrees: barely more than an edge.',
    cutRange: bandAround('eighth'),
    fraction: 'eighth',
    pocketAllowance: 0.7,
    cueDistance: [0.3, 0.8],
    potDistance: [0.2, 0.6],
    railAdjacent: false,
    railBand: NO_RAIL_CONSTRAINT,
    exam: false,
    examShots: 0,
    template: layoutWithCut('level-5-template', { x: 0.55, y: 0.2 }, 'top-right', -61, 0.45),
  },
  {
    id: 6,
    name: 'Distance and rails',
    description: 'The same angles, but long, and with the object ball near a cushion.',
    cutRange: [0, 45],
    pocketAllowance: 0.8,
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
    description: 'No guides, no tiers. Ten shots, thin cuts and long ones among them, scored on what you pot.',
    cutRange: [0, 70],
    pocketAllowance: 0.8,
    cueDistance: [0.4, 1.3],
    potDistance: [0.3, 1.3],
    railAdjacent: false,
    railBand: NO_RAIL_CONSTRAINT,
    exam: true,
    examShots: 10,
    template: layoutWithCut('level-7-template', { x: 0.1, y: -0.1 }, 'top-right', 25, 0.7),
  },
  {
    id: 8,
    name: 'Mixed review',
    description: 'All five fractions, mixed, with more of the ones you miss most.',
    // The span of the five fraction levels. The campaign deals this level's
    // shots from those levels; the band is what the generator would use alone.
    cutRange: [0, bandAround('eighth')[1]],
    pocketAllowance: 0.8,
    cueDistance: [0.35, 1],
    potDistance: [0.2, 1],
    railAdjacent: false,
    railBand: NO_RAIL_CONSTRAINT,
    exam: false,
    examShots: 0,
    review: true,
    template: layoutWithCut('level-8-template', { x: 0.25, y: 0.05 }, 'top-right', 30, 0.6),
  },
  {
    id: 9,
    name: 'Read the angle',
    description: 'No shots. Call the fraction from a glimpse, or put the ghost ball where it belongs.',
    cutRange: [0, bandAround('eighth')[1]],
    pocketAllowance: 0.8,
    cueDistance: [0.35, 1],
    potDistance: [0.3, 1],
    railAdjacent: false,
    railBand: NO_RAIL_CONSTRAINT,
    exam: false,
    examShots: 0,
    perception: true,
    template: layoutWithCut('level-9-template', { x: 0.25, y: 0.05 }, 'top-right', 30, 0.6),
  },
  {
    id: 10,
    name: 'Weak angles',
    description: 'Deals the angles you have mastered least, ten degrees at a time.',
    cutRange: [0, 70],
    pocketAllowance: 0.8,
    cueDistance: [0.35, 1],
    potDistance: [0.3, 1],
    railAdjacent: false,
    railBand: NO_RAIL_CONSTRAINT,
    exam: false,
    examShots: 0,
    weak: true,
    template: layoutWithCut('level-10-template', { x: 0.25, y: 0.05 }, 'top-right', 30, 0.6),
  },
  {
    id: 11,
    name: 'Daily set',
    description: 'Ten shots, the same for everyone today, with no guides. Only your first run of the day counts.',
    cutRange: [0, bandAround('eighth')[1]],
    pocketAllowance: 0.8,
    cueDistance: [0.35, 1],
    potDistance: [0.3, 1],
    railAdjacent: false,
    railBand: NO_RAIL_CONSTRAINT,
    exam: false,
    examShots: 0,
    daily: true,
    template: layoutWithCut('level-11-template', { x: 0.25, y: 0.05 }, 'top-right', 30, 0.6),
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
