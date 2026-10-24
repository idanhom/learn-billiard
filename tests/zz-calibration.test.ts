/**
 * Measurement harness, not a test: the coupled-calibration list in `CLAUDE.md`,
 * measured in one place, so a physics change re-measures every figure it moves
 * rather than the ones somebody remembered. It asserts nothing and is gated out
 * of the default run — invoke it with
 * `MEASURE=1 npx vitest run tests/zz-calibration.test.ts` when recalibrating,
 * then carry what moved into `README.md`, `TODO.md` and the comments, and
 * `tests/documented-figures.test.ts` will hold them there.
 *
 * Seeded throughout, so two runs of the same code print the same numbers.
 */
import { test } from 'vitest';
import {
  CLOTH_PRESET_IDS,
  MAX_CUE_SPEED,
  MIN_CUE_SPEED,
  POWER_CURVE_EXPONENT,
  ROLLING_FRICTION,
  SLOWEST_CLOTH,
  clothRollingFriction,
} from '../src/constants';
import { idealAimAngle } from '../src/game/drills';
import { potWindow } from '../src/game/pot-window';
import { generateShot } from '../src/game/generator';
import { LEVELS } from '../src/game/levels';
import { cueSpeedForPower, recommendedPower } from '../src/game/power';
import { ShotSession } from '../src/game/shot-session';
import {
  POWER_MARGIN,
  contactState,
  objectDeparture,
  objectRollFraction,
  objectSpeedAfterCut,
  stoppingDistance,
} from '../src/geometry/shot';
import { BALL_RADIUS, PLAY_LENGTH, TABLE } from '../src/geometry/table';
import {
  distanceBetweenSegments,
  distanceToSegment,
  fromAngle,
  len,
  signedAngleBetween,
  vec,
} from '../src/geometry/vec2';
import { type Ball, createBall, simulateToRest, stepWorld } from '../src/physics/world';
import { rollOutSeconds, terminalDrift } from './support/roll-time';
import { straightShot } from './support/shots';

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
const linearMeter = (speed: number): number => (speed - MIN_CUE_SPEED) / (MAX_CUE_SPEED - MIN_CUE_SPEED);

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A square hit from a ROLLING cue ball arriving at `arrival`: object travel over cue travel. */
function squareHitRatio(arrival: number): number {
  const object = createBall(1, vec(-0.9, 0));
  const cue = createBall(0, vec(-0.9 - 2 * BALL_RADIUS - 0.001, 0), vec(arrival, 0), vec(arrival, 0));
  let balls: Ball[] = [cue, object];
  for (let i = 0; i < 240 * 5; i++) {
    const step = stepWorld(balls);
    balls = step.balls;
    if (step.events.some((e) => e.type === 'ball-ball')) break;
  }
  // The cue ball alone from here: above about 1.5 m/s the object ball comes
  // back off the far rail and runs into it, which is not a follow distance.
  const result = simulateToRest([balls[0]!], { maxDuration: 40 });
  const cueTravel = result.balls[0]!.pos.x - balls[0]!.pos.x;
  const struck = balls[1]!;
  // The object ball's run outgrows the table above about 1.2 m/s, so it is read
  // from the closed form, fed the ball's measured post-contact state.
  const objectTravel = stoppingDistance(struck.vel.x, ROLLING_FRICTION, struck.roll.x / struck.vel.x);
  return objectTravel / cueTravel;
}

/** One generated layout, fired perfectly at the recommended power on normal cloth. */
function fireRecommended(layoutSeed: number, levelIndex: number) {
  const level = LEVELS[levelIndex]!;
  const shot = generateShot(level, layoutSeed, { preferredSide: layoutSeed % 2 === 0 ? 'left' : 'right' });
  const session = new ShotSession(shot.layout);
  const power = session.recommendedPower;
  if (power === null) return { potted: false, duration: Number.NaN, settled: false, power };
  session.aimTo(idealAimAngle(shot.layout));
  session.beginCharge();
  session.setPower(power);
  session.release();
  for (let i = 0; i < 60 * 40 && session.phase === 'simulating'; i++) session.advance(1 / 60);
  const outcome = session.evaluate()!;
  return { potted: outcome.pottedTarget, duration: outcome.duration, settled: outcome.settled, power };
}

/**
 * How close a generated layout comes to a pocket's rubber, in centimetres of
 * daylight between ball and facing: the closest of all, then the fifth
 * percentile. Below zero, the generator's mouth zones have let a ball or the
 * cue ball's route into the jaws.
 */
