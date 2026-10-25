/**
 * Wiring and the game loop.
 *
 * Frame deltas are clamped and physics catch-up is bounded inside ShotSession,
 * so a stalled tab resumes rather than fast-forwarding through a shot. The
 * renderer interpolates between the last two physics states.
 */

import { type ClothPreset, MAX_TIP_OFFSET, clothRollingFriction } from './constants';
import { formatDiamonds } from './geometry/diamonds';
import { FRACTIONS, type FractionName } from './geometry/fractions';
import { firstTouch, fullness as fullnessOf, speedForStoppingDistance } from './geometry/shot';
import { type Vec2, add, angleOf, dist, fromAngle, signedAngleBetween } from './geometry/vec2';
import { Campaign, type CampaignEvent } from './game/campaign';
import { attachAimButtons, attachInput, attachTouchPower } from './game/input';
import { powerForCueSpeed, speedBand } from './game/power';
import { browserStorage, createProgressStore } from './game/progress-store';
import { createSettingsStore, nextCloth, nextTimeScale, stepViewingDistance } from './game/settings-store';
import { ShotHistory, signedShare } from './game/shot-history';
import { MAX_FRAME_DT, ShotSession, type ShotOutcome } from './game/shot-session';
import { ESTIMATES, type Estimate, estimateOf } from './game/estimate';
import { DepartureDrill, departureOf, strikeFor } from './game/departure';
import { pocketName } from './game/drill-sheet';
import { PerceptionDrill } from './game/perception';
import { type PositionResult, ZONE_RADIUS, scorePosition, zoneCentre } from './game/position';
import { type SpeedResult, scoreSpeed } from './game/speed';
import { type KickResult, type SafetyResult, kickResult, safetyResult } from './game/kicks';
import { potWindow } from './game/pot-window';
import { COACH_AIM_TOLERANCE, Coach } from './game/coach';
import { MASTERED_AT, MASTERY_STANDARD, MASTERY_WINDOW } from './game/mastery';
import { Routine } from './game/routine';
import { createTableLogStore } from './game/table-log';
import { ADVANCE_REQUIRED, ADVANCE_WINDOW, FINAL_TIER, type GuideVisibility } from './game/tiers';
import type { LevelDefinition } from './game/levels';
import { ballNumberFor } from './scene/ball-textures';
import { type CameraView, PoolScene } from './scene/pool-scene';
import { Hud, type HudState, type Milestone, type Notice } from './ui/hud';
import { TablePanel } from './ui/table-panel';
import { TableAudio } from './scene/audio';

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
const tablePanel = new TablePanel(document.getElementById('app') as HTMLElement, {
  onClose: () => canvas.focus(),
  settings: () => settings,
  onSetCloth: (cloth) => setCloth(cloth),
  onSetTableFeet: (tableFeet) => {
    settings = { ...settings, tableFeet };
    settingsStore.save(settings);
  },
  fractionMisses: () => campaign.fractionMisses,
  log: createTableLogStore(browserStorage()),
});

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
  onToggleSound: () => toggleSound(),
  onReplay: () => startReplay(),
  onToggleAutoNext: () => toggleAutoNext(),
  onSkipCoaching: () => skipCoaching(),
  onTip: (steps) => changeTip(steps),
  onToggleContrast: () => toggleContrast(),
  returnFocus: () => canvas.focus(),
  onOpenTable: () => tablePanel.toggle(),
});

const settingsStore = createSettingsStore(browserStorage());
const history = new ShotHistory();

// Load one complete settings object before anything reads a preference, so the
// first session is built on the cloth the player actually chose.
let settings = settingsStore.load();
scene.setViewingDistance(settings.viewingDistance);
const audio = new TableAudio(settings.sound);
scene.guides.setContrast(settings.highContrast);
// Less motion when the system asks for it, and as soon as it does.
const lessMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
scene.setReducedMotion(lessMotion?.matches ?? false);
lessMotion?.addEventListener('change', (event) => scene.setReducedMotion(event.matches));
/** Three coached shots on a first launch: nothing played, and the coaching not yet done or skipped. */
const coach = new Coach(!settings.coached && campaign.isFresh);

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
/** How many of the session's events have been sounded. */
let heard = 0;
/** On a level about the cue ball: the prediction for the layout in play. */
let departure: DepartureDrill | undefined;
/** The view to go back to after a cue-ball result was shown from overhead. */
let viewBeforeResult: CameraView | undefined;
/**
 * Where the tip strikes, up the ball as a fraction of its radius: the
 * player's on the position levels, kept from shot to shot there, and centre
 * everywhere else, where the aim is what is scored.
 */
