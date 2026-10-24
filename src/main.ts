/**
 * Wiring and the game loop.
 *
 * Frame deltas are clamped and physics catch-up is bounded inside ShotSession,
 * so a stalled tab resumes rather than fast-forwarding through a shot. The
 * renderer interpolates between the last two physics states.
 */

import type { ClothPreset } from './constants';
import { fullness as fullnessOf } from './geometry/shot';
import { pocketById } from './geometry/table';
import { add, angleOf, fromAngle } from './geometry/vec2';
import { Campaign } from './game/campaign';
import { attachInput } from './game/input';
import { speedBand } from './game/power';
import { browserStorage, createProgressStore } from './game/progress-store';
import { createSettingsStore, nextCloth, nextTimeScale } from './game/settings-store';
import { ShotHistory } from './game/shot-history';
import { MAX_FRAME_DT, ShotSession, type ShotOutcome } from './game/shot-session';
import { ADVANCE_REQUIRED } from './game/tiers';
import { ballNumberFor } from './scene/ball-textures';
import { PoolScene } from './scene/pool-scene';
import { Hud, type Milestone, type Notice } from './ui/hud';

/** Seconds of held Space to reach full power. */
const CHARGE_SECONDS = 1.1;

/** How the cloth presets read to a player. */
const CLOTH_LABELS: Record<ClothPreset, string> = {
  fast: 'Fast',
  normal: 'Normal',
  slow: 'Slow',
};

const canvas = document.getElementById('game') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud') as HTMLElement;

const scene = new PoolScene(canvas);
const seed = Math.floor(Date.now() % 1_000_000);
const campaign = new Campaign(createProgressStore(browserStorage()), { seed });

const hud = new Hud(hudRoot, {
  onReset: () => resetProgress(),
  onSelectLevel: (id: number) => selectLevel(id),
  onContinue: () => continueOn(),
  onRetry: () => retry(),
  onNext: () => nextShot(),
  onToggleView: () => scene.toggleView(),
  onCycleSpeed: () => cycleSpeed(),
  onCycleCloth: () => cycleCloth(),
  returnFocus: () => canvas.focus(),
});

const settingsStore = createSettingsStore(browserStorage());
const history = new ShotHistory();

// Load one complete settings object before anything reads a preference, so the
// first session is built on the cloth the player actually chose.
let settings = settingsStore.load();

/** Sessions dealt so far. Seeds where the cue starts, so a retry starts somewhere new. */
let sessionsDealt = 0;
let session = newSession();
/** The session in play is a retry: practice, which the campaign will not count. */
let practice = campaign.retrying;
/**
 * A level just completed, or an exam just finished. The shot that did it stays
 * on the table with its report, and this card under it, until the player moves
 * on: dealing the next shot at once threw the result away unread.
 */
let milestone: Milestone | undefined;
let chargeSeconds = 0;
let evaluations = 0;
let noticesRaised = 0;
/** A save that could not be loaded is news nobody should miss, so it stays up. */
let notice: Notice | undefined =
  campaign.notice === undefined ? undefined : { text: campaign.notice, id: ++noticesRaised, sticky: true };

/** Say something once. It fades on its own; the HUD decides when. */
function announce(text: string): void {
  notice = { text, id: ++noticesRaised, sticky: false };
}
/** Fixed for the life of a layout, so there is no reason to re-derive it per frame. */
let objectBallNumber = ballNumberFor(session.layout.id);

/**
 * Slow motion scales how much simulated time a rendered frame may consume. The
 * 1/240 s tick is untouched, so half speed is the same shot watched for twice
 * as long, not a different one.
 */
function cycleSpeed(): void {
  // Spread the whole settings object: `save` replaces it, so writing one field
  // on its own would quietly discard the other.
  settings = { ...settings, timeScale: nextTimeScale(settings.timeScale) };
  settingsStore.save(settings);
  const { timeScale } = settings;
  announce(timeScale === 1 ? 'Full speed.' : `Slow motion: ${timeScale === 0.5 ? 'half' : 'quarter'} speed.`);
}

/**
 * Cloth changes apply to the shot being lined up, not just the next one — the
 * point is to feel the difference immediately. Refused mid-roll, like every
 * other command that would change the table under a moving ball.
 */
