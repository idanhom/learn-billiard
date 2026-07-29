/**
 * Browser verification against the production artifact.
 *
 * Runs against `vite preview`, not the dev server, so what is checked is what
 * is actually shipped. Drives real shots through the debug hook and asserts the
 * things unit tests cannot see: that a shot is evaluated exactly once, that
 * guides come away as tiers are earned, that progress survives a reload, and
 * that corrupted storage resets cleanly with a notice.
 *
 *   npm run build && npm run preview   (in one terminal)
 *   npm run verify:browser
 *
 * Screenshots land in artifacts/.
 */

import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

/**
 * Use whatever Chromium is already cached rather than insisting on the exact
 * revision this Playwright release ships with — the Pi has one, and a 150 MB
 * download to run a handful of checks is not a good trade.
 */
function cachedChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const cache = join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(cache)) return undefined;
  const builds = readdirSync(cache)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const build of builds) {
    const binary = join(cache, build, 'chrome-linux', 'chrome');
    if (existsSync(binary)) return binary;
  }
  return undefined;
}

const BASE = process.env.PREVIEW_URL ?? 'http://127.0.0.1:4173';
const PAGE_URL = `${BASE}/?debug=1`;
const OUT = fileURLToPath(new URL('../artifacts/', import.meta.url));

const checks = [];
function check(name, condition, detail = '') {
  checks.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

mkdirSync(OUT, { recursive: true });

const executablePath = cachedChromium();
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });

const consoleErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => consoleErrors.push(String(error)));

const state = () => page.evaluate(() => window.__debug.state());

/** What the power meter is showing: the speed readout, and the target tick. */
const meter = () =>
  page.evaluate(() => {
    const marker = document.querySelector('.hud-meter-marker');
    const speed = document.querySelector('.hud-speed');
    return {
      markerShown: Boolean(marker) && marker.style.display !== 'none',
      markerLeft: marker ? marker.style.left : null,
      speed: speed ? speed.textContent : null,
    };
  });

/**
 * Reset first: an evaluated shot refuses to be re-aimed or re-struck, which is
 * the point of the guard, so the layout has to be reset before firing again.
 */
async function playPerfect({ power = 0.5, fresh = false } = {}) {
  const fired = await page.evaluate(
    ({ p, f }) => {
      if (f) window.__debug.next();
      else window.__debug.retry();
      window.__debug.aimIdeal();
      return window.__debug.fire(p);
    },
    { p: power, f: fresh },
  );
  if (!fired) throw new Error('the debug hook refused to fire a shot');
  await page.waitForFunction(() => window.__debug.state().phase !== 'simulating', null, {
    timeout: 30000,
  });
}

await page.goto(PAGE_URL, { waitUntil: 'load' });
await page.evaluate(() => window.localStorage.clear());
await page.reload({ waitUntil: 'load' });
await sleep(1000);

check('debug hook is exposed on the production build', await page.evaluate(() => Boolean(window.__debug)));

const initial = await state();
check('starts in the aiming phase', initial.phase === 'aiming', initial.phase);
check('starts on level 1 at tier 0', initial.levelId === 1 && initial.tier === 0);
check('starts with every guide showing', initial.guides.objectPath && initial.guides.ghostBall);
check('a fresh start carries no recovery notice', initial.notice === null, String(initial.notice));

// The power meter says what it is doing, and marks what the shot asks for.
const meterAtTierZero = await meter();
check(
  'the meter reads out the stroke in m/s and a named band',
  /^\d+\.\d\d m\/s · (soft touch|slow|medium|fast|power)$/.test(meterAtTierZero.speed ?? ''),
  String(meterAtTierZero.speed),
);
check(
  'the target mark is drawn at tier 0',
  meterAtTierZero.markerShown,
  `left=${meterAtTierZero.markerLeft}`,
);
check(
  'and it sits where the recommendation says',
  Math.abs(Number.parseFloat(meterAtTierZero.markerLeft) - initial.recommendedPower * 100) < 0.05,
  `${meterAtTierZero.markerLeft} vs ${(initial.recommendedPower * 100).toFixed(1)}%`,
);

await page.evaluate(() => window.__debug.setView('behind'));
await sleep(300);
await page.screenshot({ path: `${OUT}camera-behind.png` });

