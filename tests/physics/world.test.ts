import { describe, expect, test } from 'vitest';
import {
  CLOTH_PRESET_IDS,
  type ClothPreset,
  GRAVITY,
  MAX_CUE_SPEED,
  ROLL_FAST_BOOST,
  ROLL_FAST_SPEED,
  SLIDING_FRICTION,
  TERMINAL_ROLL_BOOST,
  TERMINAL_ROLL_SPEED,
  clothRollingFriction,
} from '../../src/constants';
import { angleBetween, spinBy } from '../../src/geometry/quat';
import { rollPhaseDistance, stoppingDistance } from '../../src/geometry/shot';
import { BALL_RADIUS, TABLE, isInLegalBounds, pocketById } from '../../src/geometry/table';
import { type Vec2, add, dist, fromAngle, len, scale, sub, vec } from '../../src/geometry/vec2';
import { resolveCushion } from '../../src/physics/collision';
import { lcg } from '../support/random';
import {
  TICK,
  type Ball,
  allAtRest,
  createBall,
  simulateToRest,
  stepWorld,
} from '../../src/physics/world';

/**
 * A ball already rolling, not sliding. `createBall` leaves roll at zero, which
 * is right for a struck ball but wrong for every cushion calibration — a
 * stunned ball rebounds quite differently from a rolling one, so measuring the
 * wrong state would silently measure the wrong number.
 */
function rollingBall(id: number, pos: Vec2, vel: Vec2): Ball {
  return createBall(id, pos, vel, vel);
}

/** Speed a ball will settle at once the cloth has resolved its slip. */
function rollingSpeedOf(ball: Ball): number {
  return len(add(scale(ball.vel, 5 / 7), scale(ball.roll, 2 / 7)));
}

/**
 * A square hit from a ROLLING cue ball arriving at `arrival`, and how far each
 * ball runs afterwards.
 *
 * The object ball's run is measured in the simulation wherever the table is
 * long enough to hold it, and read from `stoppingDistance` — fed the ball's
 * MEASURED post-contact velocity and roll, not an assumed one — when it is not.
 * A 1.55 m/s contact sends the object ball 2.6 m and this table is 1.98 m long,
 * so there is nowhere to measure it. The substitution is only as good as the
 * agreement between the two, which this asserts on the way past at every speed
 * that does fit.
 */
function squareHitRatio(arrival: number): {
  impact: number;
  cueTravel: number;
  objectTravel: number;
  ratio: number;
} {
  const object = createBall(1, vec(-0.9, 0));
  const cue = rollingBall(0, vec(-0.9 - 2 * BALL_RADIUS - 0.001, 0), vec(arrival, 0));
  const { balls: atImpact, before } = stepUntil([cue, object], (events) =>
    events.some((e) => e.type === 'ball-ball'),
  );

  const result = simulateToRest(atImpact, { maxDuration: 40 });
  const ranOutOf = (id: number): boolean =>
    result.events.some((e) => e.type !== 'ball-ball' && e.ball === id);

  // Only the OBJECT ball is allowed to reach the end of the table. If the cue
  // ball does, its own travel is measured across a rebound and the ratio is
  // meaningless — and the object ball's cross-check below would have been
  // switched off by the same flag that hid it.
  expect(ranOutOf(0), 'the cue ball reached a cushion; its travel is not measurable').toBe(false);
  const ranOut = ranOutOf(1);

  const cueTravel = result.balls[0]!.pos.x - atImpact[0]!.pos.x;
  const simulated = result.balls[1]!.pos.x - atImpact[1]!.pos.x;

  const struck = atImpact[1]!;
  const analytic = stoppingDistance(
    struck.vel.x,
    clothRollingFriction('normal'),
    struck.roll.x / struck.vel.x,
  );
  if (!ranOut) expect(Math.abs(simulated - analytic) / analytic).toBeLessThan(0.005);

  const objectTravel = ranOut ? analytic : simulated;
  return { impact: before[0]!.vel.x, cueTravel, objectTravel, ratio: objectTravel / cueTravel };
}

