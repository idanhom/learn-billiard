import { describe, expect, test } from 'vitest';
import { DOWN_ADJUSTMENT, Routine, STILL_SECONDS } from '../../src/game/routine';

const deg = (d: number) => (d * Math.PI) / 180;

describe('the commit routine', () => {
  test('starts standing, and the stroke waits until the player gets down', () => {
    const routine = new Routine(0);
    expect(routine.down).toBe(false);
    expect(routine.holdUp(10)).toBe('get down first');
  });

  test('standing, the line goes anywhere', () => {
    const routine = new Routine(0);
    expect(routine.steer(deg(40), 1)).toBeCloseTo(deg(40), 12);
  });

  test('down, the line moves half a degree either way of where it got down, and no further', () => {
    const routine = new Routine(0);
    routine.getDown(deg(10), 1);
    expect(routine.steer(deg(10.3), 2)).toBeCloseTo(deg(10.3), 12);
    expect(routine.steer(deg(12), 3)).toBeCloseTo(deg(10) + DOWN_ADJUSTMENT, 12);
    expect(routine.steer(deg(5), 4)).toBeCloseTo(deg(10) - DOWN_ADJUSTMENT, 12);
  });

  test('and across the wrap at pi as well as anywhere else', () => {
    const routine = new Routine(0);
    routine.getDown(Math.PI - deg(0.2), 1);
    expect(routine.steer(-Math.PI + deg(0.1), 2)).toBeCloseTo(Math.PI + deg(0.1), 12);
  });

  test('the stroke waits for a moment of stillness after getting down, and after any move', () => {
    const routine = new Routine(0);
    routine.getDown(0, 1);
    expect(routine.holdUp(1 + STILL_SECONDS / 2)).toBe('hold still');
    expect(routine.holdUp(1 + STILL_SECONDS)).toBeUndefined();
    routine.steer(deg(0.1), 3);
    expect(routine.holdUp(3.1)).toBe('hold still');
    expect(routine.holdUp(3 + STILL_SECONDS + 0.01)).toBeUndefined();
  });

  test('standing back up is a re-aim, and frees the line', () => {
    const routine = new Routine(0);
    routine.standUp();
    expect(routine.reAims).toBe(0);
    routine.getDown(0, 1);
    routine.standUp();
    expect(routine.reAims).toBe(1);
    expect(routine.down).toBe(false);
    expect(routine.steer(deg(30), 2)).toBeCloseTo(deg(30), 12);
  });

  test('times the shot from the deal', () => {
    const routine = new Routine(5);
    expect(routine.elapsed(12.5)).toBeCloseTo(7.5, 12);
  });
});
