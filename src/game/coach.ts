/**
 * Three coached shots on a first launch.
 *
 * The first teaches the line: the ghost ball, and turning the aim onto it.
 * The second, the stroke: the meter's marker. The third, what the game is:
 * guides that come away as you earn it, and keeping the line once they have.
 * Each step moves on when the player has done the thing it asks, not on a
 * timer, and the whole of it can be skipped.
 */

export type CoachStep = 'aim' | 'strike' | 'report' | 'power' | 'power-report' | 'tiers' | 'done';

/** How near the ideal line the aim has to come for the first step to count it as found, in radians. */
export const COACH_AIM_TOLERANCE = (0.25 * Math.PI) / 180;

export class Coach {
  #step: CoachStep;

  constructor(active: boolean) {
    this.#step = active ? 'aim' : 'done';
  }

  get step(): CoachStep {
    return this.#step;
  }

  get active(): boolean {
    return this.#step !== 'done';
  }

  /** The line is on the ghost ball, near enough. */
  aimed(): void {
    if (this.#step === 'aim') this.#step = 'strike';
  }

  /** A shot has been scored. True when that was the last coached shot. */
  scored(): boolean {
    switch (this.#step) {
      case 'aim':
      case 'strike':
        this.#step = 'report';
        return false;
      case 'power':
        this.#step = 'power-report';
        return false;
      case 'tiers':
        this.#step = 'done';
        return true;
      default:
        return false;
    }
  }

  /** On to another shot. */
  dealt(): void {
    if (this.#step === 'report') this.#step = 'power';
    else if (this.#step === 'power-report') this.#step = 'tiers';
  }

  skip(): void {
    this.#step = 'done';
  }
}
