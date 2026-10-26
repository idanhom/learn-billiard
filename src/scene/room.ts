/**
 * The room the table stands in, at the WPA's dimensions: the floor a bed
 * height below the cloth, the walls a playing clearance out from the rails.
 * At true scale, so the stance and behind views show what a player down on a
 * real table sees past it.
 *
 * Unlit, and cheap on purpose: it runs on a Pi and on phones. Every surface is
 * a `MeshBasicMaterial` whose light is baked into its vertex colours once, by
 * `lightAt`. No scene lights, no shadow maps, no image downloads, and four
 * draw calls: floor, walls, the fittings, and the lamp. The light it bakes is
 * the one a lamp over a pool table gives a room: the table's shadow in a dark
 * skirt round it, a soft halo past that, and dim walls that fade out toward
 * the ceiling, so there is no ceiling to draw.
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
  CylinderGeometry,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
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
export const RAIL_X = TABLE.playLength / 2 + FRAME_MARGIN;
export const RAIL_Z = TABLE.playWidth / 2 + FRAME_MARGIN;
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

/** The shade round the diffuser, hunter green, its lip trimmed in brass, hung from two rods. */
const SHADE_DEPTH = 0.15;
const SHADE_WALL = 0.012;
const TRIM_HEIGHT = 0.02;
const ROD_SPACING = 0.9;
const SHADE_COLOR = 0x2f5a3a;
const BRASS_COLOR = 0xa8834a;
const ROD_COLOR = 0x3a2e22;

/** Two sconces on each long wall, this high off the floor and this far either side of its middle. */
const SCONCE_HEIGHT = 1.7;
const SCONCE_ALONG = 1.2;
/** How far a sconce stands out from its wall, glass included. */
export const SCONCE_REACH = 0.235;
/**
 * The wash is figured from a point this far out from the wall, further than
 * the glass sits, for a pool the size a shaded sconce throws. A design choice.
 */
const SCONCE_SPREAD = 0.3;
/** The wash on the wall right behind a sconce, as a fraction of the bed's light. */
const SCONCE_PEAK = 0.5;

/**
 * What the lamp's diffuser and the sconces' glass show: their own light, in
 * linear RGB, unbaked. Held well short of white, so a light at the edge of the
 * view does not pull the eye off the cloth.
 */
const DIFFUSER_GLOW: Rgb = [0.42, 0.36, 0.26];
const GLASS_GLOW: Rgb = [0.5, 0.36, 0.2];

/** A cue rack on each end wall, behind the middle of the end rail where there is no pocket. */
const RACK_CUES = 6;
/** 58", the usual length of a cue. */
const CUE_STICK = 58 * 0.0254;
const CUE_BUTT = 0.74;
const RACK_SPACING = 0.09;
const RACK_WIDTH = 0.62;
/** How far a rack stands out from its wall. */
export const RACK_DEPTH = 0.08;
/** Heights off the floor: where the butts stand, and the bar that holds the cues upright. */
const RACK_FOOT = 0.13;
const RACK_TOP = 1.32;
const BUTT_COLORS = [0x3a2214, 0x24150e, 0x4a2a18, 0x2e1c12, 0x412616, 0x1f130c];
const SHAFT_COLOR = 0xd8b98a;

/** Colours of light, each scaled to unit luminance so a tint never changes how much light there is. */
const VENUE_TINT = tint(1, 0.78, 0.55);
const LAMP_TINT = tint(1, 0.94, 0.84);
const SCONCE_TINT = tint(1, 0.8, 0.55);

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
 * Three sources. The venue's own light, from fittings out of sight overhead,
 * is `ROOM_LIGHT` on open floor; it fades up the walls, falls away under the
 * table and darkens into the foot of each wall and corner. The lamp over the
 * table spills past it: Lambertian from its diffuser, cut off by its shade,
 * and stopped by the table wherever the line to the lamp crosses the table's
 * outline at bed height. And the sconces wash the long walls round them.
 */