await page.evaluate(() => window.__debug.setView('overhead'));
await sleep(300);
await page.screenshot({ path: `${OUT}camera-overhead.png` });

const canvasPixels = await page.evaluate(() => {
  const canvas = document.getElementById('game');
  return { width: canvas.width, height: canvas.height };
});
check(
  'canvas has a real backing store',
  canvasPixels.width > 100 && canvasPixels.height > 100,
  `${canvasPixels.width}x${canvasPixels.height}`,
);

// One shot, evaluated exactly once.
await playPerfect();
const first = await state();
check('exactly one evaluation fired', first.evaluations === 1, `evaluations=${first.evaluations}`);
check('exactly one attempt recorded', first.stats.attempts === 1, `attempts=${first.stats.attempts}`);
check('a perfectly aimed shot qualifies', first.outcome?.qualifying === true);

await sleep(1200);
check('a settled shot is never re-evaluated', (await state()).evaluations === 1);
await page.screenshot({ path: `${OUT}post-shot-report.png` });

// Guides come away as the aim proves reliable.
await playPerfect({ fresh: true });
await playPerfect({ fresh: true });
const promoted = await state();
check('three qualifying shots advance a tier', promoted.tier === 1, `tier=${promoted.tier}`);
check('the pocket line is withdrawn at tier 1', promoted.guides.objectPath === false);
check('the ghost ball survives to tier 1', promoted.guides.ghostBall === true);

await playPerfect({ fresh: true });
await playPerfect({ fresh: true });
await playPerfect({ fresh: true });
const tierTwo = await state();
check('another three advance again', tierTwo.tier === 2, `tier=${tierTwo.tier}`);
check('the ghost ball is withdrawn at tier 2', tierTwo.guides.ghostBall === false);

// The target mark goes with the ghost ball; the speed readout is not a guide
// and stays on.
const meterAtTierTwo = await meter();
check('the target mark is withdrawn with the ghost ball', meterAtTierTwo.markerShown === false);
check(
  'the speed readout survives, because it is not a guide',
  /m\/s/.test(meterAtTierTwo.speed ?? ''),
  String(meterAtTierTwo.speed),
);
await page.screenshot({ path: `${OUT}tier-2.png` });

// Progress survives a reload.
await page.reload({ waitUntil: 'load' });
await sleep(900);
const reloaded = await state();
check('progress survives a reload', reloaded.tier === 2 && reloaded.levelId === 1, `tier=${reloaded.tier}`);
check('per-level counts survive a reload', reloaded.stats.attempts === 6, `attempts=${reloaded.stats.attempts}`);

// Level select.
await page.evaluate(() => window.__debug.selectLevel(5));
await sleep(300);
const levelFive = await state();
check('level select moves to the chosen level', levelFive.levelId === 5, `level=${levelFive.levelId}`);
check('a new level starts at its own tier', levelFive.tier === 0);
check('the layout id records the level and seed', /^L5-s\d+/.test(levelFive.shotId), levelFive.shotId);
await page.screenshot({ path: `${OUT}level-5.png` });

// The exam is exempt from tiers and shows nothing.
await page.evaluate(() => window.__debug.selectLevel(7));
await sleep(300);
const exam = await state();
check('the exam turns every guide off', Object.values(exam.guides).every((v) => v === false));
check('the exam counts shots rather than tiers', exam.exam?.total === 10 && exam.exam?.shotsTaken === 0);
await page.screenshot({ path: `${OUT}exam.png` });

await playPerfect();
const examAfter = await state();
check('an exam shot counts against the run', examAfter.exam?.shotsTaken === 1, JSON.stringify(examAfter.exam));

// Corrupted storage resets cleanly, with a notice.
await page.evaluate(() => {
  for (const key of Object.keys(window.localStorage)) {
    if (key.startsWith('pool-angle-trainer')) window.localStorage.setItem(key, '{ not json');
  }
});
await page.reload({ waitUntil: 'load' });
await sleep(900);
const recovered = await state();
check('corrupted progress resets to level 1 tier 0', recovered.levelId === 1 && recovered.tier === 0);
check('the reset is announced rather than silent', Boolean(recovered.notice), String(recovered.notice));
await page.screenshot({ path: `${OUT}storage-reset.png` });