function jawClearance(levelIndex: number): { cuePath: number[]; cueStart: number[]; objectStart: number[] } {
  const level = LEVELS[levelIndex]!;
  const out = { cuePath: [] as number[], cueStart: [] as number[], objectStart: [] as number[] };
  for (let seed = 1; seed <= 200; seed++) {
    const { layout } = generateShot(level, seed, { preferredSide: seed % 2 ? 'left' : 'right' });
    const ghost = new ShotSession(layout).analysis.ghostCenter;
    const nearest = (f: (jaw: (typeof TABLE.jaws)[number]) => number): number =>
      (Math.min(...TABLE.jaws.map(f)) - BALL_RADIUS) * 100;
    out.cuePath.push(nearest((jaw) => distanceBetweenSegments(layout.cue, ghost, jaw.a, jaw.b)));
    out.cueStart.push(nearest((jaw) => distanceToSegment(layout.cue, jaw.a, jaw.b)));
    out.objectStart.push(nearest((jaw) => distanceToSegment(layout.object, jaw.a, jaw.b)));
  }
  return out;
}

/** Scratches and wrong-pocket pots, perfectly aimed, at the recommended power and at a firm 75%. */
function scratches(levelIndex: number): string {
  const level = LEVELS[levelIndex]!;
  const tally = { recommended: [0, 0, 0], firm: [0, 0, 0] };
  for (let seed = 1; seed <= 200; seed++) {
    const { layout } = generateShot(level, seed, { preferredSide: seed % 2 ? 'left' : 'right' });
    for (const stroke of ['recommended', 'firm'] as const) {
      const session = new ShotSession(layout);
      session.aimTo(idealAimAngle(layout));
      session.beginCharge();
      session.setPower(stroke === 'firm' ? 0.75 : session.recommendedPower!);
      session.release();
      for (let i = 0; i < 60 * 40 && session.phase === 'simulating'; i++) session.advance(1 / 60);
      const outcome = session.evaluate()!;
      const row = tally[stroke];
      if (outcome.pottedTarget) row[0]!++;
      if (outcome.scratch) row[1]!++;
      if (outcome.pottedWrong) row[2]!++;
    }
  }
  const [rp, rs, rw] = tally.recommended;
  const [fp, fs, fw] = tally.firm;
  return `potted ${rp}/${fp}  scratched ${rs}/${fs}  wrong pocket ${rw}/${fw}`;
}

/**
 * The pocket a level's layouts leave the aim, in cue-ball degrees either side
 * of the ideal line out to the edge of the pot window, and the share of shots
 * a player whose aim wanders by sigma would qualify with, at the level's
 * allowance. Gaussian, worked out rather than sampled.
 */
function scoring(levelIndex: number): string {
  const level = LEVELS[levelIndex]!;
  const erf = (x: number): number => {
    const t = 1 / (1 + 0.3275911 * Math.abs(x));
    const y =
      1 -
      ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
        t *
        Math.exp(-x * x);
    return x >= 0 ? y : -y;
  };
  const normal = (x: number): number => 0.5 * (1 + erf(x / Math.SQRT2));
  const sigmas = [0.05, 0.1, 0.2, 0.3];
  const rooms: number[] = [];
  const rates = sigmas.map(() => 0);
  const count = 60;
  for (let i = 0; i < count; i++) {
    const { layout } = generateShot(level, 555_000 + i * 7919, { preferredSide: i % 2 ? 'left' : 'right' });
    const analysis = new ShotSession(layout).analysis;
    const pot = potWindow(layout, 'normal', analysis)!;
    const ideal = Math.atan2(analysis.aimDirection.y, analysis.aimDirection.x);
    const used = (offset: number): number => {
      const heading = objectDeparture(layout.cue, layout.object, fromAngle(ideal + offset), analysis.launchSpeed);
      if (heading === undefined) return Number.POSITIVE_INFINITY;
      const turned = signedAngleBetween(fromAngle(pot.ideal), fromAngle(heading));
      return Math.abs(turned) / (turned >= 0 ? pot.counterClockwise : pot.clockwise);
    };
    const edge = (turn: number): number => {
      let inside = 0;
      let outside = turn * 0.01;
      while (used(outside) < level.pocketAllowance) outside *= 2;
      for (let k = 0; k < 40; k++) {
        const middle = (inside + outside) / 2;
        if (used(middle) < level.pocketAllowance) inside = middle;
        else outside = middle;
      }
      return inside;
    };
    const [low, high] = [edge(-1), edge(1)];
    rooms.push((Math.min(-low, high) * 180) / Math.PI);
    sigmas.forEach((sigma, k) => {
      const radians = (sigma * Math.PI) / 180;
      rates[k]! += normal(high / radians) - normal(low / radians);
    });
  }
  rooms.sort((a, b) => a - b);
  const shares = sigmas.map((sigma, k) => `${sigma}: ${pct(rates[k]! / count)}`).join('  ');
  return (
    `allowance ${level.pocketAllowance}  aim room median ${rooms[count / 2]!.toFixed(3)} p10 ` +
    `${rooms[count / 10]!.toFixed(3)} deg  qualify at sigma ${shares}`
  );
}

