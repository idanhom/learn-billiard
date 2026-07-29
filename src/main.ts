/**
 * Wiring and the game loop.
 *
 * Frame deltas are clamped and physics catch-up is bounded inside ShotSession,
 * so a stalled tab resumes rather than fast-forwarding through a shot. The
 * renderer interpolates between the last two physics states.
 */

import { fullness as fullnessOf } from './geometry/shot';
import { pocketById } from './geometry/table';
import { add, angleOf, fromAngle } from './geometry/vec2';
import { Campaign } from './game/campaign';
import { attachInput } from './game/input';
import { browserStorage, createProgressStore } from './game/progress-store';
import { createSettingsStore, nextTimeScale } from './game/settings-store';
import { ShotHistory } from './game/shot-history';
import { MAX_FRAME_DT, ShotSession, type ShotOutcome } from './game/shot-session';
import { ADVANCE_REQUIRED } from './game/tiers';
import { ballNumberFor } from './scene/ball-textures';
import { PoolScene } from './scene/pool-scene';
import { Hud } from './ui/hud';

/** Seconds of held Space to reach full power. */
const CHARGE_SECONDS = 1.1;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud') as HTMLElement;

const scene = new PoolScene(canvas);
const campaign = new Campaign(createProgressStore(browserStorage()), {
  seed: Math.floor(Date.now() % 1_000_000),
});

const hud = new Hud(hudRoot, {
  onReset: () => {
    campaign.resetProgress();
    notice = 'Progress reset.';
    startShot();
  },
  onSelectLevel: (id: number) => selectLevel(id),
});

const settingsStore = createSettingsStore(browserStorage());
const history = new ShotHistory();

let session = newSession();
let chargeSeconds = 0;
let evaluations = 0;
let notice = campaign.notice;
let timeScale = settingsStore.load().timeScale;
/** Fixed for the life of a layout, so there is no reason to re-derive it per frame. */
let objectBallNumber = ballNumberFor(session.layout.id);

/**
 * Slow motion scales how much simulated time a rendered frame may consume. The
 * 1/240 s tick is untouched, so half speed is the same shot watched for twice
 * as long, not a different one.
 */
function cycleSpeed(): void {
  timeScale = nextTimeScale(timeScale);
  settingsStore.save({ timeScale });
  notice = timeScale === 1 ? 'Full speed.' : `Slow motion: ${timeScale === 0.5 ? 'half' : 'quarter'} speed.`;
}

function newSession(): ShotSession {
  return new ShotSession(campaign.layout, { toleranceDegrees: campaign.toleranceDegrees });
}

function startShot(): void {
  session = newSession();
  objectBallNumber = ballNumberFor(session.layout.id);
  chargeSeconds = 0;
}

function retry(): void {
  if (session.phase === 'simulating') return;
  campaign.retryShot();
  startShot();
}

function nextShot(): void {
  if (session.phase === 'simulating') return;
  campaign.nextShot();
  startShot();
}

function selectLevel(id: number): void {
  if (session.phase === 'simulating') return;
  if (!campaign.selectLevel(id)) return;
  notice = undefined;
  // A tendency measured on straight-ins says nothing about thin cuts, so the
  // calibration starts afresh with the level.
  history.clear();
  startShot();
  canvas.focus();
}

function recordOutcome(outcome: ShotOutcome): void {
  evaluations++;
  history.record({
    aimError: outcome.aimError,
    qualifying: outcome.qualifying,
    pottedTarget: outcome.pottedTarget,
    contacted: outcome.contacted,
    cutAngleDegrees: (outcome.cutAngle * 180) / Math.PI,
  });
  const event = campaign.record(outcome);
  if (event.examFinished) {
    const { potted, total, personalBest } = event.examFinished;
    notice = `Exam finished: ${potted} of ${total} potted${personalBest ? ' — a personal best' : ''}.`;
    startShot();
  } else if (event.levelCompleted) {
    notice = `Level complete. Moving on to ${campaign.level.name}.`;
    startShot();
  } else if (event.advancedTier) {
    notice = `Tier ${campaign.tier}: one more guide comes away.`;
  }
}

attachInput(canvas, {
  onNudgeAim(delta: number) {
    session.nudgeAim(delta);
  },
  onChargeStart() {
    if (session.beginCharge()) chargeSeconds = 0;
  },
  onChargeCancel() {
    session.cancelCharge();
    chargeSeconds = 0;
  },
  onRelease() {
    session.release();
    chargeSeconds = 0;
  },
  onToggleView() {
    scene.toggleView();
  },
  onRetry: retry,
  onNext: nextShot,
  onSelectLevel: selectLevel,
  onCycleSpeed: cycleSpeed,
});

window.addEventListener('resize', () => scene.resize());
canvas.focus();

let lastFrame = performance.now();

/**
 * Work done inside one frame, as opposed to the gap between frames. The two
 * differ whenever the browser is throttling the animation callback, and it is
 * the work that tells us whether this runs on a Pi.
 */
