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

const cache = new Map<number, Texture>();

export const CUE_BALL_NUMBER = 0;

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
    ctx.fillStyle = CUE_COLOR;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    return;
  }

  const striped = ballNumber > 8;
  const color =
    ballNumber === 8 ? EIGHT_COLOR : SUIT_COLORS[(ballNumber - 1) % SUIT_COLORS.length]!;

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
  return (Math.abs(hash) % 15) + 1;
}
