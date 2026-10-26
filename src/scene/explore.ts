/**
 * The free camera after a shot: the view turned round a point on the table,
 * zoomed and slid by hand, to look the result over from wherever the player
 * likes.
 *
 * It takes over from whatever view was up, from exactly where that view had
 * the camera, so the first touch moves the picture rather than replacing it.
 * The point it turns round is where the middle of the screen meets the cloth.
 *
 * Its limits keep it in the room the scene draws: above the cloth and clear of
 * the rails and balls, so the near plane never shows what is under the table;
 * over the table, so there is always something to turn round; and inside the
 * walls, which are one-sided and vanish from behind.
 */

import { Vector3 } from 'three';
import { RAIL_X, RAIL_Z, WALL_X, WALL_Z } from './room';

/** Degrees of turn per pixel dragged: a phone's width is about a third of a turn. */
export const TURN_DEGREES_PER_PIXEL = 0.4;

/** Elevation above the cloth, in degrees: down to a low look along it, up to all but straight down. */
export const MIN_ELEVATION = 5;
export const MAX_ELEVATION = 89;

/** The camera's lowest height over the cloth, in metres: above the rails (0.045) and the balls (0.056). */
export const MIN_HEIGHT = 0.1;

/** How close the camera comes to the point it turns round, and how far it goes unless it started further. */
export const MIN_DISTANCE = 0.2;
export const FAR_DISTANCE = 4;

/** How far inside the walls the camera stays, in metres: clear of the sconces too. */
export const WALL_INSET = 0.3;

/**
 * Low down, a finger's travel up the screen covers more cloth than across it,
 * by 1 / sin(elevation). Sliding makes that up so the cloth keeps up with the
 * finger, but no more than this, or a look along the cloth would fling the view
 * the length of the table.
 */
const SLIDE_FORWARD_CAP = 4;

const RADIANS = Math.PI / 180;

/** Where the camera stands relative to the point it turns round. */
export class Orbit {
  readonly #pivot = new Vector3();
  /** Heading of the camera from the pivot, round the vertical, in radians. */
  #yaw = 0;
  /** Angle of the camera above the pivot's level, in radians. */
  #elevation = 0;
  #distance = 1;
  readonly #farthest: number;

  private constructor(pivot: Vector3, yaw: number, elevation: number, distance: number) {
    this.#pivot.copy(pivot);
    this.#yaw = yaw;
    this.#elevation = elevation;
    this.#distance = distance;
    this.#farthest = Math.max(FAR_DISTANCE, distance);
    this.#clamp();
  }

  /**
   * Take over from a camera at `position` looking along `forward`, with `up`
   * the hint it was aimed with.
   *
   * The pivot is where the centre of the view meets the cloth. When that is
   * past the rail it comes back along the same ray until it is over the table,
   * even if that leaves it in the air: moving it off the ray would turn the
   * view on the first touch.
   *
   * Looking straight down there is no heading to keep, so the camera tips a
   * hair off vertical on the side away from the top of the screen, which keeps
   * the picture the same way up. Minus the level part of `forward + up` is that
   * side; for any other view `up` is vertical and it is simply behind the
   * camera, as the offset already says.
   */
  static fromCamera(position: Vector3, forward: Vector3, up: Vector3): Orbit {
    const ahead = forward.clone().normalize();
    const pivot = position.clone().addScaledVector(ahead, pivotAlong(position, ahead));

    const offset = position.clone().sub(pivot);
    const distance = Math.max(offset.length(), 1e-6);
    const level = Math.hypot(offset.x, offset.z);
    let yaw: number;
    if (level > 1e-4 * distance) {
      yaw = Math.atan2(offset.z, offset.x);
    } else {
      const away = ahead.clone().add(up).negate();
      yaw = Math.atan2(away.z, away.x);
    }
    const elevation = Math.asin(Math.min(1, Math.max(-1, offset.y / distance)));
    return new Orbit(pivot, yaw, elevation, distance);
  }

  get pivot(): Vector3 {
    return this.#pivot.clone();
  }

  get distance(): number {
    return this.#distance;
  }

  /** Elevation in degrees, for the tests. */
  get elevation(): number {
    return this.#elevation / RADIANS;
  }

  /**
   * A drag of `dx`, `dy` pixels turns the table with the finger: right takes
   * the camera to its own left, down lifts it.
   */
  turn(dx: number, dy: number): void {
    this.#yaw += dx * TURN_DEGREES_PER_PIXEL * RADIANS;
    this.#elevation += dy * TURN_DEGREES_PER_PIXEL * RADIANS;
    this.#clamp();
  }

