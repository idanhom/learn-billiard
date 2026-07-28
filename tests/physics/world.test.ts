import { describe, expect, test } from 'vitest';
import { CUSHION_RESTITUTION, CUSHION_TANGENT_RETENTION, MAX_CUE_SPEED } from '../../src/constants';
import { stoppingDistance } from '../../src/geometry/shot';
import { BALL_RADIUS, TABLE, isInLegalBounds, pocketById } from '../../src/geometry/table';
import { type Vec2, fromAngle, len, sub, vec } from '../../src/geometry/vec2';
import {
  TICK,
  type Ball,
  allAtRest,
  createBall,
  simulateToRest,
  stepWorld,
} from '../../src/physics/world';

/** Deterministic pseudo-random source so property sweeps are reproducible. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
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
  test('reverse and damp the normal component, retaining most of the tangential', () => {
    const { balls, before } = stepUntil(
      [createBall(0, vec(0, 0), vec(1, 2))],
      (events) => events.some((e) => e.type === 'cushion'),
    );
    const inbound = before[0]!.vel;
    const outbound = balls[0]!.vel;
    // `inbound` is sampled a tick early, so allow one tick of cloth friction.
    const tickFriction = 0.01;
    expect(Math.abs(outbound.y - -CUSHION_RESTITUTION * inbound.y)).toBeLessThan(tickFriction);
    expect(Math.abs(outbound.x - CUSHION_TANGENT_RETENTION * inbound.x)).toBeLessThan(tickFriction);
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
    const cue = createBall(0, vec(0, 0.2), vec(0, 1.2));
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
    // Almost stopped by the collision, but still carrying its roll.
    expect(atImpact[0]!.vel.x).toBeLessThan(0.1);
    expect(atImpact[0]!.roll.x).toBeGreaterThan(0.4);

    const result = simulateToRest(atImpact);
    // The roll drives it forward again — this is why there is no tangent guide.
    expect(result.balls[0]!.pos.x).toBeGreaterThan(atImpact[0]!.pos.x + 0.01);
    expect(result.balls[1]!.pos.x).toBeGreaterThan(result.balls[0]!.pos.x + 0.5);
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

function expectFinite(v: Vec2): void {
  expect(Number.isFinite(v.x) && Number.isFinite(v.y)).toBe(true);
}
