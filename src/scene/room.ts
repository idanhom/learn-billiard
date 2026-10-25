/**
 * The room the table stands in, at the WPA's dimensions: the floor a bed
 * height below the cloth, the walls a playing clearance out from the rails.
 * At true scale, so the stance and behind views show what a player down on a
 * real table sees past it.
 *
 * Unlit, and cheap on purpose: it runs on a Pi and on phones. Every surface is
 * a `MeshBasicMaterial` whose light is baked into its vertex colours once, by
 * `lightAt`. No scene lights, no shadow maps, no image downloads. The light it
 * bakes is the one a lamp over a pool table gives a room: the table's shadow in
 * a dark skirt round it, a soft halo past that, and dim walls that fade out
 * toward the ceiling, so there is no ceiling to draw.
 *
 * The table's own lights and look are untouched. The room is measured against
 * them instead: `bedGain` is what they give the bed, and the bake is in
 * fractions of that.
 */

import {
  type AmbientLight,
  BoxGeometry,
  BufferGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Texture,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TABLE } from '../geometry/table';
import { FLOOR_COLOR, FLOOR_TILE, WALL_COLOR, floorTexture, wallTexture } from './room-textures';
import { FRAME_COLOR, FRAME_MARGIN } from './table-mesh';

/** WPA Recommended Equipment Specifications, section 2: the bed is 29 1/4" to 31" off the floor. This is the middle. */
export const BED_HEIGHT = 0.765;
/** WPA section 19: at least 6' from the outside edge of the rail to any obstacle. */
export const TABLE_CLEARANCE = 1.83;
/** An ordinary ceiling. The WPA does not set one. */
export const WALL_HEIGHT = 2.7;
/**
 * The room's own light, as a fraction of the bed's. WPA section 15 asks for at
 * least 520 lux on the bed and 50 everywhere else, but that is a minimum, and
 * the ratio it gives, about 0.1, rendered close to black. This sits higher,
 * still inside what the specification allows, so the room reads on a screen.
 */
export const ROOM_LIGHT = 0.25;

/** The outside edge of the rail, each way from the middle of the table. */
const RAIL_X = TABLE.playLength / 2 + FRAME_MARGIN;
const RAIL_Z = TABLE.playWidth / 2 + FRAME_MARGIN;
/** The walls, each way from the middle of the table. */
export const WALL_X = RAIL_X + TABLE_CLEARANCE;
export const WALL_Z = RAIL_Z + TABLE_CLEARANCE;
/** The cloth's top is y = 0. */
const FLOOR_Y = -BED_HEIGHT;

/** Venue light on a wall is full to this height off the floor, then fades... */
const FADE_FROM = 1.2;
/** ...to this share of it at the top, where the walls dissolve into the clear colour. */
const FADE_TO = 0.35;
/** Venue light under the table, as a share of the open floor's, and how far either side of its outline the change takes. */
const UNDER_TABLE = 0.4;
const UNDER_TABLE_EDGE = 0.3;
/** How much a wall's foot or a corner darkens, and how far out. */
const CORNER_SHADE = 0.3;
const CORNER_REACH = 0.2;

/** The lamp's diffuser, along and across the table, set up into its shade. */
const LAMP_LENGTH = 1.3;
const LAMP_WIDTH = 0.36;
const LAMP_RECESS = 0.02;
/** WPA section 15: a fixture that can be moved aside hangs no lower than 40" over the bed. The lamp's underside. */
export const LAMP_HEIGHT = 1.016;
const LAMP_SAMPLES_ALONG = 9;
const LAMP_SAMPLES_ACROSS = 3;
/**
 * The shade cuts the lamp's light off between 50 and 60 degrees from straight
 * down, kept as cosines. A design choice, not a measurement.
 */
const SHADE_FROM = Math.cos((50 * Math.PI) / 180);
const SHADE_TO = Math.cos((60 * Math.PI) / 180);

/** Colours of light, each scaled to unit luminance so a tint never changes how much light there is. */
const VENUE_TINT = tint(1, 0.78, 0.55);
const LAMP_TINT = tint(1, 0.94, 0.84);

/**
 * The cabinet under the frame: an apron round it and a leg at each corner.
 * The apron starts at the frame's underside in `table-mesh.ts`, and a test
 * holds the two together.
 */
export const APRON_TOP = -0.1;
const APRON_DEPTH = 0.18;
const APRON_INSET = 0.015;
const LEG_WIDTH = 0.13;
const LEG_INSET = 0.03;
const FOOT_WIDTH = 0.17;
const FOOT_HEIGHT = 0.05;

