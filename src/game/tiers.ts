/**
 * Guide tiers.
 *
 * The scaffolding comes away in steps as the player's aim gets reliable, and it
 * never comes back within a session — being knocked back a tier for a bad run
 * punishes experimentation, which is the opposite of what a trainer wants.
 * Advancing takes three qualifying shots out of the last five at the current
 * tier, and the window is cleared on promotion so each tier is earned on its
 * own terms rather than on momentum from the last one.
 */

export type Tier = 0 | 1 | 2 | 3;

export const FINAL_TIER: Tier = 3;
export const ADVANCE_WINDOW = 5;
export const ADVANCE_REQUIRED = 3;

export interface TierSnapshot {
  readonly tier: Tier;
  readonly completed: boolean;
}

export interface GuideVisibility {
  readonly aimLine: boolean;
  readonly ghostBall: boolean;
  readonly objectPath: boolean;
  /** The cut-angle and fullness numbers. Off at the last tier — that is the test. */
  readonly readout: boolean;
  /**
   * Live thick/thin on the current aim. This is the strongest guide of the lot
   * — it hands the player the answer — so it only exists at tier 0, alongside
   * the ghost ball it is describing.
   */
  readonly liveAimError: boolean;
}

export interface RecordResult {
  readonly advanced: boolean;
  readonly completed: boolean;
}

const GUIDES: Record<Tier, GuideVisibility> = {
  0: { aimLine: true, ghostBall: true, objectPath: true, readout: true, liveAimError: true },
  1: { aimLine: true, ghostBall: true, objectPath: false, readout: true, liveAimError: false },
  2: { aimLine: true, ghostBall: false, objectPath: false, readout: true, liveAimError: false },
  3: { aimLine: false, ghostBall: false, objectPath: false, readout: false, liveAimError: false },
};

export class TierTracker {
  #tier: Tier;
  #completed: boolean;
  #window: boolean[] = [];

  constructor(snapshot?: TierSnapshot) {
    this.#tier = clampTier(snapshot?.tier ?? 0);
    this.#completed = snapshot?.completed ?? false;
  }

  get tier(): Tier {
    return this.#tier;
  }

  get completed(): boolean {
    return this.#completed;
  }

  get guides(): GuideVisibility {
    return GUIDES[this.#tier];
  }

  get attemptsInWindow(): number {
    return this.#window.length;
  }

  get qualifiedInWindow(): number {
    return this.#window.filter(Boolean).length;
  }

  /** Log one evaluated attempt. Only evaluated shots reach here. */
  record(qualifying: boolean): RecordResult {
    if (this.#completed) return { advanced: false, completed: true };

    this.#window.push(qualifying);
    if (this.#window.length > ADVANCE_WINDOW) this.#window.shift();
    if (this.qualifiedInWindow < ADVANCE_REQUIRED) {
      return { advanced: false, completed: false };
    }

    this.#window = [];
    if (this.#tier === FINAL_TIER) {
      this.#completed = true;
      return { advanced: false, completed: true };
    }
    this.#tier = (this.#tier + 1) as Tier;
    return { advanced: true, completed: false };
  }

  snapshot(): TierSnapshot {
    return { tier: this.#tier, completed: this.#completed };
  }
}

export function clampTier(tier: number): Tier {
  if (!Number.isFinite(tier)) return 0;
  return Math.min(FINAL_TIER, Math.max(0, Math.round(tier))) as Tier;
}