const frameCost = { samples: 0, total: 0, worst: 0 };

function frame(now: number): void {
  const startedAt = performance.now();
  const dt = Math.min((now - lastFrame) / 1000, MAX_FRAME_DT);
  lastFrame = now;

  if (session.phase === 'charging') {
    chargeSeconds += dt;
    session.setPower(Math.min(1, chargeSeconds / CHARGE_SECONDS));
  }

  session.advance(dt * timeScale);
  if (session.phase === 'settled') {
    const outcome = session.evaluate();
    if (outcome) recordOutcome(outcome);
  }

  const analysis = session.analysis;
  // Guides are for aiming. Once the cue is away they are just clutter over the
  // thing the player should be watching — and there is no point placing lines
  // nobody can see, so the update goes with the visibility.
  const aiming = session.phase === 'aiming' || session.phase === 'charging';
  scene.guides.setVisible(aiming);
  if (aiming) {
    scene.guides.update({
      visibility: campaign.guides,
      cue: session.cueBall.pos,
      aimEnd: add(session.cueBall.pos, fromAngle(session.aimAngle, analysis.cueToGhost)),
      ghost: analysis.ghostCenter,
      object: session.objectBall.pos,
      pocket: pocketById(session.layout.targetPocket).center,
    });
  }

  scene.render({
    balls: session.balls,
    previous: session.previousBalls,
    alpha: session.alpha,
    aimAngle: session.aimAngle,
    power: session.power,
    showCue: aiming,
    objectBallNumber,
    shotLength: analysis.cueToGhost + analysis.objectToPocket,
    dt,
  });

  const stats = campaign.stats;
  hud.update({
    phase: session.phase,
    power: session.power,
    cutAngleDegrees: (analysis.cutAngle * 180) / Math.PI,
    cutSide: analysis.cutSide,
    fullness: fullnessOf(analysis.cutAngle),
    liveAimError: session.currentAimError,
    guides: campaign.guides,
    tier: campaign.tier,
    tierComplete: campaign.levelCompleted,
    levelName: campaign.level.name,
    levelDescription: campaign.level.description,
    levels: campaign.levels.map((level) => ({
      id: level.id,
      name: level.name,
      completed: campaign.levelStats(level.id).completed,
      current: level.id === campaign.level.id,
    })),
    toleranceDegrees: campaign.toleranceDegrees,
    windowQualified: campaign.qualifiedInWindow,
    windowNeeded: ADVANCE_REQUIRED,
    attempts: stats.attempts,
    qualified: stats.qualified,
    potted: stats.potted,
    exam: campaign.exam,
    examBest: campaign.examBest,
    notice,
    view: scene.view,
    outcome: session.outcome,
    history: history.entries,
    cutTendency: history.cutTendency,
    straightTendency: history.straightTendency,
    timeScale,
  });

  const cost = performance.now() - startedAt;
  frameCost.samples++;
  frameCost.total += cost;
  if (cost > frameCost.worst) frameCost.worst = cost;

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// Dev-gated debug hook. Also available on a production build behind ?debug=1,
// so the verification pass can drive the real artifact rather than a dev server.
if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) {
  (window as unknown as Record<string, unknown>).__debug = {
    aimAt: (radians: number) => session.aimTo(radians),
    aimIdeal: () => session.aimTo(angleOf(session.analysis.aimDirection)),
    fire: (power: number) => {
      if (!session.beginCharge()) return false;
      session.setPower(power);
      return session.release();
    },
    retry,
    next: nextShot,
    selectLevel,
    cycleSpeed,
    setSpeed: (scale: number) => {
      while (timeScale !== scale) {
        const before = timeScale;
        cycleSpeed();
        if (timeScale === before) break;
      }
      return timeScale;
    },
    resetProgress: () => {
      campaign.resetProgress();
      startShot();
    },
    setView: (view: 'behind' | 'overhead') => scene.setView(view),
    frameCost: () => ({
      samples: frameCost.samples,
      mean: frameCost.samples === 0 ? 0 : frameCost.total / frameCost.samples,
      worst: frameCost.worst,
    }),
    resetFrameCost: () => {
      frameCost.samples = 0;
      frameCost.total = 0;
      frameCost.worst = 0;
    },
    state: () => ({
      phase: session.phase,
      aimAngle: session.aimAngle,
      timeScale,
      cutTendency: history.cutTendency,
      straightTendency: history.straightTendency,
      historyLength: history.entries.length,
      shotId: session.layout.id,
      levelId: campaign.level.id,
      tier: campaign.tier,
      tierComplete: campaign.levelCompleted,
      guides: campaign.guides,
      stats: campaign.stats,
      exam: campaign.exam ?? null,
      examBest: campaign.examBest,
      notice: notice ?? null,
      evaluations,
      outcome: session.outcome ?? null,
    }),
  };
}
