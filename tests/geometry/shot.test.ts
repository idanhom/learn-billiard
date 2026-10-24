import { describe, expect, test } from 'vitest';
import {
  BALL_CONTACT_FRICTION,
  type ClothPreset,
  CLOTH_PRESET_IDS,
  GRAVITY,
  MAX_CUE_SPEED,
  ROLLING_FRICTION,
  SLIDING_FRICTION,
  clothRollingFriction,
} from '../../src/constants';
import { aimPoint } from '../../src/geometry/pocket-window';
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
  launchSpeedFor,
  objectRollFraction,
  objectSpeedAfterCut,
  rollPhaseDistance,
  speedForStoppingDistance,
  stoppingDistance,
} from '../../src/geometry/shot';
import { createBall, simulateToRest } from '../../src/physics/world';
import { type Vec2, add, angleOf, fromAngle, len, normalize, rotate, scale, sub, vec } from '../../src/geometry/vec2';

const deg = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/**
 * Roll one ball up the middle of the table and read its speed off at
 * `distance`. The lane is the long axis at y = 0, which passes between the
 * corner pockets and clear of the side ones, so nothing interferes.
 *
 * Tick boundaries rarely land exactly on the distance asked for, so the two
 * that straddle it are interpolated — at 1/240 s a tick is a few millimetres.
 */
function speedAfterTravelling(launch: number, distance: number, cloth: ClothPreset): number {
  const start = vec(-TABLE.playLength / 2 + 0.1, 0);
  let previous = { travelled: 0, speed: launch };
  let answer: number | undefined;

  simulateToRest([createBall(0, start, vec(launch, 0))], {
    cloth,
    onTick: (_time, balls) => {
      if (answer !== undefined) return;
      const ball = balls[0]!;
      const travelled = ball.pos.x - start.x;
      const speed = len(ball.vel);
      if (travelled >= distance) {
        const span = travelled - previous.travelled;
        const t = span === 0 ? 0 : (distance - previous.travelled) / span;
        answer = previous.speed + t * (speed - previous.speed);
        return;
      }
      previous = { travelled, speed };
    },
  });

  if (answer === undefined) throw new Error(`the ball stopped short of ${distance} m`);
  return answer;
}

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

  /**
   * On any ONE rung of the ladder the roll-out is `C*v^2 + constant`, so two
   * speeds on that rung determine the constant and it must then predict a third
   * exactly. Run it on each rung in turn — that is the property
   * `speedForStoppingDistance` inverts, and it is what makes each branch of the
   * inverse a single square root.
   */
  test('stopping distance is quadratic plus a constant on each rung of the ladder', () => {
    const rung = (a: number, b: number, c: number): void => {
      const [da, db, dc] = [stoppingDistance(a), stoppingDistance(b), stoppingDistance(c)];
      // da = C*a^2 + k, db = C*b^2 + k  =>  solve both, predict dc.
      const coefficient = (db - da) / (b * b - a * a);
      const constant = da - coefficient * a * a;
      expect(dc).toBeCloseTo(coefficient * c * c + constant, 12);
    };

    rung(0.04, 0.08, 0.12); // below the knee: launch under 3.5*0.12/2.5 = 0.168
    rung(0.4, 1.2, 4); //      above it, all the way to the hardest stroke
    expect(stoppingDistance(0)).toBe(0);
  });

  /**
   * The knee's offset is a bite: every ball fast enough to reach it pays the
   * same fixed saving at the very end, so doubling the speed slightly more
   * than quadruples the run.
   */
  test('and the terminal knee makes the middle rung slightly more than quadratic', () => {
    const d1 = stoppingDistance(0.5);
    const d2 = stoppingDistance(1);
    expect(d2 / d1).toBeGreaterThan(4);
    expect(d2 / d1).toBeLessThan(4.2);
  });

  test('and is exactly quadratic below the knee, where the boost applies throughout', () => {
    // Both of these leave the slide below TERMINAL_ROLL_SPEED, so there is no
    // crossing to split and the offset never enters.
    expect(stoppingDistance(0.1) / stoppingDistance(0.05)).toBeCloseTo(4, 9);
  });

  /**
   * The sign that the whole contact model turns on: a rolling cue ball gears
   * BACKSPIN onto the object ball, so its roll fraction is negative and its run
   * is shorter than a pure slide's, not longer.
   */
  test('the object ball comes off a contact with backspin, which shortens its run', () => {
    expect(objectRollFraction(0)).toBeLessThan(0);
    expect(objectRollFraction(0)).toBeCloseTo(-2.5 * BALL_CONTACT_FRICTION, 12);
    expect(stoppingDistance(1, ROLLING_FRICTION, objectRollFraction(0))).toBeLessThan(
      stoppingDistance(1, ROLLING_FRICTION, 0),
    );
  });

  test('and less of it the thinner the cut, vanishing at a right angle', () => {
    expect(Math.abs(objectRollFraction(deg(60)))).toBeLessThan(Math.abs(objectRollFraction(0)));
    expect(objectRollFraction(deg(90))).toBeCloseTo(0, 12);
  });

  test('a firm stroke can send an object ball the length of the table', () => {
    const speed = objectSpeedAfterCut(MAX_CUE_SPEED, 0);
    expect(stoppingDistance(speed)).toBeGreaterThan(TABLE.playLength);
  });

  /**
   * Draw heavy enough to reverse the ball, which no contact in this app
   * produces — the object ball leaves at -0.15 — but which the signature
   * accepts, so it has to mean something rather than quietly mean the wrong
   * thing. Below k = -2.5 the ball comes out of its slide travelling BACKWARDS
   * and rolls on that way, so the answer is a signed displacement and it can go
   * negative. Dropping the backward roll at zero would have reported this ball
   * 20 cm in FRONT of where it finishes.
   */
  test('a ball drawn back past its own launch point reports a negative displacement', () => {
    const forward = stoppingDistance(1, ROLLING_FRICTION, -4);
    expect(forward).toBeLessThan(0);
    expect(stoppingDistance(1, ROLLING_FRICTION, -1)).toBeGreaterThan(0);

    // The slide carries it +0.208 m; leaving at -0.4286 m/s it rolls 0.409 back.
    expect(forward).toBeCloseTo(0.208034 + rollPhaseDistance(-(1 * 1.5) / 3.5, ROLLING_FRICTION), 6);
  });

  test('and a ball with no cloth under it never stops', () => {
    expect(stoppingDistance(1, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(speedForStoppingDistance(1, 0)).toBe(0);
  });

  /**
   * Below the reversal there is no inverse to return: a harder stroke lands
   * SHORTER, so the same distance has two launch speeds. Refusing beats the
   * clamp that used to sit in `kneeLaunchSpeed`, which answered 2.2e9 m/s.
   */
  test('and the inverse refuses the reversed branch rather than guessing', () => {
    expect(speedForStoppingDistance(0.2, ROLLING_FRICTION, -3)).toBeNaN();
    expect(speedForStoppingDistance(0.2, ROLLING_FRICTION, -7)).toBeNaN();
    expect(speedForStoppingDistance(0.2, ROLLING_FRICTION, -2.4)).toBeGreaterThan(0);
  });
});

