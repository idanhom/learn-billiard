/**
 * The simulation.
 *
 * Fixed 1/240 s tick. Within a tick, velocities are constant and the solver
 * repeatedly finds the *earliest* impact among ball-ball, ball-cushion and
 * pocket candidates, advances to it, resolves it, and continues on the
 * remaining time. A ball is potted when its centre crosses a pocket's drop
 * line, at the back of the shelf, so a ball in the jaws can still meet a
 * facing first and rattle out. Ordering events by time of impact, rather than
 * resolving whatever a fixed sweep order happens to notice first, is what keeps
 * a fast ball from passing through a cushion nose or clipping a pocket it
 * should have dropped into.
 *
 * Friction is integrated once per tick, after the event loop. At 1/240 s the
 * velocity change inside a tick is under a centimetre per second, well below
 * anything the player can perceive or the geometry cares about.
 */

import {
  type ClothPreset,
  DEFAULT_CLOTH,
  GRAVITY,
  REST_SPEED,
  SLIDING_FRICTION,
  TERMINAL_ROLL_BOOST,
  TERMINAL_ROLL_SPEED,
  clothRollingFriction,
} from '../constants';
import {
  BALL_RADIUS,
  type PocketId,
  TABLE,
  capturingPocket,
  hasEscapedSurface,
  nearestPocket,
} from '../geometry/table';
import { IDENTITY, type Quat, spinBy } from '../geometry/quat';
import { ZERO, type Vec2, add, dot, len, normalize, scale, sub, vec } from '../geometry/vec2';
import {
  ballBallTOI,
  ballSegmentTOI,
  dropLineTOI,
  resolveBallPair,
  resolveCushion,
  separateOverlap,
} from './collision';

export const TICK = 1 / 240;

/** Ticks with everything stationary before a shot is called over. */
export const REST_DWELL_TICKS = 12;

/** Failsafe: no shot may run longer than this, however the cloth behaves. */
export const MAX_SHOT_DURATION = 20;

/**
 * Event-resolution passes allowed inside one tick, per ball on the table,
 * before the solver gives up and coasts.
 *
 * Per ball because a cluster passes a hit along one contact at a time: a line
 * of twelve touching balls needs a dozen events in a single tick, and a rack
 * fans one hit out into dozens. A flat budget of eight ran out, and the rest of
 * the tick ran with no collision checks at all. Coasting is still the last
 * resort, for a state no budget will ever clear, and that should not exist.
 */
const EVENT_ITERATIONS_PER_BALL = 16;

const TIME_EPSILON = 1e-12;
const BALL_DIAMETER = BALL_RADIUS * 2;

export interface Ball {
  readonly id: number;
  pos: Vec2;
  vel: Vec2;
  /** Surface roll velocity (r*omega). Slip at the contact point is `vel - roll`. */
  roll: Vec2;
  /**
   * Orientation in the table frame. Integrated from `roll`, and read by nothing
   * in this solver — it exists so the renderer can show the slide-to-roll
   * transition the rest of this file already computes. Simulation state rather
   * than renderer state because the physics ticks are fixed: orientation
   * accumulated per frame would depend on frame rate and on the time scale.
   */
  spin: Quat;
  potted: boolean;
  pocket?: PocketId;
}

/**
 * What happened during a step, and when. `speed` is how hard: for a contact,
 * the speed of approach along the normal just before it (the speed at impact
 * that `CLAUDE.md` asks collision tests to measure against); for a pocket, the
 * ball's speed as it drops. It describes the event and drives nothing.
 */
export type SimEvent =
  | { readonly type: 'ball-ball'; readonly time: number; readonly a: number; readonly b: number; readonly speed: number }
  | { readonly type: 'cushion'; readonly time: number; readonly ball: number; readonly speed: number }
  | {
      readonly type: 'pocket';
      readonly time: number;
      readonly ball: number;
      readonly pocket: PocketId;
      readonly speed: number;
    };

export interface StepResult {
  readonly balls: Ball[];
  /** Times are relative to the start of this step. */
  readonly events: SimEvent[];
}