function stepUntil(
  balls: Ball[],
  predicate: (events: ReturnType<typeof stepWorld>['events'], balls: Ball[]) => boolean,
  maxTicks = 240 * 20,
): { balls: Ball[]; before: Ball[]; ticks: number } {
  let current = balls;
  for (let i = 0; i < maxTicks; i++) {
    const before = current;
    const result = stepWorld(current);
    current = result.balls;
    if (predicate(result.events, current)) return { balls: current, before, ticks: i + 1 };
  }
  throw new Error('predicate never became true');
}

describe('a ball on its own', () => {
  test('at rest stays where it is', () => {
    const { balls } = simulateToRest([createBall(0, vec(0, 0))]);
    expect(balls[0]!.pos).toEqual(vec(0, 0));
    expect(len(balls[0]!.vel)).toBe(0);
  });

  test('rolls out to within one percent of the analytic stopping distance', () => {
    const speed = 0.45;
    const start = vec(-0.9, 0);
    const { balls } = simulateToRest([createBall(0, start, vec(speed, 0))]);
    const travelled = balls[0]!.pos.x - start.x;
    const predicted = stoppingDistance(speed);
    expect(predicted).toBeLessThan(1.0); // stays clear of the far cushion
    expect(Math.abs(travelled - predicted) / predicted).toBeLessThan(0.01);
  });

  test('is rolling at five sevenths of its launch speed once the slide ends', () => {
    const speed = 1;
    const start = [createBall(0, vec(-0.9, 0), vec(speed, 0))];
    const { balls } = stepUntil(start, (_e, current) => {
      const b = current[0]!;
      return len(sub(b.vel, b.roll)) < 1e-6;
    });
    expect(len(balls[0]!.vel)).toBeCloseTo((5 * speed) / 7, 2);
  });

  test('is launched sliding, with no roll of its own', () => {
    const ball = createBall(0, vec(0, 0), vec(2, 0));
    expect(ball.roll).toEqual(vec(0, 0));
    expect(len(sub(ball.vel, ball.roll))).toBeCloseTo(2, 12);
  });

  test('comes to rest and reports settled', () => {
    const result = simulateToRest([createBall(0, vec(-0.5, 0), vec(1.5, 0.3))]);
    expect(result.settled).toBe(true);
    expect(allAtRest(result.balls)).toBe(true);
    expect(result.duration).toBeLessThan(20);
  });

  test('gives up with settled false if it never stops in time', () => {
    const result = simulateToRest([createBall(0, vec(-0.5, 0), vec(3, 0.7))], {
      maxDuration: 0.2,
    });
    expect(result.settled).toBe(false);
    expect(result.duration).toBeCloseTo(0.2, 2);
  });
});

