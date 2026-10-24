/**
 * A log of sessions at a real table: how many shots, how many went in, on what
 * size of table, and from which drill sheet. It is what says whether practice
 * here carries over.
 *
 * Kept under a key of its own. Unlike progress, a bad entry costs only itself:
 * these are the player's own records of real play, which nothing could rebuild,
 * so one that does not parse is dropped and the rest are kept.
 */

import { TABLE_FEET, type TableFeet } from './cloth-timing';
import type { StorageLike } from './progress-store';

export const TABLE_LOG_VERSION = 1;
export const TABLE_LOG_KEY = 'pool-angle-trainer/table-log/v1';

/** The most sessions kept; past it the oldest go. */
export const TABLE_LOG_LIMIT = 200;
export const MAX_SESSION_SHOTS = 500;
export const MAX_NOTE_LENGTH = 200;

export interface TableSession {
  /** The day played, as YYYY-MM-DD. */
  readonly date: string;
  readonly tableFeet: TableFeet;
  readonly shots: number;
  readonly made: number;
  /** The drill sheet played from, if one was. */
  readonly sheet: number | null;
  readonly note: string;
}

export interface TableLogStore {
  /** Newest first. */
  load(): TableSession[];
  save(sessions: readonly TableSession[]): void;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A session as typed in, or why it cannot be one. */
export function validateSession(raw: unknown): TableSession | string {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'Not a session.';
  const record = raw as Record<string, unknown>;
  const { date, tableFeet, shots, made, sheet, note } = record;
  if (typeof date !== 'string' || !DATE.test(date) || Number.isNaN(Date.parse(date))) return 'Give the date.';
  if (!TABLE_FEET.includes(tableFeet as TableFeet)) return 'Give the size of the table.';
  if (!Number.isInteger(shots) || (shots as number) < 1 || (shots as number) > MAX_SESSION_SHOTS) {
    return `Give the shots taken, from 1 to ${MAX_SESSION_SHOTS}.`;
  }
  if (!Number.isInteger(made) || (made as number) < 0 || (made as number) > (shots as number)) {
    return 'Give the shots made, no more than were taken.';
  }
  if (sheet !== null && !(Number.isInteger(sheet) && (sheet as number) > 0)) return 'A sheet is a number.';
  if (typeof note !== 'string' || note.length > MAX_NOTE_LENGTH) return `Keep the note to ${MAX_NOTE_LENGTH} characters.`;
  return {
    date,
    tableFeet: tableFeet as TableFeet,
    shots: shots as number,
    made: made as number,
    sheet: sheet as number | null,
    note,
  };
}

export function createTableLogStore(storage: StorageLike | undefined, key = TABLE_LOG_KEY): TableLogStore {
  return {
    load(): TableSession[] {
      if (!storage) return [];
      try {
        const stored = storage.getItem(key);
        if (stored === null) return [];
        const parsed = JSON.parse(stored) as { version?: unknown; sessions?: unknown };
        if (parsed.version !== TABLE_LOG_VERSION || !Array.isArray(parsed.sessions)) return [];
        return parsed.sessions
          .map(validateSession)
          .filter((session): session is TableSession => typeof session !== 'string');
      } catch {
        return [];
      }
    },

    save(sessions: readonly TableSession[]): void {
      if (!storage) return;
      try {
        const kept = sessions.slice(0, TABLE_LOG_LIMIT);
        storage.setItem(key, JSON.stringify({ version: TABLE_LOG_VERSION, sessions: kept }));
      } catch {
        // Storage full or refused: the log in memory still stands for now.
      }
    },
  };
}

/** A new session at the front, the latest day first, and no more than the limit. */
export function addSession(sessions: readonly TableSession[], session: TableSession): TableSession[] {
  // Stable: a session goes in front of any other on the same day.
  const at = sessions.findIndex((other) => other.date <= session.date);
  const next = at === -1 ? [...sessions, session] : [...sessions.slice(0, at), session, ...sessions.slice(at)];
  return next.slice(0, TABLE_LOG_LIMIT);
}

export interface LogSummary {
  readonly sessions: number;
  readonly shots: number;
  readonly made: number;
}

/** The shots and makes over `count` sessions from `from` back, newest first. */
export function summarise(sessions: readonly TableSession[], count: number, from = 0): LogSummary {
  const taken = sessions.slice(from, from + count);
  return {
    sessions: taken.length,
    shots: taken.reduce((sum, session) => sum + session.shots, 0),
    made: taken.reduce((sum, session) => sum + session.made, 0),
  };
}
