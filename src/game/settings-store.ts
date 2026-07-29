/**
 * Preferences, kept deliberately apart from progress.
 *
 * Progress is validated strictly and reset wholesale if anything is off,
 * because half-repaired progress would have the player practising against
 * numbers the game never produced. A preference has no such weight: if the
 * stored playback speed is nonsense, the right answer is to fall back to full
 * speed and carry on — not to throw away someone's level history. Separate
 * key, separate lifetime.
 */

import type { StorageLike } from './progress-store';

export const SETTINGS_VERSION = 1;
export const SETTINGS_KEY = 'pool-angle-trainer/settings/v1';

/**
 * Playback speeds. The simulation tick is fixed at 1/240 s and is not touched
 * by these — only how much simulated time one rendered frame is allowed to
 * consume. Half speed is therefore the same shot, watched for twice as long,
 * not a different shot.
 */
export const TIME_SCALES = [1, 0.5, 0.25] as const;

export type TimeScale = (typeof TIME_SCALES)[number];

export interface Settings {
  readonly timeScale: TimeScale;
}

export interface SettingsStore {
  load(): Settings;
  save(settings: Settings): void;
}

export function defaultSettings(): Settings {
  return { timeScale: TIME_SCALES[0] };
}

/** Next speed in the cycle; an unrecognised value restarts at full speed. */
export function nextTimeScale(current: number): TimeScale {
  const index = TIME_SCALES.indexOf(current as TimeScale);
  if (index === -1) return TIME_SCALES[0];
  return TIME_SCALES[(index + 1) % TIME_SCALES.length]!;
}

export function validateSettings(raw: unknown): Settings | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  if (record.version !== SETTINGS_VERSION) return undefined;
  if (!TIME_SCALES.includes(record.timeScale as TimeScale)) return undefined;
  return { timeScale: record.timeScale as TimeScale };
}

export function createSettingsStore(
  storage: StorageLike | undefined,
  key = SETTINGS_KEY,
): SettingsStore {
  return {
    load(): Settings {
      if (!storage) return defaultSettings();
      try {
        const stored = storage.getItem(key);
        if (stored === null) return defaultSettings();
        return validateSettings(JSON.parse(stored)) ?? defaultSettings();
      } catch {
        return defaultSettings();
      }
    },

    save(settings: Settings): void {
      if (!storage) return;
      try {
        storage.setItem(key, JSON.stringify({ version: SETTINGS_VERSION, ...settings }));
      } catch {
        // A preference is not worth failing a stroke over.
      }
    },
  };
}