describe('cushions', () => {
  /**
   * The number the whole cushion model is calibrated against: a rolling ball
   * driven square into a rail should come back having lost about half its
   * speed. Measured after it has settled, because most of that loss is the skid
   * that follows the rebound, not the rebound itself — and measured against the
   * speed AT the rail, per `CLAUDE.md`: this ball launches above the fast step
   * and sheds a third of its speed on the run-up, and dividing by the launch
   * speed would bill the cushion for what the cloth took.
   */
  test('take about half the speed of a rolling ball hit square', () => {
    const start = rollingBall(0, vec(0.4, -0.2), vec(0, 1.4));
    const { balls, before } = stepUntil([start], (events) =>
      events.some((e) => e.type === 'cushion'),
    );
    const retained = rollingSpeedOf(balls[0]!) / rollingSpeedOf(before[0]!);
    expect(retained).toBeGreaterThan(0.45);
    expect(retained).toBeLessThan(0.6);
  });

  test('send the ball back the way it came', () => {
    const start = rollingBall(0, vec(0.4, -0.2), vec(0, 1.4));
    const { balls } = stepUntil([start], (events) => events.some((e) => e.type === 'cushion'));
    expect(balls[0]!.vel.y).toBeLessThan(0);
  });

  test('cost a glancing ball far less than a square one', () => {
    const square = rollingBall(0, vec(0.4, -0.2), vec(0, 1.4));
    const glancing = rollingBall(0, vec(-0.6, 0.2), vec(1.35, 0.36)); // ~15 degrees
    const hitSquare = stepUntil([square], (e) => e.some((x) => x.type === 'cushion'));
    const hitGlancing = stepUntil([glancing], (e) => e.some((x) => x.type === 'cushion'));

    // Measured against the speed AT the rail, not at launch: the two run-ups
    // differ in length, and the cloth's share of the loss is not the cushion's.
    const kept = (hit: typeof hitSquare): number =>
      rollingSpeedOf(hit.balls[0]!) / rollingSpeedOf(hit.before[0]!);

    expect(kept(hitGlancing)).toBeGreaterThan(kept(hitSquare));
    expect(kept(hitGlancing)).toBeGreaterThan(0.85);

    // The square rebound is the pair of published figures the contact
    // restitution was chosen to reproduce, and they are two moments of the
    // same event: 0.65 of the incoming speed straight off the rail, settling
    // to 0.50 once the ball has skidded out of its now-backwards roll.
    const straightOff = len(hitSquare.balls[0]!.vel) / len(hitSquare.before[0]!.vel);
    expect(straightOff).toBeCloseTo(0.65, 2);
    expect(kept(hitSquare)).toBeCloseTo(0.5, 2);
  });

  /**
   * The corrected impulse can leave the ball's centre still moving into the
   * rail — a ball whose spin fights its motion gets a small impulse because its
   * contact point is barely moving. Energy falls every time, so it must
   * converge rather than chatter against the rail for ever.
   */
  test('settle a ball whose spin fights its motion instead of chattering', () => {
    const fighting = createBall(0, vec(0.4, 0.4), vec(0, 1.2), vec(0, -1.2));
    const result = simulateToRest([fighting], { maxDuration: 30 });
    expect(result.settled).toBe(true);
    expect(result.balls[0]!.potted || isInLegalBounds(result.balls[0]!.pos, -2e-3)).toBe(true);
    expectFinite(result.balls[0]!.pos);
    expectFinite(result.balls[0]!.vel);
  });

  test('a shot settles sooner than it used to, because rails now cost real speed', () => {
    // Before the cushion fix this took far longer: every rail returned 75% of
    // the ball's speed and left it perfectly rolling.
    const result = simulateToRest([rollingBall(0, vec(-0.8, 0), vec(3, 0.9))]);
    expect(result.settled).toBe(true);
    expect(result.duration).toBeLessThan(8);
  });

  test('keep the ball on the table', () => {
    const result = simulateToRest([createBall(0, vec(0, 0), vec(2.5, 1.2))]);
    expect(result.balls[0]!.potted || isInLegalBounds(result.balls[0]!.pos, -1e-3)).toBe(true);
  });

  test('a ball fired the length of the table at full speed never leaves it', () => {
    const random = lcg(20260728);
    for (let i = 0; i < 250; i++) {
      const pos = vec(
        TABLE.bounds.minX + random() * (TABLE.bounds.maxX - TABLE.bounds.minX),
        TABLE.bounds.minY + random() * (TABLE.bounds.maxY - TABLE.bounds.minY),
      );
      const vel = fromAngle(random() * Math.PI * 2, MAX_CUE_SPEED);
      const result = simulateToRest([createBall(0, pos, vel)], { maxDuration: 40 });
      const ball = result.balls[0]!;
      const contained = ball.potted || isInLegalBounds(ball.pos, -2e-3);
      expect(contained, `escaped from ${JSON.stringify(pos)} at ${JSON.stringify(vel)}`).toBe(true);
      expect(Number.isFinite(ball.pos.x) && Number.isFinite(ball.pos.y)).toBe(true);
    }
  });
});