export interface SimulateOptions {
  readonly dt?: number;
  readonly maxDuration?: number;
  readonly dwellTicks?: number;
  /** Cloth to play on. Passed, never read from a module global — the tests rely
   * on this simulation being a pure function of its inputs. */
  readonly cloth?: ClothPreset;
  readonly onTick?: (time: number, balls: readonly Ball[]) => void;
}

export interface SimulateResult {
  readonly balls: Ball[];
  readonly events: SimEvent[];
  readonly duration: number;
  /** False when the failsafe duration cut the shot off before everything stopped. */
  readonly settled: boolean;
}

/** A ball is launched sliding: the cue gives it speed, not roll. */
export function createBall(id: number, pos: Vec2, vel: Vec2 = ZERO, roll: Vec2 = ZERO): Ball {
  return { id, pos, vel, roll, spin: IDENTITY, potted: false };
}

export function cloneBall(ball: Ball): Ball {
  const copy: Ball = {
    id: ball.id,
    pos: ball.pos,
    vel: ball.vel,
    roll: ball.roll,
    spin: ball.spin,
    potted: ball.potted,
  };
  if (ball.pocket !== undefined) copy.pocket = ball.pocket;
  return copy;
}

/**
 * A shot is over when nothing is moving AND nothing is still spinning.
 *
 * Velocity alone is not enough: a ball whose centre velocity passes through
 * zero while it still carries roll is mid-reversal, not stopped, and the cloth
 * is about to send it back the other way. That state is one tick away from
 * reachable — vel.x = SLIDING_FRICTION * GRAVITY * TICK with roll.x = -1 steps
 * to exactly vel.x = 0 with roll.x = -0.98 — and calling the shot there would
 * settle it in the middle of the move.
 *
 * No hang: once the slip closes `applyFriction` sets roll = vel, so the two
 * reach zero together, and REST_DWELL_TICKS / MAX_SHOT_DURATION still backstop.
 */
export function allAtRest(balls: readonly Ball[]): boolean {
  return balls.every(
    (b) => b.potted || (b.vel.x === 0 && b.vel.y === 0 && b.roll.x === 0 && b.roll.y === 0),
  );
}

interface Candidate {
  readonly time: number;
  readonly apply: (balls: Ball[], at: number, events: SimEvent[]) => void;
}

export function stepWorld(
  balls: readonly Ball[],
  dt: number = TICK,
  cloth: ClothPreset = DEFAULT_CLOTH,
): StepResult {
  const work = balls.map(cloneBall);
  const events: SimEvent[] = [];

  separateInitialOverlaps(work);

  let remaining = dt;
  let elapsed = 0;
  const budget = EVENT_ITERATIONS_PER_BALL * work.length;
  for (let i = 0; i < budget && remaining > TIME_EPSILON; i++) {
    const next = earliestCandidate(work, remaining);
    if (!next) break;
    advance(work, next.time);
    elapsed += next.time;
    remaining -= next.time;
    next.apply(work, elapsed, events);
  }
  if (remaining > TIME_EPSILON) {
    advance(work, remaining);
    elapsed += remaining;
  }

  captureEscapees(work, elapsed, events);

  const rollingFriction = clothRollingFriction(cloth);
  for (const ball of work) {
    if (!ball.potted) applyFriction(ball, dt, rollingFriction);
  }

  return { balls: work, events };
}

export function simulateToRest(
  balls: readonly Ball[],
  options: SimulateOptions = {},
): SimulateResult {
  const dt = options.dt ?? TICK;
  const maxDuration = options.maxDuration ?? MAX_SHOT_DURATION;
  const dwellTicks = options.dwellTicks ?? REST_DWELL_TICKS;
  const cloth = options.cloth ?? DEFAULT_CLOTH;

  let current = balls.map(cloneBall);
  const events: SimEvent[] = [];
  let time = 0;
  let dwell = 0;

  while (time < maxDuration - TIME_EPSILON) {
    const step = stepWorld(current, dt, cloth);
    current = step.balls;
    for (const event of step.events) {
      events.push({ ...event, time: event.time + time });
    }
    time += dt;
    options.onTick?.(time, current);

    dwell = allAtRest(current) ? dwell + 1 : 0;
    if (dwell >= dwellTicks) {
      return { balls: current, events, duration: time, settled: true };
    }
  }

  return { balls: current, events, duration: time, settled: false };
}

