import { describe, expect, test } from 'vitest';
import { MAX_CUE_SPEED, MIN_CUE_SPEED } from '../../src/constants';
import { pocketById } from '../../src/geometry/table';
import { angleOf, fromAngle, len, signedAngleBetween, sub, vec } from '../../src/geometry/vec2';
import { FAST_FORWARD, ShotSession } from '../../src/game/shot-session';
import { TICK } from '../../src/physics/world';
import { cueSpeedForPower } from '../../src/game/power';
import {
  CUT_30_DRILL,
  START_AIM_OFFSET_DEGREES,
  STRAIGHT_IN_DRILL,
  idealAimAngle,
  layoutWithCut,
} from '../../src/game/drills';
import { generateShot } from '../../src/game/generator';
import { LEVELS, levelById } from '../../src/game/levels';

const deg = (d: number) => (d * Math.PI) / 180;

function idealAngle(layout = STRAIGHT_IN_DRILL): number {
  return idealAimAngle(layout);
}

/** Play a whole shot at the given aim and power, and return the outcome. */
function play(
  layout = STRAIGHT_IN_DRILL,
  aimOffset = 0,
  power = 0.5,
  tolerance = 2,
): ReturnType<ShotSession['evaluate']> {
  const session = new ShotSession(layout, { toleranceDegrees: tolerance });
  session.aimTo(idealAngle(layout) + aimOffset);
  session.beginCharge();
  session.setPower(power);
  session.release();
  runToSettled(session);
  return session.evaluate();
}

function runToSettled(session: ShotSession): void {
  for (let i = 0; i < 60 * 30 && session.phase === 'simulating'; i++) {
    session.advance(1 / 60);
  }
  if (session.phase !== 'settled') throw new Error(`stuck in ${session.phase}`);
}

describe('shot lifecycle', () => {
  test('starts out aiming, with the cue ball and object ball placed', () => {
    const session = new ShotSession(STRAIGHT_IN_DRILL);
    expect(session.phase).toBe('aiming');
    expect(session.cueBall.pos).toEqual(STRAIGHT_IN_DRILL.cue);
    expect(session.objectBall.pos).toEqual(STRAIGHT_IN_DRILL.object);
  });

  test('runs aiming to charging to simulating to settled to evaluated', () => {
    const session = new ShotSession(STRAIGHT_IN_DRILL);
    expect(session.beginCharge()).toBe(true);
    expect(session.phase).toBe('charging');
    session.setPower(0.4);
    expect(session.release()).toBe(true);
    expect(session.phase).toBe('simulating');
    runToSettled(session);
    expect(session.phase).toBe('settled');
    expect(session.evaluate()).toBeDefined();
    expect(session.phase).toBe('evaluated');
  });

  test('refuses to re-strike while the balls are still moving', () => {
    const session = new ShotSession(STRAIGHT_IN_DRILL);
    session.beginCharge();
    session.release();
    expect(session.phase).toBe('simulating');
    expect(session.beginCharge()).toBe(false);
    expect(session.release()).toBe(false);
    expect(session.aimTo(1)).toBe(false);
  });

  test('refuses to release without charging first', () => {
    const session = new ShotSession(STRAIGHT_IN_DRILL);
    expect(session.release()).toBe(false);
    expect(session.phase).toBe('aiming');
  });

  test('a cancelled charge returns to aiming with the power reset', () => {
    const session = new ShotSession(STRAIGHT_IN_DRILL);
    session.beginCharge();
    session.setPower(0.8);
    expect(session.cancelCharge()).toBe(true);
    expect(session.phase).toBe('aiming');
    expect(session.power).toBe(0);
  });

  test('power is clamped to the unit range', () => {
    const session = new ShotSession(STRAIGHT_IN_DRILL);
    session.beginCharge();
    session.setPower(5);
    expect(session.power).toBe(1);
    session.setPower(-3);
    expect(session.power).toBe(0);
  });

  test('aim can be set and nudged while aiming', () => {
    const session = new ShotSession(STRAIGHT_IN_DRILL);
    session.aimTo(0.5);
    expect(session.aimAngle).toBeCloseTo(0.5, 12);
    session.nudgeAim(0.25);
    expect(session.aimAngle).toBeCloseTo(0.75, 12);
  });

  test('release sends the cue ball along the aim line at the charged speed', () => {
    const session = new ShotSession(STRAIGHT_IN_DRILL);
    session.aimTo(0);
    session.beginCharge();
    session.setPower(0.5);
    session.release();
    const speed = len(session.cueBall.vel);
    expect(speed).toBeCloseTo(cueSpeedForPower(0.5), 9);
    expect(angleOf(session.cueBall.vel)).toBeCloseTo(0, 9);
  });

  test('the meter spans the whole legal range of strokes, ends included', () => {
    const speedAt = (power: number): number => {
      const session = new ShotSession(STRAIGHT_IN_DRILL);
      session.beginCharge();
      session.setPower(power);
      session.release();
      return len(session.cueBall.vel);
    };
    expect(speedAt(0)).toBeCloseTo(MIN_CUE_SPEED, 9);
    expect(speedAt(1)).toBeCloseTo(MAX_CUE_SPEED, 9);
    // Strictly increasing, so every reading is a different stroke.
    let previous = speedAt(0);
    for (let power = 0.05; power <= 1.000001; power += 0.05) {
      const speed = speedAt(power);
      expect(speed).toBeGreaterThan(previous);
      previous = speed;
    }
  });

  test('the charged speed is readable before the cue is away', () => {
    const session = new ShotSession(STRAIGHT_IN_DRILL);
    expect(session.cueSpeed).toBeCloseTo(MIN_CUE_SPEED, 9);
    session.beginCharge();
    session.setPower(0.65);
    expect(session.cueSpeed).toBeCloseTo(cueSpeedForPower(0.65), 12);
    session.release();
    expect(len(session.cueBall.vel)).toBeCloseTo(session.cueSpeed, 12);
  });

  test('the cue ball is launched sliding, with no roll of its own', () => {
    const session = new ShotSession(STRAIGHT_IN_DRILL);
    session.beginCharge();
    session.release();
    expect(session.cueBall.roll).toEqual(vec(0, 0));
  });
});

