/**
 * Persistence.
 *
 * Stored progress is untrusted input like any other: it is validated field by
 * field on load, and anything that does not check out is discarded in favour of
 * a clean start with a visible notice. Silently repairing a half-valid save is
 * worse than resetting — the player would be practising against numbers the
 * game never actually produced.
 *
 * Local-only by design. No sync, no accounts, nothing to trust but this
 * machine.
 */

import { FINAL_TIER, type Tier } from './tiers';
import { LEVELS, examLevel } from './levels';
import { DAILY_SHOTS, DAYS_KEPT, type FirstRun, NO_LINE } from './daily';
import { type BandRecord, MASTERY_BANDS, MASTERY_WINDOW, bandKey } from './mastery';

/**
 * Version 2 added mastery by band, the days practised, and the first runs of
 * the daily set and the exam. A version 1 save is still a good save, and
 * loads with none of them yet; the key keeps its old name so it is found.
 */
export const PROGRESS_VERSION = 2;
export const PROGRESS_KEY = 'pool-angle-trainer/progress/v1';

export interface LevelProgress {
  readonly tier: Tier;
  readonly completed: boolean;
  readonly attempts: number;
  readonly qualified: number;
  readonly potted: number;
}

export interface ProgressState {
  readonly version: number;
  readonly currentLevel: number;
  /** Keyed by level id as a string, because JSON has no integer keys. */
  readonly levels: Readonly<Record<string, LevelProgress>>;
  /** Best exam score so far, or null if the exam has not been sat. */
  readonly examBest: number | null;
  /** Mastery by ten-degree band of cut, keyed by the degree each starts at. */
  readonly bands: Readonly<Record<string, BandRecord>>;
  /** Days with a shot or drill scored, latest first, as YYYY-MM-DD. */
  readonly practiceDays: readonly string[];
  /** The first run of the daily set each day: its median share of the pocket. Latest first. */
  readonly dailyFirstRuns: readonly FirstRun<number>[];
  /** The first exam run each day: how many it potted. Latest first. */
  readonly examFirstRuns: readonly FirstRun<number>[];
  /**
   * The daily set's run in play, kept so that leaving it, by a reload or for
   * another level, does not start the day's first run over.
   */
  readonly dailyRun: DailyRun | null;
}

export interface DailyRun {
  readonly date: string;
  /** Each shot's share of the pocket so far. */
  readonly errors: readonly number[];
}

export interface LoadResult {
  readonly state: ProgressState;
  /** True when something was stored but could not be used, and was discarded. */
  readonly recovered: boolean;
  readonly reason?: string;
}

