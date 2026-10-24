/**
 * At the table: what carries the trainer over to a real one.
 *
 * A panel of its own over the game rather than part of the HUD, because it
 * has fields to type in, and the HUD hands the keyboard straight back to the
 * table on every click. Escape or Close shuts it and the keyboard goes back.
 */

export type TableTab = 'limits';

export interface TablePanelActions {
  /** The panel has closed: give the keyboard back to the table. */
  onClose(): void;
}

const TABS: readonly { readonly id: TableTab; readonly label: string }[] = [
  { id: 'limits', label: 'What this can&rsquo;t teach' },
];

export class TablePanel {
  readonly #element: HTMLElement;
  readonly #actions: TablePanelActions;
  #tab: TableTab = 'limits';

  constructor(parent: HTMLElement, actions: TablePanelActions) {
    this.#actions = actions;
    this.#element = document.createElement('div');
    this.#element.id = 'table-panel';
    this.#element.className = 'panel';
    this.#element.setAttribute('role', 'dialog');
    this.#element.setAttribute('aria-label', 'At the table');
    this.#element.hidden = true;
    parent.appendChild(this.#element);

    this.#element.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (target.closest('[data-close]')) return this.close();
      const tab = target.closest('[data-tab]');
      if (tab instanceof HTMLElement) {
        this.#tab = tab.dataset.tab as TableTab;
        this.#render();
      }
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
    this.#element.hidden = true;
    this.#actions.onClose();
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  #render(): void {
    const tabs = TABS.map(
      ({ id, label }) =>
        `<button type="button" class="hud-chip" data-tab="${id}" aria-pressed="${id === this.#tab}">${label}</button>`,
    ).join('');
    this.#element.innerHTML =
      '<div class="table-head"><div class="hud-label">At the table</div>' +
      '<button type="button" class="hud-chip" data-close>Close <kbd class="kbd-hint">Esc</kbd></button></div>' +
      `<div class="table-tabs">${tabs}</div>` +
      `<div class="table-body">${this.#body()}</div>`;
  }

  #body(): string {
    switch (this.#tab) {
      case 'limits':
        return LIMITS;
    }
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
