import { describe, expect, test } from 'vitest';
import { dot, len, sub, vec } from '../../src/geometry/vec2';
import {
  BALL_MASS,
  BALL_RADIUS,
  POCKET_IDS,
  TABLE,
  capturingPocket,
  isInLegalBounds,
  pocketById,
} from '../../src/geometry/table';

describe('table constants', () => {
  test('models a 7-foot playing surface with a regulation ball', () => {
    expect(TABLE.playLength).toBeCloseTo(1.98, 6);
    expect(TABLE.playWidth).toBeCloseTo(0.99, 6);
    expect(BALL_RADIUS).toBeCloseTo(0.028575, 9);
    expect(BALL_MASS).toBeCloseTo(0.17, 6);
  });

  test('the playing surface is twice as long as it is wide', () => {
    expect(TABLE.playLength / TABLE.playWidth).toBeCloseTo(2, 9);
  });
});

describe('legal ball-centre bounds', () => {
  test('are the playing surface inset by one ball radius', () => {
    expect(TABLE.bounds.minX).toBeCloseTo(-TABLE.playLength / 2 + BALL_RADIUS, 9);
    expect(TABLE.bounds.maxX).toBeCloseTo(TABLE.playLength / 2 - BALL_RADIUS, 9);
    expect(TABLE.bounds.minY).toBeCloseTo(-TABLE.playWidth / 2 + BALL_RADIUS, 9);
    expect(TABLE.bounds.maxY).toBeCloseTo(TABLE.playWidth / 2 - BALL_RADIUS, 9);
  });

  test('accept the table centre and reject a point beyond the cushion', () => {
    expect(isInLegalBounds(vec(0, 0))).toBe(true);
    expect(isInLegalBounds(vec(TABLE.playLength / 2, 0))).toBe(false);
    expect(isInLegalBounds(vec(0, TABLE.playWidth / 2))).toBe(false);
  });

  test('accept a ball touching the cushion nose and reject one a hair past it', () => {
    expect(isInLegalBounds(vec(0, TABLE.bounds.maxY))).toBe(true);
    expect(isInLegalBounds(vec(0, TABLE.bounds.maxY + 1e-6))).toBe(false);
  });

  test('an inset margin shrinks the accepted region', () => {
    expect(isInLegalBounds(vec(0, TABLE.bounds.maxY), 0.01)).toBe(false);
    expect(isInLegalBounds(vec(0, TABLE.bounds.maxY - 0.01), 0.01)).toBe(true);
  });
});

describe('pockets', () => {
  test('there are six, four corner and two side', () => {
    expect(TABLE.pockets).toHaveLength(6);
    expect(TABLE.pockets.filter((p) => p.kind === 'corner')).toHaveLength(4);
    expect(TABLE.pockets.filter((p) => p.kind === 'side')).toHaveLength(2);
    expect(POCKET_IDS).toHaveLength(6);
  });

  test('corners sit at the playing-surface corners and sides at the long-rail midpoints', () => {
    const halfL = TABLE.playLength / 2;
    const halfW = TABLE.playWidth / 2;
    expect(pocketById('top-right').center).toEqual(vec(halfL, halfW));
    expect(pocketById('top-left').center).toEqual(vec(-halfL, halfW));
    expect(pocketById('bottom-right').center).toEqual(vec(halfL, -halfW));
    expect(pocketById('bottom-left').center).toEqual(vec(-halfL, -halfW));
    expect(pocketById('top-middle').center).toEqual(vec(0, halfW));
    expect(pocketById('bottom-middle').center).toEqual(vec(0, -halfW));
  });

  test('corner pockets have a wider capture circle than side pockets', () => {
    expect(pocketById('top-right').captureRadius).toBeGreaterThan(
      pocketById('top-middle').captureRadius,
    );
  });

  test('every pocket has an inward aim direction pointing at the table interior', () => {
    for (const pocket of TABLE.pockets) {
      expect(len(pocket.inward)).toBeCloseTo(1, 9);
      expect(dot(pocket.inward, sub(vec(0, 0), pocket.center))).toBeGreaterThan(0);
    }
  });

  test('a ball resting against a cushion nose beside a pocket is not captured', () => {
    // Just short of the top-right corner mouth, hard against the long rail.
    const restingOnRail = vec(TABLE.playLength / 2 - 0.1, TABLE.bounds.maxY);
    expect(capturingPocket(restingOnRail)).toBeUndefined();
    // Beside the top-middle mouth, hard against the same rail.
    const besideSide = vec(0.1, TABLE.bounds.maxY);
    expect(capturingPocket(besideSide)).toBeUndefined();
  });

  test('a ball centred in a pocket mouth is captured by that pocket', () => {
    expect(capturingPocket(vec(0, TABLE.bounds.maxY))?.id).toBe('top-middle');
    const corner = vec(TABLE.playLength / 2 - BALL_RADIUS, TABLE.playWidth / 2 - BALL_RADIUS);
    expect(capturingPocket(corner)?.id).toBe('top-right');
  });

  test('a ball that has escaped the playing surface is captured by the nearest pocket', () => {
    const escaped = vec(TABLE.playLength / 2 + 0.2, TABLE.playWidth / 2 + 0.2);
    expect(capturingPocket(escaped)?.id).toBe('top-right');
  });
});

