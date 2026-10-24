/**
 * A short memory of recent shots, and the bias hiding in them.
 *
 * A single shot tells you that one was 1.2 degrees thick. Ten shots tell you
 * that you are *always* about a degree thick — which is the thing you can
 * actually take to a real table and correct for. That average is what this
 * module exists to compute.
 *
 * Thick/thin and left/right are kept apart on purpose. "Thick" means the same
 * physical error whichever way a shot cuts, so those average cleanly; but on a
 * straight-in there is no thick or thin, only left and right, and folding the
 * two together would cancel a real bias against an unrelated one.
 *
 * Retries are listed but never averaged. A retry has seen where the first shot
 * went and leans the other way, so folding it in would pull a real bias toward
 * zero — the bias worth knowing is the one you bring to a shot cold.
 */

import type { AimError } from '../geometry/shot';

/** Shots kept. Long enough for an average to mean something, short enough to
 * still reflect how you are hitting them now. */
export const HISTORY_LENGTH = 12;

/** One shot is an anecdote. */
export const MIN_TENDENCY_SAMPLES = 2;

/** Below this the average is noise, and calling it a bias would be misleading. */
export const EVEN_THRESHOLD_DEGREES = 0.15;

export interface HistoryEntry {
  readonly aimError: AimError;
  readonly qualifying: boolean;
  readonly pottedTarget: boolean;
  readonly contacted: boolean;
  readonly cutAngleDegrees: number;
  /** A retry of a layout already played. Practice: listed, but not averaged. */
  readonly retry: boolean;
}

export type TendencyKind = 'thick' | 'thin' | 'left' | 'right' | 'even';

export interface Tendency {
  readonly kind: TendencyKind;
  /** Mean absolute deviation in the biased direction. Zero when even. */
  readonly degrees: number;
  readonly samples: number;
}

export interface HistorySummary {
  readonly shots: number;
  readonly qualified: number;
  readonly potted: number;
}

export class ShotHistory {
  #entries: HistoryEntry[] = [];

  /** Most recent first. */
  get entries(): readonly HistoryEntry[] {
    return this.#entries;
  }

  record(entry: HistoryEntry): void {
    this.#entries.unshift(entry);
    if (this.#entries.length > HISTORY_LENGTH) this.#entries.length = HISTORY_LENGTH;
  }

  clear(): void {
    this.#entries = [];
  }

  get summary(): HistorySummary {
    return {
      shots: this.#entries.length,
      qualified: this.#entries.filter((e) => e.qualifying).length,
      potted: this.#entries.filter((e) => e.pottedTarget).length,
    };
  }

  /** Are you hitting cuts thick or thin, on average? */
  get cutTendency(): Tendency | null {
    return this.#tendency('thick', 'thin');
  }

  /** And which side of a straight-in do you favour? */
  get straightTendency(): Tendency | null {
    return this.#tendency('left', 'right');
  }

  /**
   * Average the deviation with a sign: positive toward `positive`, negative
   * toward `negative`. A shot on the line is a real sample worth counting — it
   * is evidence against a bias — so it contributes zero rather than being
   * dropped.
   */
  #tendency(positive: TendencyKind, negative: TendencyKind): Tendency | null {
    const relevant = this.#entries.filter(
      (e) =>
        e.contacted &&
        !e.retry &&
        (e.aimError.kind === positive ||
          e.aimError.kind === negative ||
          (e.aimError.kind === 'on-line' && this.#isSameFamily(e, positive))),
    );
    if (relevant.length < MIN_TENDENCY_SAMPLES) return null;

    const total = relevant.reduce((sum, e) => {
      if (e.aimError.kind === positive) return sum + e.aimError.degrees;
      if (e.aimError.kind === negative) return sum - e.aimError.degrees;
      return sum;
    }, 0);

    const mean = total / relevant.length;
    if (Math.abs(mean) < EVEN_THRESHOLD_DEGREES) {
      return { kind: 'even', degrees: 0, samples: relevant.length };
    }
    return {
      kind: mean > 0 ? positive : negative,
      degrees: Math.abs(mean),
      samples: relevant.length,
    };
  }

  /**
   * A shot reported as "on-line" carries no thick/thin or left/right label, so
   * the cut angle decides which average it belongs to — the same test
   * ShotGeometry uses to pick the wording in the first place.
   */
  #isSameFamily(entry: HistoryEntry, positive: TendencyKind): boolean {
    const isStraight = entry.cutAngleDegrees <= STRAIGHT_CUT_DEGREES;
    return positive === 'left' ? isStraight : !isStraight;
  }
}

/** Mirrors ShotGeometry's STRAIGHT_CUT_LIMIT, in degrees. */
const STRAIGHT_CUT_DEGREES = 2;
