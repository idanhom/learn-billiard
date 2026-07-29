/**
 * Table plane to world space.
 *
 * The simulation works in a 2D (x, y) table plane. The scene lays that flat on
 * world XZ with the cloth at y = 0, so table +y (across the table, toward the
 * far long rail) becomes world -z.
 */

import { Vector3 } from 'three';
import type { Vec2 } from '../geometry/vec2';

export function toWorld(p: Vec2, height = 0): Vector3 {
  return new Vector3(p.x, height, -p.y);
}

export function writeWorld(target: Vector3, p: Vec2, height = 0): Vector3 {
  return target.set(p.x, height, -p.y);
}

export function fromWorld(x: number, z: number): Vec2 {
  return { x, y: -z };
}

/** Table-plane heading (radians, CCW from +x) as a world-space direction. */
export function headingToWorld(angle: number): Vector3 {
  return writeHeading(new Vector3(), angle);
}

/** As `headingToWorld`, but into an existing vector — for per-frame callers. */
export function writeHeading(target: Vector3, angle: number): Vector3 {
  return target.set(Math.cos(angle), 0, -Math.sin(angle));
}

/**
 * Y-rotation that turns an object's local +x axis onto a table heading.
 *
 * A Y-rotation of theta sends local +x to world (cos theta, 0, -sin theta),
 * which is exactly `headingToWorld(theta)` — so the rotation is the heading
 * itself. The z-flip is already baked into the mapping; negating here as well
 * mirrors everything about the long axis.
 */
export function headingToRotationY(angle: number): number {
  return angle;
}

export function headingBetween(from: Vec2, to: Vec2): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}
