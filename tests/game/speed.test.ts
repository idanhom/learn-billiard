import { describe, expect, test } from 'vitest';
import { powerForCueSpeed } from '../../src/game/power';
import { ZONE_RADIUS } from '../../src/game/position';
import { ShotSession } from '../../src/game/shot-session';
import { LAG_GAP, SPEED_RUNGS, type SpeedTarget, scoreSpeed, speedLayout, speedViolations } from '../../src/game/speed';
import { speedForStoppingDistance } from '../../src/geometry/shot';
import { BALL_RADIUS, PLAY_LENGTH } from '../../src/geometry/table';
import { angleOf, dist, sub, vec } from '../../src/geometry/vec2';

/** Struck at `speed` along the layout's starting line, and played out; and the cushions the cue ball touched. */
function played(target: SpeedTarget, distance: number, seed: number, speed: number) {
  const layout = speedLayout(target, distance, seed, `speed-${seed}`);
  const session = new ShotSession(layout);
  session.beginCharge();
  session.setPower(powerForCueSpeed(speed));
  session.release();
  for (let i = 0; session.phase === 'simulating' && i < 20_000; i++) session.advance(1 / 60);
  const cushions = session.events.filter((e) => e.type === 'cushion' && e.ball === 0).length;
  return { layout, session, cushions };
}

describe('a speed layout', () => {
  test('puts the ring its rung away, with room past it, at every rung', () => {
    for (const distance of SPEED_RUNGS) {
      for (let seed = 1; seed <= 30; seed++) {
        const layout = speedLayout('distance', distance, seed, 'speed');
        expect(speedViolations(layout, 'distance'), `${distance} m, seed ${seed}`).toEqual([]);
        expect(dist(layout.cue, layout.spot!)).toBeCloseTo(distance, 9);
      }
    }
  });

  test('for the lag, puts the ring by the near cushion, down the line the ball goes out on', () => {
    const layout = speedLayout('lag', 0, 7, 'lag');
    expect(speedViolations(layout, 'lag')).toEqual([]);
    // Pointed up the table, away from its own ring.
    expect(layout.heading).toBe(0);
    expect(layout.spot!.y).toBe(layout.cue.y);
    expect(layout.spot!.x).toBeCloseTo(-PLAY_LENGTH / 2 + BALL_RADIUS + LAG_GAP, 12);
  });
});

describe('with the object ball out of play', () => {
  test('the cue ball starts aimed at the ring, touches nothing, and stops where its speed takes it', () => {
    const distance = 0.9;
    const { layout, session, cushions } = played('distance', distance, 3, speedForStoppingDistance(distance));
    expect(Math.cos(session.aimAngle - angleOf(sub(layout.spot!, layout.cue)))).toBeCloseTo(1, 12);
    expect(session.objectBall.potted).toBe(true);
    expect(session.events.filter((e) => e.type === 'ball-ball')).toEqual([]);
    expect(cushions).toBe(0);
    // Struck at the speed that stops it there, it stops in the ring.
    expect(dist(session.cueBall.pos, layout.spot!)).toBeLessThan(ZONE_RADIUS);
    const result = scoreSpeed('distance', session.cueBall.pos, layout, cushions);
    expect(result.correct).toBe(true);
  });

  test('every rung can be made', () => {
    for (const distance of SPEED_RUNGS) {
      const { layout, session, cushions } = played('distance', distance, 11, speedForStoppingDistance(distance));
      expect(scoreSpeed('distance', session.cueBall.pos, layout, cushions).correct, `${distance} m`).toBe(true);
    }
  });

  test('the lag can be made: up, off the far cushion, and back to the ring', () => {
    // Search the stroke that stops it closest to the ring, as a player would by feel.
    let best = Number.POSITIVE_INFINITY;
    let made = false;
    for (let speed = 1.2; speed <= 3.2; speed += 0.02) {
      const { layout, session, cushions } = played('lag', 0, 5, speed);
      const result = scoreSpeed('lag', session.cueBall.pos, layout, cushions);
      best = Math.min(best, result.off);
      if (result.correct) made = true;
    }
    expect(made, `closest ${best.toFixed(3)} m`).toBe(true);
  });
});

describe('a speed result', () => {
  const layout = speedLayout('distance', 0.9, 3, 'speed');

  test('fails off a cushion, however close it stops', () => {
    expect(scoreSpeed('distance', layout.spot!, layout, 1).correct).toBe(false);
  });

  test('for the lag, needs the far cushion and only that', () => {
    const lag = speedLayout('lag', 0, 7, 'lag');
    expect(scoreSpeed('lag', lag.spot!, lag, 1).correct).toBe(true);
    expect(scoreSpeed('lag', lag.spot!, lag, 2).correct).toBe(false);
    expect(scoreSpeed('lag', lag.spot!, lag, 0).correct).toBe(false);
  });

  test('is long past the ring the way the ball was going', () => {
    const along = sub(layout.spot!, layout.cue);
    const past = vec(layout.spot!.x + (along.x / 0.9) * 0.05, layout.spot!.y + (along.y / 0.9) * 0.05);
    expect(scoreSpeed('distance', past, layout, 0).long).toBeCloseTo(0.05, 9);
  });
});
