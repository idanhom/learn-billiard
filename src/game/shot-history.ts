/**
 * A short memory of recent shots, and the bias hiding in them.
 *
 * A single shot tells you that one used 40% of the pocket, thick. Ten shots
 * tell you that you are always about that thick, which is the thing you can
 * actually take to a real table and correct for. That average is what this
 * module exists to compute.
 *
 * Each miss is kept as a share of its pocket, signed: thick positive and thin
 * negative on a cut, left positive and right negative on a straight-in. A
 * share rather than degrees off the cue ball, because the same cue-ball degree
 * is a different miss at a different distance, and a share of the pocket is
 * the same miss on any shot.
 *
 * The bias is split by which way the shot cuts, since a player can favour one
 * side, and by band of cut angle once the shots span more than one, since a
 * habit at a half-ball hit need not be one at a thin cut. Straight-ins are
 * kept apart: there is no thick or thin on one, only left and right, and
 * folding the two together would cancel a real bias against an unrelated one.
 *
 * Retries are listed but never averaged. A retry has seen where the first shot
 * went and leans the other way, so folding it in would pull a real bias toward
 * zero; the bias worth knowing is the one you bring to a shot cold.
 */

import type { AimSide, CutSide } from '../geometry/shot';

/** Shots kept. Long enough for an average to mean something, short enough to
 * still reflect how you are hitting them now. */
export const HISTORY_LENGTH = 12;

/** One shot is an anecdote. */
export const MIN_TENDENCY_SAMPLES = 2;

/** Below this share of the pocket the average is noise, and calling it a bias would mislead. */
export const EVEN_THRESHOLD_SHARE = 0.2;

/** The bands of cut angle the bias is split into, in degrees: from, up to but not including. */
export const ANGLE_BANDS: readonly (readonly [number, number])[] = [
  [0, 15],
  [15, 35],
  [35, 55],
  [55, 90],
];

export interface HistoryEntry {
  /**
   * The share of the pocket the aim used, signed: thick or left positive, thin
   * or right negative. Null when the object ball was never struck, or nothing
   * would have dropped.
   */
  readonly pocketShare: number | null;
  readonly qualifying: boolean;
  readonly pottedTarget: boolean;
  readonly contacted: boolean;
  readonly cutAngleDegrees: number;
  readonly cutSide: CutSide;
  /** A retry of a layout already played. Practice: listed, but not averaged. */
  readonly retry: boolean;
}

export type TendencyKind = AimSide | 'even';

export interface Tendency {
  readonly kind: TendencyKind;
  /** Mean share of the pocket in the biased direction. Zero when even. */
  readonly share: number;
  readonly samples: number;
}

/** One line of the bias report: which shots, and how they lean. */
export interface TendencyRow {
  readonly label: string;
  readonly tendency: Tendency;
}

export interface HistorySummary {
  readonly shots: number;
  readonly qualified: number;
  readonly potted: number;
}

/** A signed share of the pocket, from how much was used and which way. */
export function signedShare(used: number, side: AimSide): number {
  return side === 'thick' || side === 'left' ? used : -used;
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

  /**
   * The bias, line by line: cuts to the left, cuts to the right, straight-ins,
   * and then each band of cut angle, but only once two or more bands have
   * enough shots to say anything. A line with too few shots is left out.
   */
  get tendencies(): TendencyRow[] {
    const counted = this.#entries.filter((e) => e.contacted && !e.retry && e.pocketShare !== null);
    const rows: TendencyRow[] = [];
    const add = (label: string, entries: readonly HistoryEntry[], positive: AimSide, negative: AimSide): void => {
      const tendency = tendencyOf(entries, positive, negative);
      if (tendency) rows.push({ label, tendency });
    };

    add('Cutting left', counted.filter((e) => e.cutSide === 'left'), 'thick', 'thin');
    add('Cutting right', counted.filter((e) => e.cutSide === 'right'), 'thick', 'thin');
    add('Straight in', counted.filter((e) => e.cutSide === 'straight'), 'left', 'right');

    const cuts = counted.filter((e) => e.cutSide !== 'straight');
    const bands = ANGLE_BANDS.map(([from, to]) =>
      cuts.filter((e) => e.cutAngleDegrees >= from && e.cutAngleDegrees < to),
    );
    if (bands.filter((band) => band.length >= MIN_TENDENCY_SAMPLES).length > 1) {
      bands.forEach((band, i) => {
        const [from, to] = ANGLE_BANDS[i]!;
        add(`Cuts of ${from}-${to}°`, band, 'thick', 'thin');
      });
    }
    return rows;
  }
}

/**
 * The mean signed share, toward `positive` or `negative`. A shot dead in the
 * middle is a real sample worth counting, evidence against a bias, so it
 * contributes its zero rather than being dropped.
 */
function tendencyOf(entries: readonly HistoryEntry[], positive: AimSide, negative: AimSide): Tendency | null {
  if (entries.length < MIN_TENDENCY_SAMPLES) return null;
  const mean = entries.reduce((sum, e) => sum + e.pocketShare!, 0) / entries.length;
  if (Math.abs(mean) < EVEN_THRESHOLD_SHARE) return { kind: 'even', share: 0, samples: entries.length };
  return { kind: mean > 0 ? positive : negative, share: Math.abs(mean), samples: entries.length };
}
