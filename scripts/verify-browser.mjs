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

/** Degrees between where the cue points and the ideal line. */
const offIdeal = (s) =>
  (Math.abs(Math.atan2(Math.sin(s.aimAngle - s.idealAimAngle), Math.cos(s.aimAngle - s.idealAimAngle))) * 180) /
  Math.PI;

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

/** A first launch offers the coaching; the checks that are not about it start without it. */
const skipCoaching = async (p) => {
  await p.evaluate(() => window.__debug.skipCoaching());
  await sleep(100);
};
const firstLaunch = await page.evaluate(() => ({
  coach: window.__debug.state().coach,
  shown: document.getElementById('hud-coach')?.style.display !== 'none',
}));
check('a first launch opens on the coaching', firstLaunch.coach === 'aim' && firstLaunch.shown, JSON.stringify(firstLaunch));
await skipCoaching(page);

// Installable on a phone: the manifest and every icon it names are served
// beside the page, at paths relative to it, as they will be under a sub-path.
const install = await page.evaluate(async () => {
  const link = document.querySelector('link[rel="manifest"]');
  const manifest = await (await fetch(link.href)).json();
  const icons = await Promise.all(manifest.icons.map(async (icon) => (await fetch(new URL(icon.src, link.href))).ok));
  const touchIcon = (await fetch(document.querySelector('link[rel="apple-touch-icon"]').href)).ok;
  return { display: manifest.display, icons: icons.every(Boolean), touchIcon };
});
check(
  'it installs to a home screen: manifest, icons and touch icon are all served',
  install.display === 'standalone' && install.icons && install.touchIcon,
  JSON.stringify(install),
);

const initial = await state();
check('starts in the aiming phase', initial.phase === 'aiming', initial.phase);
check('starts on level 1 at tier 0', initial.levelId === 1 && initial.tier === 0);

// Where the balls start, in diamonds, for setting the layout up at a table.
const diamonds = await page.evaluate(() => {
  const line = document.querySelector('#hud-shot .hud-diamonds')?.textContent ?? '';
  const [cue, object] = window.__debug.state().balls;
  const at = (p) => `${((p.x + 0.99) / 0.2475).toFixed(1)}, ${((p.y + 0.495) / 0.2475).toFixed(1)}`;
  return { line, expected: `cue ${at(cue.pos)} \u00b7 object ${at(object.pos)}` };
});
check('the shot panel gives where the balls start, in diamonds', diamonds.line === diamonds.expected, JSON.stringify(diamonds));
await page.evaluate(() => window.__debug.setView('overhead'));
await sleep(200);
await page.screenshot({ path: `${OUT}diamonds-overhead.png` });
await page.evaluate(() => window.__debug.setView('behind'));
await sleep(100);
check('starts with every guide showing', initial.guides.objectPath && initial.guides.ghostBall);
check('a fresh start carries no recovery notice', initial.notice === null, String(initial.notice));
// Space alone must not be the answer: the cue is dealt off the line.
check('the cue starts off the ideal line', offIdeal(initial) >= 3, `${offIdeal(initial).toFixed(2)} deg off`);

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

// The stance view is at least true scale: never narrower than the window the
// screen makes at the viewing distance, and wider only to keep both balls in.
await page.evaluate(() => window.__debug.setView('stance'));
await sleep(300);
const stance = await page.evaluate(() => {
  const s = window.__debug.state();
  const height = document.getElementById('game').clientHeight;
  const honest = (2 * Math.atan((height * 0.0254) / 96 / 2 / s.viewingDistance) * 180) / Math.PI;
  return { view: s.view, fov: s.fieldOfView, honest };
});
check(
  'the stance view is drawn at true scale or wider',
  stance.view === 'stance' && stance.fov >= stance.honest - 1e-6 && stance.fov <= 80,
  `fov ${stance.fov.toFixed(1)} deg, true scale ${stance.honest.toFixed(1)}`,
);
await page.screenshot({ path: `${OUT}camera-stance.png` });
await page.evaluate(() => window.__debug.setView('behind'));

// The room round the table: there, quieter than the cloth, and cheap. Read
// from the canvas itself, so the panels over it do not get in the way.
const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
await sleep(400);
const behindRoom = await page.evaluate(() => ({
  top: [0.3, 0.5, 0.7].map((x) => window.__debug.pixel(x, 0.08)),
  cloth: [[0.4, 0.6], [0.6, 0.6], [0.4, 0.7], [0.6, 0.7]].map(([x, y]) => window.__debug.pixel(x, y)),
}));
const clothLuma = Math.max(...behindRoom.cloth.filter(([r, g, b]) => g > r && g > b).map(luma));
check(
  'behind: the top of the view is the room, not black, and quieter than the cloth',
  behindRoom.top.every((p) => luma(p) > 10 && luma(p) < clothLuma),
  `top ${behindRoom.top.map((p) => luma(p).toFixed(0)).join('/')}, cloth ${clothLuma.toFixed(0)}`,
);
check('behind: the lamp hangs over the table', (await state()).room.lamp === true);
await page.screenshot({ path: `${OUT}room-behind.png` });

await page.evaluate(() => window.__debug.setView('overhead'));
await sleep(400);
const floorSeen = await page.evaluate(() => [[0.04, 0.5], [0.96, 0.5]].map(([x, y]) => window.__debug.pixel(x, y)));
check(
  'overhead: the floor shows outside the frame',
  floorSeen.every((p) => luma(p) > 10),
  floorSeen.map((p) => luma(p).toFixed(0)).join('/'),
);
check('overhead: the lamp is put away, above the eye', (await state()).room.lamp === false);
await page.screenshot({ path: `${OUT}room-overhead.png` });

await page.evaluate(() => window.__debug.setView('stance'));
await sleep(400);
await page.screenshot({ path: `${OUT}room-stance.png` });
await page.evaluate(() => window.__debug.setView('behind'));
await sleep(300);

// Timing is printed, not asserted: software rendering is too noisy to hold to a number.
const roomCost = await page.evaluate(async () => {
  const frames = () => new Promise((resolve) => setTimeout(resolve, 200));
  window.__debug.setRoom(false);
  await frames();
  const off = { ...window.__debug.renderInfo(), ms: window.__debug.timeRenders(120) };
  window.__debug.setRoom(true);
  await frames();
  const on = { ...window.__debug.renderInfo(), ms: window.__debug.timeRenders(120) };
  return { off, on, room: window.__debug.state().room };
});
check(
  'the room costs at most 4 draw calls',
  roomCost.room.visible && roomCost.on.calls > roomCost.off.calls && roomCost.on.calls - roomCost.off.calls <= 4,
  `${roomCost.off.calls} -> ${roomCost.on.calls} calls, ${roomCost.off.triangles} -> ${roomCost.on.triangles} triangles`,
);
console.log(
  `      frame without the room ${roomCost.off.ms.toFixed(2)} ms, with it ${roomCost.on.ms.toFixed(2)} ms (120 frames); baked in ${roomCost.on.bake.toFixed(1)} ms`,
);

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

// With room to show it, the whole report is up, and there is nothing to unfold.
const desktopReport = await page.evaluate(() => {
  const shown = (selector) => {
    const element = document.querySelector(selector);
    return Boolean(element) && getComputedStyle(element).display !== 'none';
  };
  return { more: shown('#hud-report .hud-report-more'), details: shown('#hud-report [data-more]'), next: shown('#hud-report .hud-report-next') };
});
check(
  'on a desktop the report shows its details and the words for Retry and Next, with no Details button',
  desktopReport.more && desktopReport.next && !desktopReport.details,
  JSON.stringify(desktopReport),
);

/** The HUD's panels that are up, by id. */
const panelsUp = (p) =>
  p.evaluate(() =>
    [...document.querySelectorAll('#hud > .panel')].filter((el) => getComputedStyle(el).display !== 'none').map((el) => el.id),
  );
await page.keyboard.press('KeyH');
await sleep(100);
const hiddenUp = await panelsUp(page);
await page.keyboard.press('KeyH');
await sleep(100);
const shownUp = await panelsUp(page);
check(
  'H in the review puts every panel but the toolbar away, and H again brings them back',
  hiddenUp.join() === 'hud-toolbar' && shownUp.includes('hud-report') && shownUp.includes('hud-status'),
  `hidden: ${hiddenUp.join()}; shown: ${shownUp.join()}`,
);

await page.evaluate(() => window.__debug.retry());
const retried = await state();
check('a retry starts off the ideal line too', offIdeal(retried) >= 3, `${offIdeal(retried).toFixed(2)} deg off`);
const aimingUp = await panelsUp(page);
await page.keyboard.press('KeyH');
await sleep(100);
const aimingAfterH = await panelsUp(page);
check(
  'H while aiming changes nothing, and there is no Hide chip to press',
  aimingAfterH.join() === aimingUp.join() &&
    aimingUp.includes('hud-status') &&
    (await page.locator('.hud-chip[data-action="hide"]').count()) === 0,
  aimingAfterH.join(),
);

// Only the first look at a layout counts. A retry has seen where the first
// shot went, so it is practice: flagged, played, and counted for nothing.
check('a retry is flagged as practice', retried.practice === true);
await page.evaluate(() => {
  window.__debug.aimIdeal();
  window.__debug.fire(0.5);
});
await page.waitForFunction(() => window.__debug.state().phase !== 'simulating', null, { timeout: 30000 });
const practised = await state();
check(
  'a retry counts toward neither the tier window nor the level record',
  practised.evaluations === 2 && practised.stats.attempts === 1 && practised.tier === 0,
  `evaluations=${practised.evaluations} attempts=${practised.stats.attempts} tier=${practised.tier}`,
);

