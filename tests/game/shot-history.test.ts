import { describe, expect, test } from 'vitest';
import type { AimError } from '../../src/geometry/shot';
import { HISTORY_LENGTH, ShotHistory, type HistoryEntry } from '../../src/game/shot-history';

function aim(kind: AimError['kind'], degrees: number): AimError {
  // The signed field is the raw counter-clockwise angle; the kind is what the
  // player is told. Only the kind carries thick/thin meaning.
  return { kind, degrees, signed: (degrees * Math.PI) / 180 };
}

function entry(kind: AimError['kind'], degrees: number, extra: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    aimError: aim(kind, degrees),
    qualifying: degrees <= 2,
    pottedTarget: false,
    contacted: true,
    cutAngleDegrees: kind === 'left' || kind === 'right' ? 0 : 30,
    ...extra,
  };
}

describe('recording shots', () => {
  test('starts empty with no tendency to report', () => {
    const history = new ShotHistory();
    expect(history.entries).toEqual([]);
    expect(history.cutTendency).toBeNull();
    expect(history.straightTendency).toBeNull();
  });

  test('keeps the most recent shots, newest first', () => {
    const history = new ShotHistory();
    history.record(entry('thick', 1));
    history.record(entry('thin', 2));
    expect(history.entries).toHaveLength(2);
    expect(history.entries[0]!.aimError.kind).toBe('thin');
  });

  test('forgets shots beyond the window', () => {
    const history = new ShotHistory();
    for (let i = 0; i < HISTORY_LENGTH + 5; i++) history.record(entry('thick', i));
    expect(history.entries).toHaveLength(HISTORY_LENGTH);
    // The oldest kept shot is the 6th recorded, not the 1st.
    expect(history.entries[HISTORY_LENGTH - 1]!.aimError.degrees).toBe(5);
  });

  test('clears when asked, so switching levels does not mix calibrations', () => {
    const history = new ShotHistory();
    history.record(entry('thick', 1));
    history.clear();
    expect(history.entries).toEqual([]);
    expect(history.cutTendency).toBeNull();
  });
});

describe('the thick/thin tendency', () => {
  test('reports a consistent thick bias as thick', () => {
    const history = new ShotHistory();
    history.record(entry('thick', 1));
    history.record(entry('thick', 2));
    history.record(entry('thick', 3));
    const tendency = history.cutTendency!;
    expect(tendency.kind).toBe('thick');
    expect(tendency.degrees).toBeCloseTo(2, 6);
    expect(tendency.samples).toBe(3);
  });

  test('reports a consistent thin bias as thin', () => {
    const history = new ShotHistory();
    history.record(entry('thin', 2));
    history.record(entry('thin', 4));
    expect(history.cutTendency!.kind).toBe('thin');
    expect(history.cutTendency!.degrees).toBeCloseTo(3, 6);
  });

  test('cancels out when the misses fall both ways', () => {
    const history = new ShotHistory();
    history.record(entry('thick', 2));
    history.record(entry('thin', 2));
    const tendency = history.cutTendency!;
    expect(tendency.kind).toBe('even');
    expect(tendency.degrees).toBeCloseTo(0, 6);
  });

  test('a bias in one direction survives a smaller miss in the other', () => {
    const history = new ShotHistory();
    history.record(entry('thick', 3));
    history.record(entry('thick', 3));
    history.record(entry('thin', 1.2));
    const tendency = history.cutTendency!;
    expect(tendency.kind).toBe('thick');
    expect(tendency.degrees).toBeCloseTo(1.6, 6);
  });

  test('shots dead on the line count as samples pulling the average to zero', () => {
    const history = new ShotHistory();
    history.record(entry('thick', 3));
    history.record(entry('on-line', 0));
    expect(history.cutTendency!.samples).toBe(2);
    expect(history.cutTendency!.degrees).toBeCloseTo(1.5, 6);
  });

  test('ignores shots that never touched the object ball', () => {
    const history = new ShotHistory();
    history.record(entry('thick', 2));
    history.record(entry('thick', 2));
    // A wild miss says nothing about how thick you are hitting them.
    history.record(entry('thin', 40, { contacted: false }));
    expect(history.cutTendency!.samples).toBe(2);
    expect(history.cutTendency!.kind).toBe('thick');
    expect(history.cutTendency!.degrees).toBeCloseTo(2, 6);
  });

  test('needs more than one shot before claiming a tendency', () => {
    const history = new ShotHistory();
    history.record(entry('thick', 2));
    expect(history.cutTendency).toBeNull();
  });
});

describe('straight-in shots are tracked separately', () => {
  test('left and right never mix into the thick/thin average', () => {
    const history = new ShotHistory();
    history.record(entry('left', 2));
    history.record(entry('left', 2));
    expect(history.cutTendency).toBeNull();
    expect(history.straightTendency!.kind).toBe('left');
    expect(history.straightTendency!.degrees).toBeCloseTo(2, 6);
  });

  test('a thick bias on cuts and a left bias on straights coexist', () => {
    const history = new ShotHistory();
    history.record(entry('thick', 2));
    history.record(entry('thick', 2));
    history.record(entry('right', 1));
    history.record(entry('right', 3));
    expect(history.cutTendency!.kind).toBe('thick');
    expect(history.cutTendency!.samples).toBe(2);
    expect(history.straightTendency!.kind).toBe('right');
    expect(history.straightTendency!.degrees).toBeCloseTo(2, 6);
  });

  test('an even spread of left and right reads as even', () => {
    const history = new ShotHistory();
    history.record(entry('left', 2));
    history.record(entry('right', 2));
    expect(history.straightTendency!.kind).toBe('even');
  });
});

describe('the running summary', () => {
  test('counts what actually happened over the window', () => {
    const history = new ShotHistory();
    history.record(entry('thick', 1, { qualifying: true, pottedTarget: true }));
    history.record(entry('thin', 5, { qualifying: false }));
    history.record(entry('thick', 1, { qualifying: true, pottedTarget: false }));
    expect(history.summary).toEqual({ shots: 3, qualified: 2, potted: 1 });
  });
});
