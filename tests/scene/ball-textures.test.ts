import { describe, expect, test } from 'vitest';
import { ballColor, ballNumberFor, companionBallNumber } from '../../src/scene/ball-textures';

describe('ball colours', () => {
  test('a stripe carries the colour of the solid seven below it', () => {
    for (let solid = 1; solid <= 7; solid++) {
      expect(ballColor(solid + 8)).toBe(ballColor(solid));
    }
  });

  test('the eight ball is its own colour', () => {
    expect(ballColor(8)).not.toBe(ballColor(1));
    expect(ballColor(8)).not.toBe(ballColor(7));
  });

  test('no two suits share a colour', () => {
    const colors = new Set<string>();
    for (let n = 1; n <= 8; n++) colors.add(ballColor(n));
    expect(colors.size).toBe(8);
  });
});

describe('numbering the rest of the table', () => {
  test('index zero is the object ball itself', () => {
    expect(companionBallNumber(12, 0)).toBe(12);
  });

  test('obstacles never collide with the object ball', () => {
    for (let object = 1; object <= 15; object++) {
      const numbers = new Set([0, 1, 2, 3].map((i) => companionBallNumber(object, i)));
      expect(numbers.size).toBe(4);
      for (const n of numbers) {
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(15);
      }
    }
  });
});

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