describe('inverting the roll-out', () => {
  test('speedForStoppingDistance round-trips stoppingDistance, on every cloth', () => {
    for (const preset of CLOTH_PRESET_IDS) {
      const friction = clothRollingFriction(preset);
      for (const distance of [0.05, 0.3, 0.771, 1.4, 2.5]) {
        const speed = speedForStoppingDistance(distance, friction);
        expect(stoppingDistance(speed, friction)).toBeCloseTo(distance, 9);
      }
      for (const speed of [0.2, 0.5, 1, 2.5, 4.5]) {
        expect(speedForStoppingDistance(stoppingDistance(speed, friction), friction)).toBeCloseTo(
          speed,
          9,
        );
      }
    }
  });

  /**
   * The knee puts a second branch in both functions, and a ball that never
   * reaches the knee is on the far side of it. Straddle the crossing
   * deliberately — the two have to remain exact inverses across it, not merely
   * on the long shots where the crossing is a rounding error.
   */
  test('and stays an exact inverse across the terminal knee', () => {
    for (const friction of CLOTH_PRESET_IDS.map(clothRollingFriction)) {
      for (const speed of [0.02, 0.08, 0.15, 0.167, 0.168, 0.169, 0.25, 0.6]) {
        expect(speedForStoppingDistance(stoppingDistance(speed, friction), friction)).toBeCloseTo(
          speed,
          9,
        );
      }
    }
  });

  /**
   * And with the object ball's backspin in it, which is the form
   * `recommendedPower` actually calls.
   */
  test('and inverts just as exactly with a negative roll fraction', () => {
    const k = objectRollFraction(0);
    for (const friction of CLOTH_PRESET_IDS.map(clothRollingFriction)) {
      for (const speed of [0.05, 0.16, 0.3, 1, 3]) {
        const distance = stoppingDistance(speed, friction, k);
        expect(speedForStoppingDistance(distance, friction, k)).toBeCloseTo(speed, 9);
      }
      for (const distance of [0.01, 0.09, 0.4, 1.2, 2.5]) {
        const speed = speedForStoppingDistance(distance, friction, k);
        expect(stoppingDistance(speed, friction, k)).toBeCloseTo(distance, 9);
      }
    }
  });

  test('a ball that is asked to travel nowhere needs no speed', () => {
    expect(speedForStoppingDistance(0)).toBe(0);
    expect(speedForStoppingDistance(-1)).toBe(0);
  });

  test('launchSpeedFor with nothing left at the end is the stopping-distance inverse', () => {
    for (const distance of [0.2, 0.8, 1.6]) {
      expect(launchSpeedFor(0, distance)).toBeCloseTo(speedForStoppingDistance(distance), 9);
    }
  });

  test('it takes the sliding branch while the ball is still sliding', () => {
    // 0.1 m is far shorter than the slide phase of a 2 m/s launch, so the whole
    // trip decelerates at mu_s*g and the closed form is the simple one.
    const sliding = Math.sqrt(4 + 2 * SLIDING_FRICTION * GRAVITY * 0.1);
    expect(launchSpeedFor(2, 0.1)).toBeCloseTo(sliding, 12);
    // Over a metre the ball is long since rolling, and the sliding form would
    // be a wild overestimate — so the branch is doing real work.
    expect(launchSpeedFor(0.5, 1)).toBeLessThan(Math.sqrt(0.25 + 2 * SLIDING_FRICTION * GRAVITY));
  });

  test('the two branches agree where they meet', () => {
    // At the end of the slide phase the ball is rolling at 5/7 of its launch.
    const launch = 1.5;
    const slidePhase = (12 * launch * launch) / (49 * SLIDING_FRICTION * GRAVITY);
    expect(launchSpeedFor((5 * launch) / 7, slidePhase)).toBeCloseTo(launch, 9);
  });

  /**
   * The algebra above is only worth anything if the simulation agrees with it,
   * so fire the computed launch speed at a real ball and read the speed off the
   * table at the requested distance. Both branches, on the slow cloth as well
   * as the normal one.
   */
  test('the simulation arrives at the requested speed, within one percent', () => {
    for (const preset of CLOTH_PRESET_IDS) {
      for (const [arrival, distance] of [
        [2, 0.1], // still sliding
        [1.2, 0.25], // still sliding
        [0.5, 1], // rolling
        [0.35, 1.5], // rolling
      ] as const) {
        const launch = launchSpeedFor(arrival, distance, clothRollingFriction(preset));
        const measured = speedAfterTravelling(launch, distance, preset);
        expect(Math.abs(measured - arrival) / arrival).toBeLessThan(0.01);
      }
    }
  });
});

