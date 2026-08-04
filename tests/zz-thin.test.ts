/**
 * Measurement harness, not a test: fires generated layouts at the recommended
 * power and tabulates the cue ball's life after contact, per level. It asserts
 * nothing and costs ~18 s, so it is gated out of the default run — invoke it
 * with `MEASURE=1 npx vitest run tests/zz-thin.test.ts` when recalibrating.
 */
import { test } from 'vitest';
import { ROLLING_FRICTION, clothRollingFriction } from '../src/constants';
import { idealAimAngle } from '../src/game/drills';
import { generateShot } from '../src/game/generator';
import { LEVELS, levelById } from '../src/game/levels';
import { cueSpeedForPower, recommendedPower } from '../src/game/power';
import { analyseShot } from '../src/geometry/shot';
import { pocketById } from '../src/geometry/table';
import { dist, fromAngle, len } from '../src/geometry/vec2';
import { TICK, createBall, stepWorld } from '../src/physics/world';

/** Fire one generated layout at the recommended power; report the cue ball's life after contact. */
function fire(levelId: number, seed: number) {
  const level = levelById(levelId);
  const g = generateShot(level, seed);
  if (g.fromTemplate) return undefined;
  const layout = g.layout;
  const analysis = analyseShot({
    cue: layout.cue,
    object: layout.object,
    pocket: pocketById(layout.targetPocket),
    obstacles: [],
  });
  const power = recommendedPower(analysis, ROLLING_FRICTION);
  if (power === null) return undefined;

  const speed = cueSpeedForPower(power);
  let balls = [
    createBall(0, layout.cue, fromAngle(idealAimAngle(layout), speed)),
    createBall(1, layout.object),
  ];

  let contacted = false;
  let exitSpeed = 0;
  let path = 0;
  let seconds = 0;
  let slowSeconds = 0;
  let slowPath = 0;
  let rails = 0;
  let total = 0;

  for (let i = 0; i < 240 * 25; i++) {
    const before = balls;
    const step = stepWorld(balls);
    balls = step.balls;
    total += TICK;
    if (!contacted && step.events.some((e) => e.type === 'ball-ball')) {
      contacted = true;
      exitSpeed = len(balls[0]!.vel);
      continue;
    }
    if (contacted) {
      if (step.events.some((e) => e.type === 'cushion' && e.ball === 0)) rails++;
      const moved = dist(before[0]!.pos, balls[0]!.pos);
      path += moved;
      if (len(before[0]!.vel) > 0) seconds += TICK;
      if (len(before[0]!.vel) > 0 && len(before[0]!.vel) < 0.5) {
        slowSeconds += TICK;
        slowPath += moved;
      }
    }
    if (balls.every((b) => b.potted || (len(b.vel) === 0 && len(b.roll) === 0))) break;
  }
  if (!contacted) return undefined;
  return { exitSpeed, path, seconds, slowSeconds, slowPath, rails, total, launch: speed };
}

function summarise(levelId: number, seeds: number) {
  const rows: NonNullable<ReturnType<typeof fire>>[] = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const r = fire(levelId, seed);
    if (r) rows.push(r);
  }
  const mean = (f: (r: (typeof rows)[0]) => number) => rows.reduce((s, r) => s + f(r), 0) / rows.length;
  return {
    n: rows.length,
    exit: mean((r) => r.exitSpeed),
    path: mean((r) => r.path),
    seconds: mean((r) => r.seconds),
    slowSeconds: mean((r) => r.slowSeconds),
    slowPath: mean((r) => r.slowPath),
    rails: mean((r) => r.rails),
    total: mean((r) => r.total),
  };
}

test.runIf(import.meta.env.MEASURE)('cue-ball life after contact, per level', () => {
  console.log('level   n  exit   path    time   <0.5m/s      rails  shot');
  for (const level of LEVELS) {
    const s = summarise(level.id, 250);
    console.log(
      `L${level.id}  ${String(s.n).padStart(4)}  ${s.exit.toFixed(2)}  ${s.path.toFixed(3)}m  ` +
        `${s.seconds.toFixed(2)}s  ${s.slowSeconds.toFixed(2)}s/${s.slowPath.toFixed(2)}m  ` +
        `${s.rails.toFixed(2)}  ${s.total.toFixed(2)}s`,
    );
  }
  console.log('');
  console.log('cloth check, level 5:');
  for (const c of ['fast', 'normal', 'slow'] as const) {
    console.log(' ', c, clothRollingFriction(c));
  }
});
