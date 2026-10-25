/**
 * DOM heads-up display. Kept out of the WebGL canvas so text stays crisp and
 * cheap on the Pi.
 *
 * What the HUD shows is itself part of the teaching ladder: the readouts fade
 * with the guide tier, and during the exam it shows the shot number and nothing
 * that would help aim it.
 *
 * Every action has a button as well as a key, in the toolbar, so the trainer
 * plays on a phone. Where things sit is `hud.css`'s business, not this file's:
 * a small screen folds the level list and the recent shots into sheets behind
 * toolbar chips, and the stylesheet decides when.
 */

import { FRACTIONS, type FractionName, fractionByName } from '../geometry/fractions';
import type { CutSide } from '../geometry/shot';
import { ESTIMATES, type Estimate, estimateLabel } from '../game/estimate';
import type { DepartureResult, Stroke } from '../game/departure';
import type { PositionAsk, PositionResult } from '../game/position';
import type { SpeedResult, SpeedTarget } from '../game/speed';
import type { DrillKind, DrillResult } from '../game/perception';
import type { BandMastery, ExamRun } from '../game/campaign';
import type { CoachStep } from '../game/coach';
import { MASTERY_MIN, MASTERY_STANDARD } from '../game/mastery';
import type { ShotOutcome, ShotPhase, ShotResult } from '../game/shot-session';
import type { HistoryEntry, TendencyRow } from '../game/shot-history';
import type { GuideVisibility } from '../game/tiers';
import { escape } from './html';
import { isLucky, verdictFor } from './verdict';

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
      /** Null on the level of drills, where nothing is ever played. */
      readonly potted: number | null;
      /** Null when it was the last level, which the player stays on. */
      readonly nextLevelName: string | null;
    }
  | {
      readonly kind: 'exam-finished';
      readonly potted: number;
      readonly total: number;
      readonly personalBest: boolean;
      readonly best: number | null;
      readonly first: boolean;
      readonly firstToday: number;
    }
  | {
      readonly kind: 'assessment-finished';
      readonly points: number;
      readonly of: number;
      readonly parts: readonly { readonly part: string; readonly points: number; readonly of: number }[];
      readonly rating: string;
      readonly personalBest: boolean;
      readonly best: number;
      readonly first: boolean;
      readonly firstToday: number;
    }
  | {
      readonly kind: 'daily-finished';
      readonly median: number;
      readonly first: boolean;
      readonly firstToday: number;
      readonly earlier: readonly { readonly date: string; readonly score: number }[];
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
  /**
   * The overlap the line as it stands makes, as seen down the cue: how much of
   * the object ball it covers, and which side the cue ball sits. Null when the
   * line misses the object ball.
   */
  readonly aimOverlap: { readonly fullness: number; readonly side: 'left' | 'right' } | null;
  /**
   * Where the balls start, in diamonds, to set the layout up on a real table.
   * Null while a perception drill is still to be answered.
   */
  readonly diamonds: { readonly cue: string; readonly object: string; readonly second: 'object' | 'ring' } | null;
  /** The fraction called for this shot, and whether calling one is offered now. */
  readonly call: FractionName | null;
  readonly calling: boolean;
  readonly fullness: number;
  readonly guides: GuideVisibility;
  readonly tier: number;
  readonly tierComplete: boolean;
  readonly levelName: string;
  readonly levelDescription: string;
  readonly levels: readonly HudLevelEntry[];
  /** Where the tip strikes, on the levels where the player moves it. */
  readonly tip: number | null;
  /** On a position level: what the shot asks of the cue ball, and how it went. */
  readonly position: {
    readonly target: PositionAsk;
    readonly distance: number;
    readonly result: PositionResult | null;
  } | null;
  /** On the patterns level: which ball is next, of how many. */
  readonly pattern: { readonly ball: number; readonly of: number } | null;
  /** How the run stood after the last shot: balls down, of how many, and whether it is over. */
  readonly patternNews: { readonly down: number; readonly of: number; readonly over: boolean } | null;
  /** On a speed level: the drill, how far the ring is, and how it went. */
  readonly speed: {
    readonly target: SpeedTarget;
    readonly distance: number;
    readonly result: SpeedResult | null;
  } | null;
  /** On a level about the cue ball: the prediction, and how it went. */
  readonly departure: {
    readonly stroke: Stroke;
    readonly stage: 'asking' | 'playing' | 'answered';
    readonly result: DepartureResult | null;
    readonly allowance: number;
  } | null;
  /** The assessment in play: which station, of how many, and the points so far. */
  readonly assessment: {
    readonly station: number;
    readonly of: number;
    readonly label: string;
    readonly points: number;
    readonly best: number | null;
  } | null;
  /** The daily set's run in play, on its level. */
  readonly daily: { readonly shot: number; readonly total: number; readonly firstToday: number | null } | null;
  /** On how many of the last seven days there was practice. */
  readonly daysPractised: number;
  /** Mastery by ten-degree band of cut. */
  readonly bands: readonly BandMastery[];
  /** Share of the pocket a qualifying shot may use. */
  readonly pocketAllowance: number;
  /** The tier's window of recent shots, oldest first: true for each that qualified. */
  readonly tierWindow: readonly boolean[];
  readonly windowNeeded: number;
  readonly windowSize: number;
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
  /** How far the player sits from the screen, in metres, for the stance view. */
  readonly viewingDistance: number;
  readonly sound: boolean;
  readonly highContrast: boolean;
  /** The shot just played is being shown again. */
  readonly replaying: boolean;
  /** Where the first-launch coaching is, while it runs. */
  readonly coach: CoachStep | null;
  /** Whether the next shot deals itself, and in how many seconds, while it is counting down. */
  readonly autoNext: boolean;
  readonly autoNextIn: number | null;
  /** The commit routine, where it runs: down on the line or still standing. */
  readonly routine: { readonly down: boolean } | null;
  /** How it went for the shot just played: time to shoot, and how often the player stood back up. */
  readonly routineLog: { readonly seconds: number; readonly reAims: number } | null;
  /**
   * The self-estimate, where one is asked: asking while the report waits,
   * then what the player said (null if they skipped) against what it was.
   */
  readonly estimate: {
    readonly asking: boolean;
    readonly said: Estimate | null;
    readonly actual: Estimate;
    readonly straight: boolean;
  } | null;
  /** The perception drill in play, if any: its kind, how far along, and how it went. */
  readonly drill: {
    readonly kind: DrillKind;
    readonly stage: 'showing' | 'asking' | 'answered';
    readonly result: DrillResult | null;
    /** The cut the layout needs, to show once answered. */
    readonly cutDegrees: number;
  } | null;
  readonly outcome: ShotOutcome | undefined;
  /** Most recent first. */
  readonly history: readonly HistoryEntry[];
  /** The bias report, line by line. */
  readonly tendencies: readonly TendencyRow[];
  readonly timeScale: number;
  readonly cloth: string;
  readonly clothLabel: string;
}

export interface HudActions {
  onReset(): void;
  onSelectLevel(id: number): void;
  onContinue(): void;
  onRetry(): void;
  onNext(): void;
  onToggleView(): void;
  onCycleSpeed(): void;
  onCycleCloth(): void;
  /** Call a fraction for the shot, or take the call back. */
  onCall(fraction: FractionName | null): void;
  /** Move the viewing distance the stance view is drawn at, a step nearer or further. */
  onViewingDistance(steps: number): void;
  onToggleSound(): void;
  onReplay(): void;
  onToggleAutoNext(): void;
  onSkipCoaching(): void;
  onToggleContrast(): void;
  onTip(steps: number): void;
  /** Get down on the line, or stand back up: the commit routine. */
  onGetDown(): void;
  /** The player's read of their own miss, or null to skip it. */
  onEstimate(said: Estimate | null): void;
  /** A flash drill's call. */
  onDrillCall(fraction: FractionName): void;
  /** Hand the keyboard back to the table. Called after every click on the HUD. */
  returnFocus(): void;
  /** The panel of things to take to a real table. */
  onOpenTable(): void;
}