// Explicit reset.
await playPerfect();
await page.evaluate(() => window.__debug.resetProgress());
await sleep(300);
const afterReset = await state();
check('resetting progress clears the counts', afterReset.stats.attempts === 0);
check('resetting progress returns to level 1', afterReset.levelId === 1 && afterReset.tier === 0);

// Frame-time pass on the production build. Headless Chromium here renders
// through SwiftShader on the CPU, so these numbers are a pessimistic floor —
// the Pi's GPU will do better. Treat a pass as "comfortably fast even in
// software", not as the real frame rate.
await page.evaluate(() => window.__debug.selectLevel(1));
await sleep(300);
const perfShotFired = await page.evaluate(() => {
  window.__debug.aimIdeal();
  return window.__debug.fire(1);
});
// Without this the sample would be taken over a static table, and every budget
// check below would pass for the wrong reason.
if (!perfShotFired) throw new Error('the debug hook refused to fire the frame-cost shot');

// Measure the work done inside a frame, not the gap between frames: headless
// Chromium throttles the animation callback to roughly 10 Hz, which says
// nothing about how much the loop actually costs.
await page.evaluate(() => window.__debug.resetFrameCost());
await sleep(3000);
const perf = await page.evaluate(() => window.__debug.frameCost());

console.log(
  `      per-frame work over ${perf.samples} frames: mean ${perf.mean.toFixed(2)} ms, ` +
    `worst ${perf.worst.toFixed(2)} ms (software rendering, so a pessimistic floor)`,
);
// Sample count first: an empty sample reports a mean of zero, which would sail
// through both budgets below.
const sampled = perf.samples > 10;
check('the loop actually ran while sampling', sampled, `samples=${perf.samples}`);
check(
  'a frame of work fits inside a 60 fps budget',
  sampled && perf.mean < 16.6,
  `mean ${perf.mean.toFixed(2)} ms`,
);
check('no single frame blows the budget', sampled && perf.worst < 100, `worst ${perf.worst.toFixed(2)} ms`);

// On a page whose device pixel ratio is already 1 the cap is untestable — the
// backing store matches the CSS box whether or not the renderer clamps. So ask
// for a scale factor above the cap and check the cap bites.
const dprPage = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 3 });
dprPage.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
dprPage.on('pageerror', (error) => consoleErrors.push(String(error)));
await dprPage.goto(PAGE_URL, { waitUntil: 'load' });
await sleep(900);
const pixelRatio = await dprPage.evaluate(() => {
  const canvas = document.getElementById('game');
  return canvas.width / canvas.getBoundingClientRect().width;
});
await dprPage.close();
check(
  'device pixel ratio is capped for the Pi',
  pixelRatio > 1 && pixelRatio <= 1.5 + 1e-6,
  `ratio ${pixelRatio} at a device scale factor of 3`,
);

// Aiming is by drag: moving the mouse with no button held must not move the cue.
await page.evaluate(() => window.__debug.selectLevel(3));
await sleep(400);
const box = await page.locator('#game').boundingBox();
const midX = box.x + box.width / 2;
const midY = box.y + box.height / 2;

const beforeHover = (await state()).aimAngle;
await page.mouse.move(midX - 150, midY);
await page.mouse.move(midX + 150, midY);
await sleep(150);
check('hovering does not move the aim', (await state()).aimAngle === beforeHover);

const beforeDrag = (await state()).aimAngle;
await page.mouse.move(midX, midY);
await page.mouse.down();
await page.mouse.move(midX + 100, midY, { steps: 10 });
await page.mouse.up();
await sleep(150);
const afterDrag = (await state()).aimAngle;
const draggedDegrees = ((afterDrag - beforeDrag) * 180) / Math.PI;
// 100px right at 0.08 deg/px, clockwise (negative in a CCW-positive frame).
check('dragging right swings the aim clockwise', draggedDegrees < 0, `${draggedDegrees.toFixed(2)} deg`);
check(
  'the drag rate is the configured degrees per pixel',
  Math.abs(draggedDegrees + 8) < 0.5,
  `${draggedDegrees.toFixed(2)} deg for 100px`,
);

