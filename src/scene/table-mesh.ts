/**
 * The table, built entirely from TableGeometry. Nothing here invents a
 * dimension: rails and facings sit exactly where the solver's cushion segments
 * are, the cloth runs on through each mouth over the shelf, and each hole opens
 * at the drop line the solver tests against, so what the player sees is what
 * the physics does. Behind each cushion is a wooden rail cap with the sights
 * set into it where the WPA puts them.
 */

import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Shape,
  ShapeGeometry,
  Vector2,
  type Vector3,
} from 'three';
import { SIGHTS } from '../geometry/diamonds';
import { TABLE } from '../geometry/table';
import type { Segment } from '../geometry/table';
import { type Vec2, add, dist, lerp, normalize, perp, scale, sub } from '../geometry/vec2';
import { headingBetween, headingToRotationY, toWorld } from './coords';

const CLOTH_COLOR = 0x1f6b4a;
const RAIL_COLOR = 0x2c5f45;
const FRAME_COLOR = 0x5a3a24;
const CAP_COLOR = 0x6e4529;
const SIGHT_COLOR = 0xefe8d6;
const POCKET_COLOR = 0x08110d;

const RAIL_HEIGHT = 0.045;
/** WPA: the cloth-covered cushion is 1 7/8" to 2" from its featherstrip to the nose. */
const CUSHION_DEPTH = 0.05;
const JAW_DEPTH = 0.02;
/** WPA: a diamond-shaped sight is between 1 x 7/16" and 1 1/4 x 5/8". */
const SIGHT_LENGTH = 0.028;
const SIGHT_WIDTH = 0.013;
const HOLE_SEGMENTS = 24;
/**
 * How far the wooden frame runs past the playing surface, each side, and so
 * the rail, cushion included: 5.5", inside the WPA's 4" to 7.5".
 */
export const FRAME_MARGIN = 0.14;

export function buildTable(): Group {
  const group = new Group();
  group.name = 'table';

  const frame = new Mesh(
    new BoxGeometry(
      TABLE.playLength + FRAME_MARGIN * 2,
      0.09,
      TABLE.playWidth + FRAME_MARGIN * 2,
    ),
    new MeshStandardMaterial({ color: FRAME_COLOR, roughness: 0.85 }),
  );
  frame.position.y = -0.055;
  frame.receiveShadow = true;
  group.add(frame);

  const cloth = new Mesh(
    new BoxGeometry(TABLE.playLength, 0.02, TABLE.playWidth),
    new MeshStandardMaterial({ color: CLOTH_COLOR, roughness: 0.95 }),
  );
  cloth.position.y = -0.01;
  cloth.receiveShadow = true;
  group.add(cloth);

  const railMaterial = new MeshStandardMaterial({ color: RAIL_COLOR, roughness: 0.7 });
  const capMaterial = new MeshStandardMaterial({ color: CAP_COLOR, roughness: 0.6 });
  for (const rail of TABLE.rails) {
    group.add(railBox(rail, 0, CUSHION_DEPTH, RAIL_HEIGHT, railMaterial));
    group.add(railBox(rail, CUSHION_DEPTH, FRAME_MARGIN, RAIL_HEIGHT, capMaterial));
  }
  for (const jaw of TABLE.jaws) {
    group.add(railBox(jaw, 0, JAW_DEPTH, RAIL_HEIGHT, railMaterial));
  }

  // The sights, flush on the caps: diamond-shaped, lying along their rails.
  const sightMaterial = new MeshStandardMaterial({ color: SIGHT_COLOR, roughness: 0.35 });
  const sights = new Group();
  sights.name = 'sights';
  for (const { position, along } of SIGHTS) {
    const tip = scale(along, SIGHT_LENGTH / 2);
    const side = scale(perp(along), SIGHT_WIDTH / 2);
    const outline = [add(position, tip), add(position, side), sub(position, tip), sub(position, side)];
    sights.add(flatPolygon(outline, RAIL_HEIGHT + 0.0005, sightMaterial));
  }
  group.add(sights);

  const pocketMaterial = new MeshStandardMaterial({ color: POCKET_COLOR, roughness: 1 });
  const shelfMaterial = new MeshStandardMaterial({ color: CLOTH_COLOR, roughness: 0.95 });
  for (const pocket of TABLE.pockets) {
    // The shelf: cloth on slate from the mouth back to the drop line. Just
    // under the cloth's top, so the two never fight where they overlap.
    const [first, second] = pocket.noses;
    group.add(flatPolygon([first, second, pocket.drop.b, pocket.drop.a], -0.0005, shelfMaterial));

    // The hole: square across at the drop line, where a ball's centre falls,
    // and round behind it, back under the rail. Just over the cloth's top, which
    // runs on under a corner hole as far as the corner of the table.
    group.add(flatPolygon(holeOutline(pocket.drop), 0.0005, pocketMaterial));
  }

  return group;
}

/** The drop line, then a half circle on it, behind. */
function holeOutline(drop: Segment): Vec2[] {
  const middle = lerp(drop.a, drop.b, 0.5);
  const half = dist(drop.a, drop.b) / 2;
  const along = normalize(sub(drop.b, drop.a));
  const outline: Vec2[] = [drop.a];
  for (let i = 0; i <= HOLE_SEGMENTS; i++) {
    const t = (i / HOLE_SEGMENTS) * Math.PI;
    outline.push(add(middle, add(scale(along, half * Math.cos(t)), scale(drop.normal, half * Math.sin(t)))));
  }
  return outline;
}

/** A flat polygon on the table plane, at a given height. */
function flatPolygon(points: readonly Vec2[], height: number, material: MeshStandardMaterial): Mesh {
  // Shape coordinates are (x, -y): laid flat by turning about x, table y becomes
  // world -z, which is the scene's mapping.
  const shape = new Shape(points.map((p) => new Vector2(p.x, -p.y)));
  const mesh = new Mesh(new ShapeGeometry(shape), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = height;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * A box along a cushion segment, from `inner` to `outer` out beyond its
 * collision line: from 0, the cushion, whose face is the collision line.
 */
function railBox(
  segment: Segment,
  inner: number,
  outer: number,
  height: number,
  material: MeshStandardMaterial,
): Mesh {
  const length = Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y);
  const depth = outer - inner;
  const mesh = new Mesh(new BoxGeometry(length, height, depth), material);

  const out = (inner + outer) / 2;
  const midpoint = {
    // Outward is against the normal, which faces the playing surface.
    x: (segment.a.x + segment.b.x) / 2 - segment.normal.x * out,
    y: (segment.a.y + segment.b.y) / 2 - segment.normal.y * out,
  };
  const position: Vector3 = toWorld(midpoint, height / 2);
  mesh.position.copy(position);
  mesh.rotation.y = headingToRotationY(headingBetween(segment.a, segment.b));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
