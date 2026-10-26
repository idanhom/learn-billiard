/**
 * Rendering: table, the room round it, balls, cue stick, camera rig.
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
  Quaternion,
  Raycaster,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { BALL_RADIUS, TABLE, pocketById } from '../geometry/table';
import { type Vec2, add, dist, lerp as lerpVec, scale, vec } from '../geometry/vec2';
import type { Ball } from '../physics/world';
import { CUE_BALL_NUMBER, ballTexture, companionBallNumber } from './ball-textures';
import { fromWorld, headingToRotationY, writeHeading, writeWorld, writeWorldQuat } from './coords';
import { Guides } from './guides';
import { Trails } from './trails';
import { ZoneMarker } from './zone';
import { STANCE_BACK, STANCE_EYE_HEIGHT, stanceFraming } from './stance';
import { FRAME_MARGIN, buildTable } from './table-mesh';
import { Room, bedGain } from './room';
import { Orbit } from './explore';

export type CameraView = 'behind' | 'overhead' | 'stance';

/** The order V steps through the views. */
const VIEW_CYCLE: readonly CameraView[] = ['behind', 'overhead', 'stance'];

const MAX_PIXEL_RATIO = 1.5;
const CUE_LENGTH = 1.35;
const CUE_GAP = 0.02;
const CUE_MAX_PULLBACK = 0.28;
/** Cue ball centre to the butt of the cue, drawn back as far as it goes. */
export const CUE_REACH = CUE_GAP + BALL_RADIUS + CUE_MAX_PULLBACK + CUE_LENGTH;

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

/** How far behind the cue ball the behind view stands for a shot reaching `reach` metres ahead. */
export function behindBack(reach: number): number {
  return VIEW_MIN_BACK + reach * VIEW_BACK_PER_METRE;
}

/**
 * Vertical field of view, in degrees, on a screen wider than it is tall. A
 * phone held upright would see a 33 degree sliver across at the same setting,
 * too narrow to keep a cut shot's pocket in view, so there the vertical field
 * widens until the horizontal one reaches `MIN_ACROSS_FOV`, up to `MAX_FOV`.
 */
const BASE_FOV = 52;
const MIN_ACROSS_FOV = 55;
const MAX_FOV = 80;

/**
 * How much room the overhead view leaves around the table, frame included:
 * enough that the panels down either side of a desktop window clear it. It is
 * what the view used to be at a fixed 2.15 m on a 1280x760 window, now kept
 * on any shape of screen.
 */
const OVERHEAD_MARGIN = 1.56;

/** How long a potted ball takes to drop out of sight. */
const SINK_SECONDS = 0.3;

/** How long a replay takes to fade into the shot it hands back to. */
const CROSSFADE_SECONDS = 0.4;

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
  /** Cue ball to ghost ball, which the stance view keeps in frame. */
  readonly cueToGhost: number;
  /** Take the balls off the table, as a flash drill does once its moment is up. */
  readonly hideBalls?: boolean;
  /** Seconds since the last rendered frame, for frame-rate-independent easing. */
  readonly dt: number;
}

export class PoolScene {
  readonly scene = new Scene();
  readonly guides = new Guides();
  readonly trails = new Trails();
  readonly zone = new ZoneMarker();
  readonly room: Room;

  readonly #renderer: WebGLRenderer;
  readonly #camera = new PerspectiveCamera(52, 1, 0.05, 60);
  readonly #canvas: HTMLCanvasElement;
  readonly #ballMeshes = new Map<number, Mesh>();
  /** Balls on their way down a pocket: where from, where to, and how long so far. */
  readonly #sinking = new Map<number, { readonly from: Vec2; readonly to: Vec2; age: number }>();
  readonly #cue: Group;
  readonly #ballNumbers = new Map<number, number>();
  readonly #cameraTarget = new Vector3();
  readonly #desiredPosition = new Vector3();
  readonly #desiredTarget = new Vector3();
  /** Scratch, reused every frame by the cue and camera placement. */
  readonly #origin = new Vector3();
  readonly #direction = new Vector3();
  /** Scratch, reused every frame by the ball orientation interpolation. */
  readonly #spinFrom = new Quaternion();
  readonly #spinTo = new Quaternion();

  #view: CameraView = 'behind';
  #viewSettled = false;
  /** The camera taken in hand after a shot. While it is, `#view` is where it goes back to. */
  #free: Orbit | undefined;
  /** The player has asked for less motion: the camera cuts rather than glides, and pots vanish. */
  #reducedMotion = false;
  /** The canvas's height in CSS pixels, and how far the player sits from it, for the stance view's true scale. */
  #cssHeight = 1;
  #viewingDistance = 0.6;
  /** A frame held over the canvas while it fades out, and how long it has left. */
  #fade: HTMLCanvasElement | undefined;
  #fadeLeft = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.#canvas = canvas;
    this.#renderer = new WebGLRenderer({ canvas, antialias: true });
    this.#renderer.shadowMap.enabled = true;