export function lightAt(point: Point3, normal: Point3): Rgb {
  const venue = venueLight(point, normal);
  const lamp = lampFlux(point, normal) / LAMP_AT_BED;
  const sconces = sconceLight(point, normal);
  return [
    venue * VENUE_TINT[0] + lamp * LAMP_TINT[0] + sconces * SCONCE_TINT[0],
    venue * VENUE_TINT[1] + lamp * LAMP_TINT[1] + sconces * SCONCE_TINT[1],
    venue * VENUE_TINT[2] + lamp * LAMP_TINT[2] + sconces * SCONCE_TINT[2],
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
  readonly #lamp: Mesh;

  /** `gain` is `bedGain` of the scene's lights. */
  constructor(gain: number) {
    const started = performance.now();
    this.group.name = 'room';

    const floorMap = floorTexture();
    this.#add('floor', bake(floorGeometry(), gain), floorMap ? 0xffffff : FLOOR_COLOR, floorMap);

    const wallMap = wallTexture(BAY, WALL_HEIGHT);
    this.#add('walls', bake(wallGeometry(), gain), wallMap ? 0xffffff : WALL_COLOR, wallMap);

    this.#add('fixtures', mergeGeometries([...cabinet(gain), ...cueRacks(gain), ...sconces(gain)]), 0xffffff);
    this.#lamp = this.#add('lamp', mergeGeometries(lamp(gain)), 0xffffff);

    const top = lightAt({ x: 0, y: FLOOR_Y + WALL_HEIGHT, z: -WALL_Z }, { x: 0, y: 0, z: 1 });
    this.backdrop = new Color(WALL_COLOR).multiply(new Color(top[0] * gain, top[1] * gain, top[2] * gain));
    this.bakeMilliseconds = performance.now() - started;
  }

  /**
   * Shows the lamp only while the eye is below its underside. From any higher
   * it would hang between the eye and the table, and the overhead view, the
   * replay and the post-shot diagram are all well above it. Asking where the
   * eye is rather than which view it is also covers the behind view at its
   * highest framing, without having to prove how high that goes.
   */
  setEyeHeight(eye: number): void {
    this.#lamp.visible = eye < LAMP_HEIGHT;
  }

  get lampShown(): boolean {
    return this.#lamp.visible;
  }

  #add(name: string, geometry: BufferGeometry, color: number | string, map?: Texture): Mesh {
    const mesh = new Mesh(geometry, new MeshBasicMaterial({ color, vertexColors: true, map: map ?? null }));
    mesh.name = name;
    // After the table, so the floor under it fails the depth test early.
    mesh.renderOrder = 1;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.group.add(mesh);
    return mesh;
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

/**
 * Whether the table stops the line from a light over the bed to a point below
 * it: at the bed, the frame's outline, and below that the apron's, down to the
 * apron's foot. A light on a wall reaches under the frame at a slant.
 */
function tableBlocks(source: Point3, point: Point3): boolean {
  if (point.y >= 0) return false;
  const at = (y: number): number => (source.y - y) / (source.y - point.y);
  const bed = at(0);
  if (
    Math.abs(source.x + bed * (point.x - source.x)) < RAIL_X &&
    Math.abs(source.z + bed * (point.z - source.z)) < RAIL_Z
  ) {
    return true;
  }
  if (point.y >= APRON_TOP) return false;
  // A hair inside the apron, so its own faces do not shade themselves.
  const apronX = RAIL_X - APRON_INSET - 0.001;
  const apronZ = RAIL_Z - APRON_INSET - 0.001;
  return crosses(source, point, at(APRON_TOP), Math.min(1, at(APRON_TOP - APRON_DEPTH)), apronX, apronZ);
}

/**
 * Whether the line from `from` to `to`, between fractions `start` and `end`
 * of the way, passes over the rectangle |x| < halfX, |z| < halfZ. Clipped to
 * each pair of sides in turn, written out twice since it runs per vertex per
 * light.
 */
function crosses(from: Point3, to: Point3, start: number, end: number, halfX: number, halfZ: number): boolean {
  let first = start;
  let last = end;
  const dx = to.x - from.x;
  if (Math.abs(dx) < 1e-12) {
    if (Math.abs(from.x) >= halfX) return false;
  } else {
    const a = (-halfX - from.x) / dx;
    const b = (halfX - from.x) / dx;
    first = Math.max(first, Math.min(a, b));
    last = Math.min(last, Math.max(a, b));
  }
  const dz = to.z - from.z;
  if (Math.abs(dz) < 1e-12) {
    if (Math.abs(from.z) >= halfZ) return false;
  } else {
    const a = (-halfZ - from.z) / dz;
    const b = (halfZ - from.z) / dz;
    first = Math.max(first, Math.min(a, b));
    last = Math.min(last, Math.max(a, b));
  }
  return first <= last;
}

/** Where each sconce is fixed to its wall. */
const SCONCES: readonly Point3[] = [-1, 1].flatMap((side) =>
  [-1, 1].map((along) => ({ x: along * SCONCE_ALONG, y: FLOOR_Y + SCONCE_HEIGHT, z: side * WALL_Z })),
);

const SCONCE_SOURCES: readonly Point3[] = SCONCES.map((mount) => ({ ...mount, z: mount.z - Math.sign(mount.z) * SCONCE_SPREAD }));

/** The sconces' wash at a point, as a fraction of the bed's light: cos at the surface over distance squared. */
function sconceLight(point: Point3, normal: Point3): number {
  let sum = 0;
  for (const source of SCONCE_SOURCES) {
    const dx = source.x - point.x;
    const dy = source.y - point.y;
    const dz = source.z - point.z;
    const squared = dx * dx + dy * dy + dz * dz;
    const received = (normal.x * dx + normal.y * dy + normal.z * dz) / Math.sqrt(squared);
    if (received > 0 && !tableBlocks(source, point)) sum += received / squared;
  }
  return SCONCE_PEAK * SCONCE_SPREAD * SCONCE_SPREAD * sum;
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

/**
 * The lamp: a shade open underneath, its lip trimmed in brass, the diffuser
 * set up inside it, and two rods to the ceiling. Its underside is the trim's.
 */
function lamp(gain: number): BufferGeometry[] {
  const green = new Color(SHADE_COLOR);
  const brass = new Color(BRASS_COLOR);
  const length = LAMP_LENGTH + 2 * SHADE_WALL;
  const width = LAMP_WIDTH + 2 * SHADE_WALL;
  const top = LAMP_HEIGHT + SHADE_DEPTH;
  const ceiling = WALL_HEIGHT - BED_HEIGHT;
  const diffuser = new PlaneGeometry(LAMP_LENGTH, LAMP_WIDTH)
    .rotateX(Math.PI / 2)
    .translate(0, LAMP_HEIGHT + LAMP_RECESS, 0);
  // The sides stop short of the trim's underside and the top panel's upper
  // face, so no two faces lie in the same plane to flicker.
  return [
    ...ring(length, width, SHADE_WALL, LAMP_HEIGHT + TRIM_HEIGHT / 2, top - SHADE_WALL, green, gain),
    block(length, SHADE_WALL, width, 0, top - SHADE_WALL / 2, 0, green, gain),
    ...ring(length + 0.008, width + 0.008, SHADE_WALL + 0.005, LAMP_HEIGHT, LAMP_HEIGHT + TRIM_HEIGHT, brass, gain),
    glowing(diffuser, DIFFUSER_GLOW),
    ...[-1, 1].map((side) =>
      cylinder(0.006, 0.006, ceiling - top, side * (ROD_SPACING / 2), (top + ceiling) / 2, 0, new Color(ROD_COLOR), gain, 6),
    ),
  ];
}

/** A rectangular band `thickness` deep, `length` by `width` outside, from `bottom` up to `top`. */
function ring(length: number, width: number, thickness: number, bottom: number, top: number, albedo: Color, gain: number): BufferGeometry[] {
  const height = top - bottom;
  const y = (bottom + top) / 2;
  return [-1, 1].flatMap((side) => [
    block(length, height, thickness, 0, y, side * ((width - thickness) / 2), albedo, gain),
    block(thickness, height, width - 2 * thickness, side * ((length - thickness) / 2), y, 0, albedo, gain),
  ]);
}

/** Six cues standing in a rack centred on each end wall: dark butts, maple shafts. */
function cueRacks(gain: number): BufferGeometry[] {
  const wood = new Color(FRAME_COLOR);
  const maple = new Color(SHAFT_COLOR);
  const parts: BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const wall = side * WALL_X;
    parts.push(
      block(RACK_DEPTH, 0.08, RACK_WIDTH, wall - side * (RACK_DEPTH / 2), FLOOR_Y + RACK_FOOT - 0.04, 0, wood, gain),
      block(0.8 * RACK_DEPTH, 0.05, RACK_WIDTH, wall - side * 0.4 * RACK_DEPTH, FLOOR_Y + RACK_TOP, 0, wood, gain),
    );
    const x = wall - side * 0.045;
    const foot = FLOOR_Y + RACK_FOOT - 0.02;
    for (let i = 0; i < RACK_CUES; i++) {
      const z = (i - (RACK_CUES - 1) / 2) * RACK_SPACING;
      const butt = new Color(BUTT_COLORS[i % BUTT_COLORS.length]);
      parts.push(
        cylinder(0.0115, 0.0145, CUE_BUTT, x, foot + CUE_BUTT / 2, z, butt, gain),
        cylinder(0.0065, 0.0115, CUE_STICK - CUE_BUTT, x, foot + (CUE_STICK + CUE_BUTT) / 2, z, maple, gain),
      );
    }
  }
  return parts;
}

/** Each sconce: a brass plate on the wall, an arm, and a glass shade lit from inside. */
function sconces(gain: number): BufferGeometry[] {
  const brass = new Color(BRASS_COLOR);
  return SCONCES.flatMap((mount) => {
    const inward = -Math.sign(mount.z);
    const glass = new CylinderGeometry(0.075, 0.05, 0.13, 10).translate(mount.x, mount.y, mount.z + inward * 0.16);
    return [
      block(0.07, 0.14, 0.015, mount.x, mount.y - 0.05, mount.z + inward * 0.0075, brass, gain),
      block(0.02, 0.02, 0.15, mount.x, mount.y - 0.075, mount.z + inward * 0.075, brass, gain),
      glowing(glass, GLASS_GLOW),
    ];
  });
}

/** A baked box, centred at (x, y, z). */
function block(width: number, height: number, depth: number, x: number, y: number, z: number, albedo: Color, gain: number): BufferGeometry {
  const geometry = new BoxGeometry(width, height, depth).translate(x, y, z);
  geometry.deleteAttribute('uv');
  return bake(geometry, gain, albedo);
}

/** A baked upright cylinder, centred at (x, y, z). */
function cylinder(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  x: number,
  y: number,
  z: number,
  albedo: Color,
  gain: number,
  segments = 8,
): BufferGeometry {
  const geometry = new CylinderGeometry(radiusTop, radiusBottom, height, segments).translate(x, y, z);
  geometry.deleteAttribute('uv');
  return bake(geometry, gain, albedo);
}

/** A part that shows its own light: one colour throughout, nothing baked. */
function glowing(geometry: BufferGeometry, [r, g, b]: Rgb): BufferGeometry {
  geometry.deleteAttribute('uv');
  const colors = new Float32Array(geometry.getAttribute('position').count * 3);
  for (let i = 0; i < colors.length; i += 3) {
    colors[i] = r;
    colors[i + 1] = g;
    colors[i + 2] = b;
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geometry;
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
