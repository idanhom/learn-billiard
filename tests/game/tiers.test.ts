import { describe, expect, test } from 'vitest';
import {
  ADVANCE_REQUIRED,
  ADVANCE_WINDOW,
  FINAL_TIER,
  TierTracker,
} from '../../src/game/tiers';

/** Feed a string of hits (q) and misses (.) through the tracker. */
function feed(tracker: TierTracker, pattern: string): void {
  for (const mark of pattern) tracker.record(mark === 'q');
}

describe('tier tracker', () => {
  test('starts with every guide showing and nothing completed', () => {
    const tracker = new TierTracker();
    expect(tracker.tier).toBe(0);
    expect(tracker.completed).toBe(false);
    expect(tracker.qualifiedInWindow).toBe(0);
    expect(tracker.attemptsInWindow).toBe(0);
  });

  test('advances after three qualifying shots out of five', () => {
    const tracker = new TierTracker();
    feed(tracker, 'qq');
    expect(tracker.tier).toBe(0);
    const result = tracker.record(true);
    expect(result.advanced).toBe(true);
    expect(tracker.tier).toBe(1);
  });

  test('an old qualifying shot drops out of the window', () => {
    const tracker = new TierTracker();
    feed(tracker, 'q....'); // the window is full: q....
    expect(tracker.qualifiedInWindow).toBe(1);
    tracker.record(false); // one more miss pushes the q off the end
    expect(tracker.qualifiedInWindow).toBe(0);

    feed(tracker, 'qq');
    expect(tracker.tier).toBe(0);
    tracker.record(true); // the window is now ..qqq
    expect(tracker.tier).toBe(1);
  });

  test('the window resets on advancing, so a tier is earned from scratch', () => {
    const tracker = new TierTracker();
    feed(tracker, 'qqq');
    expect(tracker.tier).toBe(1);
    expect(tracker.attemptsInWindow).toBe(0);
    expect(tracker.qualifiedInWindow).toBe(0);
  });

  test('misses never send a player back a tier', () => {
    const tracker = new TierTracker();
    feed(tracker, 'qqq');
    expect(tracker.tier).toBe(1);
    feed(tracker, '..........');
    expect(tracker.tier).toBe(1);
  });

  test('clearing the last tier completes the level', () => {
    const tracker = new TierTracker();
    feed(tracker, 'qqq'); // tier 1
    feed(tracker, 'qqq'); // tier 2
    feed(tracker, 'qqq'); // tier 3
    expect(tracker.tier).toBe(FINAL_TIER);
    expect(tracker.completed).toBe(false);
    const result = tracker.record(true);
    expect(result.completed).toBe(false);
    tracker.record(true);
    const done = tracker.record(true);
    expect(done.completed).toBe(true);
    expect(tracker.completed).toBe(true);
  });

  test('stays on the last tier once the level is complete', () => {
    const tracker = new TierTracker();
    feed(tracker, 'qqqqqqqqqqqq');
    expect(tracker.completed).toBe(true);
    expect(tracker.tier).toBe(FINAL_TIER);
    feed(tracker, 'qqq');
    expect(tracker.tier).toBe(FINAL_TIER);
  });

  test('resumes from a saved tier', () => {
    const tracker = new TierTracker({ tier: 2, completed: false });
    expect(tracker.tier).toBe(2);
    feed(tracker, 'qqq');
    expect(tracker.tier).toBe(3);
  });

  test('a saved tier outside the range is clamped rather than trusted', () => {
    expect(new TierTracker({ tier: 9 as never, completed: false }).tier).toBe(FINAL_TIER);
    expect(new TierTracker({ tier: -4 as never, completed: false }).tier).toBe(0);
  });

  test('reports a snapshot that can be stored and restored', () => {
    const tracker = new TierTracker();
    feed(tracker, 'qqqq');
    const snapshot = tracker.snapshot();
    const restored = new TierTracker(snapshot);
    expect(restored.tier).toBe(tracker.tier);
    expect(restored.completed).toBe(tracker.completed);
  });

  test('the advance rule is three of the last five', () => {
    expect(ADVANCE_REQUIRED).toBe(3);
    expect(ADVANCE_WINDOW).toBe(5);
    expect(FINAL_TIER).toBe(3);
  });
});

describe('guide visibility follows the tier', () => {
  test('every tier shows less than the one before it', () => {
    const seen = [0, 1, 2, 3].map((tier) => new TierTracker({ tier: tier as 0, completed: false }).guides);
    expect(seen[0]).toEqual({ aimLine: true, ghostBall: true, objectPath: true, readout: true, powerHint: true });
    expect(seen[1]).toEqual({ aimLine: true, ghostBall: true, objectPath: false, readout: false, powerHint: false });
    expect(seen[2]).toEqual({ aimLine: true, ghostBall: false, objectPath: false, readout: false, powerHint: false });
    expect(seen[3]).toEqual({ aimLine: false, ghostBall: false, objectPath: false, readout: false, powerHint: false });
  });

  test('the cut and fullness numbers are a tier-0 guide, not a permanent fixture', () => {
    expect(new TierTracker({ tier: 0, completed: false }).guides.readout).toBe(true);
    for (const tier of [1, 2, 3] as const) {
      expect(new TierTracker({ tier, completed: false }).guides.readout).toBe(false);
    }
  });

  test('the power marker is a tier-0 guide too — it hands over the stroke', () => {
    expect(new TierTracker({ tier: 0, completed: false }).guides.powerHint).toBe(true);
    for (const tier of [1, 2, 3] as const) {
      expect(new TierTracker({ tier, completed: false }).guides.powerHint).toBe(false);
    }
  });
});

describe('the window the HUD shows as pips', () => {
  test('is the last five shots at this tier, oldest first', () => {
    const tracker = new TierTracker();
    tracker.record(false);
    tracker.record(true);
    expect(tracker.recent).toEqual([false, true]);
    for (const shot of [false, false, true, false]) tracker.record(shot);
    expect(tracker.recent).toEqual([true, false, false, true, false]);
  });

  test('empties on promotion, so a new tier starts with every pip open', () => {
    const tracker = new TierTracker();
    for (let i = 0; i < ADVANCE_REQUIRED; i++) tracker.record(true);
    expect(tracker.tier).toBe(1);
    expect(tracker.recent).toEqual([]);
  });
});
