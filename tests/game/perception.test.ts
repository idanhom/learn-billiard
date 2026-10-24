import { describe, expect, test } from 'vitest';
import { layoutWithCut } from '../../src/game/drills';
import { FLASH_SECONDS, PerceptionDrill } from '../../src/game/perception';
import { potWindow } from '../../src/game/pot-window';
import { ShotSession } from '../../src/game/shot-session';
import { add, normalize, scale, sub, vec } from '../../src/geometry/vec2';

/** A half-ball layout, and a drill on it of the given kind, shown at time 0. */
function drillOn(kind: 'flash' | 'place') {
  const layout = layoutWithCut('drill', vec(0.25, 0.05), 'top-right', 30, 0.6);
  const analysis = new ShotSession(layout).analysis;
  const window = potWindow(layout, 'normal', analysis);
  return { layout, analysis, drill: new PerceptionDrill(kind, layout.object, analysis, window, 0.8, 0) };
}

describe('a flash drill', () => {
  test('shows the layout for a moment, then takes the balls away until it is called', () => {
    const { drill } = drillOn('flash');
    expect(drill.hidden(FLASH_SECONDS / 2)).toBe(false);
    expect(drill.hidden(FLASH_SECONDS)).toBe(true);
    drill.call('half', FLASH_SECONDS + 1);
    expect(drill.hidden(FLASH_SECONDS + 2)).toBe(false);
  });

  test('takes no call while the layout is still showing, and only one after', () => {
    const { drill } = drillOn('flash');
    expect(drill.call('half', 0.5)).toBeUndefined();
    expect(drill.call('quarter', FLASH_SECONDS + 0.1)).toEqual({
      kind: 'flash',
      called: 'quarter',
      needed: 'half',
      correct: false,
    });
    expect(drill.call('half', FLASH_SECONDS + 0.2)).toBeUndefined();
    expect(drill.result).toMatchObject({ called: 'quarter' });
  });

  test('is right when the call is the fraction nearest the cut', () => {
    const { drill } = drillOn('flash');
    expect(drill.call('half', FLASH_SECONDS)?.correct).toBe(true);
  });

  test('cannot be placed', () => {
    expect(drillOn('flash').drill.place(vec(0, 0))).toBeUndefined();
  });
});

describe('a place drill', () => {
  test('placed on the ghost ball, uses none of the pocket', () => {
    const { drill, analysis } = drillOn('place');
    const result = drill.place(analysis.ghostCenter)!;
    expect(result).toMatchObject({ kind: 'place', correct: true });
    expect(result.kind === 'place' && result.used).toBeCloseTo(0, 9);
    expect(result.kind === 'place' && result.off).toBeCloseTo(0, 12);
  });

  test('placed a centimetre off round the object ball, misses the pocket', () => {
    const { drill, analysis, layout } = drillOn('place');
    // Swung round the object ball, the way a mis-read cut moves the ghost ball.
    const radial = normalize(sub(analysis.ghostCenter, layout.object));
    const across = vec(-radial.y, radial.x);
    const result = drill.place(add(analysis.ghostCenter, scale(across, 0.01)))!;
    expect(result.kind === 'place' && result.off).toBeCloseTo(0.01, 9);
    expect(result.kind === 'place' && result.used).toBeGreaterThan(1);
    expect(result.correct).toBe(false);
  });

  test('is never hidden, takes one placing, and no call', () => {
    const { drill, analysis } = drillOn('place');
    expect(drill.hidden(10)).toBe(false);
    expect(drill.call('half', 10)).toBeUndefined();
    drill.place(analysis.ghostCenter);
    expect(drill.place(vec(0, 0))).toBeUndefined();
  });
});
