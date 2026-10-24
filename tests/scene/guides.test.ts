import type { LineBasicMaterial, Mesh, MeshBasicMaterial } from 'three';
import { describe, expect, test } from 'vitest';
import { GUIDE_PALETTES, Guides } from '../../src/scene/guides';
import { vec } from '../../src/geometry/vec2';

const ALL = { aimLine: true, ghostBall: true, objectPath: true, readout: false, powerHint: false, overlap: false };

function drawn(guides: Guides) {
  guides.update({ visibility: ALL, cue: vec(-0.5, 0), aimEnd: vec(0, 0.02), ghost: vec(0, 0), object: vec(0.06, 0), pocket: vec(0.9, 0.45) });
  const part = (name: string) => guides.group.children.find((child) => child.name === name);
  const aim = guides.group.children[0] as Mesh;
  return { aim, ghost: part('ghost-ball')! as Mesh };
}

describe('high-contrast guides', () => {
  test('are solid, brighter, and drawn twice as thick', () => {
    const guides = new Guides();
    guides.setContrast(true);
    const { aim, ghost } = drawn(guides);
    const aimMaterial = aim.material as MeshBasicMaterial;
    const ghostMaterial = ghost.material as LineBasicMaterial;
    expect(aimMaterial.color.getHex()).toBe(GUIDE_PALETTES.high.aim[0]);
    expect(aimMaterial.opacity).toBe(1);
    expect(aimMaterial.transparent).toBe(false);
    expect(ghostMaterial.color.getHex()).toBe(GUIDE_PALETTES.high.ghost[0]);
    expect(aim.scale.y).toBe(2);
  });

  test('go back to how they were', () => {
    const guides = new Guides();
    guides.setContrast(true);
    guides.setContrast(false);
    const { aim, ghost } = drawn(guides);
    expect((aim.material as MeshBasicMaterial).opacity).toBe(GUIDE_PALETTES.normal.aim[1]);
    expect((ghost.material as LineBasicMaterial).transparent).toBe(true);
    expect(aim.scale.y).toBe(1);
  });
});
