/**
 * At the table: what carries the trainer over to a real one.
 *
 * A panel of its own over the game rather than part of the HUD, because it
 * has fields to type in, and the HUD hands the keyboard straight back to the
 * table on every click. Escape or Close shuts it and the keyboard goes back.
 */

import type { ClothPreset } from '../constants';
import { TABLE_FEET, TIMING_RANGE, type TableFeet, timeCloth } from '../game/cloth-timing';
import { type DrillSheet, type FractionMiss, type SheetShot, dealSheet, pocketName } from '../game/drill-sheet';
import { toDiamonds } from '../geometry/diamonds';
import type { PocketId } from '../geometry/table';
import type { Vec2 } from '../geometry/vec2';

export type TableTab = 'sheet' | 'cloth' | 'limits';

export interface TablePanelActions {
  /** The panel has closed: give the keyboard back to the table. */
  onClose(): void;
  /** The cloth being played on, and the size of the player's own table. */
  settings(): { readonly cloth: ClothPreset; readonly tableFeet: TableFeet };
  onSetCloth(cloth: ClothPreset): void;
  onSetTableFeet(feet: TableFeet): void;
  /** How often each fraction's shots miss here, for a drill sheet to lean on. */
  fractionMisses(): readonly FractionMiss[];
}

const TABS: readonly { readonly id: TableTab; readonly label: string }[] = [
  { id: 'sheet', label: 'Drill sheet' },
  { id: 'cloth', label: 'Time your cloth' },
  { id: 'limits', label: 'What this can&rsquo;t teach' },
];

const CLOTH_NAMES: Record<ClothPreset, string> = { fast: 'fast', normal: 'normal', slow: 'slow' };

export class TablePanel {
  readonly #element: HTMLElement;
  readonly #actions: TablePanelActions;
  #tab: TableTab = 'sheet';
  #sheet: DrillSheet | undefined;
  /** The day the sheet was dealt, for the top of the print. */
  #dealtOn = '';
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
      if (target.closest('[data-deal]')) {
        this.#sheet = dealSheet(this.#actions.fractionMisses(), Math.floor(Math.random() * 9000) + 1000);
        this.#dealtOn = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
        this.#render('[data-deal]');
        return;
      }
      if (target.closest('[data-print]')) {
        window.print();
        return;
      }
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
    // For the print stylesheet: with the panel open, a print is the panel.
    this.#element.parentElement?.classList.add('table-open');
    (this.#element.querySelector('[data-close]') as HTMLElement | null)?.focus();
  }

  close(): void {
    if (this.#element.hidden) return;
    this.#stopTicking();
    this.#element.hidden = true;
    this.#element.parentElement?.classList.remove('table-open');
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
      case 'sheet':
        return this.#sheetBody();
      case 'cloth':
        return this.#clothBody();
      case 'limits':
        return LIMITS;
    }
  }