/**
 * Move time forward by `dt` with velocities held constant.
 *
 * Called once per sub-interval between events, not once per tick, so a ball
 * that meets a rail mid-tick turns through its old roll up to the contact and
 * its new roll after it — which is the skid a rail leaves behind, made visible.
 */
function advance(balls: Ball[], dt: number): void {
  for (const ball of balls) {
    if (ball.potted) continue;
    ball.pos = add(ball.pos, scale(ball.vel, dt));
    ball.spin = spinBy(ball.spin, ball.roll, BALL_RADIUS, dt);
  }
}

function separateInitialOverlaps(balls: Ball[]): void {
  for (let i = 0; i < balls.length; i++) {
    for (let j = i + 1; j < balls.length; j++) {
      const a = balls[i]!;
      const b = balls[j]!;
      if (a.potted || b.potted) continue;
      const fixed = separateOverlap(a.pos, b.pos, BALL_DIAMETER);
      if (!fixed) continue;
      a.pos = fixed.posA;
      b.pos = fixed.posB;
    }
  }
}

function earliestCandidate(balls: Ball[], remaining: number): Candidate | undefined {
  let best: Candidate | undefined;
  const take = (candidate: Candidate | undefined): void => {
    if (candidate && (!best || candidate.time < best.time)) best = candidate;
  };

  for (let i = 0; i < balls.length; i++) {
    const a = balls[i]!;
    if (a.potted) continue;
    const aMoving = a.vel.x !== 0 || a.vel.y !== 0;

    for (let j = i + 1; j < balls.length; j++) {
      const b = balls[j]!;
      if (b.potted) continue;
      if (!aMoving && b.vel.x === 0 && b.vel.y === 0) continue;
      const time = ballBallTOI(a.pos, a.vel, b.pos, b.vel, BALL_DIAMETER, remaining);
      if (time === undefined) continue;
      take({
        time,
        apply: (world, at, events) => {
          const x = world[i]!;
          const y = world[j]!;
          const speed = dot(sub(x.vel, y.vel), normalize(sub(y.pos, x.pos)));
          const impulse = resolveBallPair(x.pos, x.vel, x.roll, y.pos, y.vel, y.roll);
          if (!impulse) return;
          x.vel = impulse.velA;
          y.vel = impulse.velB;
          // Contact friction gears the two together: a rolling cue ball hands
          // over some of its topspin as BACKSPIN, which both shortens its own
          // follow and makes the object ball skid before it rolls.
          x.roll = impulse.rollA;
          y.roll = impulse.rollB;
          events.push({ type: 'ball-ball', time: at, a: x.id, b: y.id, speed });
        },
      });
    }

    if (!aMoving) continue;

    for (const segment of TABLE.cushions) {
      const hit = ballSegmentTOI(a.pos, a.vel, segment, BALL_RADIUS, remaining);
      if (!hit) continue;
      take({
        time: hit.time,
        apply: (world, at, events) => {
          const ball = world[i]!;
          const speed = -dot(ball.vel, hit.normal);
          const bounced = resolveCushion(ball.vel, ball.roll, hit.normal);
          if (!bounced) return;
          // The roll is NOT reflected. A ball comes off a rail still spinning
          // the way it was going, which fights its new direction until the
          // cloth resolves it — that skid is most of what a rail costs a ball,
          // and applyFriction below produces it for free.
          ball.vel = bounced.vel;
          ball.roll = bounced.roll;
          events.push({ type: 'cushion', time: at, ball: ball.id, speed });
        },
      });
    }

    for (const pocket of TABLE.pockets) {
      const time = dropLineTOI(a.pos, a.vel, pocket.drop, remaining);
      if (time === undefined) continue;
      take({
        time,
        apply: (world, at, events) => {
          const ball = world[i]!;
          if (ball.potted) return;
          const speed = len(ball.vel);
          pot(ball, pocket.id);
          events.push({ type: 'pocket', time: at, ball: ball.id, pocket: pocket.id, speed });
        },
      });
    }
  }

  return best;
}

/**
 * Failsafe for a ball that slipped off the slate without its centre ever
 * crossing a drop line. Nothing is ever lost off-table.
 */
