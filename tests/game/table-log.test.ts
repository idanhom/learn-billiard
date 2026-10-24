import { describe, expect, test } from 'vitest';
import type { StorageLike } from '../../src/game/progress-store';
import {
  TABLE_LOG_KEY,
  TABLE_LOG_LIMIT,
  type TableSession,
  addSession,
  createTableLogStore,
  summarise,
  validateSession,
} from '../../src/game/table-log';

class FakeStorage implements StorageLike {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

const session = (overrides: Partial<TableSession> = {}): TableSession => ({
  date: '2026-10-24',
  tableFeet: 9,
  shots: 10,
  made: 7,
  sheet: null,
  note: '',
  ...overrides,
});

describe('a logged session', () => {
  test('is taken as typed when it makes sense', () => {
    expect(validateSession(session({ sheet: 5515, note: 'cut shots to the corner' }))).toEqual(
      session({ sheet: 5515, note: 'cut shots to the corner' }),
    );
  });

  test('says what is wrong when it does not', () => {
    expect(validateSession(session({ date: '24/10/2026' }))).toBe('Give the date.');
    expect(validateSession(session({ tableFeet: 6 as never }))).toBe('Give the size of the table.');
    expect(validateSession(session({ shots: 0 }))).toMatch(/shots taken/);
    expect(validateSession(session({ shots: 2.5 }))).toMatch(/shots taken/);
    expect(validateSession(session({ made: 11 }))).toMatch(/no more than were taken/);
    expect(validateSession(session({ sheet: -3 }))).toMatch(/sheet/);
    expect(validateSession(session({ note: 'x'.repeat(201) }))).toMatch(/200 characters/);
  });
});

describe('the log', () => {
  test('keeps the latest day first, a new session ahead of others on its day', () => {
    let log: TableSession[] = [];
    log = addSession(log, session({ date: '2026-10-20', note: 'a' }));
    log = addSession(log, session({ date: '2026-10-24', note: 'b' }));
    log = addSession(log, session({ date: '2026-10-22', note: 'c' }));
    log = addSession(log, session({ date: '2026-10-24', note: 'd' }));
    expect(log.map((s) => s.note)).toEqual(['d', 'b', 'c', 'a']);
  });

  test('keeps no more than its limit, dropping the oldest', () => {
    let log: TableSession[] = [];
    for (let i = 0; i < TABLE_LOG_LIMIT + 5; i++) log = addSession(log, session({ date: '2026-10-24', note: String(i) }));
    expect(log).toHaveLength(TABLE_LOG_LIMIT);
    expect(log[0]!.note).toBe(String(TABLE_LOG_LIMIT + 4));
  });

  test('comes back from storage as it went in', () => {
    const storage = new FakeStorage();
    const store = createTableLogStore(storage);
    const log = [session({ date: '2026-10-24', made: 8 }), session({ date: '2026-10-20', made: 5 })];
    store.save(log);
    expect(createTableLogStore(storage).load()).toEqual(log);
  });

  test('drops only the entry that does not parse', () => {
    const storage = new FakeStorage();
    storage.setItem(
      TABLE_LOG_KEY,
      JSON.stringify({ version: 1, sessions: [session(), { ...session(), made: 99 }, session({ note: 'kept' })] }),
    );
    expect(createTableLogStore(storage).load().map((s) => s.note)).toEqual(['', 'kept']);
  });

  test('starts empty when there is nothing, or nothing readable', () => {
    expect(createTableLogStore(new FakeStorage()).load()).toEqual([]);
    const storage = new FakeStorage();
    storage.setItem(TABLE_LOG_KEY, '{not json');
    expect(createTableLogStore(storage).load()).toEqual([]);
    expect(createTableLogStore(undefined).load()).toEqual([]);
  });

  test('sums the shots and makes over a run of sessions', () => {
    const log = [session({ shots: 10, made: 7 }), session({ shots: 20, made: 9 }), session({ shots: 5, made: 5 })];
    expect(summarise(log, 2)).toEqual({ sessions: 2, shots: 30, made: 16 });
    expect(summarise(log, 2, 2)).toEqual({ sessions: 1, shots: 5, made: 5 });
  });
});
