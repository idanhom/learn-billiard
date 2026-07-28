import { describe, expect, test } from 'vitest';
import { ballNumberFor } from '../../src/scene/ball-textures';

describe('choosing a ball for a layout', () => {
  test('always picks a legal ball number', () => {
    for (let seed = 0; seed < 500; seed++) {
      const number = ballNumberFor(`L3-s${seed}`);
      expect(Number.isInteger(number)).toBe(true);
      expect(number).toBeGreaterThanOrEqual(1);
      expect(number).toBeLessThanOrEqual(15);
    }
  });

  test('is stable for a given layout, so retrying does not swap the ball', () => {
    expect(ballNumberFor('L2-s77')).toBe(ballNumberFor('L2-s77'));
  });

  test('varies across layouts', () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < 200; seed++) seen.add(ballNumberFor(`L1-s${seed}`));
    expect(seen.size).toBeGreaterThan(8);
  });

  test('handles an empty id without breaking', () => {
    expect(ballNumberFor('')).toBeGreaterThanOrEqual(1);
  });
});
