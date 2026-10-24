import { describe, expect, test } from 'vitest';
import {
  CLOTH_PRESET_IDS,
  MAX_CUE_SPEED,
  MIN_CUE_SPEED,
  clothRollingFriction,
} from '../../src/constants';
import {
  type ShotAnalysis,
  analyseShot,
  fullness,
  ghostBallCenter,
} from '../../src/geometry/shot';
import { pocketById } from '../../src/geometry/table';
import { normalize, rotate, scale, sub, vec, add } from '../../src/geometry/vec2';
import { idealAimAngle } from '../../src/game/drills';
import { generateShot } from '../../src/game/generator';
import { LEVELS } from '../../src/game/levels';
import {
  cueSpeedForPower,
  powerForCueSpeed,
  recommendedPower,
  speedBand,
} from '../../src/game/power';
import { ShotSession } from '../../src/game/shot-session';

const deg = (d: number) => (d * Math.PI) / 180;

/** A shot with exactly the geometry the recommendation cares about. */
function shot(objectToPocket: number, cueToGhost: number, cut = 0): ShotAnalysis {
  return {
    target: vec(objectToPocket, 0),
    ghostCenter: vec(0, 0),
    throwAngle: 0,
    launchSpeed: 1,
    aimDirection: vec(1, 0),
    cutAngle: cut,
    cutSide: cut === 0 ? 'straight' : 'left',
    fullness: fullness(cut),
    cueToGhost,
    objectToPocket,
    reachable: true,
    blockers: [],
  };
}

describe('the power curve', () => {
  test('spans exactly the legal range of strokes', () => {
    expect(cueSpeedForPower(0)).toBeCloseTo(MIN_CUE_SPEED, 12);
    expect(cueSpeedForPower(1)).toBeCloseTo(MAX_CUE_SPEED, 12);
  });

  test('is strictly increasing, so no two readings are the same stroke', () => {
    let previous = cueSpeedForPower(0);
    for (let power = 0.01; power <= 1.000001; power += 0.01) {
      const speed = cueSpeedForPower(power);
      expect(speed).toBeGreaterThan(previous);
      previous = speed;
    }
  });

  test('readings outside the meter pin to its ends rather than escaping the range', () => {
    expect(cueSpeedForPower(-2)).toBe(MIN_CUE_SPEED);
    expect(cueSpeedForPower(4)).toBe(MAX_CUE_SPEED);
  });

  test('powerForCueSpeed round-trips cueSpeedForPower', () => {
    for (let power = 0; power <= 1.000001; power += 0.05) {
      expect(powerForCueSpeed(cueSpeedForPower(power))).toBeCloseTo(Math.min(power, 1), 9);
    }
    for (const speed of [0.4, 0.8, 1.5, 3, 4.4]) {
      expect(cueSpeedForPower(powerForCueSpeed(speed))).toBeCloseTo(speed, 9);
    }
  });

  test('speeds off either end of the meter pin to its ends', () => {
    expect(powerForCueSpeed(MIN_CUE_SPEED - 1)).toBe(0);
    expect(powerForCueSpeed(MAX_CUE_SPEED + 1)).toBe(1);
  });

  /**
   * The whole point of the exponent. An ordinary pot — 0.6 m to the pocket,
   * half a metre of cue-ball travel, normal cloth — has to land in the middle
   * of the meter, not in the first fifth of it.
   */
  test('a typical pot lands in the middle of the meter', () => {
    const power = recommendedPower(shot(0.6, 0.5))!;
    expect(power).toBeGreaterThan(0.35);
    expect(power).toBeLessThan(0.5);
  });

  test('the curve is what puts it there — a linear meter would not', () => {
    const speed = cueSpeedForPower(recommendedPower(shot(0.6, 0.5))!);
    const linear = (speed - MIN_CUE_SPEED) / (MAX_CUE_SPEED - MIN_CUE_SPEED);
    // Same stroke, same range, read off a straight line: the bottom quarter of
    // the bar, with the other three quarters spent on shots nobody plays here.
    expect(linear).toBeLessThan(0.25);
    expect(recommendedPower(shot(0.6, 0.5))!).toBeGreaterThan(linear * 1.75);
  });
});

