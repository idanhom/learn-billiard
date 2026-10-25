import { describe, expect, test } from 'vitest';
import { analyseShot } from '../../src/geometry/shot';
import { pocketById } from '../../src/geometry/table';
import { Campaign, INTERLEAVE_SHARE, type ScoredShot } from '../../src/game/campaign';
import { layoutViolations } from '../../src/game/generator';
import { SPEED_RUNGS, speedViolations } from '../../src/game/speed';
import { LEVELS, examLevel, levelById } from '../../src/game/levels';
import {
  PROGRESS_KEY,
  PROGRESS_VERSION,
  type LevelProgress,
  type ProgressStore,
  type StorageLike,
  createProgressStore,
} from '../../src/game/progress-store';

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

const hit: ScoredShot = { qualifying: true, pottedTarget: true };
const onAimNoPot: ScoredShot = { qualifying: true, pottedTarget: false };
const miss: ScoredShot = { qualifying: false, pottedTarget: false };

function campaign(store: ProgressStore = createProgressStore(new FakeStorage())): Campaign {
  return new Campaign(store, { seed: 1000 });
}

/** Play n shots, taking a fresh layout each time as the game does. */
function play(subject: Campaign, shot: ScoredShot, n: number): void {
  for (let i = 0; i < n; i++) {
    subject.record(shot);
    subject.nextShot();
  }
}

describe('starting out', () => {
  test('begins on the first level with every guide showing', () => {
    const subject = campaign();
    expect(subject.level.id).toBe(1);
    expect(subject.tier).toBe(0);
    expect(subject.guides.objectPath).toBe(true);
    expect(subject.notice).toBeUndefined();
  });

  test('hands out a layout the level would accept', () => {
    const subject = campaign();
    for (let i = 0; i < 20; i++) {
      expect(subject.layoutLevel).toBe(subject.level);
      expect(layoutViolations(subject.layout, subject.level)).toEqual([]);
      subject.nextShot();
    }
  });

  test('scores against the share of the pocket its level allows', () => {
    const subject = campaign();
    expect(subject.pocketAllowance).toBe(levelById(1).pocketAllowance);
  });

  test('alternates the cut side so practice does not favour one hand', () => {
    const subject = new Campaign(createProgressStore(new FakeStorage()), { seed: 7 });
    const sides = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const { cue, object, targetPocket } = subject.layout;
      sides.add(analyseShot({ cue, object, pocket: pocketById(targetPocket), obstacles: [] }).cutSide);
      subject.nextShot();
    }
    expect(sides.has('left')).toBe(true);
    expect(sides.has('right')).toBe(true);
  });

  test('retrying keeps the same layout, taking the next one changes it', () => {
    const subject = campaign();
    const first = subject.layout.id;
    subject.retryShot();
    expect(subject.layout.id).toBe(first);
    subject.nextShot();
    expect(subject.layout.id).not.toBe(first);
  });
});

describe('progression', () => {
  test('three qualifying shots advance a tier', () => {
    const subject = campaign();
    play(subject, hit, 2);
    expect(subject.tier).toBe(0);
    const event = subject.record(hit);
    expect(event.advancedTier).toBe(true);
    expect(subject.tier).toBe(1);
  });

  test('progression follows aim, not pots', () => {
    const subject = campaign();
    play(subject, onAimNoPot, 3);
    expect(subject.tier).toBe(1);
  });

  test('misses do not advance anything', () => {
    const subject = campaign();
    play(subject, miss, 12);
    expect(subject.tier).toBe(0);
    expect(subject.stats.attempts).toBe(12);
    expect(subject.stats.qualified).toBe(0);
  });

  test('clearing the last tier completes the level and moves on', () => {
    const subject = campaign();
    play(subject, hit, 11);
    expect(subject.level.id).toBe(1);
    const event = subject.record(hit);
    expect(event.levelCompleted).toBe(true);
    expect(subject.level.id).toBe(2);
    expect(subject.tier).toBe(0);
  });

  test('going back to a completed level is practice by choice, not a bounce onward', () => {
    const subject = campaign();
    play(subject, hit, 12);
    expect(subject.level.id).toBe(2);
    subject.selectLevel(1);
    expect(subject.levelCompleted).toBe(true);
    for (let i = 0; i < 4; i++) {
      expect(subject.record(hit).levelCompleted).toBe(false);
      subject.nextShot();
    }
    expect(subject.level.id).toBe(1);
    expect(subject.stats.attempts).toBe(16);
  });

  test('keeps per-level counts', () => {
    const subject = campaign();
    subject.record(hit);
    subject.nextShot();
    subject.record(miss);
    expect(subject.stats.attempts).toBe(2);
    expect(subject.stats.qualified).toBe(1);
    expect(subject.stats.potted).toBe(1);
  });
});

