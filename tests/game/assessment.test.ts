import { describe, expect, test } from 'vitest';
import { RATINGS, STATIONS, pointsByPart, ratingFor } from '../../src/game/assessment';
import { levelById } from '../../src/game/levels';

describe('the assessment’s stations', () => {
  test('are twelve, drawn from levels that test what they say', () => {
    expect(STATIONS).toHaveLength(12);
    for (const station of STATIONS) {
      const level = levelById(station.level);
      if (station.points === 'pot') expect(level.fraction, station.label).toBeDefined();
      else expect(level.scoring, station.label).toBeDefined();
    }
  });

  test('come in parts, scored part by part', () => {
    const points = STATIONS.map((_, i) => i % 2 === 0);
    expect(pointsByPart(points)).toEqual([
      { part: 'Aim', points: 2, of: 4 },
      { part: 'Cue ball', points: 2, of: 4 },
      { part: 'Speed', points: 1, of: 2 },
      { part: 'Position', points: 1, of: 2 },
    ]);
  });
});

describe('the rating', () => {
  test('rises with the score, from the bottom band to the top', () => {
    expect(ratingFor(0)).toBe(RATINGS[0]!.name);
    expect(ratingFor(4)).toBe('developing');
    expect(ratingFor(9)).toBe('solid');
    expect(ratingFor(12)).toBe('strong');
  });
});