// Guides come away as the aim proves reliable.
await playPerfect({ fresh: true });
await playPerfect({ fresh: true });
const promoted = await state();
check('three qualifying shots advance a tier', promoted.tier === 1, `tier=${promoted.tier}`);
const pips = await page.evaluate(() =>
  [...document.querySelectorAll('#hud-status .hud-pip')].map((pip) => pip.className.replace('hud-pip ', '')),
);
check('a new tier starts its window empty, as five open pips', pips.join() === 'open,open,open,open,open', pips.join());
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

// The middle tier draws the overlap the line makes, and offers the call. A
// retry is practice, so playing one here leaves the counts below alone.
await page.evaluate(() => window.__debug.retry());
await sleep(200);
const middle = await page.evaluate(() => ({
  overlap: Boolean(document.querySelector('#hud-shot .hud-overlap')),
  calls: [...document.querySelectorAll('#hud-shot .hud-call')].map((button) => button.textContent),
}));
check('the middle tier draws the overlap the line makes', middle.overlap);
check('and offers a call for each reference fraction', middle.calls.join() === 'full,¾,½,¼,⅛', middle.calls.join());
await page.locator('#hud-shot .hud-call').nth(2).click();
await sleep(100);
check('a call is made from the panel', (await state()).call === 'half', String((await state()).call));
await page.evaluate(() => {
  window.__debug.aimIdeal();
  window.__debug.fire(0.5);
});
await page.waitForFunction(() => window.__debug.state().phase !== 'simulating', null, { timeout: 30000 });
// From tier 2 on, the report waits for the player's read of their own miss.
const asking = await page.evaluate(() => document.querySelector('#hud-report')?.textContent ?? '');
check('the report waits for the self-estimate first', /How did you hit it/.test(asking), asking);
await page.keyboard.press('Digit3');
await sleep(100);
const calledReport = await page.evaluate(() => document.querySelector('#hud-report')?.textContent ?? '');
check('the estimate is answered by key and set against the shot', /You said on/.test(calledReport), calledReport);
check('the report says how the call went', /Called ½/.test(calledReport), calledReport);

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

// The exam offers the commit routine: getting down on the line is optional,
// but once down the stroke waits for a still moment there.
check('the exam starts each shot standing', exam.routine?.down === false, JSON.stringify(exam.routine));
await page.focus('#game');
await page.keyboard.press('KeyG');
await sleep(100);
const gotDown = await state();
check(
  'G gets down on the line, into the stance view',
  gotDown.routine?.down === true && gotDown.view === 'stance',
  `${JSON.stringify(gotDown.routine)} ${gotDown.view}`,
);
await page.keyboard.down('Space');
await sleep(150);
await page.keyboard.up('Space');
check('down, the stroke waits for a still moment', (await state()).phase === 'aiming', (await state()).phase);
await sleep(700);
await page.keyboard.down('Space');
await sleep(250);
await page.keyboard.up('Space');
await sleep(100);
check('after a still moment the stroke goes', (await state()).phase !== 'aiming', (await state()).phase);
await page.waitForFunction(() => window.__debug.state().phase !== 'simulating', null, { timeout: 30000 });
await page.keyboard.press('Escape');
await sleep(100);
const timedReport = await page.evaluate(() => document.querySelector('#hud-report')?.textContent ?? '');
check('the report times the shot, played in the stance', /after the deal in the stance/.test(timedReport), timedReport);

// Once the stroke has gone, the review is free to look from anywhere.
await page.keyboard.press('KeyV');
await sleep(100);
const reviewView = (await state()).view;
check('after the shot, V leaves the stance view', reviewView !== 'stance', reviewView);
while ((await state()).view !== 'stance') {
  await page.keyboard.press('KeyV');
  await sleep(50);
}
await page.keyboard.press('KeyG');
await sleep(100);
check('and G stands back up', (await state()).view === 'behind', (await state()).view);

await playPerfect();
const examAfter = await state();
check('an exam shot counts against the run', examAfter.exam?.shotsTaken === 1, JSON.stringify(examAfter.exam));

// Standing, from any view, the stroke goes as on any level. On a retry, which
// is practice, so the run's count above stands.
await page.evaluate(() => {
  window.__debug.retry();
  window.__debug.aimIdeal();
});
await sleep(100);
await page.focus('#game');
await page.keyboard.down('Space');
await sleep(250);
await page.keyboard.up('Space');
await sleep(100);
check('standing, the stroke goes too', (await state()).phase !== 'aiming', (await state()).phase);
await page.waitForFunction(() => window.__debug.state().phase !== 'simulating', null, { timeout: 30000 });
await page.keyboard.press('Escape');
await sleep(100);
const standingReport = await page.evaluate(() => document.querySelector('#hud-report')?.textContent ?? '');
check('and the report says it was played standing', /after the deal standing/.test(standingReport), standingReport);
check('practice leaves the run as it was', (await state()).exam?.shotsTaken === 1, JSON.stringify((await state()).exam));

// The perception drills: a flash, then a placing.
await page.evaluate(() => window.__debug.selectLevel(9));
await sleep(300);
const flashing = await state();
check('the perception level opens on a flash drill', flashing.drill?.kind === 'flash' && flashing.drill.stage === 'showing', JSON.stringify(flashing.drill));
await sleep(1700);
const flashed = await state();
check('after its moment the balls go and the drill asks', flashed.drill?.stage === 'asking', JSON.stringify(flashed.drill));
await page.screenshot({ path: `${OUT}perception-flash.png` });
await page.focus('#game');
await page.keyboard.press('Digit3');
await sleep(150);
const called = await state();
check('a digit calls the fraction, and the answer shows', called.drill?.stage === 'answered' && called.drill.result?.called === 'half', JSON.stringify(called.drill));
const drillHud = await page.evaluate(() => ({
  power: getComputedStyle(document.getElementById('hud-power')).display,
  status: document.getElementById('hud-status').textContent,
  calls: document.querySelectorAll('#hud-shot [data-call]').length,
}));
check(
  'a drill shows no power meter or shot call, and tallies reads, not pots',
  drillHud.power === 'none' && drillHud.calls === 0 && drillHud.status.includes('read right') && !drillHud.status.includes('potted'),
  JSON.stringify(drillHud),
);

await page.evaluate(() => window.__debug.next());
await sleep(300);
const placing = await state();
check('the next drill is a placing', placing.drill?.kind === 'place' && placing.drill.stage === 'asking', JSON.stringify(placing.drill));
const canvasBox = await page.locator('#game').boundingBox();
await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
await sleep(150);
const clicked = await state();
check('a click on the table places the ghost ball', clicked.drill?.stage === 'answered' && clicked.drill.result?.kind === 'place', JSON.stringify(clicked.drill));
await page.screenshot({ path: `${OUT}perception-place.png` });
await page.evaluate(() => {
  window.__debug.retry();
});
await sleep(200);
const onTheGhost = await page.evaluate(() => {
  const ghost = window.__debug.ghost();
  window.__debug.placeDrill(ghost.x, ghost.y);
  return window.__debug.state().drill;
});
check('placed on the ghost ball, it is right', onTheGhost?.result?.correct === true, JSON.stringify(onTheGhost));

// At the table: T opens it over the game, Escape closes it and the keyboard
// goes back to the table.
await page.evaluate(() => window.__debug.selectLevel(1));
await sleep(200);
await page.focus('#game');
await page.keyboard.press('KeyT');
await sleep(150);
const tableOpen = await page.evaluate(() => {
  const panel = document.getElementById('table-panel');
  return { shown: panel && !panel.hidden, text: panel?.textContent ?? '' };
});
check('T opens the at-the-table panel, on the drill sheet', tableOpen.shown && tableOpen.text.includes('Deal a sheet'), JSON.stringify(tableOpen.shown));