/**
 * A retry has seen where the first shot went. It is practice: the tiers, the
 * level's record and the exam all count the first look at a layout only.
 */
describe('retries', () => {
  test('a retry does not move the tier window', () => {
    const subject = campaign();
    subject.record(hit);
    for (let i = 0; i < 5; i++) {
      subject.retryShot();
      expect(subject.retrying).toBe(true);
      expect(subject.record(hit)).toEqual({ advancedTier: false, levelCompleted: false, practice: true });
    }
    expect(subject.tier).toBe(0);
    expect(subject.qualifiedInWindow).toBe(1);
  });

  test('so three good shots at one layout are not three qualifying shots', () => {
    const subject = campaign();
    subject.record(hit);
    subject.record(hit);
    subject.record(hit);
    expect(subject.tier).toBe(0);
    subject.nextShot();
    subject.record(hit);
    subject.nextShot();
    expect(subject.record(hit).advancedTier).toBe(true);
  });

  test('a retry is left out of the level record', () => {
    const subject = campaign();
    subject.record(miss);
    subject.record(hit);
    subject.record(hit);
    expect(subject.stats).toMatchObject({ attempts: 1, qualified: 0, potted: 0 });
  });

  test('a retry before the layout has been played is still the first shot at it', () => {
    const subject = campaign();
    expect(subject.retrying).toBe(false);
    subject.retryShot();
    expect(subject.retrying).toBe(false);
    expect(subject.record(hit).practice).toBe(false);
    expect(subject.stats.attempts).toBe(1);
  });

  test('a new layout, a new level or a reset makes the next shot count again', () => {
    const subject = campaign();
    subject.record(hit);
    expect(subject.retrying).toBe(true);
    subject.nextShot();
    expect(subject.retrying).toBe(false);

    subject.record(hit);
    subject.selectLevel(3);
    expect(subject.retrying).toBe(false);

    subject.record(hit);
    subject.resetProgress();
    expect(subject.retrying).toBe(false);
  });

  test('the shot that completes a level deals the next level a fresh layout', () => {
    const subject = campaign();
    play(subject, hit, 11);
    expect(subject.record(hit).levelCompleted).toBe(true);
    expect(subject.level.id).toBe(2);
    expect(subject.retrying).toBe(false);
  });

  test('a retry in the exam does not count against the run', () => {
    const subject = campaign();
    subject.selectLevel(examLevel().id);
    subject.record(miss);
    subject.record(hit);
    subject.record(hit);
    expect(subject.exam).toMatchObject({ shotsTaken: 1, potted: 0 });
  });
});

describe('level select', () => {
  test('jumps to a chosen level and uses its share of the pocket', () => {
    const subject = campaign();
    expect(subject.selectLevel(4)).toBe(true);
    expect(subject.level.id).toBe(4);
    expect(subject.pocketAllowance).toBe(levelById(4).pocketAllowance);
    expect(layoutViolations(subject.layout, subject.layoutLevel)).toEqual([]);
  });

  test('refuses a level that does not exist', () => {
    const subject = campaign();
    expect(subject.selectLevel(99)).toBe(false);
    expect(subject.level.id).toBe(1);
  });

  test('restores the tier a level was left on', () => {
    const storage = new FakeStorage();
    const subject = campaign(createProgressStore(storage));
    play(subject, hit, 3);
    expect(subject.tier).toBe(1);
    subject.selectLevel(5);
    expect(subject.tier).toBe(0);
    subject.selectLevel(1);
    expect(subject.tier).toBe(1);
  });
});

