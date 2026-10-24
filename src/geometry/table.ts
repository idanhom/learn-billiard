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

import {
  type Vec2,
  add,
  dist,
  distSq,
  distanceToSegment,
  dot,
  lerp,
  normalize,
  perp,
  projectOntoSegment,
  scale,
  sub,
  vec,
} from './vec2';

/** 7-foot ("bar box") playing surface. */
export const PLAY_LENGTH = 1.98;
export const PLAY_WIDTH = 0.99;

/** Regulation 2¼-inch ball. */
export const BALL_RADIUS = 0.028575;
export const BALL_DIAMETER = BALL_RADIUS * 2;
export const BALL_MASS = 0.17;

/*
 * Pockets, as the WPA's equipment specification (section 9) sets them out.
 *
 * The mouth is the line between the two cushion noses, where the cushion turns
 * into the pocket. Behind it the cushions are cut back at an angle, the
 * facings, which narrow toward the hole. Between the mouth and the hole is the
 * shelf: slate the ball still rolls on. A ball drops when its centre crosses
 * the edge of the slate at the back of the shelf, the drop line. Until then it
 * can meet a facing and rattle back out, or die on the shelf and hang in the
 * jaws.
 */

/**
 * Rail gaps at the mouths, measured along the rail from the pocket centre. WPA
 * mouths are 4.5-4.625" for a corner and 5-5.125" for a side. A corner's mouth
 * is its gap times root 2, 0.116 m or 4.57"; a side's is twice its half gap,
 * 0.129 m or 5.08". (The side used to be 0.124 m, 4.88", narrower than the
 * specification allows.)
 */
export const CORNER_RAIL_GAP = 0.082;
export const SIDE_RAIL_HALF_GAP = 0.0645;

/**
 * The cut of the cushion where it turns into the pocket: the angle between the
 * cushion's face and the facing, through the rubber. WPA: 142 degrees for a
 * corner, 104 for a side, both +1. Both narrow the pocket toward the hole, a
 * corner's facings by 7 degrees each side and a side's by 14. (Both used to be
 * 135, which left a corner's facings parallel and closed a side's at 45
 * degrees each side.)
 */
export const CORNER_FACING_ANGLE = (142 * Math.PI) / 180;
export const SIDE_FACING_ANGLE = (104 * Math.PI) / 180;

/**
 * The shelf, from the middle of the mouth back to the drop line. WPA: 1-2.25"
 * for a corner, 0-0.375" for a side. These sit inside both: 1.57" and 0.2".
 */
export const CORNER_SHELF = 0.04;
export const SIDE_SHELF = 0.005;

/** How far each facing runs on past the drop line, so a ball on the shelf meets rubber rather than open space. */
const FACING_PAST_DROP = 0.015;

/**
 * The zone around each pocket centre that a layout keeps its balls, and their
 * paths, out of. Not where a ball drops (that is the drop line, behind it) but
 * the mouth and the approach to it, where a ball is in the pocket's business.
 * These were the capture circles when a ball dropped as soon as its centre
 * entered one.
 */
export const CORNER_MOUTH_RADIUS = 0.055;
export const SIDE_MOUTH_RADIUS = 0.05;

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

/** A collidable line segment. `normal` is a unit vector on the side balls approach from. */
export interface Segment {
  readonly a: Vec2;
  readonly b: Vec2;
  readonly normal: Vec2;
}

export interface Pocket {
  readonly id: PocketId;
  readonly kind: 'corner' | 'side';
  /** The pocket's centre: the aim point for the object ball. */
  readonly center: Vec2;
  /** The zone a layout keeps clear around `center`; see `CORNER_MOUTH_RADIUS`. */
  readonly mouthRadius: number;
  /** Unit vector from the pocket toward the playing surface. */
  readonly inward: Vec2;
  /** The two cushion noses. The mouth is the line between them. */
  readonly noses: readonly [Vec2, Vec2];
  /**
   * The edge of the slate at the back of the shelf, from facing to facing. A
   * ball drops when its centre crosses it; `normal` points into the hole.
   */
  readonly drop: Segment;
}

/** What a pocket is before the cushions around it are cut. */
interface PocketSite {
  readonly id: PocketId;
  readonly kind: 'corner' | 'side';
  readonly center: Vec2;
  readonly inward: Vec2;
}

export interface Bounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

const HALF_L = PLAY_LENGTH / 2;
const HALF_W = PLAY_WIDTH / 2;

