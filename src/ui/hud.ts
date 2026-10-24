/**
 * DOM heads-up display. Kept out of the WebGL canvas so text stays crisp and
 * cheap on the Pi.
 *
 * What the HUD shows is itself part of the teaching ladder: the readouts fade
 * with the guide tier, and during the exam it shows the shot number and nothing
 * that would help aim it.
 */

import type { AimError, CutSide } from '../geometry/shot';
import type { ExamRun } from '../game/campaign';
import type { ShotOutcome, ShotPhase } from '../game/shot-session';
import type { HistoryEntry, Tendency } from '../game/shot-history';
import type { GuideVisibility } from '../game/tiers';

/**
 * A level just cleared or an exam just finished. Held on screen, under the
 * report of the shot that did it, until the player moves on — rather than
 * swept away by the next shot before anyone could read it.
 */
export type Milestone =
  | {
      readonly kind: 'level-complete';
      readonly levelName: string;
      readonly attempts: number;
      readonly qualified: number;
      readonly potted: number;
      readonly nextLevelName: string;
    }
  | {
      readonly kind: 'exam-finished';
      readonly potted: number;
      readonly total: number;
      readonly personalBest: boolean;
      readonly best: number | null;
    };

/** Something worth saying once, at the top of the screen. */
export interface Notice {
  readonly text: string;
  /** Moves on with every notice raised, so the same words twice still show twice. */
  readonly id: number;
  /** Stays until dismissed, for news that must not slip by unseen. */
  readonly sticky: boolean;
}

/** How long a passing notice stays up, and how much of that is its fade. */
const NOTICE_SECONDS = 4;
const NOTICE_FADE_SECONDS = 0.6;

export interface HudLevelEntry {
  readonly id: number;
  readonly name: string;
  readonly completed: boolean;
  readonly current: boolean;
}

export interface HudState {
  readonly phase: ShotPhase;
  readonly power: number;
  /** Launch speed the meter currently stands for, in m/s. */
  readonly cueSpeed: number;
  readonly speedBand: string;
  /** Meter reading that would drop the ball in, or null when none will. */
  readonly recommendedPower: number | null;
  readonly cutAngleDegrees: number;
  readonly cutSide: CutSide;
  readonly fullness: number;
  readonly liveAimError: AimError;
  readonly guides: GuideVisibility;
  readonly tier: number;
  readonly tierComplete: boolean;
  readonly levelName: string;
  readonly levelDescription: string;
  readonly levels: readonly HudLevelEntry[];
  readonly toleranceDegrees: number;
  readonly windowQualified: number;
  readonly windowNeeded: number;
  readonly attempts: number;
  readonly qualified: number;
  readonly potted: number;
  readonly exam: ExamRun | undefined;
  readonly examBest: number | null;
  /** The shot in play is a retry of a layout already played: practice, not counted. */
  readonly practice: boolean;
  readonly milestone: Milestone | undefined;
  readonly notice: Notice | undefined;
  readonly view: string;
  readonly outcome: ShotOutcome | undefined;
  /** Most recent first. */
  readonly history: readonly HistoryEntry[];
  readonly cutTendency: Tendency | null;
  readonly straightTendency: Tendency | null;
  readonly timeScale: number;
  readonly cloth: string;
  readonly clothLabel: string;
}

export interface HudActions {
  onReset(): void;
  onSelectLevel(id: number): void;
  onContinue(): void;
  /** Hand the keyboard back to the table. Called after every click on the HUD. */
  returnFocus(): void;
}

const TIER_NAMES = ['full guides', 'no pocket line', 'no ghost ball', 'no guides'];

export class Hud {
  readonly #status: HTMLElement;
  readonly #shot: HTMLElement;
  readonly #levels: HTMLElement;
  readonly #powerFill: HTMLElement;
  readonly #powerMarker: HTMLElement;
  readonly #powerSpeed: HTMLElement;
  readonly #report: HTMLElement;
  readonly #notice: HTMLElement;
  readonly #history: HTMLElement;
  readonly #milestone: HTMLElement;
  readonly #actions: HudActions;

