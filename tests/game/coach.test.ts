import { describe, expect, test } from 'vitest';
import { Coach } from '../../src/game/coach';

describe('the coaching', () => {
  test('walks through three shots: the line, the stroke, the tiers', () => {
    const coach = new Coach(true);
    expect(coach.step).toBe('aim');
    coach.aimed();
    expect(coach.step).toBe('strike');
    expect(coach.scored()).toBe(false);
    expect(coach.step).toBe('report');
    coach.dealt();
    expect(coach.step).toBe('power');
    expect(coach.scored()).toBe(false);
    expect(coach.step).toBe('power-report');
    coach.dealt();
    expect(coach.step).toBe('tiers');
    expect(coach.scored()).toBe(true);
    expect(coach.active).toBe(false);
  });

  test('moves on from the first shot even when it was struck before the line was found', () => {
    const coach = new Coach(true);
    coach.scored();
    expect(coach.step).toBe('report');
  });

  test('waits on a step until it is done: a new deal alone does not skip the stroke', () => {
    const coach = new Coach(true);
    coach.dealt();
    expect(coach.step).toBe('aim');
    coach.aimed();
    coach.dealt();
    expect(coach.step).toBe('strike');
  });

  test('can be skipped at any point, and is not there at all for a returning player', () => {
    const coach = new Coach(true);
    coach.aimed();
    coach.skip();
    expect(coach.active).toBe(false);
    expect(new Coach(false).step).toBe('done');
  });
});
