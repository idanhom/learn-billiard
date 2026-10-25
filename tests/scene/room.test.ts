import { AmbientLight, Box3, DirectionalLight, type Mesh, MeshBasicMaterial } from 'three';
import { describe, expect, test } from 'vitest';
import { BALL_RADIUS, TABLE } from '../../src/geometry/table';
import { CUE_REACH, behindBack } from '../../src/scene/pool-scene';
import {
  APRON_TOP,
  BED_HEIGHT,
  ROOM_LIGHT,
  Room,
  WALL_HEIGHT,
  WALL_X,
  WALL_Z,
  bedGain,
  lightAt,
  luminance,
} from '../../src/scene/room';
import { FRAME_MARGIN, buildTable } from '../../src/scene/table-mesh';

const INCH = 0.0254;
const FLOOR = -BED_HEIGHT;
const UP = { x: 0, y: 1, z: 0 };
const RAIL_X = TABLE.playLength / 2 + FRAME_MARGIN;
const RAIL_Z = TABLE.playWidth / 2 + FRAME_MARGIN;

const room = new Room(1);
const meshes = room.group.children as Mesh[];
const part = (name: string): Mesh => meshes.find((mesh) => mesh.name === name)!;
/** Geometry is single precision, so these agree with the constants to a micron. */
const bounds = (name: string): Box3 => new Box3().setFromObject(part(name));
const floorLight = (x: number, z: number): number => luminance(lightAt({ x, y: FLOOR, z }, UP));

describe('the table and the walls are at the WPA’s dimensions', () => {
  test('the floor is 29 1/4" to 31" below the bed', () => {
    expect(BED_HEIGHT).toBeGreaterThanOrEqual(29.25 * INCH);
    expect(BED_HEIGHT).toBeLessThanOrEqual(31 * INCH);
    const floor = bounds('floor');
    expect(floor.min.y).toBeCloseTo(-BED_HEIGHT, 6);
    expect(floor.max.y).toBeCloseTo(-BED_HEIGHT, 6);
  });

  test('the walls stand 6 feet out from the outside edge of the rail', () => {
    const walls = bounds('walls');
    expect(walls.max.x - RAIL_X).toBeCloseTo(1.83, 6);
    expect(-walls.min.x - RAIL_X).toBeCloseTo(1.83, 6);
    expect(walls.max.z - RAIL_Z).toBeCloseTo(1.83, 6);
    expect(-walls.min.z - RAIL_Z).toBeCloseTo(1.83, 6);
    expect(walls.max.y - walls.min.y).toBeCloseTo(WALL_HEIGHT, 6);
  });

  test('the table’s frame sits on its cabinet', () => {
    expect(new Box3().setFromObject(buildTable()).min.y).toBeCloseTo(APRON_TOP, 6);
    expect(bounds('fixtures').min.y).toBeCloseTo(FLOOR, 6);
  });
});

/**
 * With the cue ball anywhere on the table, aimed any way: the furthest either
 * reaches from the middle of the table is from a corner of where the cue ball
 * can be, so those four corners at every heading cover it.
 */
describe('nothing reaches a wall', () => {
  const diagonal = Math.hypot(TABLE.playLength, TABLE.playWidth);
  const corners = [-1, 1].flatMap((sx) =>
    [-1, 1].map((sz) => ({ x: sx * (TABLE.playLength / 2 - BALL_RADIUS), z: sz * (TABLE.playWidth / 2 - BALL_RADIUS) })),
  );
  const furthest = (back: number): { x: number; z: number } => {
    let x = 0;
    let z = 0;
    for (const corner of corners) {
      for (let degrees = 0; degrees < 360; degrees++) {
        const heading = (degrees * Math.PI) / 180;
        x = Math.max(x, Math.abs(corner.x - Math.cos(heading) * back));
        z = Math.max(z, Math.abs(corner.z - Math.sin(heading) * back));
      }
    }
    return { x, z };
  };

  test('the butt of the cue, drawn all the way back, stays 5 cm inside the walls', () => {
    const butt = furthest(CUE_REACH);
    expect(butt.x).toBeLessThan(WALL_X - 0.05);
    expect(butt.z).toBeLessThan(WALL_Z - 0.05);
  });

  /** No shot reaches further than a diagonal to the ghost ball and another to the pocket. */
  test('nor does the behind view at its furthest framing', () => {
    const camera = furthest(behindBack(2 * diagonal));
    expect(camera.x).toBeLessThan(WALL_X - 0.05);
    expect(camera.z).toBeLessThan(WALL_Z - 0.05);
  });
});