    this.scene.add(buildTable());
    this.scene.add(this.guides.group);
    this.scene.add(this.trails.group);
    this.scene.add(this.zone.group);

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

    const ambient = new AmbientLight(0xdfe8ff, 1.35);
    this.scene.add(ambient);

    // The room is unlit, its light baked against what these give the bed.
    this.room = new Room(bedGain([key, fill, ambient]));
    this.scene.add(this.room.group);
    this.#renderer.setClearColor(this.room.backdrop);

    this.#cue = buildCue();
    this.scene.add(this.#cue);

    this.resize();
  }

  get view(): CameraView {
    return this.#view;
  }

  setView(view: CameraView): void {
    this.#view = view;
    this.#free = undefined;
  }

  /** The next view in the cycle, or, with the camera free, the view it was taken from. */
  toggleView(): CameraView {
    if (this.#free) {
      this.#free = undefined;
      return this.#view;
    }
    this.#view = VIEW_CYCLE[(VIEW_CYCLE.indexOf(this.#view) + 1) % VIEW_CYCLE.length]!;
    return this.#view;
  }

  /** Whether the camera is free, moved by hand rather than placed by the view. */
  get free(): boolean {
    return this.#free !== undefined;
  }

  /** The free camera's pivot and its distance from it, or null when the camera is not free. */
  get orbit(): { readonly pivot: Vector3; readonly distance: number } | null {
    return this.#free ? { pivot: this.#free.pivot, distance: this.#free.distance } : null;
  }

  get cameraPosition(): Vector3 {
    return this.#camera.position.clone();
  }

  /** Turn the view round the table by a drag of this many pixels, freeing the camera if it is not already. */
  turn(dx: number, dy: number): void {
    this.#orbit().turn(dx, dy);
  }

  /** Bring the free camera `factor` times closer. */
  zoom(factor: number): void {
    this.#orbit().zoom(factor);
  }

  /** Slide the free camera so the cloth follows fingers moved this many pixels. */
  slide(dx: number, dy: number): void {
    this.#orbit().slide(dx, dy, this.#cssHeight, this.#camera.fov);
  }

  /** Put the camera back in the view it was taken from. */
  endFree(): void {
    this.#free = undefined;
  }

  /** The view a free camera goes back to, changed without putting it back. */
  setReturnView(view: CameraView): void {
    this.#view = view;
  }