describe('cloth speed', () => {
  test('slower cloth stops a ball sooner', () => {
    const travel = (cloth: ClothPreset) => {
      const start = vec(-0.9, 0);
      const { balls } = simulateToRest([createBall(0, start, vec(0.45, 0))], { cloth });
      return balls[0]!.pos.x - start.x;
    };
    expect(travel('slow')).toBeLessThan(travel('normal'));
    expect(travel('normal')).toBeLessThan(travel('fast'));
  });

  /**
   * The guard that keeps the analytic model and the simulation in step. It has
   * to hold for every cloth, not just the default — the generator reasons about
   * makeability using the closed form, and plays out using the solver.
   */
  test('the simulation matches the closed form on every cloth', () => {
    for (const cloth of CLOTH_PRESET_IDS) {
      const rollingFriction = clothRollingFriction(cloth);
      for (const speed of [0.3, 0.45, 0.6]) {
        const start = vec(-0.9, 0);
        const predicted = stoppingDistance(speed, rollingFriction);
        if (predicted > 1.0) continue; // would reach the far cushion
        const { balls } = simulateToRest([createBall(0, start, vec(speed, 0))], { cloth });
        const travelled = balls[0]!.pos.x - start.x;
        expect(
          Math.abs(travelled - predicted) / predicted,
          `${cloth} at ${speed} m/s`,
        ).toBeLessThan(0.01);
      }
    }
  });

  test('defaults to the normal cloth when none is asked for', () => {
    const start = vec(-0.9, 0);
    const withDefault = simulateToRest([createBall(0, start, vec(0.45, 0))]);
    const explicit = simulateToRest([createBall(0, start, vec(0.45, 0))], { cloth: 'normal' });
    expect(withDefault.balls[0]!.pos.x).toBeCloseTo(explicit.balls[0]!.pos.x, 12);
  });
});

describe('pockets', () => {
  test('take a ball rolled straight at them and stop it dead', () => {
    const pocket = pocketById('top-right');
    const start = vec(0.3, 0.1);
    const direction = sub(pocket.center, start);
    const speed = 1.2;
    const vel = vec(
      (direction.x / Math.hypot(direction.x, direction.y)) * speed,
      (direction.y / Math.hypot(direction.x, direction.y)) * speed,
    );
    const result = simulateToRest([createBall(0, start, vel)]);
    expect(result.balls[0]!.potted).toBe(true);
    expect(result.balls[0]!.pocket).toBe('top-right');
    expect(len(result.balls[0]!.vel)).toBe(0);
    expect(result.events.some((e) => e.type === 'pocket')).toBe(true);
  });

  test('do not take a ball rolling past the mouth along the rail', () => {
    const start = vec(-0.5, TABLE.bounds.maxY);
    const result = simulateToRest([createBall(0, start, vec(0.35, 0))]);
    expect(result.balls[0]!.potted).toBe(false);
  });

  test('a potted ball stops taking part in the simulation', () => {
    const pocket = pocketById('top-middle');
    // Rolling, not sliding. The cue ball has to follow through the space the
    // bystander vacated to prove the point, and a full hit leaves a sliding
    // ball with almost nothing — it is the roll that carries it in.
    const cue = rollingBall(0, vec(0, 0.2), vec(0, 1.2));
    const bystander = createBall(1, vec(0, 0.4));
    const result = simulateToRest([cue, bystander]);
    expect(result.balls[0]!.potted).toBe(true);
    expect(result.balls[0]!.pocket).toBe(pocket.id);
    // The bystander was struck on the way in, but nothing touched it afterwards.
    expect(result.balls[1]!.potted).toBe(true);
  });
});