  // Last markup written to each panel. `update` runs every frame but the
  // readouts change far less often, and an innerHTML write on a
  // backdrop-filtered panel is not free on a Pi.
  #renderedLevels = '';
  #renderedStatus = '';
  #renderedShot = '';
  #renderedReport = '';
  #renderedHistory = '';
  #renderedSpeed = '';
  #renderedMarker = '';
  #renderedMilestone = '';
  #reportShown = false;
  /** Reset progress has been pressed once, and is waiting to be confirmed. */
  #confirmingReset = false;
  #noticeId = -1;
  #noticeShownAt = 0;
  #noticeSticky = false;
  #noticeShown = false;

  constructor(root: HTMLElement, actions: HudActions) {
    root.innerHTML = '';
    this.#actions = actions;

    this.#status = panel(root, 'hud-status', 'top:14px; left:14px;');
    this.#shot = panel(root, 'hud-shot', 'top:14px; right:14px; text-align:right;');
    this.#levels = panel(root, 'hud-levels', 'top:150px; left:14px;');
    this.#levels.classList.add('interactive');
    // Clear of the power meter and the controls panel, both of which sit low.
    this.#report = panel(root, 'hud-report', 'top:86px; left:50%; transform:translateX(-50%);');
    this.#report.style.display = 'none';
    this.#notice = panel(root, 'hud-notice', 'top:14px; left:50%; transform:translateX(-50%);');
    this.#notice.style.display = 'none';
    this.#history = panel(root, 'hud-history', 'top:150px; right:14px; text-align:right;');
    this.#history.style.display = 'none';
    this.#milestone = panel(root, 'hud-milestone', 'top:50%; left:50%; transform:translate(-50%, -50%);');
    this.#milestone.classList.add('interactive');
    this.#milestone.style.display = 'none';

    const power = panel(root, 'hud-power', 'bottom:18px; left:50%; transform:translateX(-50%);');
    power.innerHTML =
      '<div class="hud-label">Power</div>' +
      '<div class="hud-meter"><div class="hud-meter-fill"></div>' +
      '<div class="hud-meter-marker"></div></div>' +
      '<div class="hud-sub hud-speed"></div>';
    this.#powerFill = power.querySelector('.hud-meter-fill') as HTMLElement;
    this.#powerMarker = power.querySelector('.hud-meter-marker') as HTMLElement;
    this.#powerSpeed = power.querySelector('.hud-speed') as HTMLElement;
    this.#powerMarker.style.display = 'none';

    const help = panel(root, 'hud-help', 'bottom:18px; left:14px;');
    help.innerHTML =
      '<div class="hud-label">Controls</div>' +
      '<div class="hud-keys"><b>Drag</b> to aim (hold <b>Shift</b> to fine-tune) &middot; ' +
      '<b>&larr;/&rarr;</b> nudge &middot; hold <b>Space</b> for power<br>' +
      '<b>V</b> camera &middot; <b>.</b> slow motion &middot; <b>C</b> cloth speed<br>' +
      '<b>R</b> retry &middot; <b>N</b> next shot &middot; <b>1</b>&ndash;<b>7</b> level</div>' +
      // Say plainly what this simulation is not, so nothing learned here comes
      // as a surprise on a real table.
      '<div class="hud-keys hud-note" id="hud-model">Idealised physics: centre-ball hits only, ' +
      'no english, no throw between balls, no sidespin off the cushions.</div>';

    this.#levels.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement).closest('[data-level], [data-action]');
      if (!(target instanceof HTMLElement)) return;
      if (target.dataset.level !== undefined) {
        this.#actions.onSelectLevel(Number(target.dataset.level));
        return;
      }
      // Erasing every level's record is not something one click should do.
      // The first press only asks; the answer is what acts.
      const action = target.dataset.action;
      if (action === 'reset') this.#confirmingReset = true;
      if (action === 'reset-cancel') this.#confirmingReset = false;
      if (action === 'reset-confirm') {
        this.#confirmingReset = false;
        this.#actions.onReset();
      }
      this.#renderedLevels = '';
    });
    this.#notice.addEventListener('click', () => this.#hideNotice());
    this.#milestone.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('.hud-continue')) this.#actions.onContinue();
    });
    // Whatever was clicked, the keyboard belongs to the table afterwards. A
    // clicked button otherwise keeps focus, and the next Space presses it
    // again instead of charging the cue — on Reset progress, of all buttons.
    // On the root, so it runs after every panel's own handler.
    root.addEventListener('click', () => this.#actions.returnFocus());
  }

  update(state: HudState): void {
    this.#renderStatus(state);
    this.#renderShot(state);
    this.#renderLevels(state);
    this.#renderHistory(state);
    this.#renderPower(state);
    this.#renderMilestone(state);

    if (state.outcome) {
      const html = renderReport(state.outcome, state.exam, state.practice, state.milestone !== undefined);
      if (html !== this.#renderedReport) {
        this.#renderedReport = html;
        this.#report.innerHTML = html;
      }
      if (!this.#reportShown) {
        this.#reportShown = true;
        this.#report.style.display = '';
      }
    } else if (this.#reportShown) {
      this.#reportShown = false;
      this.#report.style.display = 'none';
    }

    this.#renderNotice(state.notice);
  }

  /**
   * A notice is news, not furniture: it fades on its own after a few seconds
   * unless it is the sort that must not be missed, like a save that could not
   * be loaded. Either kind goes as soon as it is clicked or withdrawn.
   */
  #renderNotice(notice: Notice | undefined): void {
    if (!notice) {
      if (this.#noticeShown) this.#hideNotice();
      return;
    }
    if (notice.id !== this.#noticeId) {
      this.#noticeId = notice.id;
      this.#noticeShownAt = performance.now();
      this.#noticeSticky = notice.sticky;
      this.#noticeShown = true;
      this.#notice.style.display = '';
      this.#notice.style.opacity = '';
      this.#notice.innerHTML = `<div class="hud-sub">${escape(notice.text)} &middot; click to dismiss</div>`;
    }
    if (!this.#noticeShown || this.#noticeSticky) return;

    const left = NOTICE_SECONDS - (performance.now() - this.#noticeShownAt) / 1000;
    if (left <= 0) this.#hideNotice();
    else if (left < NOTICE_FADE_SECONDS) this.#notice.style.opacity = (left / NOTICE_FADE_SECONDS).toFixed(2);
  }

  #hideNotice(): void {
    this.#noticeShown = false;
    this.#notice.style.display = 'none';
  }

  /**
   * The meter, and what it means.
   *
   * The speed line is a speedometer, not an answer: it says what the stroke
   * you are winding up actually is, in the units and the vocabulary a real
   * table uses. The marker beside it *is* the answer, which is why it is a
   * guide and this line is not.
   */
  #renderPower(state: HudState): void {
    this.#powerFill.style.width = `${Math.round(state.power * 100)}%`;

    const speed = `${state.cueSpeed.toFixed(2)} m/s &middot; ${escape(state.speedBand)}`;
    if (speed !== this.#renderedSpeed) {
      this.#renderedSpeed = speed;
      this.#powerSpeed.innerHTML = speed;
    }

    const hint = state.guides.powerHint ? state.recommendedPower : null;
    const marker = hint === null ? '' : `${(hint * 100).toFixed(1)}%`;
    if (marker === this.#renderedMarker) return;
    this.#renderedMarker = marker;
    this.#powerMarker.style.display = marker === '' ? 'none' : '';
    if (marker !== '') this.#powerMarker.style.left = marker;
  }

  #renderMilestone(state: HudState): void {
    const html = state.milestone ? renderMilestone(state.milestone) : '';
    if (html === this.#renderedMilestone) return;
    this.#renderedMilestone = html;
    this.#milestone.innerHTML = html;
    this.#milestone.style.display = html === '' ? 'none' : '';
  }

  #renderStatus(state: HudState): void {
    const heading = state.exam
      ? `Exam &mdash; shot ${Math.min(state.exam.shotsTaken + 1, state.exam.total)} of ${state.exam.total}`
      : state.tierComplete
        ? 'Level complete'
        : `Tier ${state.tier} &mdash; ${TIER_NAMES[state.tier] ?? ''}`;

    const line = state.exam
      ? `${state.exam.potted} potted${state.examBest === null ? '' : ` &middot; best ${state.examBest}/${state.exam.total}`}`
      : `${state.windowQualified}/${state.windowNeeded} toward the next tier &middot; within ${state.toleranceDegrees}&deg;`;

    const speed = state.timeScale === 1 ? '' : ` &middot; ${formatSpeed(state.timeScale)}`;
    const cloth = ` &middot; ${escape(state.clothLabel.toLowerCase())} cloth`;

    const html =
      `<div class="hud-label">${escape(state.levelName)}</div>` +
      `<div class="hud-big">${heading}</div>` +
      `<div class="hud-sub">${line}</div>` +
      (state.practice ? '<div class="hud-sub hud-practice">Retry: practice, not counted</div>' : '') +
      `<div class="hud-sub">${state.qualified}/${state.attempts} on aim &middot; ` +
      `${state.potted} potted &middot; ${escape(state.view)} view${speed}${cloth}</div>`;
    if (html === this.#renderedStatus) return;
    this.#renderedStatus = html;
    this.#status.innerHTML = html;
  }

  #renderShot(state: HudState): void {
    if (!state.guides.readout) {
      this.#writeShot(
        '<div class="hud-label">This shot</div><div class="hud-big">no guides</div>' +
          '<div class="hud-sub">read the angle yourself</div>',
      );
      return;
    }

    const cut = state.cutAngleDegrees.toFixed(1);
    const side = state.cutSide === 'straight' ? 'straight in' : `cut ${state.cutSide}`;
    const live =
      state.liveAimError.kind === 'on-line'
        ? 'on the line'
        : `${state.liveAimError.degrees.toFixed(2)}&deg; ${state.liveAimError.kind}`;

    this.#writeShot(
      '<div class="hud-label">This shot</div>' +
        `<div class="hud-big">${cut}&deg; ${side}</div>` +
        `<div class="hud-sub">${(state.fullness * 100).toFixed(0)}% full ball</div>` +
        (state.guides.liveAimError ? `<div class="hud-sub hud-live">${live}</div>` : ''),
    );
  }

  #writeShot(html: string): void {
    if (html === this.#renderedShot) return;
    this.#renderedShot = html;
    this.#shot.innerHTML = html;
  }

  /**
   * Recent shots and the bias in them. The per-shot list is the record; the
   * tendency line is the part you can act on — one shot being thick is noise,
   * being thick every time is something to correct for.
   */
  #renderHistory(state: HudState): void {
    if (state.history.length === 0) {
      if (this.#renderedHistory !== '') {
        this.#renderedHistory = '';
        this.#history.style.display = 'none';
      }
      return;
    }

    const rows = state.history
      .slice(0, 8)
      .map((entry) => {
        const label = !entry.contacted
          ? 'no contact'
          : entry.aimError.kind === 'on-line'
            ? 'on the line'
            : `${entry.aimError.degrees.toFixed(2)}&deg; ${entry.aimError.kind}`;
        const mark = entry.retry ? 'retry' : entry.pottedTarget ? 'potted' : entry.qualifying ? 'on aim' : '';
        const kind = entry.retry ? ' retry' : entry.qualifying ? ' good' : '';
        return (
          `<div class="hud-shot-row${kind}">` +
          `<span class="hud-shot-mark">${mark}</span>${label}</div>`
        );
      })
      .join('');

    const html =
      '<div class="hud-label">Recent shots</div>' +
      tendencyLine('Cuts', state.cutTendency) +
      tendencyLine('Straight in', state.straightTendency) +
      `<div class="hud-shot-list">${rows}</div>`;

    if (html === this.#renderedHistory) return;
    this.#renderedHistory = html;
    this.#history.innerHTML = html;
    this.#history.style.display = '';
  }

  #renderLevels(state: HudState): void {
    const key =
      state.levels.map((l) => `${l.id}${l.current ? 'c' : ''}${l.completed ? 'x' : ''}`).join() +
      (this.#confirmingReset ? '?' : '');
    if (key === this.#renderedLevels) return;
    this.#renderedLevels = key;

    const rows = state.levels
      .map(
        (level) =>
          `<button type="button" class="hud-level${level.current ? ' current' : ''}" data-level="${level.id}">` +
          `<span class="hud-level-id">${level.id}</span>${escape(level.name)}` +
          `${level.completed ? '<span class="hud-tick">done</span>' : ''}</button>`,
      )
      .join('');

    const reset = this.#confirmingReset
      ? '<div class="hud-sub hud-confirm">Erase every level\'s progress?</div>' +
        '<button type="button" class="hud-reset danger" data-action="reset-confirm">Erase</button> ' +
        '<button type="button" class="hud-reset" data-action="reset-cancel">Keep</button>'
      : '<button type="button" class="hud-reset" data-action="reset">Reset progress</button>';

    this.#levels.innerHTML =
      '<div class="hud-label">Levels</div>' + `<div class="hud-level-list">${rows}</div>` + reset;
  }
}