  /** The camera as the last frame left it, taken in hand from there. */
  #orbit(): Orbit {
    this.#free ??= Orbit.fromCamera(
      this.#camera.position,
      this.#camera.getWorldDirection(new Vector3()),
      this.#camera.up,
    );
    return this.#free;
  }

  /** How far the player's eyes are from the screen, in metres: what true scale is measured against. */
  setViewingDistance(metres: number): void {
    this.#viewingDistance = metres;
  }

  setReducedMotion(reduce: boolean): void {
    this.#reducedMotion = reduce;
  }

  get reducedMotion(): boolean {
    return this.#reducedMotion;
  }

  /** The camera's vertical field of view, in degrees. */
  get fieldOfView(): number {
    return this.#camera.fov;
  }

  /**
   * The point on the table under a click, at the height of a ball's centre,
   * in table coordinates: where a ghost ball dropped there would sit.
   * Undefined when the click misses the table's plane.
   */
  pickTable(clientX: number, clientY: number): Vec2 | undefined {
    const rect = this.#canvas.getBoundingClientRect();
    const pointer = new Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new Raycaster();
    ray.setFromCamera(pointer, this.#camera);
    const hit = ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -BALL_RADIUS), new Vector3());
    return hit ? fromWorld(hit.x, hit.z) : undefined;
  }

  resize(): void {
    const width = this.#canvas.clientWidth;
    const height = this.#canvas.clientHeight;
    // Hidden, as it is while a drill sheet prints: keep the last size. Sized
    // to nothing, it would stay a single stretched pixel once shown again,
    // since showing it fires no resize of its own.
    if (width === 0 || height === 0) return;
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    this.#renderer.setSize(width, height, false);
    this.#cssHeight = height;
    this.#camera.aspect = width / height;
    this.#camera.fov = fieldOfView(this.#camera.aspect);
    this.#camera.updateProjectionMatrix();
  }

  render(state: RenderState): void {
    this.#syncBalls(state);
    const cuePos = this.#interpolatedPosition(state, 0);
    this.#placeCue(cuePos, state);
    this.#placeCamera(cuePos, state);
    this.room.setEyeHeight(this.#camera.position.y);
    this.#renderer.render(this.scene, this.#camera);
    if (this.#fadeLeft > 0) this.#fadeOut(state.dt);
  }

  /**
   * Hold what is on screen now and fade it out over whatever is drawn next, as
   * a replay hands back to the shot. A cut where motion is reduced.
   */
  crossfade(): void {
    if (this.#reducedMotion) return;
    const fade = (this.#fade ??= this.#createFade());
    // The drawing buffer is not kept once a frame is shown: draw it again to copy it.
    this.#renderer.render(this.scene, this.#camera);
    fade.width = this.#canvas.width;
    fade.height = this.#canvas.height;
    fade.getContext('2d')?.drawImage(this.#canvas, 0, 0);
    fade.style.opacity = '1';
    fade.style.display = 'block';
    this.#fadeLeft = CROSSFADE_SECONDS;
  }

  #createFade(): HTMLCanvasElement {
    const fade = document.createElement('canvas');
    fade.className = 'crossfade';
    fade.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:none';
    this.#canvas.after(fade);
    return fade;
  }

  #fadeOut(dt: number): void {
    const fade = this.#fade!;
    this.#fadeLeft = Math.max(0, this.#fadeLeft - dt);
    // Eased out: quick to start clearing, gentle as the last of it goes.
    const left = this.#fadeLeft / CROSSFADE_SECONDS;
    fade.style.opacity = String(left * left);
    if (this.#fadeLeft === 0) fade.style.display = 'none';
  }

  /** What the last frame cost the GPU: draw calls and triangles, the shadow pass included. */
  get renderInfo(): { readonly calls: number; readonly triangles: number } {
    const { calls, triangles } = this.#renderer.info.render;
    return { calls, triangles };
  }

  /**
   * The colour at a point of the canvas, `xFrac` across and `yFrac` down, as
   * 0-255 sRGB. Draws the last frame again first: the drawing buffer is not
   * kept once a frame is shown.
   */
  sample(xFrac: number, yFrac: number): [number, number, number] {
    this.#renderer.render(this.scene, this.#camera);
    const gl = this.#renderer.getContext();
    const x = Math.min(gl.drawingBufferWidth - 1, Math.floor(xFrac * gl.drawingBufferWidth));
    const y = Math.min(gl.drawingBufferHeight - 1, Math.floor((1 - yFrac) * gl.drawingBufferHeight));
    const pixel = new Uint8Array(4);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return [pixel[0]!, pixel[1]!, pixel[2]!];
  }

  /**
   * Draws the last frame `count` times and waits for the GPU: milliseconds per
   * frame. It waits by reading a pixel back, since Chromium's `finish` returns
   * without waiting for its GPU process.
   */
  timeRenders(count: number): number {
    const gl = this.#renderer.getContext();
    const pixel = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    const started = performance.now();
    for (let i = 0; i < count; i++) this.#renderer.render(this.scene, this.#camera);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return (performance.now() - started) / count;
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

      if (!ball.potted) {
        this.#sinking.delete(ball.id);
        mesh.visible = !state.hideBalls;
        writeWorld(mesh.position, this.#interpolatedPosition(state, i), BALL_RADIUS);
        this.#writeOrientation(mesh.quaternion, state, i);
        continue;
      }
      mesh.visible = !state.hideBalls && this.#sink(ball, mesh, state.dt);
    }
    for (const [id, mesh] of this.#ballMeshes) {
      if (!live.has(id)) mesh.visible = false;
    }
  }

  /**
   * A potted ball drops into the hole rather than vanishing at the drop line:
   * over a fraction of a second it slides on toward the middle of the hole
   * and falls through the slate. False once it is gone.
   */
  #sink(ball: Ball, mesh: Mesh, dt: number): boolean {
    if (this.#reducedMotion) return false;
    let sink = this.#sinking.get(ball.id);
    if (!sink) {
      if (!ball.pocket) return false;
      const { drop } = pocketById(ball.pocket);
      const middle = lerpVec(drop.a, drop.b, 0.5);
      const to = add(middle, scale(drop.normal, dist(drop.a, drop.b) / 4));
      sink = { from: ball.pos, to, age: 0 };
      this.#sinking.set(ball.id, sink);
    }
    sink.age += dt;
    const t = Math.min(1, sink.age / SINK_SECONDS);
    if (t >= 1) return false;
    const along = 1 - (1 - t) ** 2;
    writeWorld(mesh.position, lerpVec(sink.from, sink.to, along), BALL_RADIUS - 2.4 * BALL_RADIUS * t * t);
    return true;
  }

  #interpolatedPosition(state: RenderState, index: number): Vec2 {
    const current = state.balls[index];
    if (!current) return vec(0, 0);
    const previous = state.previous[index];
    if (!previous || current.potted) return current.pos;
    return lerpVec(previous.pos, current.pos, state.alpha);
  }

  /**
   * Orientation on the same `alpha` as the position, so the ball's turn and its
   * travel stay in step. Slerped in the table frame and converted once —
   * conjugating by a fixed basis is an isometry, so the order does not matter
   * and this way costs one conjugation instead of two.
   */
  #writeOrientation(target: Quaternion, state: RenderState, index: number): void {
    const current = state.balls[index];
    if (!current) return;
    const previous = state.previous[index];
    if (!previous) {
      writeWorldQuat(target, current.spin);
      return;
    }
    this.#spinFrom.set(previous.spin.x, previous.spin.y, previous.spin.z, previous.spin.w);
    this.#spinTo.set(current.spin.x, current.spin.y, current.spin.z, current.spin.w);
    this.#spinFrom.slerp(this.#spinTo, state.alpha);
    writeWorldQuat(target, this.#spinFrom);
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
    if (this.#free) {
      // From the stance's narrow true scale, the field widens from the same
      // eye rather than jumping: the first drag reveals more of the table.
      const fov = fieldOfView(this.#camera.aspect);
      const t = this.#reducedMotion ? 1 : 1 - Math.exp(-VIEW_SMOOTHING_RATE * Math.max(0, state.dt));
      const next = this.#camera.fov + (fov - this.#camera.fov) * t;
      this.#setFov(Math.abs(fov - next) < 0.01 ? fov : next);
      this.#free.write(this.#camera.position, this.#cameraTarget);
      this.#camera.up.set(0, 1, 0);
      this.#camera.lookAt(this.#cameraTarget);
      this.#viewSettled = false;
      return;
    }
    if (this.#view === 'stance') {
      // Down on the shot: on the cue line, the eye where a player's would be,
      // tipped down to keep cue ball and object ball both in frame.
      const framing = stanceFraming(this.#cssHeight, this.#viewingDistance, state.cueToGhost);
      this.#setFov(framing.fov);
      const direction = writeHeading(this.#direction, state.aimAngle);
      const origin = writeWorld(this.#origin, cuePos, 0);
      this.#camera.position.copy(origin).addScaledVector(direction, -STANCE_BACK);
      this.#camera.position.y = STANCE_EYE_HEIGHT;
      const pitch = (framing.pitch * Math.PI) / 180;
      this.#cameraTarget.copy(this.#camera.position).addScaledVector(direction, Math.cos(pitch));
      this.#cameraTarget.y -= Math.sin(pitch);
      this.#camera.up.set(0, 1, 0);
      this.#camera.lookAt(this.#cameraTarget);
      this.#viewSettled = false;
      return;
    }
    this.#setFov(fieldOfView(this.#camera.aspect));

    if (this.#view === 'overhead') {
      // The whole table, frame and all, on any shape of screen. Upright, the
      // table turns so its length runs up the screen rather than off its sides.
      const upright = this.#camera.aspect < 1;
      const long = TABLE.playLength + 2 * FRAME_MARGIN;
      const short = TABLE.playWidth + 2 * FRAME_MARGIN;
      const halfTall = Math.tan((this.#camera.fov * Math.PI) / 360);
      const fitTall = (upright ? long : short) / 2 / halfTall;
      const fitWide = (upright ? short : long) / 2 / (halfTall * this.#camera.aspect);
      if (upright) this.#camera.up.set(1, 0, 0);
      else this.#camera.up.set(0, 0, -1);
      this.#camera.position.set(0, OVERHEAD_MARGIN * Math.max(fitTall, fitWide), 0);
      this.#camera.lookAt(0, 0, 0);
      this.#viewSettled = false;
      return;
    }

    const direction = writeHeading(this.#direction, state.aimAngle);
    const origin = writeWorld(this.#origin, cuePos, 0);
    const reach = Math.max(0, state.shotLength);

    this.#desiredPosition.copy(origin).addScaledVector(direction, -behindBack(reach));
    this.#desiredPosition.y += VIEW_MIN_HEIGHT + reach * VIEW_HEIGHT_PER_METRE;

    this.#desiredTarget
      .copy(origin)
      .addScaledVector(direction, Math.max(0.5, reach * 0.55));
    this.#desiredTarget.y = 0.02;

    // Ease toward the framing rather than snapping, so fine aim adjustments
    // do not jolt the whole view.
    if (this.#viewSettled && !this.#reducedMotion) {
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

  #setFov(fov: number): void {
    if (Math.abs(this.#camera.fov - fov) < 1e-9) return;
    this.#camera.fov = fov;
    this.#camera.updateProjectionMatrix();
  }
}

/** Vertical field of view for a screen of this shape; see `BASE_FOV`. */
function fieldOfView(aspect: number): number {
  const across = Math.tan((MIN_ACROSS_FOV * Math.PI) / 360) / aspect;
  const tall = (360 * Math.atan(across)) / Math.PI;
  return Math.min(MAX_FOV, Math.max(BASE_FOV, tall));
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