describe('the exam', () => {
  test('shows no guides whatever tier the player reached', () => {
    const subject = campaign();
    subject.selectLevel(examLevel().id);
    expect(subject.guides).toEqual({
      aimLine: false,
      ghostBall: false,
      objectPath: false,
      readout: false,
      powerHint: false,
      overlap: false,
    });
  });

  test('is scored on pots and ignores tiers entirely', () => {
    const subject = campaign();
    subject.selectLevel(examLevel().id);
    play(subject, onAimNoPot, 3);
    expect(subject.tier).toBe(0);
    expect(subject.exam?.potted).toBe(0);
    expect(subject.exam?.shotsTaken).toBe(3);
  });

  test('runs a fixed number of shots and then reports a score', () => {
    const subject = campaign();
    const exam = examLevel();
    subject.selectLevel(exam.id);
    for (let i = 0; i < exam.examShots - 1; i++) {
      expect(subject.record(hit).examFinished).toBeUndefined();
      subject.nextShot();
    }
    const finished = subject.record(hit).examFinished;
    expect(finished).toBeDefined();
    expect(finished!.potted).toBe(exam.examShots);
    expect(finished!.total).toBe(exam.examShots);
    expect(finished!.personalBest).toBe(true);
  });

  test('remembers the best score and only celebrates a real improvement', () => {
    const storage = new FakeStorage();
    const store = createProgressStore(storage);
    const exam = examLevel();

    const first = new Campaign(store, { seed: 1 });
    first.selectLevel(exam.id);
    for (let i = 0; i < exam.examShots; i++) {
      first.record(i < 6 ? hit : miss);
      first.nextShot();
    }
    expect(first.examBest).toBe(6);

    const second = new Campaign(store, { seed: 2 });
    second.selectLevel(exam.id);
    let last;
    for (let i = 0; i < exam.examShots; i++) {
      last = second.record(i < 4 ? hit : miss).examFinished;
      second.nextShot();
    }
    expect(last!.potted).toBe(4);
    expect(last!.personalBest).toBe(false);
    expect(second.examBest).toBe(6);
  });

  test('a finished run gives way to a fresh one, on a layout nobody has played', () => {
    const subject = campaign();
    const exam = examLevel();
    subject.selectLevel(exam.id);
    play(subject, hit, exam.examShots - 1);
    const last = subject.layout.id;
    expect(subject.record(hit).examFinished).toBeDefined();
    expect(subject.exam).toEqual({ shotsTaken: 0, total: exam.examShots, potted: 0 });
    expect(subject.retrying).toBe(false);
    expect(subject.layout.id).not.toBe(last);
    expect(subject.record(hit).examFinished).toBeUndefined();
    expect(subject.exam?.shotsTaken).toBe(1);
  });

  /**
   * The bug this pins: the finished run used to keep counting, so an eleventh
   * pot recorded a best of 11 out of 10 — which the store refuses to load, and
   * the whole save went with it on the next visit.
   */
  test('the best score can never exceed the run, and the save survives a reload', () => {
    const storage = new FakeStorage();
    const exam = examLevel();
    const subject = new Campaign(createProgressStore(storage), { seed: 3 });
    subject.selectLevel(exam.id);
    play(subject, hit, exam.examShots * 2 + 3);
    expect(subject.examBest).toBe(exam.examShots);

    const reloaded = new Campaign(createProgressStore(storage), { seed: 3 });
    expect(reloaded.notice).toBeUndefined();
    expect(reloaded.examBest).toBe(exam.examShots);
    expect(reloaded.level.id).toBe(exam.id);
  });

  test('starting the exam again begins a fresh run', () => {
    const subject = campaign();
    const exam = examLevel();
    subject.selectLevel(exam.id);
    play(subject, hit, 3);
    expect(subject.exam?.shotsTaken).toBe(3);
    subject.selectLevel(1);
    subject.selectLevel(exam.id);
    expect(subject.exam?.shotsTaken).toBe(0);
    expect(subject.exam?.potted).toBe(0);
  });
});

describe('persistence', () => {
  test('survives a reload', () => {
    const storage = new FakeStorage();
    const first = new Campaign(createProgressStore(storage), { seed: 5 });
    play(first, hit, 4);
    expect(first.tier).toBe(1);

    const second = new Campaign(createProgressStore(storage), { seed: 5 });
    expect(second.level.id).toBe(1);
    expect(second.tier).toBe(1);
    expect(second.stats.attempts).toBe(4);
  });

  test('corrupt storage starts clean and says so', () => {
    const storage = new FakeStorage();
    storage.items.set(PROGRESS_KEY, 'not json');
    const subject = new Campaign(createProgressStore(storage), { seed: 5 });
    expect(subject.notice).toBeTruthy();
    expect(subject.level.id).toBe(1);
    expect(subject.tier).toBe(0);
  });

  test('resetting wipes progress and returns to the first level', () => {
    const storage = new FakeStorage();
    const subject = new Campaign(createProgressStore(storage), { seed: 5 });
    play(subject, hit, 6);
    expect(subject.tier).toBe(2);
    subject.resetProgress();
    expect(subject.tier).toBe(0);
    expect(subject.level.id).toBe(1);
    expect(subject.stats.attempts).toBe(0);
    expect(storage.getItem(PROGRESS_KEY)).toBeNull();
  });

  test('works without any storage at all', () => {
    const subject = new Campaign(createProgressStore(undefined), { seed: 5 });
    play(subject, hit, 3);
    expect(subject.tier).toBe(1);
  });

  test('every level in the curriculum can be selected and played', () => {
    const subject = campaign();
    // A layout for the cue ball alone answers to the speed drills' checks, not the aiming ones,
    // and a pattern's later shots are played from wherever the cue ball stopped.
    // Kicks and safeties put balls in the way on purpose, and their own tests hold them.
    const violations = (level: (typeof LEVELS)[number]) =>
      level.scoring?.kind === 'speed'
        ? speedViolations(subject.layout, level.scoring.target)
        : (level.scoring?.kind === 'pattern' && subject.pattern?.ball !== 1) ||
            level.scoring?.kind === 'kick' ||
            level.scoring?.kind === 'safety'
          ? []
          : layoutViolations(subject.layout, subject.layoutLevel);
    for (const level of LEVELS) {
      expect(subject.selectLevel(level.id)).toBe(true);
      expect(violations(level), `level ${level.id}`).toEqual([]);
      subject.record(hit);
      subject.nextShot();
      expect(violations(level), `level ${level.id} second shot`).toEqual([]);
    }
  });
});

