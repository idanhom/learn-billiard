import { describe, expect, test } from 'vitest';
import { idealAimAngle, layoutWithCut } from '../../src/game/drills';
import { generateShot } from '../../src/game/generator';
import { levelById } from '../../src/game/levels';
import { powerForCueSpeed } from '../../src/game/power';
import { CREEP_SPEED, onlyCreepingLeft } from '../../src/game/replay';
import { ShotSession } from '../../src/game/shot-session';
import { speedForStoppingDistance } from '../../src/geometry/shot';
import { len, vec } from '../../src/geometry/vec2';
import { type Ball, TICK } from '../../src/physics/world';

interface Replayed {
  /** When the replay hands back, if it does before the balls settle. */
  readonly at: number | undefined;
  readonly settled: number;
  readonly firstContact: number;
  /** After the hand-back: the most any ball moved, in speed or in spin, and the events left. */
  readonly fastestAfter: number;
  readonly eventsAfter: number;
  /** Whether every ball was creeping at some tick before the first contact. */
  readonly creptBeforeContact: boolean;
}

const creeping = (balls: readonly Ball[]): boolean =>
  balls.every((ball) => ball.potted || (len(ball.vel) < CREEP_SPEED && len(ball.roll) < CREEP_SPEED));

/** A struck shot replayed tick by tick against the shot's own last event, as the app replays it. */
function replay(shot: ShotSession): Replayed {
  const watched = shot.rerun();
  watched.finish();
  const lastEvent = watched.events.at(-1)?.time ?? 0;
  const firstContact = watched.events.find((event) => event.type === 'ball-ball')?.time ?? Infinity;

  const again = shot.rerun();
  let at: number | undefined;
  let fastestAfter = 0;
  let eventsAfter = 0;
  let creptBeforeContact = false;
  while (again.phase === 'simulating') {
    const before = again.events.length;
    again.advance(TICK);
    if (at === undefined) {
      if (again.elapsed < firstContact && creeping(again.balls)) creptBeforeContact = true;
      if (again.phase === 'simulating' && onlyCreepingLeft(again.balls, again.elapsed, lastEvent)) at = again.elapsed;
      continue;
    }
    eventsAfter += again.events.length - before;
    for (const ball of again.balls) {
      if (!ball.potted) fastestAfter = Math.max(fastestAfter, len(ball.vel), len(ball.roll));
    }
  }
  return { at, settled: again.elapsed, firstContact, fastestAfter, eventsAfter, creptBeforeContact };
}

/** Struck at the recommended stroke; on the position levels with the tip they teach. */
function struck(levelId: number, seed: number, tip = 0): ShotSession {
  const { layout } = generateShot(levelById(levelId)!, seed);
  const session = new ShotSession(layout);
  session.aimTo(idealAimAngle(layout));
  session.setTip(tip);
  session.beginCharge();
  session.setPower(session.recommendedPower ?? 0.5);
  session.release();
  return session;
}

const TIPS: Record<number, number> = { 14: -0.2, 15: 0.3, 16: -0.4 };
const SHOTS = [1, 2, 3, 4, 5, 6, 14, 15, 16].flatMap((level) =>
  Array.from({ length: 6 }, (_, i) => ({ label: `level ${level}, seed ${i}`, shot: struck(level, 31_000 + i * 7919, TIPS[level]) })),
);
const REPLAYS = SHOTS.map(({ label, shot }) => ({ label, replayed: replay(shot) }));

describe('a replay hands back once only creeping is left', () => {
  test('and nothing after that is more than a creep: no contact, no cushion, no drop, no speed, no spin', () => {
    const handedBack = REPLAYS.filter(({ replayed }) => replayed.at !== undefined);
    expect(handedBack.length).toBeGreaterThan(REPLAYS.length / 2);
    for (const { label, replayed } of handedBack) {
      expect(replayed.eventsAfter, label).toBe(0);
      expect(replayed.fastestAfter, label).toBeLessThan(CREEP_SPEED);
      expect(replayed.at!, label).toBeGreaterThan(replayed.firstContact);
    }
  });

  /** At a quarter speed, a fifth of a simulated second is most of a second of watching. */
  test('which spares the crawl at the end of most shots', () => {
    const spared = REPLAYS.map(({ replayed }) => (replayed.at === undefined ? 0 : replayed.settled - replayed.at)).sort(
      (a, b) => a - b,
    );
    expect(spared[Math.floor(spared.length / 2)]).toBeGreaterThan(0.2);
  });

  /**
   * Struck to stop 3 cm past the object ball, the cue ball is creeping for its
   * last ten centimetres before it gets there, with the object ball at rest:
   * every ball creeping, and the contact still to come.
   */
  test('a soft stroke creeping up on the object ball is not cut short', () => {
    const layout = layoutWithCut('creep-up', vec(0.3, 0), 'top-right', 0, 0.6);
    const shot = new ShotSession(layout);
    shot.aimTo(idealAimAngle(layout));
    shot.beginCharge();
    shot.setPower(powerForCueSpeed(speedForStoppingDistance(0.63)));
    shot.release();
    const replayed = replay(shot);
    expect(replayed.firstContact).toBeLessThan(Infinity);
    expect(replayed.creptBeforeContact).toBe(true);
    if (replayed.at !== undefined) expect(replayed.at).toBeGreaterThan(replayed.firstContact);
  });
});
