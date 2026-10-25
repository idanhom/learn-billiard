/**
 * The spot a position shot asks the cue ball to stop on: a ring on the cloth,
 * shown from the deal to the report so the result can be read against it.
 */

import { CircleGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry } from 'three';
import type { Vec2 } from '../geometry/vec2';
import { writeWorld } from './coords';

const ZONE_COLOR = 0x6fd3a0;
/** Just over the cloth, under the trails. */
const HEIGHT = 0.001;

export class ZoneMarker {
  readonly group = new Group();
  readonly #ring = new Mesh(
    new RingGeometry(0.92, 1, 64),
    new MeshBasicMaterial({ color: ZONE_COLOR, transparent: true, opacity: 0.85, side: DoubleSide }),
  );
  readonly #fill = new Mesh(
    new CircleGeometry(1, 64),
    new MeshBasicMaterial({ color: ZONE_COLOR, transparent: true, opacity: 0.12, side: DoubleSide }),
  );

  constructor() {
    this.group.name = 'zone';
    for (const mesh of [this.#ring, this.#fill]) {
      // Built in the XY plane: laid flat onto the cloth.
      mesh.rotation.x = -Math.PI / 2;
      this.group.add(mesh);
    }
    this.group.visible = false;
  }

  show(centre: Vec2, radius: number): void {
    writeWorld(this.group.position, centre, HEIGHT);
    this.group.scale.set(radius, 1, radius);
    this.group.visible = true;
  }

  hide(): void {
    this.group.visible = false;
  }
}
