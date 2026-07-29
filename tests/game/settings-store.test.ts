import { describe, expect, test } from 'vitest';
import type { StorageLike } from '../../src/game/progress-store';
import {
  SETTINGS_KEY,
  TIME_SCALES,
  createSettingsStore,
  defaultSettings,
  nextTimeScale,
  validateSettings,
} from '../../src/game/settings-store';

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

describe('the speed setting', () => {
  test('offers full, half and quarter speed', () => {
    expect(TIME_SCALES).toEqual([1, 0.5, 0.25]);
  });

  test('starts at full speed', () => {
    expect(defaultSettings().timeScale).toBe(1);
  });

  test('cycles through the speeds and wraps round', () => {
    expect(nextTimeScale(1)).toBe(0.5);
    expect(nextTimeScale(0.5)).toBe(0.25);
    expect(nextTimeScale(0.25)).toBe(1);
  });

  test('cycling from an unrecognised speed lands back at full', () => {
    expect(nextTimeScale(0.9)).toBe(1);
  });
});

describe('validation', () => {
  test('accepts a known speed', () => {
    expect(validateSettings({ version: 1, timeScale: 0.5 })).toEqual({ timeScale: 0.5 });
  });

  test('rejects a speed that is not on the list', () => {
    expect(validateSettings({ version: 1, timeScale: 0.37 })).toBeUndefined();
    expect(validateSettings({ version: 1, timeScale: 0 })).toBeUndefined();
    expect(validateSettings({ version: 1, timeScale: 'half' })).toBeUndefined();
  });

  test('rejects a version it does not understand', () => {
    expect(validateSettings({ version: 2, timeScale: 1 })).toBeUndefined();
  });

  test('rejects anything that is not an object', () => {
    for (const bad of [null, undefined, 7, 'fast', []]) {
      expect(validateSettings(bad)).toBeUndefined();
    }
  });
});

describe('the store', () => {
  test('round-trips a setting', () => {
    const storage = new FakeStorage();
    const store = createSettingsStore(storage);
    store.save({ timeScale: 0.25 });
    expect(createSettingsStore(storage).load().timeScale).toBe(0.25);
  });

  test('an empty store is full speed', () => {
    expect(createSettingsStore(new FakeStorage()).load()).toEqual(defaultSettings());
  });

  test('a corrupt setting falls back to full speed without touching progress', () => {
    const storage = new FakeStorage();
    storage.items.set(SETTINGS_KEY, 'not json');
    storage.items.set('pool-angle-trainer/progress/v1', '{"kept":true}');
    expect(createSettingsStore(storage).load()).toEqual(defaultSettings());
    // A bad preference is not a reason to throw away someone's progress.
    expect(storage.getItem('pool-angle-trainer/progress/v1')).toBe('{"kept":true}');
  });

  test('is stored under its own key, apart from progress', () => {
    expect(SETTINGS_KEY).not.toContain('progress');
  });

  test('a storage that refuses to write does not throw', () => {
    const storage = new FakeStorage();
    storage.failOnWrite = true;
    expect(() => createSettingsStore(storage).save({ timeScale: 0.5 })).not.toThrow();
  });

  test('works with no storage at all', () => {
    const store = createSettingsStore(undefined);
    expect(store.load()).toEqual(defaultSettings());
    expect(() => store.save({ timeScale: 0.5 })).not.toThrow();
  });
});
