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

import type { Vec2 } from '../geometry/vec2';
import type { ShotLayout } from './drills';
import { generateShot } from './generator';
import {
  FIRST_LEVEL_ID,
  type LevelDefinition,
  LEVELS,
  levelById,
} from './levels';
import {
  type DailyRun,
  type LevelProgress,
  type ProgressState,
  type ProgressStore,
  emptyLevelProgress,
  emptyProgress,
  levelProgress,
} from './progress-store';
import {
  DAILY_SHOTS,
  type FirstRun,
  addFirstRun,
  dailySeed,
  daysPractised,
  firstRunOn,
  localDate,
  markPractised,
  median,
  shotError,
} from './daily';
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
import { type PositionAsk, RUNGS, rungDistances } from './position';
import { SPEED_RUNGS, type SpeedTarget, speedLayout } from './speed';
import { zoneLayout } from './zones';
import { PATTERN_SIZES, type Pattern, dealPattern, patternLayout } from './patterns';
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
  /** The share of the pocket the aim used, or null with no line: what the daily set scores. */
  readonly pocketUsed?: number | null;
  /** The cue ball went in. */
  readonly scratch?: boolean;
  /** Where the cue ball stopped: where a pattern's next shot is played from. */
  readonly cueRest?: Vec2;
}

export interface DailyResult {
  /** The run's median share of the pocket. */
  readonly median: number;
  /** This was the day's first run, the one that counts. */
  readonly first: boolean;
  /** The day's first run, which stands. */
  readonly firstToday: number;
  /** The first runs of the days before, latest first, up to six. */
  readonly earlier: readonly FirstRun<number>[];
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
  /** This was the day's first finished run. */
  readonly first: boolean;
  /** The day's first finished run, which stands. */
  readonly firstToday: number;
}

export interface CampaignEvent {
  readonly advancedTier: boolean;
  readonly levelCompleted: boolean;
  /** A retry of a layout already played: practice, so nothing was counted. */
  readonly practice: boolean;
  readonly examFinished?: ExamResult;
  /** The band this shot took to mastered, by its label. */
  readonly mastered?: string;
  readonly dailyFinished?: DailyResult;
  /** On a pattern: how many of its balls are down, of how many, and whether the run is over. */
  readonly pattern?: { readonly down: number; readonly of: number; readonly over: boolean };
}

export interface CampaignOptions {
  /** Base seed; each shot uses seed + a counter, so a session is reproducible. */
  readonly seed?: number;
  /** Today, as YYYY-MM-DD: the local date unless a test says otherwise. */
  readonly today?: () => string;
}

const NO_GUIDES: GuideVisibility = {
  aimLine: false,
  ghostBall: false,
  objectPath: false,
  readout: false,
  powerHint: false,
  overlap: false,
};

/** The shot the game plays itself: its line, the ghost ball, and the object ball's path. */
const SHOT_SHOWN: GuideVisibility = {
  aimLine: true,
  ghostBall: true,
  objectPath: true,
  readout: false,
  powerHint: false,
  overlap: false,
};

/** The cue ball alone: only the line it starts on. */
const CUE_ALONE: GuideVisibility = { ...NO_GUIDES, aimLine: true };

export class Campaign {
  readonly #store: ProgressStore;
  readonly #baseSeed: number;
  readonly #today: () => string;
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
  /** A pattern being run: which ball is next, and where the cue ball is. */
  #run: { readonly pattern: Pattern; readonly seed: number; readonly index: number; readonly cue: Vec2 } | undefined;

  constructor(store: ProgressStore, options: CampaignOptions = {}) {
    this.#store = store;
    this.#baseSeed = options.seed ?? 1;
    this.#today = options.today ?? (() => localDate());

    const loaded = store.load();
    this.#state = loaded.state;
    this.#notice = loaded.recovered ? loaded.reason : undefined;

    this.#level = levelById(this.#state.currentLevel);
    this.#tiers = this.#trackerFor(this.#level);
    this.#exam = this.#level.exam ? freshExam(this.#level) : undefined;
    this.#source = this.#level;
    this.#layout = this.#generate();
  }

