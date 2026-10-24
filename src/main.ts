/**
 * Wiring and the game loop.
 *
 * Frame deltas are clamped and physics catch-up is bounded inside ShotSession,
 * so a stalled tab resumes rather than fast-forwarding through a shot. The
 * renderer interpolates between the last two physics states.
 */

import type { ClothPreset } from './constants';
import { FRACTIONS, type FractionName } from './geometry/fractions';
import { firstTouch, fullness as fullnessOf } from './geometry/shot';
import { type Vec2, add, angleOf, fromAngle, signedAngleBetween } from './geometry/vec2';
import { Campaign, type CampaignEvent } from './game/campaign';
import { attachAimButtons, attachInput, attachTouchPower } from './game/input';
import { speedBand } from './game/power';
import { browserStorage, createProgressStore } from './game/progress-store';
import { createSettingsStore, nextCloth, nextTimeScale, stepViewingDistance } from './game/settings-store';
import { ShotHistory, signedShare } from './game/shot-history';
import { MAX_FRAME_DT, ShotSession, type ShotOutcome } from './game/shot-session';
import { ESTIMATES, type Estimate, estimateOf } from './game/estimate';
import { PerceptionDrill } from './game/perception';
import { potWindow } from './game/pot-window';
import { Routine } from './game/routine';
import { ADVANCE_REQUIRED, ADVANCE_WINDOW, FINAL_TIER, type GuideVisibility } from './game/tiers';
import type { LevelDefinition } from './game/levels';
import { ballNumberFor } from './scene/ball-textures';
import { type CameraView, PoolScene } from './scene/pool-scene';
import { Hud, type HudState, type Milestone, type Notice } from './ui/hud';

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
  onToggleView: () => (routine?.down ? toggleDown() : scene.toggleView()),
  onGetDown: () => toggleDown(),
  onEstimate: (said) => answerEstimate(said),
  onDrillCall: (fraction) => callDrill(fraction),
  onCycleSpeed: () => cycleSpeed(),
  onCycleCloth: () => cycleCloth(),
  onCall: (fraction) => session.callFraction(fraction),
  onViewingDistance: (steps) => changeViewingDistance(steps),
  returnFocus: () => canvas.focus(),
});

const settingsStore = createSettingsStore(browserStorage());
const history = new ShotHistory();

// Load one complete settings object before anything reads a preference, so the
// first session is built on the cloth the player actually chose.
let settings = settingsStore.load();
scene.setViewingDistance(settings.viewingDistance);

/** Sessions dealt so far. Seeds where the cue starts, so a retry starts somewhere new. */
let sessionsDealt = 0;
/** The commit routine for the shot in play, where it runs; see `routineActive`. */
let routine: Routine | undefined;
/** How the routine went for the shot just played: time to shoot, and re-aims. */
let routineLog: { readonly seconds: number; readonly reAims: number } | null = null;
/**
 * The self-estimate for the shot just played, once the ghost ball has gone:
 * asking while the report waits, then what the player said and what it was.
 */
let estimate: HudState['estimate'] = null;
/** The perception drill for the layout in play, on the level that has them; and where its ghost ball was put. */
let drill: PerceptionDrill | undefined;
let placedGhost: Vec2 | undefined;
let session = newSession();
routine = routineActive() ? new Routine(clock()) : undefined;
drill = newDrill();
/** The session in play is a retry: practice, which the campaign will not count. */
let practice = campaign.retrying;
/**
 * A level just completed, or an exam just finished. The shot that did it stays
 * on the table with its report, and this card under it, until the player moves
 * on: dealing the next shot at once threw the result away unread.
 */
let milestone: Milestone | undefined;
let chargeSeconds = 0;
/** The stroke is being charged on the touch strip, which sets the power itself. */
let touchCharging = false;
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

/** A step nearer the screen or further from it, for the stance view's true scale. */
function changeViewingDistance(steps: number): void {
  settings = { ...settings, viewingDistance: stepViewingDistance(settings.viewingDistance, steps) };
  settingsStore.save(settings);
  scene.setViewingDistance(settings.viewingDistance);
}

