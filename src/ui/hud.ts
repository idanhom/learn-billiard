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

export interface HudLevelEntry {
  readonly id: number;
  readonly name: string;
  readonly completed: boolean;
  readonly current: boolean;
}

export interface HudState {
  readonly phase: ShotPhase;
  readonly power: number;
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
  readonly notice: string | undefined;
  readonly view: string;
  readonly outcome: ShotOutcome | undefined;
  /** Most recent first. */
  readonly history: readonly HistoryEntry[];
  readonly cutTendency: Tendency | null;
  readonly straightTendency: Tendency | null;
  readonly timeScale: number;
}

export interface HudActions {
  onReset(): void;
  onSelectLevel(id: number): void;
}

const TIER_NAMES = ['full guides', 'no pocket line', 'no ghost ball', 'no guides'];

export class Hud {
  readonly #status: HTMLElement;
  readonly #shot: HTMLElement;
  readonly #levels: HTMLElement;
  readonly #powerFill: HTMLElement;
  readonly #report: HTMLElement;
  readonly #notice: HTMLElement;
  readonly #history: HTMLElement;
  readonly #actions: HudActions;

  // Last markup written to each panel. `update` runs every frame but the
  // readouts change far less often, and an innerHTML write on a
  // backdrop-filtered panel is not free on a Pi.
  #renderedLevels = '';
  #renderedStatus = '';
  #renderedShot = '';
  #renderedReport = '';
  #renderedHistory = '';
  #reportShown = false;

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

    const power = panel(root, 'hud-power', 'bottom:18px; left:50%; transform:translateX(-50%);');
    power.innerHTML =
      '<div class="hud-label">Power</div><div class="hud-meter"><div class="hud-meter-fill"></div></div>';
    this.#powerFill = power.querySelector('.hud-meter-fill') as HTMLElement;

    const help = panel(root, 'hud-help', 'bottom:18px; left:14px;');
    help.innerHTML =
      '<div class="hud-label">Controls</div>' +
      '<div class="hud-keys"><b>Drag</b> to aim (hold <b>Shift</b> to fine-tune) &middot; ' +
      '<b>&larr;/&rarr;</b> nudge &middot; hold <b>Space</b> for power<br>' +
      '<b>V</b> camera &middot; <b>.</b> slow motion &middot; <b>R</b> retry &middot; ' +
      '<b>N</b> next shot &middot; <b>1</b>&ndash;<b>7</b> level</div>' +
      // Say plainly what this simulation is not, so nothing learned here comes
      // as a surprise on a real table.
      '<div class="hud-keys hud-note" id="hud-model">Idealised physics: centre-ball hits only, ' +
      'no english, no throw between balls, simplified cushions.</div>';

    this.#levels.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement).closest('[data-level]');
      if (target instanceof HTMLElement) {
        this.#actions.onSelectLevel(Number(target.dataset.level));
      }
    });
    this.#notice.addEventListener('click', () => {
      this.#notice.style.display = 'none';
    });
  }

  update(state: HudState): void {
    this.#renderStatus(state);
    this.#renderShot(state);
    this.#renderLevels(state);
    this.#renderHistory(state);
    this.#powerFill.style.width = `${Math.round(state.power * 100)}%`;

    if (state.outcome) {
      const html = renderReport(state.outcome, state.exam);
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

    if (state.notice && this.#notice.dataset.shown !== state.notice) {
      this.#notice.dataset.shown = state.notice;
      this.#notice.style.display = '';
      this.#notice.innerHTML = `<div class="hud-sub">${escape(state.notice)} &middot; click to dismiss</div>`;
    }
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

    const html =
      `<div class="hud-label">${escape(state.levelName)}</div>` +
      `<div class="hud-big">${heading}</div>` +
      `<div class="hud-sub">${line}</div>` +
      `<div class="hud-sub">${state.qualified}/${state.attempts} on aim &middot; ` +
      `${state.potted} potted &middot; ${escape(state.view)} view${speed}</div>`;
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
        const mark = entry.pottedTarget ? 'potted' : entry.qualifying ? 'on aim' : '';
        return (
          `<div class="hud-shot-row${entry.qualifying ? ' good' : ''}">` +
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
    const key = state.levels.map((l) => `${l.id}${l.current ? 'c' : ''}${l.completed ? 'x' : ''}`).join();
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

    this.#levels.innerHTML =
      '<div class="hud-label">Levels</div>' +
      `<div class="hud-level-list">${rows}</div>` +
      '<button type="button" class="hud-reset">Reset progress</button>';

    const reset = this.#levels.querySelector('.hud-reset');
    reset?.addEventListener('click', (event) => {
      event.stopPropagation();
      this.#actions.onReset();
    });
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

function renderReport(outcome: ShotOutcome, exam: ExamRun | undefined): string {
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
  if (outcome.scratch) notes.push('scratch');
  if (!outcome.settled) notes.push('shot cut short');

  return (
    `<div class="hud-verdict ${good ? 'good' : 'bad'}">${verdict}</div>` +
    `<div class="hud-sub">Aim: ${aim} &middot; ${((outcome.cutAngle * 180) / Math.PI).toFixed(1)}&deg; cut ` +
    `&middot; tolerance ${outcome.toleranceDegrees}&deg;</div>` +
    `<div class="hud-sub">Result: ${pot}</div>` +
    (notes.length ? `<div class="hud-sub hud-note">${notes.join(' &middot; ')}</div>` : '') +
    '<div class="hud-sub hud-note">R to retry this layout &middot; N for the next one</div>'
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
