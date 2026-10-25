/**
 * Where the cue ball goes: drills for the 90° and 30° rules.
 *
 * The shot is aimed and struck for the player, so the drill is only about the
 * cue ball: stunned, so it meets the object ball with no roll, or rolling. The
 * player says beforehand where it will go, by clicking on its path from the
 * ghost ball, and is scored on the angle between that and where it went.
 */

import { type ClothPreset, GRAVITY, MAX_TIP_OFFSET, SLIDING_FRICTION } from '../constants';
import { type Vec2, dist, len, normalize, perp, rotate, scale, signedAngleBetween, sub } from '../geometry/vec2';
import { type Ball, TICK, stepWorld } from '../physics/world';

export type Stroke = 'stun' | 'roll';

/** How fast the cue ball meets the object ball in these drills, in m/s. */
export const DEPARTURE_ARRIVAL = 1.2;

/** Struck 0.4 of the radius above centre, a ball rolls from the start: 2.5 x 0.4 = 1. */
export const ROLL_TIP = 0.4;

/** A click this close to the ghost ball gives no direction. */
const NEAREST_PREDICTION = 0.02;

/** Clear table a layout leaves along the rule's line from the ghost ball, so the cue ball can run it out. */
export const DEPARTURE_ROOM = 0.35;

/**
 * The line the rule gives, from the ghost ball: square to the line of
 * centres when stunned, 30° off the cue ball's own line when rolling, either
 * way on the side away from the object ball.
 */
export function ruleDirection(stroke: Stroke, cue: Vec2, ghost: Vec2, object: Vec2): Vec2 {
  const aim = normalize(sub(ghost, cue));
  const centres = normalize(sub(object, ghost));
  // Positive when the object ball goes off to the left of the cue ball's line.
  const objectLeft = aim.x * centres.y - aim.y * centres.x >= 0;
  if (stroke === 'roll') return rotate(aim, ((objectLeft ? -30 : 30) * Math.PI) / 180);
  const square = perp(centres);
  return objectLeft ? scale(square, -1) : square;
}

export interface Strike {
  /** The cue ball's speed off the tip, in m/s. */
  readonly speed: number;
  /** Where the tip strikes, up from centre as a fraction of the radius. */
  readonly tip: number;
}

/**
 * The stroke for a drill with `distance` from the cue ball to contact.
 * Stunned: enough backspin that the cloth has just taken it all off at
 * contact, the ball sliding all the way and arriving at the drill's speed.
 * Rolling: a tip at 0.4 R, and the speed the cloth's rolling resistance
 * leaves at the drill's speed by contact.
 */
export function strikeFor(stroke: Stroke, distance: number, rollingFriction: number): Strike {
  if (stroke === 'roll') {
    return { speed: Math.sqrt(DEPARTURE_ARRIVAL ** 2 + 2 * rollingFriction * GRAVITY * distance), tip: ROLL_TIP };
  }
  const slide = SLIDING_FRICTION * GRAVITY;
  const speed = Math.sqrt(DEPARTURE_ARRIVAL ** 2 + 2 * slide * distance);
  // Backspin of 2.5 (b/R) v at the tip, which the cloth takes off at 2.5 mu g
  // while the ball slows at mu g: all of it gone in the time the slide takes.
  const seconds = (speed - DEPARTURE_ARRIVAL) / slide;
  return { speed, tip: Math.max(-MAX_TIP_OFFSET, -(slide * seconds) / speed) };
}

/**
 * Which way the cue ball went, from the balls just after it met the object
 * ball. Stunned, the way it left. Rolling, the way it ran once the cloth had
 * straightened its curve, which is the line the 30° rule describes; if it
 * reaches a cushion or a pocket first, the way it was heading then.
 */
export function departureOf(afterContact: readonly Ball[], stroke: Stroke, cloth: ClothPreset): Vec2 | undefined {
  const cue = afterContact[0];
  if (!cue || len(cue.vel) === 0) return undefined;
  if (stroke === 'stun') return normalize(cue.vel);

  let balls: Ball[] = [{ ...cue }];
  for (let tick = 0; tick < 240 * 10; tick++) {
    const before = balls[0]!;
    const step = stepWorld(balls, TICK, cloth);
    balls = step.balls;
    const ball = balls[0]!;
    if (step.events.length > 0) return len(before.vel) > 0 ? normalize(before.vel) : undefined;
    if (len(ball.vel) === 0) return normalize(before.vel);
    if (len(sub(ball.vel, ball.roll)) < 1e-9) return normalize(ball.vel);
  }
  return len(balls[0]!.vel) > 0 ? normalize(balls[0]!.vel) : undefined;
}

export interface DepartureResult {
  /** How far the predicted line was from where the cue ball went, in degrees. */
  readonly error: number;
  /** The rule's own angle, as it came out: off the object ball's line when stunned, off its own line when rolling. */
  readonly ruleAngle: number;
  readonly correct: boolean;
}

export class DepartureDrill {
  readonly stroke: Stroke;
  readonly #from: Vec2;
  readonly #allowance: number;
  #predicted: Vec2 | undefined;
  #result: DepartureResult | undefined;

  /** `from` is the ghost ball, where the cue ball is at contact; `allowance` in degrees. */
  constructor(stroke: Stroke, from: Vec2, allowance: number) {
    this.stroke = stroke;
    this.#from = from;
    this.#allowance = allowance;
  }

  /** The direction the player said, once they have. */
  get predicted(): Vec2 | undefined {
    return this.#predicted;
  }

  get result(): DepartureResult | undefined {
    return this.#result;
  }

  /** The player says the cue ball goes through `point`. Only once, and not on the ghost ball itself. */
  predict(point: Vec2): Vec2 | undefined {
    if (this.#predicted || dist(point, this.#from) < NEAREST_PREDICTION) return undefined;
    this.#predicted = normalize(sub(point, this.#from));
    return this.#predicted;
  }

  /** Where it went, against what was said. Only once, after a prediction. */
  score(actual: Vec2, ruleAngle: number): DepartureResult | undefined {
    if (!this.#predicted || this.#result) return undefined;
    const error = (Math.abs(signedAngleBetween(this.#predicted, actual)) * 180) / Math.PI;
    this.#result = { error, ruleAngle, correct: error <= this.#allowance };
    return this.#result;
  }
}
