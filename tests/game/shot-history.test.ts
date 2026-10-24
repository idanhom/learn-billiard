import { describe, expect, test } from 'vitest';
import type { CutSide } from '../../src/geometry/shot';
import {
  EVEN_THRESHOLD_SHARE,
  HISTORY_LENGTH,
  type HistoryEntry,
  ShotHistory,
  type TendencyRow,
  signedShare,
} from '../../src/game/shot-history';

/** A shot that used `share` of the pocket, signed: thick or left positive. */
function entry(share: number, cutSide: CutSide = 'left', extra: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    pocketShare: share,
    qualifying: Math.abs(share) <= 1,
    pottedTarget: false,
    contacted: true,
    cutAngleDegrees: cutSide === 'straight' ? 0 : 30,
    cutSide,
    retry: false,
    ...extra,
  };
}

const row = (history: ShotHistory, label: string): TendencyRow | undefined =>
  history.tendencies.find((r) => r.label === label);

describe('recording shots', () => {
  test('starts empty with no tendency to report', () => {
    const history = new ShotHistory();
    expect(history.entries).toEqual([]);
    expect(history.tendencies).toEqual([]);
  });

  test('keeps the most recent shots, newest first', () => {
    const history = new ShotHistory();
    history.record(entry(0.3));
    history.record(entry(-0.6));
    expect(history.entries).toHaveLength(2);
    expect(history.entries[0]!.pocketShare).toBe(-0.6);
  });

  test('forgets shots beyond the window', () => {
    const history = new ShotHistory();
    for (let i = 0; i < HISTORY_LENGTH + 5; i++) history.record(entry(i / 10));
    expect(history.entries).toHaveLength(HISTORY_LENGTH);
    // The oldest kept shot is the 6th recorded, not the 1st.
    expect(history.entries[HISTORY_LENGTH - 1]!.pocketShare).toBeCloseTo(0.5, 12);
  });

  test('clears when asked, so switching levels does not mix calibrations', () => {
    const history = new ShotHistory();
    history.record(entry(0.5));
    history.record(entry(0.5));
    history.clear();
    expect(history.entries).toEqual([]);
    expect(history.tendencies).toEqual([]);
  });

  test('signs a share by the way it missed', () => {
    expect(signedShare(0.4, 'thick')).toBe(0.4);
    expect(signedShare(0.4, 'left')).toBe(0.4);
    expect(signedShare(0.4, 'thin')).toBe(-0.4);
    expect(signedShare(0.4, 'right')).toBe(-0.4);
  });
});

describe('the bias, as a share of the pocket', () => {
  test('reports a consistent thick bias as thick, by how much of the pocket', () => {
    const history = new ShotHistory();
    for (const share of [0.3, 0.5, 0.7]) history.record(entry(share));
    const { tendency } = row(history, 'Cutting left')!;
    expect(tendency.kind).toBe('thick');
    expect(tendency.share).toBeCloseTo(0.5, 12);
    expect(tendency.samples).toBe(3);
  });

  test('reports a consistent thin bias as thin', () => {
    const history = new ShotHistory();
    history.record(entry(-0.4, 'right'));
    history.record(entry(-0.8, 'right'));
    expect(row(history, 'Cutting right')!.tendency).toEqual({ kind: 'thin', share: 0.6000000000000001, samples: 2 });
  });

  test('cancels out when the misses fall both ways', () => {
    const history = new ShotHistory();
    history.record(entry(0.5));
    history.record(entry(-0.5));
    expect(row(history, 'Cutting left')!.tendency).toEqual({ kind: 'even', share: 0, samples: 2 });
  });

  test('a bias in one direction survives a smaller miss in the other', () => {
    const history = new ShotHistory();
    for (const share of [0.8, 0.9, -0.2]) history.record(entry(share));
    expect(row(history, 'Cutting left')!.tendency.kind).toBe('thick');
  });

  test('a shot dead in the middle counts, pulling the average toward zero', () => {
    const history = new ShotHistory();
    history.record(entry(EVEN_THRESHOLD_SHARE * 1.5));
    history.record(entry(0));
    // 0.3 alone would read thick; with a dead-centre shot beside it, the mean
    // falls under the threshold.
    expect(row(history, 'Cutting left')!.tendency.kind).toBe('even');
  });

  test('ignores shots that never touched the object ball, or had no window', () => {
    const history = new ShotHistory();
    history.record(entry(0.9, 'left', { contacted: false }));
    history.record(entry(0.9, 'left', { pocketShare: null }));
    history.record(entry(0.9));
    expect(row(history, 'Cutting left')).toBeUndefined();
  });

  test('needs more than one shot before claiming a tendency', () => {
    const history = new ShotHistory();
    history.record(entry(0.9));
    expect(history.tendencies).toEqual([]);
  });

  test('lists retries but leaves them out of the average', () => {
    const history = new ShotHistory();
    history.record(entry(0.6));
    history.record(entry(0.6));
    history.record(entry(-3, 'left', { retry: true }));
    expect(history.entries).toHaveLength(3);
    expect(row(history, 'Cutting left')!.tendency).toEqual({ kind: 'thick', share: 0.6, samples: 2 });
  });
});

describe('the bias is split by cut direction and angle band', () => {
  test('a player can be thick cutting left and thin cutting right', () => {
    const history = new ShotHistory();
    for (const share of [0.5, 0.7]) history.record(entry(share, 'left'));
    for (const share of [-0.5, -0.7]) history.record(entry(share, 'right'));
    expect(row(history, 'Cutting left')!.tendency.kind).toBe('thick');
    expect(row(history, 'Cutting right')!.tendency.kind).toBe('thin');
  });

  test('straight-ins report left and right, and never mix into thick and thin', () => {
    const history = new ShotHistory();
    for (const share of [0.6, 0.8]) history.record(entry(share, 'straight'));
    for (const share of [0.5, 0.5]) history.record(entry(share, 'left'));
    expect(row(history, 'Straight in')!.tendency).toEqual({ kind: 'left', share: 0.7, samples: 2 });
    expect(row(history, 'Cutting left')!.tendency).toEqual({ kind: 'thick', share: 0.5, samples: 2 });
  });

  test('an even spread of left and right reads as even', () => {
    const history = new ShotHistory();
    history.record(entry(0.6, 'straight'));
    history.record(entry(-0.6, 'straight'));
    expect(row(history, 'Straight in')!.tendency.kind).toBe('even');
  });

  test('angle bands appear only once two of them have enough shots', () => {
    const history = new ShotHistory();
    for (const share of [0.5, 0.6]) history.record(entry(share, 'left', { cutAngleDegrees: 25 }));
    expect(history.tendencies.map((r) => r.label)).toEqual(['Cutting left']);
    for (const share of [-0.5, -0.6]) history.record(entry(share, 'left', { cutAngleDegrees: 60 }));
    expect(history.tendencies.map((r) => r.label)).toEqual(['Cutting left', 'Cuts of 15-35°', 'Cuts of 55-90°']);
    expect(row(history, 'Cuts of 15-35°')!.tendency.kind).toBe('thick');
    expect(row(history, 'Cuts of 55-90°')!.tendency.kind).toBe('thin');
  });
});

describe('the running summary', () => {
  test('counts what actually happened over the window', () => {
    const history = new ShotHistory();
    history.record(entry(0.2, 'left', { qualifying: true, pottedTarget: true }));
    history.record(entry(2, 'left', { qualifying: false }));
    history.record(entry(0.5, 'left', { qualifying: true }));
    expect(history.summary).toEqual({ shots: 3, qualified: 2, potted: 1 });
  });
});