// Slow motion: the same shot, watched for longer, with identical dynamics.
async function timedShot(scale) {
  await page.evaluate((s) => {
    window.__debug.retry();
    window.__debug.setSpeed(s);
    window.__debug.aimIdeal();
    window.__debug.fire(0.6);
  }, scale);
  const startedAt = Date.now();
  await page.waitForFunction(() => window.__debug.state().phase !== 'simulating', null, {
    timeout: 60000,
  });
  const wall = Date.now() - startedAt;
  const after = await state();
  return { wall, outcome: after.outcome, balls: after.balls };
}

/** Largest difference between two runs' final orientations, over every ball. */
function orientationDrift(a, b) {
  let worst = 0;
  for (let i = 0; i < a.length; i++) {
    for (const axis of ['x', 'y', 'z', 'w']) {
      worst = Math.max(worst, Math.abs(a[i].spin[axis] - b[i].spin[axis]));
    }
  }
  return worst;
}

await page.evaluate(() => window.__debug.selectLevel(2));
await sleep(300);
const fullSpeed = await timedShot(1);
const quarterSpeed = await timedShot(0.25);

check(
  'quarter speed really does take longer to play out',
  quarterSpeed.wall > fullSpeed.wall * 2,
  `${fullSpeed.wall}ms at 1x vs ${quarterSpeed.wall}ms at 0.25x`,
);
check(
  'slowing it down does not change the physics',
  quarterSpeed.outcome.pottedTarget === fullSpeed.outcome.pottedTarget &&
    Math.abs(quarterSpeed.outcome.duration - fullSpeed.outcome.duration) < 1e-9,
  `sim duration ${fullSpeed.outcome.duration}s both times`,
);
// Orientation is integrated on the fixed tick, so the two runs execute the same
// ticks and must agree to floating-point noise. Accumulated per rendered frame
// instead it drifts by degrees, because rotations do not commute and quarter
// speed samples the roll four times as often.
{
  const drift = orientationDrift(fullSpeed.balls, quarterSpeed.balls);
  check(
    'the balls end up facing the same way at 1x and 0.25x',
    fullSpeed.balls.length === quarterSpeed.balls.length && drift < 1e-9,
    `worst quaternion component drift ${drift.toExponential(2)}`,
  );
}

const speedPersisted = await page.evaluate(() => window.__debug.state().timeScale);
check('the speed setting is live', speedPersisted === 0.25, String(speedPersisted));
await page.reload({ waitUntil: 'load' });
await sleep(900);
check('the speed setting survives a reload', (await state()).timeScale === 0.25);
await page.evaluate(() => window.__debug.setSpeed(1));

// Cloth speed, driven through the real key rather than a debug setter, so the
// input wiring is covered too.
await page.evaluate(() => window.__debug.selectLevel(1));
await sleep(300);
check('starts on normal cloth', (await state()).cloth === 'normal', (await state()).cloth);

await page.locator('#game').click({ position: { x: 640, y: 600 } });
await page.keyboard.press('KeyC');
await sleep(200);
check('C cycles the cloth', (await state()).cloth === 'slow', (await state()).cloth);

await page.reload({ waitUntil: 'load' });
await sleep(900);
const afterReload = await state();
check('the cloth survives a reload', afterReload.cloth === 'slow', afterReload.cloth);
check(
  'and it did not clobber the time scale',
  afterReload.timeScale === 1,
  String(afterReload.timeScale),
);

await page.locator('#game').click({ position: { x: 640, y: 600 } });
await page.keyboard.press('KeyC');
await sleep(200);
check('C wraps back round', (await state()).cloth === 'fast', (await state()).cloth);
await page.keyboard.press('KeyC');
await sleep(200);
check('and back to normal', (await state()).cloth === 'normal', (await state()).cloth);

// Shot history and the calibration tendency.
await page.evaluate(() => window.__debug.selectLevel(3));
await sleep(300);
check('changing level clears the calibration history', (await state()).historyLength === 0);