/** The guides that show a drill's answer once it is given. */
const DRILL_ANSWER: GuideVisibility = {
  aimLine: true,
  ghostBall: true,
  objectPath: true,
  readout: false,
  powerHint: false,
  overlap: false,
};

/** The drill as the HUD shows it: which kind, how far along, and how it went. */
function drillState(): HudState['drill'] {
  if (!drill) return null;
  const stage = drill.result ? 'answered' : drill.hidden(clock()) || drill.kind === 'place' ? 'asking' : 'showing';
  return { kind: drill.kind, stage, result: drill.result ?? null, cutDegrees: (session.analysis.cutAngle * 180) / Math.PI };
}

/** Seconds on the wall clock, for the routine's timings. */
function clock(): number {
  return performance.now() / 1000;
}

/**
 * The commit routine runs once the guides are gone: at the last tier and in
 * the exam. The line is chosen standing, from behind the cue, and played from
 * the stance after getting down on it, which is how the shot will look at a
 * real table.
 */
function routineActive(): boolean {
  return campaign.level.exam || campaign.tier === FINAL_TIER;
}

/** Every aim change goes through here, so the routine can hold it to the committed line. */
function nudgeAim(delta: number): void {
  const target = session.aimAngle + delta;
  session.aimTo(routine ? routine.steer(target, clock()) : target);
}

/** Start the stroke, unless the routine says not yet. */
function mayCharge(): boolean {
  if (drill) {
    announce('No shots here: read the angle.');
    return false;
  }
  const why = routine?.holdUp(clock());
  if (why === 'get down first') announce('Get down on the line first: G, or Get down.');
  if (why === 'hold still') announce('Hold still a moment before the stroke.');
  return why === undefined;
}

/** G: get down on the line as it stands, or stand back up to choose again. */
function toggleDown(): void {
  if (!routine || session.phase !== 'aiming') return;
  if (routine.down) {
    routine.standUp();
    scene.setView('behind');
    announce('Standing up. Choose the line again, then get down on it.');
  } else {
    routine.getDown(session.aimAngle, clock());
    scene.setView('stance');
    announce('Down on the line: half a degree of adjustment either way from here.');
  }
}