describe('ball on ball', () => {
  test('a dead straight hit passes on almost all of the speed at impact', () => {
    const cue = createBall(0, vec(-0.3, 0), vec(2, 0));
    const object = createBall(1, vec(0, 0));
    const { balls, before } = stepUntil([cue, object], (events) =>
      events.some((e) => e.type === 'ball-ball'),
    );
    // The cue ball sheds speed to the cloth on the way in, so measure the
    // transfer against its speed at contact, not at launch.
    const impactSpeed = before[0]!.vel.x;
    expect(Math.abs(balls[1]!.vel.x - 0.975 * impactSpeed)).toBeLessThan(0.02);
    expect(balls[0]!.vel.x).toBeLessThan(0.1);
    expect(balls[0]!.vel.x).toBeGreaterThan(0);
    expect(balls[0]!.vel.y).toBeCloseTo(0, 12);
  });

  test('the cue ball follows forward after a full hit', () => {
    const cue = createBall(0, vec(-0.3, 0), vec(0.8, 0));
    const object = createBall(1, vec(0, 0));
    const { balls: atImpact } = stepUntil([cue, object], (events) =>
      events.some((e) => e.type === 'ball-ball'),
    );
    // Almost stopped by the collision, but still carrying most of its roll —
    // contact friction takes a share of it, not all of it.
    expect(atImpact[0]!.vel.x).toBeLessThan(0.1);
    expect(atImpact[0]!.roll.x).toBeGreaterThan(0.3);

    const result = simulateToRest(atImpact);
    // The roll drives it forward again — this is why there is no tangent guide.
    const cueTravel = result.balls[0]!.pos.x - atImpact[0]!.pos.x;
    const objectTravel = result.balls[1]!.pos.x - atImpact[1]!.pos.x;
    expect(cueTravel).toBeGreaterThan(0.01);
    expect(objectTravel).toBeGreaterThan(cueTravel);
  });

  /**
   * The number this contact model exists to move, measured across the range of
   * shots the curriculum actually asks for.
   *
   * Published tables put a square hit from a rolling cue ball at 6.5-8x, and
   * frictionless collisions put it at 5.2x whatever the speed. With contact
   * friction AND the terminal knee it lands in band from an ordinary pot
   * upward, and runs high on the very softest shots — where the cue ball
   * follows under 3 cm and nobody can see where it stopped. It is no longer
   * scale-free, and `README.md` says so.
   *
   * Measured against the speed AT CONTACT, per `CLAUDE.md`: measuring a
   * collision property against a launch speed folds in whatever the cloth took
   * on the run-up.
   */
  test('sends the object ball 6.5-8x further than the cue ball, over ordinary pots', () => {
    for (const [arrival, expected] of [
      [0.787, 7.36],
      [1.2, 6.77],
      [1.55, 6.6],
    ] as const) {
      const { ratio, impact } = squareHitRatio(arrival);
      expect(impact).toBeCloseTo(arrival, 2);
      expect(ratio).toBeCloseTo(expected, 1);
      expect(ratio).toBeGreaterThan(6.5);
      expect(ratio).toBeLessThan(8);
    }
  });

  test('and runs above the band on a touch shot, which is the cost of the knee', () => {
    const { ratio } = squareHitRatio(0.5);
    expect(ratio).toBeCloseTo(9.67, 1);
    expect(ratio).toBeGreaterThan(8);
  });

  test('a half-ball hit sends the object ball off at thirty degrees', () => {
    const cue = createBall(0, vec(-0.3, 0), vec(2, 0));
    const object = createBall(1, vec(0, BALL_RADIUS));
    const { balls } = stepUntil([cue, object], (events) =>
      events.some((e) => e.type === 'ball-ball'),
    );
    const angle = (Math.atan2(balls[1]!.vel.y, balls[1]!.vel.x) * 180) / Math.PI;
    expect(angle).toBeCloseTo(30, 0);
  });

  test('balls that start overlapping are separated rather than exploding', () => {
    const a = createBall(0, vec(0, 0));
    const b = createBall(1, vec(BALL_RADIUS, 0));
    const { balls } = stepWorld([a, b]);
    const gap = Math.hypot(balls[1]!.pos.x - balls[0]!.pos.x, balls[1]!.pos.y - balls[0]!.pos.y);
    expect(gap).toBeGreaterThanOrEqual(2 * BALL_RADIUS);
    expect(Number.isFinite(gap)).toBe(true);
  });

  test('coincident balls are separated without producing NaN', () => {
    const { balls } = stepWorld([createBall(0, vec(0, 0)), createBall(1, vec(0, 0))]);
    for (const ball of balls) {
      expect(Number.isFinite(ball.pos.x) && Number.isFinite(ball.pos.y)).toBe(true);
    }
  });
});

describe('events', () => {
  test('are reported in the order they happen', () => {
    const result = simulateToRest([createBall(0, vec(-0.8, 0), vec(3, 0.9))]);
    expect(result.events.length).toBeGreaterThan(1);
    for (let i = 1; i < result.events.length; i++) {
      expect(result.events[i]!.time).toBeGreaterThanOrEqual(result.events[i - 1]!.time);
    }
  });

  test('carry the simulation time at which they occurred', () => {
    const result = simulateToRest([createBall(0, vec(0, 0), vec(0, 2))]);
    const first = result.events[0]!;
    expect(first.time).toBeGreaterThan(0);
    expect(first.time).toBeLessThan(result.duration);
  });
});