function tendencyLine(label: string, tendency: Tendency | null): string {
  if (!tendency) return '';
  const body =
    tendency.kind === 'even'
      ? 'no consistent bias'
      : `<b>${tendency.degrees.toFixed(2)}&deg; ${tendency.kind}</b> on average`;
  return `<div class="hud-sub hud-tendency">${label}: ${body} <span class="hud-note">(${tendency.samples})</span></div>`;
}

function renderMilestone(milestone: Milestone): string {
  const body =
    milestone.kind === 'level-complete'
      ? '<div class="hud-label">Level complete</div>' +
        `<div class="hud-big">${escape(milestone.levelName)}</div>` +
        `<div class="hud-sub">${milestone.qualified} of ${milestone.attempts} on aim &middot; ` +
        `${milestone.potted} potted</div>` +
        `<div class="hud-sub">Next: ${escape(milestone.nextLevelName)}</div>`
      : '<div class="hud-label">Exam finished</div>' +
        `<div class="hud-big">${milestone.potted} of ${milestone.total} potted</div>` +
        (milestone.personalBest
          ? '<div class="hud-sub">A personal best.</div>'
          : milestone.best === null
            ? ''
            : `<div class="hud-sub">Your best is ${milestone.best} of ${milestone.total}.</div>`) +
        `<div class="hud-sub">Next: a fresh run of ${milestone.total}</div>`;
  return (
    body +
    '<button type="button" class="hud-continue">Continue</button>' +
    '<div class="hud-sub hud-note">or press N</div>'
  );
}

