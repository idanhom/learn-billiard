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
  /** Get down on the line, or stand back up: the commit routine's G. */
  onGetDown(): void;
  /** Escape when not charging: dismiss what is asking, such as the self-estimate. */
  onDismiss(): void;
  /** T: the panel of things to take to a real table. */
  onOpenTable(): void;
  /** M: sound on or off. */
  onToggleSound(): void;
  /** P: the shot just played, again, slowed down: from overhead, or from wherever the player has moved the camera. */
  onReplay(): void;
  /** H: after a shot, put the panels away to see the table, or bring them back. */
  onToggleHide(): void;
  /** Enter: on to the next shot, once this one is done. Space does the same then, through `onChargeStart`. */
  onAdvance(): void;
  /** Up and down arrows: move the tip up the ball for follow, or down it for draw, a step at a time. */
  onTip(steps: number): void;
  /** After a shot, whether a drag on the table looks round it rather than aiming. */
  canExplore(): boolean;
  /** A drag of this many pixels: turn the view round the table with it. */
  onTurn(dx: number, dy: number): void;
  /** Fingers spread to this many times as far apart, or the wheel turned: bring the view that much closer. */
  onZoom(factor: number): void;
  /** Two fingers, or a right-drag, moved this many pixels: slide the view along the table with them. */
  onSlide(dx: number, dy: number): void;
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

/**
 * After a shot, how far a finger travels on the table, in CSS pixels, before
 * it is looking round rather than tapping. Short, since a tap there does
 * nothing else; the travel up to it is dropped, so the view does not lurch.
 */
export const EXPLORE_ARM_PX = 6;

/** Wheel zoom per pixel scrolled: a 100 px notch is about a fifth nearer or further. */
const WHEEL_ZOOM_PER_PIXEL = 0.002;
/** A wheel that counts in lines or pages, in pixels: what a browser scrolls for one. */
const WHEEL_LINE_PX = 16;
const WHEEL_PAGE_PX = 400;

interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * One step of a two-finger gesture, as one finger moves from `a0` to `a1` and
 * the other is at `b0`, then `b1`: how many times further apart they are, and
 * how far their midpoint went. Browsers report one finger at a time, and the
 * steps compose: the zooms multiply and the slides add up to what moving both
 * at once would give.
 */
export function pinchStep(a0: Point, b0: Point, a1: Point, b1: Point): { zoom: number; dx: number; dy: number } {
  const before = Math.hypot(a0.x - b0.x, a0.y - b0.y);
  const after = Math.hypot(a1.x - b1.x, a1.y - b1.y);
  return {
    zoom: before < 1 || after < 1 ? 1 : after / before,
    dx: (a1.x + b1.x - a0.x - b0.x) / 2,
    dy: (a1.y + b1.y - a0.y - b0.y) / 2,
  };
}

/** Digit rows 1-9 select a level, and 0 the tenth. Physical codes, so the layout does not matter. */
const LEVEL_KEYS = new Map<string, number>(
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 0].flatMap((n) => [
    [`Digit${n}`, n === 0 ? 10 : n] as [string, number],
    [`Numpad${n}`, n === 0 ? 10 : n] as [string, number],
  ]),
);

function levelFromDigit(code: string): number | undefined {
  return LEVEL_KEYS.get(code);
}