describe('the tick', () => {
  test('is a fixed 1/240 second', () => {
    expect(TICK).toBeCloseTo(1 / 240, 12);
  });

  test('advances a free ball by velocity times dt', () => {
    const { balls } = stepWorld([createBall(0, vec(0, 0), vec(1, 0))]);
    expect(balls[0]!.pos.x).toBeCloseTo(TICK, 6);
  });

  test('never produces NaN across a sweep of launches', () => {
    const random = lcg(7);
    for (let i = 0; i < 120; i++) {
      const balls: Ball[] = [
        createBall(0, vec(-0.6 + random() * 0.2, -0.2 + random() * 0.4), fromAngle(random() * 6.283, random() * MAX_CUE_SPEED)),
        createBall(1, vec(0.2 + random() * 0.4, -0.3 + random() * 0.6)),
      ];
      const result = simulateToRest(balls, { maxDuration: 25 });
      for (const ball of result.balls) {
        expectFinite(ball.pos);
        expectFinite(ball.vel);
        expectFinite(ball.roll);
      }
    }
  });
});

/**
 * Orientation, exercised through `stepWorld` rather than through `spinBy`.
 *
 * A test of the helper alone would still pass if `advance` composed the turn on
 * the wrong side, or spun once per tick with whichever roll happened to survive
 * to the end of it instead of once per sub-interval between events.
 */
describe('which way a ball is facing', () => {
  test('a struck ball turns 2.4x less than its travel while it is still sliding', () => {
    let current: Ball[] = [createBall(0, vec(-0.8, 0.2), vec(2, 0))];
    let path = 0;
    let turned = 0;

    // Until the cloth has closed the slip: after that, roll equals velocity and
    // the two rates agree by definition.
    for (let i = 0; i < 240 && len(sub(current[0]!.vel, current[0]!.roll)) > 0; i++) {
      const before = current[0]!;
      current = stepWorld(current).balls;
      path += dist(before.pos, current[0]!.pos);
      turned += angleBetween(before.spin, current[0]!.spin);
    }

    // Analytically the slide is 0.49928 m and 7.28029 rad. The solver holds
    // both velocity and roll at their start-of-tick values and applies friction
    // afterwards, so it overshoots the distance by ~0.4% and undershoots the
    // turn by ~1%; the exact 2.4 comes out at 2.44. What must not move is the
    // order of magnitude of the gap — a position-derived turn would read 1.0.
    expect(Math.abs(path / 0.49928 - 1)).toBeLessThan(0.01);
    expect(Math.abs(turned / 7.28029 - 1)).toBeLessThan(0.02);
    expect(path / BALL_RADIUS / turned).toBeCloseTo(2.4, 1);
  });

  test('a rolling ball turns exactly as far as it travels', () => {
    let current: Ball[] = [rollingBall(0, vec(-0.8, 0.2), vec(1.2, 0))];
    let path = 0;
    let turned = 0;
    for (let i = 0; i < 120; i++) {
      const before = current[0]!;
      current = stepWorld(current).balls;
      path += dist(before.pos, current[0]!.pos);
      turned += angleBetween(before.spin, current[0]!.spin);
    }
    expect(path / BALL_RADIUS / turned).toBeCloseTo(1, 6);
  });

  /**
   * A rail changes the roll partway through a tick, and the ball has to turn
   * one way up to the contact and the other way after it. Spinning once for the
   * whole tick — with either roll — is the mistake this pins down.
   */
  test('composes both sides of a cushion contact inside one tick', () => {
    let current: Ball[] = [rollingBall(0, vec(0.4, -0.2), vec(0, 1.4))];
    let before = current;
    let contactTime = -1;
    for (let i = 0; i < 240 * 5 && contactTime < 0; i++) {
      before = current;
      const step = stepWorld(current);
      current = step.balls;
      for (const event of step.events) {
        if (event.type === 'cushion') contactTime = event.time;
      }
    }
    expect(contactTime).toBeGreaterThan(0);
    expect(contactTime).toBeLessThan(TICK);

    // The far long rail, so the inward normal is -y. Velocity and roll are
    // constant inside a tick, so these are exactly what the solver resolved.
    const incoming = before[0]!;
    const bounced = resolveCushion(incoming.vel, incoming.roll, vec(0, -1))!;
    const composed = spinBy(
      spinBy(incoming.spin, incoming.roll, BALL_RADIUS, contactTime),
      bounced.roll,
      BALL_RADIUS,
      TICK - contactTime,
    );
    expect(angleBetween(current[0]!.spin, composed)).toBeLessThan(1e-12);

    // Neither roll on its own accounts for the tick.
    const onlyIncoming = spinBy(incoming.spin, incoming.roll, BALL_RADIUS, TICK);
    const onlyOutgoing = spinBy(incoming.spin, bounced.roll, BALL_RADIUS, TICK);
    expect(angleBetween(current[0]!.spin, onlyIncoming)).toBeGreaterThan(1e-3);
    expect(angleBetween(current[0]!.spin, onlyOutgoing)).toBeGreaterThan(1e-3);
  });

  test('stays a unit quaternion the length of a full-power shot', () => {
    const result = simulateToRest([createBall(0, vec(-0.9, 0), vec(MAX_CUE_SPEED, 0.3))]);
    const { x, y, z, w } = result.balls[0]!.spin;
    expect(Math.hypot(x, y, z, w)).toBeCloseTo(1, 12);
  });

  test('a potted ball stops turning', () => {
    const pocket = pocketById('top-left');
    const start = createBall(0, add(pocket.center, vec(0.3, -0.2)), vec(-1.2, 0.8));
    const result = simulateToRest([start]);
    expect(result.balls[0]!.potted).toBe(true);

    const settled = result.balls[0]!.spin;
    const again = stepWorld(result.balls).balls[0]!.spin;
    expect(again).toBe(settled);
  });
});