describe('where the cue starts', () => {
  const offIdeal = (session: ShotSession): number =>
    Math.abs(
      (signedAngleBetween(fromAngle(idealAimAngle(session.layout)), fromAngle(session.aimAngle)) * 180) /
        Math.PI,
    );
  const offCentre = (session: ShotSession): number => {
    const { cue, object } = session.layout;
    return Math.abs((signedAngleBetween(sub(object, cue), fromAngle(session.aimAngle)) * 180) / Math.PI);
  };

  /**
   * The bug this pins: the cue used to start on the ideal line, so Space alone
   * scored 0.00 degrees — at the last tier, and in the exam.
   */
  test('is never the ideal line, on any level', () => {
    for (const level of LEVELS) {
      for (let i = 0; i < 40; i++) {
        const { layout } = generateShot(level, 500 + i * 7919, {
          preferredSide: i % 2 === 0 ? 'left' : 'right',
        });
        const session = new ShotSession(layout, { aimSeed: i });
        const [low, high] = START_AIM_OFFSET_DEGREES;
        expect(offIdeal(session), `level ${level.id} shot ${i}`).toBeGreaterThanOrEqual(low - 1e-9);
        expect(offCentre(session), `level ${level.id} shot ${i}`).toBeGreaterThanOrEqual(low - 1e-9);
        expect(offCentre(session), `level ${level.id} shot ${i}`).toBeLessThanOrEqual(high + 1e-9);
      }
    }
  });

  test('so striking without aiming does not qualify', () => {
    for (let seed = 0; seed < 20; seed++) {
      const session = new ShotSession(CUT_30_DRILL, { aimSeed: seed, toleranceDegrees: 2 });
      session.beginCharge();
      session.setPower(0.5);
      session.release();
      runToSettled(session);
      const outcome = session.evaluate()!;
      expect(outcome.aimError.degrees, `seed ${seed}`).toBeGreaterThanOrEqual(START_AIM_OFFSET_DEGREES[0] - 1e-9);
      expect(outcome.qualifying, `seed ${seed}`).toBe(false);
    }
  });

  test('falls either side of the object ball, not always the same one', () => {
    const sides = new Set<number>();
    for (let seed = 0; seed < 20; seed++) {
      const session = new ShotSession(STRAIGHT_IN_DRILL, { aimSeed: seed });
      sides.add(Math.sign(session.aimAngle - idealAimAngle(STRAIGHT_IN_DRILL)));
    }
    expect(sides).toEqual(new Set([-1, 1]));
  });

  test('is reproducible from its seed, and moves when the seed does — a retry starts afresh', () => {
    const first = new ShotSession(CUT_30_DRILL, { aimSeed: 11 }).aimAngle;
    expect(new ShotSession(CUT_30_DRILL, { aimSeed: 11 }).aimAngle).toBe(first);
    const retries = new Set<number>();
    for (let seed = 11; seed < 16; seed++) retries.add(new ShotSession(CUT_30_DRILL, { aimSeed: seed }).aimAngle);
    expect(retries.size).toBe(5);
  });
});

