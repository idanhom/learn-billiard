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

import { CLOTH_PRESET_IDS, type ClothPreset, DEFAULT_CLOTH } from '../constants';
import { TABLE_FEET, type TableFeet } from './cloth-timing';
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
  /**
   * Which cloth to play on. Only the preset id is stored — the coefficient it
   * maps to is physics, and lives in `constants`.
   */
  readonly cloth: ClothPreset;
  /**
   * How far the player's eyes are from the screen, in metres. The stance view
   * is drawn at true scale against it, so a screen at arm's length shows the
   * table as a window would.
   */
  readonly viewingDistance: number;
  /** The size of the player's own table, for timing its cloth and logging sessions on it. */
  readonly tableFeet: TableFeet;
  /** The table's sounds: the strike, the balls, the cushions, the pockets. */
  readonly sound: boolean;
  /** Deal the next shot by itself a few seconds after the report. */
  readonly autoNext: boolean;
}

/** The viewing distances on offer, and the step between them, in metres. */
export const VIEWING_DISTANCE: { readonly min: number; readonly max: number; readonly step: number; readonly default: number } = {
  min: 0.25,
  max: 1.5,
  step: 0.05,
  default: 0.6,
};

/** A viewing distance moved `steps` steps, kept on the grid and inside the range. */
export function stepViewingDistance(current: number, steps: number): number {
  const { min, max, step } = VIEWING_DISTANCE;
  const next = Math.round((current + steps * step) / step) * step;
  return Math.min(max, Math.max(min, Math.round(next * 100) / 100));
}

export interface SettingsStore {
  load(): Settings;
  save(settings: Settings): void;
}

export function defaultSettings(): Settings {
  return {
    timeScale: TIME_SCALES[0],
    cloth: DEFAULT_CLOTH,
    viewingDistance: VIEWING_DISTANCE.default,
    tableFeet: 7,
    sound: true,
    autoNext: false,
  };
}

/** Next speed in the cycle; an unrecognised value restarts at full speed. */
export function nextTimeScale(current: number): TimeScale {
  const index = TIME_SCALES.indexOf(current as TimeScale);
  if (index === -1) return TIME_SCALES[0];
  return TIME_SCALES[(index + 1) % TIME_SCALES.length]!;
}

/** Next cloth in the cycle; an unrecognised value restarts at the default. */
export function nextCloth(current: ClothPreset): ClothPreset {
  const index = CLOTH_PRESET_IDS.indexOf(current);
  if (index === -1) return DEFAULT_CLOTH;
  return CLOTH_PRESET_IDS[(index + 1) % CLOTH_PRESET_IDS.length]!;
}

export function validateSettings(raw: unknown): Settings | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  if (record.version !== SETTINGS_VERSION) return undefined;
  if (!TIME_SCALES.includes(record.timeScale as TimeScale)) return undefined;

  // A record written before cloth existed is not a corrupt record. Absence gets
  // the default; a value that is present but nonsense still rejects the lot,
  // because that is the case where we cannot tell what was meant.
  let cloth: ClothPreset = DEFAULT_CLOTH;
  if (record.cloth !== undefined) {
    if (!CLOTH_PRESET_IDS.includes(record.cloth as ClothPreset)) return undefined;
    cloth = record.cloth as ClothPreset;
  }

  // The same for the viewing distance, which came later still.
  let viewingDistance = VIEWING_DISTANCE.default;
  if (record.viewingDistance !== undefined) {
    const value = record.viewingDistance;
    if (typeof value !== 'number' || !(value >= VIEWING_DISTANCE.min && value <= VIEWING_DISTANCE.max)) return undefined;
    viewingDistance = value;
  }

  // And the player's own table, which came last.
  let tableFeet: TableFeet = 7;
  if (record.tableFeet !== undefined) {
    if (!TABLE_FEET.includes(record.tableFeet as TableFeet)) return undefined;
    tableFeet = record.tableFeet as TableFeet;
  }

  let sound = true;
  if (record.sound !== undefined) {
    if (typeof record.sound !== 'boolean') return undefined;
    sound = record.sound;
  }

  let autoNext = false;
  if (record.autoNext !== undefined) {
    if (typeof record.autoNext !== 'boolean') return undefined;
    autoNext = record.autoNext;
  }

  return { timeScale: record.timeScale as TimeScale, cloth, viewingDistance, tableFeet, sound, autoNext };
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
