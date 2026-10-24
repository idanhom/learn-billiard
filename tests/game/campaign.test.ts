import { describe, expect, test } from 'vitest';
import { analyseShot } from '../../src/geometry/shot';
import { pocketById } from '../../src/geometry/table';
import { Campaign, INTERLEAVE_SHARE, type ScoredShot } from '../../src/game/campaign';
import { layoutViolations } from '../../src/game/generator';
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
    for (const level of LEVELS) {
      expect(subject.selectLevel(level.id)).toBe(true);
      expect(layoutViolations(subject.layout, level), `level ${level.id}`).toEqual([]);
      subject.record(hit);
      subject.nextShot();
      expect(layoutViolations(subject.layout, level), `level ${level.id} second shot`).toEqual([]);
    }
  });
});

/** A campaign resumed at a level and tier, with whatever level records are given. */
function resumed(level: number, tier: 0 | 1 | 2 | 3, records: Record<string, Partial<LevelProgress>> = {}): Campaign {
  const storage = new FakeStorage();
  const base = { tier: 0, completed: false, attempts: 0, qualified: 0, potted: 0 };
  const levels: Record<string, LevelProgress> = {};
  for (const [id, record] of Object.entries(records)) levels[id] = { ...base, ...record } as LevelProgress;
  levels[String(level)] = { ...base, ...(records[String(level)] ?? {}), tier } as LevelProgress;
  storage.setItem(
    PROGRESS_KEY,
    JSON.stringify({ version: PROGRESS_VERSION, currentLevel: level, levels, examBest: null }),
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