// A drill sheet: ten shots placed in diamonds, and a print of only the sheet.
await page.click('#table-panel [data-deal]');
await sleep(300);
const sheet = await page.evaluate(() =>
  [...document.querySelectorAll('#table-panel .table-sheet tbody tr')].map((row) => row.textContent ?? ''),
);
check(
  'a dealt sheet has ten shots, each with both balls in diamonds',
  sheet.length === 10 && sheet.every((row) => /\d\.\d, \d\.\d.*\d\.\d, \d\.\d/.test(row)),
  `${sheet.length} rows; ${sheet[0]}`,
);
await page.screenshot({ path: `${OUT}table-sheet.png` });
await page.emulateMedia({ media: 'print' });
const printed = await page.evaluate(() => ({
  game: getComputedStyle(document.getElementById('game')).display,
  hud: getComputedStyle(document.getElementById('hud')).display,
  sheet: getComputedStyle(document.querySelector('#table-panel .table-sheet')).display,
  buttons: getComputedStyle(document.querySelector('#table-panel .no-print')).display,
}));
await page.screenshot({ path: `${OUT}table-sheet-print.png`, fullPage: true });
// A real print can fire a resize while the table is hidden for it.
await page.evaluate(() => window.dispatchEvent(new Event('resize')));
await page.emulateMedia({ media: 'screen' });
await sleep(100);
const buffer = await page.evaluate(() => {
  const canvas = document.getElementById('game');
  return { width: canvas.width, client: canvas.clientWidth };
});
check('after printing, the table is still drawn at full size', buffer.width >= buffer.client, JSON.stringify(buffer));
check(
  'printed, it is the sheet alone: no game, no HUD, no buttons',
  printed.game === 'none' && printed.hud === 'none' && printed.buttons === 'none' && printed.sheet !== 'none',
  JSON.stringify(printed),
);
// The session log: a bad entry is refused with a reason and keeps what was
// typed; a good one is kept, survives a reload, and can be removed.
await page.click('#table-panel [data-tab="log"]');
await sleep(100);
const loggedSheet = await page.inputValue('#table-panel [name="sheet"]');
check('the log offers the sheet just dealt', /^\d{4}$/.test(loggedSheet), loggedSheet);
await page.fill('#table-panel [name="shots"]', '10');
await page.fill('#table-panel [name="made"]', '12');
await page.click('#table-panel [data-log-form] [type="submit"]');
await sleep(100);
const refused = await page.evaluate(() => ({
  error: document.querySelector('#table-panel .table-error')?.textContent ?? '',
  shots: document.querySelector('#table-panel [name="shots"]').value,
  rows: document.querySelectorAll('#table-panel .table-log li').length,
}));
check('more made than taken is refused, saying why, and the form keeps its values', refused.error.includes('no more than') && refused.shots === '10' && refused.rows === 0, JSON.stringify(refused));
await page.fill('#table-panel [name="made"]', '7');
await page.fill('#table-panel [name="note"]', '<b>long cuts</b>');
await page.press('#table-panel [name="note"]', 'Enter');
await sleep(150);
const logged = await page.evaluate(() => [...document.querySelectorAll('#table-panel .table-log li')].map((li) => li.innerHTML));
check(
  'Enter logs it, and the note shows as text, not markup',
  logged.length === 1 && logged[0].includes('7 of 10 (70%)') && logged[0].includes('&lt;b&gt;long cuts&lt;/b&gt;'),
  logged[0],
);
await page.screenshot({ path: `${OUT}table-log.png` });
await page.reload({ waitUntil: 'load' });
await sleep(900);
await page.focus('#game');
await page.keyboard.press('KeyT');
await page.click('#table-panel [data-tab="log"]');
await sleep(100);
check('the log survives a reload', (await page.locator('#table-panel .table-log li').count()) === 1);
await page.click('#table-panel [data-remove="0"]');
await sleep(100);
check(
  'and a session can be taken out of it',
  (await page.locator('#table-panel .table-log li').count()) === 0 &&
    (await page.evaluate(() => JSON.parse(window.localStorage.getItem('pool-angle-trainer/table-log/v1')).sessions.length)) === 0,
);
await page.click('#table-panel [data-tab="cloth"]');
await sleep(100);

// Timing the cloth: the stopwatch takes a time, and a typed one picks the
// nearest preset for the table it was taken on.
const watchFrom = Date.now();
await page.click('#table-panel [data-stopwatch]');
await sleep(1200);
await page.click('#table-panel [data-stopwatch]');
const watchSpan = (Date.now() - watchFrom) / 1000;
const stopped = Number(await page.inputValue('#cloth-seconds'));
// Playwright's clicks take their own time on top of the 1.2 s between them,
// and on a busy machine a lot of it: so the reading is held inside the span
// the two clicks were measured to take, not under a fixed ceiling.
check(
  'the stopwatch takes the time between Start and Stop',
  stopped >= 1.1 && stopped <= watchSpan + 0.1,
  `${stopped} s, the clicks spanned ${watchSpan.toFixed(2)} s`,
);
await page.click('#table-panel [data-feet="9"]');
await page.fill('#cloth-seconds', '3.95');
await sleep(100);
const timed = await page.evaluate(() => ({
  text: document.querySelector('#table-panel .table-timing')?.textContent ?? '',
  use: document.querySelector('#table-panel [data-use-cloth]')?.getAttribute('data-use-cloth') ?? null,
  saved: JSON.parse(window.localStorage.getItem('pool-angle-trainer/settings/v1') ?? '{}').tableFeet,
}));
check(
  '3.95 s on a 9-foot table is nearest slow cloth, and the table size is kept',
  timed.text.includes('On a 9-foot table') && timed.text.includes('nearest slow') && timed.use === 'slow' && timed.saved === 9,
  JSON.stringify(timed),
);
await page.screenshot({ path: `${OUT}table-cloth.png` });
await page.click('#table-panel [data-use-cloth]');
await sleep(100);
check('and one press plays on it', (await state()).cloth === 'slow', (await state()).cloth);
await page.fill('#cloth-seconds', '4.6');
await sleep(100);
await page.click('#table-panel [data-use-cloth]');
await sleep(100);
check('which a time nearer normal undoes', (await state()).cloth === 'normal', (await state()).cloth);
await page.click('#table-panel [data-feet="7"]');
await page.click('#table-panel [data-tab="limits"]');
await sleep(100);
check('the limits tab says what this cannot teach', (await page.textContent('#table-panel')).includes('A straight stroke'));
await page.screenshot({ path: `${OUT}table-limits.png` });
await page.keyboard.press('Escape');
await sleep(100);
const tableClosed = await page.evaluate(() => ({
  hidden: document.getElementById('table-panel').hidden,
  focus: document.activeElement?.id,
}));
check('Escape closes it and gives the keyboard back to the table', tableClosed.hidden && tableClosed.focus === 'game', JSON.stringify(tableClosed));
await page.click('#hud-toolbar [data-action="table"]');
await sleep(100);
const byChip = await page.evaluate(() => !document.getElementById('table-panel').hidden);
await page.click('#table-panel [data-close]');
await sleep(100);
check('the toolbar chip opens it too, and Close closes it', byChip && (await page.evaluate(() => document.getElementById('table-panel').hidden)));

// Mastery: the levels panel shows the seven bands, and 0 is level 10, weak angles.
const strip = await page.evaluate(() =>
  [...document.querySelectorAll('#hud-levels .hud-band')].map((cell) => cell.getAttribute('aria-label')),
);
check('the levels panel shows mastery for the seven bands, in words too', strip.length === 7 && strip.every((said) => /\d+\u2013\d+\u00b0/.test(said)), strip[0]);
await page.focus('#game');
await page.keyboard.press('Digit0');
await sleep(200);
const weakLevel = await state();
check('0 selects level 10, weak angles', weakLevel.levelId === 10, String(weakLevel.levelId));
await page.evaluate(() => window.__debug.selectLevel(1));
await sleep(200);

// A save from before mastery by band loads, rather than resetting.
await page.evaluate(() =>
  window.localStorage.setItem(
    'pool-angle-trainer/progress/v1',
    JSON.stringify({
      version: 1,
      currentLevel: 3,
      examBest: 6,
      levels: { '1': { tier: 3, completed: true, attempts: 14, qualified: 12, potted: 11 } },
    }),
  ),
);
await page.reload({ waitUntil: 'load' });
await sleep(900);
const upgraded = await state();
check('a version 1 save loads as it was, with no band played', upgraded.levelId === 3 && upgraded.examBest === 6 && upgraded.notice === null && upgraded.bands.every((band) => band.shots === 0), JSON.stringify({ level: upgraded.levelId, best: upgraded.examBest, notice: upgraded.notice }));

// The cue-ball rules: say where the cue ball goes, and the shot is played.
for (const [levelId, stroke] of [
  [12, 'stun'],
  [13, 'roll'],
]) {
  await page.evaluate((id) => window.__debug.selectLevel(id), levelId);
  await sleep(200);
  const asking = await state();
  check(`level ${levelId} asks where the cue ball goes`, asking.departure?.stage === 'asking' && asking.departure.stroke === stroke, JSON.stringify(asking.departure));
  // Say the rule: square to the line of centres when stunned, thirty degrees off the cue ball's line when rolling.
  await page.evaluate((rolling) => {
    const s = window.__debug.state();
    const ghost = window.__debug.ghost();
    const object = s.balls[1].pos;
    const centres = { x: object.x - ghost.x, y: object.y - ghost.y };
    const length = Math.hypot(centres.x, centres.y);
    const u = { x: centres.x / length, y: centres.y / length };
    const aim = { x: ghost.x - s.balls[0].pos.x, y: ghost.y - s.balls[0].pos.y };
    const side = Math.sign(aim.x * u.y - aim.y * u.x) || 1;
    let direction = { x: side * u.y, y: -side * u.x };
    if (rolling) {
      const aimLength = Math.hypot(aim.x, aim.y);
      const a = { x: aim.x / aimLength, y: aim.y / aimLength };
      const turn = (-side * 30 * Math.PI) / 180;
      direction = { x: a.x * Math.cos(turn) - a.y * Math.sin(turn), y: a.x * Math.sin(turn) + a.y * Math.cos(turn) };
    }
    window.__debug.predictDeparture(ghost.x + direction.x * 0.4, ghost.y + direction.y * 0.4);
  }, stroke === 'roll');
  await page.waitForFunction(() => window.__debug.state().departure?.stage === 'answered', null, { timeout: 30000 });
  const answered = await state();
  const report = await page.textContent('#hud-report');
  check(
    `level ${levelId}: the shot is played, and the prediction scored near the rule`,
    answered.departure.result.error < 12 && report.includes(stroke === 'stun' ? 'object ball' : 'its own line'),
    `${answered.departure.result.error.toFixed(1)} deg; ${report}`,
  );
  check(`level ${levelId}: the answer is shown from overhead`, answered.view === 'overhead', answered.view);
  await page.screenshot({ path: `${OUT}rule-${stroke}.png` });
  await page.evaluate(() => window.__debug.next());
  await sleep(150);
  check(`level ${levelId}: and the next shot is back in the view it was in`, (await state()).view === 'behind');
}
await page.evaluate(() => window.__debug.selectLevel(1));
await sleep(200);

