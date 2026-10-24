import { describe, expect, test } from 'vitest';
import { layoutWithCut } from '../../src/game/drills';
import { aimPoint, cleanDrop, pocketWindow } from '../../src/geometry/pocket-window';
import { analyseShot } from '../../src/geometry/shot';
import { BALL_RADIUS, type Pocket, TABLE, pocketById } from '../../src/geometry/table';
import {
  type Vec2,
  add,
  cross,
  dist,
  distanceBetweenSegments,
  dot,
  fromAngle,
  lerp,
  normalize,
  scale,
  signedAngleBetween,
  sub,
  vec,
} from '../../src/geometry/vec2';

const corner = pocketById('top-right');
const side = pocketById('top-middle');
const mouthMiddle = (pocket: Pocket): Vec2 => lerp(pocket.noses[0], pocket.noses[1], 0.5);

/** An object ball 0.8 m out from a pocket's mouth, coming in `degrees` off the top rail, left to right. */
function comingIn(pocket: Pocket, degrees: number): Vec2 {
  return sub(mouthMiddle(pocket), fromAngle((degrees * Math.PI) / 180, 0.8));
}

/** Width of the band, in centimetres across the line of approach, at the object ball. */
function bandWidth(object: Vec2, pocket: Pocket): number {
  const window = pocketWindow(object, pocket)!;
  return (window.high - window.low) * dist(object, window.target) * 100;
}

/** How far a line from `object` through `through` passes to the rail side of the mouth's middle. */
function railSideOfMiddle(object: Vec2, through: Vec2, pocket: Pocket): number {
  return -cross(normalize(sub(through, object)), sub(mouthMiddle(pocket), object));
}

