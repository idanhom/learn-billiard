/**
 * What a shot's report leads with.
 *
 * In the exam a shot is potted or missed. Everywhere else it is judged on the
 * aim, and a pot off aim is said to be one, so the ball dropping never passes
 * for the aim being right. Sent outside the pocket and still dropping, off a
 * jaw, it is luck, and the report says so.
 */

import type { ShotOutcome } from '../game/shot-session';

export interface Verdict {
  readonly text: string;
  readonly good: boolean;
  /** Why a pot did not count, when it did not. */
  readonly why?: string;
}

/** A pot off a line outside the pocket: one that dropped by luck. */
export function isLucky(potted: boolean, qualifying: boolean, pocketUsed: number | null): boolean {
  return potted && !qualifying && (pocketUsed === null || pocketUsed > 1);
}

export function verdictFor(
  outcome: Pick<ShotOutcome, 'qualifying' | 'pottedTarget' | 'pocketUsed'>,
  exam: boolean,
): Verdict {
  if (exam) return outcome.pottedTarget ? { text: 'Potted', good: true } : { text: 'Missed', good: false };
  if (outcome.qualifying) return { text: 'On aim', good: true };
  if (!outcome.pottedTarget) return { text: 'Off aim', good: false };
  return isLucky(outcome.pottedTarget, outcome.qualifying, outcome.pocketUsed)
    ? { text: 'Off aim: a lucky pot', good: false, why: 'It went in, but the line was outside the pocket.' }
    : { text: 'Off aim, though potted', good: false, why: 'It went in, nearer the edge than this level allows.' };
}