  /** Fingers spread to `factor` times as far apart bring the camera that many times closer. */
  zoom(factor: number): void {
    if (!(factor > 0)) return;
    this.#distance /= factor;
    this.#clamp();
  }

  /**
   * Fingers moved `dx`, `dy` pixels carry the cloth with them, so the pivot
   * goes the other way, by what a pixel spans at the pivot's distance on a
   * view `viewHeight` CSS pixels tall with a `fov` degree vertical field.
   */
  slide(dx: number, dy: number, viewHeight: number, fov: number): void {
    if (!(viewHeight > 0)) return;
    const metresPerPixel = (2 * this.#distance * Math.tan((fov * RADIANS) / 2)) / viewHeight;
    const forwardGain = Math.min(SLIDE_FORWARD_CAP, 1 / Math.max(1e-6, Math.sin(this.#elevation)));
    const cos = Math.cos(this.#yaw);
    const sin = Math.sin(this.#yaw);
    // The camera's right, and its heading along the cloth, from the pivot's side of it.
    const across = -dx * metresPerPixel;
    const along = dy * metresPerPixel * forwardGain;
    this.#pivot.x += across * sin - along * cos;
    this.#pivot.z += -across * cos - along * sin;
    this.#pivot.x = Math.min(RAIL_X, Math.max(-RAIL_X, this.#pivot.x));
    this.#pivot.z = Math.min(RAIL_Z, Math.max(-RAIL_Z, this.#pivot.z));
    this.#clamp();
  }

  /** The camera's place into `position`, and the point it looks at into `target`. */
  write(position: Vector3, target: Vector3): void {
    target.copy(this.#pivot);
    const level = this.#distance * Math.cos(this.#elevation);
    position.set(
      this.#pivot.x + level * Math.cos(this.#yaw),
      this.#pivot.y + this.#distance * Math.sin(this.#elevation),
      this.#pivot.z + level * Math.sin(this.#yaw),
    );
  }

  /**
   * Every limit, into the stored state itself: a pinch held past the closest
   * the camera comes must answer the moment it opens again, not after undoing
   * the overshoot.
   */
  #clamp(): void {
    this.#distance = Math.min(this.#farthest, Math.max(MIN_DISTANCE, this.#distance));
    const lowest = Math.asin(Math.min(1, Math.max(0, (MIN_HEIGHT - this.#pivot.y) / this.#distance)));
    this.#elevation = Math.min(
      MAX_ELEVATION * RADIANS,
      Math.max(MIN_ELEVATION * RADIANS, lowest, this.#elevation),
    );
    // Inside the walls, by bringing the camera in along its line to the pivot.
    const cos = Math.cos(this.#yaw);
    const sin = Math.sin(this.#yaw);
    let reach = Infinity;
    if (Math.abs(cos) > 1e-9) reach = Math.min(reach, (Math.sign(cos) * (WALL_X - WALL_INSET) - this.#pivot.x) / cos);
    if (Math.abs(sin) > 1e-9) reach = Math.min(reach, (Math.sign(sin) * (WALL_Z - WALL_INSET) - this.#pivot.z) / sin);
    const level = this.#distance * Math.cos(this.#elevation);
    if (level > reach) this.#distance = reach / Math.cos(this.#elevation);
  }
}

/**
 * How far along the ray from `position` the pivot goes: to the cloth, unless
 * that is off the table, and then to the last point of the ray still over it.
 */
function pivotAlong(position: Vector3, ahead: Vector3): number {
  // Where the ray meets the cloth, or a metre on if it never comes down to it.
  const toCloth = ahead.y < -1e-6 ? -position.y / ahead.y : 1;
  // The stretch of the ray over the table, rails included, as a slab test.
  let enter = -Infinity;
  let leave = Infinity;
  for (const [from, step, half] of [
    [position.x, ahead.x, RAIL_X],
    [position.z, ahead.z, RAIL_Z],
  ] as const) {
    if (Math.abs(step) < 1e-9) {
      if (Math.abs(from) > half) return toCloth;
      continue;
    }
    const a = (-half - from) / step;
    const b = (half - from) / step;
    enter = Math.max(enter, Math.min(a, b));
    leave = Math.min(leave, Math.max(a, b));
  }
  if (enter > leave || leave < 0) return toCloth;
  if (toCloth > leave) return leave;
  return toCloth;
}