  /** The daily set's run in play: today's, picked up where it was left, or a fresh one. */
  #dailyRun(): DailyRun {
    const today = this.#today();
    const kept = this.#state.dailyRun;
    if (kept?.date === today) return kept;
    const run = { date: today, errors: [] };
    this.#state = { ...this.#state, dailyRun: run };
    return run;
  }

  get notice(): string | undefined {
    return this.#notice;
  }

  /** Nothing played anywhere, and nothing lost to a bad save: a first launch, as far as can be told. */
  get isFresh(): boolean {
    return this.#notice === undefined && Object.values(this.#state.levels).every((level) => level.attempts === 0);
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

  /**
   * The exam is exempt from tiers, and it, the daily set and the perception
   * drills show no guide. A level about the cue ball shows the shot it plays,
   * whatever the tier: the aim is not what it tests.
   */
  get guides(): GuideVisibility {
    if (this.#level.scoring?.kind === 'speed') return CUE_ALONE;
    if (this.#level.scoring) return SHOT_SHOWN;
    return this.#level.exam || this.#level.perception || this.#level.daily ? NO_GUIDES : this.#tiers.guides;
  }

  /** The daily set's run in play, on its level. */
  get daily(): { readonly shot: number; readonly total: number; readonly firstToday: number | null } | undefined {
    if (!this.#level.daily) return undefined;
    const run = this.#dailyRun();
    const standing = firstRunOn(this.#state.dailyFirstRuns, run.date);
    return { shot: run.errors.length + 1, total: DAILY_SHOTS, firstToday: standing?.score ?? null };
  }

  /** On how many of the last seven days there was practice, today included. */
  get daysPractised(): number {
    return daysPractised(this.#state.practiceDays, this.#today());
  }

  /** The next shot of the pattern being run, or the first of a new one, as big as the tier asks. */
  #patternShot(): ShotLayout {
    if (!this.#run) {
      const seed = this.#baseSeed + this.#shotCounter * 7919;
      const pattern = dealPattern(PATTERN_SIZES[this.#tiers.tier]!, this.#level, seed);
      this.#run = { pattern, seed, index: 0, cue: pattern.cue };
    }
    this.#source = this.#level;
    const { pattern, seed, index, cue } = this.#run;
    return patternLayout(pattern, index, cue, `L${this.#level.id}-p${seed}-b${index + 1}`);
  }

  /** On the patterns level: which ball is next, of how many. */
  get pattern(): { readonly ball: number; readonly of: number } | undefined {
    if (this.#level.scoring?.kind !== 'pattern' || !this.#run) return undefined;
    return { ball: this.#run.index + 1, of: this.#run.pattern.balls.length };
  }

  /** On a speed level: which drill, and how far the ring is. */
  get speed(): { readonly target: SpeedTarget; readonly distance: number } | undefined {
    const scoring = this.#source.scoring;
    if (scoring?.kind !== 'speed') return undefined;
    return { target: scoring.target, distance: scoring.distance ?? 0 };
  }

  /** On a level that plays for position: what the layout in play asks the cue ball to do, and how far. */
  get position(): { readonly target: PositionAsk; readonly distance: number } | undefined {
    const scoring = this.#source.scoring;
    if (scoring?.kind === 'zone') return { target: 'zone', distance: 0 };
    if (scoring?.kind !== 'position') return undefined;
    return { target: scoring.target, distance: scoring.distance ?? 0 };
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
    // A run is a sitting: leaving the level ends it.
    this.#run = undefined;
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
    this.#state = { ...this.#state, practiceDays: markPractised(this.#state.practiceDays, this.#today()) };
    const mastered = this.#recordMastery(shot);
    const news = mastered === undefined ? {} : { mastered };

    if (this.#level.daily) {
      return { advancedTier: false, levelCompleted: false, practice: false, ...this.#recordDaily(shot), ...news };
    }

    if (this.#level.scoring?.kind === 'pattern' && this.#run) {
      const run = this.#run;
      const of = run.pattern.balls.length;
      const clean = shot.pottedTarget && !shot.scratch;
      if (clean && run.index < of - 1) {
        // On to the next ball, from where the cue ball stopped. The run is scored once, at its end.
        this.#run = { ...run, index: run.index + 1, cue: shot.cueRest ?? run.cue };
        this.#persist();
        return { advancedTier: false, levelCompleted: false, practice: false, pattern: { down: run.index + 1, of, over: false }, ...news };
      }
      this.#run = undefined;
      const pattern = { down: clean ? of : run.index, of, over: true };
      const wasCompleted = this.#tiers.completed;
      const result = this.#tiers.record(clean);
      this.#writeTier();
      if (result.completed && !wasCompleted) {
        this.#advanceToNextLevel();
        return { advancedTier: false, levelCompleted: true, practice: false, pattern, ...news };
      }
      this.#persist();
      return { advancedTier: result.advanced, levelCompleted: false, practice: false, pattern, ...news };
    }
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
    // The day's first finished run is kept as well, beside the best.
    const today = this.#today();
    const standing = firstRunOn(this.#state.examFirstRuns, today);
    if (!standing) {
      this.#state = { ...this.#state, examFirstRuns: addFirstRun(this.#state.examFirstRuns, { date: today, score: next.potted }) };
    }

    // The run is over, so the next shot starts a new one, on a layout nobody
    // has played. Left as it was, the finished run kept counting — an
    // eleventh pot made a best of 11 out of 10, which the store rightly
    // refuses to load, and the whole save was thrown away with it.
    this.#exam = freshExam(this.#level);
    this.#shotCounter++;
    this.#deal();
    this.#persist();
    return {
      examFinished: {
        potted: next.potted,
        total: next.total,
        personalBest,
        first: !standing,
        firstToday: standing?.score ?? next.potted,
      },
    };
  }

  /**
   * One shot of the daily set, scored on the share of the pocket it used. The
   * tenth closes the run on its median, and only a day's first run is kept.
   */
  #recordDaily(shot: ScoredShot): { dailyFinished?: DailyResult } {
    const run = this.#dailyRun();
    const errors = [...run.errors, shotError(shot.pocketUsed ?? null)];
    if (errors.length < DAILY_SHOTS) {
      this.#state = { ...this.#state, dailyRun: { ...run, errors } };
      this.#persist();
      return {};
    }

    const score = median(errors);
    const standing = firstRunOn(this.#state.dailyFirstRuns, run.date);
    const earlier = this.#state.dailyFirstRuns.filter((other) => other.date < run.date).slice(0, 6);
    this.#state = {
      ...this.#state,
      dailyRun: null,
      ...(standing ? {} : { dailyFirstRuns: addFirstRun(this.#state.dailyFirstRuns, { date: run.date, score }) }),
    };
    this.#shotCounter++;
    this.#deal();
    this.#persist();
    return { dailyFinished: { median: score, first: !standing, firstToday: standing?.score ?? score, earlier } };
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
    if (this.#level.daily) return this.#dailyLayout();
    const scoring = this.#level.scoring;
    if (scoring?.kind === 'pattern') return this.#patternShot();
    if (scoring?.kind === 'zone') {
      this.#source = this.#level;
      return zoneLayout(this.#level, this.#baseSeed + this.#shotCounter * 7919);
    }
    if (scoring?.kind === 'speed') {
      // The tier is the rung for speed control; the lag is the same every time.
      const distance = scoring.target === 'distance' ? SPEED_RUNGS[this.#tiers.tier]! : 0;
      this.#source = { ...this.#level, scoring: { ...scoring, distance } };
      const seed = this.#baseSeed + this.#shotCounter * 7919;
      return speedLayout(scoring.target, distance, seed, `L${this.#level.id}-s${seed}`);
    }
    // Alternate the cut side rather than leaving it to chance, so a run of
    // shots cannot all fall the same way.
    const side = this.#shotCounter % 2 === 0 ? 'left' : 'right';
    const seed = this.#baseSeed + this.#shotCounter * 7919;
    this.#source = this.#sourceFor(seed);
    return generateShot(this.#source, seed, { preferredSide: side }).layout;
  }

  /**
   * Shot n of the day's set: the same for everyone that day, whatever else
   * they have played, and the same again until it is played, so Next cannot
   * pass over a hard one.
   */
  #dailyLayout(): ShotLayout {
    const run = this.#dailyRun();
    const index = run.errors.length;
    this.#source = DAILY_SOURCES[index % DAILY_SOURCES.length]!;
    const seed = (dailySeed(run.date) + index * 7919) >>> 0;
    return generateShot(this.#source, seed, { preferredSide: index % 2 === 0 ? 'left' : 'right' }).layout;
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
    const scoring = this.#level.scoring;
    if (scoring?.kind === 'position') {
      // The tier is the rung: the spot further each time, and the layout with room for it.
      const distance = RUNGS[scoring.target][this.#tiers.tier]!;
      return { ...this.#level, ...rungDistances(scoring.target, distance), scoring: { ...scoring, distance } };
    }
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

/** The levels the daily set deals from in turn: the five fractions, then distance and rails. */
const DAILY_SOURCES = LEVELS.filter((level) => level.id >= 1 && level.id <= 6);

/** Keeps the choice of level independent of the layout drawn from the same seed. */
const SOURCE_SEED_MIX = 0x5bd1e995;

function freshExam(level: LevelDefinition): ExamRun {
  return { shotsTaken: 0, total: level.examShots, potted: 0 };
}

export function emptyStats(): LevelProgress {
  return emptyLevelProgress();
}
