import { describe, expect, test } from 'vitest';
import { FRACTIONS, fractionByName, nearestFraction } from '../../src/geometry/fractions';
import { fullness } from '../../src/geometry/shot';

const deg = (d: number) => (d * Math.PI) / 180;

describe('the reference fractions', () => {
  /** The plan's table: full, three quarters, half, a quarter and an eighth of a ball. */
  test('are 0, 14.5, 30, 48.6 and 61 degrees of cut', () => {
    expect(FRACTIONS.map((f) => f.name)).toEqual(['full', 'three-quarter', 'half', 'quarter', 'eighth']);
    const angles = FRACTIONS.map((f) => Math.round(f.cutDegrees * 10) / 10);
    expect(angles).toEqual([0, 14.5, 30, 48.6, 61]);
  });

  test('each covers the share of the ball it is named for', () => {
    for (const f of FRACTIONS) expect(fullness(deg(f.cutDegrees))).toBeCloseTo(f.fullness, 12);
  });

  test('the nearest to a cut is the one a player would call it', () => {
    expect(nearestFraction(deg(3)).name).toBe('full');
    expect(nearestFraction(deg(20)).name).toBe('three-quarter');
    expect(nearestFraction(deg(26)).name).toBe('half');
    expect(nearestFraction(deg(45)).name).toBe('quarter');
    expect(nearestFraction(deg(75)).name).toBe('eighth');
  });

  test('can be looked up by name', () => {
    expect(fractionByName('half').label).toBe('½');
  });
});
