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

import { type ClothPreset, DEFAULT_CLOTH, MAX_TIP_OFFSET, clothRollingFriction } from '../constants';
import { type FractionName, nearestFraction } from '../geometry/fractions';
import {
  type AimError,
  type CutSide,
  type ShotAnalysis,
  aimErrorAt,
  analyseShot,
  firstTouch,
  fullness,
  objectDeparture,
} from '../geometry/shot';
import { type PocketId, isOnShelf, nearestPocket, pocketById } from '../geometry/table';
import { type Vec2, dist, fromAngle, scale, signedAngleBetween } from '../geometry/vec2';
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

/** Ticks between the points of a ball's trail: 60 a second. Every contact adds one as well. */
const TRAIL_EVERY = 4;
/** A ball that has moved less than this since its last point adds no new one. */
const TRAIL_STEP = 0.002;

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

/**
 * What the object ball did, in table terms. Rattled means it got into the
 * target's jaws and did not drop; hung, that it stopped on the shelf. Short
 * and wide are both misses short of the jaws, told apart by the line it left
 * on: short was going in and ran out of pace, wide was never going in. Both
 * carry a distance, in metres: short, how far it stopped from where it would
 * have dropped; wide, how far outside what would have dropped it went, out
 * at the pocket.
 */
export type ShotResult =
  | { readonly kind: 'potted' }
  | { readonly kind: 'wrong-pocket'; readonly pocket: PocketId }
  | { readonly kind: 'rattled'; readonly hung: boolean }
  | { readonly kind: 'short'; readonly by: number }
  | { readonly kind: 'wide'; readonly by: number }
  | { readonly kind: 'no-contact' };

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
  readonly result: ShotResult;
  /** Fraction of the object ball the cue ball covered at contact: 1 is full, 0 an edge. Null with no contact. */
  readonly fullnessHit: number | null;
  /** The fraction the ideal line covers, throw allowed for. */
  readonly fullnessNeeded: number;
  /** The fraction the player called before the shot, if they did. */
  readonly call: FractionName | null;
  /** The reference fraction nearest what the shot needed: the right call. */
  readonly needed: FractionName;
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
  /** The object ball has been in the target's jaws. */
  #inJaws = false;
  #call: FractionName | null = null;
  /** Where each ball has been since the stroke: the post-shot diagram. */
  #trails: Vec2[][] = [];
  /** Where the tip strikes, up the ball from centre as a fraction of its radius. */
  #tip = 0;
  /** The balls just after the cue ball first met the object ball. */
  #afterContact: Ball[] | undefined;

  constructor(layout: ShotLayout, options: ShotSessionOptions = {}) {
    this.layout = layout;
    this.#target = aimTarget(layout);
    this.pocketAllowance = options.pocketAllowance ?? 1;
    this.#cloth = options.cloth ?? DEFAULT_CLOTH;
    this.#aimAngle = startingAimAngle(layout, options.aimSeed ?? 0);
    this.#balls = [
      createBall(CUE_BALL_ID, layout.cue),
      // Out of play is potted from the start: the solver and the scene both pass it by.
      { ...createBall(OBJECT_BALL_ID, layout.object), potted: layout.objectAway === true },
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

  /** The fraction called for this shot, or null. */
  get call(): FractionName | null {
    return this.#call;
  }

  /** Call the fraction the shot needs, or take a call back with null. Only before the shot. */
  callFraction(fraction: FractionName | null): boolean {
    if (this.#phase !== 'aiming' && this.#phase !== 'charging') return false;
    this.#call = fraction;
    return true;
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
    // A centre-ball strike is a pure slide: speed, and no roll of its own. Off
    // centre the tip adds spin, 2.5 (b/R) times the speed: follow above,
    // draw below.
    this.cueBall.vel = fromAngle(this.#aimAngle, this.cueSpeed);
    this.cueBall.roll = scale(this.cueBall.vel, 2.5 * this.#tip);
    this.#phase = 'simulating';
    this.#recordMissDistance();
    this.#trails = this.#balls.map((ball) => [ball.pos]);
    return true;
  }

  /**
   * Strike `offset` of the radius above centre, or below it when negative,
   * for follow or draw; held to the miscue limit. Only while lining up.
   */
  setTip(offset: number): boolean {
    if (this.#phase !== 'aiming' && this.#phase !== 'charging') return false;
    this.#tip = Math.min(MAX_TIP_OFFSET, Math.max(-MAX_TIP_OFFSET, offset));
    return true;
  }

  get tip(): number {
    return this.#tip;
  }

  /**
   * The same shot again from the stroke, as a replay plays it: the same
   * layout, cloth, aim, power and tip, and so the same ticks to the end.
   */
  rerun(): ShotSession {
    const again = new ShotSession(this.layout, { pocketAllowance: this.pocketAllowance, cloth: this.#cloth });
    again.aimTo(this.#aimAngle);
    again.setTip(this.#tip);
    again.beginCharge();
    again.setPower(this.#power);
    again.release();
    return again;
  }

  /** The balls just after the cue ball first met the object ball, once it has. */
  get afterContact(): readonly Ball[] | undefined {
    return this.#afterContact;
  }

  /** Each ball's path since the stroke, a point every sixtieth of a second and at every contact. */
  get trails(): readonly (readonly Vec2[])[] {
    return this.#trails;
  }

  /**
   * Run the physics forward by one rendered frame. At one pace from the stroke
   * to the last ball stopping: a cue ball that runs on after the pot dies at
   * its own speed, since how a ball dies is what the speed levels teach.
   */
  advance(frameSeconds: number): void {
    if (this.#phase !== 'simulating') return;

    this.#accumulator += Math.min(frameSeconds, MAX_FRAME_DT);
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
          if (!this.#contacted) this.#afterContact = this.#balls.map(cloneBall);
          this.#contacted = true;
        }
      }
      this.#elapsed += TICK;
      this.#accumulator -= TICK;
      ticks++;
      this.#recordMissDistance();
      if (step.events.length > 0 || Math.round(this.#elapsed / TICK) % TRAIL_EVERY === 0) this.#extendTrails();

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
   * Play the rest of the shot out at once, unseen: what Retry or Next do to a
   * shot still rolling. The same ticks as watching it, so it ends where it
   * would have, with the same contacts, trails and outcome.
   */
  finish(): void {
    while (this.#phase === 'simulating') this.advance(MAX_FRAME_DT);
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
    const touch = this.#contacted ? firstTouch(this.layout.cue, this.layout.object, aim) : undefined;

    this.#outcome = {
      shotId: this.layout.id,
      aimError: error,
      cutAngle: analysis.cutAngle,
      cutSide: analysis.cutSide,
      pocketAllowance: this.pocketAllowance,
      pocketUsed,
      qualifying: pocketUsed !== null && pocketUsed <= this.pocketAllowance,
      result: this.#result(analysis, aim, objectPocket),
      fullnessHit: touch ? fullness(touch.cut) : null,
      fullnessNeeded: analysis.fullness,
      call: this.#call,
      needed: nearestFraction(analysis.cutAngle).name,
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

  /** What the object ball did, in the terms `ShotResult` sets out. */
  #result(analysis: ShotAnalysis, aim: Vec2, objectPocket: PocketId | undefined): ShotResult {
    if (!this.#contacted) return { kind: 'no-contact' };
    if (objectPocket === this.layout.targetPocket) return { kind: 'potted' };
    if (objectPocket !== undefined) return { kind: 'wrong-pocket', pocket: objectPocket };
    const pocket = pocketById(this.layout.targetPocket);
    if (this.#inJaws) {
      const rest = this.objectBall.pos;
      return { kind: 'rattled', hung: isOnShelf(rest) && nearestPocket(rest).id === pocket.id };
    }

    // Short or wide: the line it actually left on, at the stroke actually
    // played, against the pot window.
    const window = potWindow(this.layout, this.#cloth, analysis);
    const { cue, object } = this.layout;
    const rollingFriction = clothRollingFriction(this.#cloth);
    const departure = objectDeparture(cue, object, aim, this.cueSpeed, rollingFriction);
    if (!window || departure === undefined) return { kind: 'wide', by: this.#minDistanceToTarget };
    const turned = signedAngleBetween(fromAngle(window.ideal), fromAngle(departure));
    const room = turned >= 0 ? window.counterClockwise : window.clockwise;
    if (Math.abs(turned) <= room) return { kind: 'short', by: dist(this.objectBall.pos, this.#target) };
    return { kind: 'wide', by: (Math.abs(turned) - room) * analysis.objectToPocket };
  }

  #settle(settled: boolean): void {
    this.#settled = settled;
    this.#phase = 'settled';
    this.#accumulator = 0;
    this.#extendTrails(true);
  }

  /** A point on each trail that has moved on far enough, or, at the end, at all. */
  #extendTrails(final = false): void {
    for (let i = 0; i < this.#balls.length; i++) {
      const trail = this.#trails[i];
      const { pos } = this.#balls[i]!;
      const moved = trail ? dist(trail[trail.length - 1]!, pos) : 0;
      if (trail && (final ? moved > 0 : moved > TRAIL_STEP)) trail.push(pos);
    }
  }

  #recordMissDistance(): void {
    const d = dist(this.objectBall.pos, this.#target);
    if (d < this.#minDistanceToTarget) this.#minDistanceToTarget = d;
    if (!this.#inJaws && !this.objectBall.potted) {
      const pocket = pocketById(this.layout.targetPocket);
      this.#inJaws = dist(this.objectBall.pos, pocket.center) <= pocket.mouthRadius;
    }
  }
}
