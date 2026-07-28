import { describe, expect, test } from 'vitest';
import { MAX_CUE_SPEED } from '../../src/constants';
import { BALL_RADIUS, TABLE, pocketById } from '../../src/geometry/table';
import {
  aimError,
  analyseShot,
  cutAngle,
  cutSide,
  fullness,
  ghostBallCenter,
  idealAimDirection,
  isPathClear,
  objectSpeedAfterCut,
  stoppingDistance,
} from '../../src/geometry/shot';
import { type Vec2, add, angleOf, fromAngle, normalize, rotate, scale, sub, vec } from '../../src/geometry/vec2';

const deg = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/**
 * Build a layout with an exactly known cut angle: the cue ball sits `cueDist`
 * behind a ghost ball, and the object ball is offset from that ghost along the
 * departure direction `theta`.
 */
function layoutWithCut(theta: number, cueDist = 0.5, potDist = 0.8) {
  const cue = vec(0, 0);
  const ghost = vec(cueDist, 0);
  const departure = fromAngle(theta);
  const object = add(ghost, scale(departure, 2 * BALL_RADIUS));
  const target = add(object, scale(departure, potDist));
  return { cue, ghost, object, target };
}

describe('ghost ball', () => {
  test('sits one ball diameter behind the object ball on the far side from the pocket', () => {
    const object = vec(0, 0);
    const target = vec(1, 0);
    const ghost = ghostBallCenter(object, target);
    expect(ghost.x).toBeCloseTo(-2 * BALL_RADIUS, 12);
    expect(ghost.y).toBeCloseTo(0, 12);
  });

  test('is recovered exactly from a constructed layout at any cut angle', () => {
    for (const d of [0, 10, 30, 45, 60, 75]) {
      const { object, target, ghost } = layoutWithCut(deg(d));
      const computed = ghostBallCenter(object, target);
      expect(computed.x).toBeCloseTo(ghost.x, 12);
      expect(computed.y).toBeCloseTo(ghost.y, 12);
    }
  });
});

describe('cut angle', () => {
  test('is zero for a dead straight shot', () => {
    const { cue, object, target } = layoutWithCut(0);
    expect(toDeg(cutAngle(cue, object, target))).toBeCloseTo(0, 9);
  });

  test('recovers the constructed angle', () => {
    for (const d of [5, 15, 30, 45, 60, 75]) {
      const { cue, object, target } = layoutWithCut(deg(d));
      expect(toDeg(cutAngle(cue, object, target))).toBeCloseTo(d, 9);
    }
  });

  test('is unsigned — mirrored layouts give the same angle', () => {
    const left = layoutWithCut(deg(30));
    const right = layoutWithCut(deg(-30));
    expect(cutAngle(left.cue, left.object, left.target)).toBeCloseTo(
      cutAngle(right.cue, right.object, right.target),
      12,
    );
  });

  test('a half-ball hit is a 30 degree cut', () => {
    expect(fullness(deg(30))).toBeCloseTo(0.5, 9);
    expect(fullness(0)).toBeCloseTo(1, 9);
    expect(fullness(deg(90))).toBeCloseTo(0, 9);
  });
});

describe('cut side', () => {
  test('reports which way the object ball is being cut', () => {
    const left = layoutWithCut(deg(30));
    expect(cutSide(left.cue, left.object, left.target)).toBe('left');
    const right = layoutWithCut(deg(-30));
    expect(cutSide(right.cue, right.object, right.target)).toBe('right');
  });

  test('reports straight when the cut is under two degrees', () => {
    const { cue, object, target } = layoutWithCut(deg(1));
    expect(cutSide(cue, object, target)).toBe('straight');
  });
});

