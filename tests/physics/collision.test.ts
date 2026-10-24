import { describe, expect, test } from 'vitest';
import { BALL_CONTACT_FRICTION, BALL_RESTITUTION } from '../../src/constants';
import { BALL_RADIUS } from '../../src/geometry/table';
import { type Vec2, add, angleOf, dot, len, lenSq, normalize, scale, vec } from '../../src/geometry/vec2';
import {
  ballBallTOI,
  ballCircleEntryTOI,
  ballSegmentTOI,
  resolveBallPair,
  resolveCushion,
} from '../../src/physics/collision';
import { lcg } from '../support/random';

const D = 2 * BALL_RADIUS;

/** A ball with no spin of its own. */
const STILL = vec(0, 0);

const toDeg = (r: number) => (r * 180) / Math.PI;

describe('ball-ball time of impact', () => {
  test('finds the moment two closing balls touch', () => {
    const t = ballBallTOI(vec(0, 0), vec(1, 0), vec(1, 0), vec(0, 0), D, 10);
    expect(t).toBeCloseTo(1 - D, 9);
  });

  test('is undefined when the balls are separating', () => {
    expect(ballBallTOI(vec(0, 0), vec(-1, 0), vec(1, 0), vec(0, 0), D, 10)).toBeUndefined();
  });

  test('is undefined when the paths never bring them within a diameter', () => {
    expect(ballBallTOI(vec(0, 0), vec(1, 0), vec(1, 0.5), vec(0, 0), D, 10)).toBeUndefined();
  });

  test('is undefined when contact happens after the time budget', () => {
    expect(ballBallTOI(vec(0, 0), vec(1, 0), vec(1, 0), vec(0, 0), D, 0.5)).toBeUndefined();
  });

  test('reports zero for balls already overlapping and still closing', () => {
    expect(ballBallTOI(vec(0, 0), vec(1, 0), vec(D - 0.001, 0), vec(0, 0), D, 10)).toBe(0);
  });
});

describe('ball-segment time of impact', () => {
  const rail = { a: vec(-1, 1), b: vec(1, 1), normal: vec(0, -1) };

  test('finds the moment a ball reaches one radius from the rail face', () => {
    const hit = ballSegmentTOI(vec(0, 0), vec(0, 1), rail, BALL_RADIUS, 10);
    expect(hit?.time).toBeCloseTo(1 - BALL_RADIUS, 9);
    expect(hit?.normal.y).toBeCloseTo(-1, 9);
  });

  test('is undefined for a ball moving away from the rail', () => {
    expect(ballSegmentTOI(vec(0, 0), vec(0, -1), rail, BALL_RADIUS, 10)).toBeUndefined();
  });

  test('is undefined when the contact point falls beyond the segment ends', () => {
    expect(ballSegmentTOI(vec(5, 0), vec(0, 1), rail, BALL_RADIUS, 10)).toBeUndefined();
  });

  test('catches the cushion nose as a rounded end cap', () => {
    // Approaching the end of the rail from beyond it: the face is out of range,
    // but the nose itself is in the way.
    const hit = ballSegmentTOI(vec(1.5, 1), vec(-1, 0), rail, BALL_RADIUS, 10);
    expect(hit?.time).toBeCloseTo(0.5 - BALL_RADIUS, 9);
    expect(hit?.normal.x).toBeCloseTo(1, 6);
  });
});

describe('pocket entry time', () => {
  test('finds when the ball centre crosses into the capture circle', () => {
    const t = ballCircleEntryTOI(vec(0, 0), vec(1, 0), vec(1, 0), 0.05, 10);
    expect(t).toBeCloseTo(0.95, 9);
  });

  test('reports zero when the centre is already inside', () => {
    expect(ballCircleEntryTOI(vec(0, 0), vec(1, 0), vec(0.01, 0), 0.05, 10)).toBe(0);
  });

  test('is undefined when the ball passes the pocket by', () => {
    expect(ballCircleEntryTOI(vec(0, 0), vec(1, 0), vec(1, 0.5), 0.05, 10)).toBeUndefined();
  });
});

