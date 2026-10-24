/**
 * At the table: what carries the trainer over to a real one.
 *
 * A panel of its own over the game rather than part of the HUD, because it
 * has fields to type in, and the HUD hands the keyboard straight back to the
 * table on every click. Escape or Close shuts it and the keyboard goes back.
 */

import type { ClothPreset } from '../constants';
import { TABLE_FEET, TIMING_RANGE, type TableFeet, timeCloth } from '../game/cloth-timing';

export type TableTab = 'cloth' | 'limits';

export interface TablePanelActions {
  /** The panel has closed: give the keyboard back to the table. */
  onClose(): void;
  /** The cloth being played on, and the size of the player's own table. */
  settings(): { readonly cloth: ClothPreset; readonly tableFeet: TableFeet };
  onSetCloth(cloth: ClothPreset): void;
  onSetTableFeet(feet: TableFeet): void;
}

const TABS: readonly { readonly id: TableTab; readonly label: string }[] = [
  { id: 'cloth', label: 'Time your cloth' },
  { id: 'limits', label: 'What this can&rsquo;t teach' },
];

const CLOTH_NAMES: Record<ClothPreset, string> = { fast: 'fast', normal: 'normal', slow: 'slow' };

export class TablePanel {
  readonly #element: HTMLElement;
  readonly #actions: TablePanelActions;
  #tab: TableTab = 'cloth';
  /** The time taken to roll a table length, once one is in. */
  #seconds: number | null = null;
  /** When the stopwatch started, while it runs; and what ticks its display. */
  #started: number | null = null;
  #ticker: ReturnType<typeof setInterval> | undefined;

  constructor(parent: HTMLElement, actions: TablePanelActions) {
    this.#actions = actions;
    this.#element = document.createElement('div');
    this.#element.id = 'table-panel';
    this.#element.className = 'panel';
    this.#element.setAttribute('role', 'dialog');
    this.#element.setAttribute('aria-label', 'At the table');
    // Focusable itself, so Escape still reaches it when the button pressed
    // has been redrawn away.
    this.#element.tabIndex = -1;
    this.#element.hidden = true;
    parent.appendChild(this.#element);

    this.#element.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (target.closest('[data-close]')) return this.close();
      const tab = target.closest('[data-tab]');
      if (tab instanceof HTMLElement) {
        this.#stopTicking();
        this.#tab = tab.dataset.tab as TableTab;
        this.#render(`[data-tab="${this.#tab}"]`);
        return;
      }
      const feet = target.closest('[data-feet]');
      if (feet instanceof HTMLElement) {
        this.#actions.onSetTableFeet(Number(feet.dataset.feet) as TableFeet);
        this.#render(`[data-feet="${feet.dataset.feet}"]`);
        return;
      }
      if (target.closest('[data-stopwatch]')) return this.#stopwatch();
      const use = target.closest('[data-use-cloth]');
      if (use instanceof HTMLElement) {
        this.#actions.onSetCloth(use.dataset.useCloth as ClothPreset);
        this.#renderTiming();
        this.#keepFocus();
      }
    });
    this.#element.addEventListener('input', (event) => {
      const field = event.target as HTMLInputElement;
      if (field.id !== 'cloth-seconds') return;
      const value = Number.parseFloat(field.value);
      this.#seconds = Number.isFinite(value) ? value : null;
      this.#renderTiming();
    });
    this.#element.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.close();
    });
  }

  get isOpen(): boolean {
    return !this.#element.hidden;
  }

  open(tab?: TableTab): void {
    if (tab) this.#tab = tab;
    this.#render();
    this.#element.hidden = false;
    (this.#element.querySelector('[data-close]') as HTMLElement | null)?.focus();
  }

  close(): void {
    if (this.#element.hidden) return;
    this.#stopTicking();
    this.#element.hidden = true;
    this.#actions.onClose();
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** Draw it all again, and put the focus back on `focus`, or at least inside. */
  #render(focus?: string): void {
    const tabs = TABS.map(
      ({ id, label }) =>
        `<button type="button" class="hud-chip" data-tab="${id}" aria-pressed="${id === this.#tab}">${label}</button>`,
    ).join('');
    this.#element.innerHTML =
      '<div class="table-head"><div class="hud-label">At the table</div>' +
      '<button type="button" class="hud-chip" data-close>Close <kbd class="kbd-hint">Esc</kbd></button></div>' +
      `<div class="table-tabs">${tabs}</div>` +
      `<div class="table-body">${this.#body()}</div>`;
    if (focus) (this.#element.querySelector(focus) as HTMLElement | null)?.focus();
    this.#keepFocus();
  }

  #keepFocus(): void {
    if (!this.#element.hidden && !this.#element.contains(document.activeElement)) this.#element.focus();
  }

  #body(): string {
    switch (this.#tab) {
      case 'cloth':
        return this.#clothBody();
      case 'limits':
        return LIMITS;
    }
  }

  #clothBody(): string {
    const { tableFeet } = this.#actions.settings();
    const sizes = TABLE_FEET.map(
      (feet) =>
        `<button type="button" class="hud-chip" data-feet="${feet}" aria-pressed="${feet === tableFeet}">${feet} ft</button>`,
    ).join('');
    const typed = this.#seconds === null ? '' : String(this.#seconds);
    return (
      '<p>Each cloth here is set by how long a ball takes to roll a table length and die at the far ' +
      'cushion. Time the same on your table: roll a ball from one short cushion so it just dies at the ' +
      'other, from the moment it leaves the cue to the moment it stops. Take the middle of three tries ' +
      'that died within a hand&rsquo;s width of the cushion.</p>' +
      `<div class="table-row"><span class="hud-label">Your table</span>${sizes}</div>` +
      '<div class="table-row">' +
      `<button type="button" class="hud-chip" data-stopwatch>${this.#started === null ? 'Start' : 'Stop'}</button>` +
      `<span class="table-clock">${this.#started === null ? '' : this.#elapsed().toFixed(1) + ' s'}</span>` +
      '<label>or type it <input id="cloth-seconds" type="number" inputmode="decimal" step="0.1" ' +
      `min="${TIMING_RANGE[0]}" max="${TIMING_RANGE[1]}" value="${typed}"> s</label></div>` +
      `<div class="table-timing" aria-live="polite">${this.#timingText()}</div>`
    );
  }

  /** Just the verdict, so the field being typed in keeps its focus. */
  #renderTiming(): void {
    const timing = this.#element.querySelector('.table-timing');
    if (timing) timing.innerHTML = this.#timingText();
  }

  #timingText(): string {
    const seconds = this.#seconds;
    if (seconds === null) return '';
    if (seconds < TIMING_RANGE[0] || seconds > TIMING_RANGE[1]) {
      return `<p>That is not a ball rolling one table length: somewhere from ${TIMING_RANGE[0]} to ${TIMING_RANGE[1]} s.</p>`;
    }
    const { cloth, tableFeet } = this.#actions.settings();
    const { predicted, published, nearest, beyond } = timeCloth(seconds, tableFeet);
    const at = (s: number): string => `${s.toFixed(1)} s`;
    const verdict =
      beyond === 'faster'
        ? `That rolls on longer than even fast cloth here, so your cloth is faster than any of these, and ` +
          `fast is the nearest. If it is near ${at(published)}, the published value suits your table ` +
          'better than this trainer&rsquo;s cloth does, which is worth knowing: the README says why.'
        : beyond === 'slower'
          ? 'That dies sooner than even slow cloth here, so your cloth is slower than any of these, and slow ' +
            'is the nearest.'
          : `That is nearest <b>${CLOTH_NAMES[nearest]}</b> cloth.`;
    const action =
      cloth === nearest
        ? `<p>You are playing on ${CLOTH_NAMES[nearest]} cloth.</p>`
        : `<button type="button" class="hud-chip" data-use-cloth="${nearest}">Play on ${CLOTH_NAMES[nearest]} cloth</button>`;
    return (
      `<p>On a ${tableFeet}-foot table the cloths here take <b>${at(predicted.fast)}</b> fast, ` +
      `<b>${at(predicted.normal)}</b> normal and <b>${at(predicted.slow)}</b> slow. The published rolling ` +
      `resistance, 0.01, would take ${at(published)}.</p>` +
      `<p>Yours took ${Number(seconds.toFixed(2))} s. ${verdict}</p>` +
      action
    );
  }

  /** Start the stopwatch, or stop it and take its time. */
  #stopwatch(): void {
    if (this.#started === null) {
      this.#started = performance.now();
      this.#ticker = setInterval(() => {
        const clock = this.#element.querySelector('.table-clock');
        if (clock) clock.textContent = `${this.#elapsed().toFixed(1)} s`;
      }, 100);
    } else {
      this.#seconds = Math.round(this.#elapsed() * 10) / 10;
      this.#stopTicking();
    }
    this.#render('[data-stopwatch]');
  }

  #elapsed(): number {
    return this.#started === null ? 0 : (performance.now() - this.#started) / 1000;
  }

  #stopTicking(): void {
    clearInterval(this.#ticker);
    this.#ticker = undefined;
    this.#started = null;
  }
}

