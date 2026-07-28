/**
 * Wiring and the game loop.
 *
 * Frame deltas are clamped and physics catch-up is bounded inside ShotSession,
 * so a stalled tab resumes rather than fast-forwarding through a shot. The
 * renderer interpolates between the last two physics states.
 */

import { fullness as fullnessOf } from './geometry/shot';
import { pocketById } from './geometry/table';
import { type Vec2, add, angleOf, fromAngle, sub } from './geometry/vec2';
import { SLICE_DRILLS, type ShotLayout } from './game/drills';
import { attachInput } from './game/input';
import { MAX_FRAME_DT, ShotSession, type ShotOutcome } from './game/shot-session';
import { ADVANCE_REQUIRED, TierTracker } from './game/tiers';
import { PoolScene } from './scene/pool-scene';
import { Hud } from './ui/hud';

/** Seconds of held Space to reach full power. */
const CHARGE_SECONDS = 1.1;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud') as HTMLElement;

const scene = new PoolScene(canvas);
const hud = new Hud(hudRoot);

const DEFAULT_TOLERANCE_DEGREES = 2;

const tiers = new TierTracker();

let drillIndex = 0;
let layout: ShotLayout = SLICE_DRILLS[0]!;
let session = newSession(layout);
let chargeSeconds = 0;
let attempts = 0;
let qualified = 0;
let evaluations = 0;

function newSession(next: ShotLayout): ShotSession {
  return new ShotSession(next, { toleranceDegrees: DEFAULT_TOLERANCE_DEGREES });
}

function startShot(next: ShotLayout): void {
  layout = next;
  session = newSession(layout);
  chargeSeconds = 0;
}

function retry(): void {
  if (session.phase === 'simulating') return;
  startShot(layout);
}

function nextDrill(): void {
  if (session.phase === 'simulating') return;
  drillIndex = (drillIndex + 1) % SLICE_DRILLS.length;
  startShot(SLICE_DRILLS[drillIndex]!);
}

function recordOutcome(outcome: ShotOutcome): void {
  evaluations++;
  attempts++;
  if (outcome.qualifying) qualified++;
  tiers.record(outcome.qualifying);
}

attachInput(canvas, scene, {
  onAimAt(point: Vec2) {
    const cue = session.cueBall.pos;
    const delta = sub(point, cue);
    if (Math.hypot(delta.x, delta.y) < 1e-4) return;
    session.aimTo(angleOf(delta));
  },
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
  onNext: nextDrill,
});

window.addEventListener('resize', () => scene.resize());
canvas.focus();

let lastFrame = performance.now();

function frame(now: number): void {
  const dt = Math.min((now - lastFrame) / 1000, MAX_FRAME_DT);
  lastFrame = now;

  if (session.phase === 'charging') {
    chargeSeconds += dt;
    session.setPower(Math.min(1, chargeSeconds / CHARGE_SECONDS));
  }

  session.advance(dt);
  if (session.phase === 'settled') {
    const outcome = session.evaluate();
    if (outcome) recordOutcome(outcome);
  }

  const analysis = session.analysis;
  const pocket = pocketById(layout.targetPocket);
  scene.guides.update({
    visibility: tiers.guides,
    cue: session.cueBall.pos,
    aimEnd: add(session.cueBall.pos, fromAngle(session.aimAngle, analysis.cueToGhost)),
    ghost: analysis.ghostCenter,
    object: session.objectBall.pos,
    pocket: pocket.center,
  });

  scene.render({
    balls: session.balls,
    previous: session.previousBalls,
    alpha: session.alpha,
    aimAngle: session.aimAngle,
    power: session.power,
    showCue: session.phase === 'aiming' || session.phase === 'charging',
  });

  hud.update({
    phase: session.phase,
    power: session.power,
    cutAngleDegrees: (analysis.cutAngle * 180) / Math.PI,
    cutSide: analysis.cutSide,
    fullness: fullnessOf(analysis.cutAngle),
    liveAimError: session.currentAimError,
    guides: tiers.guides,
    tier: tiers.tier,
    tierComplete: tiers.completed,
    label: layout.id === 'drill-cut-30' ? 'Drill: 30 degree cut' : 'Drill: straight in',
    toleranceDegrees: session.toleranceDegrees,
    windowQualified: tiers.qualifiedInWindow,
    windowNeeded: ADVANCE_REQUIRED,
    attempts,
    qualified,
    view: scene.view,
    outcome: session.outcome,
  });

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
    next: nextDrill,
    setView: (view: 'behind' | 'overhead') => scene.setView(view),
    state: () => ({
      phase: session.phase,
      shotId: layout.id,
      attempts,
      qualified,
      evaluations,
      tier: tiers.tier,
      tierComplete: tiers.completed,
      guides: tiers.guides,
      outcome: session.outcome ?? null,
    }),
  };
}