/** A panel a small screen folds away behind a toolbar chip. */
type Sheet = 'levels' | 'history';

const TIER_NAMES = ['full guides', 'no pocket line', 'no ghost ball', 'no guides'];

const VIEW_LABELS: Readonly<Record<string, string>> = { behind: 'Behind', overhead: 'Overhead', stance: 'Stance' };

export class Hud {
  readonly #status: HTMLElement;
  readonly #eyeDistance: HTMLElement;
  readonly #soundToggle: HTMLElement;
  readonly #coach: HTMLElement;
  #renderedCoach = '';
  readonly #autoNextToggle: HTMLElement;
  readonly #contrastToggle: HTMLElement;
  readonly #shot: HTMLElement;
  readonly #levels: HTMLElement;
  readonly #root: HTMLElement;
  readonly #powerFill: HTMLElement;
  readonly #powerMarker: HTMLElement;
  readonly #powerSpeed: HTMLElement;
  readonly #report: HTMLElement;
  readonly #notice: HTMLElement;
  readonly #history: HTMLElement;
  readonly #milestone: HTMLElement;
  readonly #toolbar: HTMLElement;
  readonly #help: HTMLElement;
  readonly #stripFill: HTMLElement;
  readonly #stripMarker: HTMLElement;
  readonly #stripSpeed: HTMLElement;
  readonly #actions: HudActions;

  /**
   * The touch controls, shown wherever there is a coarse pointer: the power
   * strip down the right edge, and the fine-aim buttons. The HUD draws them;
   * `src/game/input.ts` listens to them.
   */
  readonly touch: { readonly power: HTMLElement; readonly aimLeft: HTMLElement; readonly aimRight: HTMLElement };

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
  #renderedToolbar = '';
  #reportShown = false;
  /** The sheet a small screen has open, if any. Ignored where there is room. */
  #openSheet: Sheet | undefined;
  #helpOpen = false;
  /** Reset progress has been pressed once, and is waiting to be confirmed. */
  #confirmingReset = false;
  #noticeId = -1;
  #noticeShownAt = 0;
  #noticeSticky = false;
  #noticeShown = false;