// Position: the stop shot, with the tip moved by the arrows, scored on the spot.
await page.evaluate(() => window.__debug.selectLevel(14));
await sleep(200);
await page.focus('#game');
await page.keyboard.press('ArrowUp');
await sleep(100);
const tipped = await state();
const shotPanel = await page.textContent('#hud-shot');
check(
  'on the stop shot the arrows move the tip, and the panel shows it',
  tipped.position?.target === 'stop' && tipped.tip === 0.1 && shotPanel.includes('follow: 0.1 R above centre'),
  `${tipped.tip} ${shotPanel}`,
);
check('the status names the rung', (await page.textContent('#hud-status')).includes('Rung 1 of 4'));
await page.evaluate(() => {
  window.__debug.changeTip(-4);
  window.__debug.aimIdeal();
  window.__debug.fire(0.62);
});
await page.waitForFunction(() => window.__debug.state().phase !== 'simulating', null, { timeout: 30000 });
const stopShot = await state();
const stopReport = await page.textContent('#hud-report');
check(
  'a stop shot is scored on where the cue ball stopped against the spot',
  stopShot.tip === -0.3 && stopShot.position?.result !== null && /cm from the spot/.test(stopReport),
  stopReport,
);
await page.screenshot({ path: `${OUT}stop-shot.png` });
await page.evaluate(() => window.__debug.selectLevel(1));
await sleep(200);
await page.focus('#game');
await page.keyboard.press('ArrowUp');
await sleep(100);
check('on an aiming level the tip stays at centre', (await state()).tip === 0);

// Speed: the cue ball alone, struck to stop in the ring.
await page.evaluate(() => window.__debug.selectLevel(17));
await sleep(200);
const speedPanel = await page.textContent('#hud-shot');
check('speed control has no object ball, and asks for the ring', speedPanel.includes('no object ball') && speedPanel.includes('cm away'), speedPanel);
await page.evaluate(() => window.__debug.fireToSpot());
await page.waitForFunction(() => window.__debug.state().phase !== 'simulating', null, { timeout: 30000 });
const speedReport = await page.textContent('#hud-report');
check('struck at the speed that stops it there, it stops in the ring', speedReport.includes('In the ring'), speedReport);
await page.evaluate(() => window.__debug.setView('overhead'));
await sleep(200);
await page.screenshot({ path: `${OUT}speed-control.png` });
await page.evaluate(() => {
  window.__debug.setView('behind');
  window.__debug.selectLevel(18);
});
await sleep(200);
await page.evaluate(() => window.__debug.fire(0.55));
await page.waitForFunction(() => window.__debug.state().phase !== 'simulating', null, { timeout: 30000 });
const lagReport = await page.textContent('#hud-report');
check('the lag is scored against its ring and the cushions it touched', /ring|cushion/.test(lagReport) && lagReport.includes('stopped'), lagReport);
await page.evaluate(() => window.__debug.selectLevel(1));
await sleep(200);

// Position zones: a cut with a zone to leave the cue ball in.
await page.evaluate(() => window.__debug.selectLevel(19));
await sleep(300);
const zoned = await page.evaluate(() => ({
  panel: document.getElementById('hud-shot').textContent,
  tip: window.__debug.state().tip,
}));
check('position zones ask for the zone, with the tip in the player\u2019s hands', zoned.panel.includes('leave the cue ball in the zone') && zoned.tip === 0, JSON.stringify(zoned));
await page.evaluate(() => {
  window.__debug.aimIdeal();
  window.__debug.fire(0.5);
});
await page.waitForFunction(() => window.__debug.state().phase !== 'simulating', null, { timeout: 30000 });
const zoneReport = await page.textContent('#hud-report');
check('and the shot is reported against the zone', /zone|Missed the pot|Scratch/.test(zoneReport), zoneReport);
const zoneStatus = await page.textContent('#hud-status');
check('the zone level counts tiers and shots in the zone, not rungs', zoneStatus.includes('Tier 0') && zoneStatus.includes('in the zone'), zoneStatus);
await page.evaluate(() => window.__debug.setView('overhead'));
await sleep(200);
await page.screenshot({ path: `${OUT}position-zone.png` });
await page.evaluate(() => {
  window.__debug.setView('behind');
  window.__debug.selectLevel(1);
});
await sleep(200);

// Patterns: each shot from where the last left the cue ball.
await page.evaluate(() => window.__debug.selectLevel(20));
await sleep(400);
const patternStart = await page.textContent('#hud-status');
check('the patterns level opens on the first of two balls', patternStart.includes('ball 1 of 2'), patternStart);
await page.evaluate(() => {
  window.__debug.aimIdeal();
  window.__debug.fire(window.__debug.state().recommendedPower ?? 0.5);
});
await page.waitForFunction(() => window.__debug.state().phase !== 'simulating', null, { timeout: 30000 });
const afterFirst = await state();
const firstReport = await page.textContent('#hud-report');
const ranOn = firstReport.includes('Ball 1 of 2 down');
check('a pot carries the run on, and anything else ends it, either way said', ranOn || firstReport.includes('Run over'), firstReport);
if (ranOn) {
  const rest = afterFirst.balls[0].pos;
  await page.evaluate(() => window.__debug.next());
  await sleep(200);
  const second = await state();
  check(
    'the next ball is played from where the cue ball stopped',
    Math.hypot(second.balls[0].pos.x - rest.x, second.balls[0].pos.y - rest.y) < 1e-9 && (await page.textContent('#hud-status')).includes('ball 2 of 2'),
    JSON.stringify({ rest, now: second.balls[0].pos }),
  );
}
await page.screenshot({ path: `${OUT}pattern.png` });
await page.evaluate(() => window.__debug.selectLevel(1));
await sleep(200);

// The assessment: twelve stations straight through, then a card on the score.
await page.evaluate(() => window.__debug.selectLevel(21));
await sleep(300);
check('the assessment opens on its first station', (await page.textContent('#hud-status')).includes('station 1 of 12'));
for (let station = 0; station < 12; station++) {
  await page.evaluate(() => {
    const s = window.__debug.state();
    if (s.scoring === 'speed') window.__debug.fireToSpot();
    else {
      window.__debug.aimIdeal();
      window.__debug.fire(s.recommendedPower ?? 0.5);
    }
  });
  await page.waitForFunction(() => window.__debug.state().phase !== 'simulating', null, { timeout: 30000 });
  if (station < 11) await page.evaluate(() => window.__debug.next());
  await sleep(50);
}
const assessed = await state();
check(
  'twelve stations close the run on a card, part by part',
  assessed.milestone?.kind === 'assessment-finished' && assessed.milestone.of === 12 && assessed.milestone.parts.length === 4,
  JSON.stringify(assessed.milestone),
);
const lastReport = await page.textContent('#hud-report');
check(
  'the last station is reported as the zone shot it was, though the next run is already dealt',
  /zone|Missed the pot|Scratch/.test(lastReport) && !lastReport.startsWith('Potted'),
  lastReport,
);
await page.screenshot({ path: `${OUT}assessment.png` });

// Loaded straight into a level about the cue ball, the first shot is that kind too.
await page.evaluate(() => window.__debug.selectLevel(12));
await sleep(200);
await page.reload({ waitUntil: 'load' });
await sleep(900);
check('reloaded on the 90\u00b0 rule, the first shot asks where the cue ball goes', (await state()).departure?.stage === 'asking');
await page.evaluate(() => window.__debug.selectLevel(1));
await sleep(200);

// Kicks and safeties: scored on the contacts, and for a safety on what is left.
await page.evaluate(() => window.__debug.selectLevel(22));
await sleep(200);
const kickPanel = await page.textContent('#hud-shot');
check('a kick asks for a cushion first', kickPanel.includes('off a cushion first'), kickPanel);
await page.evaluate(() => {
  const s = window.__debug.state();
  const cue = s.balls[0].pos;
  window.__debug.aimAt(Math.atan2(s.mirror.y - cue.y, s.mirror.x - cue.x));
  window.__debug.fire(0.75);
});
await page.waitForFunction(() => window.__debug.state().phase !== 'simulating', null, { timeout: 30000 });
const kickReport = await page.textContent('#hud-report');
check('and is scored on what the cue ball met, and in what order', /Kicked it|No cushion first|wrong ball|Missed it/.test(kickReport), kickReport);
check('a kick level counts tiers, not the aiming levels\u2019 guides', (await page.textContent('#hud-status')).includes('Tier 0') && !(await page.textContent('#hud-status')).includes('full guides'));
await page.evaluate(() => window.__debug.setView('overhead'));
await sleep(200);
await page.screenshot({ path: `${OUT}kick.png` });
await page.evaluate(() => {
  window.__debug.setView('behind');
  window.__debug.selectLevel(23);
});
await sleep(300);
await page.evaluate(() => {
  window.__debug.aimIdeal();
  window.__debug.fire(0.3);
});
await page.waitForFunction(() => window.__debug.state().phase !== 'simulating', null, { timeout: 30000 });
const safetyReport = await page.textContent('#hud-report');
check('a safety is scored on the hit and on what is left', /Safe|A pot left|Potted it|Scratch|Foul/.test(safetyReport), safetyReport);
await page.evaluate(() => window.__debug.selectLevel(1));
await sleep(200);

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

