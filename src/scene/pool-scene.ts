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
import { CUE_BALL_NUMBER, ballTexture, companionBallNumber } from './ball-textures';
import { fromWorld, headingToRotationY, writeHeading, writeWorld } from './coords';
import { Guides } from './guides';
import { buildTable } from './table-mesh';

export type CameraView = 'behind' | 'overhead';

const MAX_PIXEL_RATIO = 1.5;
const CUE_LENGTH = 1.35;
const CUE_GAP = 0.02;
const CUE_MAX_PULLBACK = 0.28;

/** Behind-the-cue framing. The camera backs off on longer shots so the object
 * ball stays in view instead of vanishing over the horizon. */
const VIEW_MIN_BACK = 0.62;
const VIEW_BACK_PER_METRE = 0.22;
const VIEW_MIN_HEIGHT = 0.38;
const VIEW_HEIGHT_PER_METRE = 0.16;
/**
 * Rate at which the camera closes the remaining gap, per second. Applied
 * through `1 - exp(-rate * dt)` rather than as a fixed fraction per frame, so
 * the ease takes the same wall-clock time on a Pi at 30 fps as at 60.
 */
const VIEW_SMOOTHING_RATE = 15;

export interface RenderState {
  readonly balls: readonly Ball[];
  readonly previous: readonly Ball[];
  readonly alpha: number;
  readonly aimAngle: number;
  readonly power: number;
  readonly showCue: boolean;
  /** 1-15 for the object ball; the cue ball is always 0. */
  readonly objectBallNumber: number;
  /** How far ahead the shot reaches, used to frame the behind-cue camera. */
  readonly shotLength: number;
  /** Seconds since the last rendered frame, for frame-rate-independent easing. */
  readonly dt: number;
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
  readonly #ballNumbers = new Map<number, number>();
  readonly #cameraTarget = new Vector3();
  readonly #desiredPosition = new Vector3();
  readonly #desiredTarget = new Vector3();
  /** Scratch, reused every frame by the cue and camera placement. */
  readonly #origin = new Vector3();
  readonly #direction = new Vector3();

  #view: CameraView = 'behind';
  #viewSettled = false;

  constructor(canvas: HTMLCanvasElement) {
    this.#canvas = canvas;
    this.#renderer = new WebGLRenderer({ canvas, antialias: true });
    this.#renderer.shadowMap.enabled = true;

    this.scene.add(buildTable());
    this.scene.add(this.guides.group);

    // One shadow-casting key light, one cheap fill from the far side so the
    // top corners of the table do not fall away into the dark, and ambient to
    // lift the whole cloth. Only the key light pays for a shadow map.
    const key = new DirectionalLight(0xffffff, 2);
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

    const fill = new DirectionalLight(0xd6e4ff, 0.85);
    fill.position.set(-1.2, 1.6, -1.4);
    this.scene.add(fill);

    this.scene.add(new AmbientLight(0xdfe8ff, 1.35));

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
    this.#placeCamera(cuePos, state);
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
          new MeshStandardMaterial({ roughness: 0.22, metalness: 0.04 }),
        );
        mesh.castShadow = true;
        this.scene.add(mesh);
        this.#ballMeshes.set(ball.id, mesh);
      }

      // Ball 0 is the cue ball, ball 1 the object ball, and anything after it
      // an obstacle — which needs a number of its own, or the table reads as a
      // row of identical balls.
      const wanted =
        ball.id === 0
          ? CUE_BALL_NUMBER
          : companionBallNumber(state.objectBallNumber, ball.id - 1);
      if (this.#ballNumbers.get(ball.id) !== wanted) {
        this.#ballNumbers.set(ball.id, wanted);
        const material = mesh.material as MeshStandardMaterial;
        material.map = ballTexture(wanted) ?? null;
        material.needsUpdate = true;
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
    const direction = writeHeading(this.#direction, state.aimAngle);
    const back = CUE_GAP + BALL_RADIUS + state.power * CUE_MAX_PULLBACK;
    const origin = writeWorld(this.#origin, cuePos, BALL_RADIUS);
    this.#cue.position.copy(origin).addScaledVector(direction, -back);
    this.#cue.rotation.y = headingToRotationY(state.aimAngle);
  }

  #placeCamera(cuePos: Vec2, state: RenderState): void {
    if (this.#view === 'overhead') {
      this.#camera.up.set(0, 0, -1);
      this.#camera.position.set(0, 2.15, 0);
      this.#camera.lookAt(0, 0, 0);
      this.#viewSettled = false;
      return;
    }

    const direction = writeHeading(this.#direction, state.aimAngle);
    const origin = writeWorld(this.#origin, cuePos, 0);
    const reach = Math.max(0, state.shotLength);

    this.#desiredPosition
      .copy(origin)
      .addScaledVector(direction, -(VIEW_MIN_BACK + reach * VIEW_BACK_PER_METRE));
    this.#desiredPosition.y += VIEW_MIN_HEIGHT + reach * VIEW_HEIGHT_PER_METRE;

    this.#desiredTarget
      .copy(origin)
      .addScaledVector(direction, Math.max(0.5, reach * 0.55));
    this.#desiredTarget.y = 0.02;

    // Ease toward the framing rather than snapping, so fine aim adjustments
    // do not jolt the whole view.
    if (this.#viewSettled) {
      const t = 1 - Math.exp(-VIEW_SMOOTHING_RATE * Math.max(0, state.dt));
      this.#cameraTarget.lerp(this.#desiredTarget, t);
      this.#camera.position.lerp(this.#desiredPosition, t);
    } else {
      this.#cameraTarget.copy(this.#desiredTarget);
      this.#camera.position.copy(this.#desiredPosition);
      this.#viewSettled = true;
    }

    this.#camera.up.set(0, 1, 0);
    this.#camera.lookAt(this.#cameraTarget);
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