function captureEscapees(balls: Ball[], at: number, events: SimEvent[]): void {
  for (const ball of balls) {
    if (ball.potted) continue;
    const pocket = capturingPocket(ball.pos) ?? (hasEscapedSurface(ball.pos) ? nearestPocket(ball.pos) : undefined);
    if (!pocket) continue;
    const speed = len(ball.vel);
    pot(ball, pocket.id);
    events.push({ type: 'pocket', time: at, ball: ball.id, pocket: pocket.id, speed });
  }
}

function pot(ball: Ball, pocket: PocketId): void {
  ball.potted = true;
  ball.pocket = pocket;
  ball.vel = ZERO;
  ball.roll = ZERO;
}

/**
 * Cloth friction over one tick.
 *
 * While the contact point slips, the ball sheds speed at mu_s*g and spins up at
 * (5/2)*mu_s*g, so the slip closes at (7/2)*mu_s*g. The instant it closes the
 * ball is rolling — velocity and roll are then locked together and decay under
 * rolling resistance alone. This is what gives a struck ball its natural
 * follow, and it is why there is no static 90-degree tangent guide: the cue
 * ball does not leave along the tangent, so drawing that line would teach the
 * player something the simulation contradicts.
 */
function applyFriction(ball: Ball, dt: number, rollingFriction: number): void {
  let remaining = dt;

  const slip = sub(ball.vel, ball.roll);
  const slipSpeed = len(slip);
  if (slipSpeed > 0) {
    const closingRate = 3.5 * SLIDING_FRICTION * GRAVITY;
    const timeToRoll = slipSpeed / closingRate;
    const t = Math.min(timeToRoll, remaining);
    const direction = scale(slip, 1 / slipSpeed);
    ball.vel = add(ball.vel, scale(direction, -SLIDING_FRICTION * GRAVITY * t));
    ball.roll = add(ball.roll, scale(direction, 2.5 * SLIDING_FRICTION * GRAVITY * t));
    remaining -= t;
    if (timeToRoll <= dt) ball.roll = ball.vel; // exact at the transition
  }

  if (remaining > 0) {
    const speed = len(ball.vel);
    if (speed > 0) {
      const next = rolledDown(speed, remaining, rollingFriction);
      ball.vel = next === 0 ? ZERO : scale(ball.vel, next / speed);
    }
    ball.roll = ball.vel;
  }

  // Both, not just the centre velocity. A ball creeping forward at 0.025 m/s
  // with roll at -1.0 has a rolling speed of (5v + 2r)/7 = -0.27 m/s and is
  // about to come back 17 cm; clamping on velocity alone would delete the spin
  // and freeze it where it stands.
  if (len(ball.vel) < REST_SPEED && len(ball.roll) < REST_SPEED) {
    ball.vel = ZERO;
    ball.roll = ZERO;
  }
}

/**
 * Speed left after `dt` of rolling resistance.
 *
 * Two rungs rather than one constant. Above `TERMINAL_ROLL_SPEED` it is the
 * plain coefficient, which is what every calibration in `src/constants.ts` was
 * measured in. Below it the cloth takes `TERMINAL_ROLL_BOOST` times as much, so
 * a ball that has nearly run out dies instead of trailing off.
 *
 * The crossing is split exactly rather than integrated at whichever rung the
 * tick started on, so the result does not depend on the tick length —
 * `src/geometry/shot.ts` inverts this analytically and the two have to agree to
 * better than the 1% the tests hold them to.
 *
 * The boost is unpublished, unlike everything around it. See the constants.
 */
function rolledDown(speed: number, dt: number, rollingFriction: number): number {
  const decel = rollingFriction * GRAVITY;
  let left = speed;
  let time = dt;

  if (left > TERMINAL_ROLL_SPEED) {
    const toKnee = (left - TERMINAL_ROLL_SPEED) / decel;
    if (toKnee >= time) return left - decel * time;
    left = TERMINAL_ROLL_SPEED;
    time -= toKnee;
  }

  return Math.max(0, left - decel * TERMINAL_ROLL_BOOST * time);
}

/** Convenience for callers that only need a snapshot of positions. */
export function positionsOf(balls: readonly Ball[]): Vec2[] {
  return balls.map((b) => vec(b.pos.x, b.pos.y));
}
