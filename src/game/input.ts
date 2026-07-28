/**
 * Input, scoped to the focused game surface.
 *
 * Tab is deliberately left to the browser — stealing it would break keyboard
 * navigation for the sake of a camera toggle. V does that job instead. Space is
 * only swallowed while the canvas holds focus, key repeat never re-triggers a
 * charge, and losing focus mid-charge cancels the stroke rather than firing it.
 */

import type { Vec2 } from '../geometry/vec2';

export interface InputHandlers {
  onAimAt(point: Vec2): void;
  onNudgeAim(deltaRadians: number): void;
  onChargeStart(): void;
  onChargeCancel(): void;
  onRelease(): void;
  onToggleView(): void;
  onRetry(): void;
  onNext(): void;
  onSelectLevel(id: number): void;
}

export interface PointerProjector {
  pointerToTable(clientX: number, clientY: number): Vec2 | undefined;
}

const FINE_NUDGE = (0.25 * Math.PI) / 180;
const COARSE_NUDGE = (1 * Math.PI) / 180;

/** Digit rows 1-7 select a level. Physical codes, so the layout does not matter. */
const LEVEL_KEYS = new Map<string, number>(
  [1, 2, 3, 4, 5, 6, 7].flatMap((n) => [
    [`Digit${n}`, n] as [string, number],
    [`Numpad${n}`, n] as [string, number],
  ]),
);

function levelFromDigit(code: string): number | undefined {
  return LEVEL_KEYS.get(code);
}

export function attachInput(
  canvas: HTMLCanvasElement,
  projector: PointerProjector,
  handlers: InputHandlers,
): () => void {
  let charging = false;

  const focus = (): void => canvas.focus();

  const onPointerMove = (event: PointerEvent): void => {
    const point = projector.pointerToTable(event.clientX, event.clientY);
    if (point) handlers.onAimAt(point);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    switch (event.code) {
      case 'Space':
        event.preventDefault();
        if (event.repeat || charging) return;
        charging = true;
        handlers.onChargeStart();
        return;
      case 'ArrowLeft':
        event.preventDefault();
        handlers.onNudgeAim(event.shiftKey ? COARSE_NUDGE : FINE_NUDGE);
        return;
      case 'ArrowRight':
        event.preventDefault();
        handlers.onNudgeAim(-(event.shiftKey ? COARSE_NUDGE : FINE_NUDGE));
        return;
      case 'KeyV':
        handlers.onToggleView();
        return;
      case 'KeyR':
        handlers.onRetry();
        return;
      case 'KeyN':
        handlers.onNext();
        return;
      case 'Escape':
        if (charging) {
          charging = false;
          handlers.onChargeCancel();
        }
        return;
      default: {
        const level = levelFromDigit(event.code);
        if (level !== undefined) handlers.onSelectLevel(level);
      }
    }
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    if (event.code !== 'Space') return;
    event.preventDefault();
    if (!charging) return;
    charging = false;
    handlers.onRelease();
  };

  const abandonCharge = (): void => {
    if (!charging) return;
    charging = false;
    handlers.onChargeCancel();
  };

  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerdown', focus);
  canvas.addEventListener('pointercancel', abandonCharge);
  canvas.addEventListener('keydown', onKeyDown);
  canvas.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('blur', abandonCharge);

  return () => {
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerdown', focus);
    canvas.removeEventListener('pointercancel', abandonCharge);
    canvas.removeEventListener('keydown', onKeyDown);
    canvas.removeEventListener('keyup', onKeyUp);
    canvas.removeEventListener('blur', abandonCharge);
  };
}
