import { describe, expect, test } from 'vitest';
import { MAX_CUE_SPEED } from '../../src/constants';
import { loudness } from '../../src/scene/audio';

describe('how loud a contact sounds', () => {
  test('is silent with no speed, and full at full power', () => {
    expect(loudness('ball-ball', 0)).toBe(0);
    expect(loudness('strike', MAX_CUE_SPEED)).toBe(1);
    expect(loudness('cushion', 10)).toBe(1);
  });

  test('rises with the speed, but slower, so a soft touch is still heard', () => {
    const soft = loudness('ball-ball', 0.3);
    const firm = loudness('ball-ball', 1.5);
    expect(firm).toBeGreaterThan(soft);
    expect(soft).toBeGreaterThan(0.3 / 3);
    expect(loudness('ball-ball', 0.001)).toBeGreaterThanOrEqual(0.04);
  });
});
