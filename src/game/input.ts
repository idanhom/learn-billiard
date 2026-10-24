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
  onCycleCloth(): void;
  /** Step the fraction called for the shot: none, full, three quarters, and on to an eighth. */
  onCycleCall(): void;
}

/**
 * One press of an arrow key, or of an aim button. A twentieth of a degree,
 * because a pot leaves about a tenth either side on a typical shot and the
 * level asks for most of that; a quarter, which this was, moved the object
 * ball further than the whole pocket allows.
 */
export const FINE_NUDGE = (0.05 * Math.PI) / 180;
const COARSE_NUDGE = (1 * Math.PI) / 180;

/**
 * The touch strip, in CSS pixels: how far a finger must travel along it before
 * lifting counts as a stroke rather than a tap, and how far off its side it can
 * stray before the stroke is called off.
 */
export const STROKE_ARM_PX = 12;
export const SLIDE_OFF_PX = 36;

/** Holding an aim button nudges once, then again every so often after a pause. */
const AIM_REPEAT_DELAY_MS = 350;
const AIM_REPEAT_MS = 70;

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
        if (event.repeat) return;
        handlers.onCycleSpeed();
        return;
      case 'KeyC':
        if (event.repeat) return;
        handlers.onCycleCloth();
        return;
      case 'KeyF':
        if (event.repeat) return;
        handlers.onCycleCall();
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

export interface TouchPowerHandlers {
  onChargeStart(): void;
  onSetPower(power: number): void;
  onRelease(): void;
  onChargeCancel(): void;
}

/**
 * Power by touch: a strip down the right edge of the screen, with no power at
 * its top and full power at its bottom. Press it, drag down to the stroke you
 * want, lift to strike. The power follows the finger, so lifting at the target
 * mark plays the marked stroke.
 *
 * Two ways out without a shot. Slide off the side of the strip and the stroke
 * is called off, exactly like Escape. And a press that never travels
 * `STROKE_ARM_PX` is a tap, not a stroke: a thumb that lands on the strip by
 * accident must not fire whatever power it happened to land on.
 */
export function attachTouchPower(strip: HTMLElement, handlers: TouchPowerHandlers): () => void {
  let pointer: number | undefined;
  let startY = 0;
  let armed = false;
  let calledOff = false;

  const powerAt = (clientY: number): number => {
    const r = strip.getBoundingClientRect();
    if (r.height <= 0) return 0;
    return Math.min(1, Math.max(0, (clientY - r.top) / r.height));
  };

  const onDown = (event: PointerEvent): void => {
    if (pointer !== undefined) return;
    pointer = event.pointerId;
    startY = event.clientY;
    armed = false;
    calledOff = false;
    // Captured, so a finger that slides off the side is still heard, and can
    // be told it has called the stroke off.
    strip.setPointerCapture(event.pointerId);
    event.preventDefault();
    handlers.onChargeStart();
    handlers.onSetPower(powerAt(event.clientY));
  };

  const onMove = (event: PointerEvent): void => {
    if (event.pointerId !== pointer || calledOff) return;
    const r = strip.getBoundingClientRect();
    if (event.clientX < r.left - SLIDE_OFF_PX || event.clientX > r.right + SLIDE_OFF_PX) {
      calledOff = true;
      handlers.onChargeCancel();
      return;
    }
    if (Math.abs(event.clientY - startY) >= STROKE_ARM_PX) armed = true;
    handlers.onSetPower(powerAt(event.clientY));
  };

  const onUp = (event: PointerEvent): void => {
    if (event.pointerId !== pointer) return;
    pointer = undefined;
    if (strip.hasPointerCapture(event.pointerId)) strip.releasePointerCapture(event.pointerId);
    if (calledOff) return;
    if (armed) handlers.onRelease();
    else handlers.onChargeCancel();
  };

  const onCancel = (event: PointerEvent): void => {
    if (event.pointerId !== pointer) return;
    pointer = undefined;
    if (!calledOff) handlers.onChargeCancel();
  };

  strip.addEventListener('pointerdown', onDown);
  strip.addEventListener('pointermove', onMove);
  strip.addEventListener('pointerup', onUp);
  strip.addEventListener('pointercancel', onCancel);
  return () => {
    strip.removeEventListener('pointerdown', onDown);
    strip.removeEventListener('pointermove', onMove);
    strip.removeEventListener('pointerup', onUp);
    strip.removeEventListener('pointercancel', onCancel);
  };
}

/**
 * The arrow keys' fine nudge, as two buttons for a thumb: a press nudges once,
 * and holding on repeats it after a pause. Dragging on the table still does the
 * coarse work; these are for the last fraction of a degree.
 */
export function attachAimButtons(
  left: HTMLElement,
  right: HTMLElement,
  onNudgeAim: (deltaRadians: number) => void,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const start = (delta: number) => (event: PointerEvent) => {
    event.preventDefault();
    stop();
    onNudgeAim(delta);
    const repeat = (): void => {
      onNudgeAim(delta);
      timer = setTimeout(repeat, AIM_REPEAT_MS);
    };
    timer = setTimeout(repeat, AIM_REPEAT_DELAY_MS);
  };

  const listeners: [HTMLElement, string, EventListener][] = [
    [left, 'pointerdown', start(FINE_NUDGE) as EventListener],
    [right, 'pointerdown', start(-FINE_NUDGE) as EventListener],
  ];
  for (const button of [left, right]) {
    for (const type of ['pointerup', 'pointerleave', 'pointercancel']) listeners.push([button, type, stop]);
  }
  for (const [target, type, listener] of listeners) target.addEventListener(type, listener);
  return () => {
    stop();
    for (const [target, type, listener] of listeners) target.removeEventListener(type, listener);
  };
}
