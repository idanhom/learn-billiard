import { describe, expect, test } from 'vitest';
import { MAX_CUE_SPEED, MIN_CUE_SPEED } from '../../src/constants';
import { idealAimDirection } from '../../src/geometry/shot';
import { pocketById } from '../../src/geometry/table';
import { angleOf, len, vec } from '../../src/geometry/vec2';
import { ShotSession } from '../../src/game/shot-session';
import { CUT_30_DRILL, STRAIGHT_IN_DRILL, layoutWithCut } from '../../src/game/drills';

const deg = (d: number) => (d * Math.PI) / 180;

function idealAngle(layout = STRAIGHT_IN_DRILL): number {
  return angleOf(
    idealAimDirection(layout.cue, layout.object, pocketById(layout.targetPocket).center),
  );
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
    expect(speed).toBeCloseTo(MIN_CUE_SPEED + 0.5 * (MAX_CUE_SPEED - MIN_CUE_SPEED), 9);
    expect(angleOf(session.cueBall.vel)).toBeCloseTo(0, 9);
  });

  test('the cue ball is launched sliding, with no roll of its own', () => {
    const session = new ShotSession(STRAIGHT_IN_DRILL);
    session.beginCharge();
    session.release();
    expect(session.cueBall.roll).toEqual(vec(0, 0));
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
    // Inside tolerance but struck far too softly to reach the pocket.
    const outcome = play(STRAIGHT_IN_DRILL, deg(0.5), 0, 2);
    expect(outcome!.pottedTarget).toBe(false);
    expect(outcome!.contacted).toBe(true);
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
    const capture = pocketById(STRAIGHT_IN_DRILL.targetPocket).captureRadius;
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
    const capture = pocketById(STRAIGHT_IN_DRILL.targetPocket).captureRadius;
    expect(potted!.missDistance).toBeLessThanOrEqual(capture);
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
    const layout = { id: 'wrong-pocket', cue: vec(-0.4, 0.1), object: vec(0.1, 0.33), targetPocket: 'top-right' } as const;
    let found: ReturnType<ShotSession['evaluate']>;
    for (let d = -40; d <= 40 && !found; d += 0.5) {
      const outcome = play(layout, deg(d), 0.5, 2);
      if (outcome?.objectPocket && outcome.objectPocket !== layout.targetPocket) found = outcome;
    }
    expect(found, 'no aim in the sweep found another pocket').toBeDefined();
    expect(found!.pottedWrong).toBe(true);
    expect(found!.pottedTarget).toBe(false);
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
});
