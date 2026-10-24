/**
 * The table, built entirely from TableGeometry. Nothing here invents a
 * dimension: rails sit exactly where the solver's cushion segments are, and the
 * pocket discs are the capture circles the solver actually tests against, so
 * what the player sees is what the physics does.
 */

import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Vector3,
} from 'three';
import { TABLE } from '../geometry/table';
import type { Segment } from '../geometry/table';
import { headingBetween, headingToRotationY, toWorld } from './coords';

const CLOTH_COLOR = 0x1f6b4a;
const RAIL_COLOR = 0x2c5f45;
const FRAME_COLOR = 0x5a3a24;
const POCKET_COLOR = 0x08110d;

const RAIL_HEIGHT = 0.045;
const RAIL_DEPTH = 0.06;
const JAW_DEPTH = 0.02;
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
  for (const pocket of TABLE.pockets) {
    const disc = new Mesh(
      new CylinderGeometry(pocket.captureRadius, pocket.captureRadius, 0.012, 24),
      pocketMaterial,
    );
    disc.position.copy(toWorld(pocket.center, 0.001));
    group.add(disc);
  }

  return group;
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
