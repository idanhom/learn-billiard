/**
 * The table, built entirely from TableGeometry. Nothing here invents a
 * dimension: rails and facings sit exactly where the solver's cushion segments
 * are, the cloth runs on through each mouth over the shelf, and each hole opens
 * at the drop line the solver tests against, so what the player sees is what
 * the physics does.
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
import { TABLE } from '../geometry/table';
import type { Segment } from '../geometry/table';
import { type Vec2, add, dist, lerp, normalize, scale, sub } from '../geometry/vec2';
import { headingBetween, headingToRotationY, toWorld } from './coords';

const CLOTH_COLOR = 0x1f6b4a;
const RAIL_COLOR = 0x2c5f45;
const FRAME_COLOR = 0x5a3a24;
const POCKET_COLOR = 0x08110d;

const RAIL_HEIGHT = 0.045;
const RAIL_DEPTH = 0.06;
const JAW_DEPTH = 0.02;
const HOLE_SEGMENTS = 24;
/** How far the wooden frame runs past the playing surface, each side. */
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
  for (const rail of TABLE.rails) {
    group.add(cushionMesh(rail, RAIL_DEPTH, RAIL_HEIGHT, railMaterial));
  }
  for (const jaw of TABLE.jaws) {
    group.add(cushionMesh(jaw, JAW_DEPTH, RAIL_HEIGHT, railMaterial));
  }

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

/** A cushion segment as a box sitting on the outside of its collision line. */
function cushionMesh(
  segment: Segment,
  depth: number,
  height: number,
  material: MeshStandardMaterial,
): Mesh {
  const length = Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y);
  const mesh = new Mesh(new BoxGeometry(length, height, depth), material);

  const midpoint = {
    // Offset outward (against the normal) so the visible face is the collision line.
    x: (segment.a.x + segment.b.x) / 2 - (segment.normal.x * depth) / 2,
    y: (segment.a.y + segment.b.y) / 2 - (segment.normal.y * depth) / 2,
  };
  const position: Vector3 = toWorld(midpoint, height / 2);
  mesh.position.copy(position);
  mesh.rotation.y = headingToRotationY(headingBetween(segment.a, segment.b));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
