import { describe, expect, test } from 'vitest';
import {
  PROGRESS_KEY,
  PROGRESS_VERSION,
  type ProgressState,
  type StorageLike,
  createProgressStore,
  emptyProgress,
  validateProgress,
} from '../../src/game/progress-store';

class FakeStorage implements StorageLike {
  readonly items = new Map<string, string>();
  failOnWrite = false;

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failOnWrite) throw new Error('QuotaExceededError');
    this.items.set(key, value);
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }
}

function populated(): ProgressState {
  return {
    version: PROGRESS_VERSION,
    currentLevel: 3,
    examBest: 7,
    levels: {
      '1': { tier: 3, completed: true, attempts: 21, qualified: 15, potted: 11 },
      '3': { tier: 1, completed: false, attempts: 4, qualified: 3, potted: 2 },
    },
    bands: {
      '30': { attempts: 12, recent: [true, false, true, true, true, true, false, true, true, true, true, true], mastered: false },
    },
    practiceDays: ['2026-10-25', '2026-10-23'],
    dailyFirstRuns: [{ date: '2026-10-25', score: 0.42 }],
    examFirstRuns: [{ date: '2026-10-23', score: 6 }],
    dailyRun: { date: '2026-10-25', errors: [0.2, 10, 0.4] },
  };
}

describe('empty progress', () => {
  test('starts on the first level with nothing recorded', () => {
    const empty = emptyProgress();
    expect(empty.version).toBe(PROGRESS_VERSION);
    expect(empty.currentLevel).toBe(1);
    expect(empty.levels).toEqual({});
    expect(empty.examBest).toBeNull();
    expect(empty.bands).toEqual({});
  });
});

describe('a save from before mastery by band', () => {
  test('loads, as it was, with no band played and no day or first run kept', () => {
    const { bands: _b, practiceDays: _p, dailyFirstRuns: _d, examFirstRuns: _e, dailyRun: _r, ...old } = populated();
    const loaded = validateProgress({ ...old, version: 1 });
    expect(loaded).toEqual({
      ...populated(),
      bands: {},
      practiceDays: [],
      dailyFirstRuns: [],
      examFirstRuns: [],
      dailyRun: null,
    });
  });

  test('but a current one without its bands is not a save', () => {
    const { bands: _bands, ...missing } = populated();
    expect(validateProgress(missing)).toBeUndefined();
  });
});

describe('days and first runs', () => {
  test('are dates, each once', () => {
    expect(validateProgress({ ...populated(), practiceDays: ['25/10/2026'] })).toBeUndefined();
    expect(validateProgress({ ...populated(), practiceDays: ['2026-10-25', '2026-10-25'] })).toBeUndefined();
    expect(
      validateProgress({
        ...populated(),
        dailyFirstRuns: [
          { date: '2026-10-25', score: 0.4 },
          { date: '2026-10-25', score: 0.3 },
        ],
      }),
    ).toBeUndefined();
  });

  test('keep a daily run in play that could be one', () => {
    expect(validateProgress({ ...populated(), dailyRun: null })).toBeDefined();
    expect(validateProgress({ ...populated(), dailyRun: { date: '2026-10-25', errors: Array(10).fill(0.1) } })).toBeUndefined();
    expect(validateProgress({ ...populated(), dailyRun: { date: '2026-10-25', errors: [-0.1] } })).toBeUndefined();
    expect(validateProgress({ ...populated(), dailyRun: { date: 'today', errors: [] } })).toBeUndefined();
  });

  test('hold scores that could have happened', () => {
    expect(validateProgress({ ...populated(), dailyFirstRuns: [{ date: '2026-10-25', score: -1 }] })).toBeUndefined();
    expect(validateProgress({ ...populated(), dailyFirstRuns: [{ date: '2026-10-25', score: 11 }] })).toBeUndefined();
    expect(validateProgress({ ...populated(), examFirstRuns: [{ date: '2026-10-25', score: 11 }] })).toBeUndefined();
    expect(validateProgress({ ...populated(), examFirstRuns: [{ date: '2026-10-25', score: 2.5 }] })).toBeUndefined();
  });
});

describe('band records', () => {
  const withBand = (key: string, band: unknown) => ({ ...populated(), bands: { [key]: band } });

  test('are only for the bands there are', () => {
    expect(validateProgress(withBand('35', { attempts: 1, recent: [true], mastered: false }))).toBeUndefined();
    expect(validateProgress(withBand('70', { attempts: 1, recent: [true], mastered: false }))).toBeUndefined();
  });

  test('hold no more results than the window, nor than were played', () => {
    expect(validateProgress(withBand('0', { attempts: 30, recent: Array(21).fill(true), mastered: false }))).toBeUndefined();
    expect(validateProgress(withBand('0', { attempts: 2, recent: [true, true, true], mastered: false }))).toBeUndefined();
  });

  test('hold only results, and say whether the band was mastered', () => {
    expect(validateProgress(withBand('0', { attempts: 1, recent: [1], mastered: false }))).toBeUndefined();
    expect(validateProgress(withBand('0', { attempts: 1, recent: [true], mastered: 'yes' }))).toBeUndefined();
  });
});

