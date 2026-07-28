/**
 * TableGeometry — the single source of truth for table dimensions.
 *
 * Physics, the shot generator and the Three.js scene all consume this module;
 * no dimension is duplicated anywhere else.
 *
 * Coordinate system: metres, origin at the centre of the playing surface.
 * +x runs along the length (toward the right-hand short rail),
 * +y runs across the width (toward the "top" long rail).
 * The scene maps this plane onto world XZ; nothing here knows about rendering.
 */

import { type Vec2, dist, distSq, normalize, perp, scale, sub, vec } from './vec2';

/** 7-foot ("bar box") playing surface. */
export const PLAY_LENGTH = 1.98;
export const PLAY_WIDTH = 0.99;

/** Regulation 2¼-inch ball. */
export const BALL_RADIUS = 0.028575;
export const BALL_DIAMETER = BALL_RADIUS * 2;
export const BALL_MASS = 0.17;

/**
 * Pocket capture circles. A ball whose centre enters one is potted.
 * Corner circles are centred on the surface corner, side circles on the long-rail
 * midpoint; both sit behind the mouth, so only a ball that has actually entered
 * the mouth is taken.
 */
export const CORNER_CAPTURE_RADIUS = 0.055;
export const SIDE_CAPTURE_RADIUS = 0.05;

/** Rail gaps at the mouths. Measured along the rail from the pocket centre. */
export const CORNER_RAIL_GAP = 0.082;
export const SIDE_RAIL_HALF_GAP = 0.062;

/** Jaw facings: short segments angled back from each cushion nose into the mouth. */
export const JAW_LENGTH = 0.035;
/** Angle the jaw is swung outward from the rail line, in radians. */
export const JAW_ANGLE = Math.PI / 4;

export type PocketId =
  | 'top-left'
  | 'top-middle'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-middle'
  | 'bottom-right';

export const POCKET_IDS: readonly PocketId[] = [
  'top-left',
  'top-middle',
  'top-right',
  'bottom-left',
  'bottom-middle',
  'bottom-right',
];

export interface Pocket {
  readonly id: PocketId;
  readonly kind: 'corner' | 'side';
  /** Centre of the capture circle; also the aim reference for the object ball. */
  readonly center: Vec2;
  readonly captureRadius: number;
  /** Unit vector from the pocket toward the playing surface. */
  readonly inward: Vec2;
}

/** A collidable line segment. `normal` is a unit vector on the side balls approach from. */
export interface Segment {
  readonly a: Vec2;
  readonly b: Vec2;
  readonly normal: Vec2;
}

export interface Bounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

const HALF_L = PLAY_LENGTH / 2;
const HALF_W = PLAY_WIDTH / 2;

const POCKETS: readonly Pocket[] = [
  corner('top-left', vec(-HALF_L, HALF_W)),
  side('top-middle', vec(0, HALF_W)),
  corner('top-right', vec(HALF_L, HALF_W)),
  corner('bottom-left', vec(-HALF_L, -HALF_W)),
  side('bottom-middle', vec(0, -HALF_W)),
  corner('bottom-right', vec(HALF_L, -HALF_W)),
];

function corner(id: PocketId, center: Vec2): Pocket {
  return {
    id,
    kind: 'corner',
    center,
    captureRadius: CORNER_CAPTURE_RADIUS,
    inward: normalize(scale(center, -1)),
  };
}

function side(id: PocketId, center: Vec2): Pocket {
  return {
    id,
    kind: 'side',
    center,
    captureRadius: SIDE_CAPTURE_RADIUS,
    inward: vec(0, center.y > 0 ? -1 : 1),
  };
}

/** Segment with the normal chosen to point toward the table centre. */
function segmentFacingCenter(a: Vec2, b: Vec2): Segment {
  const along = normalize(sub(b, a));
  const n = perp(along);
  const mid = vec((a.x + b.x) / 2, (a.y + b.y) / 2);
  const towardCenter = scale(mid, -1);
  const flip = n.x * towardCenter.x + n.y * towardCenter.y < 0;
  return { a, b, normal: flip ? scale(n, -1) : n };
}