  constructor(root: HTMLElement, actions: HudActions) {
    root.innerHTML = '';
    this.#root = root;
    this.#actions = actions;

    this.#status = panel(root, 'hud-status');
    this.#shot = panel(root, 'hud-shot');
    this.#shot.classList.add('interactive');
    this.#levels = panel(root, 'hud-levels');
    this.#levels.classList.add('interactive');
    this.#report = panel(root, 'hud-report');
    this.#report.classList.add('interactive');
    this.#report.style.display = 'none';
    // Read out as it changes, without taking the player away from the table.
    this.#report.setAttribute('role', 'status');
    this.#report.setAttribute('aria-live', 'polite');
    this.#notice = panel(root, 'hud-notice');
    this.#notice.style.display = 'none';
    this.#notice.setAttribute('role', 'status');
    this.#history = panel(root, 'hud-history');
    this.#history.classList.add('interactive');
    this.#history.style.display = 'none';
    this.#milestone = panel(root, 'hud-milestone');
    this.#milestone.classList.add('interactive');
    this.#milestone.style.display = 'none';
    this.#toolbar = panel(root, 'hud-toolbar');
    this.#toolbar.classList.add('interactive');
    this.#toolbar.setAttribute('role', 'toolbar');

    const power = panel(root, 'hud-power');
    power.innerHTML =
      '<div class="hud-label">Power</div>' +
      '<div class="hud-meter"><div class="hud-meter-fill"></div>' +
      '<div class="hud-meter-marker"></div></div>' +
      '<div class="hud-sub hud-speed"></div>';
    this.#powerFill = power.querySelector('.hud-meter-fill') as HTMLElement;
    this.#powerMarker = power.querySelector('.hud-meter-marker') as HTMLElement;
    this.#powerSpeed = power.querySelector('.hud-speed') as HTMLElement;
    this.#powerMarker.style.display = 'none';

    // The same meter, upright, for a thumb: drag down it to charge, lift to
    // strike. It replaces the bar above wherever the device has touch.
    const strip = panel(root, 'hud-strip');
    strip.classList.add('interactive');
    strip.innerHTML =
      '<div class="hud-sub hud-strip-speed"></div>' +
      '<div class="hud-strip-track" aria-label="Power: drag down, lift to strike">' +
      '<div class="hud-strip-fill"></div><div class="hud-strip-marker"></div></div>';
    this.#stripFill = strip.querySelector('.hud-strip-fill') as HTMLElement;
    this.#stripMarker = strip.querySelector('.hud-strip-marker') as HTMLElement;
    this.#stripSpeed = strip.querySelector('.hud-strip-speed') as HTMLElement;
    this.#stripMarker.style.display = 'none';

    const aim = panel(root, 'hud-aim');
    aim.classList.add('interactive');
    aim.innerHTML =
      '<button type="button" class="hud-aim-button" aria-label="Aim a twentieth of a degree left">&lsaquo;</button>' +
      '<button type="button" class="hud-aim-button" aria-label="Aim a twentieth of a degree right">&rsaquo;</button>' +
      '<button type="button" class="hud-aim-button hud-tip-button" data-tip="1" aria-label="Tip up: follow">&#9650;</button>' +
      '<button type="button" class="hud-aim-button hud-tip-button" data-tip="-1" aria-label="Tip down: draw">&#9660;</button>';
    aim.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest('[data-tip]');
      if (button instanceof HTMLElement) this.#actions.onTip(Number(button.dataset.tip));
    });
    const [aimLeft, aimRight] = aim.querySelectorAll('button');
    this.touch = {
      power: strip.querySelector('.hud-strip-track') as HTMLElement,
      aimLeft: aimLeft as HTMLElement,
      aimRight: aimRight as HTMLElement,
    };

    this.#coach = panel(root, 'hud-coach');
    this.#coach.classList.add('interactive');
    this.#coach.setAttribute('aria-live', 'polite');
    this.#coach.style.display = 'none';
    this.#coach.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('[data-skip-coaching]')) this.#actions.onSkipCoaching();
    });

    this.#help = panel(root, 'hud-help');
    this.#help.classList.add('interactive');
    this.#help.innerHTML =
      '<div class="hud-label">Controls</div>' +
      '<div class="hud-keys kbd-hint"><b>Drag</b> to aim (hold <b>Shift</b> to fine-tune) &middot; ' +
      '<b>&larr;/&rarr;</b> nudge &middot; hold <b>Space</b> for power<br>' +
      '<b>V</b> camera: behind, overhead, stance &middot; <b>.</b> slow motion &middot; <b>C</b> cloth speed<br>' +
      '<b>R</b> retry &middot; <b>N</b> next shot &middot; <b>1</b>&ndash;<b>9</b>, <b>0</b> level &middot; ' +
      '<b>F</b> call the fraction &middot; <b>G</b> get down on the line &middot; <b>T</b> at the table &middot; ' +
      '<b>M</b> sound</div>' +
      '<div class="hud-keys touch-hint"><b>Drag</b> on the table to aim, and nudge it with ' +
      '<b>&lsaquo; &rsaquo;</b>. <b>Drag down the strip</b> on the right to charge the power, and ' +
      'lift to strike; slide off its side to call the shot off. The buttons along the bottom do ' +
      'everything the keys do.</div>' +
      // Say plainly what this simulation is not, so nothing learned here comes
      // as a surprise on a real table.
      '<div class="hud-keys hud-eye">The stance view is true to scale with your eyes ' +
      '<b class="hud-eye-distance"></b> from the screen ' +
      '<button type="button" class="hud-call" data-eye="-1" aria-label="Nearer">&minus;</button> ' +
      '<button type="button" class="hud-call" data-eye="1" aria-label="Further">+</button></div>' +
      '<div class="hud-keys">Sound <button type="button" class="hud-call" data-sound aria-pressed="true">on</button> ' +
      '&middot; Next shot by itself <button type="button" class="hud-call" data-auto-next aria-pressed="false">off</button> ' +
      '&middot; High-contrast guides <button type="button" class="hud-call" data-contrast aria-pressed="false">off</button></div>' +
      '<div class="hud-keys hud-note" id="hud-model">Idealised physics: centre-ball hits only, ' +
      'no english, no sidespin off the cushions. The ghost ball allows for throw.</div>';
    this.#eyeDistance = this.#help.querySelector('.hud-eye-distance') as HTMLElement;
    this.#soundToggle = this.#help.querySelector('[data-sound]') as HTMLElement;
    this.#autoNextToggle = this.#help.querySelector('[data-auto-next]') as HTMLElement;
    this.#contrastToggle = this.#help.querySelector('[data-contrast]') as HTMLElement;
    this.#help.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest('[data-eye]');
      if (button instanceof HTMLElement) this.#actions.onViewingDistance(Number(button.dataset.eye));
      if ((event.target as HTMLElement).closest('[data-sound]')) this.#actions.onToggleSound();
      if ((event.target as HTMLElement).closest('[data-auto-next]')) this.#actions.onToggleAutoNext();
      if ((event.target as HTMLElement).closest('[data-contrast]')) this.#actions.onToggleContrast();
    });

    this.#levels.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement).closest('[data-level], [data-action]');
      if (!(target instanceof HTMLElement)) return;
      if (target.dataset.level !== undefined) {
        this.#toggleSheet(undefined);
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
    this.#report.addEventListener('click', (event) => {
      const call = (event.target as HTMLElement).closest('[data-drill-call]');
      if (call instanceof HTMLElement) this.#actions.onDrillCall(call.dataset.drillCall as FractionName);
      const button = (event.target as HTMLElement).closest('[data-estimate]');
      if (button instanceof HTMLElement) this.#actions.onEstimate(Number(button.dataset.estimate) as Estimate);
      if ((event.target as HTMLElement).closest('[data-estimate-skip]')) this.#actions.onEstimate(null);
      if ((event.target as HTMLElement).closest('[data-replay]')) this.#actions.onReplay();
    });
    this.#shot.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest('[data-call]');
      if (!(button instanceof HTMLElement)) return;
      const fraction = button.dataset.call as FractionName;
      // A second press on the called fraction takes the call back.
      this.#actions.onCall(button.getAttribute('aria-pressed') === 'true' ? null : fraction);
    });
    this.#milestone.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('.hud-continue')) this.#actions.onContinue();
    });
    this.#toolbar.addEventListener('click', (event) => {
      const chip = (event.target as HTMLElement).closest('[data-action]');
      if (chip instanceof HTMLElement) this.#onChip(chip.dataset.action);
    });
    // Whatever was clicked, the keyboard belongs to the table afterwards. A
    // clicked button otherwise keeps focus, and the next Space presses it
    // again instead of charging the cue — on Reset progress, of all buttons.
    // On the root, so it runs after every panel's own handler.
    root.addEventListener('click', () => this.#actions.returnFocus());
  }

  #onChip(action: string | undefined): void {
    switch (action) {
      case 'retry':
        return this.#actions.onRetry();
      case 'next':
        return this.#actions.onNext();
      case 'view':
        return this.#actions.onToggleView();
      case 'down':
        return this.#actions.onGetDown();
      case 'speed':
        return this.#actions.onCycleSpeed();
      case 'cloth':
        return this.#actions.onCycleCloth();
      case 'table':
        return this.#actions.onOpenTable();
      case 'levels':
      case 'history':
        return this.#toggleSheet(this.#openSheet === action ? undefined : action);
      case 'help':
        this.#helpOpen = !this.#helpOpen;
        this.#help.classList.toggle('open', this.#helpOpen);
        this.#renderedToolbar = '';
    }
  }

  /** Open one sheet, or none. They share the middle of a small screen. */
  #toggleSheet(sheet: Sheet | undefined): void {
    this.#openSheet = sheet;
    this.#levels.classList.toggle('open', sheet === 'levels');
    this.#history.classList.toggle('open', sheet === 'history');
    this.#renderedToolbar = '';
  }

  update(state: HudState): void {
    // A perception drill takes no shot, so the controls for one go with it.
    this.#root.classList.toggle('drilling', state.drill !== null || state.departure !== null);
    this.#root.classList.toggle('tipping', state.tip !== null);
    writeToggle(this.#soundToggle, state.sound);
    writeToggle(this.#autoNextToggle, state.autoNext);
    writeToggle(this.#contrastToggle, state.highContrast);
    const eye = `${Math.round(state.viewingDistance * 100)} cm`;
    if (this.#eyeDistance.textContent !== eye) this.#eyeDistance.textContent = eye;
    this.#renderToolbar(state);
    this.#renderStatus(state);
    this.#renderShot(state);
    this.#renderLevels(state);
    this.#renderHistory(state);
    this.#renderPower(state);
    this.#renderMilestone(state);
    this.#renderCoach(state);

    if (state.speed?.result && !state.replaying) {
      const html = renderSpeed(state.speed.target, state.speed.result, state.autoNextIn);
      if (html !== this.#renderedReport) {
        this.#renderedReport = html;
        this.#report.innerHTML = html;
      }
      if (!this.#reportShown) {
        this.#reportShown = true;
        this.#report.style.display = '';
      }
    } else if (state.departure && !state.replaying) {
      const html = renderDeparture(state.levelName, state.departure, state.autoNextIn);
      if (html !== this.#renderedReport) {
        this.#renderedReport = html;
        this.#report.innerHTML = html;
      }
      if (!this.#reportShown) {
        this.#reportShown = true;
        this.#report.style.display = '';
      }
    } else if (state.drill) {
      const html = renderDrill(state.drill, state.pocketAllowance, state.autoNextIn);
      if (html !== this.#renderedReport) {
        this.#renderedReport = html;
        this.#report.innerHTML = html;
      }
      if (!this.#reportShown) {
        this.#reportShown = true;
        this.#report.style.display = '';
      }
    } else if (state.outcome) {
      const html = state.replaying
        ? '<div class="hud-sub">Replay, from above at a quarter speed &middot; <b>Esc</b> stops it</div>'
        : state.estimate?.asking
          ? estimatePrompt(state.estimate.straight)
          : renderReport(
              state.outcome,
              state.exam !== undefined || state.assessment !== null,
              state.practice,
              state.milestone !== undefined,
              state.routineLog,
              state.estimate,
              state.autoNextIn,
              state.position?.result ? { result: state.position.result, zone: state.position.target === 'zone' } : null,
              state.patternNews,
            );
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
      this.#notice.innerHTML = `<div class="hud-sub">${escape(notice.text)} <span class="hud-note">&times;</span></div>`;
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
    const fill = `${Math.round(state.power * 100)}%`;
    this.#powerFill.style.width = fill;
    this.#stripFill.style.height = fill;

    const speed = `${state.cueSpeed.toFixed(2)} m/s &middot; ${escape(state.speedBand)}`;
    if (speed !== this.#renderedSpeed) {
      this.#renderedSpeed = speed;
      this.#powerSpeed.innerHTML = speed;
      this.#stripSpeed.innerHTML =
        `${state.cueSpeed.toFixed(2)}<br>m/s<br><span class="hud-note">${escape(state.speedBand)}</span>`;
    }

    const hint = state.guides.powerHint ? state.recommendedPower : null;
    const marker = hint === null ? '' : `${(hint * 100).toFixed(1)}%`;
    if (marker === this.#renderedMarker) return;
    this.#renderedMarker = marker;
    for (const [element, side] of [
      [this.#powerMarker, 'left'],
      [this.#stripMarker, 'top'],
    ] as const) {
      element.style.display = marker === '' ? 'none' : '';
      if (marker !== '') element.style[side] = marker;
    }
  }

  /** The coaching's step, in words; out of the way while the controls panel is open. */
  #renderCoach(state: HudState): void {
    const html = state.coach === null || state.coach === 'done' || this.#helpOpen ? '' : coachText(state.coach);
    if (html === this.#renderedCoach) return;
    this.#renderedCoach = html;
    this.#coach.innerHTML = html;
    this.#coach.style.display = html === '' ? 'none' : '';
  }

  #renderMilestone(state: HudState): void {
    const html = state.milestone ? renderMilestone(state.milestone) : '';
    if (html === this.#renderedMilestone) return;
    this.#renderedMilestone = html;
    this.#milestone.innerHTML = html;
    this.#milestone.style.display = html === '' ? 'none' : '';
  }

  /**
   * Everything the keyboard does, as buttons. The chips that change a setting
   * name the setting they are on, so the status line no longer has to.
   */
  #renderToolbar(state: HudState): void {
    const html =
      chip('retry', 'Retry', { key: 'R' }) +
      chip('next', 'Next', { key: 'N' }) +
      chip('view', VIEW_LABELS[state.view] ?? 'Behind', { key: 'V' }) +
      (state.routine ? chip('down', state.routine.down ? 'Stand up' : 'Get down', { key: 'G' }) : '') +
      chip('speed', speedLabel(state.timeScale), { key: '.' }) +
      chip('cloth', `${escape(state.clothLabel)} cloth`, { key: 'C' }) +
      chip('levels', 'Levels', { compactOnly: true, pressed: this.#openSheet === 'levels' }) +
      (state.history.length > 0
        ? chip('history', 'Shots', { compactOnly: true, pressed: this.#openSheet === 'history' })
        : '') +
      chip('table', 'At the table', { key: 'T' }) +
      chip('help', '?', { pressed: this.#helpOpen, label: 'Controls and model notes' });
    if (html === this.#renderedToolbar) return;
    this.#renderedToolbar = html;
    this.#toolbar.innerHTML = html;
    // The controls panel sits on top of the toolbar, which wraps to a second
    // row when its chips outgrow it.
    this.#root.style.setProperty('--toolbar-height', `${this.#toolbar.offsetHeight}px`);
  }

  #renderStatus(state: HudState): void {
    const heading = state.assessment
      ? `Assessment: station ${state.assessment.station} of ${state.assessment.of}`
      : state.daily
      ? `Daily set: shot ${state.daily.shot} of ${state.daily.total}`
      : state.pattern
      ? `Tier ${state.tier}: ball ${state.pattern.ball} of ${state.pattern.of}`
      : state.exam
      ? `Exam &mdash; shot ${Math.min(state.exam.shotsTaken + 1, state.exam.total)} of ${state.exam.total}`
      : state.tierComplete
        ? 'Level complete'
        : (state.position && state.position.target !== 'zone') || state.speed?.target === 'distance'
          ? `Rung ${state.tier + 1} of 4`
          : state.speed || state.position
          ? `Tier ${state.tier}`
          : state.drill || state.departure
          ? `Tier ${state.tier}`
          : `Tier ${state.tier} &mdash; ${TIER_NAMES[state.tier] ?? ''}`;

    // The drills show no guide at any tier, and a flash drill is judged on
    // the fraction rather than the pocket.
    const line = state.assessment
      ? `${escape(state.assessment.label)} &middot; ${state.assessment.points} so far` +
        (state.assessment.best === null ? '' : ` &middot; best ${state.assessment.best}/${state.assessment.of}`)
      : state.daily
      ? state.daily.firstToday === null
        ? 'Your first run today: it counts'
        : `Practice: today&rsquo;s first run stands at ${ofThePocket(state.daily.firstToday)}`
      : state.exam
      ? `${state.exam.potted} potted${state.examBest === null ? '' : ` &middot; best ${state.examBest}/${state.exam.total}`}`
      : `${tierPips(state)} ${state.windowNeeded} of the last ${state.windowSize}${state.pattern || state.patternNews ? ' runs' : ''} to advance` +
        (state.drill || state.departure || state.position || state.speed || state.pattern || state.patternNews
          ? ''
          : ` &middot; within ${percent(state.pocketAllowance)} of the pocket`);
    const tally = state.speed
      ? `${state.qualified}/${state.attempts} in the ring`
      : state.position
      ? `${state.qualified}/${state.attempts} in the ${state.position.target === 'zone' ? 'zone' : 'ring'} &middot; ${state.potted} potted`
      : state.drill || state.departure
      ? `${state.qualified}/${state.attempts} read right`
      : `${state.qualified}/${state.attempts} on aim &middot; ${state.potted} potted`;

    const html =
      `<div class="hud-label">${escape(state.levelName)}</div>` +
      `<div class="hud-big">${heading}</div>` +
      `<div class="hud-sub">${line}</div>` +
      (state.practice ? '<div class="hud-sub hud-practice">Retry: practice, not counted</div>' : '') +
      `<div class="hud-sub hud-extra">${tally}</div>`;
    if (html === this.#renderedStatus) return;
    this.#renderedStatus = html;
    this.#status.innerHTML = html;
  }

  #renderShot(state: HudState): void {
    if (state.pattern) {
      const last = state.pattern.ball === state.pattern.of;
      this.#writeShot(
        `<div class="hud-label">This shot</div><div class="hud-big">ball ${state.pattern.ball} of ${state.pattern.of}</div>` +
          `<div class="hud-sub">${last ? 'pot it to run out' : 'pot it, and leave yourself the next'}</div>` +
          (state.tip === null ? '' : tipPicture(state.tip)) +
          diamondLine(state.diamonds),
      );
      return;
    }
    if (state.speed) {
      this.#writeShot(
        '<div class="hud-label">This shot</div><div class="hud-big">no object ball</div>' +
          `<div class="hud-sub">${speedAsk(state.speed.target, state.speed.distance)}</div>` +
          diamondLine(state.diamonds),
      );
      return;
    }
    if (state.position) {
      this.#writeShot(
        `<div class="hud-label">This shot</div><div class="hud-big">${state.position.target === 'zone' ? 'play for position' : 'straight in'}</div>` +
          `<div class="hud-sub">${positionAsk(state.position.target, state.position.distance)}</div>` +
          (state.tip === null ? '' : tipPicture(state.tip)) +
          diamondLine(state.diamonds),
      );
      return;
    }
    if (state.departure) {
      this.#writeShot(
        '<div class="hud-label">This shot</div><div class="hud-big">played for you</div>' +
          `<div class="hud-sub">${state.departure.stroke === 'stun' ? 'stunned' : 'rolling'}: say where the cue ball goes</div>` +
          diamondLine(state.diamonds),
      );
      return;
    }
    if (!state.guides.readout) {
      // Say which guide is left, so a panel without numbers is not mistaken
      // for a tier without help.
      const [left, hint] = state.guides.ghostBall
        ? ['ghost ball', 'no numbers: read the cut off it']
        : state.guides.aimLine
          ? ['aim line only', 'judge the cut yourself']
          : ['no guides', 'read the angle yourself'];
      this.#writeShot(
        `<div class="hud-label">This shot</div><div class="hud-big">${left}</div>` +
          `<div class="hud-sub">${hint}</div>` +
          (state.guides.overlap ? overlapPicture(state.aimOverlap) : '') +
          (state.calling ? callButtons(state.call) : '') +
          diamondLine(state.diamonds),
      );
      return;
    }

    const cut = state.cutAngleDegrees.toFixed(1);
    const side = state.cutSide === 'straight' ? 'straight in' : `cut ${state.cutSide}`;
    this.#writeShot(
      '<div class="hud-label">This shot</div>' +
        `<div class="hud-big">${cut}&deg; ${side}</div>` +
        `<div class="hud-sub">${(state.fullness * 100).toFixed(0)}% full ball</div>` +
        diamondLine(state.diamonds),
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
        const label = !entry.contacted ? 'no contact' : pocketShareLabel(entry);
        const lucky = isLucky(entry.pottedTarget, entry.qualifying, entry.pocketShare === null ? null : Math.abs(entry.pocketShare));
        const mark = entry.retry ? 'retry' : lucky ? 'luck' : entry.pottedTarget ? 'potted' : entry.qualifying ? 'on aim' : '';
        const kind = entry.retry ? ' retry' : entry.qualifying ? ' good' : '';
        return (
          `<div class="hud-shot-row${kind}">` +
          `<span class="hud-shot-mark">${mark}</span>${label}</div>`
        );
      })
      .join('');

    const html =
      '<div class="hud-label">Recent shots</div>' +
      state.tendencies.map(tendencyLine).join('') +
      `<div class="hud-shot-list">${rows}</div>`;

    if (html === this.#renderedHistory) return;
    this.#renderedHistory = html;
    this.#history.innerHTML = html;
    this.#history.style.display = '';
  }

  #renderLevels(state: HudState): void {
    const key =
      state.levels.map((l) => `${l.id}${l.current ? 'c' : ''}${l.completed ? 'x' : ''}`).join() +
      state.bands.map((b) => `${b.rate}/${b.shots}${b.mastered ? 'm' : ''}`).join() +
      `p${state.daysPractised}` +
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
      '<div class="hud-label">Levels</div>' + `<div class="hud-level-list">${rows}</div>` +
      masteryStrip(state.bands) +
      `<div class="hud-sub hud-practised">Practised on ${state.daysPractised} of the last 7 days</div>` +
      reset;
  }
}

function tendencyLine({ label, tendency }: TendencyRow): string {
  const body =
    tendency.kind === 'even'
      ? 'no consistent bias'
      : `<b>${ofThePocket(tendency.share)} ${tendency.kind}</b> on average`;
  return `<div class="hud-sub hud-tendency">${label}: ${body} <span class="hud-note">(${tendency.samples})</span></div>`;
}

/** Below this share of the pocket a shot reads as dead centre. */
const DEAD_CENTRE = 0.05;

/** One shot's miss, as the history lists it: the share of the pocket, and which way. */
function pocketShareLabel(entry: HistoryEntry): string {
  const share = entry.pocketShare;
  if (share === null) return 'no line drops';
  if (Math.abs(share) <= DEAD_CENTRE) return 'dead centre';
  const side = entry.cutSide === 'straight' ? (share > 0 ? 'left' : 'right') : share > 0 ? 'thick' : 'thin';
  const used = Math.abs(share);
  return `${used <= 1 ? percent(used) : `${used.toFixed(1)}&times;`} ${side}`;
}

/** Where the balls start, in diamonds from the bottom-left corner pocket. */
function diamondLine(diamonds: HudState['diamonds']): string {
  if (!diamonds) return '';
  return (
    '<div class="hud-sub hud-extra hud-diamonds" title="In diamonds from the bottom-left corner pocket, ' +
    'as the overhead view shows it: along the long rail, then across">' +
    `cue ${diamonds.cue} &middot; ${diamonds.second} ${diamonds.object}</div>`
  );
}

function renderMilestone(milestone: Milestone): string {
  const body =
    milestone.kind === 'level-complete'
      ? '<div class="hud-label">Level complete</div>' +
        `<div class="hud-big">${escape(milestone.levelName)}</div>` +
        `<div class="hud-sub">${milestone.qualified} of ${milestone.attempts} ` +
        (milestone.potted === null ? 'read right' : `on aim &middot; ${milestone.potted} potted`) +
        '</div>' +
        (milestone.nextLevelName === null ? '' : `<div class="hud-sub">Next: ${escape(milestone.nextLevelName)}</div>`)
      : milestone.kind === 'assessment-finished'
        ? '<div class="hud-label">Assessment</div>' +
          `<div class="hud-big">${milestone.points} of ${milestone.of}: ${escape(milestone.rating)}</div>` +
          `<div class="hud-sub">${milestone.parts.map((p) => `${escape(p.part)} ${p.points}/${p.of}`).join(' &middot; ')}</div>` +
          (milestone.personalBest
            ? '<div class="hud-sub">A personal best.</div>'
            : `<div class="hud-sub">Your best is ${milestone.best} of ${milestone.of}.</div>`) +
          (milestone.first
            ? '<div class="hud-sub">Your first run today.</div>'
            : `<div class="hud-sub">Today&rsquo;s first run: ${milestone.firstToday} of ${milestone.of}.</div>`) +
          `<div class="hud-sub">Next: a fresh run of ${milestone.of}</div>`
      : milestone.kind === 'daily-finished'
        ? '<div class="hud-label">Daily set</div>' +
          `<div class="hud-big">Median: ${ofThePocket(milestone.median)}</div>` +
          (milestone.first
            ? '<div class="hud-sub">Your first run today: this is the one that counts.</div>'
            : `<div class="hud-sub">Practice: today&rsquo;s first run stands at ${ofThePocket(milestone.firstToday)}.</div>`) +
          (milestone.earlier.length === 0
            ? ''
            : `<div class="hud-sub">First runs before, latest first: ${milestone.earlier.map((run) => shareOfPocket(run.score)).join(', ')}</div>`) +
          '<div class="hud-sub">Next: the same ten again, as practice</div>'
        : '<div class="hud-label">Exam finished</div>' +
          `<div class="hud-big">${milestone.potted} of ${milestone.total} potted</div>` +
          (milestone.personalBest
            ? '<div class="hud-sub">A personal best.</div>'
            : milestone.best === null
              ? ''
              : `<div class="hud-sub">Your best is ${milestone.best} of ${milestone.total}.</div>`) +
          (milestone.first
            ? '<div class="hud-sub">Your first run today.</div>'
            : `<div class="hud-sub">Today&rsquo;s first run: ${milestone.firstToday} of ${milestone.total}.</div>`) +
          `<div class="hud-sub">Next: a fresh run of ${milestone.total}</div>`;
  return (
    body +
    '<button type="button" class="hud-continue">Continue</button>' +
    '<div class="hud-sub hud-note kbd-hint">or press N</div>'
  );
}

function renderReport(
  outcome: ShotOutcome,
  /** Scored on the pot, as the exam and the assessment's cuts are. */
  potsCount: boolean,
  practice: boolean,
  held: boolean,
  routine: HudState['routineLog'],
  estimate: HudState['estimate'],
  autoNextIn: number | null,
  position: { readonly result: PositionResult; readonly zone: boolean } | null,
  pattern: HudState['patternNews'],
): string {
  const verdict = position
    ? positionVerdict(position.result, position.zone)
    : pattern
      ? patternVerdict(pattern, outcome)
      : verdictFor(outcome, potsCount);

  const used = outcome.pocketUsed;
  const aim = !outcome.contacted
    ? 'missed the object ball'
    : used === null
      ? 'no line from here drops'
      : used <= DEAD_CENTRE
        ? 'dead centre of the pocket'
        : `used ${ofThePocket(used)}, ${outcome.aimError.side}`;
  const cut = `${((outcome.cutAngle * 180) / Math.PI).toFixed(1)}&deg; cut`;

  const notes: string[] = [];
  if (practice) notes.push('retry: practice, not counted');
  if (outcome.scratch) notes.push('scratch');
  if (!outcome.settled) notes.push('shot cut short');

  return (
    `<div class="hud-verdict ${verdict.good ? 'good' : 'bad'}">${verdict.text}</div>` +
    (verdict.why ? `<div class="hud-sub">${verdict.why}</div>` : '') +
    `<div class="hud-sub">Aim: ${aim}${used === null ? '' : ` &middot; ${percent(outcome.pocketAllowance)} allowed`}</div>` +
    (outcome.fullnessHit === null
      ? `<div class="hud-sub">${cut}</div>`
      : `<div class="hud-sub">Hit ${percent(outcome.fullnessHit)} of the ball, needed ` +
        `${percent(outcome.fullnessNeeded)} &middot; ${cut}</div>`) +
    `<div class="hud-sub">Result: ${resultText(outcome.result)}</div>` +
    (estimate && !estimate.asking && estimate.said !== null
      ? `<div class="hud-sub">You said ${estimateLabel(estimate.said, estimate.straight)}: ` +
        `${estimate.said === estimate.actual ? 'right' : `it was ${estimateLabel(estimate.actual, estimate.straight)}`}</div>`
      : '') +
    (routine
      ? `<div class="hud-sub hud-note">Struck ${routine.seconds.toFixed(1)} s after the deal` +
        `${routine.reAims === 0 ? ', from the first line' : `, standing up ${routine.reAims === 1 ? 'once' : `${routine.reAims} times`} to re-aim`}</div>`
      : '') +
    (outcome.call === null
      ? ''
      : `<div class="hud-sub">Called ${fractionByName(outcome.call).label}: ` +
        `${outcome.call === outcome.needed ? 'right' : `it was ${fractionByName(outcome.needed).label}`}</div>`) +
    (notes.length ? `<div class="hud-sub hud-note">${notes.join(' &middot; ')}</div>` : '') +
    // Held under a summary card the layout has gone, and the card says what next.
    (held
      ? ''
      : '<div class="hud-sub hud-note">' +
        '<button type="button" class="hud-call" data-replay>Replay</button><kbd class="kbd-hint"> P</kbd> &middot; ' +
        '<b>Retry</b><kbd class="kbd-hint"> R</kbd> this layout &middot; ' +
        '<b>Next</b><kbd class="kbd-hint"> N or Space</kbd> for another</div>' +
        autoNextLine(autoNextIn))
  );
}

/**
 * The tier window as pips, oldest first: filled for a shot on aim, ringed in
 * red for one off it, open for one still to play. A count of the shots on aim
 * would read like a score that only climbs, when an old shot drops out of the
 * window with every new one.
 */
function tierPips(state: HudState): string {
  const pips = Array.from({ length: state.windowSize }, (_, i) => {
    const shot = state.tierWindow[i];
    return `<span class="hud-pip ${shot === undefined ? 'open' : shot ? 'hit' : 'miss'}"></span>`;
  }).join('');
  const onAim = state.tierWindow.filter(Boolean).length;
  const label = `${onAim} of the last ${state.tierWindow.length} on aim, ${state.windowNeeded} needed`;
  return `<span class="hud-pips" role="img" aria-label="${label}">${pips}</span>`;
}

/**
 * The line as it stands, as seen down the cue: the object ball, and the cue
 * ball's outline over it, a diameter times the uncovered share to one side.
 */
function overlapPicture(overlap: HudState['aimOverlap']): string {
  const r = 13;
  const centre = 44;
  const cue = overlap
    ? `<circle class="cue" cx="${centre + (overlap.side === 'right' ? 1 : -1) * 2 * r * (1 - overlap.fullness)}" cy="16" r="${r}"/>`
    : '';
  return (
    `<svg class="hud-overlap" viewBox="0 0 88 32" width="88" height="32" role="img" ` +
    `aria-label="${overlap ? 'The cue ball over the object ball, down this line' : 'This line misses the object ball'}">` +
    `<circle class="object" cx="${centre}" cy="16" r="${r}"/>${cue}</svg>`
  );
}

/** Call the fraction the shot needs before playing it: F, or these. */
function callButtons(call: FractionName | null): string {
  const buttons = FRACTIONS.map(
    (f) =>
      `<button type="button" class="hud-call" data-call="${f.name}" aria-pressed="${f.name === call}">${f.label}</button>`,
  ).join('');
  return `<div class="hud-calls"><span class="hud-note">Call it<kbd class="kbd-hint"> F</kbd></span>${buttons}</div>`;
}

/** A perception drill: what to do, then how it went. */
function renderDrill(drill: NonNullable<HudState['drill']>, allowance: number, autoNextIn: number | null): string {
  const next =
    '<div class="hud-sub hud-note"><b>Next</b><kbd class="kbd-hint"> N or Space</kbd> for another &middot; ' +
    '<b>Retry</b><kbd class="kbd-hint"> R</kbd> this one again</div>' +
    autoNextLine(autoNextIn);
  if (drill.kind === 'flash' && drill.stage === 'showing') {
    return '<div class="hud-label">Read the angle</div><div class="hud-sub">Look now: the balls go in a moment.</div>';
  }
  if (drill.kind === 'flash' && drill.stage === 'asking') {
    const buttons = FRACTIONS.map(
      (f, i) =>
        `<button type="button" class="hud-call" data-drill-call="${f.name}">${f.label}` +
        `<kbd class="kbd-hint"> ${i + 1}</kbd></button>`,
    ).join('');
    return (
      '<div class="hud-label">Read the angle</div><div class="hud-sub">Which fraction did that need?</div>' +
      `<div class="hud-calls hud-estimates">${buttons}</div>`
    );
  }
  if (drill.stage === 'asking') {
    return (
      '<div class="hud-label">Place the ghost ball</div>' +
      '<div class="hud-sub">Click where the cue ball&rsquo;s centre has to be at contact.</div>'
    );
  }
  const result = drill.result!;
  const right = result.correct;
  const verdict = `<div class="hud-verdict ${right ? 'good' : 'bad'}">${right ? 'Right' : 'Not quite'}</div>`;
  const detail =
    result.kind === 'flash'
      ? `Called ${fractionByName(result.called).label}: it was ${fractionByName(result.needed).label}, ` +
        `${drill.cutDegrees.toFixed(1)}&deg; of cut`
      : `Off by ${(result.off * 100).toFixed(1)} cm: the line through it uses ` +
        `${Number.isFinite(result.used) ? ofThePocket(result.used) : 'none of the pocket'}, ${percent(allowance)} allowed`;
  return `${verdict}<div class="hud-sub">${detail}</div>${next}`;
}

/**
 * Mastery as a strip of the seven bands: each coloured from red to green by
 * the share of its latest unguided shots that met the standard, empty while
 * it has too few, and ticked once mastered. Each says it in words as well.
 */
function masteryStrip(bands: readonly BandMastery[]): string {
  const standard = `${Math.round(MASTERY_STANDARD * 100)}% of the pocket`;
  const cells = bands
    .map((band) => {
      const said =
        band.rate === null
          ? `${band.label}: ${band.shots} unguided ${band.shots === 1 ? 'shot' : 'shots'} so far, ${MASTERY_MIN} needed`
          : `${band.label}: ${Math.round(band.rate * 100)}% of the last ${band.shots} within ${standard}` +
            (band.mastered ? ', mastered' : '');
      const colour = band.rate === null ? '' : ` style="background: hsl(${Math.round(band.rate * 130)} 50% 32%)"`;
      return (
        `<span class="hud-band${band.rate === null ? ' unplayed' : ''}" role="img" aria-label="${said}" title="${said}"${colour}>` +
        `${band.label.split('\u2013')[0]}${band.mastered ? '<span class="hud-band-tick">&#10003;</span>' : ''}</span>`
      );
    })
    .join('');
  return `<div class="hud-label hud-mastery-label">Mastery, unguided</div><div class="hud-mastery">${cells}</div>`;
}

/** A pattern shot's verdict: the run going on, run out, or over. */
function patternVerdict(
  pattern: NonNullable<HudState['patternNews']>,
  outcome: ShotOutcome,
): { readonly text: string; readonly good: boolean; readonly why: string } {
  if (!pattern.over) {
    return {
      text: `Ball ${pattern.down} of ${pattern.of} down`,
      good: true,
      why: 'On to the next, from where the cue ball stopped: <b>Space</b> or <b>Next</b>.',
    };
  }
  if (pattern.down === pattern.of) return { text: `Run out: ${pattern.of} of ${pattern.of}`, good: true, why: 'Every ball, in order.' };
  return {
    text: `Run over: ${pattern.down} of ${pattern.of} down`,
    good: false,
    why: outcome.scratch ? 'The cue ball went in.' : 'That one stayed up. The next run starts afresh.',
  };
}

/** What a speed drill asks of the cue ball. */
function speedAsk(target: SpeedTarget, distance: number): string {
  return target === 'lag'
    ? 'up to the far cushion and back: stop in the ring without touching the near one'
    : `stop the cue ball in the ring, ${Math.round(distance * 100)} cm away, touching no cushion`;
}

/** A speed drill's report: where the cue ball stopped against the ring, and what it touched. */
function renderSpeed(target: SpeedTarget, result: SpeedResult, autoNextIn: number | null): string {
  const cm = (metres: number): string => `${Math.round(Math.abs(metres) * 100)} cm`;
  const verdict =
    result.correct
      ? 'In the ring'
      : target === 'lag' && result.cushions === 0
        ? 'Short of the far cushion'
        : target === 'lag' && result.cushions > 1
          ? 'Touched the near cushion'
          : target === 'distance' && result.cushions > 0
            ? 'Off a cushion'
            : 'Outside the ring';
  const parts = [
    ...(Math.abs(result.long) >= 0.03 ? [result.long > 0 ? `long by ${cm(result.long)}` : `short by ${cm(result.long)}`] : []),
    ...(result.wide >= 0.03 ? [`wide by ${cm(result.wide)}`] : []),
  ];
  return (
    `<div class="hud-verdict ${result.correct ? 'good' : 'bad'}">${verdict}</div>` +
    `<div class="hud-sub">The cue ball stopped ${cm(result.off)} from the ring&rsquo;s centre` +
    `${parts.length > 0 && !result.correct ? `: ${parts.join(', ')}` : ''}.</div>` +
    '<div class="hud-sub hud-note"><button type="button" class="hud-call" data-replay>Replay</button>' +
    '<kbd class="kbd-hint"> P</kbd> &middot; <b>Retry</b><kbd class="kbd-hint"> R</kbd> this one &middot; ' +
    '<b>Next</b><kbd class="kbd-hint"> N or Space</kbd> for another</div>' +
    autoNextLine(autoNextIn)
  );
}

/** What a position shot asks of the cue ball. */
function positionAsk(target: PositionAsk, distance: number): string {
  if (target === 'zone') return 'pot it, and leave the cue ball in the zone';
  if (target === 'stop') return 'stop the cue ball where it meets the object ball';
  const cm = Math.round(distance * 100);
  return target === 'follow' ? `follow through ${cm} cm to the ring` : `draw back ${cm} cm to the ring`;
}

/** The cue ball from behind, with the tip on it; and in words. */
function tipPicture(tip: number): string {
  const said =
    tip === 0
      ? 'centre ball'
      : tip > 0
        ? `follow: ${tip.toFixed(1)} R above centre`
        : `draw: ${(-tip).toFixed(1)} R below centre`;
  return (
    '<div class="hud-tip">' +
    `<svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"><circle class="hud-tip-ball" cx="14" cy="14" r="12"/>` +
    `<circle class="hud-tip-dot" cx="14" cy="${(14 - tip * 24).toFixed(1)}" r="3"/></svg>` +
    `<span>Tip: ${said} <kbd class="kbd-hint">&uarr; &darr;</kbd></span></div>`
  );
}

/** A position shot's verdict: the ring or the zone, and why not when not. */
function positionVerdict(result: PositionResult, zone: boolean): { readonly text: string; readonly good: boolean; readonly why: string } {
  const cm = (metres: number): string => `${Math.round(Math.abs(metres) * 100)} cm`;
  const place = zone ? 'zone' : 'ring';
  const from = zone ? 'the zone&rsquo;s centre' : 'the spot';
  if (result.scratch) return { text: 'Scratch', good: false, why: 'The cue ball went in after it.' };
  if (!result.potted) return { text: 'Missed the pot', good: false, why: `The cue ball stopped ${cm(result.off)} from ${from}.` };
  if (result.correct) {
    return { text: `In the ${place}`, good: true, why: `The cue ball stopped ${cm(result.off)} from ${from}.` };
  }
  if (zone) return { text: 'Outside the zone', good: false, why: `The cue ball stopped ${cm(result.off)} from ${from}.` };
  const parts = [
    ...(Math.abs(result.long) >= 0.03 ? [result.long > 0 ? `long by ${cm(result.long)}` : `short by ${cm(result.long)}`] : []),
    ...(result.wide >= 0.03 ? [`wide by ${cm(result.wide)}`] : []),
  ];
  return { text: 'Outside the ring', good: false, why: `The cue ball stopped ${cm(result.off)} from the spot: ${parts.join(', ')}.` };
}

/** One step of the first-launch coaching, with the way out of it. */
function coachText(step: Exclude<CoachStep, 'done'>): string {
  const [count, body] = COACH_STEPS[step];
  return (
    `<div class="hud-label">Coaching, ${count} of 3</div><div class="hud-keys">${body}</div>` +
    '<button type="button" class="hud-call" data-skip-coaching>Skip the coaching</button>'
  );
}

const COACH_STEPS: Record<Exclude<CoachStep, 'done'>, readonly [number, string]> = {
  aim: [
    1,
    'The faint ball is the <b>ghost ball</b>: where the cue ball has to be when it meets the object ball. ' +
      'Turn the white line onto its centre: <span class="kbd-hint">drag on the table, then <b>&larr; &rarr;</b> ' +
      'for fine steps</span><span class="touch-hint">drag on the table, then <b>&lsaquo; &rsaquo;</b> for fine ' +
      'steps</span>.',
  ],
  strike: [
    1,
    'That is the line. Now the stroke: <span class="kbd-hint">hold <b>Space</b> and let go</span>' +
      '<span class="touch-hint">drag down the strip on the right and lift</span> when the meter reaches its ' +
      'marker.',
  ],
  report: [
    1,
    'The report says how much of the pocket your line used, and which way any miss went. ' +
      '<span class="kbd-hint"><b>Space</b> or <b>N</b></span><span class="touch-hint"><b>Next</b></span> ' +
      'for the next shot.',
  ],
  power: [
    2,
    'The <b>marker</b> on the meter is the stroke that just drops the ball. Softer stops short; harder can ' +
      'rattle in the jaws. Line it up as before and strike near the marker.',
  ],
  'power-report': [
    2,
    '<b>Retry</b> plays the same layout again, as practice that does not count. ' +
      '<span class="kbd-hint"><b>Space</b> or <b>N</b></span><span class="touch-hint"><b>Next</b></span> ' +
      'for the last coached shot.',
  ],
  tiers: [
    3,
    'Three of your last five shots on aim take a guide away: the line to the pocket, then the ghost ball, ' +
      'then the rest. The skill is keeping the line once they have gone. <b>?</b> has every control.',
  ],
};

/** The countdown to the next shot dealing itself, while there is one. */
function autoNextLine(seconds: number | null): string {
  // Shown but not read out: a screen reader would otherwise count down aloud every second.
  return seconds === null ? '' : `<div class="hud-sub hud-note" aria-hidden="true">Next shot in ${seconds} s</div>`;
}

/** An on/off switch in the controls panel, written only when it changes. */
function writeToggle(button: HTMLElement, on: boolean): void {
  const text = on ? 'on' : 'off';
  if (button.textContent === text) return;
  button.textContent = text;
  button.setAttribute('aria-pressed', String(on));
}

/** A level about the cue ball: the question, then where it went against what was said. */
function renderDeparture(
  levelName: string,
  departure: NonNullable<HudState['departure']>,
  autoNextIn: number | null,
): string {
  const label = `<div class="hud-label">${escape(levelName)}</div>`;
  if (departure.stage === 'asking') {
    const stroke =
      departure.stroke === 'stun'
        ? 'stunned, so it meets the object ball with no roll'
        : 'struck above centre, so it meets the object ball rolling';
    return (
      label +
      '<div class="hud-sub">Where does the cue ball go after contact? <span class="kbd-hint">Click</span>' +
      '<span class="touch-hint">Tap</span> on its path from the ghost ball, and the shot is played for you: ' +
      `${stroke}.</div>`
    );
  }
  if (departure.stage === 'playing' || !departure.result) return label + '<div class="hud-sub">Watch the cue ball.</div>';
  const { error, ruleAngle, correct } = departure.result;
  const went =
    departure.stroke === 'stun'
      ? `it left ${ruleAngle.toFixed(0)}&deg; from the object ball&rsquo;s line`
      : `it ended ${ruleAngle.toFixed(0)}&deg; off its own line`;
  return (
    `<div class="hud-verdict ${correct ? 'good' : 'bad'}">${correct ? 'Right' : 'Not quite'}</div>` +
    `<div class="hud-sub">Off by ${error.toFixed(1)}&deg;, ${departure.allowance}&deg; allowed: ${went}</div>` +
    '<div class="hud-sub hud-note"><b>Next</b><kbd class="kbd-hint"> N or Space</kbd> for another &middot; ' +
    '<button type="button" class="hud-call" data-replay>Replay</button><kbd class="kbd-hint"> P</kbd></div>' +
    autoNextLine(autoNextIn)
  );
}

/** Before the report: how did you hit it? */
function estimatePrompt(straight: boolean): string {
  const buttons = ESTIMATES.map(
    (said, i) =>
      `<button type="button" class="hud-call" data-estimate="${said}">${estimateLabel(said, straight)}` +
      `<kbd class="kbd-hint"> ${i + 1}</kbd></button>`,
  ).join('');
  return (
    '<div class="hud-label">Before the report</div>' +
    '<div class="hud-sub">How did you hit it?</div>' +
    `<div class="hud-calls hud-estimates">${buttons}</div>` +
    '<div class="hud-sub hud-note"><button type="button" class="hud-call" data-estimate-skip>skip</button>' +
    '<kbd class="kbd-hint"> Esc</kbd></div>'
  );
}

/** A share as a whole percentage. */
function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** A share of the pocket: a percentage inside it, a multiple of it outside, where percentages run to four figures. */
function ofThePocket(share: number): string {
  return share <= 1 ? `${percent(share)} of the pocket` : `${share.toFixed(1)}&times; the pocket`;
}

/** The same, for a list: "42%", or "1.5×" past the pocket. */
function shareOfPocket(share: number): string {
  return share <= 1 ? percent(share) : `${share.toFixed(1)}&times;`;
}

/** What the object ball did, in table units. */
function resultText(result: ShotResult): string {
  const cm = (metres: number): string => `${(metres * 100).toFixed(1)} cm`;
  switch (result.kind) {
    case 'potted':
      return 'potted';
    case 'wrong-pocket':
      return `went in the ${result.pocket.replace(/-/g, ' ')}`;
    case 'rattled':
      return result.hung ? 'hung in the jaws' : 'rattled out of the jaws';
    case 'short':
      return `on line, but stopped ${cm(result.by)} short`;
    case 'wide':
      return `missed the pocket by ${cm(result.by)}`;
    case 'no-contact':
      return 'no contact';
  }
}

function speedLabel(timeScale: number): string {
  if (timeScale === 0.5) return 'Half speed';
  if (timeScale === 0.25) return 'Quarter speed';
  return timeScale === 1 ? 'Full speed' : `${timeScale}x speed`;
}

interface ChipOptions {
  /** The key that does the same, shown where there is a keyboard. */
  readonly key?: string;
  /** Only on a small screen, where the panel it opens is folded away. */
  readonly compactOnly?: boolean;
  /** For a toggle: whether it is on. */
  readonly pressed?: boolean;
  /** Spoken name, for a chip whose text is a symbol. */
  readonly label?: string;
}

/** One toolbar button. */
function chip(action: string, text: string, options: ChipOptions = {}): string {
  const classes = options.compactOnly ? 'hud-chip compact-only' : 'hud-chip';
  const pressed = options.pressed === undefined ? '' : ` aria-pressed="${options.pressed}"`;
  const label = options.label === undefined ? '' : ` aria-label="${escape(options.label)}"`;
  const hint = options.key === undefined ? '' : ` <kbd class="kbd-hint">${escape(options.key)}</kbd>`;
  return `<button type="button" class="${classes}" data-action="${action}"${pressed}${label}>${text}${hint}</button>`;
}

function panel(root: HTMLElement, id: string): HTMLElement {
  const element = document.createElement('div');
  element.id = id;
  element.className = 'panel';
  root.appendChild(element);
  return element;
}