// Retry and Next while the balls still roll: the rest of the shot plays out
// at once, scored as it would have been, and the next shot is dealt at once.
await page.evaluate(() => window.__debug.selectLevel(5));
await sleep(300);
const cutShort = await page.evaluate(async () => {
  const d = window.__debug;
  const read = () => {
    const s = d.state();
    return { evaluations: s.evaluations, history: s.historyLength, shot: s.shotId, phase: s.phase, practice: s.practice };
  };
  const strikeHard = async () => {
    d.aimIdeal();
    d.fire(0.9);
    await new Promise((resolve) => setTimeout(resolve, 150));
    return d.state().phase;
  };
  const before = read();
  const rolling = await strikeHard();
  d.next();
  const afterNext = read();
  const rollingAgain = await strikeHard();
  d.retry();
  const afterRetry = read();
  return { before, rolling, afterNext, rollingAgain, afterRetry };
});
check(
  'Next while the balls still roll scores the shot once and deals the next at once',
  cutShort.rolling === 'simulating' &&
    cutShort.afterNext.evaluations === cutShort.before.evaluations + 1 &&
    cutShort.afterNext.history === cutShort.before.history + 1 &&
    cutShort.afterNext.shot !== cutShort.before.shot &&
    cutShort.afterNext.phase === 'aiming',
  JSON.stringify({ before: cutShort.before, rolling: cutShort.rolling, afterNext: cutShort.afterNext }),
);
check(
  'so does Retry, dealing the same layout again as practice',
  cutShort.rollingAgain === 'simulating' &&
    cutShort.afterRetry.evaluations === cutShort.afterNext.evaluations + 1 &&
    cutShort.afterRetry.shot === cutShort.afterNext.shot &&
    cutShort.afterRetry.phase === 'aiming' &&
    cutShort.afterRetry.practice === true,
  JSON.stringify({ rollingAgain: cutShort.rollingAgain, afterRetry: cutShort.afterRetry }),
);

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

// Each on a fresh layout, since a retry is practice and stays out of the
// average. Layouts alternate their cut side, so the offset is turned toward the
// object ball's centre on each one — thick, every time.
for (const offsetDegrees of [1.2, 1.6, 1.0]) {
  await page.evaluate((d) => {
    window.__debug.next();
    const s = window.__debug.state();
    const [cue, object] = s.balls;
    const centre = Math.atan2(object.pos.y - cue.pos.y, object.pos.x - cue.pos.x);
    const towardCentre = Math.sign(Math.sin(centre - s.idealAimAngle));
    window.__debug.aimAt(s.idealAimAngle + (towardCentre * d * Math.PI) / 180);
    window.__debug.fire(0.55);
  }, offsetDegrees);
  await page.waitForFunction(() => window.__debug.state().phase !== 'simulating', null, {
    timeout: 60000,
  });
}
const calibrated = await state();
check('the history records each shot', calibrated.historyLength === 3, `n=${calibrated.historyLength}`);
// Layouts alternate their cut side, so the three shots split two and one
// across the left and right lines; the side with two carries the tendency.
const thick = calibrated.tendencies.find((row) => row.tendency.samples >= 2);
check(
  'a consistent bias is reported as a tendency',
  thick?.tendency.kind === 'thick',
  JSON.stringify(calibrated.tendencies),
);
// A degree or more off the cue ball is several pockets wide on a half-ball
// hit, so the average share runs well past one.
check(
  'the tendency is a share of the pocket',
  (thick?.tendency.share ?? 0) > 1,
  `${thick?.tendency.share?.toFixed(2)} of the pocket over ${thick?.tendency.samples} shots`,
);
await page.screenshot({ path: `${OUT}calibration-history.png` });

