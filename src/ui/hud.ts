/**
 * DOM heads-up display. Kept out of the WebGL canvas so text stays crisp and
 * cheap on the Pi.
 */

import type { AimError, CutSide } from '../geometry/shot';
import type { ShotOutcome, ShotPhase } from '../game/shot-session';

export interface HudState {
  readonly phase: ShotPhase;
  readonly power: number;
  readonly cutAngleDegrees: number;
  readonly cutSide: CutSide;
  readonly fullness: number;
  readonly liveAimError: AimError;
  readonly tier: number;
  readonly label: string;
  readonly attempts: number;
  readonly qualified: number;
  readonly view: string;
  readonly outcome: ShotOutcome | undefined;
}

const TIER_NAMES = ['full guides', 'no pocket line', 'no ghost ball', 'no guides'];

export class Hud {
  readonly #status: HTMLElement;
  readonly #shot: HTMLElement;
  readonly #powerFill: HTMLElement;
  readonly #report: HTMLElement;

  constructor(root: HTMLElement) {
    root.innerHTML = '';

    this.#status = panel(root, 'hud-status', 'top:14px; left:14px;');
    this.#shot = panel(root, 'hud-shot', 'top:14px; right:14px; text-align:right;');
    this.#report = panel(root, 'hud-report', 'bottom:96px; left:50%; transform:translateX(-50%);');
    this.#report.style.display = 'none';

    const power = panel(root, 'hud-power', 'bottom:18px; left:50%; transform:translateX(-50%);');
    power.innerHTML =
      '<div class="hud-label">Power</div><div class="hud-meter"><div class="hud-meter-fill"></div></div>';
    this.#powerFill = power.querySelector('.hud-meter-fill') as HTMLElement;

    const help = panel(root, 'hud-help', 'bottom:18px; left:14px;');
    help.innerHTML =
      '<div class="hud-label">Controls</div>' +
      '<div class="hud-keys">Move mouse to aim &middot; <b>&larr;/&rarr;</b> fine aim &middot; ' +
      'hold <b>Space</b> for power &middot; <b>V</b> camera &middot; <b>R</b> retry &middot; <b>N</b> next</div>';
  }

  update(state: HudState): void {
    this.#status.innerHTML =
      `<div class="hud-label">${escape(state.label)}</div>` +
      `<div class="hud-big">Tier ${state.tier} &mdash; ${TIER_NAMES[state.tier] ?? ''}</div>` +
      `<div class="hud-sub">${state.qualified} of ${state.attempts} on aim &middot; ${escape(state.view)} view</div>`;

    const cut = state.cutAngleDegrees.toFixed(1);
    const side = state.cutSide === 'straight' ? 'straight in' : `cut ${state.cutSide}`;
    const live =
      state.liveAimError.kind === 'on-line'
        ? 'on the line'
        : `${state.liveAimError.degrees.toFixed(2)}&deg; ${state.liveAimError.kind}`;
    this.#shot.innerHTML =
      `<div class="hud-label">This shot</div>` +
      `<div class="hud-big">${cut}&deg; ${side}</div>` +
      `<div class="hud-sub">${(state.fullness * 100).toFixed(0)}% full ball</div>` +
      `<div class="hud-sub hud-live">${live}</div>`;

    this.#powerFill.style.width = `${Math.round(state.power * 100)}%`;

    if (state.outcome) {
      this.#report.style.display = '';
      this.#report.innerHTML = renderReport(state.outcome);
    } else {
      this.#report.style.display = 'none';
    }
  }
}

function renderReport(outcome: ShotOutcome): string {
  const verdict = outcome.qualifying ? 'On aim' : 'Off aim';
  const verdictClass = outcome.qualifying ? 'good' : 'bad';

  const aim = !outcome.contacted
    ? 'missed the object ball'
    : outcome.aimError.kind === 'on-line'
      ? 'dead on the line'
      : `${outcome.aimError.degrees.toFixed(2)}&deg; ${outcome.aimError.kind}`;

  const pot = outcome.pottedTarget
    ? 'potted'
    : outcome.pottedWrong
      ? `went in the ${outcome.objectPocket?.replace('-', ' ')}`
      : outcome.missDistance === null
        ? 'no contact'
        : `missed by ${(outcome.missDistance * 100).toFixed(1)} cm`;

  const notes: string[] = [];
  if (outcome.scratch) notes.push('scratch');
  if (!outcome.settled) notes.push('shot cut short');

  return (
    `<div class="hud-verdict ${verdictClass}">${verdict}</div>` +
    `<div class="hud-sub">Aim: ${aim} &middot; tolerance ${outcome.toleranceDegrees}&deg;</div>` +
    `<div class="hud-sub">Result: ${pot}</div>` +
    (notes.length ? `<div class="hud-sub hud-note">${notes.join(' &middot; ')}</div>` : '') +
    `<div class="hud-sub hud-note">R to retry this layout &middot; N for the next one</div>`
  );
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