describe('ball-ball resolution', () => {
  test('a dead straight hit transfers 97.5 percent of the speed at e = 0.95', () => {
    const r = resolveBallPair(vec(0, 0), vec(2, 0), STILL, vec(D, 0), vec(0, 0), STILL);
    expect(r).toBeDefined();
    expect(r!.velB.x).toBeCloseTo(2 * ((1 + BALL_RESTITUTION) / 2), 12);
    expect(r!.velA.x).toBeCloseTo(2 * (1 - (1 + BALL_RESTITUTION) / 2), 12);
    expect(r!.velA.y).toBeCloseTo(0, 12);
    expect(r!.velB.y).toBeCloseTo(0, 12);
  });

  test('the struck ball leaves along the line of centres', () => {
    for (const offsetFraction of [0, 0.25, 0.5, 0.75]) {
      const offset = D * offsetFraction;
      const posB = vec(Math.sqrt(D * D - offset * offset), offset);
      const r = resolveBallPair(vec(0, 0), vec(2, 0), STILL, posB, vec(0, 0), STILL);
      const lineOfCentres = normalize(posB);
      expect(toDeg(angleOf(normalize(r!.velB)))).toBeCloseTo(toDeg(angleOf(lineOfCentres)), 9);
    }
  });

  test('a half-ball hit sends the object ball off at thirty degrees', () => {
    // Perpendicular offset of one radius: half the object ball is covered.
    const posB = vec(Math.sqrt(D * D - BALL_RADIUS * BALL_RADIUS), BALL_RADIUS);
    const r = resolveBallPair(vec(0, 0), vec(2, 0), STILL, posB, vec(0, 0), STILL);
    expect(toDeg(angleOf(r!.velB))).toBeCloseTo(30, 9);
  });

  test('momentum along the line of centres is conserved', () => {
    const posB = vec(Math.sqrt(D * D - 0.02 * 0.02), 0.02);
    const velA = vec(2, 0.3);
    const r = resolveBallPair(vec(0, 0), velA, STILL, posB, vec(0, 0), STILL);
    const n = normalize(posB);
    const before = velA.x * n.x + velA.y * n.y;
    const after = r!.velA.x * n.x + r!.velA.y * n.y + (r!.velB.x * n.x + r!.velB.y * n.y);
    expect(after).toBeCloseTo(before, 12);
  });

  test('the cue ball keeps its tangential component untouched', () => {
    const posB = vec(0, D);
    const r = resolveBallPair(vec(0, 0), vec(1, 1), STILL, posB, vec(0, 0), STILL);
    expect(r!.velA.x).toBeCloseTo(1, 12);
  });

  test('is undefined when the balls are separating', () => {
    expect(resolveBallPair(vec(0, 0), vec(-1, 0), STILL, vec(D, 0), vec(0, 0), STILL)).toBeUndefined();
  });
});

