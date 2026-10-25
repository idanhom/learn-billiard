/**
 * The pre-shot routine: choose the line standing up, and, if the player wants
 * the real sight picture, get down on it, make only a small correction once
 * down, be still, then stroke.
 *
 * At a real table the line is chosen from above, where the whole shot can be
 * seen, and then the player gets down into the stance and does not go looking
 * for a different line from there: a big change once down means standing up
 * and choosing again. Getting down is the player's choice here, and the shot
 * can be struck from any view; once down, though, the line is committed, and
 * only standing back up frees it. The routine keeps a record of how often the
 * player stood back up and how long the shot took.
 *
 * Time is passed in, in seconds, so the routine is a pure state machine.
 */

/** How far the line may move once down, either way, in radians. */
export const DOWN_ADJUSTMENT = (0.5 * Math.PI) / 180;

/** How long the aim must be left alone before the stroke can start, in seconds. */
export const STILL_SECONDS = 0.6;

export class Routine {
  readonly #dealtAt: number;
  #down = false;
  #committed = 0;
  #reAims = 0;
  #lastMove: number;

  constructor(now: number) {
    this.#dealtAt = now;
    this.#lastMove = now;
  }

  /** Down in the stance, on a committed line. */
  get down(): boolean {
    return this.#down;
  }

  /** Times the player got back up to choose again. */
  get reAims(): number {
    return this.#reAims;
  }

  /** Get down on the line as it stands. */
  getDown(aim: number, now: number): void {
    this.#down = true;
    this.#committed = aim;
    this.#lastMove = now;
  }

  /** Stand back up to choose the line again: a re-aim. */
  standUp(): void {
    if (!this.#down) return;
    this.#down = false;
    this.#reAims++;
  }

  /**
   * Where a requested aim actually goes: anywhere standing up, and within
   * `DOWN_ADJUSTMENT` of the committed line once down. Any move restarts the
   * stillness clock.
   */
  steer(aim: number, now: number): number {
    this.#lastMove = now;
    if (!this.#down) return aim;
    const offset = Math.atan2(Math.sin(aim - this.#committed), Math.cos(aim - this.#committed));
    return this.#committed + Math.max(-DOWN_ADJUSTMENT, Math.min(DOWN_ADJUSTMENT, offset));
  }

  /** Why the stroke cannot start yet, or undefined when it can: down, it waits for a still moment. */
  holdUp(now: number): 'hold still' | undefined {
    if (this.#down && now - this.#lastMove < STILL_SECONDS) return 'hold still';
    return undefined;
  }

  /** Seconds from the deal to `now`: the time to shoot, read at the stroke. */
  elapsed(now: number): number {
    return now - this.#dealtAt;
  }
}
