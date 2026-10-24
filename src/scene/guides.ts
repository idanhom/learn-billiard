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
import type { GuideVisibility } from '../game/tiers';
import { BALL_RADIUS } from '../geometry/table';
import { type Vec2, add, dist, normalize, scale, sub } from '../geometry/vec2';
import { headingBetween, headingToRotationY, toWorld, writeWorld } from './coords';

const AIM_COLOR = 0xf2f6ff;
const GHOST_COLOR = 0x9fe8c4;
const PATH_COLOR = 0xe2a03f;
const PLACED_COLOR = 0xf07a7a;
const LINE_THICKNESS = 0.006;

type Paint = readonly [color: number, opacity: number];

/** The guides as drawn, and for high contrast: solid, brighter, and the lines twice as thick. */
export const GUIDE_PALETTES: Record<'normal' | 'high', { readonly [part in 'aim' | 'ghost' | 'path' | 'placed']: Paint } & { readonly thickness: number }> = {
  normal: { aim: [AIM_COLOR, 0.85], ghost: [GHOST_COLOR, 0.55], path: [PATH_COLOR, 0.7], placed: [PLACED_COLOR, 0.7], thickness: 1 },
  high: { aim: [0xffffff, 1], ghost: [0x00e5ff, 1], path: [0xffd000, 1], placed: [0xff4fa3, 1], thickness: 2 },
};

export interface GuideState {
  readonly visibility: GuideVisibility;
  readonly cue: Vec2;
  /** Where the player is currently aiming. */
  readonly aimEnd: Vec2;
  readonly ghost: Vec2;
  readonly object: Vec2;
  readonly pocket: Vec2;
  /** A place drill's answer: where the player put the ghost ball. */
  readonly placed?: Vec2 | undefined;
}

export class Guides {
  readonly group = new Group();

  readonly #aimLine = flatLine(AIM_COLOR, 0.85);
  readonly #objectPath = flatLine(PATH_COLOR, 0.7);
  readonly #ghost = wireBall(GHOST_COLOR);
  readonly #placed = wireBall(PLACED_COLOR);
  readonly #placedPath = flatLine(PLACED_COLOR, 0.7);
  #thickness = 1;

  constructor() {
    this.group.name = 'guides';
    this.#ghost.name = 'ghost-ball';
    this.#placed.name = 'placed-ghost-ball';
    this.group.add(this.#aimLine, this.#objectPath, this.#ghost, this.#placed, this.#placedPath);
  }

  /** Draw the guides for high contrast, or as they normally are. */
  setContrast(high: boolean): void {
    const palette = GUIDE_PALETTES[high ? 'high' : 'normal'];
    paint(this.#aimLine, palette.aim);
    paint(this.#objectPath, palette.path);
    paint(this.#ghost, palette.ghost);
    paint(this.#placed, palette.placed);
    paint(this.#placedPath, palette.placed);
    this.#thickness = palette.thickness;
  }

  update(state: GuideState): void {
    const { aimLine, ghostBall, objectPath } = state.visibility;

    this.#aimLine.visible = aimLine;
    this.#ghost.visible = ghostBall;
    this.#objectPath.visible = objectPath;

    if (aimLine) placeLine(this.#aimLine, state.cue, state.aimEnd, 0.004, this.#thickness);
    if (objectPath) placeLine(this.#objectPath, state.object, state.pocket, 0.004, this.#thickness);
    if (ghostBall) this.#ghost.position.copy(toWorld(state.ghost, BALL_RADIUS));

    // Where the placed ghost ball would have sent the object ball: along the
    // line of centres through it, as far as the pocket is.
    const placed = state.placed;
    this.#placed.visible = placed !== undefined;
    this.#placedPath.visible = placed !== undefined;
    if (placed) {
      this.#placed.position.copy(toWorld(placed, BALL_RADIUS));
      const away = scale(normalize(sub(state.object, placed)), dist(state.object, state.pocket));
      placeLine(this.#placedPath, state.object, add(state.object, away), 0.004, this.#thickness);
    }
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }
}

function paint(object: Mesh | LineSegments, [color, opacity]: Paint): void {
  const material = object.material as MeshBasicMaterial | LineBasicMaterial;
  material.color.setHex(color);
  material.opacity = opacity;
  material.transparent = opacity < 1;
}

function wireBall(color: number): LineSegments {
  return new LineSegments(
    new WireframeGeometry(new SphereGeometry(BALL_RADIUS, 12, 8)),
    new LineBasicMaterial({ color, transparent: true, opacity: 0.55 }),
  );
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

function placeLine(mesh: Mesh, from: Vec2, to: Vec2, height: number, thickness: number): void {
  writeWorld(scratchFrom, from, height);
  writeWorld(scratchTo, to, height);
  const length = scratchFrom.distanceTo(scratchTo);
  mesh.position.copy(scratchFrom);
  mesh.scale.set(Math.max(length, 1e-4), thickness, thickness);
  mesh.rotation.y = headingToRotationY(headingBetween(from, to));
}
