/**
 * The shot lifecycle.
 *
 *   aiming -> charging -> simulating -> settled -> evaluated
 *
 * Every shot carries an id, and evaluation is a guarded one-shot transition:
 * whatever the UI does, a shot is scored exactly once and progress is only ever
 * written after that. Commands are legal in specific phases only, so a stray
 * key during the roll-out cannot restrike or re-aim.
 */

import { type ClothPreset, DEFAULT_CLOTH, clothRollingFriction } from '../constants';
import {
  type AimError,
  type CutSide,
  type ShotAnalysis,
  aimErrorAt,
  analyseShot,
  objectDeparture,
} from '../geometry/shot';
import { type PocketId, pocketById } from '../geometry/table';
import { type Vec2, dist, fromAngle, signedAngleBetween, vec } from '../geometry/vec2';
import {
  MAX_SHOT_DURATION,
  REST_DWELL_TICKS,
  TICK,
  type Ball,
  type SimEvent,
  allAtRest,
  cloneBall,
  createBall,
  stepWorld,
} from '../physics/world';
import { type ShotLayout, aimTarget, startingAimAngle } from './drills';
import { potWindow } from './pot-window';
import { cueSpeedForPower, recommendedPower as recommendedPowerFor } from './power';

export type ShotPhase = 'aiming' | 'charging' | 'simulating' | 'settled' | 'evaluated';

export const CUE_BALL_ID = 0;
export const OBJECT_BALL_ID = 1;

/** Longest frame the loop will honour; anything worse is treated as a stall. */
export const MAX_FRAME_DT = 0.1;
/** Physics ticks one frame may run, so a slow frame cannot spiral. */
export const MAX_CATCHUP_TICKS = 30;

/**
 * How much faster a shot plays once the object ball's part in it is over: it
 * has been struck, and it is down or has stopped. Off a thin cut the cue ball
 * keeps nearly all its speed and runs on for seconds and two or three rails
 * after that, which is the part nobody is waiting to see. The ticks are the
 * same ticks, so it is the same shot — only the wall clock changes — and if
 * the cue ball comes back and sets the object ball moving again, the pace
 * drops back to normal with it.
 */
export const FAST_FORWARD = 4;

export interface ShotSessionOptions {
  /** How much of the pot window a qualifying shot may use, as in `LevelDefinition`. */
  readonly pocketAllowance?: number;
  readonly cloth?: ClothPreset;
  /**
   * Seeds where the cue starts, off the ideal line. Move it on for every
   * session dealt — a retry included — and each one starts somewhere new.
   */
  readonly aimSeed?: number;
}

export interface ShotOutcome {
  readonly shotId: string;
  readonly aimError: AimError;
  readonly cutAngle: number;
  readonly cutSide: CutSide;
  readonly pocketAllowance: number;
  /**
   * How much of the pot window the aim used, on the side the object ball went:
   * 0 is the ideal line, 1 the edge of what would still have dropped. Judged
   * at the stroke the ideal line assumes, so it measures the aim and not the
   * power. Null when the object ball was never struck, or nothing would drop.
   */
  readonly pocketUsed: number | null;
  /** Drives progression: struck the object ball, using no more of the pocket than allowed. */
  readonly qualifying: boolean;
  readonly contacted: boolean;
  readonly pottedTarget: boolean;
  readonly pottedWrong: boolean;
  readonly objectPocket?: PocketId;
  /** Cue ball potted. Flagged, but the shot is still scored on its aim. */
  readonly scratch: boolean;
  /**
   * Closest the object-ball centre came to the target pocket's capture centre,
   * or null when the object ball was never struck.
   */
  readonly missDistance: number | null;
  readonly duration: number;
  readonly settled: boolean;
}

export class ShotSession {
  readonly layout: ShotLayout;
  readonly pocketAllowance: number;

  #phase: ShotPhase = 'aiming';
  #aimAngle: number;
  #power = 0;
  #balls: Ball[];
  #previousBalls: Ball[];
  #accumulator = 0;
  #elapsed = 0;
  #dwell = 0;
  #contacted = false;
  #minDistanceToTarget = Number.POSITIVE_INFINITY;
  #events: SimEvent[] = [];
  #outcome: ShotOutcome | undefined;
  #settled = false;
  #cloth: ClothPreset;
  readonly #target: Vec2;
  #analysis: ShotAnalysis | undefined;

