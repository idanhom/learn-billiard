/**
 * The stance view: where the eye is when you are down on a shot, and how much
 * of the table a screen can honestly show from there.
 *
 * The eye sits a fixed distance behind the cue ball and a fixed height over
 * the cloth, on the cue line. Seen from there at true scale, the screen is a
 * window onto the table: the vertical field of view is the angle the window
 * itself subtends at the player's eye, 2 atan(h / 2d), for a canvas h tall seen
 * from d away. Angles on screen are then angles at the table, which is the
 * point of practising in this view.
 *
 * True scale is narrow. A 760 px window seen from 60 cm is 19 degrees tall, and
 * from a stance eye the cue ball and the object ball can be further apart than
 * that. So the view widens just enough to keep both in frame, with a margin,
 * and is true scale whenever the screen allows.
 */

import { BALL_RADIUS } from '../geometry/table';

/** Eye height over the cloth, and how far behind the cue ball it sits, in metres. */
export const STANCE_EYE_HEIGHT = 0.3;
export const STANCE_BACK = 0.45;

/** Room left above the object ball and below the cue ball, in degrees. */
const FRAME_MARGIN_DEGREES = 3;

/** CSS defines its pixel as 1/96 of an inch, so this is a canvas's height in metres. */
const METRES_PER_CSS_PIXEL = 0.0254 / 96;

const MAX_FOV = 80;

export interface StanceFraming {
  /** Vertical field of view, in degrees. */
  readonly fov: number;
  /** How far below level the view looks, in degrees. */
  readonly pitch: number;
  /** Whether that field of view is the true-scale one. */
  readonly trueScale: boolean;
}

/** The vertical field of view at which a canvas `cssHeight` tall, seen from `viewingDistance` metres, is a window at true scale. */
export function trueScaleFov(cssHeight: number, viewingDistance: number): number {
  const height = cssHeight * METRES_PER_CSS_PIXEL;
  return (2 * Math.atan(height / 2 / viewingDistance) * 180) / Math.PI;
}

/**
 * The view down the cue line for a shot whose ghost ball is `cueToGhost`
 * metres from the cue ball: looking midway between the cue ball and the object
 * ball, at true scale if both fit, and otherwise just wide enough for them.
 */
export function stanceFraming(cssHeight: number, viewingDistance: number, cueToGhost: number): StanceFraming {
  const below = (along: number): number =>
    (Math.atan((STANCE_EYE_HEIGHT - BALL_RADIUS) / along) * 180) / Math.PI;
  const cueBall = below(STANCE_BACK);
  const objectBall = below(STANCE_BACK + cueToGhost + 2 * BALL_RADIUS);
  const needed = cueBall - objectBall + 2 * FRAME_MARGIN_DEGREES;
  const honest = trueScaleFov(cssHeight, viewingDistance);
  const fov = Math.min(MAX_FOV, Math.max(honest, needed));
  return { fov, pitch: (cueBall + objectBall) / 2, trueScale: fov === honest };
}