/**
 * Read from the process. Vitest finds the `import.meta` route to the
 * environment by scanning the source text, and an unrelated change to this
 * file once made the scan miss it, so the harness skipped itself with
 * MEASURE=1 set and printed nothing.
 */
declare const process: { readonly env: Readonly<Record<string, string | undefined>> };

test.runIf(process.env.MEASURE)('the coupled calibration list', () => {
  const out: string[] = [];

  out.push('== roll times (tests/support/roll-time.ts)');
  for (const cloth of CLOTH_PRESET_IDS) {
    out.push(`  ${cloth.padEnd(6)} mu ${clothRollingFriction(cloth)}  table length ${rollOutSeconds(PLAY_LENGTH, clothRollingFriction(cloth)).toFixed(3)} s`);
  }
  out.push(`  down and back, normal       ${rollOutSeconds(2 * PLAY_LENGTH, ROLLING_FRICTION).toFixed(3)} s`);
  out.push(`  published 0.01: length ${rollOutSeconds(PLAY_LENGTH, 0.01).toFixed(3)} s, down and back ${rollOutSeconds(2 * PLAY_LENGTH, 0.01).toFixed(3)} s`);
  const here = terminalDrift(0.2, ROLLING_FRICTION);
  const published = terminalDrift(0.2, 0.01);
  out.push(`  last 0.2 m/s: here ${here.seconds.toFixed(3)} s / ${(here.metres * 100).toFixed(2)} cm, published ${published.seconds.toFixed(3)} s / ${(published.metres * 100).toFixed(2)} cm`);

  out.push('== power meter (POWER_CURVE_EXPONENT)');
  for (const [name, shot] of [['typical 0.6/0.5', straightShot(0.6, 0.5)], ['longest 1.4/1.5', straightShot(1.4, 1.5)]] as const) {
    const power = recommendedPower(shot, ROLLING_FRICTION);
    const speed = power === null ? Number.NaN : cueSpeedForPower(power);
    out.push(`  ${name}: ${speed.toFixed(3)} m/s, linear ${pct(linearMeter(speed))}, curved ${power === null ? 'none' : pct(power)}`);
  }
  {
    const typical = straightShot(0.6, 0.5);
    const exponentFor = (mu: number): number => {
      const power = recommendedPower(typical, mu)!;
      return Math.log(linearMeter(cueSpeedForPower(power))) / Math.log(0.4);
    };
    out.push(`  exponent that puts the typical pot at 40%: ${exponentFor(ROLLING_FRICTION).toFixed(4)} (set: ${POWER_CURVE_EXPONENT}); at mu 0.010: ${exponentFor(0.01).toFixed(4)}`);
  }

  out.push('== recommended power per level, 200 layouts each, normal cloth');
  for (const level of LEVELS) {
    const powers: number[] = [];
    let missing = 0;
    for (let seed = 0; seed < 200; seed++) {
      const { layout } = generateShot(level, 50_000 + seed * 7919, { preferredSide: seed % 2 === 0 ? 'left' : 'right' });
      const power = new ShotSession(layout).recommendedPower;
      if (power === null) missing++;
      else powers.push(power);
    }
    out.push(`  L${level.id} min ${pct(Math.min(...powers))}  median ${pct(median(powers))}  max ${pct(Math.max(...powers))}  none ${missing}`);
  }

  out.push('== template fallback and isPowerFeasible headroom, 1500 layouts each, slowest cloth');
  const slowest = clothRollingFriction(SLOWEST_CLOTH);
  for (const level of LEVELS) {
    let fallbacks = 0;
    let maxCut = 0;
    let tightest = Number.POSITIVE_INFINITY;
    for (let seed = 0; seed < 1500; seed++) {
      const shot = generateShot(level, seed, { preferredSide: seed % 2 === 0 ? 'left' : 'right' });
      if (shot.fromTemplate) fallbacks++;
      const { cutAngle: cut, objectToPocket, cueToGhost } = new ShotSession(shot.layout).analysis;
      const contact = contactState(MAX_CUE_SPEED, cueToGhost, slowest);
      const reach = stoppingDistance(
        objectSpeedAfterCut(contact.speed, cut),
        slowest,
        objectRollFraction(cut, contact.speed, contact.rollFraction),
      );
      const asked = objectToPocket * POWER_MARGIN;
      maxCut = Math.max(maxCut, (cut * 180) / Math.PI);
      tightest = Math.min(tightest, reach / asked);
    }
    out.push(`  L${level.id} ${level.name.padEnd(20)} fallback ${pct(fallbacks / 1500).padStart(6)}  max cut ${maxCut.toFixed(1)} deg  tightest headroom ${tightest.toFixed(2)}x`);
  }

  out.push('== square hit from a rolling cue ball: object travel / cue travel');
  for (const arrival of [0.5, 0.787, 1.2, 1.55, 2.5]) {
    out.push(`  at ${arrival.toFixed(3)} m/s: ${squareHitRatio(arrival).toFixed(3)}x`);
  }

  out.push('== recommended power, fired perfectly: pot rate and shot length, 60 layouts per level');
  for (let index = 0; index < LEVELS.length; index++) {
    const shots = Array.from({ length: 60 }, (_, i) => fireRecommended(90_000 + i * 104729, index));
    const durations = shots.map((s) => s.duration).filter(Number.isFinite);
    out.push(
      `  L${LEVELS[index]!.id} potted ${shots.filter((s) => s.potted).length}/60  ` +
        `shot median ${median(durations).toFixed(2)} s  longest ${Math.max(...durations).toFixed(2)} s  ` +
        `cut short ${shots.filter((s) => !s.settled).length}`,
    );
  }

  out.push('== pockets: daylight to the jaws (cm, closest and 5th percentile), 200 layouts per level');
  for (let index = 0; index < LEVELS.length; index++) {
    const clearance = jawClearance(index);
    const fmt = (v: number[]): string => {
      const sorted = [...v].sort((a, b) => a - b);
      return `${sorted[0]!.toFixed(1)}, ${sorted[Math.floor(sorted.length * 0.05)]!.toFixed(1)}`;
    };
    out.push(
      `  L${LEVELS[index]!.id} cue path ${fmt(clearance.cuePath)}  cue ball ${fmt(clearance.cueStart)}  ` +
        `object ball ${fmt(clearance.objectStart)}`,
    );
  }

  out.push('== pockets: perfectly aimed, at the recommended power / at 75%, 200 layouts per level');
  for (let index = 0; index < LEVELS.length; index++) {
    out.push(`  L${LEVELS[index]!.id} ${scratches(index)}`);
  }

  out.push('== scoring: aim room to the allowed share of the pot window, 60 layouts per level, normal cloth');
  for (let index = 0; index < LEVELS.length; index++) {
    out.push(`  L${LEVELS[index]!.id} ${scoring(index)}`);
  }

  // Half a millimetre from the rail, so the cloth has no time to change the
  // spin on the way in: a stun ball that slid 6 cm first arrives half-rolling.
  out.push('== cushion, square hit at 1.0 m/s at the rail');
  for (const [name, roll] of [['rolling', 1], ['stun', 0], ['draw', -0.5]] as const) {
    let balls: Ball[] = [createBall(0, vec(0.4, TABLE.bounds.maxY - 0.0005), vec(0, 1), vec(0, roll))];
    let before = balls;
    for (let i = 0; i < 240; i++) {
      before = balls;
      const next = stepWorld(balls);
      balls = next.balls;
      if (next.events.some((e) => e.type === 'cushion')) break;
    }
    const inSpeed = len(before[0]!.vel);
    const off = len(balls[0]!.vel) / inSpeed;
    const settledSpeed = len(vec((5 * balls[0]!.vel.x + 2 * balls[0]!.roll.x) / 7, (5 * balls[0]!.vel.y + 2 * balls[0]!.roll.y) / 7));
    out.push(`  ${name.padEnd(8)} straight off ${off.toFixed(3)}  settled ${(settledSpeed / inSpeed).toFixed(3)}`);
  }

  console.log(out.join('\n'));
}, 600_000);
