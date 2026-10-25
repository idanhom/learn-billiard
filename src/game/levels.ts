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
 * without playing them, level 10 deals the angles mastered least, level 11 is
 * the daily set, levels 12 and 13 are about where the cue ball goes, 14 to 16
 * about where it stops, 17 and 18 about its speed with no object ball, 19 about
 * playing it to a zone for the next shot, 20 runs short patterns, 21 is the
 * assessment, the exam made general, and 22 and 23 are kicks and safeties.
 */

import { FRACTIONS, type FractionName } from '../geometry/fractions';
import { type ShotLayout, layoutWithCut } from './drills';
import type { Stroke } from './departure';
import type { PositionTarget } from './position';
import type { SpeedTarget } from './speed';

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
  /** The assessment: a fixed battery of stations from the other levels, scored together. */
  readonly assessment?: boolean;
  /**
   * What a shot is scored on, when it is not the aim. `departure`: the shot is
   * aimed and struck for the player, stunned or rolling, and they are scored
   * on where they said the cue ball would go, within `allowance` degrees.
   * `position`: a straight-in the player plays with their own tip, scored on
   * the pot and where the cue ball stops; `distance` is the rung's, filled in
   * as the layout is dealt. `speed`: the cue ball alone, scored on where it
   * stops; the layout is dealt by `speed.ts`, and the level's other fields
   * only describe what the generator would make of it.
   */
  readonly scoring?:
    | { readonly kind: 'departure'; readonly stroke: Stroke; readonly allowance: number }
    | { readonly kind: 'position'; readonly target: PositionTarget; readonly distance?: number }
    | { readonly kind: 'speed'; readonly target: SpeedTarget; readonly distance?: number }
    | { readonly kind: 'zone' }
    | { readonly kind: 'pattern' }
    | { readonly kind: 'kick' }
    | { readonly kind: 'safety' };
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
  {
    id: 12,
    name: 'The 90\u00b0 rule',
    description: 'Stunned, the cue ball leaves near square to the object ball. Say where it goes.',
    cutRange: [20, 60],
    pocketAllowance: 1,
    cueDistance: [0.3, 0.8],
    potDistance: [0.3, 1],
    railAdjacent: false,
    railBand: NO_RAIL_CONSTRAINT,
    exam: false,
    examShots: 0,
    scoring: { kind: 'departure', stroke: 'stun', allowance: 6 },
    template: layoutWithCut('level-12-template', { x: 0.25, y: 0.05 }, 'top-right', 30, 0.5),
  },
  {
    id: 13,
    name: 'The 30\u00b0 rule',
    description: 'Rolling, the cue ball ends up about 30\u00b0 off its line. Say where it goes.',
    cutRange: [12, 52],
    pocketAllowance: 1,
    cueDistance: [0.35, 0.8],
    potDistance: [0.3, 1],
    railAdjacent: false,
    railBand: NO_RAIL_CONSTRAINT,
    exam: false,
    examShots: 0,
    scoring: { kind: 'departure', stroke: 'roll', allowance: 6 },
    template: layoutWithCut('level-13-template', { x: 0.25, y: 0.05 }, 'top-right', 30, 0.5),
  },
  {
    id: 14,
    name: 'Stop shot',
    description: 'Straight in, and the cue ball stops where it meets the object ball. Up and down arrows move the tip.',
    cutRange: [0, 2],
    pocketAllowance: 1,
    cueDistance: [0.3, 0.9],
    potDistance: [0.3, 0.8],
    railAdjacent: false,
    railBand: NO_RAIL_CONSTRAINT,
    exam: false,
    examShots: 0,
    scoring: { kind: 'position', target: 'stop' },
    template: layoutWithCut('level-14-template', { x: 0.3, y: 0.15 }, 'top-right', 0, 0.5),
  },
  {
    id: 15,
    name: 'Follow ladder',
    description: 'Pot it, and follow through to the ring: a little further at each rung.',
    cutRange: [0, 2],
    pocketAllowance: 1,
    cueDistance: [0.3, 0.5],
    potDistance: [0.45, 1.4],
    railAdjacent: false,
    railBand: NO_RAIL_CONSTRAINT,
    exam: false,
    examShots: 0,
    scoring: { kind: 'position', target: 'follow' },
    template: layoutWithCut('level-15-template', { x: -0.1, y: -0.05 }, 'top-right', 0, 0.4),
  },
  {
    id: 16,
    name: 'Draw ladder',
    description: 'Pot it, and draw back to the ring: a little further at each rung.',
    cutRange: [0, 2],
    pocketAllowance: 1,
    cueDistance: [0.45, 1.2],
    potDistance: [0.3, 0.6],
    railAdjacent: false,
    railBand: NO_RAIL_CONSTRAINT,
    exam: false,
    examShots: 0,
    scoring: { kind: 'position', target: 'draw' },
    template: layoutWithCut('level-16-template', { x: 0.45, y: 0.2 }, 'top-right', 0, 0.9),
  },
  {
    id: 17,
    name: 'Speed control',
    description: 'No object ball: stop the cue ball in the ring, further at each rung, touching no cushion.',
    cutRange: [0, 60],
    pocketAllowance: 1,
    cueDistance: [0.35, 1],
    potDistance: [0.3, 1],
    railAdjacent: false,
    railBand: NO_RAIL_CONSTRAINT,
    exam: false,
    examShots: 0,
    scoring: { kind: 'speed', target: 'distance' },
    template: layoutWithCut('level-17-template', { x: 0.25, y: 0.05 }, 'top-right', 30, 0.6),
  },
  {
    id: 18,
    name: 'Lag',
    description: 'Up to the far cushion and back: stop in the ring by the near one without touching it.',
    cutRange: [0, 60],
    pocketAllowance: 1,
    cueDistance: [0.35, 1],
    potDistance: [0.3, 1],
    railAdjacent: false,
    railBand: NO_RAIL_CONSTRAINT,
    exam: false,
    examShots: 0,
    scoring: { kind: 'speed', target: 'lag' },
    template: layoutWithCut('level-18-template', { x: 0.25, y: 0.05 }, 'top-right', 30, 0.6),
  },
  {
    id: 19,
    name: 'Position zones',
    description: 'Pot it, and leave the cue ball in the zone for the next shot. Speed and tip are yours.',
    cutRange: [10, 50],
    pocketAllowance: 1,
    cueDistance: [0.4, 0.9],
    potDistance: [0.3, 0.9],
    railAdjacent: false,
    railBand: NO_RAIL_CONSTRAINT,
    exam: false,
    examShots: 0,
    scoring: { kind: 'zone' },
    template: layoutWithCut('level-19-template', { x: 0.25, y: 0.05 }, 'top-right', 30, 0.6),
  },
  {
    id: 20,
    name: 'Patterns',
    description: 'Two balls, then three, potted in order: each shot from where the last one left the cue ball.',
    cutRange: [5, 45],
    pocketAllowance: 1,
    cueDistance: [0.35, 0.9],
    potDistance: [0.3, 0.9],
    railAdjacent: false,
    railBand: NO_RAIL_CONSTRAINT,
    exam: false,
    examShots: 0,
    scoring: { kind: 'pattern' },
    template: layoutWithCut('level-20-template', { x: 0.25, y: 0.05 }, 'top-right', 30, 0.6),
  },
  {
    id: 21,
    name: 'Assessment',
    description: 'Twelve stations, no guides: cuts, stop, follow, draw, speed and position, scored together.',
    cutRange: [0, bandAround('eighth')[1]],
    pocketAllowance: 1,
    cueDistance: [0.35, 1],
    potDistance: [0.3, 1],
    railAdjacent: false,
    railBand: NO_RAIL_CONSTRAINT,
    exam: false,
    examShots: 0,
    assessment: true,
    template: layoutWithCut('level-21-template', { x: 0.25, y: 0.05 }, 'top-right', 30, 0.6),
  },
  {
    id: 22,
    name: 'Kick shots',
    description: 'A ball in the way: off a cushion first, then the object ball. The reflection is where to start.',
    cutRange: [0, 60],
    pocketAllowance: 1,
    cueDistance: [0.35, 1],
    potDistance: [0.3, 1],
    railAdjacent: false,
    railBand: NO_RAIL_CONSTRAINT,
    exam: false,
    examShots: 0,
    scoring: { kind: 'kick' },
    template: layoutWithCut('level-22-template', { x: 0.25, y: 0.05 }, 'top-right', 30, 0.6),
  },
  {
    id: 23,
    name: 'Safeties',
    description: 'Hit the object ball, and leave no direct pot from where the cue ball stops.',
    cutRange: [0, 60],
    pocketAllowance: 1,
    cueDistance: [0.35, 1],
    potDistance: [0.3, 1],
    railAdjacent: false,
    railBand: NO_RAIL_CONSTRAINT,
    exam: false,
    examShots: 0,
    scoring: { kind: 'safety' },
    template: layoutWithCut('level-23-template', { x: 0.25, y: 0.05 }, 'top-right', 30, 0.6),
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
