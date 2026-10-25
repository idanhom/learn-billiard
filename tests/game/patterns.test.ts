import { describe, expect, test } from 'vitest';
import { LEVELS } from '../../src/game/levels';
import { dealPattern, patternLayout } from '../../src/game/patterns';
import { dist, vec } from '../../src/geometry/vec2';

const level = LEVELS.find((l) => l.scoring?.kind === 'pattern')!;

describe('a pattern', () => {
  test('has as many balls as asked, each with its pocket, none on another', () => {
    for (const count of [2, 3]) {
      for (const seed of [11, 22, 33]) {
        const pattern = dealPattern(count, level, seed * 7919);
        expect(pattern.balls).toHaveLength(count);
        expect(pattern.pockets).toHaveLength(count);
        for (let i = 0; i < count; i++) {
          for (let j = i + 1; j < count; j++) expect(dist(pattern.balls[i]!, pattern.balls[j]!)).toBeGreaterThan(0.1);
          expect(dist(pattern.balls[i]!, pattern.cue)).toBeGreaterThan(0.1);
        }
      }
    }
  });

  test('is the same pattern again for the same seed', () => {
    expect(dealPattern(3, level, 4242)).toEqual(dealPattern(3, level, 4242));
  });
});

describe('a pattern’s shot', () => {
  test('has the balls still to come on the table, and the cue ball where it is', () => {
    const pattern = { cue: vec(0, 0), balls: [vec(0.3, 0), vec(0.5, 0.2), vec(-0.4, 0.1)], pockets: ['top-right', 'bottom-left', 'top-left'] as const };
    const second = patternLayout(pattern, 1, vec(0.1, -0.2), 'p');
    expect(second.cue).toEqual(vec(0.1, -0.2));
    expect(second.object).toEqual(vec(0.5, 0.2));
    expect(second.targetPocket).toBe('bottom-left');
    expect(second.obstacles).toEqual([vec(-0.4, 0.1)]);
  });
});