  constructor(layout: ShotLayout, options: ShotSessionOptions = {}) {
    this.layout = layout;
    this.#target = aimTarget(layout);
    this.pocketAllowance = options.pocketAllowance ?? 1;
    this.#cloth = options.cloth ?? DEFAULT_CLOTH;
    this.#aimAngle = startingAimAngle(layout, options.aimSeed ?? 0);
    this.#balls = [
      createBall(CUE_BALL_ID, layout.cue),
      createBall(OBJECT_BALL_ID, layout.object),
      ...(layout.obstacles ?? []).map((p, i) => createBall(OBJECT_BALL_ID + 1 + i, p)),
    ];
    this.#previousBalls = this.#balls.map(cloneBall);
  }

  get phase(): ShotPhase {
    return this.#phase;
  }

  get cloth(): ClothPreset {
    return this.#cloth;
  }

  /**
   * Change the cloth under the current shot. Allowed while lining up so the
   * shot you fire is played on the cloth you can see named; refused once the
   * balls are moving, because changing the table mid-roll is not a thing.
   */
  setCloth(cloth: ClothPreset): boolean {
    if (this.#phase !== 'aiming' && this.#phase !== 'charging') return false;
    this.#cloth = cloth;
    this.#analysis = undefined;
    return true;
  }

  get aimAngle(): number {
    return this.#aimAngle;
  }

  get power(): number {
    return this.#power;
  }

  /** What the meter is charged to, in metres per second. */
  get cueSpeed(): number {
    return cueSpeedForPower(this.#power);
  }

  /**
   * Meter reading that would leave the object ball dying in the pocket, or
   * null when no legal stroke will do it. Judged on the cloth in play, since
   * it is advice about this table rather than about the layout.
   */
  get recommendedPower(): number | null {
    return recommendedPowerFor(this.analysis, clothRollingFriction(this.#cloth));
  }

  get balls(): readonly Ball[] {
    return this.#balls;
  }

  /** Ball states one physics tick ago, for render interpolation. */
  get previousBalls(): readonly Ball[] {
    return this.#previousBalls;
  }

  /** Fraction of a tick rendered since the last physics state, in [0, 1). */
  get alpha(): number {
    return this.#accumulator / TICK;
  }

  get elapsed(): number {
    return this.#elapsed;
  }

  get events(): readonly SimEvent[] {
    return this.#events;
  }

  get outcome(): ShotOutcome | undefined {
    return this.#outcome;
  }

  get cueBall(): Ball {
    return this.#balls[0]!;
  }

  get objectBall(): Ball {
    return this.#balls[1]!;
  }

  /** The object ball has been struck, and is now down or stopped. */
  get objectBallDone(): boolean {
    const ball = this.objectBall;
    return (
      this.#contacted &&
      (ball.potted || (ball.vel.x === 0 && ball.vel.y === 0 && ball.roll.x === 0 && ball.roll.y === 0))
    );
  }

  /** Where the object ball is aimed: the middle of its pocket's clean band. */
  get target(): Vec2 {
    return this.#target;
  }

  /**
   * The teaching geometry for this layout: ghost ball, cut angle, reachability.
   * On the cloth in play, which sets the stroke and so the throw the ghost ball
   * allows for.
   */
  get analysis(): ShotAnalysis {
    this.#analysis ??= analyseShot({
      cue: this.layout.cue,
      object: this.layout.object,
      pocket: pocketById(this.layout.targetPocket),
      obstacles: this.layout.obstacles ?? [],
      rollingFriction: clothRollingFriction(this.#cloth),
    });
    return this.#analysis;
  }

  aimTo(angle: number): boolean {
    if (this.#phase !== 'aiming' && this.#phase !== 'charging') return false;
    this.#aimAngle = angle;
    return true;
  }

  nudgeAim(delta: number): boolean {
    return this.aimTo(this.#aimAngle + delta);
  }

  beginCharge(): boolean {
    if (this.#phase !== 'aiming') return false;
    this.#phase = 'charging';
    this.#power = 0;
    return true;
  }

  setPower(power: number): boolean {
    if (this.#phase !== 'charging') return false;
    this.#power = Math.min(1, Math.max(0, power));
    return true;
  }

  /** A lost focus or cancelled pointer aborts the charge rather than firing it. */
  cancelCharge(): boolean {
    if (this.#phase !== 'charging') return false;
    this.#phase = 'aiming';
    this.#power = 0;
    return true;
  }

  release(): boolean {
    if (this.#phase !== 'charging') return false;
    // A cue strike is a pure slide: speed, and no roll of its own.
    this.cueBall.vel = fromAngle(this.#aimAngle, this.cueSpeed);
    this.cueBall.roll = vec(0, 0);
    this.#phase = 'simulating';
    this.#recordMissDistance();
    return true;
  }

  /** Run the physics forward by one rendered frame. */
  advance(frameSeconds: number): void {
    if (this.#phase !== 'simulating') return;

    const pace = this.objectBallDone ? FAST_FORWARD : 1;
    this.#accumulator += Math.min(frameSeconds, MAX_FRAME_DT) * pace;
    let ticks = 0;
    while (this.#accumulator >= TICK && ticks < MAX_CATCHUP_TICKS) {
      this.#previousBalls = this.#balls.map(cloneBall);
      const step = stepWorld(this.#balls, TICK, this.#cloth);
      this.#balls = step.balls;
      for (const event of step.events) {
        this.#events.push({ ...event, time: event.time + this.#elapsed });
        if (
          event.type === 'ball-ball' &&
          ((event.a === CUE_BALL_ID && event.b === OBJECT_BALL_ID) ||
            (event.a === OBJECT_BALL_ID && event.b === CUE_BALL_ID))
        ) {
          this.#contacted = true;
        }
      }
      this.#elapsed += TICK;
      this.#accumulator -= TICK;
      ticks++;
      this.#recordMissDistance();

      this.#dwell = allAtRest(this.#balls) ? this.#dwell + 1 : 0;
      if (this.#dwell >= REST_DWELL_TICKS) {
        this.#settle(true);
        return;
      }
      if (this.#elapsed >= MAX_SHOT_DURATION) {
        this.#settle(false);
        return;
      }
    }
    // Anything left in the accumulator beyond the catch-up budget is dropped.
    if (ticks >= MAX_CATCHUP_TICKS) this.#accumulator = 0;
  }

  /**
   * Score the shot. Legal only from `settled`, and only once: a second call
   * returns undefined and leaves the recorded outcome alone.
   */
  evaluate(): ShotOutcome | undefined {
    if (this.#phase !== 'settled') return undefined;
    this.#phase = 'evaluated';

    const analysis = this.analysis;
    const aim = fromAngle(this.#aimAngle);
    const error = aimErrorAt(this.layout.cue, this.layout.object, analysis.ghostCenter, aim);
    const pocketUsed = this.#contacted ? this.#pocketUsed(analysis, aim) : null;
    const objectPocket = this.objectBall.potted ? this.objectBall.pocket : undefined;

    this.#outcome = {
      shotId: this.layout.id,
      aimError: error,
      cutAngle: analysis.cutAngle,
      cutSide: analysis.cutSide,
      pocketAllowance: this.pocketAllowance,
      pocketUsed,
      qualifying: pocketUsed !== null && pocketUsed <= this.pocketAllowance,
      contacted: this.#contacted,
      pottedTarget: objectPocket === this.layout.targetPocket,
      pottedWrong: objectPocket !== undefined && objectPocket !== this.layout.targetPocket,
      ...(objectPocket !== undefined ? { objectPocket } : {}),
      scratch: this.cueBall.potted,
      missDistance: this.#contacted ? this.#minDistanceToTarget : null,
      duration: this.#elapsed,
      settled: this.#settled,
    };
    return this.#outcome;
  }

  /**
   * The share of the pot window this aim used: where the object ball would
   * leave, sent along it at the stroke the ideal line assumes, against how far
   * it could go that way and still drop.
   */
  #pocketUsed(analysis: ShotAnalysis, aim: Vec2): number | null {
    const window = potWindow(this.layout, this.#cloth, analysis);
    if (!window) return null;
    const { cue, object } = this.layout;
    const departure = objectDeparture(cue, object, aim, analysis.launchSpeed, clothRollingFriction(this.#cloth));
    if (departure === undefined) return null;
    const turned = signedAngleBetween(fromAngle(window.ideal), fromAngle(departure));
    return Math.abs(turned) / (turned >= 0 ? window.counterClockwise : window.clockwise);
  }

  #settle(settled: boolean): void {
    this.#settled = settled;
    this.#phase = 'settled';
    this.#accumulator = 0;
  }

  #recordMissDistance(): void {
    const d = dist(this.objectBall.pos, this.#target);
    if (d < this.#minDistanceToTarget) this.#minDistanceToTarget = d;
  }
}