/*
 * The mark is advice, so it has to be right: aimed perfectly and struck at the
 * power it names, the ball goes in. Across levels, so it holds for thin cuts
 * and long ones as well as easy ones.
 *
 * Judged in aggregate, and not to the last shot, because of one known way an
 * honest recommendation can still miss: on a thin cut the cue ball keeps almost
 * all of its speed and can come back off two cushions into the object ball
 * before that ball has finished creeping into the pocket. That is the cue-ball
 * path, not the power, and it is the same thing this trainer says on screen it
 * does not teach. Over 500 seeded level-5 layouts it happened once, and that
 * ball still dropped. The seeded sweep in tests/game/power.test.ts is the
 * strict one.
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

// Clearing the last tier completes the level and moves on by itself. The
// calibration history has to go with it, as it does on a level select: a
// tendency measured on straight-ins says nothing about gentle cuts.
await page.evaluate(() => window.localStorage.clear());
await page.reload({ waitUntil: 'load' });
await sleep(900);
await skipCoaching(page);
for (let shot = 0; shot < 12; shot++) await playPerfect({ fresh: shot > 0 });
const advanced = await state();
check('twelve qualifying shots complete level 1 and move on', advanced.levelId === 2, `level=${advanced.levelId}`);
check(
  'the calibration history does not follow the player to the next level',
  advanced.historyLength === 0,
  `n=${advanced.historyLength}`,
);

// The shot that cleared the level is reported, not swept away by the next one:
// it stays on the table with its report, under a card saying what was cleared.
check(
  'the shot that completed the level is still on screen, reported',
  advanced.phase === 'evaluated' && advanced.outcome?.qualifying === true,
  advanced.phase,
);
check(
  'and a summary card says what was cleared and what is next',
  advanced.milestone?.kind === 'level-complete' &&
    advanced.milestone.attempts === 12 &&
    advanced.milestone.qualified === 12 &&
    advanced.milestone.nextLevelName === 'Three-quarter ball',
  JSON.stringify(advanced.milestone),
);
await page.screenshot({ path: `${OUT}level-complete.png` });
await page.locator('.hud-continue').click();
await sleep(200);
const continued = await state();
check(
  'Continue deals the next level its first shot',
  continued.phase === 'aiming' && continued.milestone === null && continued.levelId === 2 && !continued.practice,
  `${continued.phase} level=${continued.levelId} practice=${continued.practice}`,
);

// The exam the same way — and the run must start again afterwards. A finished
// run used to keep counting, so an eleventh pot recorded a best of 11 out of
// 10, which the store refuses to load: the whole save went with it.
await page.evaluate(() => window.__debug.selectLevel(7));
await sleep(300);
for (let shot = 0; shot < 10; shot++) await playPerfect({ fresh: shot > 0 });
const examDone = await state();
check(
  'ten exam shots finish the run and hold the result on screen',
  examDone.phase === 'evaluated' && examDone.milestone?.kind === 'exam-finished' && examDone.milestone.total === 10,
  JSON.stringify(examDone.milestone),
);
check('the next run starts from nothing', examDone.exam?.shotsTaken === 0, JSON.stringify(examDone.exam));
await page.screenshot({ path: `${OUT}exam-finished.png` });
await page.locator('#game').focus();
await page.keyboard.press('KeyN');
await sleep(200);
const pastCard = await state();
check(
  'N moves on past the card as well',
  pastCard.phase === 'aiming' && pastCard.milestone === null && !pastCard.practice,
  `${pastCard.phase} practice=${pastCard.practice}`,
);
await playPerfect();
const examAgain = await state();
check(
  'and a shot after it counts toward the new run, not the old one',
  examAgain.exam?.shotsTaken === 1 && examAgain.milestone === null && examAgain.examBest <= 10,
  `${JSON.stringify(examAgain.exam)} best=${examAgain.examBest}`,
);

// The HUD hands the keyboard back. A clicked button used to keep focus, so the
// next Space pressed the button again instead of charging the cue.
await page.locator('.hud-level[data-level="2"]').click();
await sleep(200);
check(
  'clicking a level hands the keyboard back to the table',
  await page.evaluate(() => document.activeElement?.id === 'game'),
  await page.evaluate(() => document.activeElement?.tagName ?? 'none'),
);
await page.keyboard.down('Space');
await sleep(150);
const spaceAfterClick = await state();
await page.keyboard.up('Space');
check(
  'so Space charges the cue rather than pressing the button again',
  spaceAfterClick.phase === 'charging' && spaceAfterClick.levelId === 2,
  `${spaceAfterClick.phase} level=${spaceAfterClick.levelId}`,
);
await page.waitForFunction(() => window.__debug.state().phase !== 'simulating', null, { timeout: 30000 });

// Erasing every level's record takes two clicks, and the first only asks.
const beforeReset = await state();
await page.locator('[data-action="reset"]').click();
await sleep(150);
const asked = await state();
check(
  'Reset progress asks before it erases anything',
  asked.stats.attempts === beforeReset.stats.attempts &&
    asked.levelId === beforeReset.levelId &&
    (await page.locator('[data-action="reset-confirm"]').count()) === 1,
  `attempts ${beforeReset.stats.attempts} -> ${asked.stats.attempts}`,
);
await page.locator('[data-action="reset-cancel"]').click();
await sleep(150);
const kept = await state();
check(
  'and Keep leaves it all where it was',
  kept.stats.attempts === beforeReset.stats.attempts && (await page.locator('[data-action="reset"]').count()) === 1,
);
// Neither button selects a level, which is the one HUD action that already
// refocused the canvas on its own — so this is the check that the HUD as a
// whole hands the keyboard back, not just the level list.
check(
  'every HUD button hands the keyboard back, not just the level list',
  await page.evaluate(() => document.activeElement?.id === 'game'),
  await page.evaluate(() => document.activeElement?.tagName ?? 'none'),
);
await page.locator('[data-action="reset"]').click();
await page.locator('[data-action="reset-confirm"]').click();
await sleep(150);
const erased = await state();
check(
  'Erase resets it, and takes the recent shots with it',
  erased.levelId === 1 && erased.stats.attempts === 0 && erased.historyLength === 0,
  `level=${erased.levelId} attempts=${erased.stats.attempts} history=${erased.historyLength}`,
);

// A notice is news, not furniture: it goes by itself.
const noticeShown = () =>
  page.evaluate(() => getComputedStyle(document.getElementById('hud-notice')).display !== 'none');
await page.locator('#game').focus();
await page.keyboard.press('KeyC');
await sleep(300);
check('a notice is shown', await noticeShown());
await sleep(4300);
check('and fades by itself after about four seconds', !(await noticeShown()));

// Every key has a button, so nothing needs a keyboard.
const chip = (action) => page.locator(`.hud-chip[data-action="${action}"]`);
const beforeChips = await state();
await chip('next').click();
await sleep(200);
check('the Next chip deals a new layout', (await state()).shotId !== beforeChips.shotId);
await chip('retry').click();
await sleep(200);
check('the Retry chip deals the same layout again', (await state()).phase === 'aiming');
await chip('view').click();
await sleep(150);
check('the view chip switches the camera', (await state()).view !== beforeChips.view, (await state()).view);
await chip('view').click();
await chip('speed').click();
await sleep(150);
check('the speed chip slows the replay', (await state()).timeScale === 0.5, String((await state()).timeScale));
await chip('speed').click();
await chip('speed').click();
await chip('cloth').click();
await sleep(150);
check('the cloth chip changes the cloth', (await state()).cloth !== beforeChips.cloth, (await state()).cloth);
check(
  'the sheet chips are for small screens only',
  !(await chip('levels').isVisible()) && (await page.locator('#hud-levels').isVisible()),
);
const helpShown = () => page.locator('#hud-help').isVisible();
check('help stays folded away until asked for', !(await helpShown()));
await chip('help').click();
check('and ? opens it', await helpShown());
const helpBox = await page.locator('#hud-help').boundingBox();
const toolbarBox = await page.locator('#hud-toolbar').boundingBox();
check(
  'and it sits clear above the toolbar, however many rows that has',
  helpBox.y + helpBox.height <= toolbarBox.y,
  `help bottom ${(helpBox.y + helpBox.height).toFixed(0)}, toolbar top ${toolbarBox.y.toFixed(0)}`,
);
await chip('help').click();
check('and closes it again', !(await helpShown()));
await page.setViewportSize({ width: 1280, height: 640 });
await sleep(200);
const levelsBox = await page.locator('#hud-levels').boundingBox();
const shortToolbar = await page.locator('#hud-toolbar').boundingBox();
check(
  'on a shorter window the levels panel stops above the toolbar',
  levelsBox.y + levelsBox.height <= shortToolbar.y,
  `levels bottom ${(levelsBox.y + levelsBox.height).toFixed(0)}, toolbar top ${shortToolbar.y.toFixed(0)}`,
);
await page.setViewportSize({ width: 1280, height: 760 });
await sleep(200);
// Sound: every contact asks for one, and M turns them off.
const playOne = async () => {
  await page.evaluate(() => {
    window.__debug.next();
    window.__debug.aimIdeal();
    window.__debug.fire(0.5);
  });
  await page.waitForFunction(() => window.__debug.state().phase !== 'simulating', null, { timeout: 30000 });
};
const soundsBefore = await page.evaluate(() => window.__debug.sounds());
await playOne();
const soundsAfter = await page.evaluate(() => window.__debug.sounds());
check(
  'a shot sounds the strike and the contact',
  soundsAfter.strike === soundsBefore.strike + 1 && soundsAfter['ball-ball'] > soundsBefore['ball-ball'],
  JSON.stringify(soundsAfter),
);
await page.focus('#game');
await page.keyboard.press('KeyM');
await sleep(100);
const muted = await page.evaluate(() => ({
  saved: JSON.parse(window.localStorage.getItem('pool-angle-trainer/settings/v1')).sound,
  toggle: document.querySelector('#hud-help [data-sound]').textContent,
}));
await playOne();
const soundsMuted = await page.evaluate(() => window.__debug.sounds());
check(
  'M turns the sound off, keeps it off, and the switch says so',
  muted.saved === false && muted.toggle === 'off' && JSON.stringify(soundsMuted) === JSON.stringify(soundsAfter),
  JSON.stringify({ ...muted, soundsMuted }),
);
await page.focus('#game');
await page.keyboard.press('KeyM');
await sleep(100);

// After a shot: where the balls went, drawn on the cloth, and a replay of it
// from overhead at a quarter speed that ends where the shot did.
await playOne();
const played = await state();
check('a played shot leaves a trail for each ball', played.trails.length >= 2 && played.trails[0] > 1 && played.trails[1] > 1, JSON.stringify(played.trails));
await page.evaluate(() => window.__debug.setView('overhead'));
await sleep(200);
await page.screenshot({ path: `${OUT}post-shot-diagram.png` });
await page.evaluate(() => window.__debug.setView('behind'));
await page.focus('#game');
await page.keyboard.press('KeyP');
await sleep(150);
const replaying = await state();
check('P replays it from overhead', replaying.replaying === true && replaying.view === 'overhead', `${replaying.replaying} ${replaying.view}`);
await page.waitForFunction(() => !window.__debug.state().replaying, null, { timeout: 60000 });
const crossfade = () =>
  page.evaluate(() => {
    const fade = document.querySelector('canvas.crossfade');
    return fade ? { shown: fade.style.display !== 'none', opacity: Number(fade.style.opacity) } : null;
  });
const handedBack = await crossfade();
const replayed = await state();
check(
  'and it ends where the shot did, back in the view it left',
  replayed.view === 'behind' && JSON.stringify(replayed.balls.map((b) => b.pos)) === JSON.stringify(played.balls.map((b) => b.pos)),
  replayed.view,
);
check(
  'it hands back with a crossfade from its last frame',
  handedBack?.shown === true && handedBack.opacity > 0 && handedBack.opacity < 1,
  JSON.stringify(handedBack),
);
await sleep(800);
const cleared = await crossfade();
check('which clears', cleared?.shown === false, JSON.stringify(cleared));
await page.keyboard.press('KeyP');
await sleep(300);
await page.keyboard.press('Escape');
await sleep(100);
check('Escape stops a replay part way', !(await state()).replaying);
const fadingBack = await crossfade();
check('and fades back the same way', fadingBack?.shown === true, JSON.stringify(fadingBack));

// A faster loop: once a shot is scored, Space or Enter deals the next one, and
// the next shot can deal itself.
for (const key of ['Space', 'Enter']) {
  await playOne();
  const before = await state();
  await page.focus('#game');
  await page.keyboard.down(key);
  await sleep(80);
  await page.keyboard.up(key);
  await sleep(150);
  const after = await state();
  check(
    `${key} after a scored shot deals the next one, and charges nothing`,
    before.phase === 'evaluated' && after.shotId !== before.shotId && after.phase === 'aiming' && after.power === 0,
    `${before.phase} ${before.shotId} -> ${after.phase} ${after.shotId} power ${after.power}`,
  );
}
await page.evaluate(() => window.__debug.toggleAutoNext());
await playOne();
const counting = await state();
await sleep(1000);
const countdown = await page.textContent('#hud-report');
await page.waitForFunction((id) => window.__debug.state().shotId !== id, counting.shotId, { timeout: 8000 });
check('with the next shot dealing itself, the report counts down and the shot comes', /Next shot in \d s/.test(countdown), countdown);
await page.evaluate(() => window.__debug.toggleAutoNext());

// The daily set: ten shots with no guides, a card at the end on the median,
// and once the first run is in, the rest of the day is practice.
await page.evaluate(() => window.__debug.selectLevel(11));
await sleep(200);
const dailyStart = await page.textContent('#hud-status');
check('the daily set opens on its first shot, the run that counts', dailyStart.includes('Daily set: shot 1 of 10') && dailyStart.includes('first run today'), dailyStart);
for (let shot = 0; shot < 10; shot++) {
  await page.evaluate(() => {
    window.__debug.aimIdeal();
    window.__debug.fire(0.5);
  });
  await page.waitForFunction(() => window.__debug.state().phase !== 'simulating', null, { timeout: 30000 });
  if (shot < 9) await page.evaluate(() => window.__debug.next());
}
const dailyDone = await state();
check(
  'ten shots close the run on its median, as the first run of the day',
  dailyDone.milestone?.kind === 'daily-finished' && dailyDone.milestone.first === true && dailyDone.milestone.median < 0.2,
  JSON.stringify(dailyDone.milestone),
);
await page.screenshot({ path: `${OUT}daily-finished.png` });
await page.evaluate(() => window.__debug.next());
await sleep(200);
const dailyAgain = await page.textContent('#hud-status');
check('after it, the set again is practice, and the first run stands', dailyAgain.includes('shot 1 of 10') && dailyAgain.includes('Practice'), dailyAgain);
check('the levels panel counts the days practised', (await page.textContent('#hud-levels')).includes('Practised on 1 of the last 7 days'));

// Accessibility: the report is read out, the guides can be high contrast, and
// reduced motion is honoured as soon as the system asks.
check(
  'the shot report and notices are live regions',
  await page.evaluate(
    () =>
      document.getElementById('hud-report').getAttribute('aria-live') === 'polite' &&
      document.getElementById('hud-notice').getAttribute('role') === 'status',
  ),
);
await page.evaluate(() => window.__debug.toggleContrast());
const contrasted = await page.evaluate(() => ({
  state: window.__debug.state().highContrast,
  saved: JSON.parse(window.localStorage.getItem('pool-angle-trainer/settings/v1')).highContrast,
}));
check('high-contrast guides turn on and are kept', contrasted.state === true && contrasted.saved === true, JSON.stringify(contrasted));
await page.evaluate(() => {
  window.__debug.selectLevel(3);
  window.__debug.setView('overhead');
});
await sleep(200);
await page.screenshot({ path: `${OUT}high-contrast.png` });
await page.evaluate(() => {
  window.__debug.toggleContrast();
  window.__debug.setView('behind');
});
// Waited for rather than slept on: on a busy machine the change event can take
// longer than a fixed pause, and the check then fails on timing alone.
const motionSettles = (reduced) =>
  page.waitForFunction((r) => window.__debug.state().reducedMotion === r, reduced, { timeout: 3000 }).catch(() => {});
await page.emulateMedia({ reducedMotion: 'reduce' });
await motionSettles(true);
const calm = await page.evaluate(() => ({
  scene: window.__debug.state().reducedMotion,
  transition: getComputedStyle(document.querySelector('.hud-meter-fill')).transitionDuration,
}));
await page.emulateMedia({ reducedMotion: 'no-preference' });
await motionSettles(false);
check(
  'reduced motion is honoured the moment it is asked for, and let go after',
  calm.scene === true && calm.transition === '0s' && (await state()).reducedMotion === false,
  JSON.stringify(calm),
);

check(
  'without a touch screen the power bar stays, and the touch strip stays away',
  (await page.locator('#hud-power').isVisible()) && !(await page.locator('#hud-strip').isVisible()),
);

/*
 * On a phone, either way up. Chromium stands in for one here: an iPhone 13's
 * screen, and a Galaxy S24's as Chrome leaves it with the address bar showing,
 * which never hides on a page that does not scroll. That checks the layout and
 * the touch paths, not Safari or Chrome on the phone itself, which still want
 * a real device.
 */