describe('analyseShot', () => {
  const pocket = pocketById('top-right');

  test('a clear shot at a pocket is reachable and carries its geometry', () => {
    const object = vec(0.6, 0.2);
    const target = aimPoint(object, pocket);
    const toPocket = normalize(sub(target, object));
    const cue = sub(object, scale(toPocket, 0.5));
    const analysis = analyseShot({ cue, object, pocket, obstacles: [] });
    expect(analysis.reachable).toBe(true);
    expect(analysis.blockers).toEqual([]);
    expect(analysis.target).toEqual(target);
    expect(toDeg(analysis.cutAngle)).toBeCloseTo(0, 6);
    expect(analysis.objectToPocket).toBeCloseTo(Math.hypot(target.x - object.x, target.y - object.y), 9);
  });

  test('a shot with no clean line into the pocket is closed', () => {
    // Frozen to the top rail, sent along it at the side pocket: the ball's
    // centre runs a radius in front of the mouth and never reaches the hole.
    const object = vec(-0.4, TABLE.bounds.maxY);
    const side = pocketById('top-middle');
    const analysis = analyseShot({ cue: vec(-0.8, 0.3), object, pocket: side, obstacles: [] });
    expect(analysis.blockers).toContain('pocket-closed');
    expect(analysis.target).toEqual(side.center);
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
    const departure = normalize(sub(aimPoint(object, pocket), object));
    const ghost = ghostBallCenter(object, aimPoint(object, pocket));
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
    const departure = normalize(sub(aimPoint(object, pocket), object));
    const ghost = ghostBallCenter(object, aimPoint(object, pocket));
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