/** The slice of the Storage API this needs; keeps localStorage out of the logic. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ProgressStore {
  load(): LoadResult;
  save(state: ProgressState): boolean;
  reset(): void;
}

const LEVEL_IDS = new Set(LEVELS.map((level) => String(level.id)));
const BAND_KEYS = new Set(MASTERY_BANDS.map((_, i) => bandKey(i)));
const CURRENT_LEVEL_IDS = new Set(LEVELS.map((level) => level.id));

export function emptyProgress(): ProgressState {
  return {
    version: PROGRESS_VERSION,
    currentLevel: LEVELS[0]!.id,
    levels: {},
    examBest: null,
    bands: {},
    practiceDays: [],
    dailyFirstRuns: [],
    examFirstRuns: [],
    dailyRun: null,
  };
}

export function emptyLevelProgress(): LevelProgress {
  return { tier: 0, completed: false, attempts: 0, qualified: 0, potted: 0 };
}

export function levelProgress(state: ProgressState, levelId: number): LevelProgress {
  return state.levels[String(levelId)] ?? emptyLevelProgress();
}

/** Parse a stored value into a state, or undefined if it is not one. */
export function validateProgress(raw: unknown): ProgressState | undefined {
  if (!isRecord(raw)) return undefined;
  if (raw.version !== PROGRESS_VERSION && raw.version !== 1) return undefined;
  if (typeof raw.currentLevel !== 'number' || !CURRENT_LEVEL_IDS.has(raw.currentLevel)) {
    return undefined;
  }

  const examShots = examLevel().examShots;
  const examBest = raw.examBest;
  if (examBest !== null) {
    if (!isCount(examBest) || examBest > examShots) return undefined;
  }

  if (!isRecord(raw.levels)) return undefined;
  const levels: Record<string, LevelProgress> = {};
  for (const [key, value] of Object.entries(raw.levels)) {
    if (!LEVEL_IDS.has(key)) return undefined;
    const level = validateLevel(value);
    if (!level) return undefined;
    levels[key] = level;
  }

  // Version 1 had none of what follows: it loads with none of it yet.
  const bands: Record<string, BandRecord> = {};
  let practiceDays: string[] = [];
  let dailyFirstRuns: FirstRun<number>[] = [];
  let examFirstRuns: FirstRun<number>[] = [];
  let dailyRun: DailyRun | null = null;
  if (raw.version !== 1) {
    if (!isRecord(raw.bands)) return undefined;
    for (const [key, value] of Object.entries(raw.bands)) {
      if (!BAND_KEYS.has(key)) return undefined;
      const band = validateBand(value);
      if (!band) return undefined;
      bands[key] = band;
    }
    const days = raw.practiceDays;
    if (!Array.isArray(days) || days.length > DAYS_KEPT || !days.every(isDate) || new Set(days).size !== days.length) {
      return undefined;
    }
    practiceDays = days as string[];
    const daily = validateFirstRuns(raw.dailyFirstRuns, (score) => typeof score === 'number' && score >= 0 && score <= NO_LINE);
    const exam = validateFirstRuns(raw.examFirstRuns, (score) => isCount(score) && score <= examShots);
    if (!daily || !exam) return undefined;
    dailyFirstRuns = daily;
    examFirstRuns = exam;
    if (raw.dailyRun !== null) {
      const run = raw.dailyRun;
      if (!isRecord(run) || !isDate(run.date) || !Array.isArray(run.errors)) return undefined;
      if (run.errors.length >= DAILY_SHOTS || !run.errors.every((e) => typeof e === 'number' && e >= 0 && e <= NO_LINE)) {
        return undefined;
      }
      dailyRun = { date: run.date, errors: run.errors as number[] };
    }
  }

  return {
    version: PROGRESS_VERSION,
    currentLevel: raw.currentLevel,
    levels,
    examBest: examBest as number | null,
    bands,
    practiceDays,
    dailyFirstRuns,
    examFirstRuns,
    dailyRun,
  };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isDate(value: unknown): value is string {
  return typeof value === 'string' && DATE.test(value);
}

/** One run a day at most, each with a date and a score that `scoreOk` accepts. */
function validateFirstRuns(raw: unknown, scoreOk: (score: unknown) => boolean): FirstRun<number>[] | undefined {
  if (!Array.isArray(raw) || raw.length > DAYS_KEPT) return undefined;
  const dates = new Set<string>();
  for (const run of raw) {
    if (!isRecord(run) || !isDate(run.date) || !scoreOk(run.score) || dates.has(run.date)) return undefined;
    dates.add(run.date);
  }
  return raw.map((run) => ({ date: run.date as string, score: run.score as number }));
}

function validateBand(raw: unknown): BandRecord | undefined {
  if (!isRecord(raw)) return undefined;
  const { attempts, recent, mastered } = raw;
  if (!isCount(attempts) || typeof mastered !== 'boolean') return undefined;
  if (!Array.isArray(recent) || recent.length > MASTERY_WINDOW || recent.length > attempts) return undefined;
  if (!recent.every((result) => typeof result === 'boolean')) return undefined;
  return { attempts, recent: recent as boolean[], mastered };
}

function validateLevel(raw: unknown): LevelProgress | undefined {
  if (!isRecord(raw)) return undefined;
  const { tier, completed, attempts, qualified, potted } = raw;

  if (typeof tier !== 'number' || !Number.isInteger(tier) || tier < 0 || tier > FINAL_TIER) {
    return undefined;
  }
  if (typeof completed !== 'boolean') return undefined;
  if (!isCount(attempts) || !isCount(qualified) || !isCount(potted)) return undefined;
  // A shot cannot qualify, or be potted, without having been attempted.
  if (qualified > attempts || potted > attempts) return undefined;

  return { tier: tier as Tier, completed, attempts, qualified, potted };
}

export function createProgressStore(storage: StorageLike | undefined, key = PROGRESS_KEY): ProgressStore {
  return {
    load(): LoadResult {
      if (!storage) return { state: emptyProgress(), recovered: false };

      let stored: string | null;
      try {
        stored = storage.getItem(key);
      } catch {
        return { state: emptyProgress(), recovered: true, reason: 'storage could not be read' };
      }
      if (stored === null) return { state: emptyProgress(), recovered: false };

      let parsed: unknown;
      try {
        parsed = JSON.parse(stored);
      } catch {
        return { state: emptyProgress(), recovered: true, reason: 'saved progress was unreadable' };
      }

      const state = validateProgress(parsed);
      if (!state) {
        return {
          state: emptyProgress(),
          recovered: true,
          reason: 'saved progress did not match this version and was reset',
        };
      }
      return { state, recovered: false };
    },

    save(state: ProgressState): boolean {
      if (!storage) return false;
      try {
        storage.setItem(key, JSON.stringify(state));
        return true;
      } catch {
        return false;
      }
    },

    reset(): void {
      if (!storage) return;
      try {
        storage.removeItem(key);
      } catch {
        // A storage that will not forget is not worth crashing over.
      }
    },
  };
}

/** localStorage if the browser will give it to us; otherwise nothing. */
export function browserStorage(): StorageLike | undefined {
  try {
    const probe = '__pool_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
