import { describe, expect, test } from 'vitest';
import {
  CUE_MARKS,
  ballColor,
  ballNumberFor,
  companionBallNumber,
} from '../../src/scene/ball-textures';

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

/**
 * Geometry only — the painting needs a canvas, but where the marks go is data,
 * and it is the part with a right answer.
 */
describe('the marks on the cue ball', () => {
  /** Equirectangular (u, v) as a direction on the ball. */
  function direction(u: number, v: number): [number, number, number] {
    const phi = u * 2 * Math.PI;
    const theta = v * Math.PI;
    return [Math.sin(theta) * Math.cos(phi), Math.sin(theta) * Math.sin(phi), Math.cos(theta)];
  }

  test('there are six, on the octahedral axes', () => {
    expect(CUE_MARKS).toHaveLength(6);

    const axes = CUE_MARKS.map((m) => direction(m.u, m.v));
    for (let i = 0; i < axes.length; i++) {
      for (let j = i + 1; j < axes.length; j++) {
        const a = axes[i]!;
        const b = axes[j]!;
        const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        // Octahedral means every pair is either opposite or at right angles.
        // Anything else leaves an axis the ball can turn about invisibly.
        expect(Math.min(Math.abs(d), Math.abs(Math.abs(d) - 1))).toBeLessThan(1e-12);
        expect(d).toBeLessThan(0.999);
      }
    }
  });

  test('no mark straddles the u = 0 seam', () => {
    for (const mark of CUE_MARKS) {
      if (mark.v === 0 || mark.v === 1) continue; // a pole band covers every u
      const toSeam = Math.min(mark.u, 1 - mark.u) * 2 * Math.PI;
      expect(toSeam).toBeGreaterThan(mark.radius);
    }
  });

  test('are big enough to read and small enough not to merge', () => {
    for (const mark of CUE_MARKS) {
      expect(mark.radius).toBeGreaterThan(0.14); // ~8 degrees, a real measle ball
      expect(mark.radius).toBeLessThan(Math.PI / 4); // touching at 45 degrees apart
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