describe('contact friction', () => {
  /** Rolling ball into a still one, dead straight along +x. */
  const squareHit = (speed: number) =>
    resolveBallPair(vec(0, 0), vec(speed, 0), vec(speed, 0), vec(D, 0), vec(0, 0), vec(0, 0))!;

  /**
   * The sign, pinned. This is the assertion that would have caught the first
   * draft of this model, which had the object ball picking up follow.
   *
   * The two contact faces sit on opposite sides of their centres and mesh like
   * gear teeth, so a cue ball rolling FORWARD lays BACKSPIN on the object ball.
   * Published billiards physics agrees: spin transfers reversed, which is why
   * left english arrives as right english.
   */
  test('leaves the object ball spinning against its own direction of travel', () => {
    const r = squareHit(2);
    expect(r.velB.x).toBeGreaterThan(0);
    expect(r.rollB.x).toBeLessThan(0);
    expect(dot(r.rollB, r.velB)).toBeLessThan(0);
  });

  test('by exactly the closed form the analytic layer assumes', () => {
    const r = squareHit(2);
    expect(r.rollB.x / r.velB.x).toBeCloseTo(-2.5 * BALL_CONTACT_FRICTION, 12);
  });

  test('takes topspin off the cue ball at the same time', () => {
    const r = squareHit(2);
    expect(r.rollA.x).toBeLessThan(2);
    expect(r.rollA.x).toBeGreaterThan(0);
  });

  /**
   * Both balls are torqued the SAME way, so it is the difference of the rolls
   * that survives, not the sum. Getting this backwards is the same error as
   * getting the sign backwards — it is the same fact stated twice.
   */
  test('conserves the difference of the rolls along the line of centres', () => {
    for (const offsetFraction of [0, 0.3, 0.6, 0.9]) {
      const offset = D * offsetFraction;
      const posB = vec(Math.sqrt(D * D - offset * offset), offset);
      const n = normalize(posB);
      const rollA = vec(1.7, -0.4);
      const rollB = vec(0.2, 0.9);
      const r = resolveBallPair(vec(0, 0), vec(2, 0.1), rollA, posB, vec(0, 0), rollB)!;
      expect(dot(r.rollA, n) - dot(r.rollB, n)).toBeCloseTo(dot(rollA, n) - dot(rollB, n), 12);
    }
  });

  /**
   * Passive by construction, in the same spirit as the cushion model: the
   * contact can only take roll energy out. The linear energy cannot rise
   * either — the friction's linear impulse is discarded, not applied.
   */
  test('never adds roll energy, at any spin state or cut angle', () => {
    const random = lcg(20260729);
    for (let i = 0; i < 500; i++) {
      const offset = D * random() * 0.99;
      const posB = vec(Math.sqrt(D * D - offset * offset), offset);
      const velA = vec(0.2 + 4 * random(), 2 * random() - 1);
      const rollA = vec(4 * random() - 2, 4 * random() - 2);
      const rollB = vec(4 * random() - 2, 4 * random() - 2);
      const r = resolveBallPair(vec(0, 0), velA, rollA, posB, vec(0, 0), rollB);
      if (!r) continue;
      const before = lenSq(rollA) + lenSq(rollB);
      const after = lenSq(r.rollA) + lenSq(r.rollB);
      expect(after).toBeLessThanOrEqual(before + 1e-12);
    }
  });

  /**
   * Only the vertical share is applied, so the horizontal share — which is
   * exactly throw — never reaches the object ball. The trainer scores aim to
   * within a degree or two against the ghost-ball line, so this has to stay
   * exact rather than merely small.
   */
  test('produces no throw: the object ball still leaves along the line of centres', () => {
    for (const offsetFraction of [0.1, 0.4, 0.7, 0.95]) {
      const offset = D * offsetFraction;
      const posB = vec(Math.sqrt(D * D - offset * offset), offset);
      const r = resolveBallPair(vec(0, 0), vec(2, 0), vec(2, 0), posB, vec(0, 0), vec(0, 0))!;
      expect(toDeg(angleOf(normalize(r.velB)))).toBeCloseTo(toDeg(angleOf(normalize(posB))), 9);
    }
  });

  /**
   * A dead-straight contact between a still-sliding cue ball and a still object
   * ball slips nowhere at all: no roll on either, no cut. Unguarded the
   * friction share is 0*(0/0), and the NaN would poison both rolls from there
   * on and never wash out.
   */
  test('a straight stun contact resolves without dividing by zero', () => {
    const r = resolveBallPair(vec(0, 0), vec(2, 0), STILL, vec(D, 0), vec(0, 0), STILL)!;
    for (const v of [r.velA, r.velB, r.rollA, r.rollB]) {
      expect(Number.isFinite(v.x) && Number.isFinite(v.y)).toBe(true);
    }
    expect(r.rollA).toEqual(STILL);
    expect(r.rollB).toEqual(STILL);
  });

  /**
   * The cap is on the APPLIED vertical share, not on the total friction
   * impulse: |W|/5 is precisely the impulse that zeroes the vertical slip, so
   * when it binds the surfaces come out meshed and not reversed.
   */
  test('caps the applied share at the impulse that meshes the surfaces', () => {
    const rollA = vec(0.001, 0);
    const r = resolveBallPair(vec(0, 0), vec(10, 0.01), rollA, vec(D, 0), vec(0, 0), STILL)!;
    const n = vec(1, 0);
    // Uncapped, Coulomb would have taken far more than this.
    expect(BALL_CONTACT_FRICTION * 0.975 * 10).toBeGreaterThan(Math.abs(rollA.x) / 5);
    expect(dot(add(r.rollA, r.rollB), n)).toBeCloseTo(0, 12);
  });
});

/** 15 degrees off the rail: a genuinely glancing contact. */
const GLANCING = (15 * Math.PI) / 180;