describe('evaluation is a guarded one-shot transition', () => {
  test('cannot evaluate before the balls have settled', () => {
    const session = new ShotSession(STRAIGHT_IN_DRILL);
    expect(session.evaluate()).toBeUndefined();
    session.beginCharge();
    session.release();
    expect(session.evaluate()).toBeUndefined();
  });

  test('evaluates exactly once, however many times it is asked', () => {
    const session = new ShotSession(STRAIGHT_IN_DRILL);
    session.beginCharge();
    session.setPower(0.5);
    session.release();
    runToSettled(session);
    const first = session.evaluate();
    expect(first).toBeDefined();
    expect(session.evaluate()).toBeUndefined();
    expect(session.evaluate()).toBeUndefined();
    expect(session.phase).toBe('evaluated');
    expect(session.outcome).toBe(first);
  });

  test('the outcome is stamped with the shot it belongs to', () => {
    const outcome = play();
    expect(outcome!.shotId).toBe(STRAIGHT_IN_DRILL.id);
  });
});

describe('the outcome contract', () => {
  test('a perfectly aimed straight-in shot qualifies and pots', () => {
    const outcome = play(STRAIGHT_IN_DRILL, 0, 0.5, 2);
    expect(outcome!.aimError.degrees).toBeCloseTo(0, 6);
    expect(outcome!.contacted).toBe(true);
    expect(outcome!.qualifying).toBe(true);
    expect(outcome!.pottedTarget).toBe(true);
    expect(outcome!.objectPocket).toBe(STRAIGHT_IN_DRILL.targetPocket);
  });

  test('a perfectly aimed thirty degree cut qualifies and pots', () => {
    const outcome = play(CUT_30_DRILL, 0, 0.55, 2);
    expect(outcome!.cutAngle * (180 / Math.PI)).toBeCloseTo(30, 6);
    expect(outcome!.qualifying).toBe(true);
    expect(outcome!.pottedTarget).toBe(true);
  });

  test('progression is scored on aim, not on the pot', () => {
    // Inside tolerance, and struck hard enough to reach the object ball, but
    // nowhere near hard enough to send it to the pocket: 0.58 m/s leaves it
    // stopping around half a metre short. Not the softest possible stroke —
    // that one no longer reaches at all, which would be testing something else.
    const outcome = play(STRAIGHT_IN_DRILL, deg(0.5), 0.3, 2);
    expect(outcome!.contacted).toBe(true);
    expect(outcome!.pottedTarget).toBe(false);
    expect(outcome!.qualifying).toBe(true);
  });

  test('an aim outside the level tolerance does not qualify', () => {
    const outcome = play(STRAIGHT_IN_DRILL, deg(5), 0.5, 2);
    expect(outcome!.aimError.degrees).toBeCloseTo(5, 6);
    expect(outcome!.qualifying).toBe(false);
  });

  test('the tolerance is the level tolerance, not a fixed one', () => {
    expect(play(STRAIGHT_IN_DRILL, deg(1.5), 0.5, 2)!.qualifying).toBe(true);
    expect(play(STRAIGHT_IN_DRILL, deg(1.5), 0.5, 0.75)!.qualifying).toBe(false);
  });

  test('missing the object ball entirely never qualifies', () => {
    // Softly, well away from the object ball, so it never comes back off a rail.
    const outcome = play(STRAIGHT_IN_DRILL, deg(80), 0, 180);
    expect(outcome!.contacted).toBe(false);
    expect(outcome!.qualifying).toBe(false);
    expect(outcome!.missDistance).toBeNull();
  });

  test('reports how close the object ball came to the pocket', () => {
    const missed = play(STRAIGHT_IN_DRILL, deg(1.5), 0.5, 0.5);
    const capture = pocketById(STRAIGHT_IN_DRILL.targetPocket).mouthRadius;
    expect(missed!.pottedTarget).toBe(false);
    expect(missed!.missDistance).toBeGreaterThan(capture);
    expect(missed!.missDistance).toBeLessThan(0.5);
  });

  test('a worse aim misses by more', () => {
    const near = play(STRAIGHT_IN_DRILL, deg(0.6), 0.5, 0.5)!.missDistance!;
    const far = play(STRAIGHT_IN_DRILL, deg(1.8), 0.5, 0.5)!.missDistance!;
    expect(far).toBeGreaterThan(near);
  });

  test('a potted shot has a miss distance inside the pocket', () => {
    const potted = play(STRAIGHT_IN_DRILL, 0, 0.5, 2);
    const capture = pocketById(STRAIGHT_IN_DRILL.targetPocket).mouthRadius;
    // The solver freezes a potted ball at the instant its centre crosses the
    // capture circle, so this lands exactly on the radius and which side of it
    // the last bit lands is pure floating point.
    expect(potted!.pottedTarget).toBe(true);
    expect(potted!.missDistance).toBeLessThanOrEqual(capture + 1e-9);
  });

  test('describes the aim as thick or thin on a cut', () => {
    expect(play(CUT_30_DRILL, deg(1), 0.5, 2)!.aimError.kind).toBe('thick');
    expect(play(CUT_30_DRILL, deg(-1), 0.5, 2)!.aimError.kind).toBe('thin');
  });

  test('describes the aim as left or right on a straight-in shot', () => {
    expect(play(STRAIGHT_IN_DRILL, deg(1), 0.5, 2)!.aimError.kind).toBe('left');
    expect(play(STRAIGHT_IN_DRILL, deg(-1), 0.5, 2)!.aimError.kind).toBe('right');
  });

  test('a scratch is flagged but the shot is still scored on aim', () => {
    // On a cut the cue ball keeps its tangential speed, which is how it finds a
    // pocket. Sweep cuts at perfect aim until one of them scratches.
    let scratched: ReturnType<ShotSession['evaluate']>;
    for (let cut = -75; cut <= 75 && !scratched; cut += 5) {
      if (Math.abs(cut) < 10) continue;
      const layout = layoutWithCut(`scratch-${cut}`, vec(0.3, 0), 'top-right', cut, 0.35);
      for (const power of [0.5, 0.75, 1]) {
        const outcome = play(layout, 0, power, 2);
        if (outcome?.scratch) {
          scratched = outcome;
          break;
        }
      }
    }
    expect(scratched, 'no perfectly aimed cut in the sweep scratched').toBeDefined();
    expect(scratched!.scratch).toBe(true);
    expect(scratched!.aimError.degrees).toBeCloseTo(0, 6);
    expect(scratched!.qualifying).toBe(true);
  });

  test('a pot in the wrong pocket is noted and does not count as the target pot', () => {
    // Laid out straight in to the side pocket, while the brief names the corner.
    const straight = layoutWithCut('wrong-pocket', vec(0.1, 0.2), 'top-middle', 0, 0.4);
    const layout = { ...straight, targetPocket: 'top-right' } as const;
    const session = new ShotSession(layout, { toleranceDegrees: 2 });
    session.aimTo(idealAimAngle(straight));
    session.beginCharge();
    session.setPower(0.5);
    session.release();
    runToSettled(session);
    const outcome = session.evaluate()!;
    expect(outcome.objectPocket).toBe('top-middle');
    expect(outcome.pottedWrong).toBe(true);
    expect(outcome.pottedTarget).toBe(false);
  });
});