let tip = 0;
let tipLevel = campaign.level.id;
const TIP_STEP = 0.1;
/** On a position level, where the cue ball stopped against the spot. */
let positionResult: PositionResult | undefined;
/** On a speed level, where the cue ball stopped against the ring. */
let speedResult: SpeedResult | undefined;
/** On the patterns level, how the run stood after the last shot. */
let patternNews: CampaignEvent['pattern'];
/** On a kick or a safety, how it went. */
let taskResult: { readonly kind: 'kick'; readonly result: KickResult } | { readonly kind: 'safety'; readonly result: SafetyResult } | undefined;
/**
 * The shot just played, being shown again from overhead at a quarter speed:
 * its own session, how much of it has sounded, and the view to go back to.
 */
let replay: { readonly session: ShotSession; readonly view: CameraView; heard: number } | undefined;
const REPLAY_SPEED = 0.25;
/**
 * When the report of the shot in play went up, for dealing the next one by
 * itself; null when there is nothing to count down from, or the player has
 * taken it over by replaying the shot.
 */
let reportShownAt: number | null = null;
const AUTO_NEXT_SECONDS = 3;
let session = newSession();
/**
 * What the shot in play is scored on, as it was dealt. The campaign deals
 * what comes next as soon as a run or a level ends, behind the summary card,
 * and the shot just played is still reported as the kind it was.
 */
let dealt = dealtAs();
routine = routineActive() ? new Routine(clock()) : undefined;
drill = newDrill();
departure = newDeparture();
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
  setCloth(nextCloth(settings.cloth));
}