export function attachInput(canvas: HTMLCanvasElement, handlers: InputHandlers): () => void {
  let charging = false;
  let draggingPointer: number | undefined;
  let lastClientX = 0;

  // Looking round the table after a shot: each finger on it and where it last
  // was, where the first one came down, whether it has gone far enough to be a
  // drag, and whether it slides the view rather than turning it. That is
  // settled when it comes down, since a move does not say which button is held.
  const exploring = new Map<number, { x: number; y: number }>();
  let exploreFrom: Point = { x: 0, y: 0 };
  let exploreArmed = false;
  let exploreSlides = false;
  // The click that ends a drag is not a click on the table.
  let swallowClick = false;

  const startExplore = (event: PointerEvent): void => {
    if ((event.button !== 0 && event.button !== 2) || exploring.size >= 2) return;
    if (exploring.size === 0) {
      exploreFrom = { x: event.clientX, y: event.clientY };
      exploreArmed = false;
      exploreSlides = event.button === 2 || event.shiftKey;
    } else {
      // A second finger is a gesture straight away.
      exploreArmed = true;
      swallowClick = true;
    }
    exploring.set(event.pointerId, { x: event.clientX, y: event.clientY });
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const moveExplore = (event: PointerEvent, last: { x: number; y: number }): void => {
    const now = { x: event.clientX, y: event.clientY };
    if (!handlers.canExplore()) {
      last.x = now.x;
      last.y = now.y;
      return;
    }
    if (exploring.size === 1) {
      if (!exploreArmed) {
        if (Math.hypot(now.x - exploreFrom.x, now.y - exploreFrom.y) < EXPLORE_ARM_PX) return;
        exploreArmed = true;
        swallowClick = true;
      } else if (exploreSlides) {
        handlers.onSlide(now.x - last.x, now.y - last.y);
      } else {
        handlers.onTurn(now.x - last.x, now.y - last.y);
      }
    } else {
      const other = [...exploring].find(([id]) => id !== event.pointerId)?.[1];
      if (other) {
        const step = pinchStep(last, other, now, other);
        if (step.zoom !== 1) handlers.onZoom(step.zoom);
        if (step.dx !== 0 || step.dy !== 0) handlers.onSlide(step.dx, step.dy);
      }
    }
    last.x = now.x;
    last.y = now.y;
  };

  const endExplore = (event: PointerEvent): boolean => {
    if (!exploring.delete(event.pointerId)) return false;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    return true;
  };

  const onPointerDown = (event: PointerEvent): void => {
    canvas.focus();
    swallowClick = false;
    if (draggingPointer === undefined && (exploring.size > 0 || handlers.canExplore())) {
      startExplore(event);
      return;
    }
    if (event.button !== 0 || draggingPointer !== undefined) return;
    draggingPointer = event.pointerId;
    lastClientX = event.clientX;
    // Capture, so a drag that runs off the canvas keeps steering the cue
    // instead of stopping dead at the edge.
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onPointerMove = (event: PointerEvent): void => {
    const last = exploring.get(event.pointerId);
    if (last) {
      moveExplore(event, last);
      return;
    }
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
    if (endExplore(event) || event.pointerId !== draggingPointer) return;
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
      case 'ArrowUp':
        event.preventDefault();
        handlers.onTip(1);
        return;
      case 'ArrowDown':
        event.preventDefault();
        handlers.onTip(-1);
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
      case 'KeyG':
        if (event.repeat) return;
        handlers.onGetDown();
        return;
      case 'KeyT':
        if (event.repeat) return;
        handlers.onOpenTable();
        return;
      case 'KeyM':
        if (event.repeat) return;
        handlers.onToggleSound();
        return;
      case 'KeyP':
        if (event.repeat) return;
        handlers.onReplay();
        return;
      case 'KeyH':
        if (event.repeat) return;
        handlers.onToggleHide();
        return;
      case 'Enter':
      case 'NumpadEnter':
        if (event.repeat) return;
        handlers.onAdvance();
        return;
      case 'Escape':
        if (charging) {
          charging = false;
          handlers.onChargeCancel();
        } else {
          handlers.onDismiss();
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
    exploring.clear();
    abandonCharge();
  };

  const onWheel = (event: WheelEvent): void => {
    if (!handlers.canExplore()) return;
    event.preventDefault();
    const scale = event.deltaMode === 1 ? WHEEL_LINE_PX : event.deltaMode === 2 ? WHEEL_PAGE_PX : 1;
    handlers.onZoom(Math.exp(-event.deltaY * scale * WHEEL_ZOOM_PER_PIXEL));
  };

  // The right button slides the view after a shot, so its menu stays shut then.
  const onContextMenu = (event: MouseEvent): void => {
    if (handlers.canExplore()) event.preventDefault();
  };

  const onClick = (event: MouseEvent): void => {
    if (!swallowClick) return;
    swallowClick = false;
    event.stopImmediatePropagation();
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
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);
  // Capture, so it runs before the click handlers the game puts on the canvas.
  canvas.addEventListener('click', onClick, true);

  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', endDrag);
    canvas.removeEventListener('pointercancel', onPointerCancel);
    canvas.removeEventListener('keydown', onKeyDown);
    canvas.removeEventListener('keyup', onKeyUp);
    canvas.removeEventListener('blur', onBlur);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('contextmenu', onContextMenu);
    canvas.removeEventListener('click', onClick, true);
  };
}

export interface TouchPowerHandlers {
  onChargeStart(): void;
  onSetPower(power: number): void;
  onRelease(): void;
  onChargeCancel(): void;
}

/**
 * The power a finger at `clientY` stands for on a strip running from `top` to
 * `bottom` on screen: none at its bottom, full at its top, and clamped beyond
 * either end.
 */
export function stripPower(clientY: number, top: number, bottom: number): number {
  const height = bottom - top;
  if (height <= 0) return 0;
  return Math.min(1, Math.max(0, (bottom - clientY) / height));
}

/**
 * Power by touch: a strip down the right edge of the screen, with no power at
 * its bottom and full power at its top, like any meter that fills. Press it
 * low, slide up to the stroke you want, lift to strike. The power follows the
 * finger, so lifting at the target mark plays the marked stroke.
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
    return stripPower(clientY, r.top, r.bottom);
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
