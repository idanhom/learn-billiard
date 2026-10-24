import { describe, expect, test } from 'vitest';
import { ESTIMATES, ON_THE_LINE, estimateLabel, estimateOf } from '../../src/game/estimate';

describe('the self-estimate', () => {
  test('reads a signed share of the pocket as on, a bit, or way off, and which way', () => {
    expect(estimateOf(0)).toBe(0);
    expect(estimateOf(ON_THE_LINE)).toBe(0);
    expect(estimateOf(-ON_THE_LINE)).toBe(0);
    expect(estimateOf(0.6)).toBe(1);
    expect(estimateOf(-0.6)).toBe(-1);
    expect(estimateOf(1)).toBe(1);
    expect(estimateOf(1.4)).toBe(2);
    expect(estimateOf(-3)).toBe(-2);
  });

  test('offers the five answers thickest first', () => {
    expect(ESTIMATES).toEqual([2, 1, 0, -1, -2]);
  });

  test('says thick and thin on a cut, left and right on a straight-in', () => {
    expect(ESTIMATES.map((e) => estimateLabel(e, false))).toEqual([
      'way thick',
      'a bit thick',
      'on',
      'a bit thin',
      'way thin',
    ]);
    expect(estimateLabel(-1, true)).toBe('a bit right');
    expect(estimateLabel(2, true)).toBe('way left');
  });
});
