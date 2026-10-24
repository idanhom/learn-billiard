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
import type { FractionMiss } from './drill-sheet';
import {
  type BandRecord,
  MASTERY_BANDS,
  bandIndex,
  bandKey,
  bandLabel,
  emptyBand,
  masteryRate,
  recordInBand,
} from './mastery';
import type { DrillKind } from './perception';
import { makeRng, pickWeighted } from './random';
import { FINAL_TIER, type GuideVisibility, type Tier, TierTracker } from './tiers';

/** The part of a shot outcome the campaign scores. */
export interface ScoredShot {
  readonly qualifying: boolean;
  readonly pottedTarget: boolean;
  /**
   * For mastery by band: the shot's cut, and whether it met the one standard.
   * Given only for shots played without the ghost ball.
   */
  readonly mastery?: { readonly cutDegrees: number; readonly onStandard: boolean };
}

/** A band of cut as the levels panel shows it. */
export interface BandMastery {
  readonly label: string;
  /** The share of its latest shots that met the standard, or null while there are too few. */
  readonly rate: number | null;
  /** How many of its latest shots there are, up to the window. */
  readonly shots: number;
  readonly mastered: boolean;
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
  /** The band this shot took to mastered, by its label. */
  readonly mastered?: string;
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
  overlap: false,
};

export class Campaign {
  readonly #store: ProgressStore;
  readonly #baseSeed: number;
  readonly #notice: string | undefined;

  #state: ProgressState;
  #level: LevelDefinition;
  #tiers: TierTracker;
  #layout: ShotLayout;
  /** The level the current layout was dealt from: the one in play, unless it is mixing in others. */
  #source: LevelDefinition;
  /** A shot at the current layout has been scored, so any further one is a retry. */
  #layoutPlayed = false;
  #shotCounter = 0;
  /** Layouts moved on through since the level in play was entered, so its perception drills start on a flash. */
  #turnOnLevel = 0;
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
    this.#source = this.#level;
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

  /**
   * The level the current layout was dealt from, whose band and invariants it
   * meets. The level in play, except when interleaving or reviewing draws a
   * shot from another; it is still scored at the level in play's allowance.
   */
  get layoutLevel(): LevelDefinition {
    return this.#source;
  }

  get tier(): Tier {
    return this.#tiers.tier;
  }

  /** The exam is exempt from tiers, and it and the perception drills show no guide. */
  get guides(): GuideVisibility {
    return this.#level.exam || this.#level.perception ? NO_GUIDES : this.#tiers.guides;
  }