for (const [name, viewport] of [
  ['portrait', { width: 390, height: 664 }],
  ['landscape', { width: 664, height: 390 }],
  ['s24-portrait', { width: 360, height: 660 }],
  ['s24-landscape', { width: 780, height: 300 }],
  // The same phone in Vivaldi, which keeps a tab strip above the page and a
  // bar below it: the shortest upright screen the trainer meets.
  ['s24-vivaldi', { width: 360, height: 542 }],
]) {
  const upright = viewport.height > viewport.width;
  const context = await browser.newContext({ viewport, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const phone = await context.newPage();
  phone.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  phone.on('pageerror', (error) => consoleErrors.push(String(error)));
  await phone.goto(PAGE_URL, { waitUntil: 'load' });
  await sleep(900);
  await skipCoaching(phone);

  if (upright) {
    const upper = await phone.evaluate(() => [0.25, 0.5, 0.75].map((x) => window.__debug.pixel(x, 0.3)));
    check(
      `phone, ${name}: the upper half is the room, not black`,
      upper.every((p) => luma(p) > 10),
      upper.map((p) => luma(p).toFixed(0)).join('/'),
    );
  }

  const layout = await phone.evaluate(() => {
    const screen = { w: window.innerWidth, h: window.innerHeight };
    // The middle third each way: where the shot is, whatever the camera does.
    const middle = { left: screen.w / 3, right: (2 * screen.w) / 3, top: screen.h / 3, bottom: (2 * screen.h) / 3 };
    let area = 0;
    const over = [];
    for (const panel of document.querySelectorAll('.panel')) {
      if (getComputedStyle(panel).display === 'none') continue;
      const r = panel.getBoundingClientRect();
      area += r.width * r.height;
      if (r.left < middle.right && r.right > middle.left && r.top < middle.bottom && r.bottom > middle.top) {
        over.push(panel.id);
      }
    }
    return { share: area / (screen.w * screen.h), over };
  });
  // Everything counted, the touch controls included: the power strip alone is
  // about a tenth of an upright screen, and it is long on purpose, since every
  // pixel of it is finer control of the stroke.
  check(
    `phone, ${name}: the panels leave most of the screen to the table`,
    layout.share < 0.35,
    `${(layout.share * 100).toFixed(0)}% covered`,
  );
  check(`phone, ${name}: nothing sits over the middle of the table`, layout.over.length === 0, layout.over.join());

  // The status panel keeps to what the rest of the HUD does not already say,
  // and sideways stays in the column beside the overhead table.
  const status = await phone.evaluate(() => {
    const panel = document.getElementById('hud-status');
    return { text: panel.innerText, right: panel.getBoundingClientRect().right / window.innerWidth };
  });
  check(
    `phone, ${name}: the status panel drops the tier's name and the allowance`,
    !status.text.includes('full guides') && !status.text.includes('of the pocket') && status.text.includes('3 of 5 to advance'),
    status.text.replace(/\s+/g, ' '),
  );
  if (!upright) {
    check(`phone, ${name}: the status panel keeps to the left third`, status.right <= 1 / 3, `right edge at ${(status.right * 100).toFixed(0)}%`);
  }

  /** The chips for these actions, each wholly on screen; the names of any that are not. */
  const offScreen = (actions) =>
    phone.evaluate(
      (wanted) =>
        wanted.filter((action) => {
          const r = document.querySelector(`.hud-chip[data-action="${action}"]`)?.getBoundingClientRect();
          return !r || r.left < 0 || r.right > window.innerWidth || r.bottom > window.innerHeight;
        }),
      actions,
    );
  const chipsOff = await offScreen(['retry', 'next', 'view', 'levels', 'help']);
  check(`phone, ${name}: every action chip is on screen without scrolling`, chipsOff.length === 0, chipsOff.join());

  await phone.locator('.hud-chip[data-action="levels"]').tap();
  await sleep(150);
  check(`phone, ${name}: Levels opens the level list`, await phone.locator('#hud-levels').isVisible());
  await phone.locator('.hud-level[data-level="3"]').tap();
  await sleep(300);
  const tapped = await phone.evaluate(() => window.__debug.state());
  check(
    `phone, ${name}: tapping a level selects it and folds the list away`,
    tapped.levelId === 3 && !(await phone.locator('#hud-levels').isVisible()),
    `level=${tapped.levelId}`,
  );

  // Firing by touch: the strip replaces the bar, and real touch events, sent
  // through the DevTools protocol, drive it the way a thumb would.
  check(
    `phone, ${name}: a power strip replaces the bar`,
    (await phone.locator('#hud-strip').isVisible()) && !(await phone.locator('#hud-power').isVisible()),
  );
  const touch = await context.newCDPSession(phone);
  const stroke = async (points) => {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [points[0]] });
    for (const point of points.slice(1)) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point] });
    }
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(150);
  };
  const track = await phone.locator('.hud-strip-track').boundingBox();
  const midX = track.x + track.width / 2;
  /** The point on the strip that stands for this share of full power: it fills from the bottom. */
  const at = (share) => ({ x: midX, y: track.y + track.height * (1 - share) });
  const low = { x: midX, y: track.y + track.height - 4 };
  const phoneState = () => phone.evaluate(() => window.__debug.state());
  const ready = await phoneState();

  await phone.locator('.hud-aim-button').first().tap();
  await sleep(100);
  const nudged = ((((await phoneState()).aimAngle - ready.aimAngle) * 180) / Math.PI);
  check(`phone, ${name}: the left aim button nudges a twentieth of a degree`, Math.abs(nudged - 0.05) < 0.002, `${nudged.toFixed(3)} deg`);

  await stroke([at(0.5)]);
  const tapped2 = await phoneState();
  check(
    `phone, ${name}: a tap on the strip is not a stroke`,
    tapped2.phase === 'aiming' && tapped2.evaluations === ready.evaluations,
    tapped2.phase,
  );

  await stroke([low, at(0.4), { x: midX - track.width - 80, y: at(0.4).y }]);
  const slid = await phoneState();
  check(`phone, ${name}: sliding off the strip calls the stroke off`, slid.phase === 'aiming', slid.phase);

  // Pressed low, slid up past the stroke and back down to it, and held there
  // before the lift: the fill grows from the bottom, and the marker stands
  // where lifting would play the recommended stroke.
  const lift = 0.45;
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [low] });
  for (const share of [0.25, 0.7, lift]) {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [at(share)] });
  }
  await sleep(150);
  const held = await phone.evaluate(() => {
    const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
    const marker = document.querySelector('.hud-strip-marker');
    const s = window.__debug.state();
    return {
      track: rect('.hud-strip-track'),
      fill: rect('.hud-strip-fill'),
      marker: marker.style.display === 'none' ? null : rect('.hud-strip-marker'),
      power: s.power,
      recommended: s.guides.powerHint ? s.recommendedPower : null,
    };
  });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(150);
  const fired = await phoneState();
  check(
    `phone, ${name}: while held, the strip fills from its bottom to the finger`,
    Math.abs(held.fill.bottom - held.track.bottom) <= 1 &&
      Math.abs(held.fill.height - lift * held.track.height) <= 2 &&
      Math.abs(held.power - lift) < 0.02,
    `fill ${held.fill.top.toFixed(0)}-${held.fill.bottom.toFixed(0)} in ${held.track.top.toFixed(0)}-${held.track.bottom.toFixed(0)}, power ${(held.power * 100).toFixed(1)}%`,
  );
  const markerAt = held.recommended === null ? null : held.track.bottom - held.recommended * held.track.height;
  check(
    `phone, ${name}: the marker stands at the recommended stroke, measured up from the bottom`,
    markerAt !== null && held.marker !== null && Math.abs((held.marker.top + held.marker.bottom) / 2 - markerAt) <= 1.5,
    held.marker === null ? 'no marker' : `marker at ${((held.marker.top + held.marker.bottom) / 2).toFixed(1)}, expected ${markerAt?.toFixed(1)}`,
  );
  check(
    `phone, ${name}: sliding up the strip and lifting strikes at the power reached`,
    fired.phase !== 'aiming' && Math.abs(fired.power - lift) < 0.02,
    `${fired.phase} at ${(fired.power * 100).toFixed(1)}%`,
  );
  await phone.waitForFunction(() => window.__debug.state().phase !== 'simulating', null, { timeout: 30000 });
  await sleep(200);

  // The review: the stroke's controls go, and the report keeps to the verdict
  // and the aim, low down upright and beside the table sideways.
  const review = await phone.evaluate(() => {
    const shown = (id) => getComputedStyle(document.getElementById(id)).display !== 'none';
    const r = document.getElementById('hud-report').getBoundingClientRect();
    const [w, h] = [window.innerWidth, window.innerHeight];
    return {
      controls: ['hud-strip', 'hud-aim'].filter(shown),
      report: shown('hud-report'),
      overMiddle: r.left < (2 * w) / 3 && r.right > w / 3 && r.top < (2 * h) / 3 && r.bottom > h / 3,
      height: r.height / h,
      right: r.right / w,
    };
  });
  check(`phone, ${name}: after the shot the power strip and aim buttons go`, review.controls.length === 0, review.controls.join());
  // Sideways the report stands as tall as the screen allows, beside the table
  // rather than over it, so there it is held to the left third instead.
  check(
    upright
      ? `phone, ${name}: the report misses the middle third and is under 22% of the screen height`
      : `phone, ${name}: the report misses the middle third and keeps to the left third`,
    review.report && !review.overMiddle && (upright ? review.height < 0.22 : review.right <= 1 / 3),
    `${(review.height * 100).toFixed(0)}% of the height, right edge at ${(review.right * 100).toFixed(0)}% of the width`,
  );
  // Hide comes in for the review, after View. At 360 px it pushes ? along
  // the row, which scrolls, and with the longer Overhead label Shots too.
  const reviewChipsOff = await offScreen(['retry', 'next', 'view', 'hide', 'levels']);
  check(
    `phone, ${name}: in the review the chips from Retry to Levels, Hide among them, are on screen`,
    reviewChipsOff.length === 0,
    `${reviewChipsOff.join()}; scrolled off: ${(await offScreen(['history', 'help'])).join() || 'none'}`,
  );

  await phone.screenshot({ path: `${OUT}phone-${name}.png` });
  await phone.evaluate(() => window.__debug.setView('overhead'));
  await sleep(300);
  await phone.screenshot({ path: `${OUT}phone-${name}-overhead.png` });

  const details = phone.locator('#hud-report [data-more]');
  const moreShown = () => phone.locator('#hud-report .hud-report-more').isVisible();
  const folded = !(await moreShown());
  await details.tap();
  await sleep(150);
  const unfolded = (await moreShown()) && (await details.getAttribute('aria-expanded')) === 'true';
  await details.tap();
  await sleep(150);
  const refolded = !(await moreShown()) && (await details.getAttribute('aria-expanded')) === 'false';
  check(
    `phone, ${name}: Details opens the report's details and a second tap folds them`,
    folded && unfolded && refolded,
    JSON.stringify({ folded, unfolded, refolded }),
  );

  // Hide, to see the trails and the needed line with nothing over them.
  const hide = phone.locator('.hud-chip[data-action="hide"]');
  await hide.tap();
  await sleep(150);
  const bare = await panelsUp(phone);
  check(`phone, ${name}: Hide leaves only the toolbar up`, bare.join() === 'hud-toolbar', bare.join());
  await phone.screenshot({ path: `${OUT}phone-${name}-hidden.png` });
  await phone.locator('.hud-chip[data-action="levels"]').tap();
  await sleep(150);
  const sheetWhileBare = await phone.locator('#hud-levels').isVisible();
  await phone.locator('.hud-chip[data-action="levels"]').tap();
  await sleep(150);
  check(`phone, ${name}: with the panels hidden, Levels still opens its sheet`, sheetWhileBare);
  const showLabel = (await hide.textContent()).trim();
  await hide.tap();
  await sleep(150);
  check(
    `phone, ${name}: Show brings the report back`,
    showLabel.startsWith('Show') && (await phone.locator('#hud-report').isVisible()),
    showLabel,
  );
  await hide.tap();
  await sleep(150);
  await phone.locator('.hud-chip[data-action="next"]').tap();
  await sleep(300);
  const dealt = await phone.evaluate(() => ({
    bare: document.getElementById('hud').classList.contains('bare'),
    phase: window.__debug.state().phase,
  }));
  check(
    `phone, ${name}: Next ends it, and the next shot starts with its controls`,
    !dealt.bare && dealt.phase === 'aiming' && (await phone.locator('#hud-strip').isVisible()) &&
      (await phone.locator('#hud-status').isVisible()) && (await hide.count()) === 0,
    JSON.stringify(dealt),
  );
  await context.close();
}

