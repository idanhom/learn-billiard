/**
 * The daily set, and practice counted in days.
 *
 * The daily set is ten shots, the same for everyone on a given day, played
 * with no guides and scored on the median share of the pocket used. Only the
 * first run of a day counts: it measures a cold start, which is what a match
 * asks for, rather than the best of many tries. Practice is counted as the
 * days in the last week with a shot played, not as a streak that one missed
 * day breaks.
 */

import { hashString } from './random';

export const DAILY_SHOTS = 10;

/** A shot that missed the object ball, or had no line that drops, scores as this many pockets off. */
export const NO_LINE = 10;

/** The days practice is counted over, ending today. */
export const PRACTICE_SPAN = 7;

/** How many days of practice, and of first runs, are kept. */
export const DAYS_KEPT = 60;

export interface FirstRun<T> {
  readonly date: string;
  readonly score: T;
}

/** The local day, as YYYY-MM-DD: a player's day ends at their own midnight, not at UTC's. */
export function localDate(now: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The seed of a day's set: the same date gives the same ten shots on any machine. */
export function dailySeed(date: string): number {
  return hashString(`daily-${date}`);
}

/** What a shot scores: the share of the pocket it used. */
export function shotError(pocketUsed: number | null): number {
  return pocketUsed === null ? NO_LINE : pocketUsed;
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length / 2;
  return sorted.length % 2 === 1
    ? sorted[Math.floor(middle)]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** The day `days` before `date`, both as YYYY-MM-DD. */
export function daysBefore(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return localDate(new Date(year, month - 1, day - days));
}

/** On how many of the last `span` days, today included, there was practice. */
export function daysPractised(days: readonly string[], today: string, span = PRACTICE_SPAN): number {
  const from = daysBefore(today, span - 1);
  return days.filter((day) => day >= from && day <= today).length;
}

/** The days practised with `today` among them, latest first, no more than are kept. */
export function markPractised(days: readonly string[], today: string): string[] {
  if (days.includes(today)) return [...days];
  return [today, ...days].sort().reverse().slice(0, DAYS_KEPT);
}

/** The first run on `date`, if there was one. */
export function firstRunOn<T>(runs: readonly FirstRun<T>[], date: string): FirstRun<T> | undefined {
  return runs.find((run) => run.date === date);
}

/** The runs with one more first run in, latest first, no more than are kept. */
export function addFirstRun<T>(runs: readonly FirstRun<T>[], run: FirstRun<T>): FirstRun<T>[] {
  return [run, ...runs.filter((other) => other.date !== run.date)]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, DAYS_KEPT);
}
