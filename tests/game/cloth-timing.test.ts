import { describe, expect, test } from 'vitest';
import { TABLE_FEET, TABLE_LENGTHS, timeCloth } from '../../src/game/cloth-timing';
import { PLAY_LENGTH } from '../../src/geometry/table';

describe('timing a cloth with a stopwatch', () => {
  test('on this 7-foot table, the presets predict 4.7, 4.0 and 3.4 s, and the published value 5.8', () => {
    expect(TABLE_LENGTHS[7]).toBe(PLAY_LENGTH);
    const { predicted, published } = timeCloth(4, 7);
    expect(predicted.fast).toBeCloseTo(4.7, 1);
    expect(predicted.normal).toBeCloseTo(4.0, 1);
    expect(predicted.slow).toBeCloseTo(3.4, 1);
    expect(published).toBeCloseTo(5.8, 1);
  });

  test('picks the preset whose time comes nearest', () => {
    expect(timeCloth(4.0, 7).nearest).toBe('normal');
    expect(timeCloth(4.5, 7).nearest).toBe('fast');
    expect(timeCloth(3.6, 7).nearest).toBe('slow');
  });

  test('says when a cloth is past the end of the presets', () => {
    expect(timeCloth(4.0, 7).beyond).toBeNull();
    // At the published value, a table length takes 5.8 s: faster cloth than any preset.
    expect(timeCloth(5.8, 7)).toMatchObject({ nearest: 'fast', beyond: 'faster' });
    expect(timeCloth(3.0, 7)).toMatchObject({ nearest: 'slow', beyond: 'slower' });
  });

  test('a longer table takes longer on the same cloth', () => {
    for (const cloth of ['fast', 'normal', 'slow'] as const) {
      const times = TABLE_FEET.map((feet) => timeCloth(4, feet).predicted[cloth]);
      expect(times[1]!).toBeGreaterThan(times[0]!);
      expect(times[2]!).toBeGreaterThan(times[1]!);
    }
  });

  test('so the same time on a 9-foot table means a slower cloth than on a 7-foot', () => {
    expect(timeCloth(4.7, 7).nearest).toBe('fast');
    expect(timeCloth(4.7, 9).nearest).not.toBe('fast');
  });
});
