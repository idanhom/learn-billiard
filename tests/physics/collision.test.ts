import { describe, expect, test } from 'vitest';
import { BALL_RESTITUTION, CUSHION_RESTITUTION, CUSHION_TANGENT_RETENTION } from '../../src/constants';
import { BALL_RADIUS } from '../../src/geometry/table';
import { angleOf, len, normalize, sub, vec } from '../../src/geometry/vec2';
import {
  ballBallTOI,
  ballCircleEntryTOI,
  ballSegmentTOI,
  reflectOffCushion,
  resolveBallPair,
} from '../../src/physics/collision';

const D = 2 * BALL_RADIUS;
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
    const r = resolveBallPair(vec(0, 0), vec(2, 0), vec(D, 0), vec(0, 0));
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
      const r = resolveBallPair(vec(0, 0), vec(2, 0), posB, vec(0, 0));
      const lineOfCentres = normalize(posB);
      expect(toDeg(angleOf(normalize(r!.velB)))).toBeCloseTo(toDeg(angleOf(lineOfCentres)), 9);
    }
  });

  test('a half-ball hit sends the object ball off at thirty degrees', () => {
    // Perpendicular offset of one radius: half the object ball is covered.
    const posB = vec(Math.sqrt(D * D - BALL_RADIUS * BALL_RADIUS), BALL_RADIUS);
    const r = resolveBallPair(vec(0, 0), vec(2, 0), posB, vec(0, 0));
    expect(toDeg(angleOf(r!.velB))).toBeCloseTo(30, 9);
  });

  test('momentum along the line of centres is conserved', () => {
    const posB = vec(Math.sqrt(D * D - 0.02 * 0.02), 0.02);
    const velA = vec(2, 0.3);
    const r = resolveBallPair(vec(0, 0), velA, posB, vec(0, 0));
    const n = normalize(posB);
    const before = velA.x * n.x + velA.y * n.y;
    const after = r!.velA.x * n.x + r!.velA.y * n.y + (r!.velB.x * n.x + r!.velB.y * n.y);
    expect(after).toBeCloseTo(before, 12);
  });

  test('the cue ball keeps its tangential component untouched', () => {
    const posB = vec(0, D);
    const r = resolveBallPair(vec(0, 0), vec(1, 1), posB, vec(0, 0));
    expect(r!.velA.x).toBeCloseTo(1, 12);
  });

  test('is undefined when the balls are separating', () => {
    expect(resolveBallPair(vec(0, 0), vec(-1, 0), vec(D, 0), vec(0, 0))).toBeUndefined();
  });
});

describe('cushion reflection', () => {
  const normal = vec(0, -1); // top rail, facing the table

  test('reverses and damps the normal component, retains most of the tangential', () => {
    const out = reflectOffCushion(vec(1, 2), normal);
    expect(out!.y).toBeCloseTo(-2 * CUSHION_RESTITUTION, 12);
    expect(out!.x).toBeCloseTo(1 * CUSHION_TANGENT_RETENTION, 12);
  });

  test('a ball loses speed on every cushion', () => {
    const inbound = vec(1, 2);
    expect(len(reflectOffCushion(inbound, normal)!)).toBeLessThan(len(inbound));
  });

  test('is undefined for a ball already moving away from the cushion', () => {
    expect(reflectOffCushion(vec(1, -2), normal)).toBeUndefined();
  });

  test('reflects about an arbitrary unit normal', () => {
    const n = normalize(sub(vec(0, 0), vec(1, 1)));
    const out = reflectOffCushion(vec(1, 1), n);
    expect(out!.x).toBeCloseTo(-CUSHION_RESTITUTION, 12);
    expect(out!.y).toBeCloseTo(-CUSHION_RESTITUTION, 12);
  });
});