/** The floor's grid, and the walls': along them every 10 cm, and up them at these heights, close where the light changes fast at the foot. */
const FLOOR_STEP = 0.08;
const WALL_STEP = 0.1;
const WALL_ROWS = [0, 0.05, 0.1, 0.15, ...Array.from({ length: 19 }, (_, i) => 0.2 + i * 0.1), 2.2, 2.45, WALL_HEIGHT];
/** The panelling repeats about this often, fitted to a whole number of bays on each wall. */
const BAY = 1.2;

export interface Point3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Linear RGB. */
export type Rgb = readonly [number, number, number];

const UP: Point3 = { x: 0, y: 1, z: 0 };

/**
 * The light at a surface of the room, as a fraction of the light on the bed
 * under the lamp, in linear RGB at unit luminance per unit of light.
 *
 * Two sources. The venue's own light, from fittings out of sight overhead, is
 * `ROOM_LIGHT` on open floor; it fades up the walls, falls away under the
 * table and darkens into the foot of each wall and corner. The lamp over the
 * table spills past it: Lambertian from its diffuser, cut off by its shade,
 * and stopped by the table wherever the line to the lamp crosses the table's
 * outline at bed height.
 */
export function lightAt(point: Point3, normal: Point3): Rgb {
  const venue = venueLight(point, normal);
  const lamp = lampFlux(point, normal) / LAMP_AT_BED;
  return [
    venue * VENUE_TINT[0] + lamp * LAMP_TINT[0],
    venue * VENUE_TINT[1] + lamp * LAMP_TINT[1],
    venue * VENUE_TINT[2] + lamp * LAMP_TINT[2],
  ];
}

/** Luminance of a linear RGB triple. */
export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * What the scene's lights give the bed, as rendered radiance per unit of
 * albedo: their irradiance on an upward face over pi, Lambert's diffuse, which
 * is how three shades the cloth. Each light counts at its colour's luminance.
 * The bake multiplies by this, so "a quarter of the bed's light" is a quarter
 * of what reaches the eye from the cloth, and stays so if those lights change.
 */
export function bedGain(lights: readonly (DirectionalLight | AmbientLight)[]): number {
  let irradiance = 0;
  for (const light of lights) {
    const strength = light.intensity * luminance([light.color.r, light.color.g, light.color.b]);
    if (light instanceof DirectionalLight) {
      const towards = light.position.clone().sub(light.target.position).normalize();
      irradiance += strength * Math.max(0, towards.y);
    } else {
      irradiance += strength;
    }
  }
  return irradiance / Math.PI;
}

export class Room {
  readonly group = new Group();
  /** The walls' tone at the top, where they fade into it: the renderer's clear colour. */
  readonly backdrop: Color;
  /** How long building and baking the room took, in milliseconds. */
  readonly bakeMilliseconds: number;

  /** `gain` is `bedGain` of the scene's lights. */
  constructor(gain: number) {
    const started = performance.now();
    this.group.name = 'room';

    const floorMap = floorTexture();
    this.#add('floor', bake(floorGeometry(), gain), floorMap ? 0xffffff : FLOOR_COLOR, floorMap);

    const wallMap = wallTexture(BAY, WALL_HEIGHT);
    this.#add('walls', bake(wallGeometry(), gain), wallMap ? 0xffffff : WALL_COLOR, wallMap);

    this.#add('fixtures', mergeGeometries(cabinet(gain)), 0xffffff);

    const top = lightAt({ x: 0, y: FLOOR_Y + WALL_HEIGHT, z: -WALL_Z }, { x: 0, y: 0, z: 1 });
    this.backdrop = new Color(WALL_COLOR).multiply(new Color(top[0] * gain, top[1] * gain, top[2] * gain));
    this.bakeMilliseconds = performance.now() - started;
  }

  #add(name: string, geometry: BufferGeometry, color: number | string, map?: Texture): void {
    const mesh = new Mesh(geometry, new MeshBasicMaterial({ color, vertexColors: true, map: map ?? null }));
    mesh.name = name;
    // After the table, so the floor under it fails the depth test early.
    mesh.renderOrder = 1;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.group.add(mesh);
  }
}

