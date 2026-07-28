/**
 * Teaching guides.
 *
 * Deliberately absent: the static 90-degree tangent line. With restitution
 * below 1 and a sliding cue ball picking up follow, the cue ball does not leave
 * along the tangent, so drawing it would teach something the simulation
 * contradicts.
 */

import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
  WireframeGeometry,
  LineSegments,
  LineBasicMaterial,
} from 'three';
import { BALL_RADIUS } from '../geometry/table';
import type { Vec2 } from '../geometry/vec2';
import { headingBetween, headingToRotationY, toWorld, writeWorld } from './coords';

/** How much of the teaching scaffolding is showing. */
export type GuideTier = 0 | 1 | 2 | 3;

const AIM_COLOR = 0xf2f6ff;
const GHOST_COLOR = 0x9fe8c4;
const PATH_COLOR = 0xe2a03f;
const LINE_THICKNESS = 0.006;

export interface GuideState {
  readonly tier: GuideTier;
  readonly cue: Vec2;
  /** Where the player is currently aiming. */
  readonly aimEnd: Vec2;
  readonly ghost: Vec2;
  readonly object: Vec2;
  readonly pocket: Vec2;
}

export class Guides {
  readonly group = new Group();

  readonly #aimLine = flatLine(AIM_COLOR, 0.85);
  readonly #objectPath = flatLine(PATH_COLOR, 0.7);
  readonly #ghost: LineSegments;

  constructor() {
    this.group.name = 'guides';
    this.group.add(this.#aimLine, this.#objectPath);

    this.#ghost = new LineSegments(
      new WireframeGeometry(new SphereGeometry(BALL_RADIUS, 12, 8)),
      new LineBasicMaterial({ color: GHOST_COLOR, transparent: true, opacity: 0.55 }),
    );
    this.#ghost.name = 'ghost-ball';
    this.group.add(this.#ghost);
  }

  update(state: GuideState): void {
    // Tier 0: everything. Tier 1: no object path. Tier 2: no ghost ball.
    // Tier 3: no guides at all — the aim line goes too, this is the real test.
    const showAim = state.tier < 3;
    const showGhost = state.tier < 2;
    const showPath = state.tier < 1;

    this.#aimLine.visible = showAim;
    this.#ghost.visible = showGhost;
    this.#objectPath.visible = showPath;

    if (showAim) placeLine(this.#aimLine, state.cue, state.aimEnd, 0.004);
    if (showPath) placeLine(this.#objectPath, state.object, state.pocket, 0.004);
    if (showGhost) this.#ghost.position.copy(toWorld(state.ghost, BALL_RADIUS));
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }
}

function flatLine(color: number, opacity: number): Mesh {
  const mesh = new Mesh(
    new BoxGeometry(1, LINE_THICKNESS, LINE_THICKNESS),
    new MeshBasicMaterial({ color, transparent: true, opacity }),
  );
  // Unit box along +x, scaled to length at placement time.
  mesh.geometry.translate(0.5, 0, 0);
  return mesh;
}

const scratchFrom = new Vector3();
const scratchTo = new Vector3();

function placeLine(mesh: Mesh, from: Vec2, to: Vec2, height: number): void {
  writeWorld(scratchFrom, from, height);
  writeWorld(scratchTo, to, height);
  const length = scratchFrom.distanceTo(scratchTo);
  mesh.position.copy(scratchFrom);
  mesh.scale.set(Math.max(length, 1e-4), 1, 1);
  mesh.rotation.y = headingToRotationY(headingBetween(from, to));
}
