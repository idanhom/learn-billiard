/**
 * Numbered ball textures, drawn to a canvas at runtime — no image assets to
 * ship or load.
 *
 * SphereGeometry uses an equirectangular UV layout: u wraps around the
 * equator, v runs pole to pole. So a stripe is a band in the middle of the
 * texture, and the number patches sit on the equator at opposite sides.
 */

import { CanvasTexture, type Texture, SRGBColorSpace } from 'three';

const WIDTH = 256;
const HEIGHT = 128;

/** Standard pool ball colours, 1 through 7; 9 through 15 repeat them striped. */
const SUIT_COLORS = [
  '#e8b62c', // 1 yellow
  '#2f5fc4', // 2 blue
  '#c8402c', // 3 red
  '#6b3fa0', // 4 purple
  '#e07a2c', // 5 orange
  '#1f7a4a', // 6 green
  '#8a2f2f', // 7 maroon
];

const CUE_COLOR = '#f5f3ec';
const EIGHT_COLOR = '#151515';
const CUE_MARK_COLOR = '#b23a2e';

/**
 * Half-angle a cue-ball mark subtends at the ball's centre, in radians.
 *
 * Deliberately fatter than a real measle ball, whose spots come in around 8
 * degrees. At ~17 they still read at the behind-cue framing, where the ball is
 * a few dozen pixels across. This is a legibility choice, not a measurement of
 * any ball.
 */
export const MARK_ANGULAR_RADIUS = 0.295;

/** A mark centre in texture space, plus how much of the ball it covers. */
export interface CueMark {
  readonly u: number;
  /** 0 and 1 are the poles, where the mark is painted as a band. */
  readonly v: number;
  readonly radius: number;
}

/**
 * Marks on the six octahedral axes.
 *
 * Six, not two: with a single pair, every rotation about the axis through them
 * is invisible, and a rolling ball turns about whichever horizontal axis the
 * shot handed it. Four round the equator at 90-degree spacing plus both poles
 * is the smallest arrangement with no blind axis — which is why a real training
 * ball carries six.
 *
 * The equatorial four sit at u = 0.125, 0.375, 0.625, 0.875 rather than at
 * multiples of 0.25, so none of them straddles the u = 0 seam.
 */
export const CUE_MARKS: readonly CueMark[] = [
  { u: 0.125, v: 0.5, radius: MARK_ANGULAR_RADIUS },
  { u: 0.375, v: 0.5, radius: MARK_ANGULAR_RADIUS },
  { u: 0.625, v: 0.5, radius: MARK_ANGULAR_RADIUS },
  { u: 0.875, v: 0.5, radius: MARK_ANGULAR_RADIUS },
  { u: 0.5, v: 0, radius: MARK_ANGULAR_RADIUS },
  { u: 0.5, v: 1, radius: MARK_ANGULAR_RADIUS },
];

/** Solids 1-7, the 8-ball, then stripes 9-15 repeating the same seven colours. */
const SUIT_CYCLE = SUIT_COLORS.length + 1;

const cache = new Map<number, Texture>();

export const CUE_BALL_NUMBER = 0;
export const HIGHEST_BALL_NUMBER = 15;

/**
 * The cloth colour of a ball, ignoring the stripe. 9 repeats 1 and 15 repeats
 * 7, with the 8-ball sitting between the two suits — so the cycle is eight
 * long, not seven.
 */
export function ballColor(ballNumber: number): string {
  if (ballNumber === CUE_BALL_NUMBER) return CUE_COLOR;
  if (ballNumber === 8) return EIGHT_COLOR;
  return SUIT_COLORS[(ballNumber - 1) % SUIT_CYCLE] ?? EIGHT_COLOR;
}

/** 1-15, or 0 for the cue ball. Cached, so repeated shots cost nothing. */
export function ballTexture(ballNumber: number): Texture | undefined {
  const cached = cache.get(ballNumber);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;

  paintBall(ctx, ballNumber);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 2;
  cache.set(ballNumber, texture);
  return texture;
}

function paintBall(ctx: CanvasRenderingContext2D, ballNumber: number): void {
  if (ballNumber === CUE_BALL_NUMBER) {
    paintCueBall(ctx);
    return;
  }

  const striped = ballNumber > 8;
  const color = ballColor(ballNumber);

  if (striped) {
    // White poles with a coloured band around the equator.
    ctx.fillStyle = CUE_COLOR;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = color;
    ctx.fillRect(0, HEIGHT * 0.28, WIDTH, HEIGHT * 0.44);
  } else {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  // Number patches on opposite sides of the equator, as on a real ball.
  for (const centerX of [WIDTH * 0.25, WIDTH * 0.75]) {
    drawNumberPatch(ctx, centerX, HEIGHT / 2, ballNumber);
  }
}

/**
 * A flat white ball is a puck: nothing about it says which way it is turning,
 * so the slide-to-roll transition the simulation computes never reaches the
 * player. The marks are the whole point of it.
 *
 * A pole mark is a band, not a disc — at constant v an equirectangular strip IS
 * a polar cap, and drawing a circle there would smear round the pole instead.
 * Away from the poles, degrees per pixel are equal in both axes (256 px over
 * 360 degrees, 128 over 180), which is what lets one radius serve both.
 */
function paintCueBall(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = CUE_COLOR;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = CUE_MARK_COLOR;
  for (const mark of CUE_MARKS) {
    const pixels = (mark.radius / Math.PI) * HEIGHT;
    if (mark.v === 0) {
      ctx.fillRect(0, 0, WIDTH, pixels);
    } else if (mark.v === 1) {
      ctx.fillRect(0, HEIGHT - pixels, WIDTH, pixels);
    } else {
      ctx.beginPath();
      ctx.arc(mark.u * WIDTH, mark.v * HEIGHT, pixels, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawNumberPatch(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ballNumber: number,
): void {
  const radius = HEIGHT * 0.22;
  ctx.fillStyle = CUE_COLOR;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#101010';
  ctx.font = `600 ${Math.round(radius * 1.25)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(ballNumber), x, y + 1);
}

/**
 * Pick a ball for a layout. Deterministic in the layout id, so retrying a shot
 * shows the same ball and the table does not flicker between renders.
 */
export function ballNumberFor(layoutId: string): number {
  let hash = 0;
  for (let i = 0; i < layoutId.length; i++) {
    hash = (Math.imul(hash, 31) + layoutId.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) % HIGHEST_BALL_NUMBER) + 1;
}

/**
 * Numbers for the rest of the balls on the table. Index 0 is the object ball
 * itself; every obstacle after it takes the next number along, so no two balls
 * in a layout look alike.
 */
export function companionBallNumber(objectBallNumber: number, index: number): number {
  return ((objectBallNumber - 1 + index) % HIGHEST_BALL_NUMBER) + 1;
}
