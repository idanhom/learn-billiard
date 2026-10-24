import { describe, expect, test } from 'vitest';
import {
  MASTERY_MIN,
  MASTERY_WINDOW,
  bandIndex,
  bandKey,
  bandLabel,
  emptyBand,
  masteryRate,
  recordInBand,
} from '../../src/game/mastery';

function played(results: readonly boolean[]) {
  return results.reduce(recordInBand, emptyBand());
}

describe('the bands', () => {
  test('are ten degrees each, out to seventy', () => {
    expect(bandIndex(0)).toBe(0);
    expect(bandIndex(9.99)).toBe(0);
    expect(bandIndex(30)).toBe(3);
    expect(bandIndex(69.9)).toBe(6);
    expect(bandIndex(70)).toBeUndefined();
    expect(bandKey(3)).toBe('30');
    expect(bandLabel(3)).toBe('30–40°');
  });
});

describe('a band', () => {
  test('says nothing until it has enough shots', () => {
    expect(masteryRate(played(Array(MASTERY_MIN - 1).fill(true)))).toBeNull();
    expect(masteryRate(played(Array(MASTERY_MIN).fill(true)))).toBe(1);
  });

  test('is judged on its latest shots only', () => {
    const band = played([...Array(MASTERY_WINDOW).fill(false), ...Array(MASTERY_WINDOW / 2).fill(true)]);
    expect(band.attempts).toBe(MASTERY_WINDOW * 1.5);
    expect(band.recent).toHaveLength(MASTERY_WINDOW);
    expect(masteryRate(band)).toBe(0.5);
  });

  test('is mastered once a full window meets the mark, and stays mastered', () => {
    const almost = played([...Array(4).fill(false), ...Array(MASTERY_WINDOW - 5).fill(true)]);
    expect(almost.mastered).toBe(false);
    const there = recordInBand(almost, true);
    expect(masteryRate(there)).toBe(0.8);
    expect(there.mastered).toBe(true);
    const after = Array(MASTERY_WINDOW).fill(false).reduce(recordInBand, there);
    expect(masteryRate(after)).toBe(0);
    expect(after.mastered).toBe(true);
  });

  test('is not mastered on a short run, however good', () => {
    expect(played(Array(MASTERY_WINDOW - 1).fill(true)).mastered).toBe(false);
  });
});