function newSession(): ShotSession {
  return new ShotSession(campaign.layout, {
    pocketAllowance: campaign.pocketAllowance,
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
  routine = routineActive() ? new Routine(clock()) : undefined;
  routineLog = null;
  estimate = null;
  drill = newDrill();
  placedGhost = undefined;
  if (routine) scene.setView('behind');
}

/** A perception drill for the layout in play, where the level has them. */
function newDrill(): PerceptionDrill | undefined {
  const kind = campaign.drillKind;
  if (!kind) return undefined;
  const analysis = session.analysis;
  const window = potWindow(session.layout, settings.cloth, analysis);
  return new PerceptionDrill(kind, session.layout.object, analysis, window, campaign.pocketAllowance, clock());
}

/** A flash drill's call, once the balls have gone. */
function callDrill(fraction: FractionName): void {
  const result = drill?.call(fraction, clock());
  if (result) recordDrill(result.correct);
}

/** A place drill's ghost ball, put where the player clicked. */
function placeDrill(point: Vec2): void {
  const result = drill?.place(point);
  if (!result) return;
  placedGhost = point;
  recordDrill(result.correct);
}

/** A drill answered counts like a shot: qualifying if right, and never a pot. */
function recordDrill(correct: boolean): void {
  evaluations++;
  const level = campaign.level;
  handleEvent(campaign.record({ qualifying: correct, pottedTarget: false }), level);
}

/** The player's read of their own miss, or null to skip it; then the report shows. */
function answerEstimate(said: Estimate | null): void {
  if (!estimate?.asking) return;
  estimate = { ...estimate, asking: false, said };
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

/** The overlap the line as it stands makes, as the HUD draws it down the cue. */
function overlapOfLine(): HudState['aimOverlap'] {
  const aim = fromAngle(session.aimAngle);
  const touch = firstTouch(session.layout.cue, session.layout.object, aim);
  if (!touch) return null;
  // The object ball goes off to one side of the line; the cue ball sits on the other.
  return { fullness: fullnessOf(touch.cut), side: signedAngleBetween(aim, touch.line) > 0 ? 'right' : 'left' };
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
  // Once the ghost ball has gone, the player says how they hit it before the
  // report says. Judged on the tier the shot was played at.
  if ((level.exam || campaign.tier >= 2) && outcome.pocketUsed !== null) {
    const actual = estimateOf(signedShare(outcome.pocketUsed, outcome.aimError.side));
    estimate = { asking: true, said: null, actual, straight: outcome.cutSide === 'straight' };
  }
  const event = campaign.record(outcome);
  history.record({
    pocketShare: outcome.pocketUsed === null ? null : signedShare(outcome.pocketUsed, outcome.aimError.side),
    qualifying: outcome.qualifying,
    pottedTarget: outcome.pottedTarget,
    contacted: outcome.contacted,
    cutAngleDegrees: (outcome.cutAngle * 180) / Math.PI,
    cutSide: outcome.cutSide,
    retry: event.practice,
  });
  // After the history has the shot, so a level it completes clears it too.
  handleEvent(event, level);
}

/** What the campaign said about a scored shot or drill: a level done, an exam run over, a tier earned. */
function handleEvent(event: CampaignEvent, level: LevelDefinition): void {
  if (event.examFinished) {
    milestone = { kind: 'exam-finished', ...event.examFinished, best: campaign.examBest };
  } else if (event.levelCompleted) {
    const stats = campaign.levelStats(level.id);
    milestone = {
      kind: 'level-complete',
      levelName: level.name,
      attempts: stats.attempts,
      qualified: stats.qualified,
      potted: level.perception ? null : stats.potted,
      nextLevelName: campaign.level.id === level.id ? null : campaign.level.name,
    };
    // The campaign has moved to a new level, exactly as a level select would,
    // and the calibration starts afresh for the same reason.
    history.clear();
  } else if (event.advancedTier && campaign.tier === FINAL_TIER) {
    announce(`Tier ${campaign.tier}: no guides. Line each shot up standing, then get down on it: G.`);
  } else if (event.advancedTier) {
    announce(`Tier ${campaign.tier}: one more guide comes away.`);
  }
}

/** The stroke has gone: note how the routine went, for the report. */
function released(): void {
  if (routine) routineLog = { seconds: routine.elapsed(clock()), reAims: routine.reAims };
}

attachInput(canvas, {
  onNudgeAim: nudgeAim,
  onChargeStart() {
    if (mayCharge() && session.beginCharge()) chargeSeconds = 0;
  },
  onChargeCancel() {
    session.cancelCharge();
    chargeSeconds = 0;
  },
  onRelease() {
    if (session.release()) released();
    chargeSeconds = 0;
  },
  onToggleView() {
    // Down in the stance, a change of view is standing back up.
    if (routine?.down) toggleDown();
    else scene.toggleView();
  },
  onGetDown: toggleDown,
  onDismiss: () => answerEstimate(null),
  onRetry: retry,
  onNext: nextShot,
  onSelectLevel(id: number) {
    // While the self-estimate or a flash drill is asking, the digit keys
    // answer it instead.
    if (estimate?.asking) {
      const said = ESTIMATES[id - 1];
      if (said !== undefined) answerEstimate(said);
      return;
    }
    if (drill?.hidden(clock())) {
      const fraction = FRACTIONS[id - 1];
      if (fraction) callDrill(fraction.name);
      return;
    }
    selectLevel(id);
  },
  onCycleSpeed: cycleSpeed,
  onCycleCloth: cycleCloth,
  onCycleCall() {
    // None, then fullest to thinnest, then none again.
    const names = FRACTIONS.map((f) => f.name);
    const at = session.call === null ? -1 : names.indexOf(session.call);
    session.callFraction(at + 1 < names.length ? names[at + 1]! : null);
  },
});

attachTouchPower(hud.touch.power, {
  onChargeStart() {
    touchCharging = mayCharge() && session.beginCharge();
  },
  onSetPower(power: number) {
    if (touchCharging) session.setPower(power);
  },
  onRelease() {
    if (touchCharging && session.release()) released();
    touchCharging = false;
  },
  onChargeCancel() {
    if (touchCharging) session.cancelCharge();
    touchCharging = false;
  },
});
attachAimButtons(hud.touch.aimLeft, hud.touch.aimRight, nudgeAim);

// A place drill's ghost ball goes where the table is clicked.
canvas.addEventListener('click', (event) => {
  if (drill?.kind !== 'place' || drill.result) return;
  const point = scene.pickTable(event.clientX, event.clientY);
  if (point) placeDrill(point);
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

  // Held Space charges with time; the touch strip sets the power itself.
  if (session.phase === 'charging' && !touchCharging) {
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
  // A drill shows no guide until it is answered, and then the answer: the true
  // ghost ball, the lines to it and on to the pocket, and where the player put
  // theirs with the line it would have sent the object ball on.
  const answered = drill?.result !== undefined;
  scene.guides.setVisible(drill ? answered : aiming);
  if (drill ? answered : aiming) {
    scene.guides.update({
      visibility: drill ? DRILL_ANSWER : campaign.guides,
      cue: session.cueBall.pos,
      aimEnd: drill ? analysis.ghostCenter : add(session.cueBall.pos, fromAngle(session.aimAngle, analysis.cueToGhost)),
      ghost: analysis.ghostCenter,
      object: session.objectBall.pos,
      pocket: session.target,
      placed: placedGhost,
    });
  }

  scene.render({
    balls: session.balls,
    previous: session.previousBalls,
    alpha: session.alpha,
    aimAngle: session.aimAngle,
    power: session.power,
    showCue: aiming && !drill,
    hideBalls: drill?.hidden(clock()) ?? false,
    objectBallNumber,
    shotLength: analysis.cueToGhost + analysis.objectToPocket,
    cueToGhost: analysis.cueToGhost,
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
    aimOverlap: overlapOfLine(),
    call: session.call,
    calling: aiming && !drill && !campaign.guides.readout,
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
    pocketAllowance: campaign.pocketAllowance,
    tierWindow: campaign.tierWindow,
    windowNeeded: ADVANCE_REQUIRED,
    windowSize: ADVANCE_WINDOW,
    attempts: stats.attempts,
    qualified: stats.qualified,
    potted: stats.potted,
    exam: campaign.exam,
    examBest: campaign.examBest,
    practice,
    milestone,
    notice,
    view: scene.view,
    viewingDistance: settings.viewingDistance,
    routine: routine ? { down: routine.down } : null,
    routineLog,
    estimate,
    drill: drillState(),
    outcome: session.outcome,
    history: history.entries,
    tendencies: history.tendencies,
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
    estimate: (said: Estimate | null) => answerEstimate(said),
    callDrill: (fraction: FractionName) => callDrill(fraction),
    placeDrill: (x: number, y: number) => placeDrill({ x, y }),
    ghost: () => session.analysis.ghostCenter,
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
    setView: (view: CameraView) => scene.setView(view),
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
      fieldOfView: scene.fieldOfView,
      viewingDistance: settings.viewingDistance,
      routine: routine ? { down: routine.down, reAims: routine.reAims } : null,
      routineLog,
      estimate,
      drill: drillState(),
      aimAngle: session.aimAngle,
      idealAimAngle: angleOf(session.analysis.aimDirection),
      power: session.power,
      cueSpeed: session.cueSpeed,
      recommendedPower: session.recommendedPower,
      timeScale: settings.timeScale,
      cloth: settings.cloth,
      tendencies: history.tendencies,
      historyLength: history.entries.length,
      shotId: session.layout.id,
      levelId: campaign.level.id,
      tier: campaign.tier,
      call: session.call,
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