  #sheetBody(): string {
    const misses = [...this.#actions.fractionMisses()].sort((a, b) => b.missRate - a.missRate);
    const played = misses.filter((miss) => miss.attempts > 0);
    const leaning =
      played.length === 0
        ? 'Nothing is played on the fraction levels yet, so a sheet deals them evenly.'
        : 'Leaning on what you miss here: ' +
          misses
            .map((miss) => {
              const name = miss.level.name.toLowerCase();
              return miss.attempts === 0 ? `${name} (not played)` : `${name} (${miss.missed} of ${miss.attempts} missed)`;
            })
            .join(', ') +
          '.';
    const sheet = this.#sheet;
    return (
      '<div class="no-print">' +
      '<p>Ten shots for a real table, dealt from the fractions you miss most here. Set each one up by ' +
      'the diamonds, counted from the bottom-left corner pocket: along the long rail, then across. ' +
      'They are laid out for a 7-foot table, and the cut each should come to is there to check ' +
      'against.</p>' +
      `<p class="table-dim">${leaning}</p>` +
      '<div class="table-row"><button type="button" class="hud-chip" data-deal>Deal a sheet</button>' +
      (sheet ? '<button type="button" class="hud-chip" data-print>Print</button>' : '') +
      '</div></div>' +
      (sheet ? renderSheet(sheet, this.#dealtOn) : '')
    );
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

/** The sheet, as it prints: a heading, then one row a shot with a picture of it. */
function renderSheet(sheet: DrillSheet, dealtOn: string): string {
  const rows = sheet.shots
    .map((shot, i) => {
      const side = shot.cutSide === 'straight' ? 'straight in' : `cut ${shot.cutSide}`;
      return (
        `<tr><td>${i + 1}</td><td>${diagram(shot)}</td>` +
        `<td>${shot.fraction.label} ball<br>` +
        `<span class="table-dim">${shot.cutDegrees.toFixed(1)}&deg; ${side}</span></td>` +
        `<td>${pocketName(shot.layout.targetPocket)}</td>` +
        `<td>${shot.cue}</td><td>${shot.object}</td></tr>`
      );
    })
    .join('');
  return (
    `<h3>Drill sheet ${sheet.id}, ${dealtOn}</h3>` +
    '<p class="table-dim">Diamonds from the bottom-left corner pocket: along, then across. ' +
    'Laid out for a 7-foot table.</p>' +
    '<div class="table-sheet-wrap"><table class="table-sheet"><thead><tr>' +
    '<th>#</th><th></th><th>Hit</th><th>Pocket</th><th>Cue ball</th><th>Object ball</th>' +
    `</tr></thead><tbody>${rows}</tbody></table></div>`
  );
}

/** Pixels to a diamond in the sheet's pictures, and the margin round the cloth. */
const DIAGRAM_SCALE = 20;
const DIAGRAM_PAD = 6;

/** Where each pocket is, in diamonds. */
const POCKET_DIAMONDS: Record<PocketId, readonly [number, number]> = {
  'bottom-left': [0, 0],
  'bottom-middle': [4, 0],
  'bottom-right': [8, 0],
  'top-left': [0, 4],
  'top-middle': [4, 4],
  'top-right': [8, 4],
};

/** The table from above, with the diamond grid, both balls and the line to the pocket. */
function diagram(shot: SheetShot): string {
  // Across counts up from the bottom rail; an SVG's y counts down from the top.
  const x = (along: number): string => (DIAGRAM_PAD + along * DIAGRAM_SCALE).toFixed(1);
  const y = (across: number): string => (DIAGRAM_PAD + (4 - across) * DIAGRAM_SCALE).toFixed(1);
  const line = (kind: string, from: readonly [number, number], to: readonly [number, number]): string =>
    `<path class="sheet-${kind}" d="M${x(from[0])} ${y(from[1])}L${x(to[0])} ${y(to[1])}"/>`;
  const circle = (kind: string, [along, across]: readonly [number, number], r: number): string =>
    `<circle class="sheet-${kind}" cx="${x(along)}" cy="${y(across)}" r="${r}"/>`;
  const at = (p: Vec2): readonly [number, number] => {
    const { along, across } = toDiamonds(p);
    return [along, across];
  };

  const width = 8 * DIAGRAM_SCALE + 2 * DIAGRAM_PAD;
  const height = 4 * DIAGRAM_SCALE + 2 * DIAGRAM_PAD;
  const grid = [1, 2, 3, 4, 5, 6, 7]
    .map((k) => line('grid', [k, 0], [k, 4]))
    .concat([1, 2, 3].map((k) => line('grid', [0, k], [8, k])))
    .join('');
  const pockets = (Object.entries(POCKET_DIAMONDS) as [PocketId, readonly [number, number]][])
    .map(([id, place]) => circle(id === shot.layout.targetPocket ? 'target' : 'pocket', place, 4))
    .join('');
  return (
    `<svg class="sheet-diagram" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">` +
    `<rect class="sheet-cloth" x="${DIAGRAM_PAD}" y="${DIAGRAM_PAD}" width="${8 * DIAGRAM_SCALE}" height="${4 * DIAGRAM_SCALE}"/>` +
    grid +
    pockets +
    line('path', at(shot.layout.object), POCKET_DIAMONDS[shot.layout.targetPocket]) +
    circle('object', at(shot.layout.object), 3.4) +
    circle('cue', at(shot.layout.cue), 3.4) +
    '</svg>'
  );
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
