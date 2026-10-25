/**
 * The room's two textures, drawn to a canvas at runtime like the balls': no
 * image assets to ship or load. Both repeat, the floor's boards across the
 * whole floor and the wall's panelling once per bay, so each is small.
 *
 * They carry colour only. The light is baked into the room's vertex colours,
 * and the texture is multiplied by it, so nothing here is shaded.
 */

import { CanvasTexture, ClampToEdgeWrapping, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import { makeRng } from '../game/random';

/** The square of floor one texture covers, in metres. */
export const FLOOR_TILE = 1;
/** Boards across a tile: 12.5 cm each. */
const BOARDS_PER_TILE = 8;
const FLOOR_SIZE = 512;
export const FLOOR_COLOR = '#5a3e2a';
const BOARD_GAP_COLOR = 'rgba(20, 10, 4, 0.3)';

/** Oxblood above the chair rail: warm against the green cloth, and quiet. */
export const WALL_COLOR = '#642e29';
const WAINSCOT_COLOR = '#3c2517';
const CHAIR_RAIL_COLOR = '#5a3a24';
const BASEBOARD_COLOR = '#2b1a0f';
const WALL_WIDTH = 256;
const WALL_HEIGHT_PIXELS = 512;
/** Texels in the two textures together: what they cost in video memory, before mipmaps. */
export const ROOM_TEXELS = FLOOR_SIZE * FLOOR_SIZE + WALL_WIDTH * WALL_HEIGHT_PIXELS;

/** Heights off the floor, in metres. */
const CHAIR_RAIL = 0.9;
const CHAIR_RAIL_DEPTH = 0.06;
const BASEBOARD = 0.12;
/** The raised panel in each bay of wainscot, and the frame of stiles and rails round it. */
const PANEL_BOTTOM = 0.22;
const PANEL_TOP = 0.76;
const STILE = 0.07;

/** Floorboards along u, 12.5 cm across, end joints staggered. Undefined without a DOM. */
export function floorTexture(): Texture | undefined {
  const ctx = canvas(FLOOR_SIZE, FLOOR_SIZE);
  if (!ctx) return undefined;
  paintFloor(ctx);
  const texture = finish(ctx.canvas);
  texture.wrapT = RepeatWrapping;
  return texture;
}

/**
 * One bay of the walls, `bayWidth` metres across and the full `wallHeight`
 * tall: baseboard, dark wainscot with a raised panel, a chair rail, and plain
 * oxblood above. Undefined without a DOM.
 */
export function wallTexture(bayWidth: number, wallHeight: number): Texture | undefined {
  const ctx = canvas(WALL_WIDTH, WALL_HEIGHT_PIXELS);
  if (!ctx) return undefined;
  paintWall(ctx, bayWidth, wallHeight);
  const texture = finish(ctx.canvas);
  texture.wrapT = ClampToEdgeWrapping;
  return texture;
}

function canvas(width: number, height: number): CanvasRenderingContext2D | undefined {
  if (typeof document === 'undefined') return undefined;
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  return element.getContext('2d') ?? undefined;
}

function finish(element: HTMLCanvasElement): Texture {
  const texture = new CanvasTexture(element);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.anisotropy = 2;
  return texture;
}

function paintFloor(ctx: CanvasRenderingContext2D): void {
  const size = FLOOR_SIZE;
  const strip = size / BOARDS_PER_TILE;
  const random = makeRng(0x0f100c);
  ctx.fillStyle = FLOOR_COLOR;
  ctx.fillRect(0, 0, size, size);

  for (let row = 0; row < BOARDS_PER_TILE; row++) {
    const top = row * strip;
    // Two boards to a row, their joints anywhere along it, wrapping round so
    // the tile repeats without a seam.
    const first = random() * size;
    const second = first + size * (0.35 + 0.3 * random());
    for (const [from, to] of [
      [first, second],
      [second, first + size],
    ] as const) {
      ctx.save();
      ctx.beginPath();
      wrappedRect(ctx, from, top, to - from, strip, size);
      ctx.clip();
      ctx.fillStyle = shade(FLOOR_COLOR, 0.92 + 0.16 * random());
      ctx.fillRect(0, top, size, strip);
      paintGrain(ctx, top, strip, random);
      ctx.restore();

      ctx.fillStyle = BOARD_GAP_COLOR;
      wrappedFill(ctx, from - 0.75, top, 1.5, strip, size);
    }
    ctx.fillStyle = BOARD_GAP_COLOR;
    ctx.fillRect(0, top, size, 1);
  }
}

/** Lines along the board, wavering by whole periods across the tile so they meet themselves at the seam. */
function paintGrain(ctx: CanvasRenderingContext2D, top: number, strip: number, random: () => number): void {
  const size = FLOOR_SIZE;
  for (let line = 0; line < 9; line++) {
    const y = top + strip * (0.1 + 0.8 * random());
    const amplitude = 1 + 3 * random();
    const waves = 1 + Math.floor(3 * random());
    const phase = random() * Math.PI * 2;
    ctx.strokeStyle = random() < 0.5 ? 'rgba(40, 22, 10, 0.12)' : 'rgba(150, 110, 70, 0.07)';
    ctx.lineWidth = 0.6 + 1.2 * random();
    ctx.beginPath();
    for (let x = 0; x <= size; x += 8) {
      const wobble = amplitude * Math.sin((x / size) * Math.PI * 2 * waves + phase);
      if (x === 0) ctx.moveTo(x, y + wobble);
      else ctx.lineTo(x, y + wobble);
    }
    ctx.stroke();
  }
}

function paintWall(ctx: CanvasRenderingContext2D, bayWidth: number, wallHeight: number): void {
  const width = WALL_WIDTH;
  const y = (metres: number): number => WALL_HEIGHT_PIXELS * (1 - metres / wallHeight);
  const x = (metres: number): number => (metres / bayWidth) * width;

  ctx.fillStyle = WALL_COLOR;
  ctx.fillRect(0, 0, width, WALL_HEIGHT_PIXELS);

  ctx.fillStyle = WAINSCOT_COLOR;
  ctx.fillRect(0, y(CHAIR_RAIL), width, y(0) - y(CHAIR_RAIL));

  // The raised panel, lit from above: its top and left bevels catch the light.
  const left = x(STILE);
  const right = width - x(STILE);
  const top = y(PANEL_TOP);
  const bottom = y(PANEL_BOTTOM);
  ctx.fillStyle = shade(WAINSCOT_COLOR, 1.12);
  ctx.fillRect(left, top, right - left, bottom - top);
  ctx.fillStyle = 'rgba(255, 220, 180, 0.14)';
  ctx.fillRect(left, top, right - left, 2);
  ctx.fillRect(left, top, 2, bottom - top);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fillRect(left, bottom - 2, right - left, 2);
  ctx.fillRect(right - 2, top, 2, bottom - top);
  // The stiles meet at the edge of the bay, where the next one starts.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.fillRect(0, y(CHAIR_RAIL), 1, y(BASEBOARD) - y(CHAIR_RAIL));

  ctx.fillStyle = CHAIR_RAIL_COLOR;
  ctx.fillRect(0, y(CHAIR_RAIL + CHAIR_RAIL_DEPTH / 2), width, y(CHAIR_RAIL - CHAIR_RAIL_DEPTH / 2) - y(CHAIR_RAIL + CHAIR_RAIL_DEPTH / 2));
  ctx.fillStyle = 'rgba(255, 220, 180, 0.18)';
  ctx.fillRect(0, y(CHAIR_RAIL + CHAIR_RAIL_DEPTH / 2), width, 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  ctx.fillRect(0, y(CHAIR_RAIL - CHAIR_RAIL_DEPTH / 2), width, 2);

  ctx.fillStyle = BASEBOARD_COLOR;
  ctx.fillRect(0, y(BASEBOARD), width, y(0) - y(BASEBOARD));
  ctx.fillStyle = 'rgba(255, 220, 180, 0.12)';
  ctx.fillRect(0, y(BASEBOARD), width, 2);
}

/** A rectangle `x` to `x + width`, wrapped round a tile `size` wide, added to the current path. */
function wrappedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, size: number): void {
  const start = ((x % size) + size) % size;
  ctx.rect(start, y, Math.min(width, size - start), height);
  if (start + width > size) ctx.rect(0, y, start + width - size, height);
}

function wrappedFill(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, size: number): void {
  ctx.beginPath();
  wrappedRect(ctx, x, y, width, height, size);
  ctx.fill();
}

/** A `#rrggbb` colour scaled by `factor`, as a CSS colour. */
function shade(hex: string, factor: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (shift: number): number => Math.min(255, Math.round(((value >> shift) & 0xff) * factor));
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}