/** A campaign resumed at a level and tier, with whatever level records are given. */
function resumed(
  level: number,
  tier: 0 | 1 | 2 | 3,
  records: Record<string, Partial<LevelProgress>> = {},
  bands: Record<string, unknown> = {},
): Campaign {
  const storage = new FakeStorage();
  const base = { tier: 0, completed: false, attempts: 0, qualified: 0, potted: 0 };
  const levels: Record<string, LevelProgress> = {};
  for (const [id, record] of Object.entries(records)) levels[id] = { ...base, ...record } as LevelProgress;
  levels[String(level)] = { ...base, ...(records[String(level)] ?? {}), tier } as LevelProgress;
  storage.setItem(
    PROGRESS_KEY,
    JSON.stringify({
      version: PROGRESS_VERSION,
      currentLevel: level,
      levels,
      examBest: null,
      bands,
      practiceDays: [],
      dailyFirstRuns: [],
      examFirstRuns: [],
      dailyRun: null,
      assessmentBest: null,
      assessmentFirstRuns: [],
    }),
  );
  return new Campaign(createProgressStore(storage), { seed: 4000 });
}

/** The levels a campaign deals its next n layouts from. */
function sources(subject: Campaign, n: number): number[] {
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    ids.push(subject.layoutLevel.id);
    expect(layoutViolations(subject.layout, subject.layoutLevel)).toEqual([]);
    subject.nextShot();
  }
  return ids;
}

describe('interleaving', () => {
  test('from the last tier, a share of shots come from the fractions before', () => {
    const ids = sources(resumed(4, 3), 200);
    const mixed = ids.filter((id) => id !== 4);
    expect(mixed.every((id) => id >= 1 && id <= 3)).toBe(true);
    expect(mixed.length / ids.length).toBeGreaterThan(INTERLEAVE_SHARE - 0.1);
    expect(mixed.length / ids.length).toBeLessThan(INTERLEAVE_SHARE + 0.1);
    for (const id of [1, 2, 3]) expect(ids, `level ${id}`).toContain(id);
  });

  test('not before the last tier, and never on the first fraction or off them', () => {
    expect(sources(resumed(4, 2), 60).every((id) => id === 4)).toBe(true);
    expect(sources(resumed(1, 3), 60).every((id) => id === 1)).toBe(true);
    expect(sources(resumed(6, 3), 60).every((id) => id === 6)).toBe(true);
  });

  test('scores a mixed-in shot at the allowance of the level in play', () => {
    const subject = resumed(5, 3);
    expect(subject.pocketAllowance).toBe(levelById(5).pocketAllowance);
  });
});

describe('the mixed review', () => {
  const review = LEVELS.find((level) => level.review)!;

  test('deals from all five fractions, and nothing else', () => {
    const ids = sources(resumed(review.id, 0), 120);
    expect(new Set(ids)).toEqual(new Set([1, 2, 3, 4, 5]));
  });

  test('leans on the fraction whose shots miss most', () => {
    const records: Record<string, Partial<LevelProgress>> = {};
    for (const id of [1, 2, 3, 4, 5]) records[String(id)] = { attempts: 20, qualified: id === 3 ? 2 : 19 };
    const ids = sources(resumed(review.id, 0, records), 300);
    const share = (id: number): number => ids.filter((x) => x === id).length / ids.length;
    expect(share(3)).toBeGreaterThan(0.5);
    for (const id of [1, 2, 4, 5]) expect(share(id), `level ${id}`).toBeGreaterThan(0.02);
  });
});