function venueLight(point: Point3, normal: Point3): number {
  const height = point.y - FLOOR_Y;
  let light = ROOM_LIGHT * (1 - (1 - FADE_TO) * smoothstep(FADE_FROM, WALL_HEIGHT, height));
  if (point.y < 0) {
    light *= 1 - (1 - UNDER_TABLE) * smoothstep(-UNDER_TABLE_EDGE, UNDER_TABLE_EDGE, intoTable(point));
  }
  // A point darkens toward the floor and every wall it is not on.
  for (const plane of ROOM_PLANES) {
    if (dot(normal, plane.facing) > 0.99) continue;
    const gap = plane.offset + dot(point, plane.facing);
    light *= 1 - CORNER_SHADE * (1 - smoothstep(0, CORNER_REACH, gap));
  }
  return light;
}

/** The floor and the four walls, each as the way it faces and its distance from the middle of the table. */
const ROOM_PLANES: readonly { readonly facing: Point3; readonly offset: number }[] = [
  { facing: UP, offset: BED_HEIGHT },
  { facing: { x: -1, y: 0, z: 0 }, offset: WALL_X },
  { facing: { x: 1, y: 0, z: 0 }, offset: WALL_X },
  { facing: { x: 0, y: 0, z: -1 }, offset: WALL_Z },
  { facing: { x: 0, y: 0, z: 1 }, offset: WALL_Z },
];

/** How far a point is inside the table's outline, seen from above: negative outside it. */
function intoTable(point: Point3): number {
  const dx = Math.abs(point.x) - RAIL_X;
  const dz = Math.abs(point.z) - RAIL_Z;
  if (dx <= 0 && dz <= 0) return -Math.max(dx, dz);
  return -Math.hypot(Math.max(dx, 0), Math.max(dz, 0));
}

/** The middles of a grid of cells over the diffuser. */
const LAMP_POINTS: readonly Point3[] = Array.from({ length: LAMP_SAMPLES_ALONG * LAMP_SAMPLES_ACROSS }, (_, i) => ({
  x: LAMP_LENGTH * (((i % LAMP_SAMPLES_ALONG) + 0.5) / LAMP_SAMPLES_ALONG - 0.5),
  y: LAMP_HEIGHT + LAMP_RECESS,
  z: LAMP_WIDTH * ((Math.floor(i / LAMP_SAMPLES_ALONG) + 0.5) / LAMP_SAMPLES_ACROSS - 0.5),
}));

/** The lamp's light at a point, in its own units: cos at the diffuser times cos at the surface over distance squared. */
function lampFlux(point: Point3, normal: Point3): number {
  let sum = 0;
  for (const source of LAMP_POINTS) {
    const dx = point.x - source.x;
    const dy = point.y - source.y;
    const dz = point.z - source.z;
    const squared = dx * dx + dy * dy + dz * dz;
    const distance = Math.sqrt(squared);
    const emitted = -dy / distance;
    const received = -(normal.x * dx + normal.y * dy + normal.z * dz) / distance;
    if (emitted <= SHADE_TO || received <= 0 || tableBlocks(source, point)) continue;
    const shade = smoothstep(SHADE_TO, SHADE_FROM, emitted);
    sum += (emitted * received * shade) / squared;
  }
  return sum;
}

/** The lamp's light at the middle of the bed, which every other point is a fraction of. */
const LAMP_AT_BED = lampFlux({ x: 0, y: 0, z: 0 }, UP);

/** Whether the line from the lamp to a point below the bed crosses the table's outline. */
function tableBlocks(source: Point3, point: Point3): boolean {
  if (point.y >= 0) return false;
  const t = source.y / (source.y - point.y);
  return (
    Math.abs(source.x + t * (point.x - source.x)) < RAIL_X && Math.abs(source.z + t * (point.z - source.z)) < RAIL_Z
  );
}

