/**
 * Input, scoped to the focused game surface.
 *
 * Aiming is by drag, not by pointing. Ray-casting the cursor onto the cloth
 * reads well on paper, but in the behind-cue view the camera sits low and close
 * to the table, so a few pixels near the horizon sweep an enormous angle — and
 * since the camera turns to follow the aim, the aim fed back into itself. A
 * drag maps a fixed number of pixels to a fixed number of degrees whatever the
 * camera is doing, which is both calmer and adjustable.
 *
 * Tab is deliberately left to the browser — stealing it would break keyboard
 * navigation for the sake of a camera toggle. V does that job instead. Space is
 * only swallowed while the canvas holds focus, key repeat never re-triggers a
 * charge, and losing focus mid-charge cancels the stroke rather than firing it.
 */

export interface InputHandlers {
  onNudgeAim(deltaRadians: number): void;
  onChargeStart(): void;
  onChargeCancel(): void;
  onRelease(): void;
  onToggleView(): void;
  onRetry(): void;
  onNext(): void;
  onSelectLevel(id: number): void;
  onCycleSpeed(): void;
}

const FINE_NUDGE = (0.25 * Math.PI) / 180;
const COARSE_NUDGE = (1 * Math.PI) / 180;

/**
 * Degrees of aim per pixel dragged. At this rate the full width of a 1280px
 * window is about 100 degrees, and a 20px nudge is roughly a degree and a half
 * — coarse enough to swing across the table, fine enough to be steered.
 */
export const AIM_DEGREES_PER_PIXEL = 0.08;

/** Holding shift while dragging divides the rate, for the last half degree. */
export const FINE_DRAG_DIVISOR = 5;

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

export function attachInput(canvas: HTMLCanvasElement, handlers: InputHandlers): () => void {
  let charging = false;
  let draggingPointer: number | undefined;
  let lastClientX = 0;

  const onPointerDown = (event: PointerEvent): void => {
    canvas.focus();
    if (event.button !== 0 || draggingPointer !== undefined) return;
    draggingPointer = event.pointerId;
    lastClientX = event.clientX;
    // Capture, so a drag that runs off the canvas keeps steering the cue
    // instead of stopping dead at the edge.
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== draggingPointer) return;
    const dx = event.clientX - lastClientX;
    lastClientX = event.clientX;
    if (dx === 0) return;

    const rate = event.shiftKey
      ? AIM_DEGREES_PER_PIXEL / FINE_DRAG_DIVISOR
      : AIM_DEGREES_PER_PIXEL;
    // Dragging right swings the aim clockwise, which is negative in a
    // counter-clockwise-positive convention.
    handlers.onNudgeAim((-dx * rate * Math.PI) / 180);
  };

  const endDrag = (event: PointerEvent): void => {
    if (event.pointerId !== draggingPointer) return;
    draggingPointer = undefined;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
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
      case 'Period':
        handlers.onCycleSpeed();
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

  const onBlur = (): void => {
    draggingPointer = undefined;
    abandonCharge();
  };

  const onPointerCancel = (event: PointerEvent): void => {
    endDrag(event);
    abandonCharge();
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('keydown', onKeyDown);
  canvas.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('blur', onBlur);

  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', endDrag);
    canvas.removeEventListener('pointercancel', onPointerCancel);
    canvas.removeEventListener('keydown', onKeyDown);
    canvas.removeEventListener('keyup', onKeyUp);
    canvas.removeEventListener('blur', onBlur);
  };
}