describe('aim error', () => {
  test('is zero along the ideal line', () => {
    const { cue, object, target } = layoutWithCut(deg(30));
    const ideal = idealAimDirection(cue, object, target);
    const err = aimError(cue, object, target, ideal);
    expect(err.degrees).toBeCloseTo(0, 9);
    expect(err.kind).toBe('on-line');
  });

  test('reports the magnitude of the angular deviation', () => {
    const { cue, object, target } = layoutWithCut(deg(30));
    const ideal = idealAimDirection(cue, object, target);
    const err = aimError(cue, object, target, rotate(ideal, deg(1.5)));
    expect(err.degrees).toBeCloseTo(1.5, 9);
  });

  test('aiming nearer the object-ball centre than ideal is thick, further is thin', () => {
    // Cut to the left: the ghost ball sits to the right of the object centre,
    // so rotating the aim counter-clockwise moves it toward the centre.
    const { cue, object, target } = layoutWithCut(deg(30));
    const ideal = idealAimDirection(cue, object, target);
    expect(aimError(cue, object, target, rotate(ideal, deg(1))).kind).toBe('thick');
    expect(aimError(cue, object, target, rotate(ideal, deg(-1))).kind).toBe('thin');
  });

  test('thick and thin flip with the cut side, not with table direction', () => {
    const { cue, object, target } = layoutWithCut(deg(-30));
    const ideal = idealAimDirection(cue, object, target);
    expect(aimError(cue, object, target, rotate(ideal, deg(-1))).kind).toBe('thick');
    expect(aimError(cue, object, target, rotate(ideal, deg(1))).kind).toBe('thin');
  });

  test('straight-in shots report left and right instead of thick and thin', () => {
    const { cue, object, target } = layoutWithCut(deg(0.5));
    const ideal = idealAimDirection(cue, object, target);
    expect(aimError(cue, object, target, rotate(ideal, deg(1))).kind).toBe('left');
    expect(aimError(cue, object, target, rotate(ideal, deg(-1))).kind).toBe('right');
  });

  test('signed error is counter-clockwise positive', () => {
    const { cue, object, target } = layoutWithCut(deg(30));
    const ideal = idealAimDirection(cue, object, target);
    expect(aimError(cue, object, target, rotate(ideal, deg(2))).signed).toBeGreaterThan(0);
    expect(aimError(cue, object, target, rotate(ideal, deg(-2))).signed).toBeLessThan(0);
  });
});

describe('path clearance', () => {
  const from = vec(0, 0);
  const to = vec(1, 0);

  test('an empty lane is clear', () => {
    expect(isPathClear(from, to, [])).toBe(true);
  });

  test('a ball squarely in the lane blocks it', () => {
    expect(isPathClear(from, to, [vec(0.5, 0)])).toBe(false);
  });

  test('a ball just wider than a full diameter off the lane does not block it', () => {
    expect(isPathClear(from, to, [vec(0.5, 2 * BALL_RADIUS + 0.001)])).toBe(true);
    expect(isPathClear(from, to, [vec(0.5, 2 * BALL_RADIUS - 0.001)])).toBe(false);
  });

  test('a ball behind the start or beyond the end does not block', () => {
    expect(isPathClear(from, to, [vec(-0.3, 0)])).toBe(true);
    expect(isPathClear(from, to, [vec(1.3, 0)])).toBe(true);
  });
});

describe('speed and roll-out', () => {
  test('a straight hit transfers 97.5 percent of the cue speed at e = 0.95', () => {
    expect(objectSpeedAfterCut(2, 0)).toBeCloseTo(2 * 0.975, 9);
  });

  test('transfer falls off with the cosine of the cut angle', () => {
    expect(objectSpeedAfterCut(2, deg(60))).toBeCloseTo(2 * 0.975 * 0.5, 9);
    expect(objectSpeedAfterCut(2, deg(90))).toBeCloseTo(0, 9);
  });

  test('stopping distance grows with the square of speed', () => {
    const d1 = stoppingDistance(1);
    const d2 = stoppingDistance(2);
    expect(d2 / d1).toBeCloseTo(4, 6);
    expect(stoppingDistance(0)).toBe(0);
  });

  test('a firm stroke can send an object ball the length of the table', () => {
    const speed = objectSpeedAfterCut(MAX_CUE_SPEED, 0);
    expect(stoppingDistance(speed)).toBeGreaterThan(TABLE.playLength);
  });
});