describe('the pocket window', () => {
  test('straight in, the aim is the middle of the drop line', () => {
    for (const pocket of [corner, side]) {
      const object = sub(mouthMiddle(pocket), scale(pocket.drop.normal, 0.8));
      const window = pocketWindow(object, pocket)!;
      expect(dist(window.target, lerp(pocket.drop.a, pocket.drop.b, 0.5)), pocket.id).toBeLessThan(1e-6);
    }
  });

  test('every line inside the band drops clean, and none just outside it does', () => {
    for (const [pocket, degrees] of [
      [corner, 10],
      [corner, 45],
      [corner, 80],
      [side, 40],
      [side, 90],
      [side, 140],
    ] as const) {
      const object = comingIn(pocket, degrees);
      const window = pocketWindow(object, pocket)!;
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const heading = window.low + (window.high - window.low) * t;
        expect(cleanDrop(object, heading, pocket), `${pocket.id} ${degrees} ${t}`).toBeDefined();
      }
      expect(cleanDrop(object, window.low - 1e-6, pocket)).toBeUndefined();
      expect(cleanDrop(object, window.high + 1e-6, pocket)).toBeUndefined();
    }
  });

  test('the same band either way round the table', () => {
    // Swept from opposite ends of the drop line: the mirror image of a layout
    // into the top-right corner is the same layout into the top-left.
    const left = pocketById('top-left');
    for (const object of [vec(0.3, 0.1), vec(0.6, 0.4), vec(-0.2, -0.3)]) {
      const right = pocketWindow(object, corner)!;
      const mirrored = pocketWindow(vec(-object.x, object.y), left)!;
      expect(mirrored.target.x).toBeCloseTo(-right.target.x, 9);
      expect(mirrored.target.y).toBeCloseTo(right.target.y, 9);
      expect(mirrored.high - mirrored.low).toBeCloseTo(right.high - right.low, 9);
    }
  });

  /**
   * Down a rail into a corner, the far facing is what a ball meets, so the
   * band loses its far side and its middle moves toward the rail: 0.5 to 1.25
   * cm off the middle of the mouth. Flat enough, and the corner point, where
   * this trainer used to aim, is past the edge of the band altogether.
   */
  test('coming down a rail into a corner, the aim moves toward that rail, short of the corner', () => {
    const towardCorner = (object: Vec2): number => Math.atan2(corner.center.y - object.y, corner.center.x - object.x);
    for (const degrees of [5, 10, 20, 30]) {
      const object = comingIn(corner, degrees);
      const window = pocketWindow(object, corner)!;
      const aim = railSideOfMiddle(object, window.target, corner);
      expect(aim, `${degrees}`).toBeGreaterThan(0.005);
      expect(aim, `${degrees}`).toBeLessThan(0.0125);
      expect(aim, `${degrees}`).toBeLessThan(railSideOfMiddle(object, corner.center, corner));
    }
    // Flat enough, neither the corner point nor the middle of the mouth will
    // do: the line at the corner catches the rail on the way in, and the line
    // at the middle of the mouth clips the far facing before the hole.
    const [nearRail] = TABLE.rails.filter((rail) => rail.a.y === TABLE.playWidth / 2 && rail.a.x > 0);
    const farNose = corner.noses.find((nose) => nose.x === TABLE.playLength / 2)!;
    const farFacing = TABLE.jaws.find((jaw) => dist(jaw.a, farNose) < 1e-12)!;
    for (const degrees of [5, 10]) {
      const object = comingIn(corner, degrees);
      expect(cleanDrop(object, towardCorner(object), corner), `${degrees}`).toBeUndefined();
      expect(distanceBetweenSegments(object, corner.center, nearRail!.a, nearRail!.b)).toBeLessThan(BALL_RADIUS);

      const middle = mouthMiddle(corner);
      const heading = Math.atan2(middle.y - object.y, middle.x - object.x);
      expect(cleanDrop(object, heading, corner), `${degrees}`).toBeUndefined();
      const direction = fromAngle(heading);
      const ahead = dot(sub(corner.drop.a, object), corner.drop.normal);
      const atDrop = add(object, scale(direction, ahead / dot(direction, corner.drop.normal)));
      expect(distanceBetweenSegments(object, atDrop, farFacing.a, farFacing.b)).toBeLessThan(BALL_RADIUS);
      expect(distanceBetweenSegments(object, middle, nearRail!.a, nearRail!.b)).toBeGreaterThan(BALL_RADIUS);
    }
  });

  test('the band narrows as the entry flattens', () => {
    const cornerWidths = [45, 30, 15, 5].map((degrees) => bandWidth(comingIn(corner, degrees), corner));
    const sideWidths = [90, 60, 45, 30].map((degrees) => bandWidth(comingIn(side, degrees), side));
    for (const widths of [cornerWidths, sideWidths]) {
      for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeLessThan(widths[i - 1]!);
    }
    // Square on, a side pocket is the bigger target; it has the wider mouth.
    expect(sideWidths[0]).toBeGreaterThan(cornerWidths[0]!);
    expect(pocketWindow(comingIn(side, 20), side)).toBeUndefined();
  });

  test('along a rail into a side pocket, nothing drops', () => {
    expect(pocketWindow(vec(-0.4, TABLE.bounds.maxY), side)).toBeUndefined();
    expect(aimPoint(vec(-0.4, TABLE.bounds.maxY), side)).toEqual(side.center);
  });

  /**
   * Frozen to a rail and sent along it, the band runs from the rail's own
   * line, where the ball just runs along the rubber, out to where it would
   * catch the far facing.
   */
  test('a ball frozen to a rail has a band that starts at the rail', () => {
    for (const object of [vec(0.25, TABLE.bounds.maxY), vec(-0.3, TABLE.bounds.minY)]) {
      const pocket = object.y > 0 ? corner : pocketById('bottom-left');
      const window = pocketWindow(object, pocket)!;
      const alongRail = pocket === corner ? 0 : Math.PI;
      const edges = [window.low, window.high].map((edge) => Math.abs(signedAngleBetween(fromAngle(edge), fromAngle(alongRail))));
      expect(Math.min(...edges)).toBeLessThan(1e-8);
      expect(window.high - window.low).toBeGreaterThan(1e-4);
    }
  });

  /**
   * But no cue ball can send it that way. Throw turns the object ball toward
   * the cue ball's sideways motion, which comes from the table side and so
   * points into the rail, and correcting for it puts the ghost ball inside
   * the rubber. The generator does not deal frozen balls for this reason.
   */
  test('and throw puts the ghost ball that would send it there inside the rail', () => {
    const object = vec(0.25, TABLE.bounds.maxY);
    for (const cut of [10, 30]) {
      const { cue } = layoutWithCut(`frozen-${cut}`, object, 'top-right', -cut, 0.6);
      const analysis = analyseShot({ cue, object, pocket: corner, obstacles: [] });
      expect(analysis.throwAngle).toBeGreaterThan(0);
      expect(analysis.blockers, `${cut}`).toContain('ghost-off-table');
    }
  });
});