describe('the perception drills', () => {
  const perception = LEVELS.find((level) => level.perception)!;

  test('alternate a flash and a placing, dealt from the fraction levels, with no guides', () => {
    const subject = resumed(perception.id, 0);
    const kinds: (string | undefined)[] = [];
    for (let i = 0; i < 6; i++) {
      kinds.push(subject.drillKind);
      expect([1, 2, 3, 4, 5]).toContain(subject.layoutLevel.id);
      expect(Object.values(subject.guides).every((shown) => !shown)).toBe(true);
      subject.nextShot();
    }
    expect(kinds).toEqual(['flash', 'place', 'flash', 'place', 'flash', 'place']);
  });

  test('start on a flash whenever the level is entered', () => {
    const subject = campaign();
    subject.nextShot();
    subject.selectLevel(perception.id);
    expect(subject.drillKind).toBe('flash');
    subject.nextShot();
    subject.selectLevel(perception.id);
    expect(subject.drillKind).toBe('flash');
  });

  test('are not on any other level', () => {
    expect(campaign().drillKind).toBeUndefined();
  });
});

describe('the misses a drill sheet leans on', () => {
  test('cover the five fractions, an even chance until a level is played', () => {
    const subject = campaign();
    const misses = subject.fractionMisses;
    expect(misses.map((miss) => miss.level.fraction)).toEqual(['full', 'three-quarter', 'half', 'quarter', 'eighth']);
    for (const miss of misses) {
      expect(miss.attempts).toBe(0);
      expect(miss.missRate).toBeCloseTo(0.5, 12);
    }
  });

  test('rise on the level whose shots miss', () => {
    const subject = campaign();
    for (let i = 0; i < 4; i++) {
      subject.record({ qualifying: false, pottedTarget: false });
      subject.nextShot();
    }
    const [full, ...rest] = subject.fractionMisses;
    expect(full!.attempts).toBe(4);
    expect(full!.missed).toBe(4);
    expect(full!.missRate).toBeCloseTo(5 / 6, 12);
    for (const miss of rest) expect(miss.missRate).toBeCloseTo(0.5, 12);
  });
});

describe('mastery by band', () => {
  const unguided = (cutDegrees: number, onStandard: boolean): ScoredShot => ({
    qualifying: onStandard,
    pottedTarget: onStandard,
    mastery: { cutDegrees, onStandard },
  });

  test('counts an unguided shot in its band, and nothing else', () => {
    const subject = campaign();
    subject.record(unguided(34, true));
    subject.nextShot();
    subject.record({ qualifying: true, pottedTarget: true });
    subject.nextShot();
    const thirty = subject.bands[3]!;
    expect(thirty).toMatchObject({ label: '30\u201340\u00b0', shots: 1, rate: null, mastered: false });
    expect(subject.bands.filter((band) => band.shots > 0)).toHaveLength(1);
  });

  test('leaves a retry out', () => {
    const subject = campaign();
    subject.record(unguided(12, true));
    subject.retryShot();
    subject.record(unguided(12, true));
    expect(subject.bands[1]!.shots).toBe(1);
  });

  test('says so once, when a band is mastered, and keeps it', () => {
    const subject = campaign();
    const events = [];
    for (let i = 0; i < 20; i++) {
      events.push(subject.record(unguided(45, i >= 4)));
      subject.nextShot();
    }
    expect(events.filter((event) => event.mastered)).toHaveLength(1);
    expect(events[19]!.mastered).toBe('40\u201350\u00b0');
    expect(subject.bands[4]).toMatchObject({ rate: 0.8, mastered: true });
  });

  test('is kept with the progress', () => {
    const storage = new FakeStorage();
    const first = new Campaign(createProgressStore(storage), { seed: 4000 });
    first.record(unguided(5, true));
    const again = new Campaign(createProgressStore(storage), { seed: 4000 });
    expect(again.bands[0]!.shots).toBe(1);
  });
});