describe('the floor is lit the way a lamp over a table lights it', () => {
  const under = floorLight(0, 0);
  const skirt = floorLight(0, RAIL_Z + 0.3);
  const halo = Math.max(...Array.from({ length: 40 }, (_, i) => floorLight(0, RAIL_Z + 0.4 + i * 0.03)));

  test('darker under the table than in its shadow, and darker there than in the halo past it', () => {
    expect(under).toBeLessThan(0.6 * skirt);
    expect(skirt).toBeLessThan(0.75 * halo);
  });

  /** A fifth of a metre out, where the dark at the foot of the wall has gone. */
  test('by the walls, about the venue’s own light, and dimmer than the halo', () => {
    const byWalls = [
      ...[-2, -1, 0, 1, 2].flatMap((x) => [floorLight(x, WALL_Z - 0.2), floorLight(x, -WALL_Z + 0.2)]),
      ...[-1.5, 0, 1.5].flatMap((z) => [floorLight(WALL_X - 0.2, z), floorLight(-WALL_X + 0.2, z)]),
    ];
    for (const light of byWalls) {
      expect(light).toBeGreaterThan(0.85 * ROOM_LIGHT);
      expect(light).toBeLessThan(1.3 * ROOM_LIGHT);
      expect(light).toBeLessThan(0.8 * halo);
    }
  });

  /** Floor and walls carry no colour of their own in the bake, only light; this room was baked at a gain of 1. */
  test('nothing in the room is lit brighter than the bed', () => {
    for (const name of ['floor', 'walls']) {
      const colors = part(name).geometry.getAttribute('color');
      let brightest = 0;
      for (let i = 0; i < colors.count; i++) {
        brightest = Math.max(brightest, luminance([colors.getX(i), colors.getY(i), colors.getZ(i)]));
      }
      expect(brightest, name).toBeGreaterThan(0);
      expect(brightest, name).toBeLessThan(1);
    }
  });
});

describe('the bake is measured against the bed', () => {
  test('a white light straight overhead gives the bed its intensity over pi, and one at 60 degrees half that', () => {
    const overhead = new DirectionalLight(0xffffff, Math.PI);
    overhead.position.set(0, 3, 0);
    expect(bedGain([overhead])).toBeCloseTo(1, 9);
    const slanted = new DirectionalLight(0xffffff, Math.PI);
    slanted.position.set(Math.sqrt(3), 1, 0);
    expect(bedGain([slanted])).toBeCloseTo(0.5, 9);
    expect(bedGain([overhead, new AmbientLight(0xffffff, Math.PI)])).toBeCloseTo(2, 9);
  });

  test('the walls fade at the top into the clear colour', () => {
    const top = lightAt({ x: 0, y: FLOOR + WALL_HEIGHT, z: -WALL_Z }, { x: 0, y: 0, z: 1 });
    expect(luminance(top)).toBeCloseTo(0.35 * ROOM_LIGHT, 9);
  });
});

describe('the budget holds', () => {
  test('three meshes and fewer than 30,000 triangles', () => {
    expect(meshes).toHaveLength(3);
    const triangles = meshes.reduce((sum, mesh) => sum + mesh.geometry.getIndex()!.count / 3, 0);
    expect(triangles).toBeLessThanOrEqual(30_000);
  });

  test('unlit, and out of the shadow pass', () => {
    for (const mesh of meshes) {
      expect(mesh.material).toBeInstanceOf(MeshBasicMaterial);
      expect(mesh.castShadow).toBe(false);
      expect(mesh.receiveShadow).toBe(false);
    }
  });
});