/** Said plainly, so nothing learned here comes as a surprise at a table. */
const LIMITS =
  '<p>This trainer teaches one thing: seeing the line a shot needs, and trusting it. Making the ' +
  'ball at a table takes more, and none of it can be practised on a screen.</p>' +
  '<h3>Stance and sighting</h3>' +
  '<p>Your body, eyes and cue have to line up on the shot you chose. The stance view shows the ' +
  'shot from where your eyes will be, but nothing here makes you stand to it.</p>' +
  '<h3>A bridge</h3>' +
  '<p>A firm bridge that holds the cue on the line, the same way every time. Here the cue rests ' +
  'on nothing and never wavers.</p>' +
  '<h3>A straight stroke</h3>' +
  '<p>Here every stroke goes exactly where you aimed, so every miss is the aim. At a table it may ' +
  'be the stroke. Check yours: from the head spot, send the cue ball up the table over the foot ' +
  'spot to the far cushion. Struck straight and in the centre, it comes back over the head spot to ' +
  'your tip.</p>' +
  '<h3>Spin and the cue ball</h3>' +
  '<p>Every shot here is struck in the centre: no follow, draw or side, and none of the squirt, ' +
  'swerve and spin throw that come with them. Where the cue ball goes after contact is the ' +
  'table&rsquo;s doing here, not yours.</p>' +
  '<h3>Speed by feel</h3>' +
  '<p>The meter here turns into a speed in metres a second. At a table speed is a feel in your arm, ' +
  'and only playing there joins the two.</p>' +
  '<h3>The table you play on</h3>' +
  '<p>Clean or dirty balls change the throw, worn or damp cloth changes how far a ball runs, and ' +
  'no two tables roll quite alike.</p>' +
  '<p>What carries over is the angle: the fraction a shot needs, and seeing it from where you ' +
  'stand.</p>';