function buildRails(): Segment[] {
  const rails: Segment[] = [];
  for (const sign of [1, -1]) {
    const y = HALF_W * sign;
    // Long rail, split by the side pocket into two segments.
    rails.push(segmentFacingCenter(vec(-HALF_L + CORNER_RAIL_GAP, y), vec(-SIDE_RAIL_HALF_GAP, y)));
    rails.push(segmentFacingCenter(vec(SIDE_RAIL_HALF_GAP, y), vec(HALF_L - CORNER_RAIL_GAP, y)));
    // Short rail, uninterrupted between its two corner gaps.
    const x = HALF_L * sign;
    rails.push(
      segmentFacingCenter(vec(x, -HALF_W + CORNER_RAIL_GAP), vec(x, HALF_W - CORNER_RAIL_GAP)),
    );
  }
  return rails;
}

/**
 * One jaw per rail nose: a short facing swung outward from the rail line so the
 * mouth funnels rather than presenting a bare cushion end.
 */
function buildJaws(rails: readonly Segment[]): Segment[] {
  const jaws: Segment[] = [];
  for (const rail of rails) {
    for (const nose of [rail.a, rail.b] as const) {
      const other = nose === rail.a ? rail.b : rail.a;
      const outwardAlong = normalize(sub(nose, other));
      // Swing the continuation away from the playing surface (against the normal).
      const away = scale(rail.normal, -1);
      const dir = normalize(
        vec(
          outwardAlong.x * Math.cos(JAW_ANGLE) + away.x * Math.sin(JAW_ANGLE),
          outwardAlong.y * Math.cos(JAW_ANGLE) + away.y * Math.sin(JAW_ANGLE),
        ),
      );
      const tip = vec(nose.x + dir.x * JAW_LENGTH, nose.y + dir.y * JAW_LENGTH);
      jaws.push(segmentFacingCenter(nose, tip));
    }
  }
  return jaws;
}

const RAILS = buildRails();
const JAWS = buildJaws(RAILS);

export const TABLE = {
  playLength: PLAY_LENGTH,
  playWidth: PLAY_WIDTH,
  ballRadius: BALL_RADIUS,
  ballMass: BALL_MASS,
  pockets: POCKETS,
  rails: RAILS as readonly Segment[],
  jaws: JAWS as readonly Segment[],
  cushions: [...RAILS, ...JAWS] as readonly Segment[],
  bounds: {
    minX: -HALF_L + BALL_RADIUS,
    maxX: HALF_L - BALL_RADIUS,
    minY: -HALF_W + BALL_RADIUS,
    maxY: HALF_W - BALL_RADIUS,
  } as Bounds,
} as const;

const POCKET_BY_ID = new Map<PocketId, Pocket>(POCKETS.map((p) => [p.id, p]));

export function pocketById(id: PocketId): Pocket {
  const pocket = POCKET_BY_ID.get(id);
  if (!pocket) throw new Error(`unknown pocket: ${id}`);
  return pocket;
}

/** True when a ball centre at `p` sits wholly on the playing surface, inset by `margin`. */
export function isInLegalBounds(p: Vec2, margin = 0): boolean {
  const b = TABLE.bounds;
  return (
    p.x >= b.minX + margin &&
    p.x <= b.maxX - margin &&
    p.y >= b.minY + margin &&
    p.y <= b.maxY - margin
  );
}

/** True when a ball centre has left the playing surface entirely (only possible via a mouth). */
export function hasEscapedSurface(p: Vec2): boolean {
  return Math.abs(p.x) > HALF_L || Math.abs(p.y) > HALF_W;
}

export function nearestPocket(p: Vec2): Pocket {
  let best = POCKETS[0]!;
  let bestDistSq = Number.POSITIVE_INFINITY;
  for (const pocket of POCKETS) {
    const d = distSq(p, pocket.center);
    if (d < bestDistSq) {
      bestDistSq = d;
      best = pocket;
    }
  }
  return best;
}

/**
 * The pocket that takes a ball whose centre is at `p`, or undefined.
 * A ball that has slipped past the surface edge through a mouth is taken by the
 * nearest pocket — a failsafe so nothing is ever lost off-table.
 */
export function capturingPocket(p: Vec2): Pocket | undefined {
  for (const pocket of POCKETS) {
    if (dist(p, pocket.center) <= pocket.captureRadius) return pocket;
  }
  if (hasEscapedSurface(p)) return nearestPocket(p);
  return undefined;
}
