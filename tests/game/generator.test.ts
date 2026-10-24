import { describe, expect, test } from 'vitest';
import { SLOWEST_CLOTH, clothRollingFriction } from '../../src/constants';
import { FRACTIONS, nearestFraction } from '../../src/geometry/fractions';
import { type ShotAnalysis, analyseShot } from '../../src/geometry/shot';
import {
  BALL_RADIUS,
  TABLE,
  isInLegalBounds,
  isInPocketMouth,
  pocketOnPath,
} from '../../src/geometry/table';
import { dist } from '../../src/geometry/vec2';
import { type ShotLayout, aimTarget, idealAimAngle } from '../../src/game/drills';
import { LEVELS, examLevel, levelById } from '../../src/game/levels';
import { generateShot, layoutViolations } from '../../src/game/generator';
import { makeRng } from '../../src/game/random';
import { cueSpeedForPower } from '../../src/game/power';
import { ShotSession } from '../../src/game/shot-session';
import { pocketById } from '../../src/geometry/table';

/** The ideal shot at a layout, on normal cloth at the recommended stroke. */
const analyse = (layout: ShotLayout): ShotAnalysis =>
  analyseShot({ cue: layout.cue, object: layout.object, pocket: pocketById(layout.targetPocket), obstacles: [] });

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
  test('runs five fraction levels, distance and rails, the exam, a mixed review, perception, weak angles and the daily set', () => {
    expect(LEVELS).toHaveLength(11);
    expect(LEVELS.slice(0, 5).map((l) => l.fraction)).toEqual(['full', 'three-quarter', 'half', 'quarter', 'eighth']);
    expect(LEVELS[6]!.exam).toBe(true);
    expect(examLevel().id).toBe(7);
    expect(LEVELS[7]!.review).toBe(true);
    expect(LEVELS[8]!.perception).toBe(true);
    expect(LEVELS[9]!.weak).toBe(true);
    expect(LEVELS[10]!.daily).toBe(true);
    expect(LEVELS.filter((l) => l.exam)).toHaveLength(1);
  });

  test('cut ranges climb from straight-in to thin', () => {
    expect(levelById(1).cutRange).toEqual([0, 7.2]);
    expect(levelById(2).cutRange).toEqual([7.2, 22.2]);
    expect(levelById(3).cutRange).toEqual([22.2, 39.3]);
    expect(levelById(4).cutRange).toEqual([39.3, 54.8]);
    expect(levelById(5).cutRange).toEqual([54.8, 67.3]);
  });

  /** Each practice level is named for a fraction, and that fraction is nearest to all its shots. */
  test('each of the first five levels is centred on a reference fraction', () => {
    LEVELS.slice(0, 5).forEach((level, i) => {
      const fraction = FRACTIONS[i]!;
      const [low, high] = level.cutRange;
      expect(fraction.cutDegrees).toBeGreaterThanOrEqual(low);
      expect(fraction.cutDegrees).toBeLessThanOrEqual(high);
      for (const cut of [low + 0.06, (low + high) / 2, high - 0.06]) {
        expect(nearestFraction((cut * Math.PI) / 180).name, `level ${level.id} at ${cut}`).toBe(fraction.name);
      }
    });
  });

  test('the share of the pocket allowed tightens as the levels get harder', () => {
    const graded = LEVELS.slice(0, 5);
    for (let i = 1; i < graded.length; i++) {
      expect(graded[i]!.pocketAllowance).toBeLessThanOrEqual(graded[i - 1]!.pocketAllowance);
    }
    expect(levelById(1).pocketAllowance).toBe(1);
    expect(levelById(5).pocketAllowance).toBeCloseTo(0.7, 6);
  });

  test('level six is about distance and the rail, not a new angle band', () => {
    const level = levelById(6);
    expect(level.railAdjacent).toBe(true);
    expect(level.potDistance[0]).toBeGreaterThan(levelById(3).potDistance[0]);
  });

  /** It reaches past the practice levels: thinner than an eighth-ball cut, and longer. */
  test('the exam mixes in thin cuts and long shots', () => {
    const exam = examLevel();
    let thin = 0;
    let long = 0;
    for (let seed = 0; seed < 200; seed++) {
      const shot = generateShot(exam, seed);
      expect(shot.fromTemplate, `seed ${seed}`).toBe(false);
      const analysis = analyse(shot.layout);
      if ((analysis.cutAngle * 180) / Math.PI > 62) thin++;
      if (analysis.cueToGhost > 1.1 || analysis.objectToPocket > 1.1) long++;
    }
    expect(thin).toBeGreaterThan(10);
    expect(long).toBeGreaterThan(10);
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
        const cut = toDeg(analyse(layout).cutAngle);
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
      expect(analyse(left).cutSide).toBe('left');
      expect(analyse(right).cutSide).toBe('right');
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

  /** See `sampleNearRail`: a frozen ball is a shot the model cannot play straight. */
  test('but never frozen to it', () => {
    const level = levelById(6);
    for (let seed = 0; seed < 200; seed++) {
      const { layout } = generateShot(level, seed);
      const toLongRail = TABLE.playWidth / 2 - Math.abs(layout.object.y);
      const toShortRail = TABLE.playLength / 2 - Math.abs(layout.object.x);
      expect(Math.min(toLongRail, toShortRail), `seed ${seed}`).toBeGreaterThan(BALL_RADIUS);
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

describe('shots must actually be playable', () => {
  test('no layout starts a ball inside a pocket', () => {
    for (const level of LEVELS) {
      for (let seed = 0; seed < 200; seed++) {
        const { layout } = generateShot(level, seed, {
          preferredSide: seed % 2 === 0 ? 'left' : 'right',
        });
        expect(isInPocketMouth(layout.cue), `level ${level.id} seed ${seed} cue`).toBe(false);
        expect(isInPocketMouth(layout.object), `level ${level.id} seed ${seed} object`).toBe(false);
      }
    }
  });

  test('the cue ball never has to roll over a pocket to reach the object ball', () => {
    for (const level of LEVELS) {
      for (let seed = 0; seed < 200; seed++) {
        const { layout } = generateShot(level, seed, {
          preferredSide: seed % 2 === 0 ? 'left' : 'right',
        });
        const swallowed = pocketOnPath(layout.cue, analyse(layout).ghostCenter);
        expect(swallowed?.id, `level ${level.id} seed ${seed} loses the cue ball`).toBeUndefined();
      }
    }
  });

  test('the object ball never has to cross a pocket that is not the target', () => {
    for (const level of LEVELS) {
      for (let seed = 0; seed < 200; seed++) {
        const { layout } = generateShot(level, seed, {
          preferredSide: seed % 2 === 0 ? 'left' : 'right',
        });
        const swallowed = pocketOnPath(layout.object, aimTarget(layout), { ignore: layout.targetPocket });
        expect(swallowed?.id, `level ${level.id} seed ${seed} drops in the wrong pocket`).toBeUndefined();
      }
    }
  });

  /**
   * The property the player actually cares about, and the one that was broken:
   * aim a generated shot perfectly and the cue ball must reach the object ball.
   * Layouts that failed this reported "missed the object ball" at every angle
   * and every power, so the level was unplayable until the shot was skipped.
   */
  test('a perfectly aimed shot always reaches the object ball', () => {
    for (const level of LEVELS) {
      for (let seed = 0; seed < 25; seed++) {
        const { layout } = generateShot(level, seed, {
          preferredSide: seed % 2 === 0 ? 'left' : 'right',
        });
        const session = new ShotSession(layout, { pocketAllowance: level.pocketAllowance });
        session.aimTo(idealAimAngle(layout));
        session.beginCharge();
        session.setPower(0.6);
        session.release();
        for (let i = 0; i < 60 * 40 && session.phase === 'simulating'; i++) session.advance(1 / 60);
        const outcome = session.evaluate();
        expect(outcome?.contacted, `level ${level.id} seed ${seed} never reaches the object ball`).toBe(
          true,
        );
      }
    }
  });

  /**
   * Stronger than "the cue ball reaches the object ball": a level is only
   * playable if some legal stroke actually pots the thing. Checked on the
   * slowest cloth, because that is the setting where a long shot runs out of
   * legs — and the generator validates against it for exactly that reason.
   */
  test('a legal power pots the target, even on the slowest cloth', () => {
    for (const level of LEVELS) {
      for (let seed = 0; seed < 12; seed++) {
        const { layout } = generateShot(level, seed, {
          preferredSide: seed % 2 === 0 ? 'left' : 'right',
        });
        const potted = [0.5, 0.75, 1].some((power) => {
          const session = new ShotSession(layout, {
            pocketAllowance: level.pocketAllowance,
            cloth: SLOWEST_CLOTH,
          });
          // Throw moves with the stroke, so the line to aim at does too.
          const stroke = { rollingFriction: clothRollingFriction(SLOWEST_CLOTH), cueSpeed: cueSpeedForPower(power) };
          session.aimTo(idealAimAngle(layout, stroke));
          session.beginCharge();
          session.setPower(power);
          session.release();
          for (let i = 0; i < 60 * 40 && session.phase === 'simulating'; i++) session.advance(1 / 60);
          return session.evaluate()?.pottedTarget === true;
        });
        expect(potted, `level ${level.id} seed ${seed} cannot be potted on slow cloth`).toBe(true);
      }
    }
  });

  test('the known bad layouts from the bug report are gone', () => {
    // Each of these put the cue ball on a route straight into the side pocket,
    // or started it inside a corner pocket's capture circle.
    for (const [levelId, seed] of [[1, 203], [1, 276], [2, 24], [3, 233], [6, 1]] as const) {
      const level = levelById(levelId);
      const { layout } = generateShot(level, seed, {
        preferredSide: seed % 2 === 0 ? 'left' : 'right',
      });
      expect(layoutViolations(layout, level), `L${levelId}-s${seed}`).toEqual([]);
      expect(pocketOnPath(layout.cue, analyse(layout).ghostCenter)).toBeUndefined();
      expect(isInPocketMouth(layout.cue)).toBe(false);
    }
  });
});

describe('invariant checking', () => {
  const level = levelById(3);

  test('flags a cue ball parked in a pocket mouth', () => {
    const base = generateShot(level, 5).layout;
    const inPocket = { ...base, cue: { x: TABLE.bounds.maxX, y: TABLE.bounds.maxY } };
    expect(layoutViolations(inPocket, level)).toContain('cue-in-pocket');
  });

  test('flags a cue path that runs over a pocket', () => {
    // Both balls hard against the bottom rail, either side of the side pocket.
    const railed = {
      id: 'railed',
      cue: { x: -0.4, y: TABLE.bounds.minY },
      object: { x: 0.19, y: TABLE.bounds.minY },
      targetPocket: 'bottom-right',
    } as const;
    expect(layoutViolations(railed, level)).toContain('cue-path-enters-pocket');
  });

  test('flags an object path that runs over the wrong pocket', () => {
    const railed = {
      id: 'railed-object',
      cue: { x: -0.75, y: TABLE.bounds.maxY },
      object: { x: -0.45, y: TABLE.bounds.maxY },
      targetPocket: 'top-right',
    } as const;
    expect(layoutViolations(railed, level)).toContain('object-path-enters-pocket');
  });

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