function cycleCloth(): void {
  if (session.phase === 'simulating') return;
  settings = { ...settings, cloth: nextCloth(settings.cloth) };
  settingsStore.save(settings);
  session.setCloth(settings.cloth);
  announce(`${CLOTH_LABELS[settings.cloth]} cloth.`);
}

function newSession(): ShotSession {
  return new ShotSession(campaign.layout, {
    toleranceDegrees: campaign.toleranceDegrees,
    cloth: settings.cloth,
    aimSeed: seed + sessionsDealt++,
  });
}

function startShot(): void {
  session = newSession();
  practice = campaign.retrying;
  milestone = undefined;
  objectBallNumber = ballNumberFor(session.layout.id);
  chargeSeconds = 0;
}

/**
 * Past a summary card the campaign has already dealt what comes next — the new
 * level's first layout, or a fresh exam run's — and the layout the card sits
 * over is gone. So R and N both just move on, as Continue does.
 */
function continueOn(): void {
  if (!milestone) return;
  startShot();
  canvas.focus();
}

function retry(): void {
  if (session.phase === 'simulating') return;
  if (milestone) return continueOn();
  campaign.retryShot();
  startShot();
}

function nextShot(): void {
  if (session.phase === 'simulating') return;
  if (milestone) return continueOn();
  campaign.nextShot();
  startShot();
}

/** Back to the first level with nothing recorded — the HUD asks first. */
function resetProgress(): void {
  if (session.phase === 'simulating') return;
  campaign.resetProgress();
  // The record of recent shots goes with the progress it was measured against.
  history.clear();
  announce('Progress reset.');
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
  const level = campaign.level;
  const event = campaign.record(outcome);
  history.record({
    aimError: outcome.aimError,
    qualifying: outcome.qualifying,
    pottedTarget: outcome.pottedTarget,
    contacted: outcome.contacted,
    cutAngleDegrees: (outcome.cutAngle * 180) / Math.PI,
    retry: event.practice,
  });
  if (event.examFinished) {
    milestone = { kind: 'exam-finished', ...event.examFinished, best: campaign.examBest };
  } else if (event.levelCompleted) {
    const stats = campaign.levelStats(level.id);
    milestone = {
      kind: 'level-complete',
      levelName: level.name,
      attempts: stats.attempts,
      qualified: stats.qualified,
      potted: stats.potted,
      nextLevelName: campaign.level.name,
    };
    // The campaign has moved to a new level, exactly as a level select would,
    // and the calibration starts afresh for the same reason.
    history.clear();
  } else if (event.advancedTier) {
    announce(`Tier ${campaign.tier}: one more guide comes away.`);
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
  onCycleCloth: cycleCloth,
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

  session.advance(dt * settings.timeScale);
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
    cueSpeed: session.cueSpeed,
    speedBand: speedBand(session.cueSpeed),
    recommendedPower: session.recommendedPower,
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
    practice,
    milestone,
    notice,
    view: scene.view,
    outcome: session.outcome,
    history: history.entries,
    cutTendency: history.cutTendency,
    straightTendency: history.straightTendency,
    timeScale: settings.timeScale,
    cloth: settings.cloth,
    clothLabel: CLOTH_LABELS[settings.cloth],
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
    continue: continueOn,
    selectLevel,
    cycleSpeed,
    cycleCloth,
    setSpeed: (scale: number) => {
      while (settings.timeScale !== scale) {
        const before = settings.timeScale;
        cycleSpeed();
        if (settings.timeScale === before) break;
      }
      return settings.timeScale;
    },
    resetProgress,
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
      // Where the balls are AND which way they are facing. Orientation is
      // simulation state, so the browser pass can assert it is untouched by the
      // frame rate and by the time scale — the check that would have caught
      // accumulating it in the renderer instead.
      balls: session.balls.map((b) => ({
        id: b.id,
        pos: { x: b.pos.x, y: b.pos.y },
        spin: { x: b.spin.x, y: b.spin.y, z: b.spin.z, w: b.spin.w },
        potted: b.potted,
      })),
      view: scene.view,
      aimAngle: session.aimAngle,
      idealAimAngle: angleOf(session.analysis.aimDirection),
      power: session.power,
      cueSpeed: session.cueSpeed,
      recommendedPower: session.recommendedPower,
      timeScale: settings.timeScale,
      cloth: settings.cloth,
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
      notice: notice?.text ?? null,
      evaluations,
      practice,
      milestone: milestone ?? null,
      outcome: session.outcome ?? null,
    }),
  };
}