const SITES: readonly PocketSite[] = [
  corner('top-left', vec(-HALF_L, HALF_W)),
  side('top-middle', vec(0, HALF_W)),
  corner('top-right', vec(HALF_L, HALF_W)),
  corner('bottom-left', vec(-HALF_L, -HALF_W)),
  side('bottom-middle', vec(0, -HALF_W)),
  corner('bottom-right', vec(HALF_L, -HALF_W)),
];

function corner(id: PocketId, center: Vec2): PocketSite {
  return { id, kind: 'corner', center, inward: normalize(scale(center, -1)) };
}

function side(id: PocketId, center: Vec2): PocketSite {
  return { id, kind: 'side', center, inward: vec(0, center.y > 0 ? -1 : 1) };
}

/** The pocket a cushion nose opens into: the one whose centre is nearest it. */
function siteAt(nose: Vec2): PocketSite {
  let best = SITES[0]!;
  for (const site of SITES) if (distSq(nose, site.center) < distSq(nose, best.center)) best = site;
  return best;
}

const shelfOf = (site: PocketSite): number => (site.kind === 'corner' ? CORNER_SHELF : SIDE_SHELF);

/**
 * Straight out through the mouth, square to it: the corner's bisector, or
 * square to the long rail. Not `inward` reversed, which aims a corner at the
 * table centre and is 18 degrees off the mouth's own axis on a 2:1 table.
 */
function axisOf(site: PocketSite): Vec2 {
  const out = vec(Math.sign(site.center.x), Math.sign(site.center.y));
  return site.kind === 'corner' ? normalize(out) : vec(0, out.y);
}

/** Segment with the normal on whichever side `side` points to. */
function segmentFacing(a: Vec2, b: Vec2, side: Vec2): Segment {
  const n = perp(normalize(sub(b, a)));
  const flip = n.x * side.x + n.y * side.y < 0;
  return { a, b, normal: flip ? scale(n, -1) : n };
}