describe('analyseShot', () => {
  const pocket = pocketById('top-right');

  test('a clear shot at a pocket is reachable and carries its geometry', () => {
    const object = vec(0.6, 0.2);
    const toPocket = normalize(sub(pocket.center, object));
    const cue = sub(object, scale(toPocket, 0.5));
    const analysis = analyseShot({ cue, object, pocket, obstacles: [] });
    expect(analysis.reachable).toBe(true);
    expect(analysis.blockers).toEqual([]);
    expect(toDeg(analysis.cutAngle)).toBeCloseTo(0, 6);
    expect(analysis.objectToPocket).toBeCloseTo(
      Math.hypot(pocket.center.x - object.x, pocket.center.y - object.y),
      9,
    );
  });

  test('a ghost ball off the playing surface makes the shot unreachable', () => {
    // Object frozen on the right short rail, cutting back at the side pocket:
    // the ghost would have to sit inside the rail.
    const object = vec(TABLE.bounds.maxX, 0);
    const analysis = analyseShot({
      cue: vec(0.2, -0.3),
      object,
      pocket: pocketById('top-middle'),
      obstacles: [],
    });
    expect(analysis.reachable).toBe(false);
    expect(analysis.blockers).toContain('ghost-off-table');
  });

  test('a cut steeper than the physical limit is rejected', () => {
    const object = vec(0.59, 0.44);
    const departure = normalize(sub(pocket.center, object));
    const ghost = ghostBallCenter(object, pocket.center);
    // Approach the ghost 87 degrees off the object's departure line.
    const cue = add(ghost, scale(rotate(departure, deg(-93)), 0.3));
    const analysis = analyseShot({ cue, object, pocket, obstacles: [] });
    expect(toDeg(analysis.cutAngle)).toBeCloseTo(87, 6);
    expect(analysis.reachable).toBe(false);
    expect(analysis.blockers).toContain('cut-too-steep');
  });

  test('a ball parked in the cue path blocks the shot', () => {
    const object = vec(0.6, 0.2);
    const toPocket = normalize(sub(pocket.center, object));
    const cue = sub(object, scale(toPocket, 0.6));
    const midway = add(cue, scale(toPocket, 0.3));
    const analysis = analyseShot({ cue, object, pocket, obstacles: [midway] });
    expect(analysis.blockers).toContain('cue-path-blocked');
  });

  test('a ball parked between object and pocket blocks the shot', () => {
    const object = vec(0.6, 0.2);
    const toPocket = normalize(sub(pocket.center, object));
    const cue = sub(object, scale(toPocket, 0.6));
    const midway = add(object, scale(toPocket, 0.2));
    const analysis = analyseShot({ cue, object, pocket, obstacles: [midway] });
    expect(analysis.blockers).toContain('object-path-blocked');
  });

  test('a thin cut the length of the table is flagged as underpowered', () => {
    const object = vec(-0.85, 0.4);
    const departure = normalize(sub(pocket.center, object));
    const ghost = ghostBallCenter(object, pocket.center);
    // 84 degrees: inside the steepness limit, but too thin to carry that far.
    const cue = add(ghost, scale(rotate(departure, deg(-96)), 0.3));
    const analysis = analyseShot({ cue, object, pocket, obstacles: [] });
    expect(toDeg(analysis.cutAngle)).toBeCloseTo(84, 6);
    expect(analysis.blockers).toContain('underpowered');
    expect(analysis.blockers).not.toContain('cut-too-steep');
  });

  test('the ideal aim direction points from the cue ball at the ghost ball', () => {
    const object = vec(0.6, 0.2);
    const cue = vec(-0.2, -0.1);
    const analysis = analyseShot({ cue, object, pocket, obstacles: [] });
    const expected = angleOf(sub(analysis.ghostCenter, cue));
    expect(angleOf(analysis.aimDirection)).toBeCloseTo(expected, 12);
  });

  test('never produces NaN across a sweep of layouts', () => {
    const finite = (v: number) => Number.isFinite(v);
    for (let i = 0; i < 200; i++) {
      const cue: Vec2 = vec(-0.9 + (1.8 * i) / 200, -0.4 + (0.8 * ((i * 7) % 200)) / 200);
      const object: Vec2 = vec(0.9 - (1.8 * i) / 200, 0.4 - (0.8 * ((i * 13) % 200)) / 200);
      for (const p of TABLE.pockets) {
        const a = analyseShot({ cue, object, pocket: p, obstacles: [] });
        expect(finite(a.cutAngle)).toBe(true);
        expect(finite(a.fullness)).toBe(true);
        expect(finite(a.ghostCenter.x) && finite(a.ghostCenter.y)).toBe(true);
        expect(finite(a.aimDirection.x) && finite(a.aimDirection.y)).toBe(true);
      }
    }
  });
});
