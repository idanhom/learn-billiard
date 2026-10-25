import { describe, expect, test } from 'vitest';
import { RUNGS, ZONE_RADIUS, rungDistances, scorePosition, zoneCentre } from '../../src/game/position';
import { vec } from '../../src/geometry/vec2';

const cue = vec(-0.5, 0);
const ghost = vec(0, 0);

describe('the spot', () => {
  test('is where the cue ball meets the object ball for a stop shot', () => {
    expect(zoneCentre('stop', 0, cue, ghost)).toEqual(ghost);
  });

  test('is past contact for follow and back toward the cue ball for draw', () => {
    expect(zoneCentre('follow', 0.4, cue, ghost)).toEqual(vec(0.4, 0));
    expect(zoneCentre('draw', 0.35, cue, ghost)).toEqual(vec(-0.35, 0));
  });

  test('leaves the layout room to reach it at every rung', () => {
    for (const distance of RUNGS.follow) {
      expect(rungDistances('follow', distance).potDistance[0]).toBeGreaterThanOrEqual(distance + 0.25);
    }
    for (const distance of RUNGS.draw) {
      expect(rungDistances('draw', distance).cueDistance[0]).toBeGreaterThanOrEqual(distance + 0.25);
    }
  });
});

describe('a position shot', () => {
  test('counts when it pots and stops within the zone', () => {
    const result = scorePosition('follow', vec(0.45, 0.03), vec(0.4, 0), cue, ghost, true, false);
    expect(result.correct).toBe(true);
    expect(result.long).toBeCloseTo(0.05, 12);
    expect(result.wide).toBeCloseTo(0.03, 12);
    expect(result.off).toBeLessThanOrEqual(ZONE_RADIUS);
  });

  test('does not count without the pot, or with a scratch, however close', () => {
    expect(scorePosition('stop', ghost, ghost, cue, ghost, false, false).correct).toBe(false);
    expect(scorePosition('stop', ghost, ghost, cue, ghost, true, true).correct).toBe(false);
  });

  test('is long or short the way the cue ball was travelling', () => {
    // Drawn back, short means it did not come back far enough.
    const short = scorePosition('draw', vec(-0.2, 0), vec(-0.35, 0), cue, ghost, true, false);
    expect(short.long).toBeCloseTo(-0.15, 12);
    expect(short.correct).toBe(false);
    const long = scorePosition('draw', vec(-0.5, 0), vec(-0.35, 0), cue, ghost, true, false);
    expect(long.long).toBeCloseTo(0.15, 12);
  });
});
