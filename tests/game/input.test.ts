import { describe, expect, test } from 'vitest';
import { stripPower } from '../../src/game/input';

describe('the touch power strip', () => {
  // A strip from y = 100 down to y = 400 on screen, as a phone draws it.
  const top = 100;
  const bottom = 400;

  test('is empty at its bottom and full at its top', () => {
    expect(stripPower(bottom, top, bottom)).toBe(0);
    expect(stripPower(top, top, bottom)).toBe(1);
  });

  test('follows the finger up it', () => {
    expect(stripPower(bottom - 0.45 * (bottom - top), top, bottom)).toBeCloseTo(0.45, 10);
    expect(stripPower(250, top, bottom)).toBeCloseTo(0.5, 10);
  });

  test('holds at either end when the finger runs past it', () => {
    expect(stripPower(bottom + 40, top, bottom)).toBe(0);
    expect(stripPower(top - 40, top, bottom)).toBe(1);
  });

  test('reads nothing from a strip with no height', () => {
    expect(stripPower(200, 300, 300)).toBe(0);
  });
});
