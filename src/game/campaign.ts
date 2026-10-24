/**
 * The campaign: which level, which tier, which shot, and what gets remembered.
 *
 * Practice levels are scored on aim and drive the guide tiers. The exam is not:
 * it turns every guide off, ignores tiers entirely, and counts pots over a
 * fixed run, because the last thing worth checking is not whether the aim used
 * little enough of the pocket but whether the ball goes in.
 *
 * Only the first shot at a layout counts, for tiers, for the level's record and
 * for the exam. A retry has already seen where the first one went, so it says
 * how well you correct rather than how well you read a shot cold — worth
 * playing, as practice, and counted for nothing.
 */

import type { ShotLayout } from './drills';
import { generateShot } from './generator';
import {
  FIRST_LEVEL_ID,
  type LevelDefinition,
  LEVELS,
  levelById,
} from './levels';
import {
  type LevelProgress,
  type ProgressState,
  type ProgressStore,
  emptyLevelProgress,
  emptyProgress,
  levelProgress,
} from './progress-store';
import { type GuideVisibility, type Tier, TierTracker } from './tiers';

/** The part of a shot outcome the campaign scores. */
export interface ScoredShot {
  readonly qualifying: boolean;
  readonly pottedTarget: boolean;
}

export interface ExamRun {
  readonly shotsTaken: number;
  readonly total: number;
  readonly potted: number;
}

export interface ExamResult {
  readonly potted: number;
  readonly total: number;
  readonly personalBest: boolean;
}

export interface CampaignEvent {
  readonly advancedTier: boolean;
  readonly levelCompleted: boolean;
  /** A retry of a layout already played: practice, so nothing was counted. */
  readonly practice: boolean;
  readonly examFinished?: ExamResult;
}

export interface CampaignOptions {
  /** Base seed; each shot uses seed + a counter, so a session is reproducible. */
  readonly seed?: number;
}

const NO_GUIDES: GuideVisibility = {
  aimLine: false,
  ghostBall: false,
  objectPath: false,
  readout: false,
  powerHint: false,
};

export class Campaign {
  readonly #store: ProgressStore;
  readonly #baseSeed: number;
  readonly #notice: string | undefined;

  #state: ProgressState;
  #level: LevelDefinition;
  #tiers: TierTracker;
  #layout: ShotLayout;
  /** A shot at the current layout has been scored, so any further one is a retry. */
  #layoutPlayed = false;
  #shotCounter = 0;
  #exam: ExamRun | undefined;

  constructor(store: ProgressStore, options: CampaignOptions = {}) {
    this.#store = store;
    this.#baseSeed = options.seed ?? 1;

    const loaded = store.load();
    this.#state = loaded.state;
    this.#notice = loaded.recovered ? loaded.reason : undefined;

    this.#level = levelById(this.#state.currentLevel);
    this.#tiers = this.#trackerFor(this.#level);
    this.#exam = this.#level.exam ? freshExam(this.#level) : undefined;
    this.#layout = this.#generate();
  }

  get notice(): string | undefined {
    return this.#notice;
  }

  get level(): LevelDefinition {
    return this.#level;
  }

  get levels(): readonly LevelDefinition[] {
    return LEVELS;
  }

  get tier(): Tier {
    return this.#tiers.tier;
  }

  /** The exam is exempt from tiers: no guide is ever shown during it. */
  get guides(): GuideVisibility {
    return this.#level.exam ? NO_GUIDES : this.#tiers.guides;
  }

  get pocketAllowance(): number {
    return this.#level.pocketAllowance;
  }

  get layout(): ShotLayout {
    return this.#layout;
  }