/** Bakes `lightAt` into a `color` attribute, times the bed's gain and, for a surface with no texture, its own colour. */
function bake(geometry: BufferGeometry, gain: number, albedo?: Color): BufferGeometry {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const colors = new Float32Array(position.count * 3);
  const [r, g, b] = albedo ? [albedo.r, albedo.g, albedo.b] : [1, 1, 1];
  for (let i = 0; i < position.count; i++) {
    const light = lightAt(
      { x: position.getX(i), y: position.getY(i), z: position.getZ(i) },
      { x: normal.getX(i), y: normal.getY(i), z: normal.getZ(i) },
    );
    colors[3 * i] = light[0] * gain * r;
    colors[3 * i + 1] = light[1] * gain * g;
    colors[3 * i + 2] = light[2] * gain * b;
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geometry;
}

function floorGeometry(): BufferGeometry {
  // Laid from the near left corner along +x and -z, so it faces up; the boards
  // run along the table's length.
  return sheet(
    new Vector3(-WALL_X, FLOOR_Y, WALL_Z),
    new Vector3(1, 0, 0),
    new Vector3(0, 0, -1),
    stops(2 * WALL_X, FLOOR_STEP),
    stops(2 * WALL_Z, FLOOR_STEP),
    (u, v) => [u / FLOOR_TILE, v / FLOOR_TILE],
  );
}

/** The four walls in one geometry, each facing into the room. */
function wallGeometry(): BufferGeometry {
  const up = new Vector3(0, 1, 0);
  const wall = (corner: Vector3, along: Vector3, length: number): BufferGeometry => {
    const bay = length / Math.max(1, Math.round(length / BAY));
    return sheet(corner, along, up, stops(length, WALL_STEP), WALL_ROWS, (u, v) => [u / bay, v / WALL_HEIGHT]);
  };
  return mergeGeometries([
    wall(new Vector3(-WALL_X, FLOOR_Y, -WALL_Z), new Vector3(1, 0, 0), 2 * WALL_X),
    wall(new Vector3(WALL_X, FLOOR_Y, WALL_Z), new Vector3(-1, 0, 0), 2 * WALL_X),
    wall(new Vector3(-WALL_X, FLOOR_Y, WALL_Z), new Vector3(0, 0, -1), 2 * WALL_Z),
    wall(new Vector3(WALL_X, FLOOR_Y, -WALL_Z), new Vector3(0, 0, 1), 2 * WALL_Z),
  ]);
}

/** The table's cabinet, in the frame's wood: an apron under the frame, and four legs on feet down to the floor. */
function cabinet(gain: number): BufferGeometry[] {
  const wood = new Color(FRAME_COLOR);
  const feet = wood.clone().multiplyScalar(0.7);
  const apronBottom = APRON_TOP - APRON_DEPTH;
  const parts = [
    block(2 * (RAIL_X - APRON_INSET), APRON_DEPTH, 2 * (RAIL_Z - APRON_INSET), 0, APRON_TOP - APRON_DEPTH / 2, 0, wood, gain),
  ];
  const legX = RAIL_X - APRON_INSET - LEG_INSET - LEG_WIDTH / 2;
  const legZ = RAIL_Z - APRON_INSET - LEG_INSET - LEG_WIDTH / 2;
  const legBottom = FLOOR_Y + FOOT_HEIGHT;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push(
        block(LEG_WIDTH, apronBottom - legBottom, LEG_WIDTH, sx * legX, (apronBottom + legBottom) / 2, sz * legZ, wood, gain),
        block(FOOT_WIDTH, FOOT_HEIGHT, FOOT_WIDTH, sx * legX, FLOOR_Y + FOOT_HEIGHT / 2, sz * legZ, feet, gain),
      );
    }
  }
  return parts;
}

/** A baked box, centred at (x, y, z). */
function block(width: number, height: number, depth: number, x: number, y: number, z: number, albedo: Color, gain: number): BufferGeometry {
  const geometry = new BoxGeometry(width, height, depth).translate(x, y, z);
  geometry.deleteAttribute('uv');
  return bake(geometry, gain, albedo);
}

/**
 * A flat grid from `corner`, `us` metres along `across` and `vs` along `up`,
 * facing across x up. `uv` maps metres along each to texture coordinates.
 */
function sheet(
  corner: Vector3,
  across: Vector3,
  up: Vector3,
  us: readonly number[],
  vs: readonly number[],
  uv: (u: number, v: number) => readonly [number, number],
): BufferGeometry {
  const normal = new Vector3().crossVectors(across, up).normalize();
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const point = new Vector3();
  for (const v of vs) {
    for (const u of us) {
      point.copy(corner).addScaledVector(across, u).addScaledVector(up, v);
      positions.push(point.x, point.y, point.z);
      normals.push(normal.x, normal.y, normal.z);
      uvs.push(...uv(u, v));
    }
  }
  const indices: number[] = [];
  const row = us.length;
  for (let j = 0; j < vs.length - 1; j++) {
    for (let i = 0; i < row - 1; i++) {
      const a = j * row + i;
      indices.push(a, a + 1, a + row + 1, a, a + row + 1, a + row);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

/** 0 to `length` in equal steps of at most `step`. */
function stops(length: number, step: number): number[] {
  const count = Math.ceil(length / step - 1e-9);
  return Array.from({ length: count + 1 }, (_, i) => (length * i) / count);
}

function smoothstep(from: number, to: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

function dot(a: Point3, b: Point3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function tint(r: number, g: number, b: number): Rgb {
  const scale = 1 / luminance([r, g, b]);
  return [r * scale, g * scale, b * scale];
}