describe('cushions', () => {
  test('there are six rail segments: two per long rail, one per short rail', () => {
    expect(TABLE.rails).toHaveLength(6);
  });

  test('rail normals are unit vectors pointing at the table interior', () => {
    for (const rail of TABLE.rails) {
      expect(len(rail.normal)).toBeCloseTo(1, 9);
      const mid = vec((rail.a.x + rail.b.x) / 2, (rail.a.y + rail.b.y) / 2);
      expect(dot(rail.normal, sub(vec(0, 0), mid))).toBeGreaterThan(0);
    }
  });

  test('rails are axis-aligned and lie on the playing-surface boundary', () => {
    const halfL = TABLE.playLength / 2;
    const halfW = TABLE.playWidth / 2;
    for (const rail of TABLE.rails) {
      const horizontal = rail.a.y === rail.b.y;
      if (horizontal) {
        expect(Math.abs(rail.a.y)).toBeCloseTo(halfW, 9);
      } else {
        expect(rail.a.x).toBeCloseTo(rail.b.x, 9);
        expect(Math.abs(rail.a.x)).toBeCloseTo(halfL, 9);
      }
    }
  });

  test('every pocket mouth is a gap in the rails, not covered by cushion', () => {
    for (const pocket of TABLE.pockets) {
      for (const rail of TABLE.rails) {
        expect(distanceToSegment(pocket.center, rail.a, rail.b)).toBeGreaterThan(
          pocket.captureRadius,
        );
      }
    }
  });

  test('each pocket has two jaw facings that open away from the playing surface', () => {
    expect(TABLE.jaws).toHaveLength(12);
    for (const jaw of TABLE.jaws) {
      expect(len(jaw.normal)).toBeCloseTo(1, 9);
      expect(len(sub(jaw.b, jaw.a))).toBeGreaterThan(0);
    }
  });

  test('all collidable segments are rails plus jaws', () => {
    expect(TABLE.cushions).toHaveLength(TABLE.rails.length + TABLE.jaws.length);
  });

  test('the rail gap beside a corner is wide enough for a ball to enter the mouth', () => {
    const topRailRight = TABLE.rails.find(
      (r) => r.a.y === TABLE.playWidth / 2 && Math.max(r.a.x, r.b.x) > 0.5,
    );
    expect(topRailRight).toBeDefined();
    const nose = Math.max(topRailRight!.a.x, topRailRight!.b.x);
    expect(TABLE.playLength / 2 - nose).toBeGreaterThan(2 * BALL_RADIUS);
  });
});

function distanceToSegment(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq));
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}
