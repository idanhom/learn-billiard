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
import { type BandRecord, MASTERY_BANDS, MASTERY_WINDOW, bandKey } from './mastery';

/**
 * Version 2 added mastery by band. A version 1 save is still a good save, and
 * loads with no band played; the key keeps its old name so it is found.
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

  // Version 1 had no bands: it loads with none played.
  const bands: Record<string, BandRecord> = {};
  if (raw.version !== 1) {
    if (!isRecord(raw.bands)) return undefined;
    for (const [key, value] of Object.entries(raw.bands)) {
      if (!BAND_KEYS.has(key)) return undefined;
      const band = validateBand(value);
      if (!band) return undefined;
      bands[key] = band;
    }
  }

  return {
    version: PROGRESS_VERSION,
    currentLevel: raw.currentLevel,
    levels,
    examBest: examBest as number | null,
    bands,
  };
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
