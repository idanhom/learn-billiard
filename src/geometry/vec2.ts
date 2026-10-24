/** Immutable 2D vector helpers. Pure — no dependencies, safe in tests and workers. */

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export function vec(x: number, y: number): Vec2 {
  return { x, y };
}

export const ZERO: Vec2 = vec(0, 0);

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Vec2, k: number): Vec2 {
  return { x: a.x * k, y: a.y * k };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/** z-component of the 3D cross product of two vectors in the xy-plane. */
export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

export function lenSq(a: Vec2): number {
  return a.x * a.x + a.y * a.y;
}

export function len(a: Vec2): number {
  return Math.hypot(a.x, a.y);
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function distSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/** Unit vector in the same direction; the zero vector maps to itself (never NaN). */
export function normalize(a: Vec2): Vec2 {
  const l = Math.hypot(a.x, a.y);
  if (l === 0) return ZERO;
  return { x: a.x / l, y: a.y / l };
}

/** 90-degree counter-clockwise rotation. */
export function perp(a: Vec2): Vec2 {
  return { x: -a.y, y: a.x };
}

export function rotate(a: Vec2, radians: number): Vec2 {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

export function fromAngle(radians: number, length = 1): Vec2 {
  return { x: Math.cos(radians) * length, y: Math.sin(radians) * length };
}

export function angleOf(a: Vec2): number {
  return Math.atan2(a.y, a.x);
}

/** Signed angle from `a` to `b` in (-pi, pi]; positive is counter-clockwise. */
export function signedAngleBetween(a: Vec2, b: Vec2): number {
  return Math.atan2(cross(a, b), dot(a, b));
}

/** Unsigned angle between `a` and `b` in [0, pi]. */
export function angleBetween(a: Vec2, b: Vec2): number {
  return Math.abs(signedAngleBetween(a, b));
}

export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Fraction along the segment ab that is nearest to p, clamped to [0, 1]. */
export function projectOntoSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const lengthSq = dot(ab, ab);
  if (lengthSq === 0) return 0;
  const t = dot(sub(p, a), ab) / lengthSq;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const t = projectOntoSegment(p, a, b);
  return Math.hypot(p.x - (a.x + (b.x - a.x) * t), p.y - (a.y + (b.y - a.y) * t));
}

/** Closest approach between segments ab and cd; zero where they cross. */
export function distanceBetweenSegments(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  const ab = sub(b, a);
  const cd = sub(d, c);
  const crosses =
    cross(ab, sub(c, a)) * cross(ab, sub(d, a)) < 0 && cross(cd, sub(a, c)) * cross(cd, sub(b, c)) < 0;
  if (crosses) return 0;
  return Math.min(
    distanceToSegment(a, c, d),
    distanceToSegment(b, c, d),
    distanceToSegment(c, a, b),
    distanceToSegment(d, a, b),
  );
}