describe('the weak-angles level', () => {
  const weak = LEVELS.find((level) => level.weak)!;
  const misses = (n: number) => ({ attempts: n, recent: Array(n).fill(false), mastered: false });
  const hits = (n: number) => ({ attempts: n, recent: Array(n).fill(true), mastered: true });

  test('deals mostly from the band missed most', () => {
    const bands = { '0': hits(20), '10': hits(20), '20': hits(20), '30': misses(20), '40': hits(20), '50': hits(20), '60': hits(20) };
    const subject = resumed(weak.id, 0, {}, bands);
    const cuts: number[] = [];
    for (let i = 0; i < 30; i++) {
      const level = subject.layoutLevel;
      expect(level.id).toBe(weak.id);
      expect(layoutViolations(subject.layout, level)).toEqual([]);
      cuts.push(level.cutRange[0]);
      subject.nextShot();
    }
    // Weighted 1 against 0.1 for each of the other six: about 62%.
    const share = cuts.filter((from) => from === 30).length / cuts.length;
    expect(share).toBeGreaterThan(0.4);
  });

  test('deals every band while none has been played', () => {
    const subject = resumed(weak.id, 0);
    const seen = new Set<number>();
    for (let i = 0; i < 60; i++) {
      seen.add(subject.layoutLevel.cutRange[0]);
      subject.nextShot();
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 10, 20, 30, 40, 50, 60]);
  });
});

describe('the daily set', () => {
  const dailyLevel = LEVELS.find((level) => level.daily)!;
  let day = '2026-10-25';
  const onDay = (storage = new FakeStorage(), seed = 4000) =>
    new Campaign(createProgressStore(storage), { seed, today: () => day });
  const used = (share: number | null): ScoredShot => ({ qualifying: share !== null && share <= 0.8, pottedTarget: false, pocketUsed: share });

  /** Play a whole run, the n-th shot using `shares[n]` of the pocket. */
  function run(subject: Campaign, shares: readonly (number | null)[]) {
    let last;
    for (const share of shares) {
      last = subject.record(used(share));
      subject.nextShot();
    }
    return last!;
  }

  test('deals the same ten shots to everyone that day, and others the next', () => {
    day = '2026-10-25';
    const ids = (seed: number) => {
      const subject = onDay(new FakeStorage(), seed);
      subject.selectLevel(dailyLevel.id);
      const seen: string[] = [];
      for (let i = 0; i < 10; i++) {
        seen.push(subject.layout.id);
        expect(layoutViolations(subject.layout, subject.layoutLevel)).toEqual([]);
        subject.record(used(0.2));
        subject.nextShot();
      }
      return seen;
    };
    const today = ids(4000);
    expect(ids(9)).toEqual(today);
    day = '2026-10-26';
    expect(ids(4000)).not.toEqual(today);
  });

  test('cannot be passed over: Next deals the same shot until it is played', () => {
    day = '2026-10-25';
    const subject = onDay();
    subject.selectLevel(dailyLevel.id);
    const first = subject.layout.id;
    subject.nextShot();
    expect(subject.layout.id).toBe(first);
    expect(subject.guides).toEqual(Object.fromEntries(Object.keys(subject.guides).map((k) => [k, false])));
  });

  test('scores the run on its median, and keeps only the day’s first', () => {
    day = '2026-10-25';
    const subject = onDay();
    subject.selectLevel(dailyLevel.id);
    const first = run(subject, [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, null]).dailyFinished!;
    expect(first).toMatchObject({ first: true, firstToday: first.median });
    expect(first.median).toBeCloseTo(0.55, 12);
    expect(subject.daily).toMatchObject({ shot: 1, firstToday: 0.55 });
    const second = run(subject, Array(10).fill(0.1)).dailyFinished!;
    expect(second.median).toBeCloseTo(0.1, 12);
    expect(second).toMatchObject({ first: false });
    expect(second.firstToday).toBeCloseTo(0.55, 12);
  });

  test('picks a run back up after a reload or another level, rather than starting it over', () => {
    day = '2026-10-25';
    const storage = new FakeStorage();
    const before = onDay(storage);
    before.selectLevel(dailyLevel.id);
    run(before, [0.3, 0.3, 0.3]);
    const after = onDay(storage);
    expect(after.daily?.shot).toBe(4);
    after.selectLevel(1);
    after.selectLevel(dailyLevel.id);
    expect(after.daily?.shot).toBe(4);
    const finished = run(after, Array(7).fill(0.3)).dailyFinished!;
    expect(finished.first).toBe(true);
  });

  test('drops yesterday’s unfinished run for a fresh one', () => {
    day = '2026-10-25';
    const storage = new FakeStorage();
    const yesterday = onDay(storage);
    yesterday.selectLevel(dailyLevel.id);
    run(yesterday, [0.3, 0.3]);
    day = '2026-10-26';
    expect(onDay(storage).daily?.shot).toBe(1);
  });

  test('shows the first runs of the days before', () => {
    const storage = new FakeStorage();
    for (const [date, share] of [['2026-10-23', 0.6], ['2026-10-24', 0.4]] as const) {
      day = date;
      const subject = onDay(storage);
      subject.selectLevel(dailyLevel.id);
      run(subject, Array(10).fill(share));
    }
    day = '2026-10-25';
    const subject = onDay(storage);
    subject.selectLevel(dailyLevel.id);
    const result = run(subject, Array(10).fill(0.2)).dailyFinished!;
    expect(result.earlier.map((r) => [r.date, r.score])).toEqual([
      ['2026-10-24', 0.4],
      ['2026-10-23', 0.6],
    ]);
  });
});