/**
 * The unpublished half of this cloth model. See the constants: there is no
 * measured value behind either number, only a judgement about how a ball ought
 * to stop, so what these tests pin is that the code does what the comment says
 * — not that the comment is right about real cloth.
 */
describe('the terminal roll knee', () => {
  const plainDecel = clothRollingFriction('normal') * GRAVITY;

  /** Deceleration over one tick of a ball already rolling at `speed`. */
  function decelAt(speed: number): number {
    const { balls } = stepWorld([rollingBall(0, vec(-0.5, 0), vec(speed, 0))]);
    return (speed - len(balls[0]!.vel)) / TICK;
  }

  test('costs a slow ball twice the rolling resistance a quick one pays', () => {
    expect(decelAt(0.5)).toBeCloseTo(plainDecel, 6);
    expect(decelAt(TERMINAL_ROLL_SPEED / 2)).toBeCloseTo(TERMINAL_ROLL_BOOST * plainDecel, 6);
  });

  /**
   * Split at the crossing rather than integrated at whichever rate the tick
   * started in — otherwise the answer would depend on the tick length, and
   * `src/geometry/shot.ts` inverts this analytically on the assumption that it
   * does not.
   */
  test('splits a tick that straddles the knee, rather than picking one rate', () => {
    const speed = TERMINAL_ROLL_SPEED + (plainDecel * TICK) / 2;
    const { balls } = stepWorld([rollingBall(0, vec(-0.5, 0), vec(speed, 0))]);
    const expected = TERMINAL_ROLL_SPEED - (TERMINAL_ROLL_BOOST * plainDecel * TICK) / 2;
    expect(len(balls[0]!.vel)).toBeCloseTo(expected, 9);
  });

  test('and cuts a soft shot short, by the amount the analytic layer predicts', () => {
    // Slow enough that the roll phase lives almost entirely under the knee.
    const speed = 0.2;
    const start = vec(-0.5, 0);
    const { balls } = simulateToRest([createBall(0, start, vec(speed, 0))]);
    const travelled = balls[0]!.pos.x - start.x;
    const predicted = stoppingDistance(speed);

    // 2%, not the 1% a firm shot gets: the whole run is 3.6 cm, so a single
    // tick of travel is a far larger share of it.
    expect(Math.abs(travelled - predicted) / predicted).toBeLessThan(0.02);

    // And the knee is doing real work — without the boost the same launch would
    // coast about half as far again. The offset the boost saves is whatever
    // `rollPhaseDistance` takes off a roll-out that reaches the knee, read back
    // out of it rather than restated here.
    const mu = clothRollingFriction('normal');
    const savedByTheKnee =
      (TERMINAL_ROLL_SPEED * TERMINAL_ROLL_SPEED) / (2 * mu * GRAVITY) -
      rollPhaseDistance(TERMINAL_ROLL_SPEED, mu);
    expect((predicted + savedByTheKnee) / travelled).toBeGreaterThan(1.4);
  });
});

