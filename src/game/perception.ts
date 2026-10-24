/**
 * Perception drills: reading a shot without playing it.
 *
 * Aiming is two skills, seeing what a shot needs and delivering it, and the
 * shot levels test them together. These pull the first one out on its own.
 * In a flash drill the layout shows for a moment and then the balls go, and
 * the player calls the fraction the shot needs. In a place drill the player
 * puts the ghost ball where the cue ball's centre has to be at contact, and is
 * scored by the share of the pocket the line through it would use, as a shot
 * is.
 *
 * Time is passed in, in seconds, so a drill is a plain state machine.
 */

import { type FractionName, nearestFraction } from '../geometry/fractions';
import { type ShotAnalysis } from '../geometry/shot';
import { type Vec2, dist, normalize, signedAngleBetween, sub } from '../geometry/vec2';
import type { PotWindow } from './pot-window';

export type DrillKind = 'flash' | 'place';

/** How long a flash drill shows the layout before the balls go. */
export const FLASH_SECONDS = 1.5;

export type DrillResult =
  | { readonly kind: 'flash'; readonly called: FractionName; readonly needed: FractionName; readonly correct: boolean }
  | {
      readonly kind: 'place';
      /** How far the placed ghost ball is from where it belongs, in metres. */
      readonly off: number;
      /** The share of the pocket the line through it would use. */
      readonly used: number;
      readonly correct: boolean;
    };

export class PerceptionDrill {
  readonly kind: DrillKind;
  readonly #shownAt: number;
  readonly #analysis: ShotAnalysis;
  readonly #object: Vec2;
  readonly #window: PotWindow | undefined;
  readonly #allowance: number;
  #result: DrillResult | undefined;

  constructor(
    kind: DrillKind,
    object: Vec2,
    analysis: ShotAnalysis,
    window: PotWindow | undefined,
    allowance: number,
    now: number,
  ) {
    this.kind = kind;
    this.#object = object;
    this.#analysis = analysis;
    this.#window = window;
    this.#allowance = allowance;
    this.#shownAt = now;
  }

  /** The answer, once given. */
  get result(): DrillResult | undefined {
    return this.#result;
  }

  /** The balls are off the table: a flash drill past its moment, until it is answered. */
  hidden(now: number): boolean {
    return this.kind === 'flash' && this.#result === undefined && now - this.#shownAt >= FLASH_SECONDS;
  }

  /** Call the fraction a flash drill needs. Only once, and only after the balls have gone. */
  call(fraction: FractionName, now: number): DrillResult | undefined {
    if (this.kind !== 'flash' || this.#result || !this.hidden(now)) return undefined;
    const needed = nearestFraction(this.#analysis.cutAngle).name;
    this.#result = { kind: 'flash', called: fraction, needed, correct: fraction === needed };
    return this.#result;
  }

  /**
   * Put a place drill's ghost ball at `point`. Scored on the line of centres
   * through it, against the one through the true ghost ball: the share of the
   * pocket that difference uses, on the side it falls.
   */
  place(point: Vec2): DrillResult | undefined {
    if (this.kind !== 'place' || this.#result) return undefined;
    const ideal = normalize(sub(this.#object, this.#analysis.ghostCenter));
    const placed = normalize(sub(this.#object, point));
    const turned = signedAngleBetween(ideal, placed);
    const room = this.#window ? (turned >= 0 ? this.#window.counterClockwise : this.#window.clockwise) : 0;
    const used = room > 0 ? Math.abs(turned) / room : Number.POSITIVE_INFINITY;
    this.#result = {
      kind: 'place',
      off: dist(point, this.#analysis.ghostCenter),
      used,
      correct: used <= this.#allowance,
    };
    return this.#result;
  }
}
