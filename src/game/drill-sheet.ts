/**
 * Drill sheets: shots to set up at a real table, dealt from the fractions the
 * player misses most here.
 *
 * They are weighted as the mixed review is, so a sheet leans on the weak
 * fractions without dropping the others. Each shot is a layout generated from
 * its fraction's level, placed in diamonds for setting up by eye, with the cut
 * it should come to, so a ball set a little off can be checked against it.
 */

import { formatDiamonds } from '../geometry/diamonds';
import { type Fraction, fractionByName } from '../geometry/fractions';
import type { CutSide } from '../geometry/shot';
import type { PocketId } from '../geometry/table';
import type { ShotLayout } from './drills';
import { generateShot } from './generator';
import type { LevelDefinition } from './levels';
import { makeRng, pickWeighted } from './random';
import { ShotSession } from './shot-session';

export const SHEET_SHOTS = 10;

/**
 * How often a fraction level's shots miss, as the review weighs it (smoothed,
 * so an unplayed level counts as even, and floored), and the plain count.
 */
export interface FractionMiss {
  readonly level: LevelDefinition;
  readonly missRate: number;
  readonly attempts: number;
  readonly missed: number;
}

export interface SheetShot {
  readonly fraction: Fraction;
  readonly layout: ShotLayout;
  readonly cutDegrees: number;
  readonly cutSide: CutSide;
  /** Where the balls go, in diamonds. */
  readonly cue: string;
  readonly object: string;
}

export interface DrillSheet {
  readonly id: number;
  readonly shots: readonly SheetShot[];
}

/** A sheet of shots, the same one again for the same id and the same misses. */
export function dealSheet(misses: readonly FractionMiss[], id: number): DrillSheet {
  const rng = makeRng(id);
  const shots: SheetShot[] = [];
  for (let i = 0; i < SHEET_SHOTS; i++) {
    const { level } = pickWeighted(misses, misses.map((miss) => miss.missRate), rng());
    const seed = (Math.imul(id, 7919) + i * 104_729) >>> 0;
    const { layout } = generateShot(level, seed, { preferredSide: i % 2 === 0 ? 'left' : 'right' });
    const analysis = new ShotSession(layout).analysis;
    shots.push({
      fraction: fractionByName(level.fraction!),
      layout,
      cutDegrees: (analysis.cutAngle * 180) / Math.PI,
      cutSide: analysis.cutSide,
      cue: formatDiamonds(layout.cue),
      object: formatDiamonds(layout.object),
    });
  }
  return { id, shots };
}

/** "top-right corner", "bottom side". */
export function pocketName(id: PocketId): string {
  const [edge, place] = id.split('-') as [string, string];
  return place === 'middle' ? `${edge} side` : `${edge}-${place} corner`;
}