function setCloth(cloth: ClothPreset): void {
  if (session.phase === 'simulating') return;
  settings = { ...settings, cloth };
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

/** As far as the aim line runs: to the ghost ball, or on its own to the ring, or up the table for the lag. */
function aimLineLength(): number {
  const spot = session.layout.spot;
  if (session.layout.mirror) return Math.min(1.2, dist(session.layout.cue, session.layout.mirror));
  if (dealt.scoring?.kind === 'safety') return 0.8;
  if (!spot) return session.analysis.cueToGhost;
  return dealt.speed?.target === 'lag' ? 1 : dist(session.layout.cue, spot);
}

/** A kick or a safety as the HUD shows it: which, and once played, its verdict. */
function taskState(): HudState['task'] {
  const kind = dealt.scoring?.kind;
  if (kind !== 'kick' && kind !== 'safety') return null;
  return { kind, verdict: taskResult ? taskVerdict(taskResult) : null };
}

function taskVerdict(task: NonNullable<typeof taskResult>): { readonly text: string; readonly good: boolean; readonly why: string } {
  if (task.kind === 'kick') {
    switch (task.result) {
      case 'kicked':
        return { text: 'Kicked it', good: true, why: 'Off the cushion, then the object ball.' };
      case 'no-cushion':
        return { text: 'No cushion first', good: false, why: 'It met the object ball before any cushion.' };
      case 'other-ball':
        return { text: 'Hit the wrong ball', good: false, why: 'Another ball came first.' };
      case 'missed':
        return { text: 'Missed it', good: false, why: 'The cue ball never reached the object ball.' };
    }
  }
  switch (task.result.kind) {
    case 'safe':
      return { text: 'Safe', good: true, why: 'No direct pot left, at any pocket.' };
    case 'pot-left':
      return { text: 'A pot left', good: false, why: `There is a direct pot to the ${pocketName(task.result.pocket)}.` };
    case 'potted':
      return { text: 'Potted it', good: false, why: 'A safety leaves the ball up.' };
    case 'scratch':
      return { text: 'Scratch', good: false, why: 'The cue ball went in.' };
    case 'foul':
      return { text: 'Foul', good: false, why: 'The object ball has to be hit first.' };
  }
}

/** A speed drill as the HUD shows it. */
function speedState(): HudState['speed'] {
  const speed = dealt.speed;
  if (!speed) return null;
  return { ...speed, result: speedResult ?? null };
}

/** A position shot as the HUD shows it: what it asks, and how it went. */
function positionState(): HudState['position'] {
  const position = dealt.position;
  if (!position) return null;
  return { ...position, result: positionResult ?? null };
}

/** A cue-ball prediction as the HUD shows it. */
function departureState(): HudState['departure'] {
  if (!departure) return null;
  const scoring = dealt.scoring;
  const stage = departure.result ? 'answered' : departure.predicted ? 'playing' : 'asking';
  const allowance = scoring?.kind === 'departure' ? scoring.allowance : 0;
  return { stroke: departure.stroke, stage, result: departure.result ?? null, allowance };
}

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
  // The levels about the cue ball use their tiers as rungs, not for taking guides away.
  if (dealt.scoring) return false;
  const level = campaign.level;
  return level.exam || level.daily === true || level.assessment === true || campaign.tier === FINAL_TIER;
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
  if (departure) {
    announce('This shot is struck for you: click where the cue ball goes.');
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

function dealtAs(): { readonly position: Campaign['position']; readonly speed: Campaign['speed']; readonly scoring: Campaign['shotScoring'] } {
  return { position: campaign.position, speed: campaign.speed, scoring: campaign.shotScoring };
}

function newSession(): ShotSession {
  return new ShotSession(campaign.layout, {
    pocketAllowance: campaign.pocketAllowance,
    cloth: settings.cloth,
    aimSeed: seed + sessionsDealt++,
  });
}

function startShot(): void {
  stopReplay();
  reportShownAt = null;
  coach.dealt();
  session = newSession();
  dealt = dealtAs();
  practice = campaign.retrying;
  milestone = undefined;
  objectBallNumber = ballNumberFor(session.layout.id);
  chargeSeconds = 0;
  routine = routineActive() ? new Routine(clock()) : undefined;
  routineLog = null;
  estimate = null;
  drill = newDrill();
  placedGhost = undefined;
  heard = 0;
  departure = newDeparture();
  positionResult = undefined;
  speedResult = undefined;
  patternNews = undefined;
  taskResult = undefined;
  if (campaign.level.id !== tipLevel) {
    tip = 0;
    tipLevel = campaign.level.id;
  }
  if (tipAllowed()) session.setTip(tip);
  if (viewBeforeResult) {
    scene.setView(viewBeforeResult);
    viewBeforeResult = undefined;
  }
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

function tipAllowed(): boolean {
  const kind = dealt.scoring?.kind;
  return kind === 'position' || kind === 'zone' || kind === 'pattern';
}

/** Where a shot played for position asks the cue ball to stop, and how near counts. */
function positionSpot(position: NonNullable<Campaign['position']>): { readonly centre: Vec2; readonly radius: number } {
  const { layout } = session;
  if (position.target === 'zone') return { centre: layout.spot!, radius: layout.spotRadius ?? ZONE_RADIUS };
  return { centre: zoneCentre(position.target, position.distance, layout.cue, session.analysis.ghostCenter), radius: ZONE_RADIUS };
}

/** Up and down: the tip a step up the ball for follow, or down it for draw. */
function changeTip(steps: number): void {
  if (!tipAllowed()) {
    announce('Centre ball here: the tip moves on the stop, follow and draw levels.');
    return;
  }
  if (session.phase !== 'aiming') return;
  tip = Math.round(Math.min(MAX_TIP_OFFSET, Math.max(-MAX_TIP_OFFSET, tip + steps * TIP_STEP)) * 10) / 10;
  session.setTip(tip);
}

/** On a level about the cue ball, a prediction to make for the layout in play. */
function newDeparture(): DepartureDrill | undefined {
  const scoring = dealt.scoring;
  if (scoring?.kind !== 'departure') return undefined;
  return new DepartureDrill(scoring.stroke, session.analysis.ghostCenter, scoring.allowance);
}

/**
 * The player says the cue ball goes through `point`, and the shot is played
 * for them: on the ideal line, struck as the level's stroke has it.
 */
function predictDeparture(point: Vec2): void {
  if (!departure || session.phase !== 'aiming' || !departure.predict(point)) return;
  const { speed, tip } = strikeFor(departure.stroke, session.analysis.cueToGhost, clothRollingFriction(settings.cloth));
  session.aimTo(angleOf(session.analysis.aimDirection));
  session.setTip(tip);
  session.beginCharge();
  session.setPower(powerForCueSpeed(speed));
  if (session.release()) released();
}

/** Where the cue ball went, against the prediction: scored like a shot, but never on the aim. */
function recordDeparture(outcome: ShotOutcome, prediction: DepartureDrill): void {
  evaluations++;
  reportShownAt = clock();
  const after = session.afterContact;
  const actual = after ? departureOf(after, prediction.stroke, settings.cloth) : undefined;
  if (actual && after) {
    // The rule's own angle: off the object ball's line when stunned, off its own line when rolling.
    const against = prediction.stroke === 'stun' ? after[1]!.vel : session.analysis.aimDirection;
    prediction.score(actual, (Math.abs(signedAngleBetween(actual, against)) * 180) / Math.PI);
  }
  const level = campaign.level;
  handleEvent(campaign.record({ qualifying: prediction.result?.correct ?? false, pottedTarget: outcome.pottedTarget }), level);
  // The answer is the two lines from the ghost ball, which read from above.
  if (scene.view !== 'overhead') {
    viewBeforeResult = scene.view;
    scene.setView('overhead');
  }
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
  reportShownAt = clock();
  const level = campaign.level;
  handleEvent(campaign.record({ qualifying: correct, pottedTarget: false }), level);
}

/** The player's read of their own miss, or null to skip it; then the report shows. */
function answerEstimate(said: Estimate | null): void {
  if (!estimate?.asking) return;
  estimate = { ...estimate, asking: false, said };
  reportShownAt = clock();
}

/** The shot, or the drill, is done and reported: Space, Enter or the countdown move on. */
function readyForNext(): boolean {
  if (estimate?.asking) return false;
  if (drill) return drill.result !== undefined;
  return session.phase === 'evaluated';
}

/** How long until the next shot deals itself, or null when it will not. */
function autoNextIn(): number | null {
  if (!settings.autoNext || reportShownAt === null || milestone || replay || tablePanel.isOpen || !readyForNext()) {
    return null;
  }
  return Math.max(0, AUTO_NEXT_SECONDS - (clock() - reportShownAt));
}

function toggleAutoNext(): void {
  settings = { ...settings, autoNext: !settings.autoNext };
  settingsStore.save(settings);
  reportShownAt = readyForNext() ? clock() : null;
  announce(settings.autoNext ? 'The next shot deals itself after the report.' : 'The next shot waits for you.');
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
  // Choosing a level is knowing your way about: the coaching goes.
  if (coach.active) skipCoaching();
  notice = undefined;
  // A tendency measured on straight-ins says nothing about thin cuts, so the
  // calibration starts afresh with the level.
  history.clear();
  startShot();
  canvas.focus();
}

/** The cue ball alone: scored on where it stopped, and on the cushions it touched. */
function recordSpeed(speed: NonNullable<Campaign['speed']>): void {
  evaluations++;
  reportShownAt = clock();
  const cushions = session.events.filter((event) => event.type === 'cushion' && event.ball === 0).length;
  speedResult = scoreSpeed(speed.target, session.cueBall.pos, session.layout, cushions);
  const level = campaign.level;
  handleEvent(campaign.record({ qualifying: speedResult.correct, pottedTarget: false }), level);
}

/** A kick or a safety: scored on the cue ball's contacts, and for a safety where everything stopped. */
function recordTask(kind: 'kick' | 'safety'): void {
  evaluations++;
  reportShownAt = clock();
  const [cue, object, ...others] = session.balls;
  if (kind === 'kick') {
    taskResult = { kind, result: kickResult(session.events) };
  } else {
    const standing = others.filter((ball) => !ball.potted).map((ball) => ball.pos);
    taskResult = { kind, result: safetyResult(session.events, cue!, object!, standing) };
  }
  const made = taskResult.kind === 'kick' ? taskResult.result === 'kicked' : taskResult.result.kind === 'safe';
  const level = campaign.level;
  handleEvent(campaign.record({ qualifying: made, pottedTarget: false }), level);
}

function recordOutcome(outcome: ShotOutcome): void {
  if (departure) return recordDeparture(outcome, departure);
  const kind = dealt.scoring?.kind;
  if (kind === 'kick' || kind === 'safety') return recordTask(kind);
  const speed = dealt.speed;
  if (speed) return recordSpeed(speed);
  evaluations++;
  const level = campaign.level;
  // On a position level the shot is scored on the pot and where the cue ball stopped.
  const position = dealt.position;
  if (position) {
    const { cue } = session.layout;
    const ghost = session.analysis.ghostCenter;
    const { centre, radius } = positionSpot(position);
    // A zone is judged on distance alone; long and wide follow the stop shot's line.
    const target = position.target === 'zone' ? 'stop' : position.target;
    positionResult = scorePosition(target, session.cueBall.pos, centre, cue, ghost, outcome.pottedTarget, outcome.scratch, radius);
  }
  // Once the ghost ball has gone, the player says how they hit it before the
  // report says. Judged on the tier the shot was played at.
  if (!dealt.scoring && (level.exam || level.daily || campaign.tier >= 2) && outcome.pocketUsed !== null) {
    const actual = estimateOf(signedShare(outcome.pocketUsed, outcome.aimError.side));
    estimate = { asking: true, said: null, actual, straight: outcome.cutSide === 'straight' };
  }
  if (!estimate?.asking) reportShownAt = clock();
  if (coach.active && coach.scored()) coachingDone();
  // A shot played without the ghost ball counts toward mastery of its band.
  const scored = positionResult
    ? { ...outcome, qualifying: positionResult.correct }
    : campaign.guides.ghostBall
      ? outcome
      : {
          ...outcome,
          mastery: {
            cutDegrees: (outcome.cutAngle * 180) / Math.PI,
            onStandard: outcome.pocketUsed !== null && outcome.pocketUsed <= MASTERY_STANDARD,
          },
        };
  // Where the cue ball stopped is where a pattern's next shot is played from.
  const event = campaign.record({ ...scored, cueRest: session.cueBall.pos });
  patternNews = event.pattern;
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
  } else if (event.dailyFinished) {
    milestone = { kind: 'daily-finished', ...event.dailyFinished };
  } else if (event.assessmentFinished) {
    milestone = { kind: 'assessment-finished', ...event.assessmentFinished };
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
  if (event.mastered) {
    announce(
      `Mastered: ${event.mastered} cuts. ${MASTERED_AT * MASTERY_WINDOW} of your last ${MASTERY_WINDOW} unguided ` +
        `shots there used ${Math.round(MASTERY_STANDARD * 100)}% of the pocket or less.`,
    );
  }
}

/** The stroke has gone: note how the routine went, for the report. */
function released(): void {
  if (routine) routineLog = { seconds: routine.elapsed(clock()), reAims: routine.reAims };
  audio.strike(session.cueSpeed);
}

/**
 * P: the shot just played, again. The solver runs on a fixed tick, so the
 * same aim and power on the same layout and cloth is the same shot, whatever
 * the frame rate. Not while the self-estimate asks, which it would answer.
 */
function startReplay(): void {
  if (session.phase !== 'evaluated' || replay || estimate?.asking) return;
  const again = new ShotSession(session.layout, { pocketAllowance: session.pocketAllowance, cloth: session.cloth });
  again.aimTo(session.aimAngle);
  again.beginCharge();
  again.setPower(session.power);
  again.release();
  replay = { session: again, view: scene.view, heard: 0 };
  reportShownAt = null;
  scene.setView('overhead');
  audio.strike(again.cueSpeed);
}

function stopReplay(): void {
  if (!replay) return;
  scene.setView(replay.view);
  replay = undefined;
}

/** The coaching is over, played through or skipped, and is not offered again. */
function skipCoaching(): void {
  coach.skip();
  coachingDone();
}

function coachingDone(): void {
  settings = { ...settings, coached: true };
  settingsStore.save(settings);
}

/** The guides solid, brighter and thicker, or as they were. */
function toggleContrast(): void {
  settings = { ...settings, highContrast: !settings.highContrast };
  settingsStore.save(settings);
  scene.guides.setContrast(settings.highContrast);
  announce(settings.highContrast ? 'High-contrast guides.' : 'Guides as usual.');
}

/** M: the table's sounds on or off. */
function toggleSound(): void {
  settings = { ...settings, sound: !settings.sound };
  settingsStore.save(settings);
  audio.enabled = settings.sound;
  announce(settings.sound ? 'Sound on.' : 'Sound off.');
}

attachInput(canvas, {
  onNudgeAim: nudgeAim,
  onChargeStart() {
    // Space after a shot is done deals the next one.
    if (readyForNext()) return nextShot();
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
  onToggleSound: toggleSound,
  onReplay: startReplay,
  onTip: changeTip,
  onAdvance: () => {
    if (readyForNext()) nextShot();
  },
  onDismiss: () => (replay ? stopReplay() : answerEstimate(null)),
  onOpenTable: () => tablePanel.open(),
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
  if (departure && !departure.predicted) {
    const point = scene.pickTable(event.clientX, event.clientY);
    if (point) predictDeparture(point);
    return;
  }
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

  if (replay) {
    replay.session.advance(dt * REPLAY_SPEED);
    for (; replay.heard < replay.session.events.length; replay.heard++) audio.event(replay.session.events[replay.heard]!);
    if (replay.session.phase === 'settled') stopReplay();
  } else {
    session.advance(dt * settings.timeScale);
    // Each contact sounds once, as the simulation reaches it.
    for (; heard < session.events.length; heard++) audio.event(session.events[heard]!);
    if (session.phase === 'settled') {
      const outcome = session.evaluate();
      if (outcome) recordOutcome(outcome);
    }
  }
  const shown = replay?.session ?? session;
  if (autoNextIn() === 0) nextShot();
  // The spot a position shot or a speed drill asks for, from the deal to the report.
  const position = dealt.position;
  if (position) {
    const { centre, radius } = positionSpot(position);
    scene.zone.show(centre, radius);
  } else if (session.layout.spot) {
    scene.zone.show(session.layout.spot, ZONE_RADIUS);
  } else {
    scene.zone.hide();
  }
  if (coach.step === 'aim' && Math.abs(signedAngleBetween(fromAngle(session.aimAngle), session.analysis.aimDirection)) < COACH_AIM_TOLERANCE) {
    coach.aimed();
  }

  // Once a shot is scored, where the balls went, beside the line it needed.
  // Not while the self-estimate asks, since the line would answer it.
  if (session.phase === 'evaluated' && !replay && !estimate?.asking) {
    // The line the object ball needed, where the shot was a pot.
    const kind = dealt.scoring?.kind;
    const notAPot = session.layout.objectAway || kind === 'kick' || kind === 'safety';
    scene.trails.show(session.trails, notAPot ? undefined : { from: session.layout.object, to: session.target });
  } else {
    scene.trails.hide();
  }

  const analysis = session.analysis;
  // Guides are for aiming. Once the cue is away they are just clutter over the
  // thing the player should be watching — and there is no point placing lines
  // nobody can see, so the update goes with the visibility.
  const aiming = session.phase === 'aiming' || session.phase === 'charging';
  // A drill shows no guide until it is answered, and then the answer: the true
  // ghost ball, the lines to it and on to the pocket, and where the player put
  // theirs with the line it would have sent the object ball on.
  // A shot played for the player stays drawn from the deal to the report,
  // with the line they said the cue ball would take once they have said it.
  const answered = drill?.result !== undefined;
  const guided = drill ? answered : aiming || (departure !== undefined && !replay);
  scene.guides.setVisible(guided);
  if (guided) {
    scene.guides.update({
      visibility: drill ? DRILL_ANSWER : campaign.guides,
      cue: session.layout.cue,
      aimEnd:
        drill || departure
          ? analysis.ghostCenter
          : add(session.cueBall.pos, fromAngle(session.aimAngle, aimLineLength())),
      ghost: analysis.ghostCenter,
      object: session.layout.object,
      pocket: session.target,
      placed: placedGhost,
      // The reflection to aim a kick at, while the tier still shows the line.
      mirror: campaign.tier === 0 ? session.layout.mirror : undefined,
      predicted: departure?.predicted ? { from: analysis.ghostCenter, direction: departure.predicted } : undefined,
    });
  }

  scene.render({
    balls: shown.balls,
    previous: shown.previousBalls,
    alpha: shown.alpha,
    aimAngle: session.aimAngle,
    power: session.power,
    showCue: aiming && !drill && !departure,
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
    // Not while a drill is unanswered: after a flash, they would put the balls back.
    diamonds:
      drill && !drill.result
        ? null
        : {
            cue: formatDiamonds(session.layout.cue),
            object: formatDiamonds(session.layout.objectAway ? session.layout.spot! : session.layout.object),
            second: session.layout.objectAway ? 'ring' : 'object',
          },
    call: session.call,
    calling: aiming && !drill && !campaign.guides.readout,
    guides: campaign.guides,
    tier: campaign.tier,
    tierComplete: campaign.levelCompleted,
    levelName: campaign.level.name,
    levelDescription: campaign.level.description,
    bands: campaign.bands,
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
    daily: campaign.daily ?? null,
    assessment: campaign.assessment ?? null,
    daysPractised: campaign.daysPractised,
    practice,
    milestone,
    notice,
    view: scene.view,
    viewingDistance: settings.viewingDistance,
    sound: settings.sound,
    highContrast: settings.highContrast,
    replaying: replay !== undefined,
    coach: coach.active ? coach.step : null,
    autoNext: settings.autoNext,
    autoNextIn: (() => {
      const left = autoNextIn();
      return left === null ? null : Math.ceil(left);
    })(),
    routine: routine ? { down: routine.down } : null,
    routineLog,
    estimate,
    drill: drillState(),
    departure: departureState(),
    tip: tipAllowed() ? tip : null,
    position: positionState(),
    speed: speedState(),
    pattern: campaign.pattern ?? null,
    patternNews: patternNews ?? null,
    task: taskState(),
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
      if (!session.release()) return false;
      released();
      return true;
    },
    retry,
    next: nextShot,
    estimate: (said: Estimate | null) => answerEstimate(said),
    sounds: () => ({ ...audio.asked }),
    replay: startReplay,
    toggleAutoNext,
    skipCoaching,
    toggleContrast,
    toggleSound,
    callDrill: (fraction: FractionName) => callDrill(fraction),
    placeDrill: (x: number, y: number) => placeDrill({ x, y }),
    predictDeparture: (x: number, y: number) => predictDeparture({ x, y }),
    // For a speed drill: struck at just the speed that stops the ball on the ring.
    fireToSpot: () => {
      const spot = session.layout.spot;
      if (!spot || !session.beginCharge()) return false;
      session.setPower(powerForCueSpeed(speedForStoppingDistance(dist(session.layout.cue, spot), clothRollingFriction(settings.cloth))));
      if (!session.release()) return false;
      released();
      return true;
    },
    changeTip,
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
    setRoom: (visible: boolean) => {
      scene.room.group.visible = visible;
    },
    renderInfo: () => ({ ...scene.renderInfo, bake: scene.room.bakeMilliseconds }),
    pixel: (x: number, y: number) => scene.sample(x, y),
    timeRenders: (count: number) => scene.timeRenders(count),
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
      room: { visible: scene.room.group.visible },
      viewingDistance: settings.viewingDistance,
      routine: routine ? { down: routine.down, reAims: routine.reAims } : null,
      routineLog,
      estimate,
      drill: drillState(),
      departure: departureState(),
      tip: session.tip,
      position: positionState(),
      speed: speedState(),
      pattern: campaign.pattern ?? null,
      patternNews: patternNews ?? null,
      task: taskState(),
      replaying: replay !== undefined,
      scoring: dealt.scoring?.kind ?? null,
      mirror: session.layout.mirror ?? null,
      coach: coach.active ? coach.step : null,
      highContrast: settings.highContrast,
      reducedMotion: scene.reducedMotion,
      trails: session.trails.map((trail) => trail.length),
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
      bands: campaign.bands,
      call: session.call,
      tierComplete: campaign.levelCompleted,
      guides: campaign.guides,
      stats: campaign.stats,
      exam: campaign.exam ?? null,
      examBest: campaign.examBest,
      daily: campaign.daily ?? null,
      assessment: campaign.assessment ?? null,
      daysPractised: campaign.daysPractised,
      notice: notice?.text ?? null,
      evaluations,
      practice,
      milestone: milestone ?? null,
      outcome: session.outcome ?? null,
    }),
  };
}
