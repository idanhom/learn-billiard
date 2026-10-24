import { describe, expect, test } from 'vitest';
import {
  DAYS_KEPT,
  NO_LINE,
  addFirstRun,
  dailySeed,
  daysBefore,
  daysPractised,
  firstRunOn,
  localDate,
  markPractised,
  median,
  shotError,
} from '../../src/game/daily';

describe('days', () => {
  test('are local, as YYYY-MM-DD', () => {
    expect(localDate(new Date(2026, 9, 5, 23, 59))).toBe('2026-10-05');
    expect(localDate(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
  });

  test('count back across months and years', () => {
    expect(daysBefore('2026-03-01', 1)).toBe('2026-02-28');
    expect(daysBefore('2026-01-03', 6)).toBe('2025-12-28');
  });

  test('of practice are those in the last week, today included', () => {
    // The 19th to the 25th is seven days; the 18th is out.
    const days = ['2026-10-25', '2026-10-24', '2026-10-20', '2026-10-19', '2026-10-18', '2026-10-01'];
    expect(daysPractised(days, '2026-10-25')).toBe(4);
    expect(daysPractised([], '2026-10-25')).toBe(0);
  });

  test('of practice are kept once each, latest first, and not for ever', () => {
    expect(markPractised(['2026-10-24'], '2026-10-25')).toEqual(['2026-10-25', '2026-10-24']);
    expect(markPractised(['2026-10-25'], '2026-10-25')).toEqual(['2026-10-25']);
    let days: string[] = [];
    for (let i = 0; i < DAYS_KEPT + 10; i++) days = markPractised(days, daysBefore('2026-10-25', DAYS_KEPT + 9 - i));
    expect(days).toHaveLength(DAYS_KEPT);
    expect(days[0]).toBe('2026-10-25');
  });
});

describe('the daily set', () => {
  test('is the same set for the same day, and another the next', () => {
    expect(dailySeed('2026-10-25')).toBe(dailySeed('2026-10-25'));
    expect(dailySeed('2026-10-26')).not.toBe(dailySeed('2026-10-25'));
  });

  test('scores a shot on the share of the pocket, and one with no line as ten pockets off', () => {
    expect(shotError(0.4)).toBe(0.4);
    expect(shotError(null)).toBe(NO_LINE);
  });

  test('takes the median, which one wild shot cannot drag', () => {
    expect(median([0.1, 0.2, 0.3])).toBe(0.2);
    expect(median([0.4, 0.1, 0.3, 0.2])).toBeCloseTo(0.25, 12);
    expect(median([0.2, 0.2, 0.3, 0.3, 0.3, 0.2, 0.2, 0.3, 0.2, NO_LINE])).toBeCloseTo(0.25, 12);
  });

  test('keeps one first run a day, latest first', () => {
    let runs = addFirstRun([], { date: '2026-10-24', score: 0.5 });
    runs = addFirstRun(runs, { date: '2026-10-25', score: 0.3 });
    expect(runs.map((run) => run.date)).toEqual(['2026-10-25', '2026-10-24']);
    expect(firstRunOn(runs, '2026-10-24')?.score).toBe(0.5);
    expect(firstRunOn(runs, '2026-10-23')).toBeUndefined();
  });
});
