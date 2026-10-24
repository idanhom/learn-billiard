import { describe, expect, test } from 'vitest';
import { idealAimAngle } from '../../src/game/drills';
import { generateShot } from '../../src/game/generator';
import { LEVELS, levelById } from '../../src/game/levels';
import { potWindow } from '../../src/game/pot-window';
import { ShotSession } from '../../src/game/shot-session';
import { TierTracker } from '../../src/game/tiers';
import { pocketWindow } from '../../src/geometry/pocket-window';
import { pocketById } from '../../src/geometry/table';
import { lcg } from '../support/random';

const layoutFor = (levelId: number, seed: number) =>
  generateShot(levelById(levelId), seed, { preferredSide: seed % 2 ? 'left' : 'right' }).layout;

/** The clean band's half width for a layout, which every pot window contains. */
function cleanHalf(layout: ReturnType<typeof layoutFor>): number {
  const band = pocketWindow(layout.object, pocketById(layout.targetPocket))!;
  return (band.high - band.low) / 2;
}

describe('the pot window', () => {
  test('reaches past the clean band on both sides, since a clean line always drops', () => {
    const ratios: number[] = [];
    for (const levelId of [1, 3, 5, 7]) {
      for (let seed = 0; seed < 6; seed++) {
        const layout = layoutFor(levelId, 4000 + seed);
        const window = potWindow(layout, 'normal', new ShotSession(layout).analysis)!;
        const half = cleanHalf(layout);
        expect(window.clockwise, `L${levelId} ${seed}`).toBeGreaterThanOrEqual(half);
        expect(window.counterClockwise, `L${levelId} ${seed}`).toBeGreaterThanOrEqual(half);
        ratios.push(Math.min(window.clockwise, window.counterClockwise) / half);
      }
    }
    // A facing clipped deep in the jaws still drops, so typically a little
    // more than the clean band: measured at about 1.14 times, at the median.
    ratios.sort((a, b) => a - b);
    expect(ratios[Math.floor(ratios.length / 2)]).toBeLessThan(1.5);
  });

  /**
   * Down a rail, the rail steers a ball that runs into it on toward the pocket,
   * so the window runs far past the band that never touches rubber.
   */
  test('runs far past the clean band on a rail shot', () => {
    const ratios: number[] = [];
    for (let seed = 0; seed < 8; seed++) {
      const layout = layoutFor(6, 4000 + seed);
      const window = potWindow(layout, 'normal', new ShotSession(layout).analysis)!;
      ratios.push(Math.max(window.clockwise, window.counterClockwise) / cleanHalf(layout));
    }
    expect(Math.max(...ratios)).toBeGreaterThan(3);
  });

  test('is worked out once per layout and cloth', () => {
    const layout = layoutFor(2, 4100);
    const analysis = new ShotSession(layout).analysis;
    expect(potWindow(layout, 'normal', analysis)).toBe(potWindow(layout, 'normal', analysis));
    expect(potWindow(layout, 'slow', analysis)).not.toBe(potWindow(layout, 'normal', analysis));
  });
});

/**
 * The plan's gate for scoring on the pocket: a player whose aim wanders a
 * normal 0.15 degrees either way of the ideal line, every shot, can still
 * clear every practice level, tier by tier. And one who wanders a full degree,
 * which the old cue-ball tolerances passed outright on the early levels,
 * rarely qualifies anywhere.
 */
describe('a simulated aimer', () => {
  const gaussian = (random: () => number) => () =>
    Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());

  /** Shots taken until the level's four tiers are cleared, or the cap. */
  function shotsToClear(levelId: number, sigmaDegrees: number, seed: number, cap: number): number {
    const level = levelById(levelId);
    const noise = gaussian(lcg(seed));
    const layouts = Array.from({ length: 10 }, (_, i) => layoutFor(levelId, 9000 + i));
    const tiers = new TierTracker();
    let shots = 0;
    while (!tiers.completed && shots < cap) {
      const layout = layouts[shots % layouts.length]!;
      const session = new ShotSession(layout, { pocketAllowance: level.pocketAllowance });
      session.aimTo(idealAimAngle(layout) + (noise() * sigmaDegrees * Math.PI) / 180);
      session.beginCharge();
      session.setPower(session.recommendedPower!);
      session.release();
      for (let i = 0; i < 60 * 40 && session.phase === 'simulating'; i++) session.advance(1 / 60);
      tiers.record(session.evaluate()!.qualifying);
      shots++;
    }
    return shots;
  }

  test('steady at 0.15 degrees, clears every practice level', () => {
    for (const level of LEVELS.filter((l) => !l.exam)) {
      const shots = shotsToClear(level.id, 0.15, 20261024 + level.id, 120);
      expect(shots, `level ${level.id}`).toBeLessThan(120);
    }
  });

  test('wandering a degree, rarely qualifies at all', () => {
    for (const levelId of [1, 5]) {
      const level = levelById(levelId);
      const noise = gaussian(lcg(77 + levelId));
      let qualified = 0;
      for (let i = 0; i < 30; i++) {
        const layout = layoutFor(levelId, 9100 + i);
        const session = new ShotSession(layout, { pocketAllowance: level.pocketAllowance });
        session.aimTo(idealAimAngle(layout) + (noise() * Math.PI) / 180);
        session.beginCharge();
        session.setPower(session.recommendedPower!);
        session.release();
        for (let k = 0; k < 60 * 40 && session.phase === 'simulating'; k++) session.advance(1 / 60);
        if (session.evaluate()!.qualifying) qualified++;
      }
      expect(qualified, `level ${levelId}`).toBeLessThan(12);
    }
  });
});