describe('days practised and the exam’s first run', () => {
  let day = '2026-10-20';
  const onDay = (storage: FakeStorage) => new Campaign(createProgressStore(storage), { seed: 4000, today: () => day });

  test('count the days in the last week with a shot played, not a retry alone', () => {
    const storage = new FakeStorage();
    for (const date of ['2026-10-18', '2026-10-20', '2026-10-24']) {
      day = date;
      onDay(storage).record(hit);
    }
    day = '2026-10-25';
    const subject = onDay(storage);
    expect(subject.daysPractised).toBe(2);
    subject.record(hit);
    expect(subject.daysPractised).toBe(3);
    subject.retryShot();
    subject.record(hit);
    expect(subject.daysPractised).toBe(3);
  });

  test('keep the day’s first finished exam run beside the best', () => {
    day = '2026-10-25';
    const storage = new FakeStorage();
    const subject = onDay(storage);
    const exam = examLevel();
    subject.selectLevel(exam.id);
    let result;
    for (let i = 0; i < exam.examShots; i++) {
      result = subject.record(i < 6 ? hit : miss).examFinished;
      subject.nextShot();
    }
    expect(result).toMatchObject({ potted: 6, first: true, firstToday: 6 });
    for (let i = 0; i < exam.examShots; i++) {
      result = subject.record(hit).examFinished;
      subject.nextShot();
    }
    expect(result).toMatchObject({ potted: 10, personalBest: true, first: false, firstToday: 6 });
  });
});

describe('a first launch', () => {
  test('is one with nothing played', () => {
    const subject = campaign();
    expect(subject.isFresh).toBe(true);
    subject.record(hit);
    expect(subject.isFresh).toBe(false);
  });

  test('is not one after a save was lost', () => {
    const storage = new FakeStorage();
    storage.setItem(PROGRESS_KEY, '{ not json');
    expect(new Campaign(createProgressStore(storage)).isFresh).toBe(false);
  });
});

describe('the position ladders', () => {
  test('deal straight-ins with room for the rung\u2019s spot, further at each rung', () => {
    for (const target of ['follow', 'draw'] as const) {
      const level = LEVELS.find((l) => l.scoring?.kind === 'position' && l.scoring.target === target)!;
      const distances: number[] = [];
      for (const tier of [0, 1, 2, 3] as const) {
        const subject = resumed(level.id, tier);
        for (let i = 0; i < 4; i++) {
          expect(layoutViolations(subject.layout, subject.layoutLevel), `${target} rung ${tier + 1}`).toEqual([]);
          subject.nextShot();
        }
        distances.push(subject.position!.distance);
        expect(subject.position!.target).toBe(target);
      }
      expect(distances).toEqual([...distances].sort((a, b) => a - b));
      expect(new Set(distances).size).toBe(4);
    }
  });

  test('show the shot itself, whatever the rung', () => {
    const stop = LEVELS.find((l) => l.scoring?.kind === 'position')!;
    const subject = resumed(stop.id, 3);
    expect(subject.guides.ghostBall).toBe(true);
    expect(subject.position).toEqual({ target: 'stop', distance: 0 });
  });

  test('are not on any other level', () => {
    expect(campaign().position).toBeUndefined();
  });
});

describe('the speed drills', () => {
  test('deal the cue ball alone, the ring further at each rung of speed control', () => {
    const level = LEVELS.find((l) => l.scoring?.kind === 'speed' && l.scoring.target === 'distance')!;
    const distances: number[] = [];
    for (const tier of [0, 1, 2, 3] as const) {
      const subject = resumed(level.id, tier);
      expect(subject.layout.objectAway).toBe(true);
      expect(speedViolations(subject.layout, 'distance')).toEqual([]);
      distances.push(subject.speed!.distance);
    }
    expect(distances).toEqual([...SPEED_RUNGS]);
  });

  test('the lag is the same drill at every tier, and shows only the line', () => {
    const level = LEVELS.find((l) => l.scoring?.kind === 'speed' && l.scoring.target === 'lag')!;
    const subject = resumed(level.id, 2);
    expect(subject.speed).toEqual({ target: 'lag', distance: 0 });
    expect(subject.layout.heading).toBe(0);
    expect(subject.guides).toMatchObject({ aimLine: true, ghostBall: false, objectPath: false, powerHint: false });
  });
});

