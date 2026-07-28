import { describe, expect, test } from 'vitest';
import {
  add,
  cross,
  dot,
  len,
  lenSq,
  normalize,
  perp,
  rotate,
  scale,
  signedAngleBetween,
  sub,
  vec,
} from '../../src/geometry/vec2';

describe('vec2', () => {
  test('adds and subtracts componentwise', () => {
    expect(add(vec(1, 2), vec(3, 4))).toEqual(vec(4, 6));
    expect(sub(vec(1, 2), vec(3, 4))).toEqual(vec(-2, -2));
  });

  test('scales by a scalar', () => {
    expect(scale(vec(1, -2), 3)).toEqual(vec(3, -6));
  });

  test('computes dot and 2D cross products', () => {
    expect(dot(vec(1, 2), vec(3, 4))).toBe(11);
    expect(cross(vec(1, 0), vec(0, 1))).toBe(1);
    expect(cross(vec(0, 1), vec(1, 0))).toBe(-1);
  });

  test('computes length and squared length', () => {
    expect(lenSq(vec(3, 4))).toBe(25);
    expect(len(vec(3, 4))).toBe(5);
  });

  test('normalizes to unit length', () => {
    const n = normalize(vec(3, 4));
    expect(n.x).toBeCloseTo(0.6, 12);
    expect(n.y).toBeCloseTo(0.8, 12);
  });

  test('normalizing a zero vector yields zero rather than NaN', () => {
    expect(normalize(vec(0, 0))).toEqual(vec(0, 0));
  });

  test('perp rotates 90 degrees counter-clockwise', () => {
    const a = perp(vec(1, 0));
    expect(a.x).toBeCloseTo(0, 12);
    expect(a.y).toBeCloseTo(1, 12);
    const b = perp(vec(0, 1));
    expect(b.x).toBeCloseTo(-1, 12);
    expect(b.y).toBeCloseTo(0, 12);
  });

  test('rotate turns a vector by an angle in radians', () => {
    const r = rotate(vec(1, 0), Math.PI / 2);
    expect(r.x).toBeCloseTo(0, 12);
    expect(r.y).toBeCloseTo(1, 12);
  });

  test('signedAngleBetween is positive counter-clockwise and negative clockwise', () => {
    expect(signedAngleBetween(vec(1, 0), vec(0, 1))).toBeCloseTo(Math.PI / 2, 12);
    expect(signedAngleBetween(vec(1, 0), vec(0, -1))).toBeCloseTo(-Math.PI / 2, 12);
    expect(signedAngleBetween(vec(1, 0), vec(1, 0))).toBeCloseTo(0, 12);
  });
});
