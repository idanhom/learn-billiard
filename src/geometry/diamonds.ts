/**
 * Diamonds: the sights set into the rail caps, and the coordinates players use
 * to set a layout up on a real table.
 *
 * The WPA's equipment specification (section 6) puts eighteen sights flush on
 * the rail cap, three between each pair of pockets, spaced an eighth of the
 * playing length apart (12½" on a 9-foot table, 11½" on an 8-foot), each
 * centred 3 11/16" back from the cushion nose. Lines between opposite sights
 * divide the playing surface into squares, eight along and four across, so a
 * diamond on this 7-foot table is 24.75 cm.
 */

import { PLAY_LENGTH, PLAY_WIDTH } from './table';
import { type Vec2, vec } from './vec2';

/** One diamond: an eighth of the playing length, and a quarter of its width. */
export const DIAMOND = PLAY_LENGTH / 8;

/** WPA: 3 11/16" (93.7 mm) from the cushion nose to the centre of each sight. */
export const SIGHT_SETBACK = 0.0937;

export interface Sight {
  /** Its centre, in table coordinates: out on the rail cap, beyond the cushion. */
  readonly position: Vec2;
  /** The way its rail runs, so a diamond-shaped sight can lie along it. */
  readonly along: Vec2;
}

/** The eighteen sights: six on each long rail, where the side pocket takes the middle place, and three on each short rail. */
export const SIGHTS: readonly Sight[] = [
  ...[1, 2, 3, 5, 6, 7].flatMap((k) =>
    [-1, 1].map((side) => ({
      position: vec(-PLAY_LENGTH / 2 + k * DIAMOND, side * (PLAY_WIDTH / 2 + SIGHT_SETBACK)),
      along: vec(1, 0),
    })),
  ),
  ...[1, 2, 3].flatMap((k) =>
    [-1, 1].map((side) => ({
      position: vec(side * (PLAY_LENGTH / 2 + SIGHT_SETBACK), -PLAY_WIDTH / 2 + k * DIAMOND),
      along: vec(0, 1),
    })),
  ),
];

/**
 * A point in diamonds, counted from the bottom-left corner pocket as the
 * overhead view shows the table on a wide screen: along the long rails from
 * the left-hand short rail (0 to 8), then across from the bottom long rail
 * (0 to 4).
 */
export interface DiamondPoint {
  readonly along: number;
  readonly across: number;
}

export function toDiamonds(p: Vec2): DiamondPoint {
  return { along: (p.x + PLAY_LENGTH / 2) / DIAMOND, across: (p.y + PLAY_WIDTH / 2) / DIAMOND };
}

export function fromDiamonds(point: DiamondPoint): Vec2 {
  return vec(point.along * DIAMOND - PLAY_LENGTH / 2, point.across * DIAMOND - PLAY_WIDTH / 2);
}

/** "2.4, 1.1": to a tenth of a diamond, which is 2.5 cm here, a little under a ball's radius. */
export function formatDiamonds(p: Vec2): string {
  const { along, across } = toDiamonds(p);
  return `${along.toFixed(1)}, ${across.toFixed(1)}`;
}
