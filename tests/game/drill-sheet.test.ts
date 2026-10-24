import { describe, expect, test } from 'vitest';
import { type FractionMiss, SHEET_SHOTS, dealSheet, pocketName } from '../../src/game/drill-sheet';
import { LEVELS } from '../../src/game/levels';

const fractionLevels = LEVELS.filter((level) => level.fraction !== undefined);

function misses(rates: readonly number[]): FractionMiss[] {
  return fractionLevels.map((level, i) => ({ level, missRate: rates[i]!, attempts: 20, missed: 10 }));
}

describe('a drill sheet', () => {
  test('deals ten shots, each inside its fraction level’s band, placed in diamonds', () => {
    const sheet = dealSheet(misses([0.5, 0.5, 0.5, 0.5, 0.5]), 4821);
    expect(sheet.shots).toHaveLength(SHEET_SHOTS);
    for (const shot of sheet.shots) {
      const level = fractionLevels.find((l) => l.fraction === shot.fraction.name)!;
      expect(shot.cutDegrees).toBeGreaterThanOrEqual(level.cutRange[0] - 1e-6);
      expect(shot.cutDegrees).toBeLessThanOrEqual(level.cutRange[1] + 1e-6);
      expect(shot.cue).toMatch(/^\d\.\d, \d\.\d$/);
      expect(shot.object).toMatch(/^\d\.\d, \d\.\d$/);
    }
  });

  test('is the same sheet again for the same id', () => {
    const rates = misses([0.3, 0.6, 0.2, 0.4, 0.5]);
    const a = dealSheet(rates, 77);
    const b = dealSheet(rates, 77);
    expect(b.shots.map((s) => [s.cue, s.object, s.layout.targetPocket])).toEqual(
      a.shots.map((s) => [s.cue, s.object, s.layout.targetPocket]),
    );
  });

  test('leans on the fraction missed most', () => {
    const rates = misses([0.1, 0.1, 0.1, 0.1, 0.9]);
    let eighths = 0;
    let total = 0;
    for (let id = 1; id <= 12; id++) {
      for (const shot of dealSheet(rates, id).shots) {
        total++;
        if (shot.fraction.name === 'eighth') eighths++;
      }
    }
    // Weighted 0.9 against 0.4 for the other four together: about 69%.
    expect(eighths / total).toBeGreaterThan(0.55);
    expect(eighths / total).toBeLessThan(0.85);
  });
});

describe('pocket names', () => {
  test('say corner or side', () => {
    expect(pocketName('top-right')).toBe('top-right corner');
    expect(pocketName('bottom-left')).toBe('bottom-left corner');
    expect(pocketName('top-middle')).toBe('top side');
  });
});
