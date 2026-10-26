import { describe, expect, test } from 'vitest';
import { pinchStep, stripPower } from '../../src/game/input';

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

describe('a two-finger gesture on the table', () => {
  const a = { x: 100, y: 300 };
  const b = { x: 200, y: 300 };

  test('fingers spread to twice as far apart zoom twice as near, and slide nothing', () => {
    const step = pinchStep(a, b, { x: 50, y: 300 }, { x: 250, y: 300 });
    expect(step.zoom).toBeCloseTo(2, 10);
    expect(step.dx).toBeCloseTo(0, 10);
    expect(step.dy).toBeCloseTo(0, 10);
  });

  test('fingers moved together slide the view as far as they went, and zoom nothing', () => {
    const step = pinchStep(a, b, { x: 110, y: 300 }, { x: 210, y: 300 });
    expect(step.zoom).toBeCloseTo(1, 10);
    expect(step.dx).toBeCloseTo(10, 10);
    expect(step.dy).toBeCloseTo(0, 10);
  });

  /** Browsers report one finger at a time, so a gesture arrives as steps that must add up. */
  test('one finger and then the other comes to the same as both at once', () => {
    const a1 = { x: 70, y: 280 };
    const b1 = { x: 260, y: 330 };
    const both = pinchStep(a, b, a1, b1);
    const first = pinchStep(a, b, a1, b);
    const second = pinchStep(b, a1, b1, a1);
    expect(first.zoom * second.zoom).toBeCloseTo(both.zoom, 10);
    expect(first.dx + second.dx).toBeCloseTo(both.dx, 10);
    expect(first.dy + second.dy).toBeCloseTo(both.dy, 10);
  });

  test('two fingers on the same spot zoom nothing rather than divide by zero', () => {
    expect(pinchStep(a, a, { x: 120, y: 300 }, a).zoom).toBe(1);
  });
});