describe('the simulation clock', () => {
  test('clamps a long frame instead of catching up without limit', () => {
    const session = new ShotSession(STRAIGHT_IN_DRILL);
    session.beginCharge();
    session.setPower(1);
    session.release();
    const before = session.elapsed;
    session.advance(10); // a huge stall
    expect(session.elapsed - before).toBeLessThan(1);
  });

  /**
   * Off a thin cut the cue ball runs on for seconds after the pot. Once the
   * object ball's part is over the clock runs FAST_FORWARD times as fast — and
   * only then: never before contact, when the object ball is also at rest.
   */
  test('plays out faster once the object ball is down, and only then', () => {
    // The object ball drops 0.92 s in and the cue ball runs on to 4.24 s: over
    // three seconds of watching nothing, spent in under one instead.
    const { layout } = generateShot(levelById(5), 4243, { preferredSide: 'left' });
    const session = new ShotSession(layout);
    session.aimTo(idealAimAngle(layout));
    session.beginCharge();
    session.setPower(session.recommendedPower!);
    session.release();
    expect(session.objectBallDone).toBe(false);

    let fastFrames = 0;
    for (let i = 0; i < 60 * 30 && session.phase === 'simulating'; i++) {
      const done = session.objectBallDone;
      const before = session.elapsed;
      session.advance(1 / 60);
      if (session.phase !== 'simulating') break;
      // Four ticks to a 60 Hz frame, give or take one for the accumulator's
      // rounding from one frame to the next.
      const ticks = Math.round((session.elapsed - before) / TICK);
      expect(Math.abs(ticks - (done ? 4 * FAST_FORWARD : 4)), `frame ${i}`).toBeLessThanOrEqual(1);
      if (done) fastFrames++;
    }
    expect(session.evaluate()!.pottedTarget).toBe(true);
    expect(fastFrames).toBeGreaterThan(40);
  });

  test('ignores advance outside the simulating phase', () => {
    const session = new ShotSession(STRAIGHT_IN_DRILL);
    session.advance(1);
    expect(session.elapsed).toBe(0);
    expect(session.phase).toBe('aiming');
  });

  test('exposes an interpolation alpha for rendering between physics ticks', () => {
    const session = new ShotSession(STRAIGHT_IN_DRILL);
    session.beginCharge();
    session.release();
    session.advance(1 / 60);
    expect(session.alpha).toBeGreaterThanOrEqual(0);
    expect(session.alpha).toBeLessThan(1);
    expect(session.previousBalls).toHaveLength(session.balls.length);
  });

  /**
   * Slow motion is the identical shot watched for longer, and that has to hold
   * for which way the balls are facing as well as for where they are. It holds
   * because orientation is integrated on the fixed tick: accumulate it per
   * rendered frame instead and the answer depends on the frame rate, since
   * rotations do not commute and four ticks would collapse into one sample.
   */
  test('orientation does not depend on how the frames are paced', () => {
    const play = (frameSeconds: number): ShotSession => {
      const session = new ShotSession(STRAIGHT_IN_DRILL);
      session.aimTo(idealAngle());
      session.beginCharge();
      session.setPower(0.6);
      session.release();
      for (let i = 0; i < 30 / frameSeconds && session.phase === 'simulating'; i++) {
        session.advance(frameSeconds);
      }
      if (session.phase !== 'settled') throw new Error(`stuck in ${session.phase}`);
      return session;
    };

    const smooth = play(1 / 240);
    const choppy = play(1 / 30);
    expect(choppy.elapsed).toBeCloseTo(smooth.elapsed, 9);
    for (let i = 0; i < smooth.balls.length; i++) {
      expect(choppy.balls[i]!.spin).toEqual(smooth.balls[i]!.spin);
      expect(choppy.balls[i]!.pos).toEqual(smooth.balls[i]!.pos);
    }
  });
});
