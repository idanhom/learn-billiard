/**
 * Browser verification against the production artifact.
 *
 * Runs `vite preview`, not the dev server, so what is checked is what is
 * actually shipped. Drives a deterministic shot through the debug hook and
 * asserts the shot is evaluated exactly once — the guard that stops progress
 * being written twice for a single stroke.
 *
 *   npm run build && npm run verify:browser
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

await page.goto(PAGE_URL, { waitUntil: 'load' });
await sleep(1200);

check('debug hook is exposed on the production build', await page.evaluate(() => Boolean(window.__debug)));

const initial = await page.evaluate(() => window.__debug.state());
check('starts in the aiming phase', initial.phase === 'aiming', initial.phase);
check('starts on the straight-in drill', initial.shotId === 'drill-straight-in', initial.shotId);

// Behind-the-cue view.
await page.evaluate(() => window.__debug.setView('behind'));
await sleep(300);
await page.screenshot({ path: `${OUT}camera-behind.png` });

// Overhead view.
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

// Drive the deterministic straight-in shot on the ideal line.
await page.evaluate(() => {
  window.__debug.aimIdeal();
  window.__debug.fire(0.5);
});
check('shot is simulating after firing', (await page.evaluate(() => window.__debug.state().phase)) === 'simulating');

await page.waitForFunction(() => window.__debug.state().phase === 'evaluated', null, { timeout: 30000 });
await sleep(600);

const settled = await page.evaluate(() => window.__debug.state());
check('exactly one evaluation fired', settled.evaluations === 1, `evaluations=${settled.evaluations}`);
check('exactly one attempt recorded', settled.attempts === 1, `attempts=${settled.attempts}`);
check('a perfectly aimed shot qualifies', settled.outcome?.qualifying === true);
check('a perfectly aimed straight-in shot pots', settled.outcome?.pottedTarget === true);

// Idle for a while: the loop must not re-evaluate a settled shot.
await sleep(1500);
const later = await page.evaluate(() => window.__debug.state());
check('a settled shot is never re-evaluated', later.evaluations === 1, `evaluations=${later.evaluations}`);

await page.screenshot({ path: `${OUT}post-shot-report.png` });

// Next drill: the 30 degree cut.
await page.evaluate(() => window.__debug.next());
await sleep(300);
const cut = await page.evaluate(() => window.__debug.state());
check('N advances to the cut drill', cut.shotId === 'drill-cut-30', cut.shotId);
check('the new shot starts unevaluated', cut.outcome === null);

await page.evaluate(() => {
  window.__debug.aimIdeal();
  window.__debug.fire(0.55);
});
await page.waitForFunction(() => window.__debug.state().phase === 'evaluated', null, { timeout: 30000 });
const cutResult = await page.evaluate(() => window.__debug.state());
check('the 30 degree cut pots on the ideal line', cutResult.outcome?.pottedTarget === true);
check('two attempts recorded in total', cutResult.attempts === 2, `attempts=${cutResult.attempts}`);

await page.screenshot({ path: `${OUT}cut-drill.png` });

check('no console errors', consoleErrors.length === 0, consoleErrors.join(' | '));

await browser.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length > 0) process.exit(1);
