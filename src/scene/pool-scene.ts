/**
 * Rendering: table, balls, cue stick, camera rig.
 *
 * Knows nothing about rules or progression — it is handed positions and draws
 * them. The device pixel ratio is capped because this runs on a Raspberry Pi
 * and a 4K-ish backing store would cost more than the physics does.
 */

import {
  AmbientLight,
  CylinderGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Plane,
  Raycaster,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { BALL_RADIUS } from '../geometry/table';
import { type Vec2, lerp as lerpVec, vec } from '../geometry/vec2';
import type { Ball } from '../physics/world';
import { fromWorld, headingToRotationY, headingToWorld, toWorld, writeWorld } from './coords';
import { Guides } from './guides';
import { buildTable } from './table-mesh';

export type CameraView = 'behind' | 'overhead';

const MAX_PIXEL_RATIO = 1.5;
const CUE_LENGTH = 1.35;
const CUE_GAP = 0.02;
const CUE_MAX_PULLBACK = 0.28;

const BALL_COLORS = [0xf5f3ec, 0xd8b02a, 0x2f6bd8, 0xc8452f, 0x6b3fa0];

export interface RenderState {
  readonly balls: readonly Ball[];
  readonly previous: readonly Ball[];
  readonly alpha: number;
  readonly aimAngle: number;
  readonly power: number;
  readonly showCue: boolean;
}

export class PoolScene {
  readonly scene = new Scene();
  readonly guides = new Guides();

  readonly #renderer: WebGLRenderer;
  readonly #camera = new PerspectiveCamera(52, 1, 0.05, 60);
  readonly #canvas: HTMLCanvasElement;
  readonly #ballMeshes = new Map<number, Mesh>();
  readonly #cue: Group;
  readonly #raycaster = new Raycaster();
  readonly #clothPlane = new Plane(new Vector3(0, 1, 0), 0);
  readonly #pointer = new Vector2();
  readonly #hit = new Vector3();

  #view: CameraView = 'behind';

  constructor(canvas: HTMLCanvasElement) {
    this.#canvas = canvas;
    this.#renderer = new WebGLRenderer({ canvas, antialias: true });
    this.#renderer.shadowMap.enabled = true;

    this.scene.add(buildTable());
    this.scene.add(this.guides.group);

    const key = new DirectionalLight(0xffffff, 2.1);
    key.position.set(0.6, 2.4, 1.1);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 6;
    key.shadow.camera.left = -1.4;
    key.shadow.camera.right = 1.4;
    key.shadow.camera.top = 1.4;
    key.shadow.camera.bottom = -1.4;
    this.scene.add(key);
    this.scene.add(new AmbientLight(0xdfe8ff, 0.9));

    this.#cue = buildCue();
    this.scene.add(this.#cue);

    this.resize();
  }

  get view(): CameraView {
    return this.#view;
  }

  setView(view: CameraView): void {
    this.#view = view;
  }

  toggleView(): CameraView {
    this.#view = this.#view === 'behind' ? 'overhead' : 'behind';
    return this.#view;
  }

  resize(): void {
    const width = this.#canvas.clientWidth || 1;
    const height = this.#canvas.clientHeight || 1;
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    this.#renderer.setSize(width, height, false);
    this.#camera.aspect = width / height;
    this.#camera.updateProjectionMatrix();
  }

  /** Where a screen point lands on the cloth, or undefined if it misses the plane. */
  pointerToTable(clientX: number, clientY: number): Vec2 | undefined {
    const rect = this.#canvas.getBoundingClientRect();
    this.#pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.#raycaster.setFromCamera(this.#pointer, this.#camera);
    const hit = this.#raycaster.ray.intersectPlane(this.#clothPlane, this.#hit);
    if (!hit) return undefined;
    return fromWorld(hit.x, hit.z);
  }

  render(state: RenderState): void {
    this.#syncBalls(state);
    const cuePos = this.#interpolatedPosition(state, 0);
    this.#placeCue(cuePos, state);
    this.#placeCamera(cuePos, state.aimAngle);
    this.#renderer.render(this.scene, this.#camera);
  }

  dispose(): void {
    this.#renderer.dispose();
  }

  #syncBalls(state: RenderState): void {
    const live = new Set<number>();
    for (let i = 0; i < state.balls.length; i++) {
      const ball = state.balls[i]!;
      live.add(ball.id);
      let mesh = this.#ballMeshes.get(ball.id);
      if (!mesh) {
        mesh = new Mesh(
          new SphereGeometry(BALL_RADIUS, 24, 16),
          new MeshStandardMaterial({
            color: BALL_COLORS[ball.id % BALL_COLORS.length]!,
            roughness: 0.25,
            metalness: 0.05,
          }),
        );
        mesh.castShadow = true;
        this.scene.add(mesh);
        this.#ballMeshes.set(ball.id, mesh);
      }
      mesh.visible = !ball.potted;
      if (!ball.potted) {
        writeWorld(mesh.position, this.#interpolatedPosition(state, i), BALL_RADIUS);
      }
    }
    for (const [id, mesh] of this.#ballMeshes) {
      if (!live.has(id)) mesh.visible = false;
    }
  }

  #interpolatedPosition(state: RenderState, index: number): Vec2 {
    const current = state.balls[index];
    if (!current) return vec(0, 0);
    const previous = state.previous[index];
    if (!previous || current.potted) return current.pos;
    return lerpVec(previous.pos, current.pos, state.alpha);
  }

  #placeCue(cuePos: Vec2, state: RenderState): void {
    this.#cue.visible = state.showCue;
    if (!state.showCue) return;
    const direction = headingToWorld(state.aimAngle);
    const back = CUE_GAP + BALL_RADIUS + state.power * CUE_MAX_PULLBACK;
    const origin = toWorld(cuePos, BALL_RADIUS);
    this.#cue.position.copy(origin).addScaledVector(direction, -back);
    this.#cue.rotation.y = headingToRotationY(state.aimAngle);
  }

  #placeCamera(cuePos: Vec2, aimAngle: number): void {
    if (this.#view === 'overhead') {
      this.#camera.up.set(0, 0, -1);
      this.#camera.position.set(0, 2.15, 0);
      this.#camera.lookAt(0, 0, 0);
      return;
    }
    const direction = headingToWorld(aimAngle);
    const origin = toWorld(cuePos, 0);
    this.#camera.up.set(0, 1, 0);
    this.#camera.position
      .copy(origin)
      .addScaledVector(direction, -0.78)
      .add(new Vector3(0, 0.46, 0));
    this.#camera.lookAt(origin.clone().addScaledVector(direction, 0.75).setY(0.02));
  }
}

/** Cue stick lying along +x in its own space, tip at the origin. */
function buildCue(): Group {
  const group = new Group();
  group.name = 'cue';
  const shaft = new Mesh(
    new CylinderGeometry(0.007, 0.013, CUE_LENGTH, 12),
    new MeshStandardMaterial({ color: 0xd8b98a, roughness: 0.5 }),
  );
  shaft.rotation.z = Math.PI / 2;
  shaft.position.x = -CUE_LENGTH / 2;
  shaft.castShadow = true;
  group.add(shaft);

  const tip = new Mesh(
    new CylinderGeometry(0.007, 0.007, 0.012, 12),
    new MeshStandardMaterial({ color: 0x3f6bb5, roughness: 0.6 }),
  );
  tip.rotation.z = Math.PI / 2;
  tip.position.x = -0.006;
  group.add(tip);

  return group;
}
