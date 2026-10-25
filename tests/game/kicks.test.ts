import { describe, expect, test } from 'vitest';
import { directPot, kickLayout, kickResult, mirrorIn, safetyLayout, safetyResult } from '../../src/game/kicks';
import { powerForCueSpeed } from '../../src/game/power';
import { ShotSession } from '../../src/game/shot-session';
import { TABLE } from '../../src/geometry/table';
import { angleOf, distanceToSegment, sub, vec } from '../../src/geometry/vec2';
import type { SimEvent } from '../../src/physics/world';

/** A kick aimed `offset` radians off the mirror point at `speed`, played out. */
function kicked(seed: number, speed: number, offset = 0) {
  const layout = kickLayout(seed, 'kick');
  const session = new ShotSession(layout);
  session.aimTo(angleOf(sub(layout.mirror!, layout.cue)) + offset);
  session.beginCharge();
  session.setPower(powerForCueSpeed(speed));
  session.release();
  for (let i = 0; session.phase === 'simulating' && i < 20_000; i++) session.advance(1 / 60);
  return kickResult(session.events);
}

describe('a kick', () => {
  test('puts a ball straight between the cue ball and the object ball, with a cushion round it', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const layout = kickLayout(seed * 7919, 'kick');
      expect(distanceToSegment(layout.obstacles![0]!, layout.cue, layout.object)).toBeLessThan(1e-9);
      expect(layout.mirror).toBeDefined();
    }
  });

  test('aims at the object ball reflected across the line its centre rolls along', () => {
    expect(mirrorIn('top', vec(0.2, 0.1))).toEqual(vec(0.2, 2 * TABLE.bounds.maxY - 0.1));
    expect(mirrorIn('left', vec(0.2, 0.1))).toEqual(vec(2 * TABLE.bounds.minX - 0.2, 0.1));
  });

  /**
   * The mirror is a place to start. Aimed straight at it, a firm kick gets
   * there in most layouts and a soft one in few: a rolling ball's spin bends
   * its path as it comes off the cushion. The README quotes these.
   */
  test('aimed at the mirror, gets there at 2.5 m/s in most layouts and at 1.2 m/s in few', () => {
    const rate = (speed: number): number => {
      let made = 0;
      for (let seed = 1; seed <= 60; seed++) if (kicked(seed * 7919, speed) === 'kicked') made++;
      return made / 60;
    };
    expect(rate(2.5)).toBeGreaterThan(0.5);
    expect(rate(1.2)).toBeLessThan(0.15);
  });

  test('can always be made, with an aim found near the mirror and the pace to get there', () => {
    for (let seed = 1; seed <= 12; seed++) {
      let made = false;
      for (const speed of [1.8, 2.5]) {
        for (let step = -12; step <= 12 && !made; step++) {
          if (kicked(seed * 7919, speed, (step * 0.25 * Math.PI) / 180) === 'kicked') made = true;
        }
      }
      expect(made, `seed ${seed}`).toBe(true);
    }
  });

  test('counts a cushion, then the object ball before any other', () => {
    const cushion: SimEvent = { type: 'cushion', time: 0.1, ball: 0, speed: 1 };
    const object: SimEvent = { type: 'ball-ball', time: 0.3, a: 0, b: 1, speed: 1 };
    const other: SimEvent = { type: 'ball-ball', time: 0.2, a: 2, b: 0, speed: 1 };
    expect(kickResult([cushion, object])).toBe('kicked');
    expect(kickResult([object])).toBe('no-cushion');
    expect(kickResult([cushion, other])).toBe('other-ball');
    expect(kickResult([cushion])).toBe('missed');
  });
});

describe('a safety', () => {
  test('starts with a straight hit on the object ball, and a pot there to be refused', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const layout = safetyLayout(seed * 7919, 'safety');
      for (const other of layout.obstacles!) {
        expect(distanceToSegment(other, layout.cue, layout.object)).toBeGreaterThan(0.08);
      }
      expect(directPot(layout.cue, layout.object, layout.obstacles!)).toBeDefined();
    }
  });

  test('is safe when a ball hides the object ball from every pocket\\u2019s line', () => {
    // Straight behind a ball, in line with the object ball: nothing to see.
    const object = vec(0.4, 0);
    const hide = vec(0.2, 0);
    expect(directPot(vec(0, 0), object, [hide])).toBeUndefined();
  });

  test('is judged on a legal hit, nothing down, and no pot left', () => {
    const hit: SimEvent[] = [{ type: 'ball-ball', time: 0.2, a: 0, b: 1, speed: 1 }];
    const still = { pos: vec(0, 0), potted: false };
    expect(safetyResult(hit, { pos: vec(0, 0), potted: true }, still, [])).toEqual({ kind: 'scratch' });
    expect(safetyResult([], still, { pos: vec(0.4, 0), potted: false }, []).kind).toBe('foul');
    expect(safetyResult(hit, still, { pos: vec(0.4, 0), potted: true }, []).kind).toBe('potted');
    expect(safetyResult(hit, still, { pos: vec(0.4, 0), potted: false }, [vec(0.2, 0)])).toEqual({ kind: 'safe' });
  });
});
