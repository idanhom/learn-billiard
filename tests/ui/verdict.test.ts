import { describe, expect, test } from 'vitest';
import { isLucky, verdictFor } from '../../src/ui/verdict';

const shot = (qualifying: boolean, pottedTarget: boolean, pocketUsed: number | null) => ({
  qualifying,
  pottedTarget,
  pocketUsed,
});

describe('the verdict a report leads with', () => {
  test('in the exam is the pot alone', () => {
    expect(verdictFor(shot(false, true, 2), true)).toEqual({ text: 'Potted', good: true });
    expect(verdictFor(shot(true, false, 0.2), true)).toEqual({ text: 'Missed', good: false });
  });

  test('elsewhere is the aim, potted or not', () => {
    expect(verdictFor(shot(true, false, 0.5), false)).toEqual({ text: 'On aim', good: true });
    expect(verdictFor(shot(false, false, 1.4), false)).toEqual({ text: 'Off aim', good: false });
  });

  test('calls a pot from outside the pocket luck', () => {
    const verdict = verdictFor(shot(false, true, 1.3), false);
    expect(verdict).toMatchObject({ text: 'Off aim: a lucky pot', good: false });
    expect(verdict.why).toMatch(/outside the pocket/);
    expect(isLucky(true, false, null)).toBe(true);
  });

  test('and a pot inside it, but past what the level allows, only off aim', () => {
    const verdict = verdictFor(shot(false, true, 0.9), false);
    expect(verdict).toMatchObject({ text: 'Off aim, though potted', good: false });
    expect(isLucky(true, false, 0.9)).toBe(false);
  });
});
