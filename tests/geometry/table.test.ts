import { describe, expect, test } from 'vitest';
import { add, dist, dot, len, lerp, normalize, scale, sub, vec } from '../../src/geometry/vec2';
import {
  BALL_MASS,
  BALL_RADIUS,
  POCKET_IDS,
  type Pocket,
  TABLE,
  capturingPocket,
  isInLegalBounds,
  isInPocketMouth,
  isOnShelf,
  pocketById,
  pocketOnPath,
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

  /**
   * WPA Recommended Equipment Specifications, section 9: mouths measured nose
   * to nose, the cut of the facing through the rubber, and the shelf from the
   * middle of the mouth to the slate's edge.
   */
  test('mouths are the WPA widths: corners 4.5-4.625", sides 5-5.125"', () => {
    const inches = (pocket: Pocket): number => dist(pocket.noses[0], pocket.noses[1]) / 0.0254;
    for (const pocket of TABLE.pockets) {
      const [low, high] = pocket.kind === 'corner' ? [4.5, 4.625] : [5, 5.125];
      expect(inches(pocket), pocket.id).toBeGreaterThanOrEqual(low);
      expect(inches(pocket), pocket.id).toBeLessThanOrEqual(high);
    }
  });

  test('facings are cut at the WPA angles: 142 degrees at a corner, 104 at a side', () => {
    TABLE.jaws.forEach((jaw, i) => {
      const rail = TABLE.rails[Math.floor(i / 2)]!;
      // Back along the cushion's face from the nose, against out along the
      // facing: the angle the rubber makes at the lip.
      const back = normalize(sub(jaw.a === rail.a ? rail.b : rail.a, jaw.a));
      const facing = normalize(sub(jaw.b, jaw.a));
      const cut = (Math.acos(dot(back, facing)) * 180) / Math.PI;
      const kind = TABLE.pockets.find((p) => p.noses.some((n) => dist(n, jaw.a) < 1e-12))!.kind;
      expect(cut, `jaw ${i}`).toBeCloseTo(kind === 'corner' ? 142 : 104, 9);
    });
  });

  test('shelves are inside the WPA ranges: corners 1-2.25", sides 0-0.375"', () => {
    for (const pocket of TABLE.pockets) {
      const mouth = lerp(pocket.noses[0], pocket.noses[1], 0.5);
      const shelf = dot(sub(pocket.drop.a, mouth), pocket.drop.normal) / 0.0254;
      expect(dot(sub(pocket.drop.b, mouth), pocket.drop.normal) / 0.0254).toBeCloseTo(shelf, 9);
      const [low, high] = pocket.kind === 'corner' ? [1, 2.25] : [0, 0.375];
      expect(shelf, pocket.id).toBeGreaterThanOrEqual(low);
      expect(shelf, pocket.id).toBeLessThanOrEqual(high);
    }
  });

  test('the drop line runs facing to facing, square to the mouth, its normal into the hole', () => {
    for (const pocket of TABLE.pockets) {
      const mouth = sub(pocket.noses[1], pocket.noses[0]);
      expect(dot(pocket.drop.normal, mouth)).toBeCloseTo(0, 12);
      expect(dot(pocket.drop.normal, lerp(pocket.noses[0], pocket.noses[1], 0.5))).toBeGreaterThan(0);
      expect(dot(sub(pocket.drop.b, pocket.drop.a), pocket.drop.normal)).toBeCloseTo(0, 12);
      const facings = TABLE.jaws.filter((jaw) => pocket.noses.some((n) => dist(n, jaw.a) < 1e-12));
      expect(facings).toHaveLength(2);
      for (const end of [pocket.drop.a, pocket.drop.b]) {
        expect(Math.min(...facings.map((f) => distanceToSegment(end, f.a, f.b)))).toBeLessThan(1e-12);
      }
    }
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

  /**
   * The mouth is not the hole. A ball centred in the side mouth, or hard in the
   * corner of the legal rectangle, is still on slate; it is captured once its
   * centre is past the drop line, and not before.
   */
  test('a ball in a mouth is not potted until its centre is past the drop line', () => {
    expect(capturingPocket(vec(0, TABLE.bounds.maxY))).toBeUndefined();
    const corner = vec(TABLE.bounds.maxX, TABLE.bounds.maxY);
    expect(capturingPocket(corner)).toBeUndefined();
    for (const pocket of TABLE.pockets) {
      const middle = lerp(pocket.drop.a, pocket.drop.b, 0.5);
      expect(capturingPocket(add(middle, scale(pocket.drop.normal, -1e-6)))).toBeUndefined();
      expect(capturingPocket(add(middle, scale(pocket.drop.normal, 1e-6)))?.id).toBe(pocket.id);
    }
  });

  test('a ball that has escaped the playing surface is captured by the nearest pocket', () => {
    const escaped = vec(TABLE.playLength / 2 + 0.2, TABLE.playWidth / 2 + 0.2);
    expect(capturingPocket(escaped)?.id).toBe('top-right');
  });
});

describe('pocket mouths', () => {
  test('a ball wedged in the legal-bounds corner is already in the jaws', () => {
    // The bounds rectangle alone says this is a legal place to put a ball, but
    // it is through the mouth and out on the shelf.
    const corner = vec(TABLE.bounds.maxX, TABLE.bounds.maxY);
    expect(isInLegalBounds(corner)).toBe(true);
    expect(isOnShelf(corner)).toBe(true);
    expect(isInPocketMouth(corner)).toBe(true);
  });

  test('the middle of the table is not in a pocket', () => {
    expect(isInPocketMouth(vec(0, 0))).toBe(false);
    expect(isInPocketMouth(vec(0.4, 0.2))).toBe(false);
  });

  test('a margin widens the mouth, for keeping layouts clear of the edge', () => {
    // 7.9 cm from the side pocket centre: outside its 5 cm mouth zone, but
    // close enough that a generator ought to leave it alone.
    const nearSide = vec(0, TABLE.bounds.maxY - 0.05);
    expect(isInPocketMouth(nearSide)).toBe(false);
    expect(isInPocketMouth(nearSide, 0.04)).toBe(true);
  });

  /**
   * Anywhere a ball's centre could sit on a shelf, clear of both facings, is
   * inside the mouth zone once the generator's margin of half a ball is added,
   * so no layout ever starts a ball in the jaws.
   */
  test('the mouth zone, with half a ball of margin, covers every place on a shelf', () => {
    for (const pocket of TABLE.pockets) {
      const mouth = lerp(pocket.noses[0], pocket.noses[1], 0.5);
      for (let depth = 0; depth <= 1; depth += 0.1) {
        for (let across = 0; across <= 1; across += 0.05) {
          const left = lerp(pocket.noses[0], pocket.drop.a, depth);
          const right = lerp(pocket.noses[1], pocket.drop.b, depth);
          const point = lerp(left, right, across);
          if (!isOnShelf(point) || dist(point, left) < BALL_RADIUS || dist(point, right) < BALL_RADIUS) continue;
          expect(isInPocketMouth(point, BALL_RADIUS / 2), `${pocket.id} ${JSON.stringify(point)}`).toBe(true);
        }
      }
      expect(dist(mouth, pocket.center)).toBeLessThan(pocket.mouthRadius + BALL_RADIUS / 2);
    }
  });
});

describe('paths that run over a pocket', () => {
  test('a ball rolled along the long rail past a side pocket falls in', () => {
    const from = vec(-0.5, TABLE.bounds.maxY);
    const to = vec(0.5, TABLE.bounds.maxY);
    expect(pocketOnPath(from, to)?.id).toBe('top-middle');
  });

  test('a path across the middle of the table reaches no pocket', () => {
    expect(pocketOnPath(vec(-0.5, 0), vec(0.5, 0))).toBeUndefined();
  });

  test('a path that stops short of the pocket is clear', () => {
    expect(pocketOnPath(vec(-0.5, TABLE.bounds.maxY), vec(-0.2, TABLE.bounds.maxY))).toBeUndefined();
  });

  test('the pocket a shot is aimed at can be ignored', () => {
    const object = vec(0.5, 0.25);
    const target = pocketById('top-right').center;
    expect(pocketOnPath(object, target)?.id).toBe('top-right');
    expect(pocketOnPath(object, target, { ignore: 'top-right' })).toBeUndefined();
  });

  test('reports the first pocket along the path, not just any of them', () => {
    // Down the length of the table on the rail: the side pocket comes first.
    const from = vec(-0.8, TABLE.bounds.maxY);
    const to = vec(0.95, TABLE.bounds.maxY);
    expect(pocketOnPath(from, to)?.id).toBe('top-middle');
  });

  test('a margin catches a path that merely grazes a mouth', () => {
    const from = vec(-0.4, TABLE.bounds.maxY - 0.05);
    const to = vec(0.4, TABLE.bounds.maxY - 0.05);
    expect(pocketOnPath(from, to)).toBeUndefined();
    expect(pocketOnPath(from, to, { margin: 0.04 })?.id).toBe('top-middle');
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
          pocket.mouthRadius,
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

  /**
   * A facing is the cushion's face carried on into the mouth, so it faces the
   * same way as its rail. The four corner jaws on the long rails used to face
   * the other way, into their own rubber, because their normal was chosen to
   * point at the table centre — which, for those four, lies on the cushion
   * side of the jaw's line.
   */
  test('every jaw faces into its pocket mouth, the way its rail faces the table', () => {
    TABLE.jaws.forEach((jaw, i) => {
      const rail = TABLE.rails[Math.floor(i / 2)]!;
      expect(dot(jaw.normal, rail.normal), `jaw ${i}`).toBeGreaterThan(0);
    });
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
