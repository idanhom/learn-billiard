import { describe, expect, test } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import {
  FAR_DISTANCE,
  MAX_ELEVATION,
  MIN_DISTANCE,
  MIN_ELEVATION,
  MIN_HEIGHT,
  Orbit,
  WALL_INSET,
} from '../../src/scene/explore';
import { RAIL_X, RAIL_Z, WALL_X, WALL_Z } from '../../src/scene/room';

/** A camera at `position` aimed at `target` with `up`, as the scene places one. */
function aimed(position: Vector3, target: Vector3, up = new Vector3(0, 1, 0)): PerspectiveCamera {
  const camera = new PerspectiveCamera(52, 1, 0.05, 60);
  camera.position.copy(position);
  camera.up.copy(up);
  camera.lookAt(target);
  camera.updateMatrixWorld();
  return camera;
}

function taken(camera: PerspectiveCamera): Orbit {
  return Orbit.fromCamera(camera.position, camera.getWorldDirection(new Vector3()), camera.up);
}

/** The camera the orbit stands for, placed the way the scene places it. */
function placed(orbit: Orbit): PerspectiveCamera {
  const position = new Vector3();
  const target = new Vector3();
  orbit.write(position, target);
  return aimed(position, target);
}

/** The top of the screen, as a direction in the world. */
function screenUp(camera: PerspectiveCamera): Vector3 {
  return new Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
}

/** The camera's own right, as a direction in the world. */
function screenRight(camera: PerspectiveCamera): Vector3 {
  return new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
}

const degreesBetween = (a: Vector3, b: Vector3): number => (a.angleTo(b) * 180) / Math.PI;

/** A behind-the-cue view: a little back from a ball near the middle, looking at the cloth ahead of it. */
const behind = (): PerspectiveCamera => aimed(new Vector3(-0.9, 0.45, 0.1), new Vector3(0.2, 0.02, -0.05));

describe('the free camera', () => {
  test('takes over a view from exactly where it was, turning round the cloth at the middle of the screen', () => {
    const camera = behind();
    const orbit = taken(camera);
    const pivot = orbit.pivot;
    expect(pivot.y).toBeCloseTo(0, 9);
    const ray = pivot.clone().sub(camera.position).normalize();
    expect(degreesBetween(ray, camera.getWorldDirection(new Vector3()))).toBeLessThan(1e-6);
    const after = placed(orbit);
    expect(after.position.distanceTo(camera.position)).toBeLessThan(0.001);
    expect(degreesBetween(after.getWorldDirection(new Vector3()), camera.getWorldDirection(new Vector3()))).toBeLessThan(0.01);
  });

  /** A short shot into a cushion looks at cloth past the rail; moving the pivot off the ray would turn the view. */
  test('brings the pivot back along the ray when the middle of the screen is past the rail', () => {
    const camera = aimed(new Vector3(RAIL_X - 0.9, 0.4, 0), new Vector3(RAIL_X + 0.5, 0, 0));
    const orbit = taken(camera);
    const pivot = orbit.pivot;
    expect(pivot.x).toBeLessThanOrEqual(RAIL_X + 1e-9);
    expect(pivot.y).toBeGreaterThan(0);
    const after = placed(orbit);
    expect(after.position.distanceTo(camera.position)).toBeLessThan(0.001);
    expect(degreesBetween(after.getWorldDirection(new Vector3()), camera.getWorldDirection(new Vector3()))).toBeLessThan(0.01);
  });

  /** Overhead turns the table up the screen on a phone held upright, and keeps it across one held sideways. */
  test.each([
    ['upright', new Vector3(1, 0, 0)],
    ['sideways', new Vector3(0, 0, -1)],
  ])('from overhead (%s), keeps looking down with the picture the same way up', (_, up) => {
    const camera = aimed(new Vector3(0, 2.1, 0), new Vector3(0, 0, 0), up);
    const after = placed(taken(camera));
    expect(degreesBetween(after.getWorldDirection(new Vector3()), new Vector3(0, -1, 0))).toBeLessThan(1.5);
    expect(degreesBetween(screenUp(after), screenUp(camera))).toBeLessThan(2);
  });

  test('a drag right takes the camera to its own left, and a drag down lifts it', () => {
    const camera = behind();
    const orbit = taken(camera);
    const right = screenRight(camera);
    orbit.turn(40, 0);
    const turned = placed(orbit);
    expect(turned.position.clone().sub(camera.position).dot(right)).toBeLessThan(-0.05);
    const before = turned.position.y;
    orbit.turn(0, 30);
    expect(placed(orbit).position.y).toBeGreaterThan(before + 0.05);
  });

  test('stays between a low look along the cloth and all but straight down, and answers at once on the way back', () => {
    const orbit = taken(behind());
    orbit.turn(0, 10_000);
    expect(orbit.elevation).toBeCloseTo(MAX_ELEVATION, 9);
    orbit.turn(0, -10);
    expect(orbit.elevation).toBeLessThan(MAX_ELEVATION - 1);
    orbit.turn(0, -10_000);
    expect(orbit.elevation).toBeCloseTo(MIN_ELEVATION, 9);
  });

  test('comes no closer than its least distance, and keeps above the rails and balls when it does', () => {
    const orbit = taken(behind());
    orbit.turn(0, -10_000);
    orbit.zoom(1_000);
    expect(orbit.distance).toBeCloseTo(MIN_DISTANCE, 9);
    expect(placed(orbit).position.y).toBeGreaterThanOrEqual(MIN_HEIGHT - 1e-9);
    orbit.zoom(0.5);
    expect(orbit.distance).toBeCloseTo(2 * MIN_DISTANCE, 9);
  });

  test('stays inside the walls at its furthest, and a pinch from there answers at once', () => {
    // Over the corner of the table, looking down at it from the corner of the room.
    const corner = new Vector3(RAIL_X, 0, RAIL_Z);
    const orbit = taken(aimed(new Vector3(RAIL_X + 0.6, 0.8, RAIL_Z + 0.6), corner));
    orbit.zoom(1e-6);
    expect(orbit.distance).toBeLessThanOrEqual(FAR_DISTANCE);
    const camera = placed(orbit);
    expect(Math.abs(camera.position.x)).toBeLessThanOrEqual(WALL_X - WALL_INSET + 1e-9);
    expect(Math.abs(camera.position.z)).toBeLessThanOrEqual(WALL_Z - WALL_INSET + 1e-9);
    const furthest = orbit.distance;
    orbit.zoom(1.25);
    expect(orbit.distance).toBeCloseTo(furthest / 1.25, 9);
  });

  test('the cloth follows the fingers, so the pivot goes the other way, and never leaves the table', () => {
    const camera = behind();
    const orbit = taken(camera);
    const start = orbit.pivot;
    orbit.slide(30, 0, 600, 52);
    const across = orbit.pivot.sub(start);
    expect(across.dot(screenRight(camera))).toBeLessThan(0);
    const level = camera.getWorldDirection(new Vector3()).setY(0).normalize();
    const mid = orbit.pivot;
    orbit.slide(0, 30, 600, 52);
    expect(orbit.pivot.sub(mid).dot(level)).toBeGreaterThan(0);
    orbit.slide(-100_000, 100_000, 600, 52);
    const pivot = orbit.pivot;
    expect(Math.abs(pivot.x)).toBeLessThanOrEqual(RAIL_X + 1e-9);
    expect(Math.abs(pivot.z)).toBeLessThanOrEqual(RAIL_Z + 1e-9);
  });
});
