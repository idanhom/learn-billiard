import { describe, expect, test } from 'vitest';
import { MAX_CUE_SPEED, MIN_CUE_SPEED } from '../../src/constants';
import { pocketById } from '../../src/geometry/table';
import { angleOf, fromAngle, len, signedAngleBetween, sub, vec } from '../../src/geometry/vec2';
import { ShotSession } from '../../src/game/shot-session';
import { TICK } from '../../src/physics/world';
import { cueSpeedForPower, powerForCueSpeed } from '../../src/game/power';
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
  allowance = 1,
): ReturnType<ShotSession['evaluate']> {
  const session = new ShotSession(layout, { pocketAllowance: allowance });
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
      const session = new ShotSession(CUT_30_DRILL, { aimSeed: seed, pocketAllowance: 1 });
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

/**
 * The report says what happened in table terms: potted, rattled, short or
 * wide by so many centimetres; and how much of the ball was covered against
 * how much was needed.
 */
describe('the report in table units', () => {
  test('perfect aim at the recommended stroke pots, covering just the ball it needed', () => {
    const { layout } = generateShot(levelById(3), 31, { preferredSide: 'left' });
    const session = new ShotSession(layout);
    session.aimTo(idealAimAngle(layout));
    session.beginCharge();
    session.setPower(session.recommendedPower!);
    session.release();
    runToSettled(session);
    const outcome = session.evaluate()!;
    expect(outcome.result).toEqual({ kind: 'potted' });
    expect(outcome.fullnessHit).toBeCloseTo(outcome.fullnessNeeded, 6);
  });

  test('well aimed but struck too softly is on line and short, by how far', () => {
    const outcome = play(STRAIGHT_IN_DRILL, 0, 0.3)!;
    expect(outcome.qualifying).toBe(true);
    expect(outcome.result.kind).toBe('short');
    const { by } = outcome.result as { by: number };
    expect(by).toBeGreaterThan(0.1);
    expect(by).toBeLessThan(1);
  });

  test('aimed outside the pocket misses it by so many centimetres', () => {
    const near = play(STRAIGHT_IN_DRILL, deg(0.5), 0.5)!;
    const far = play(STRAIGHT_IN_DRILL, deg(1.5), 0.5)!;
    expect(near.result.kind).toBe('wide');
    expect(far.result.kind).toBe('wide');
    const [nearBy, farBy] = [near, far].map((o) => (o.result as { by: number }).by);
    expect(nearBy).toBeGreaterThan(0);
    expect(farBy).toBeGreaterThan(nearBy!);
    expect(farBy).toBeLessThan(0.3);
  });

  /** Just outside what drops, struck firmly: into the jaws and back out. */
  test('a ball that gets into the jaws and stays out has rattled', () => {
    const layout = CUT_30_DRILL;
    let rattled: ReturnType<ShotSession['evaluate']>;
    for (let offset = 0.02; offset <= 0.6 && !rattled; offset += 0.02) {
      for (const sign of [1, -1]) {
        const outcome = play(layout, deg(sign * offset), 0.9);
        if (outcome?.result.kind === 'rattled') {
          rattled = outcome;
          break;
        }
      }
    }
    expect(rattled, 'no aim in the sweep rattled').toBeDefined();
    expect(rattled!.pottedTarget).toBe(false);
  });

  test('a thick hit covers more of the ball than it needed, a thin one less', () => {
    const ideal = idealAimAngle(CUT_30_DRILL);
    const centre = angleOf(sub(CUT_30_DRILL.object, CUT_30_DRILL.cue));
    const towardCentre = Math.sign(signedAngleBetween(fromAngle(ideal), fromAngle(centre)));
    const thick = play(CUT_30_DRILL, towardCentre * deg(0.3), 0.55)!;
    const thin = play(CUT_30_DRILL, -towardCentre * deg(0.3), 0.55)!;
    expect(thick.aimError.side).toBe('thick');
    expect(thin.aimError.side).toBe('thin');
    expect(thick.fullnessHit!).toBeGreaterThan(thick.fullnessNeeded);
    expect(thin.fullnessHit!).toBeLessThan(thin.fullnessNeeded);
  });

  test('missing the object ball reports no contact, and no fraction hit', () => {
    const outcome = play(STRAIGHT_IN_DRILL, deg(80), 0)!;
    expect(outcome.result).toEqual({ kind: 'no-contact' });
    expect(outcome.fullnessHit).toBeNull();
  });
});

describe('calling the fraction', () => {
  test('is offered before the shot and reported after it, against the nearest reference', () => {
    const session = new ShotSession(CUT_30_DRILL);
    expect(session.call).toBeNull();
    expect(session.callFraction('half')).toBe(true);
    session.aimTo(idealAimAngle(CUT_30_DRILL));
    session.beginCharge();
    expect(session.callFraction('quarter')).toBe(true);
    session.setPower(0.55);
    session.release();
    expect(session.callFraction('half')).toBe(false);
    runToSettled(session);
    const outcome = session.evaluate()!;
    expect(outcome.call).toBe('quarter');
    // The 30-degree drill needs half a ball, and the half-ball reference is 30.
    expect(outcome.needed).toBe('half');
  });

  test('is optional, and taken back with null', () => {
    const session = new ShotSession(STRAIGHT_IN_DRILL);
    session.callFraction('full');
    session.callFraction(null);
    expect(session.call).toBeNull();
    expect(play(STRAIGHT_IN_DRILL, 0, 0.5)!.call).toBeNull();
    expect(play(STRAIGHT_IN_DRILL, 0, 0.5)!.needed).toBe('full');
  });
});

describe('the outcome contract', () => {
  test('a perfectly aimed straight-in shot qualifies and pots', () => {
    const outcome = play(STRAIGHT_IN_DRILL, 0, 0.5);
    expect(outcome!.aimError.degrees).toBeCloseTo(0, 6);
    expect(outcome!.pocketUsed).toBeCloseTo(0, 6);
    expect(outcome!.contacted).toBe(true);
    expect(outcome!.qualifying).toBe(true);
    expect(outcome!.pottedTarget).toBe(true);
    expect(outcome!.objectPocket).toBe(STRAIGHT_IN_DRILL.targetPocket);
  });

  test('a perfectly aimed thirty degree cut qualifies and pots', () => {
    const outcome = play(CUT_30_DRILL, 0, 0.55);
    expect(outcome!.cutAngle * (180 / Math.PI)).toBeCloseTo(30, 6);
    expect(outcome!.qualifying).toBe(true);
    expect(outcome!.pottedTarget).toBe(true);
  });

  test('progression is scored on aim, not on the pot', () => {
    // Aimed well inside the pocket, and struck hard enough to reach the object
    // ball, but nowhere near hard enough to send it there: 0.58 m/s leaves it
    // stopping around half a metre short. Not the softest possible stroke,
    // which no longer reaches at all and would be testing something else.
    const outcome = play(STRAIGHT_IN_DRILL, deg(0.05), 0.3);
    expect(outcome!.contacted).toBe(true);
    expect(outcome!.pottedTarget).toBe(false);
    expect(outcome!.qualifying).toBe(true);
  });

  test('an aim that sends the object ball outside the pocket does not qualify', () => {
    const outcome = play(STRAIGHT_IN_DRILL, deg(5), 0.5);
    expect(outcome!.aimError.degrees).toBeCloseTo(5, 6);
    expect(outcome!.pocketUsed).toBeGreaterThan(1);
    expect(outcome!.qualifying).toBe(false);
  });

  /**
   * The old two degrees of cue-ball tolerance let the object ball leave this
   * shot some seventeen degrees off line. One degree already uses more than
   * twice the pocket.
   */
  test('a degree off the cue ball is far outside the pocket', () => {
    expect(play(STRAIGHT_IN_DRILL, deg(1), 0.5)!.pocketUsed).toBeGreaterThan(2);
  });

  test('the share allowed comes from the level, not a fixed one', () => {
    // Walk the aim out until the shot uses most of the pocket, but not all.
    let offset = 0;
    let used = 0;
    while (used < 0.6) {
      offset += deg(0.01);
      used = play(STRAIGHT_IN_DRILL, offset, 0.5)!.pocketUsed!;
    }
    expect(used).toBeLessThan(1);
    expect(play(STRAIGHT_IN_DRILL, offset, 0.5, 1)!.qualifying).toBe(true);
    expect(play(STRAIGHT_IN_DRILL, offset, 0.5, 0.5)!.qualifying).toBe(false);
  });

  test('missing the object ball entirely never qualifies', () => {
    // Softly, well away from the object ball, so it never comes back off a rail.
    const outcome = play(STRAIGHT_IN_DRILL, deg(80), 0);
    expect(outcome!.contacted).toBe(false);
    expect(outcome!.qualifying).toBe(false);
    expect(outcome!.pocketUsed).toBeNull();
    expect(outcome!.missDistance).toBeNull();
  });

  test('reports how close the object ball came to the pocket', () => {
    const missed = play(STRAIGHT_IN_DRILL, deg(1.5), 0.5);
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
        const outcome = play(layout, 0, power);
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
    const session = new ShotSession(layout, { pocketAllowance: 1 });
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
   * Off a thin cut the cue ball runs on for seconds after the pot, and it is
   * shown dying at its own pace. It used to play four times as fast once the
   * object ball was down, which put a jolt of speed into a ball that was
   * nearly stopped.
   */
  test('plays out at one pace from the stroke to the last ball stopping', () => {
    // A 78-degree cut close to the corner: the object ball drops 1.18 s in and
    // the cue ball runs on to 3.50 s.
    const layout = layoutWithCut('run-on', vec(0.75, 0.3), 'top-right', 78, 0.35);
    const session = new ShotSession(layout);
    session.aimTo(idealAimAngle(layout));
    session.beginCharge();
    session.setPower(session.recommendedPower!);
    session.release();

    let pottedAt: number | undefined;
    for (let i = 0; i < 60 * 30 && session.phase === 'simulating'; i++) {
      const before = session.elapsed;
      session.advance(1 / 60);
      if (session.phase !== 'simulating') break;
      // Four ticks to a 60 Hz frame, give or take one for the accumulator's
      // rounding from one frame to the next.
      const ticks = Math.round((session.elapsed - before) / TICK);
      expect(Math.abs(ticks - 4), `frame ${i}`).toBeLessThanOrEqual(1);
      if (pottedAt === undefined && session.objectBall.potted) pottedAt = session.elapsed;
    }
    expect(session.evaluate()!.pottedTarget).toBe(true);
    expect(session.elapsed - pottedAt!).toBeGreaterThan(2);
  });

  /** What Retry and Next do to a shot still rolling. */
  test('a shot finished early ends exactly where watching it would have', () => {
    const layout = layoutWithCut('run-on', vec(0.75, 0.3), 'top-right', 78, 0.35);
    const played = (framesWatched: number): ShotSession => {
      const session = new ShotSession(layout);
      session.aimTo(idealAimAngle(layout));
      session.beginCharge();
      session.setPower(session.recommendedPower!);
      session.release();
      for (let i = 0; i < framesWatched && session.phase === 'simulating'; i++) session.advance(1 / 60);
      session.finish();
      return session;
    };
    const watched = played(60 * 30);
    const watchedOutcome = watched.evaluate();
    expect(watchedOutcome!.pottedTarget).toBe(true);
    // Straight after the stroke, a third of a second in, and after the pot at 1.18 s.
    for (const frames of [0, 20, 90]) {
      const early = played(frames);
      expect(early.phase, `${frames} frames`).toBe('settled');
      expect(early.elapsed, `${frames} frames`).toBe(watched.elapsed);
      expect(early.balls, `${frames} frames`).toEqual(watched.balls);
      expect(early.trails, `${frames} frames`).toEqual(watched.trails);
      expect(early.events, `${frames} frames`).toEqual(watched.events);
      expect(early.evaluate(), `${frames} frames`).toEqual(watchedOutcome);
    }
  });

  /** What a replay plays: the stroke as it was, draw and follow included. */
  test('a rerun is the same shot, its tip included', () => {
    const layout = layoutWithCut('rerun', vec(0.4, 0.2), 'top-right', 20, 0.6);
    const struck = (tip: number): ShotSession => {
      const session = new ShotSession(layout);
      session.aimTo(idealAimAngle(layout));
      session.setTip(tip);
      session.beginCharge();
      session.setPower(session.recommendedPower!);
      session.release();
      return session;
    };
    const shot = struck(-0.4);
    const again = shot.rerun();
    shot.finish();
    again.finish();
    expect(again.tip).toBe(-0.4);
    expect(again.balls).toEqual(shot.balls);
    expect(again.events).toEqual(shot.events);
    // And the tip is not idle in it: struck in the centre, the cue ball stops elsewhere.
    const centre = struck(0);
    centre.finish();
    expect(len(sub(centre.cueBall.pos, shot.cueBall.pos))).toBeGreaterThan(0.05);
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

describe('the post-shot diagram and the replay', () => {
  function struck(frames: number): ShotSession {
    const session = new ShotSession(CUT_30_DRILL);
    session.aimTo(idealAngle(CUT_30_DRILL));
    session.beginCharge();
    session.setPower(0.45);
    session.release();
    // An uneven frame rate, as a browser gives, to show it changes nothing.
    for (let i = 0; session.phase === 'simulating' && i < 20_000; i++) session.advance(i % 3 === 0 ? 1 / frames : 1 / 144);
    return session;
  }

  test('trace each ball from where it started to where it stopped', () => {
    const session = struck(60);
    const [cue, object] = session.trails;
    expect(cue![0]).toEqual(CUT_30_DRILL.cue);
    expect(object![0]).toEqual(CUT_30_DRILL.object);
    expect(cue![cue!.length - 1]).toEqual(session.cueBall.pos);
    expect(object![object!.length - 1]).toEqual(session.objectBall.pos);
    expect(cue!.length).toBeGreaterThan(10);
    expect(object!.length).toBeGreaterThan(10);
  });

  test('are the same shot again, however the frames fall', () => {
    const first = struck(60);
    const again = struck(23);
    expect(again.balls.map((b) => b.pos)).toEqual(first.balls.map((b) => b.pos));
    expect(again.events.map((e) => [e.type, e.time])).toEqual(first.events.map((e) => [e.type, e.time]));
  });

  test('has no trail before the stroke', () => {
    expect(new ShotSession(CUT_30_DRILL).trails).toEqual([]);
  });
});

describe('the tip', () => {
  /** Straight in from half a metre at `speed`, struck `tip` of the radius off centre: where the cue ball ends, along the line from contact. */
  function after(tip: number, speed: number): number {
    const layout = layoutWithCut('tip', vec(0.35, 0.15), 'top-right', 0, 0.5);
    const session = new ShotSession(layout);
    session.aimTo(idealAimAngle(layout));
    session.setTip(tip);
    session.beginCharge();
    session.setPower(powerForCueSpeed(speed));
    session.release();
    runToSettled(session);
    const ghost = session.analysis.ghostCenter;
    const line = sub(ghost, layout.cue);
    const length = len(line);
    return ((session.cueBall.pos.x - ghost.x) * line.x + (session.cueBall.pos.y - ghost.y) * line.y) / length;
  }

  test('above centre follows the object ball, below centre draws back, and a little below at pace stops dead', () => {
    expect(after(0.4, 1.5)).toBeGreaterThan(0.25);
    expect(after(-0.4, 2.5)).toBeLessThan(-0.25);
    expect(Math.abs(after(-0.3, 2.5))).toBeLessThan(0.05);
  });

  test('is held to the miscue limit, and fixed once the cue is away', () => {
    const session = new ShotSession(STRAIGHT_IN_DRILL);
    session.setTip(0.9);
    expect(session.tip).toBe(0.5);
    session.beginCharge();
    session.setPower(0.4);
    session.release();
    expect(session.setTip(0)).toBe(false);
    expect(session.tip).toBe(0.5);
  });
});
