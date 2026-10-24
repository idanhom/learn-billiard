import { describe, expect, test } from 'vitest';
import type { StorageLike } from '../../src/game/progress-store';
import { CLOTH_PRESET_IDS, clothRollingFriction } from '../../src/constants';
import { TABLE } from '../../src/geometry/table';
import { rollOutSeconds } from '../../src/geometry/roll-time';
import {
  SETTINGS_KEY,
  TIME_SCALES,
  createSettingsStore,
  defaultSettings,
  stepViewingDistance,
  nextCloth,
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

describe('the cloth setting', () => {
  /**
   * Not the 0.005-0.015 coefficient range usually quoted, and knowingly so —
   * see `ROLLING_FRICTION` for what the departure buys and what it costs. What
   * this asserts is the property the presets were actually chosen for: a table
   * length of free roll lands between three and five seconds on every one of
   * them. The exact figures live in `tests/documented-figures.test.ts`.
   */
  test('offers fast, normal and slow, and every one rolls like a table', () => {
    expect(CLOTH_PRESET_IDS).toEqual(['fast', 'normal', 'slow']);
    for (const id of CLOTH_PRESET_IDS) {
      const seconds = rollOutSeconds(TABLE.playLength, clothRollingFriction(id));
      expect(seconds, `${id} takes too long to cross the table`).toBeLessThan(5);
      expect(seconds, `${id} crosses the table too briskly`).toBeGreaterThan(3);
    }
  });

  test('slower cloth means more rolling resistance', () => {
    expect(clothRollingFriction('fast')).toBeLessThan(clothRollingFriction('normal'));
    expect(clothRollingFriction('normal')).toBeLessThan(clothRollingFriction('slow'));
  });

  test('starts on normal', () => {
    expect(defaultSettings().cloth).toBe('normal');
  });

  test('cycles through the cloths and wraps round', () => {
    expect(nextCloth('fast')).toBe('normal');
    expect(nextCloth('normal')).toBe('slow');
    expect(nextCloth('slow')).toBe('fast');
  });

  test('cycling from an unrecognised cloth lands back on the default', () => {
    expect(nextCloth('velvet' as never)).toBe('normal');
  });
});

describe('validation', () => {
  test('accepts a known speed', () => {
    expect(validateSettings({ version: 1, timeScale: 0.5, cloth: 'slow' })).toEqual({
      timeScale: 0.5,
      cloth: 'slow',
      viewingDistance: 0.6,
      tableFeet: 7,
      sound: true,
    });
  });

  /**
   * Records written before cloth existed are still perfectly good records. A
   * missing preference is absence, not corruption — resetting someone's
   * remembered playback speed because a newer field is not there would be
   * gratuitous.
   */
  test('an older record without a cloth loads as normal, keeping its time scale', () => {
    expect(validateSettings({ version: 1, timeScale: 0.25 })).toEqual({
      timeScale: 0.25,
      cloth: 'normal',
      viewingDistance: 0.6,
      tableFeet: 7,
      sound: true,
    });
  });

  test('but a cloth that is not on the list is rejected outright', () => {
    expect(validateSettings({ version: 1, timeScale: 1, cloth: 'ice' })).toBeUndefined();
    expect(validateSettings({ version: 1, timeScale: 1, cloth: 7 })).toBeUndefined();
    expect(validateSettings({ version: 1, timeScale: 1, cloth: null })).toBeUndefined();
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
    store.save({ timeScale: 0.25, cloth: 'slow', viewingDistance: 0.6, tableFeet: 7, sound: true });
    const loaded = createSettingsStore(storage).load();
    expect(loaded.timeScale).toBe(0.25);
    expect(loaded.cloth).toBe('slow');
  });

  /**
   * `save` writes the whole object, so a caller that changes one setting must
   * hand back the other one too. These pin that, because the failure mode is
   * silent: change the cloth, lose your slow motion.
   */
  test('changing the cloth leaves the time scale alone', () => {
    const storage = new FakeStorage();
    const store = createSettingsStore(storage);
    store.save({ timeScale: 0.5, cloth: 'normal', viewingDistance: 0.6, tableFeet: 7, sound: true });
    const current = store.load();
    store.save({ ...current, cloth: 'fast' });
    expect(store.load()).toEqual({ timeScale: 0.5, cloth: 'fast', viewingDistance: 0.6, tableFeet: 7, sound: true });
  });

  test('changing the time scale leaves the cloth alone', () => {
    const storage = new FakeStorage();
    const store = createSettingsStore(storage);
    store.save({ timeScale: 1, cloth: 'slow', viewingDistance: 0.6, tableFeet: 7, sound: true });
    const current = store.load();
    store.save({ ...current, timeScale: 0.25 });
    expect(store.load()).toEqual({ timeScale: 0.25, cloth: 'slow', viewingDistance: 0.6, tableFeet: 7, sound: true });
  });

  test('a record saved before cloth existed keeps its remembered speed', () => {
    const storage = new FakeStorage();
    storage.items.set(SETTINGS_KEY, JSON.stringify({ version: 1, timeScale: 0.5 }));
    expect(createSettingsStore(storage).load()).toEqual({ timeScale: 0.5, cloth: 'normal', viewingDistance: 0.6, tableFeet: 7, sound: true });
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
    expect(() => createSettingsStore(storage).save({ timeScale: 0.5, cloth: 'normal', viewingDistance: 0.6, tableFeet: 7, sound: true })).not.toThrow();
  });

  test('works with no storage at all', () => {
    const store = createSettingsStore(undefined);
    expect(store.load()).toEqual(defaultSettings());
    expect(() => store.save({ timeScale: 0.5, cloth: 'normal', viewingDistance: 0.6, tableFeet: 7, sound: true })).not.toThrow();
  });
});

describe('the viewing distance', () => {
  test('defaults to 60 cm, and a record written before it existed loads with that', () => {
    expect(defaultSettings().viewingDistance).toBe(0.6);
    expect(validateSettings({ version: 1, timeScale: 1, cloth: 'normal' })!.viewingDistance).toBe(0.6);
  });

  test('round-trips, and is rejected outside the range or as nonsense', () => {
    expect(validateSettings({ version: 1, timeScale: 1, cloth: 'normal', viewingDistance: 0.4 })!.viewingDistance).toBe(0.4);
    for (const bad of [0.1, 2, 'far', null, Number.NaN]) {
      expect(validateSettings({ version: 1, timeScale: 1, cloth: 'normal', viewingDistance: bad }), String(bad)).toBeUndefined();
    }
  });

  test('steps by 5 cm and stays inside 25-150 cm', () => {
    expect(stepViewingDistance(0.6, 1)).toBe(0.65);
    expect(stepViewingDistance(0.6, -1)).toBe(0.55);
    expect(stepViewingDistance(0.25, -1)).toBe(0.25);
    expect(stepViewingDistance(1.5, 1)).toBe(1.5);
  });
});

describe('the player\u2019s own table', () => {
  test('is a 7-foot one until said otherwise, as is a record from before it existed', () => {
    expect(defaultSettings().tableFeet).toBe(7);
    expect(validateSettings({ version: 1, timeScale: 1, cloth: 'normal' })!.tableFeet).toBe(7);
  });

  test('keeps an 8 or a 9, and rejects any other size', () => {
    expect(validateSettings({ version: 1, timeScale: 1, tableFeet: 9 })!.tableFeet).toBe(9);
    expect(validateSettings({ version: 1, timeScale: 1, tableFeet: 8 })!.tableFeet).toBe(8);
    for (const bad of [6, 10, '9', null]) {
      expect(validateSettings({ version: 1, timeScale: 1, tableFeet: bad }), String(bad)).toBeUndefined();
    }
  });
});

describe('sound', () => {
  test('is on until turned off, as it is in a record from before it existed', () => {
    expect(defaultSettings().sound).toBe(true);
    expect(validateSettings({ version: 1, timeScale: 1 })!.sound).toBe(true);
    expect(validateSettings({ version: 1, timeScale: 1, sound: false })!.sound).toBe(false);
    expect(validateSettings({ version: 1, timeScale: 1, sound: 'off' })).toBeUndefined();
  });
});