  get stats(): LevelProgress {
    return levelProgress(this.#state, this.#level.id);
  }

  /** Recorded progress for any level, for the level list in the HUD. */
  levelStats(id: number): LevelProgress {
    return levelProgress(this.#state, id);
  }

  get qualifiedInWindow(): number {
    return this.#tiers.qualifiedInWindow;
  }

  get levelCompleted(): boolean {
    return this.#tiers.completed;
  }

  get exam(): ExamRun | undefined {
    return this.#exam;
  }

  get examBest(): number | null {
    return this.#state.examBest;
  }

  /** A shot taken now would be a retry: practice, and not counted. */
  get retrying(): boolean {
    return this.#layoutPlayed;
  }

  /**
   * Same layout again. Nothing changes here — the caller builds a fresh
   * ShotSession from the layout — but once the layout has been played, the
   * shot that follows is a retry and `record` counts it as practice.
   */
  retryShot(): void {}

  nextShot(): void {
    this.#shotCounter++;
    this.#deal();
  }

  selectLevel(id: number): boolean {
    if (!LEVELS.some((level) => level.id === id)) return false;
    this.#level = levelById(id);
    this.#tiers = this.#trackerFor(this.#level);
    this.#exam = this.#level.exam ? freshExam(this.#level) : undefined;
    this.#state = { ...this.#state, currentLevel: id };
    this.#shotCounter++;
    this.#deal();
    this.#persist();
    return true;
  }

  /**
   * Score one evaluated shot. Only ever called once per shot, by the FSM guard.
   * A retry is answered as practice and touches nothing: not the tier window,
   * not the level's counts, not the exam run.
   */
  record(shot: ScoredShot): CampaignEvent {
    if (this.#layoutPlayed) return { advancedTier: false, levelCompleted: false, practice: true };
    this.#layoutPlayed = true;
    this.#countAttempt(shot);

    if (this.#level.exam) {
      return { advancedTier: false, levelCompleted: false, practice: false, ...this.#recordExam(shot) };
    }

    // A level that was already complete stays where the player put it: going
    // back to one is practice by choice, and must not bounce them on again.
    const wasCompleted = this.#tiers.completed;
    const result = this.#tiers.record(shot.qualifying);
    this.#writeTier();

    if (result.completed && !wasCompleted) {
      this.#advanceToNextLevel();
      return { advancedTier: false, levelCompleted: true, practice: false };
    }

    this.#persist();
    return { advancedTier: result.advanced, levelCompleted: false, practice: false };
  }

  resetProgress(): void {
    this.#store.reset();
    this.#state = emptyProgress();
    this.#level = levelById(FIRST_LEVEL_ID);
    this.#tiers = new TierTracker();
    this.#exam = undefined;
    this.#shotCounter++;
    this.#deal();
  }

  #recordExam(shot: ScoredShot): { examFinished?: ExamResult } {
    const run = this.#exam ?? freshExam(this.#level);
    const next: ExamRun = {
      total: run.total,
      shotsTaken: run.shotsTaken + 1,
      potted: run.potted + (shot.pottedTarget ? 1 : 0),
    };

    if (next.shotsTaken < next.total) {
      this.#exam = next;
      this.#persist();
      return {};
    }

    const previousBest = this.#state.examBest;
    const personalBest = previousBest === null || next.potted > previousBest;
    if (personalBest) this.#state = { ...this.#state, examBest: next.potted };

    // The run is over, so the next shot starts a new one, on a layout nobody
    // has played. Left as it was, the finished run kept counting — an
    // eleventh pot made a best of 11 out of 10, which the store rightly
    // refuses to load, and the whole save was thrown away with it.
    this.#exam = freshExam(this.#level);
    this.#shotCounter++;
    this.#deal();
    this.#persist();
    return { examFinished: { potted: next.potted, total: next.total, personalBest } };
  }

  #countAttempt(shot: ScoredShot): void {
    const current = levelProgress(this.#state, this.#level.id);
    this.#writeLevel({
      ...current,
      attempts: current.attempts + 1,
      qualified: current.qualified + (shot.qualifying ? 1 : 0),
      potted: current.potted + (shot.pottedTarget ? 1 : 0),
    });
  }

  #writeTier(): void {
    const current = levelProgress(this.#state, this.#level.id);
    const snapshot = this.#tiers.snapshot();
    this.#writeLevel({ ...current, tier: snapshot.tier, completed: snapshot.completed });
  }

  #writeLevel(progress: LevelProgress): void {
    this.#state = {
      ...this.#state,
      levels: { ...this.#state.levels, [String(this.#level.id)]: progress },
    };
  }

  #advanceToNextLevel(): void {
    const index = LEVELS.findIndex((level) => level.id === this.#level.id);
    const next = LEVELS[index + 1];
    if (!next) {
      this.#persist();
      return;
    }
    this.selectLevel(next.id);
  }

  #trackerFor(level: LevelDefinition): TierTracker {
    const progress = levelProgress(this.#state, level.id);
    return new TierTracker({ tier: progress.tier, completed: progress.completed });
  }

  /** A new layout, which nobody has played yet. */
  #deal(): void {
    this.#layout = this.#generate();
    this.#layoutPlayed = false;
  }

  #generate(): ShotLayout {
    // Alternate the cut side rather than leaving it to chance, so a run of
    // shots cannot all fall the same way.
    const side = this.#shotCounter % 2 === 0 ? 'left' : 'right';
    return generateShot(this.#level, this.#baseSeed + this.#shotCounter * 7919, {
      preferredSide: side,
    }).layout;
  }

  #persist(): void {
    this.#store.save(this.#state);
  }
}

function freshExam(level: LevelDefinition): ExamRun {
  return { shotsTaken: 0, total: level.examShots, potted: 0 };
}

export function emptyStats(): LevelProgress {
  return emptyLevelProgress();
}
