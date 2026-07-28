import { describe, expect, test } from 'vitest';
import { cutAngle, cutSide } from '../../src/geometry/shot';
import { BALL_RADIUS, TABLE, isInLegalBounds, pocketById } from '../../src/geometry/table';
import { dist } from '../../src/geometry/vec2';
import { LEVELS, examLevel, levelById } from '../../src/game/levels';
import { generateShot, layoutViolations, makeRng } from '../../src/game/generator';

const toDeg = (r: number) => (r * 180) / Math.PI;

describe('the seeded random source', () => {
  test('is reproducible', () => {
    const a = makeRng(1234);
    const b = makeRng(1234);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  test('differs between seeds', () => {
    expect(makeRng(1)()).not.toBe(makeRng(2)());
  });

  test('stays inside the unit interval', () => {
    const rng = makeRng(99);
    for (let i = 0; i < 500; i++) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('the curriculum', () => {
  test('runs seven levels, ending in the exam', () => {
    expect(LEVELS).toHaveLength(7);
    expect(LEVELS[6]!.exam).toBe(true);
    expect(examLevel().id).toBe(7);
    expect(LEVELS.slice(0, 6).every((l) => !l.exam)).toBe(true);
  });

  test('cut ranges climb from straight-in to thin', () => {
    expect(levelById(1).cutRange).toEqual([0, 5]);
    expect(levelById(2).cutRange).toEqual([5, 20]);
    expect(levelById(3).cutRange).toEqual([20, 40]);
    expect(levelById(4).cutRange).toEqual([40, 60]);
    expect(levelById(5).cutRange).toEqual([60, 80]);
  });

  test('tolerance tightens as the levels get harder', () => {
    const graded = LEVELS.slice(0, 5);
    for (let i = 1; i < graded.length; i++) {
      expect(graded[i]!.toleranceDegrees).toBeLessThanOrEqual(graded[i - 1]!.toleranceDegrees);
    }
    expect(levelById(1).toleranceDegrees).toBeCloseTo(2, 6);
    expect(levelById(5).toleranceDegrees).toBeCloseTo(0.75, 6);
  });

  test('level six is about distance and the rail, not a new angle band', () => {
    const level = levelById(6);
    expect(level.railAdjacent).toBe(true);
    expect(level.potDistance[0]).toBeGreaterThan(levelById(3).potDistance[0]);
  });

  test('the exam is exempt from tiers and scored on pots', () => {
    const exam = examLevel();
    expect(exam.exam).toBe(true);
    expect(exam.examShots).toBeGreaterThan(0);
  });

  test('every level names itself for the player', () => {
    for (const level of LEVELS) {
      expect(level.name.length).toBeGreaterThan(0);
      expect(level.description.length).toBeGreaterThan(0);
    }
  });
});

describe('generated layouts', () => {
  test('the same seed always gives the same layout', () => {
    for (const level of LEVELS) {
      const a = generateShot(level, 4242);
      const b = generateShot(level, 4242);
      expect(a.layout).toEqual(b.layout);
      expect(a.seed).toBe(4242);
    }
  });

  test('different seeds give different layouts', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      seen.add(JSON.stringify(generateShot(levelById(3), seed).layout));
    }
    expect(seen.size).toBeGreaterThan(30);
  });

  test('every level satisfies its own invariants across many seeds', () => {
    for (const level of LEVELS) {
      for (let seed = 0; seed < 60; seed++) {
        const shot = generateShot(level, seed);
        expect(
          layoutViolations(shot.layout, level),
          `level ${level.id} seed ${seed}`,
        ).toEqual([]);
      }
    }
  });

  test('both balls sit legally on the table with room between them', () => {
    for (let seed = 0; seed < 80; seed++) {
      const { layout } = generateShot(levelById(4), seed);
      expect(isInLegalBounds(layout.cue)).toBe(true);
      expect(isInLegalBounds(layout.object)).toBe(true);
      expect(dist(layout.cue, layout.object)).toBeGreaterThan(2 * BALL_RADIUS);
    }
  });

  test('the cut angle lands inside the level band', () => {
    for (const level of LEVELS) {
      for (let seed = 100; seed < 140; seed++) {
        const { layout } = generateShot(level, seed);
        const pocket = pocketById(layout.targetPocket);
        const cut = toDeg(cutAngle(layout.cue, layout.object, pocket.center));
        expect(cut, `level ${level.id} seed ${seed}`).toBeGreaterThanOrEqual(level.cutRange[0] - 1e-6);
        expect(cut, `level ${level.id} seed ${seed}`).toBeLessThanOrEqual(level.cutRange[1] + 1e-6);
      }
    }
  });

  test('a requested cut side is honoured, so practice does not favour one hand', () => {
    const level = levelById(3);
    for (let seed = 0; seed < 30; seed++) {
      const left = generateShot(level, seed, { preferredSide: 'left' }).layout;
      const right = generateShot(level, seed, { preferredSide: 'right' }).layout;
      expect(cutSide(left.cue, left.object, pocketById(left.targetPocket).center)).toBe('left');
      expect(cutSide(right.cue, right.object, pocketById(right.targetPocket).center)).toBe('right');
    }
  });

  test('the rail level really does put the object ball near a cushion', () => {
    const level = levelById(6);
    for (let seed = 0; seed < 40; seed++) {
      const { layout } = generateShot(level, seed);
      const toLongRail = TABLE.playWidth / 2 - Math.abs(layout.object.y);
      const toShortRail = TABLE.playLength / 2 - Math.abs(layout.object.x);
      expect(Math.min(toLongRail, toShortRail)).toBeLessThanOrEqual(level.railBand);
    }
  });

  test('every pot it asks for is reachable by a legal stroke', () => {
    for (const level of LEVELS) {
      for (let seed = 200; seed < 230; seed++) {
        const { layout } = generateShot(level, seed);
        expect(layoutViolations(layout, level)).not.toContain('underpowered');
      }
    }
  });

  test('shots are spread around the table rather than piled on one pocket', () => {
    const pockets = new Set<string>();
    for (let seed = 0; seed < 60; seed++) {
      pockets.add(generateShot(levelById(2), seed).layout.targetPocket);
    }
    expect(pockets.size).toBeGreaterThanOrEqual(4);
  });

  test('gives up cleanly on an impossible brief and uses the level template', () => {
    const impossible = {
      ...levelById(3),
      // Nothing can be 5 metres from a pocket on a two-metre table.
      potDistance: [5, 6] as [number, number],
    };
    const shot = generateShot(impossible, 7);
    expect(shot.fromTemplate).toBe(true);
    expect(shot.attempts).toBeGreaterThan(1);
    expect(isInLegalBounds(shot.layout.cue)).toBe(true);
    expect(isInLegalBounds(shot.layout.object)).toBe(true);
  });

  test('each level template is a shot that level would accept', () => {
    for (const level of LEVELS) {
      expect(layoutViolations(level.template, level), `level ${level.id} template`).toEqual([]);
    }
  });

  test('layouts carry an id that records the seed, so a shot can be reproduced', () => {
    const shot = generateShot(levelById(2), 31337);
    expect(shot.layout.id).toContain('31337');
    expect(shot.layout.id).toContain('2');
  });
});

describe('invariant checking', () => {
  const level = levelById(3);

  test('flags a cue ball off the table', () => {
    const layout = { ...generateShot(level, 5).layout, cue: { x: 5, y: 5 } };
    expect(layoutViolations(layout, level)).toContain('cue-off-table');
  });

  test('flags overlapping balls', () => {
    const base = generateShot(level, 5).layout;
    const layout = { ...base, cue: { x: base.object.x + BALL_RADIUS, y: base.object.y } };
    expect(layoutViolations(layout, level)).toContain('balls-overlap');
  });

  test('flags a cut outside the level band', () => {
    const straight = generateShot(levelById(1), 9).layout;
    expect(layoutViolations(straight, levelById(5))).toContain('cut-out-of-range');
  });
});
