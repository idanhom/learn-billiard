import { describe, expect, test } from 'vitest';
import { Object3D, Vector3 } from 'three';
import { vec } from '../../src/geometry/vec2';
import {
  fromWorld,
  headingBetween,
  headingToRotationY,
  headingToWorld,
  toWorld,
} from '../../src/scene/coords';

describe('table plane to world space', () => {
  test('lays the table flat on world XZ with +y across the table as -z', () => {
    expect(toWorld(vec(1, 2))).toEqual(new Vector3(1, 0, -2));
    expect(toWorld(vec(1, 2), 0.5)).toEqual(new Vector3(1, 0.5, -2));
  });

  test('round-trips through world space', () => {
    const world = toWorld(vec(0.3, -0.4));
    expect(fromWorld(world.x, world.z)).toEqual(vec(0.3, -0.4));
  });

  test('a heading becomes a unit direction on the cloth', () => {
    const east = headingToWorld(0);
    expect(east.x).toBeCloseTo(1, 12);
    expect(east.z).toBeCloseTo(0, 12);
    const across = headingToWorld(Math.PI / 2);
    expect(across.x).toBeCloseTo(0, 12);
    expect(across.z).toBeCloseTo(-1, 12);
  });

  test('headingBetween points from one table position at another', () => {
    expect(headingBetween(vec(0, 0), vec(1, 1))).toBeCloseTo(Math.PI / 4, 12);
    expect(headingBetween(vec(0, 0), vec(-1, 0))).toBeCloseTo(Math.PI, 12);
  });

  /**
   * The z-flip is already in the mapping. Negating the angle as well mirrors
   * every heading about the long axis, which silently points the cue stick and
   * the aim line the wrong way while the table itself still looks right.
   */
  test('rotating an object by headingToRotationY aims its local +x along that heading', () => {
    const object = new Object3D();
    for (const heading of [0, 0.4, 1.2, Math.PI / 2, 2.7, -0.9, -2.2]) {
      object.rotation.set(0, headingToRotationY(heading), 0);
      object.updateMatrixWorld(true);
      const localX = new Vector3(1, 0, 0).applyQuaternion(object.quaternion);
      const expected = headingToWorld(heading);
      expect(localX.x).toBeCloseTo(expected.x, 12);
      expect(localX.y).toBeCloseTo(0, 12);
      expect(localX.z).toBeCloseTo(expected.z, 12);
    }
  });

  test('a heading of zero needs no rotation', () => {
    expect(headingToRotationY(0)).toBe(0);
  });
});