describe('validation', () => {
  test('accepts a well-formed state', () => {
    expect(validateProgress(populated())).toEqual(populated());
  });

  test('rejects anything that is not an object', () => {
    for (const bad of [null, undefined, 42, 'progress', [], true]) {
      expect(validateProgress(bad)).toBeUndefined();
    }
  });

  test('rejects a state written by a different version', () => {
    expect(validateProgress({ ...populated(), version: PROGRESS_VERSION + 1 })).toBeUndefined();
    expect(validateProgress({ ...populated(), version: 'one' })).toBeUndefined();
  });

  test('rejects a tier outside the range rather than clamping it silently', () => {
    const state = populated();
    expect(validateProgress({ ...state, levels: { '1': { ...state.levels['1']!, tier: 9 } } })).toBeUndefined();
    expect(validateProgress({ ...state, levels: { '1': { ...state.levels['1']!, tier: -1 } } })).toBeUndefined();
  });

  test('rejects impossible counters', () => {
    const state = populated();
    const level = state.levels['1']!;
    expect(validateProgress({ ...state, levels: { '1': { ...level, attempts: -3 } } })).toBeUndefined();
    expect(validateProgress({ ...state, levels: { '1': { ...level, attempts: 1.5 } } })).toBeUndefined();
    // More qualifying shots than attempts is not a state the game can produce.
    expect(validateProgress({ ...state, levels: { '1': { ...level, qualified: 99 } } })).toBeUndefined();
    expect(validateProgress({ ...state, levels: { '1': { ...level, potted: 99 } } })).toBeUndefined();
  });

  test('rejects an unknown level id', () => {
    const state = populated();
    expect(validateProgress({ ...state, levels: { '99': state.levels['1'] } })).toBeUndefined();
    expect(validateProgress({ ...state, currentLevel: 42 })).toBeUndefined();
  });

  test('rejects a missing field rather than filling it in', () => {
    const state = populated();
    const { completed: _completed, ...withoutCompleted } = state.levels['1']!;
    expect(validateProgress({ ...state, levels: { '1': withoutCompleted } })).toBeUndefined();
  });

  test('accepts a null exam best but not a nonsense one', () => {
    expect(validateProgress({ ...populated(), examBest: null })).toBeDefined();
    expect(validateProgress({ ...populated(), examBest: -1 })).toBeUndefined();
    expect(validateProgress({ ...populated(), examBest: 'lots' })).toBeUndefined();
  });
});

describe('the store', () => {
  test('round-trips a state', () => {
    const storage = new FakeStorage();
    const store = createProgressStore(storage);
    expect(store.save(populated())).toBe(true);
    const loaded = store.load();
    expect(loaded.state).toEqual(populated());
    expect(loaded.recovered).toBe(false);
  });

  test('an empty store is a fresh start, not a recovery', () => {
    const loaded = createProgressStore(new FakeStorage()).load();
    expect(loaded.state).toEqual(emptyProgress());
    expect(loaded.recovered).toBe(false);
  });

  test('corrupt json resets cleanly and says so', () => {
    const storage = new FakeStorage();
    storage.items.set(PROGRESS_KEY, '{not json at all');
    const loaded = createProgressStore(storage).load();
    expect(loaded.state).toEqual(emptyProgress());
    expect(loaded.recovered).toBe(true);
    expect(loaded.reason).toBeTruthy();
  });

  test('a state from another version resets cleanly and says so', () => {
    const storage = new FakeStorage();
    storage.items.set(PROGRESS_KEY, JSON.stringify({ ...populated(), version: 99 }));
    const loaded = createProgressStore(storage).load();
    expect(loaded.state).toEqual(emptyProgress());
    expect(loaded.recovered).toBe(true);
  });

  test('tampered progress resets rather than being trusted', () => {
    const storage = new FakeStorage();
    storage.items.set(
      PROGRESS_KEY,
      JSON.stringify({ ...populated(), levels: { '1': { tier: 3, completed: true, attempts: 1, qualified: 50, potted: 0 } } }),
    );
    expect(createProgressStore(storage).load().recovered).toBe(true);
  });

  test('a storage that refuses to write reports failure instead of throwing', () => {
    const storage = new FakeStorage();
    storage.failOnWrite = true;
    expect(() => createProgressStore(storage).save(populated())).not.toThrow();
    expect(createProgressStore(storage).save(populated())).toBe(false);
  });

  test('reset clears what was stored', () => {
    const storage = new FakeStorage();
    const store = createProgressStore(storage);
    store.save(populated());
    store.reset();
    expect(storage.getItem(PROGRESS_KEY)).toBeNull();
    expect(store.load().state).toEqual(emptyProgress());
  });

  test('an unavailable storage degrades to an in-memory session', () => {
    const store = createProgressStore(undefined);
    expect(store.load().state).toEqual(emptyProgress());
    expect(store.save(populated())).toBe(false);
    expect(() => store.reset()).not.toThrow();
  });
});