/*
 * A touch laptop: a touch screen and a trackpad, so the touch controls and the
 * key hints both show, at desktop widths. The fine-aim buttons stand clear of
 * the toolbar and the level list, and the ? never wraps onto a row alone.
 */
for (const width of [1280, 900]) {
  const context = await browser.newContext({ viewport: { width, height: 760 }, hasTouch: true });
  const laptop = await context.newPage();
  laptop.on('pageerror', (error) => consoleErrors.push(String(error)));
  await laptop.goto(PAGE_URL, { waitUntil: 'load' });
  await sleep(900);
  await skipCoaching(laptop);
  // Chromium's touch emulation reports no fine pointer, which a real touch laptop also has.
  await laptop.addStyleTag({ content: '.kbd-hint { display: revert !important; }' });
  await sleep(200);
  const layout = await laptop.evaluate(() => {
    const rect = (id) => document.getElementById(id).getBoundingClientRect();
    const [aim, toolbar, levels] = ['hud-aim', 'hud-toolbar', 'hud-levels'].map(rect);
    const chips = [...document.querySelectorAll('#hud-toolbar .hud-chip')].filter((c) => getComputedStyle(c).display !== 'none');
    const help = chips.find((c) => c.dataset.action === 'help').getBoundingClientRect();
    const rows = new Set(chips.map((c) => Math.round(c.getBoundingClientRect().top)));
    const besideHelp = chips.filter((c) => c.dataset.action !== 'help' && Math.abs(c.getBoundingClientRect().top - help.top) < 2);
    return { aim: [aim.top, aim.bottom], toolbar: toolbar.top, levels: levels.bottom, rows: rows.size, besideHelp: besideHelp.length };
  });
  check(
    `touch laptop, ${width} wide: the fine-aim buttons stand clear of the toolbar and the level list`,
    layout.aim[1] <= layout.toolbar && layout.levels <= layout.aim[0],
    JSON.stringify(layout),
  );
  check(`touch laptop, ${width} wide: the ? never wraps onto a row of its own`, layout.besideHelp > 0, `${layout.rows} rows`);
  await laptop.screenshot({ path: `${OUT}touch-laptop-${width}.png` });
  await context.close();
}

// The coaching, played through: three shots, then never again.
await page.evaluate(() => window.localStorage.clear());
await page.reload({ waitUntil: 'load' });
await sleep(900);
const coachStep = async () => (await state()).coach;
const strikeCoached = async () => {
  await page.evaluate(() => window.__debug.fire(0.5));
  await page.waitForFunction(() => window.__debug.state().phase !== 'simulating', null, { timeout: 30000 });
};
const steps = [await coachStep()];
await page.evaluate(() => window.__debug.aimIdeal());
await sleep(150);
steps.push(await coachStep());
await page.screenshot({ path: `${OUT}coaching.png` });
await strikeCoached();
steps.push(await coachStep());
await page.evaluate(() => window.__debug.next());
await sleep(100);
steps.push(await coachStep());
await page.evaluate(() => window.__debug.aimIdeal());
await strikeCoached();
steps.push(await coachStep());
await page.evaluate(() => window.__debug.next());
await sleep(100);
steps.push(await coachStep());
await page.evaluate(() => window.__debug.aimIdeal());
await strikeCoached();
steps.push(await coachStep());
check(
  'the coaching walks the line, the stroke and the tiers, one step at a time',
  JSON.stringify(steps) === JSON.stringify(['aim', 'strike', 'report', 'power', 'power-report', 'tiers', null]),
  JSON.stringify(steps),
);
await page.reload({ waitUntil: 'load' });
await sleep(900);
check('and once done it does not come back', (await coachStep()) === null);

// A clean aiming shot of a half-ball cut, guides up, numbered object ball.
// From a fresh load, so no stale notice or report is left on screen.
await page.evaluate(() => window.localStorage.clear());
await page.reload({ waitUntil: 'load' });
await sleep(900);
await skipCoaching(page);
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
