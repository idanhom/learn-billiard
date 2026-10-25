import { describe, expect, test } from 'vitest';
import { layoutViolations } from '../../src/game/generator';
import { LEVELS } from '../../src/game/levels';
import { ZONE_SIZE, isOpen, restAfter, zoneLayout } from '../../src/game/zones';
import { dist } from '../../src/geometry/vec2';

const level = LEVELS.find((l) => l.scoring?.kind === 'zone')!;

describe('a position zone', () => {
  test('comes with an ordinary cut, and a zone in open table almost every time', () => {
    let open = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const layout = zoneLayout(level, seed * 7919);
      expect(layoutViolations(layout, level), `seed ${seed}`).toEqual([]);
      expect(layout.spot).toBeDefined();
      expect(layout.spotRadius).toBe(ZONE_SIZE);
      if (isOpen(layout.spot!)) open++;
    }
    expect(open).toBeGreaterThanOrEqual(18);
  });

  test('is one the cue ball reaches: the stroke it came from pots, and stops there', () => {
    // The same stroke again, found by searching the same spread: some stroke leaves it in the zone.
    const layout = zoneLayout(level, 3 * 7919);
    let reached = false;
    for (let speed = 1.2; speed <= 3.2 && !reached; speed += 0.1) {
      for (let tip = -0.4; tip <= 0.4 && !reached; tip += 0.1) {
        const rest = restAfter(layout, speed, tip, 'normal');
        if (rest && dist(rest, layout.spot!) <= ZONE_SIZE) reached = true;
      }
    }
    expect(reached).toBe(true);
  });
});