function renderReport(
  outcome: ShotOutcome,
  exam: ExamRun | undefined,
  practice: boolean,
  held: boolean,
): string {
  const verdict = exam
    ? outcome.pottedTarget
      ? 'Potted'
      : 'Missed'
    : outcome.qualifying
      ? 'On aim'
      : 'Off aim';
  const good = exam ? outcome.pottedTarget : outcome.qualifying;

  const aim = !outcome.contacted
    ? 'missed the object ball'
    : outcome.aimError.kind === 'on-line'
      ? 'dead on the line'
      : `${outcome.aimError.degrees.toFixed(2)}&deg; ${outcome.aimError.kind}`;

  const pot = outcome.pottedTarget
    ? 'potted'
    : outcome.pottedWrong
      ? `went in the ${outcome.objectPocket?.replace(/-/g, ' ')}`
      : outcome.missDistance === null
        ? 'no contact'
        : `missed by ${(outcome.missDistance * 100).toFixed(1)} cm`;

  const notes: string[] = [];
  if (practice) notes.push('retry: practice, not counted');
  if (outcome.scratch) notes.push('scratch');
  if (!outcome.settled) notes.push('shot cut short');

  return (
    `<div class="hud-verdict ${good ? 'good' : 'bad'}">${verdict}</div>` +
    `<div class="hud-sub">Aim: ${aim} &middot; ${((outcome.cutAngle * 180) / Math.PI).toFixed(1)}&deg; cut ` +
    `&middot; tolerance ${outcome.toleranceDegrees}&deg;</div>` +
    `<div class="hud-sub">Result: ${pot}</div>` +
    (notes.length ? `<div class="hud-sub hud-note">${notes.join(' &middot; ')}</div>` : '') +
    // Held under a summary card the layout has gone, and the card says what next.
    (held ? '' : '<div class="hud-sub hud-note">R to retry this layout &middot; N for the next one</div>')
  );
}

function formatSpeed(timeScale: number): string {
  if (timeScale === 0.5) return 'half speed';
  if (timeScale === 0.25) return 'quarter speed';
  return `${timeScale}x speed`;
}

function panel(root: HTMLElement, id: string, style: string): HTMLElement {
  const element = document.createElement('div');
  element.id = id;
  element.className = 'panel';
  element.setAttribute('style', style);
  root.appendChild(element);
  return element;
}

function escape(text: string): string {
  return text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}