/** Segment with the normal chosen to point toward the table centre. */
function segmentFacingCenter(a: Vec2, b: Vec2): Segment {
  return segmentFacing(a, b, scale(vec((a.x + b.x) / 2, (a.y + b.y) / 2), -1));
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
 * One facing per rail nose, cut at its pocket's angle: the rail's line carried
 * on past the nose, swung back into the rubber by 180 degrees less the cut.
 * Long enough to reach past the drop line, so the whole shelf has rubber
 * either side of it.
 */
function buildJaws(rails: readonly Segment[]): Segment[] {
  const jaws: Segment[] = [];
  for (const rail of rails) {
    for (const nose of [rail.a, rail.b] as const) {
      const site = siteAt(nose);
      const other = nose === rail.a ? rail.b : rail.a;
      const outwardAlong = normalize(sub(nose, other));
      // Swing the continuation away from the playing surface (against the normal).
      const away = scale(rail.normal, -1);
      const swing = Math.PI - (site.kind === 'corner' ? CORNER_FACING_ANGLE : SIDE_FACING_ANGLE);
      const dir = normalize(add(scale(outwardAlong, Math.cos(swing)), scale(away, Math.sin(swing))));
      // Depth into the pocket grows by dir.axis per unit along the facing.
      const deeper = dot(dir, axisOf(site));
      const tip = add(nose, scale(dir, (shelfOf(site) + FACING_PAST_DROP) / deeper));
      // Facing the way its rail faces, which is into the mouth. Not toward the
      // table centre: a corner jaw on a long rail, carried on as a line, passes
      // the centre on its cushion side, and a jaw built that way faced into its
      // own rubber. Balls in the mouth were behind it, passed through it, and
      // could wedge between it and the nose.
      jaws.push(segmentFacing(nose, tip, rail.normal));
    }
  }
  return jaws;
}

/**
 * The pockets, now the cushions around them are cut: each one's noses, and its
 * drop line where its two facings reach the depth of its shelf.
 */
function buildPockets(jaws: readonly Segment[]): Pocket[] {
  return SITES.map((site) => {
    const facings = jaws.filter((jaw) => siteAt(jaw.a) === site);
    if (facings.length !== 2) throw new Error(`pocket ${site.id} has ${facings.length} facings`);
    const out = axisOf(site);
    const atShelf = (jaw: Segment): Vec2 => {
      const dir = normalize(sub(jaw.b, jaw.a));
      return add(jaw.a, scale(dir, shelfOf(site) / dot(dir, out)));
    };
    const [first, second] = facings as [Segment, Segment];
    return {
      ...site,
      mouthRadius: site.kind === 'corner' ? CORNER_MOUTH_RADIUS : SIDE_MOUTH_RADIUS,
      noses: [first.a, second.a],
      drop: { a: atShelf(first), b: atShelf(second), normal: out },
    };
  });
}

const RAILS = buildRails();
const JAWS = buildJaws(RAILS);
const POCKETS: readonly Pocket[] = buildPockets(JAWS);

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

/**
 * True when a ball centre at `p` is inside a pocket's mouth zone.
 *
 * The legal-bounds rectangle is not enough to decide where a ball may be put:
 * the corner of that rectangle, (maxX, maxY), is only 4 cm from the corner
 * pocket centre, out past the mouth on the shelf. A ball placed there is
 * already in the pocket's jaws. Anything choosing positions must ask this too.
 */
export function isInPocketMouth(p: Vec2, margin = 0): boolean {
  return POCKETS.some((pocket) => dist(p, pocket.center) <= pocket.mouthRadius + margin);
}

export interface PathPocketOptions {
  /** Extra clearance, so a path that merely grazes a mouth also counts. */
  readonly margin?: number;
  /** The pocket a shot is aimed at, which it is of course allowed to reach. */
  readonly ignore?: PocketId;
}

/**
 * The first pocket whose mouth a ball rolling from `from` to `to` would cross.
 *
 * A ball does not have to be aimed at a pocket to get caught up in one: rolled
 * along a long rail it passes within 3 cm of the side pocket's centre, into
 * the 5 cm mouth zone, where the far facing turns it or it drops. A layout
 * should never ask for such a path.
 */
export function pocketOnPath(
  from: Vec2,
  to: Vec2,
  options: PathPocketOptions = {},
): Pocket | undefined {
  const margin = options.margin ?? 0;
  let earliest: Pocket | undefined;
  let earliestT = Number.POSITIVE_INFINITY;

  for (const pocket of POCKETS) {
    if (pocket.id === options.ignore) continue;
    if (distanceToSegment(pocket.center, from, to) > pocket.mouthRadius + margin) continue;
    const t = projectOntoSegment(pocket.center, from, to);
    if (t < earliestT) {
      earliestT = t;
      earliest = pocket;
    }
  }
  return earliest;
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

/**
 * True when a ball centre is more than a radius past the edge of the playing
 * surface: no slate under it, and only possible through a mouth. A ball on a
 * corner shelf, up against a facing, can sit a couple of millimetres past the
 * edge and still be rolling on slate, hence the radius.
 */
export function hasEscapedSurface(p: Vec2): boolean {
  return Math.abs(p.x) > HALF_L + BALL_RADIUS || Math.abs(p.y) > HALF_W + BALL_RADIUS;
}

/** True when a ball centre at `p` is past `pocket`'s drop line, over its hole. */
export function isOverHole(p: Vec2, pocket: Pocket): boolean {
  const { a, b, normal } = pocket.drop;
  if (dot(sub(p, a), normal) < 0) return false;
  const span = projectOntoSegment(p, a, b);
  return span > 0 && span < 1;
}

/**
 * True when a ball centre at `p` is on a pocket's shelf: through the mouth,
 * short of the drop line. A ball can come to rest there, hanging in the jaws.
 */
export function isOnShelf(p: Vec2): boolean {
  return POCKETS.some((pocket) => {
    const [first, second] = pocket.noses;
    const mid = lerp(first, second, 0.5);
    const depth = dot(sub(p, mid), pocket.drop.normal);
    if (depth < 0 || depth > dot(sub(pocket.drop.a, mid), pocket.drop.normal)) return false;
    // Between the facings, which narrow from the mouth to the drop line.
    const t = depth / dot(sub(pocket.drop.a, mid), pocket.drop.normal);
    const left = lerp(first, pocket.drop.a, t);
    const right = lerp(second, pocket.drop.b, t);
    return projectOntoSegment(p, left, right) > 0 && projectOntoSegment(p, left, right) < 1;
  });
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
 * The pocket that takes a ball whose centre is at `p`, or undefined: the one
 * whose drop line it is past. A ball that has slipped off the slate any other
 * way is taken by the nearest pocket, a failsafe so nothing is ever lost
 * off-table.
 */
export function capturingPocket(p: Vec2): Pocket | undefined {
  for (const pocket of POCKETS) {
    if (isOverHole(p, pocket)) return pocket;
  }
  if (hasEscapedSurface(p)) return nearestPocket(p);
  return undefined;
}