/**
 * The fast step, the ladder's other unpublished half — same status as the
 * knee: what these pin is that the code does what the comment says, not that
 * the comment is right about real cloth.
 */
describe('the fast roll step', () => {
  const plainDecel = clothRollingFriction('normal') * GRAVITY;

  /** Deceleration over one tick of a ball already rolling at `speed`. */
  function decelAt(speed: number): number {
    const { balls } = stepWorld([rollingBall(0, vec(-0.5, 0), vec(speed, 0))]);
    return (speed - len(balls[0]!.vel)) / TICK;
  }

  test('costs a fast ball ten times the rolling resistance', () => {
    expect(decelAt(2)).toBeCloseTo(ROLL_FAST_BOOST * plainDecel, 6);
  });

  /** The mirror of the knee's split: exact on both sides of the crossing. */
  test('splits a tick that straddles the step, rather than picking one rate', () => {
    const speed = ROLL_FAST_SPEED + (ROLL_FAST_BOOST * plainDecel * TICK) / 2;
    const { balls } = stepWorld([rollingBall(0, vec(-0.5, 0), vec(speed, 0))]);
    const expected = ROLL_FAST_SPEED - (plainDecel * TICK) / 2;
    expect(len(balls[0]!.vel)).toBeCloseTo(expected, 9);
  });

  /**
   * Above the step a free roll outruns this table on the normal cloth — any
   * rolling start past 1 m/s covers at least 2.3 m — so the one on-table probe
   * of the crossing is the slow cloth, where 1.05 m/s rolls out in 1.66 m.
   */
  test('and the simulation matches the closed form across the crossing', () => {
    const speed = 1.05;
    const start = vec(-0.9, 0);
    const { balls } = simulateToRest([rollingBall(0, start, vec(speed, 0))], { cloth: 'slow' });
    const travelled = balls[0]!.pos.x - start.x;
    const predicted = rollPhaseDistance(speed, clothRollingFriction('slow'));
    expect(Math.abs(travelled - predicted) / predicted).toBeLessThan(0.01);
  });
});

/**
 * Constructed fixtures. No shot in the app produces either state — a rail
 * leaves vel = -0.654v against roll = -0.117v, which is a skid rather than a
 * reversal; `release()` always launches at roll = 0; and a ball-ball impulse
 * does now torque both rolls, but only along the line of centres and only by
 * 2.5*mu, so the object ball leaves at roll = -0.15*vel — opposed to its
 * travel, and nowhere near the 40x reversal below. A sweep of 3780 generated
 * shots over every cloth and power finds not one difference across this change.
 * It is a latent defect and a prerequisite for tip offset, fixed on its own
 * terms.
 */
describe('a ball that is stationary but still spinning', () => {
  test('is carried back the way its spin points, not frozen where it stands', () => {
    const start = createBall(0, vec(0, 0), vec(0.025, 0), vec(-1, 0));
    const result = simulateToRest([start]);

    // (5v + 2r)/7 = -0.268 m/s of rolling speed has to go somewhere: 1.8 cm of
    // it spent slowing the creep forward, then 15.0 cm of roll back.
    expect(result.settled).toBe(true);
    expect(result.balls[0]!.pos.x).toBeCloseTo(-0.168, 2);
  });

  test('still runs on forward when the spin agrees with the motion', () => {
    const result = simulateToRest([createBall(0, vec(0, 0), vec(0.025, 0), vec(1, 0))]);
    expect(result.balls[0]!.pos.x).toBeCloseTo(0.220, 2);
  });

  test('is not called settled the tick its velocity passes through zero', () => {
    // One tick of sliding friction is exactly what this velocity is worth, so
    // the step lands on vel.x === 0 with roll.x still at -0.98.
    const start = createBall(0, vec(0, 0), vec(SLIDING_FRICTION * GRAVITY * TICK, 0), vec(-1, 0));
    const { balls } = stepWorld([start]);

    expect(balls[0]!.vel.x).toBe(0);
    expect(balls[0]!.roll.x).toBeLessThan(-0.9);
    expect(allAtRest(balls)).toBe(false);
  });
});

function expectFinite(v: Vec2): void {
  expect(Number.isFinite(v.x) && Number.isFinite(v.y)).toBe(true);
}
