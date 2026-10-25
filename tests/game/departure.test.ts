import { describe, expect, test } from 'vitest';
import { MAX_TIP_OFFSET, clothRollingFriction } from '../../src/constants';
import { DEPARTURE_ARRIVAL, DepartureDrill, type Stroke, departureOf, ruleDirection, strikeFor } from '../../src/game/departure';
import { idealAimAngle, layoutWithCut } from '../../src/game/drills';
import { powerForCueSpeed } from '../../src/game/power';
import { ShotSession } from '../../src/game/shot-session';
import { len, signedAngleBetween, vec } from '../../src/geometry/vec2';

/** A cut of `cutDegrees`, `distance` from contact, struck as the drill strikes it, and played out. */
function played(stroke: Stroke, cutDegrees: number, distance: number) {
  const layout = layoutWithCut('departure', vec(0.3, 0.05), 'top-right', cutDegrees, distance);
  const session = new ShotSession(layout);
  const { speed, tip } = strikeFor(stroke, session.analysis.cueToGhost, clothRollingFriction('normal'));
  session.aimTo(idealAimAngle(layout));
  session.setTip(tip);
  session.beginCharge();
  session.setPower(powerForCueSpeed(speed));
  session.release();
  for (let i = 0; session.phase === 'simulating' && i < 10_000; i++) session.advance(1 / 60);
  return { session, tip };
}

describe('the drill’s stroke', () => {
  test('stunned, the cue ball meets the object ball with its spin gone, at the drill’s speed', () => {
    for (const distance of [0.3, 0.55, 0.8]) {
      const { session, tip } = played('stun', 30, distance);
      const [cue] = session.afterContact!;
      expect(tip).toBeLessThan(0);
      expect(tip).toBeGreaterThanOrEqual(-MAX_TIP_OFFSET);
      // Just after contact: what roll there is came from the rub at contact, not from the cloth.
      expect(len(cue!.roll)).toBeLessThan(0.1);
    }
  });

  test('rolling, it meets the object ball rolling', () => {
    const layout = layoutWithCut('departure', vec(0.3, 0.05), 'top-right', 30, 0.6);
    const session = new ShotSession(layout);
    const { speed, tip } = strikeFor('roll', session.analysis.cueToGhost, clothRollingFriction('normal'));
    expect(tip).toBeCloseTo(0.4, 12);
    expect(speed).toBeGreaterThan(DEPARTURE_ARRIVAL);
    expect(speed).toBeLessThan(DEPARTURE_ARRIVAL + 0.2);
  });
});

describe('where the cue ball went', () => {
  test('stunned, near square to the object ball’s line', () => {
    const { session } = played('stun', 30, 0.5);
    const after = session.afterContact!;
    const cue = departureOf(after, 'stun', 'normal')!;
    const object = after[1]!.vel;
    const square = (Math.abs(signedAngleBetween(cue, object)) * 180) / Math.PI;
    expect(square).toBeGreaterThan(80);
    expect(square).toBeLessThan(90);
  });

  test('rolling, about 30 degrees off its own line once the curve is done', () => {
    const { session } = played('roll', 30, 0.6);
    const cue = departureOf(session.afterContact!, 'roll', 'normal')!;
    const own = idealAimAngle(session.layout);
    const off = (Math.abs(signedAngleBetween({ x: Math.cos(own), y: Math.sin(own) }, cue)) * 180) / Math.PI;
    expect(off).toBeGreaterThan(26);
    expect(off).toBeLessThan(36);
  });
});

describe('the rule\u2019s line', () => {
  test('stunned, square to the line of centres, away from the object ball', () => {
    // The object ball sits ahead and to the left of the cue ball's line: the cue ball goes right.
    const direction = ruleDirection('stun', vec(0, 0), vec(1, 0), vec(1.04, 0.04));
    expect(direction.x).toBeCloseTo(Math.SQRT1_2, 9);
    expect(direction.y).toBeCloseTo(-Math.SQRT1_2, 9);
  });

  test('rolling, thirty degrees off the cue ball\u2019s line, away from the object ball', () => {
    const direction = ruleDirection('roll', vec(0, 0), vec(1, 0), vec(1.04, -0.04));
    expect(direction.x).toBeCloseTo(Math.cos(Math.PI / 6), 9);
    expect(direction.y).toBeCloseTo(Math.sin(Math.PI / 6), 9);
  });
});

describe('a prediction', () => {
  test('is a direction from the ghost ball, taken once', () => {
    const drill = new DepartureDrill('stun', vec(0, 0), 6);
    expect(drill.predict(vec(0.005, 0))).toBeUndefined();
    expect(drill.predict(vec(0, 0.3))).toEqual(vec(0, 1));
    expect(drill.predict(vec(0.3, 0))).toBeUndefined();
  });

  test('is right within the allowance, and scored only once', () => {
    const drill = new DepartureDrill('roll', vec(0, 0), 6);
    expect(drill.score(vec(1, 0), 30)).toBeUndefined();
    drill.predict(vec(1, 0));
    const turn = (5 * Math.PI) / 180;
    expect(drill.score(vec(Math.cos(turn), Math.sin(turn)), 31)).toMatchObject({ correct: true, ruleAngle: 31 });
    expect(drill.result!.error).toBeCloseTo(5, 9);
    expect(drill.score(vec(0, 1), 31)).toBeUndefined();
  });

  test('misses past the allowance', () => {
    const drill = new DepartureDrill('stun', vec(0, 0), 6);
    drill.predict(vec(1, 0));
    const turn = (8 * Math.PI) / 180;
    expect(drill.score(vec(Math.cos(turn), -Math.sin(turn)), 85)!.correct).toBe(false);
  });
});
