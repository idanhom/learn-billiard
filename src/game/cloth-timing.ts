/**
 * Timing a real table's cloth with a stopwatch, to pick the preset nearest it.
 *
 * Each preset is set by how long a ball takes to roll a table length and die
 * at the far cushion: 4.7, 4.0 and 3.4 s on this 7-foot table. Time the same
 * on a real table of any size, and the preset whose prediction for that length
 * comes nearest is the one to play on. Nothing new is fitted: a hand-held
 * stopwatch is good to a few tenths of a second, which can choose between three
 * presets but cannot measure a coefficient.
 */

import { CLOTH_PRESET_IDS, type ClothPreset, clothRollingFriction } from '../constants';
import { rollOutSeconds } from '../geometry/roll-time';

/**
 * Playing lengths, cushion nose to nose: the WPA's 100" and 92" for a 9-foot
 * and an 8-foot table, and the 78" of a 7-foot bar box, which is this one.
 */
export const TABLE_LENGTHS = { 7: 1.98, 8: 2.3368, 9: 2.54 } as const;

export type TableFeet = keyof typeof TABLE_LENGTHS;

export const TABLE_FEET: readonly TableFeet[] = [7, 8, 9];

/** Alciatore's measured rolling resistance, which this trainer's cloth departs from. */
export const PUBLISHED_ROLLING_FRICTION = 0.01;

/** Times outside this are not a ball rolling one table length. */
export const TIMING_RANGE: readonly [number, number] = [1, 15];

export interface ClothTiming {
  /** What each preset predicts for a table this long, in seconds. */
  readonly predicted: Readonly<Record<ClothPreset, number>>;
  /** What the published 0.01 predicts, for comparison. */
  readonly published: number;
  /** The preset whose prediction comes nearest the time taken. */
  readonly nearest: ClothPreset;
  /** Past the end of the presets: rolling on longer than fast cloth, or dying sooner than slow. */
  readonly beyond: 'faster' | 'slower' | null;
}

export function timeCloth(seconds: number, feet: TableFeet): ClothTiming {
  const length = TABLE_LENGTHS[feet];
  const predicted = {
    fast: rollOutSeconds(length, clothRollingFriction('fast')),
    normal: rollOutSeconds(length, clothRollingFriction('normal')),
    slow: rollOutSeconds(length, clothRollingFriction('slow')),
  };
  const nearest = CLOTH_PRESET_IDS.reduce((best, id) =>
    Math.abs(predicted[id] - seconds) < Math.abs(predicted[best] - seconds) ? id : best,
  );
  const beyond = seconds > predicted.fast ? 'faster' : seconds < predicted.slow ? 'slower' : null;
  return { predicted, published: rollOutSeconds(length, PUBLISHED_ROLLING_FRICTION), nearest, beyond };
}