describe('speed bands', () => {
  test('name the stroke the way a table does', () => {
    expect(speedBand(0.35)).toBe('soft touch');
    expect(speedBand(0.44)).toBe('soft touch');
    expect(speedBand(0.81)).toBe('slow');
    expect(speedBand(1.14)).toBe('medium');
    expect(speedBand(2.11)).toBe('fast');
    expect(speedBand(4.5)).toBe('power');
  });

  test('every reading on the meter has a name, and they only ever climb', () => {
    const order = ['soft touch', 'slow', 'medium', 'fast', 'power'];
    let seen = 0;
    for (let power = 0; power <= 1.000001; power += 0.01) {
      const index = order.indexOf(speedBand(cueSpeedForPower(power)));
      expect(index).toBeGreaterThanOrEqual(seen);
      seen = index;
    }
    expect(seen).toBe(order.length - 1);
  });
});

describe('the recommended power', () => {
  /**
   * Seeded, so this is exact rather than a rate. One caveat if it ever starts
   * failing on level 5 alone: on a thin cut the cue ball keeps nearly all of
   * its speed, and it can come back off two cushions into the object ball
   * before the ball has finished creeping in — once in 500 seeded level-5
   * layouts, measured when the fast roll step went. That is the cue-ball path
   * spoiling a correct stroke, not a wrong recommendation — check the shot for
   * a second ball-ball event before blaming the arithmetic.
   */
  test('pots the target across generated layouts, on every level', () => {
    for (const level of LEVELS) {
      for (let i = 0; i < 10; i++) {
        const { layout } = generateShot(level, 3000 + i * 7919, {
          preferredSide: i % 2 === 0 ? 'left' : 'right',
        });
        const session = new ShotSession(layout);
        const power = session.recommendedPower;
        expect(power, `level ${level.id} shot ${i} has no recommendation`).not.toBeNull();

        session.aimTo(idealAimAngle(layout));
        session.beginCharge();
        session.setPower(power!);
        session.release();
        for (let tick = 0; tick < 60 * 30 && session.phase === 'simulating'; tick++) {
          session.advance(1 / 60);
        }
        const outcome = session.evaluate();
        expect(outcome?.pottedTarget, `level ${level.id} shot ${i} at ${power}`).toBe(true);
      }
    }
  });

  test('is null when the cut is too thin for any legal stroke', () => {
    const pocket = pocketById('top-right');
    const object = vec(-0.85, 0.4);
    const departure = normalize(sub(pocket.center, object));
    const ghost = ghostBallCenter(object, pocket.center);
    // 84 degrees, the length of the table: legal to attempt, impossible to make.
    const cue = add(ghost, scale(rotate(departure, deg(-96)), 0.3));
    const analysis = analyseShot({ cue, object, pocket, obstacles: [] });
    expect(analysis.blockers).toContain('underpowered');
    expect(recommendedPower(analysis)).toBeNull();
  });

  test('a cut past ninety degrees drives the ball nowhere at all', () => {
    expect(recommendedPower(shot(0.6, 0.5, deg(90)))).toBeNull();
    expect(recommendedPower(shot(0.6, 0.5, deg(120)))).toBeNull();
  });

  test('asks for more of the meter as the cut thins', () => {
    const straight = recommendedPower(shot(0.6, 0.5, 0))!;
    const half = recommendedPower(shot(0.6, 0.5, deg(30)))!;
    const thin = recommendedPower(shot(0.6, 0.5, deg(70)))!;
    expect(half).toBeGreaterThan(straight);
    expect(thin).toBeGreaterThan(half);
  });

  test('is lower on fast cloth than on slow — it is advice about this table', () => {
    const analysis = shot(0.8, 0.6, deg(20));
    const [fast, normal, slow] = CLOTH_PRESET_IDS.map(
      (preset) => recommendedPower(analysis, clothRollingFriction(preset))!,
    );
    expect(fast).toBeLessThan(normal!);
    expect(normal!).toBeLessThan(slow!);
  });

  test('the session recommends on the cloth in play, not on a fixed one', () => {
    const [layout] = [generateShot(LEVELS[2]!, 4242, { preferredSide: 'left' }).layout];
    const on = (cloth: 'fast' | 'slow') => new ShotSession(layout, { cloth }).recommendedPower!;
    expect(on('fast')).toBeLessThan(on('slow'));
  });
});