describe('the patterns level', () => {
  const level = LEVELS.find((l) => l.scoring?.kind === 'pattern')!;
  const potted: ScoredShot = { qualifying: true, pottedTarget: true, scratch: false };

  test('carries the cue ball from each shot to the next, and scores the run once, at its end', () => {
    const subject = resumed(level.id, 0);
    expect(subject.pattern).toEqual({ ball: 1, of: 2 });
    const first = subject.layout;
    expect(first.obstacles).toHaveLength(1);
    const rest = { x: 0.1, y: -0.1 };
    const going = subject.record({ ...potted, cueRest: rest });
    expect(going.pattern).toEqual({ down: 1, of: 2, over: false });
    expect(subject.tierWindow).toEqual([]);
    subject.nextShot();
    expect(subject.layout.cue).toEqual(rest);
    expect(subject.layout.object).toEqual(first.obstacles![0]);
    expect(subject.layout.obstacles).toEqual([]);
    const done = subject.record({ ...potted, cueRest: rest });
    expect(done.pattern).toEqual({ down: 2, of: 2, over: true });
    expect(subject.tierWindow).toEqual([true]);
  });

  test('ends the run on a miss or a scratch, and deals a fresh one', () => {
    const subject = resumed(level.id, 0);
    const first = subject.layout.id;
    expect(subject.record({ ...potted, scratch: true }).pattern).toEqual({ down: 0, of: 2, over: true });
    expect(subject.tierWindow).toEqual([false]);
    subject.nextShot();
    expect(subject.layout.id).not.toBe(first);
    expect(subject.pattern).toEqual({ ball: 1, of: 2 });
  });

  test('runs three balls at the last tiers', () => {
    expect(resumed(level.id, 2).pattern).toEqual({ ball: 1, of: 3 });
  });
});

describe('the assessment', () => {
  const level = LEVELS.find((l) => l.assessment)!;

  test('deals its twelve stations in turn, each as its own level would, with no guides', () => {
    const subject = campaign();
    subject.selectLevel(level.id);
    const kinds: (string | undefined)[] = [];
    for (let i = 0; i < 12; i++) {
      expect(subject.assessment!.station).toBe(i + 1);
      expect(Object.values(subject.guides).some(Boolean)).toBe(false);
      const scoring = subject.shotScoring;
      kinds.push(scoring?.kind);
      if (scoring?.kind === 'speed') expect(speedViolations(subject.layout, scoring.target)).toEqual([]);
      else expect(layoutViolations(subject.layout, subject.layoutLevel), `station ${i + 1}`).toEqual([]);
      subject.record(i % 3 === 0 ? miss : hit);
      subject.nextShot();
    }
    expect(kinds).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      'position',
      'position',
      'position',
      'position',
      'speed',
      'speed',
      'zone',
      'zone',
    ]);
  });

  test('cannot be passed over: Next deals the same station until it is played', () => {
    const subject = campaign();
    subject.selectLevel(level.id);
    const first = subject.layout.id;
    subject.nextShot();
    expect(subject.layout.id).toBe(first);
    expect(subject.assessment!.station).toBe(1);
  });

  test('scores the run together, part by part, keeping the best and the day’s first', () => {
    const storage = new FakeStorage();
    const subject = new Campaign(createProgressStore(storage), { seed: 4000, today: () => '2026-10-25' });
    subject.selectLevel(level.id);
    let result;
    for (let i = 0; i < 12; i++) {
      // The cuts score on the pot; the rest on the level's task.
      result = subject.record(i < 4 ? { qualifying: false, pottedTarget: true } : { qualifying: i < 8, pottedTarget: false }).assessmentFinished;
      subject.nextShot();
    }
    expect(result).toMatchObject({ points: 8, of: 12, rating: 'solid', personalBest: true, first: true, firstToday: 8 });
    expect(result!.parts).toEqual([
      { part: 'Aim', points: 4, of: 4 },
      { part: 'Cue ball', points: 4, of: 4 },
      { part: 'Speed', points: 0, of: 2 },
      { part: 'Position', points: 0, of: 2 },
    ]);
    for (let i = 0; i < 12; i++) {
      result = subject.record(hit).assessmentFinished;
      subject.nextShot();
    }
    expect(result).toMatchObject({ points: 12, personalBest: true, first: false, firstToday: 8, best: 12 });
  });
});