  /** How often each fraction level's shots miss, as the review weighs them: what a drill sheet leans on. */
  get fractionMisses(): readonly FractionMiss[] {
    return LEVELS.filter((level) => level.fraction !== undefined).map((level) => {
      const { attempts, qualified } = levelProgress(this.#state, level.id);
      return { level, missRate: this.#missRate(level), attempts, missed: attempts - qualified };
    });
  }

  /** Which perception drill the current layout is for, on the level that has them: they alternate. */
  get drillKind(): DrillKind | undefined {
    if (!this.#level.perception) return undefined;
    return this.#turnOnLevel % 2 === 0 ? 'flash' : 'place';
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

  /** The tier's window of recent shots, oldest first: true for each that qualified. */
  get tierWindow(): readonly boolean[] {
    return this.#tiers.recent;
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
    this.#turnOnLevel++;
    this.#deal();
  }

  selectLevel(id: number): boolean {
    if (!LEVELS.some((level) => level.id === id)) return false;
    this.#level = levelById(id);
    this.#tiers = this.#trackerFor(this.#level);
    this.#exam = this.#level.exam ? freshExam(this.#level) : undefined;
    this.#state = { ...this.#state, currentLevel: id };
    this.#shotCounter++;
    this.#turnOnLevel = 0;
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
    const mastered = this.#recordMastery(shot);
    const news = mastered === undefined ? {} : { mastered };

    if (this.#level.exam) {
      return { advancedTier: false, levelCompleted: false, practice: false, ...this.#recordExam(shot), ...news };
    }

    // A level that was already complete stays where the player put it: going
    // back to one is practice by choice, and must not bounce them on again.
    const wasCompleted = this.#tiers.completed;
    const result = this.#tiers.record(shot.qualifying);
    this.#writeTier();

    if (result.completed && !wasCompleted) {
      this.#advanceToNextLevel();
      return { advancedTier: false, levelCompleted: true, practice: false, ...news };
    }

    this.#persist();
    return { advancedTier: result.advanced, levelCompleted: false, practice: false, ...news };
  }

  /** Mastery by ten-degree band of cut, for the levels panel. */
  get bands(): readonly BandMastery[] {
    return MASTERY_BANDS.map((_, i) => {
      const band = this.#band(i);
      return { label: bandLabel(i), rate: masteryRate(band), shots: band.recent.length, mastered: band.mastered };
    });
  }

  #band(index: number): BandRecord {
    return this.#state.bands[bandKey(index)] ?? emptyBand();
  }

  /** Note an unguided shot in its band; the band's label if this shot took it to mastered. */
  #recordMastery(shot: ScoredShot): string | undefined {
    if (!shot.mastery) return undefined;
    const index = bandIndex(shot.mastery.cutDegrees);
    if (index === undefined) return undefined;
    const before = this.#band(index);
    const after = recordInBand(before, shot.mastery.onStandard);
    this.#state = { ...this.#state, bands: { ...this.#state.bands, [bandKey(index)]: after } };
    return after.mastered && !before.mastered ? bandLabel(index) : undefined;
  }

  /**
   * How much a band needs work, as the weak-angles level weighs it: the share
   * of its latest shots that missed the standard, an even chance while it has
   * too few, and never nothing, so a mastered band still turns up.
   */
  #weakness(index: number): number {
    const rate = masteryRate(this.#band(index));
    return Math.max(REVIEW_FLOOR, rate === null ? 0.5 : 1 - rate);
  }

  resetProgress(): void {
    this.#store.reset();
    this.#state = emptyProgress();
    this.#level = levelById(FIRST_LEVEL_ID);
    this.#tiers = new TierTracker();
    this.#exam = undefined;
    this.#shotCounter++;
    this.#turnOnLevel = 0;
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
    const seed = this.#baseSeed + this.#shotCounter * 7919;
    this.#source = this.#sourceFor(seed);
    return generateShot(this.#source, seed, { preferredSide: side }).layout;
  }

  /**
   * Which level a shot is dealt from. Interleaving: at the last tier of a
   * fraction level, a share of the shots come from the fractions before it,
   * so telling them apart becomes part of the test. The review deals from all
   * five, weighted to the ones missed most, and the weak-angles level from the
   * ten-degree bands least mastered. Seeded, like the layout itself.
   */
  #sourceFor(seed: number): LevelDefinition {
    const rng = makeRng((seed ^ SOURCE_SEED_MIX) >>> 0);
    const fractions = LEVELS.filter((level) => level.fraction !== undefined);
    if (this.#level.review) {
      return pickWeighted(fractions, fractions.map((level) => this.#missRate(level)), rng());
    }
    if (this.#level.perception) return fractions[Math.floor(rng() * fractions.length)]!;
    if (this.#level.weak) {
      const bands = MASTERY_BANDS.map((_, i) => i);
      const index = pickWeighted(bands, bands.map((i) => this.#weakness(i)), rng());
      return { ...this.#level, cutRange: MASTERY_BANDS[index]! };
    }

    // Only a fraction level with others before it has anything to mix in.
    const at = fractions.indexOf(this.#level);
    if (at > 0 && this.#tiers.tier >= INTERLEAVE_FROM_TIER && rng() < INTERLEAVE_SHARE) {
      return fractions[Math.floor(rng() * at)]!;
    }
    return this.#level;
  }

  /**
   * How often a level's shots miss, smoothed so a level never played counts
   * as a coin toss, and floored so a mastered one still turns up in review.
   */
  #missRate(level: LevelDefinition): number {
    const { attempts, qualified } = levelProgress(this.#state, level.id);
    return Math.max(REVIEW_FLOOR, 1 - (qualified + 1) / (attempts + 2));
  }

  #persist(): void {
    this.#store.save(this.#state);
  }
}

/** From the last tier of a fraction level on, this share of shots come from the fractions before it. */
export const INTERLEAVE_SHARE = 0.4;
export const INTERLEAVE_FROM_TIER = FINAL_TIER;

/** The least weight a fraction level carries in review, however well it goes. */
const REVIEW_FLOOR = 0.1;

/** Keeps the choice of level independent of the layout drawn from the same seed. */
const SOURCE_SEED_MIX = 0x5bd1e995;

function freshExam(level: LevelDefinition): ExamRun {
  return { shotsTaken: 0, total: level.examShots, potted: 0 };
}

export function emptyStats(): LevelProgress {
  return emptyLevelProgress();
}