for (const offsetDegrees of [1.2, 1.6, 1.0]) {
  await page.evaluate((d) => {
    window.__debug.retry();
    window.__debug.aimIdeal();
    window.__debug.aimAt(window.__debug.state().aimAngle + (d * Math.PI) / 180);
    window.__debug.fire(0.55);
  }, offsetDegrees);
  await page.waitForFunction(() => window.__debug.state().phase !== 'simulating', null, {
    timeout: 60000,
  });
}
const calibrated = await state();
check('the history records each shot', calibrated.historyLength === 3, `n=${calibrated.historyLength}`);
check(
  'a consistent bias is reported as a tendency',
  calibrated.cutTendency?.kind === 'thick' || calibrated.cutTendency?.kind === 'thin',
  JSON.stringify(calibrated.cutTendency),
);
// The mean lands on 1.267 when all three shots contact, but the layout is
// seeded from the clock and an off-line shot can occasionally clip a rail or
// find a pocket the ideal line cleared — in which case it is rightly left out
// of the average. Assert the property, not the luck.
check(
  'the tendency averages the deviations that counted',
  (calibrated.cutTendency?.samples ?? 0) >= 2 &&
    (calibrated.cutTendency?.degrees ?? 0) >= 1.0 &&
    (calibrated.cutTendency?.degrees ?? 0) <= 1.6,
  `${calibrated.cutTendency?.degrees?.toFixed(3)} deg over ${calibrated.cutTendency?.samples} of 3`,
);
await page.screenshot({ path: `${OUT}calibration-history.png` });

/*
 * The mark is advice, so it has to be right: aimed perfectly and struck at the
 * power it names, the ball goes in. Across levels, so it holds for thin cuts
 * and long ones as well as easy ones.
 *
 * Judged in aggregate, and not to the last shot, because of one known way an
 * honest recommendation still misses: on a thin cut the cue ball keeps almost
 * all of its speed, and roughly one level-5 layout in a hundred sends it off
 * two cushions and back into the object ball a second and a half later, before
 * the ball has finished creeping into the pocket. That is the cue-ball path,
 * not the power, and it is the same thing this trainer says on screen it does
 * not teach. The seeded sweep in tests/game/power.test.ts is the strict one.
 */
const potShots = [];
for (const levelId of [1, 3, 5, 6]) {
  await page.evaluate((id) => window.__debug.selectLevel(id), levelId);
  await sleep(300);
  for (let shot = 0; shot < 3; shot++) {
    const power = await page.evaluate((first) => {
      if (first) window.__debug.retry();
      else window.__debug.next();
      window.__debug.aimIdeal();
      const recommended = window.__debug.state().recommendedPower;
      if (recommended === null) return null;
      window.__debug.fire(recommended);
      return recommended;
    }, shot === 0);
    if (power === null) {
      potShots.push({ levelId, power: null, potted: false });
      continue;
    }
    await page.waitForFunction(() => window.__debug.state().phase !== 'simulating', null, {
      timeout: 60000,
    });
    potShots.push({
      levelId,
      power,
      potted: (await state()).outcome?.pottedTarget === true,
    });
  }
}
const pottedCount = potShots.filter((s) => s.potted).length;
check(
  'the recommended power is never absent on a layout the generator produced',
  potShots.every((s) => s.power !== null),
);
check(
  'firing at the recommended power pots',
  pottedCount >= potShots.length - 1,
  `${pottedCount}/${potShots.length} — ` +
    potShots
      .map((s) => `L${s.levelId} ${s.power === null ? 'none' : `${(s.power * 100).toFixed(0)}%`}${s.potted ? '' : ' MISS'}`)
      .join(', '),
);

// A clean aiming shot of a half-ball cut, guides up, numbered object ball.
// From a fresh load, so no stale notice or report is left on screen.
await page.evaluate(() => window.localStorage.clear());
await page.reload({ waitUntil: 'load' });
await sleep(900);
await page.evaluate(() => {
  window.__debug.selectLevel(3);
  window.__debug.aimIdeal();
});
await sleep(600);

const showcase = await state();
check('the showcase shot really is on the half-ball level', showcase.levelId === 3, `level=${showcase.levelId}`);
check('the showcase shot is waiting to be aimed', showcase.phase === 'aiming', showcase.phase);

await page.screenshot({ path: `${OUT}aiming-half-ball.png` });
await page.evaluate(() => window.__debug.setView('overhead'));
await sleep(400);
await page.screenshot({ path: `${OUT}aiming-half-ball-overhead.png` });

check('no console errors', consoleErrors.length === 0, consoleErrors.join(' | '));

await browser.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length > 0) process.exit(1);
