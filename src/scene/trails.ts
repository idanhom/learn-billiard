/**
 * The post-shot diagram: where each ball went, drawn on the cloth, beside the
 * line the object ball needed. Shown once a shot has been played and scored,
 * and best read from overhead.
 */

import { BufferGeometry, Group, Line, LineBasicMaterial, LineDashedMaterial, Vector3 } from 'three';
import type { Vec2 } from '../geometry/vec2';
import { writeWorld } from './coords';

const CUE_COLOR = 0xf5f3ec;
const OBJECT_COLOR = 0xe2a03f;
const OTHER_COLOR = 0x93a4b3;
const NEEDED_COLOR = 0x9fe8c4;
/** Just over the cloth, under the balls. */
const HEIGHT = 0.0015;

export class Trails {
  readonly group = new Group();
  #shown: readonly (readonly Vec2[])[] | undefined;

  constructor() {
    this.group.name = 'trails';
    this.group.visible = false;
  }

  /**
   * Draw `trails` (cue ball first, then the object ball, then any others) and
   * the line from the object ball to where it needed to go. Drawing the same
   * trails again does nothing.
   */
  show(trails: readonly (readonly Vec2[])[], needed: { readonly from: Vec2; readonly to: Vec2 }): void {
    this.group.visible = true;
    if (trails === this.#shown) return;
    this.#shown = trails;
    this.#clear();

    const dashed = line([needed.from, needed.to], new LineDashedMaterial({ color: NEEDED_COLOR, dashSize: 0.02, gapSize: 0.015 }));
    dashed.computeLineDistances();
    this.group.add(dashed);
    trails.forEach((trail, i) => {
      if (trail.length < 2) return;
      const color = i === 0 ? CUE_COLOR : i === 1 ? OBJECT_COLOR : OTHER_COLOR;
      this.group.add(line(trail, new LineBasicMaterial({ color, transparent: true, opacity: 0.85 })));
    });
  }

  hide(): void {
    this.group.visible = false;
  }

  #clear(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      const drawn = child as Line;
      drawn.geometry.dispose();
      (drawn.material as LineBasicMaterial).dispose();
    }
  }
}

function line(points: readonly Vec2[], material: LineBasicMaterial | LineDashedMaterial): Line {
  const geometry = new BufferGeometry().setFromPoints(points.map((p) => writeWorld(new Vector3(), p, HEIGHT)));
  return new Line(geometry, material);
}