describe('cushion impulse', () => {
  // A rail along the top of the table; the normal faces back into the playing
  // surface, which is the side the ball arrives from.
  const normal = vec(0, -1);

  /** Speed a ball settles at once the cloth has resolved the slip it leaves with. */
  function settledSpeed(vel: Vec2, roll: Vec2): number {
    return len(add(scale(vel, 5 / 7), scale(roll, 2 / 7)));
  }

  /** The energy this model actually tracks: translation plus ball rotation. */
  function modelledEnergy(vel: Vec2, roll: Vec2): number {
    return 0.5 * lenSq(vel) + 0.2 * lenSq(roll);
  }

  test('is undefined for a ball already moving away from the cushion', () => {
    expect(resolveCushion(vec(1, -2), vec(1, -2), normal)).toBeUndefined();
  });

  /**
   * The published ball-rail coefficient of restitution is 0.6-0.9 (Alciatore,
   * "physical properties"), and both of these used to sit far apart: a rolling
   * ball at 0.65, a stun ball at 0.31 — the old impulse could only turn the
   * ball by pushing above its centre, so a ball without topspin to give up came
   * off half-dead. With the normal through the centre and friction at the nose,
   * both land in the published range.
   */
  test('a rolling ball hitting the rail square rebounds within the published range', () => {
    const inbound = vec(0, 2);
    const out = resolveCushion(inbound, inbound, normal)!;
    expect(-out.vel.y / inbound.y).toBeGreaterThan(0.6);
    expect(-out.vel.y / inbound.y).toBeLessThan(0.9);
  });

  test('and so does a stun ball, which used to come off at 0.31', () => {
    const inbound = vec(0, 2);
    const out = resolveCushion(inbound, STILL, normal)!;
    expect(-out.vel.y / inbound.y).toBeGreaterThan(0.6);
    expect(-out.vel.y / inbound.y).toBeLessThan(0.9);
  });

  /**
   * The measurements the cushion constants are fitted to: Alciatore's
   * high-speed video of square hits on typical cloth (HSV B.15). A rolling
   * ball comes off at 0.72 and settles at 0.52; a stun ball comes off at 0.58
   * and settles at 0.54. Single shots, so held loosely, but held.
   */
  test('a rolling ball lands near the measured 0.72 off the rail and 0.52 once it rolls', () => {
    const inbound = vec(0, 2);
    const out = resolveCushion(inbound, inbound, normal)!;
    expect(Math.abs(-out.vel.y / inbound.y - 0.72)).toBeLessThan(0.03);
    expect(Math.abs(settledSpeed(out.vel, out.roll) / len(inbound) - 0.52)).toBeLessThan(0.05);
  });

  test('and a stun ball near the measured 0.58 off the rail and 0.54 once it rolls', () => {
    const inbound = vec(0, 2);
    const out = resolveCushion(inbound, STILL, normal)!;
    expect(Math.abs(-out.vel.y / inbound.y - 0.58)).toBeLessThan(0.07);
    expect(Math.abs(settledSpeed(out.vel, out.roll) / len(inbound) - 0.54)).toBeLessThan(0.05);
  });

  /**
   * The model's one known miss, pinned so it cannot change unnoticed. Measured,
   * a ball with draw comes off the rail FASTER than a stun ball (0.71 against
   * 0.58 in HSV B.15). Here it is the other way round, because Han has no table
   * friction during the impact. Nothing in the trainer draws yet; when
   * something does, this is the test to turn round.
   */
  test('draw comes off slower than stun here, the reverse of the measurement', () => {
    const inbound = vec(0, 2);
    const draw = resolveCushion(inbound, vec(0, -1), normal)!;
    const stun = resolveCushion(inbound, STILL, normal)!;
    expect(-draw.vel.y).toBeLessThan(-stun.vel.y);
  });

  /**
   * What friction at the nose does to the spin, and the reason it is there. The
   * nose sits above the centre, so a rolling ball's surface rubs DOWN the
   * cushion and friction fights its topspin; a stun ball's surface barely
   * moves there, and friction winds topspin up in the direction it leaves.
   */
  test('the nose fights a rolling ball’s topspin down and winds a stun ball’s up', () => {
    const inbound = vec(0, 2);
    const away = vec(0, -1);
    const rolling = resolveCushion(inbound, inbound, normal)!;
    const stun = resolveCushion(inbound, STILL, normal)!;
    expect(dot(rolling.roll, away)).toBeLessThan(0); // still turning toward the rail
    expect(dot(stun.roll, away)).toBeGreaterThan(0); // turning the way it now goes
  });

  test('and it costs a ball some of its run along the rail', () => {
    const inbound = vec(Math.SQRT1_2, Math.SQRT1_2);
    const out = resolveCushion(inbound, STILL, normal)!;
    expect(out.vel.x).toBeGreaterThan(0);
    expect(out.vel.x).toBeLessThan(inbound.x);
  });

  test('and once the skid is done it has lost about half its speed', () => {
    const inbound = vec(0, 2);
    const out = resolveCushion(inbound, inbound, normal)!;
    const retained = settledSpeed(out.vel, out.roll) / len(inbound);
    expect(retained).toBeGreaterThan(0.45);
    expect(retained).toBeLessThan(0.6);
  });

  test('the rail leaves the ball spinning the wrong way, which is what costs it', () => {
    const inbound = vec(0, 2);
    const out = resolveCushion(inbound, inbound, normal)!;
    // Velocity is now heading away from the rail while the roll barely is:
    // that mismatch is the skid.
    expect(out.vel.y).toBeLessThan(0);
    expect(Math.abs(out.roll.y)).toBeLessThan(Math.abs(out.vel.y));
  });

  test('a glancing hit costs almost nothing', () => {
    // 15 degrees off the rail.
    const inbound = vec(Math.cos(GLANCING), Math.sin(GLANCING));
    const out = resolveCushion(inbound, inbound, normal)!;
    expect(settledSpeed(out.vel, out.roll) / len(inbound)).toBeGreaterThan(0.85);
  });

  test('steeper hits cost more than glancing ones', () => {
    const retained = [10, 30, 60, 90].map((degrees) => {
      const angle = (degrees * Math.PI) / 180;
      const inbound = vec(Math.cos(angle), Math.sin(angle));
      const out = resolveCushion(inbound, inbound, normal)!;
      return settledSpeed(out.vel, out.roll) / len(inbound);
    });
    for (let i = 1; i < retained.length; i++) {
      expect(retained[i]!).toBeLessThan(retained[i - 1]!);
    }
  });

  test('works about an arbitrary unit normal', () => {
    const n = normalize(vec(-1, -1));
    const inbound = vec(1, 1);
    const out = resolveCushion(inbound, inbound, n)!;
    expect(dot(out.vel, n)).toBeGreaterThan(0); // sent back into the table
    expect(len(out.vel)).toBeLessThan(len(inbound));
  });

  /**
   * The property that matters most. A rail is passive: it can never hand a ball
   * more energy than it arrived with, whatever that ball happened to be doing.
   *
   * Sweeping only pure-rolling approaches would miss this entirely — the states
   * that break a naive impulse are the ones where roll opposes velocity, which
   * resolveBallPair produces routinely because it changes velocity and leaves
   * roll alone.
   */
  test('never gives a ball more energy than it arrived with, at any spin', () => {
    for (let degrees = 5; degrees <= 90; degrees += 5) {
      const angle = (degrees * Math.PI) / 180;
      const vel = vec(Math.cos(angle), Math.sin(angle));
      for (let rollX = -3; rollX <= 3; rollX += 0.5) {
        for (let rollY = -3; rollY <= 3; rollY += 0.5) {
          const roll = vec(rollX, rollY);
          const out = resolveCushion(vel, roll, normal);
          if (!out) continue;
          expect(
            modelledEnergy(out.vel, out.roll),
            `angle ${degrees} roll ${rollX},${rollY}`,
          ).toBeLessThanOrEqual(modelledEnergy(vel, roll) + 1e-12);
        }
      }
    }
  });

  test('a ball whose spin fights its motion still loses energy', () => {
    // The case that broke a centre-velocity impulse: rolling away, moving in.
    const vel = vec(0, 1);
    const roll = vec(0, -1);
    const out = resolveCushion(vel, roll, normal)!;
    expect(modelledEnergy(out.vel, out.roll)).toBeLessThan(modelledEnergy(vel, roll));
  });
});
