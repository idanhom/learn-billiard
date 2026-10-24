import { describe, expect, test } from 'vitest';
import {
  DIAMOND,
  SIGHTS,
  SIGHT_SETBACK,
  formatDiamonds,
  fromDiamonds,
  toDiamonds,
} from '../../src/geometry/diamonds';
import { BALL_RADIUS, PLAY_LENGTH, PLAY_WIDTH } from '../../src/geometry/table';
import { vec } from '../../src/geometry/vec2';

describe('the sights', () => {
  test('are eighteen: six on each long rail and three on each short one', () => {
    expect(SIGHTS).toHaveLength(18);
    const onLong = SIGHTS.filter((s) => Math.abs(s.position.y) > PLAY_WIDTH / 2);
    const onShort = SIGHTS.filter((s) => Math.abs(s.position.x) > PLAY_LENGTH / 2);
    expect(onLong).toHaveLength(12);
    expect(onShort).toHaveLength(6);
  });

  test('sit 93.7 mm back from the cushion nose, on whole diamonds', () => {
    for (const { position } of SIGHTS) {
      const onLong = Math.abs(position.y) > PLAY_WIDTH / 2;
      const back = onLong ? Math.abs(position.y) - PLAY_WIDTH / 2 : Math.abs(position.x) - PLAY_LENGTH / 2;
      expect(back).toBeCloseTo(SIGHT_SETBACK, 12);
      expect(SIGHT_SETBACK).toBeCloseTo(0.0937, 4);
      const { along, across } = toDiamonds(position);
      const counted = onLong ? along : across;
      expect(counted).toBeCloseTo(Math.round(counted), 9);
    }
  });

  test('leave the side pockets their place, halfway along the long rails', () => {
    const middle = SIGHTS.filter((s) => Math.abs(s.position.x) < 1e-9);
    expect(middle).toHaveLength(0);
  });

  test('lie along their rails', () => {
    for (const { position, along } of SIGHTS) {
      const onLong = Math.abs(position.y) > PLAY_WIDTH / 2;
      expect(along).toEqual(onLong ? vec(1, 0) : vec(0, 1));
    }
  });
});

describe('diamond coordinates', () => {
  test('divide the table into squares, 24.75 cm on a 7-foot table', () => {
    expect(DIAMOND).toBeCloseTo(PLAY_WIDTH / 4, 12);
    expect(DIAMOND).toBeCloseTo(0.2475, 12);
  });

  test('run from the bottom-left corner, eight along and four across', () => {
    expect(toDiamonds(vec(-PLAY_LENGTH / 2, -PLAY_WIDTH / 2))).toEqual({ along: 0, across: 0 });
    const far = toDiamonds(vec(PLAY_LENGTH / 2, PLAY_WIDTH / 2));
    expect(far.along).toBeCloseTo(8, 12);
    expect(far.across).toBeCloseTo(4, 12);
    const centre = toDiamonds(vec(0, 0));
    expect(centre.along).toBeCloseTo(4, 12);
    expect(centre.across).toBeCloseTo(2, 12);
  });

  test('come back to the same point', () => {
    const point = vec(0.31, -0.17);
    const back = fromDiamonds(toDiamonds(point));
    expect(back.x).toBeCloseTo(point.x, 12);
    expect(back.y).toBeCloseTo(point.y, 12);
  });

  test('are given to a tenth of a diamond, a little under a ball radius', () => {
    expect(formatDiamonds(fromDiamonds({ along: 2.43, across: 1.07 }))).toBe('2.4, 1.1');
    expect(DIAMOND / 10).toBeLessThan(BALL_RADIUS);
    expect(DIAMOND / 10).toBeGreaterThan(0.8 * BALL_RADIUS);
  });
});
