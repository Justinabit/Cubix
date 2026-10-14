/**
 * scan.test.mjs — exercises the camera path with Chrome's fake capture device.
 *
 * The fake device shows a moving test pattern rather than a cube, so this does
 * NOT check classification accuracy (see tests/classifier.test.mjs for that).
 * What it does check is that the whole flow works: the camera opens, the grid is
 * sampled, six centres and six faces are captured, the cube state gets filled
 * in, and the user lands on the review screen instead of an exception.
 *
 * Run: node tests/scan.test.mjs
 */
let puppeteer;
try {
  puppeteer = (await import('puppeteer')).default;
} catch {
  console.log(`${'scan'} test skipped — install puppeteer to run it (npm i -D puppeteer)`);
  process.exit(0);
}
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 5217);
const BASE = `http://127.0.0.1:${PORT}`;

const problems = [];
let passed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log(`  ok  ${name}`); }
  else { problems.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};

const server = spawn(process.execPath, [resolve(ROOT, 'tools/serve.mjs')], {
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' }, stdio: 'ignore',
});
const stop = () => { try { server.kill(); } catch {} };
process.on('exit', stop);

async function waitForServer(timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if ((await fetch(BASE, { signal: AbortSignal.timeout(800) })).ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

console.log('camera flow (fake capture device)');
check('server starts', await waitForServer());
if (problems.length) { stop(); process.exit(1); }

const browser = await puppeteer.launch({
  headless: 'new',
  args: [
    '--no-sandbox', '--disable-setuid-sandbox',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
    '--allow-file-access-from-files',
  ],
});

try {
  const context = browser.defaultBrowserContext();
  await context.overridePermissions(BASE, ['camera']);
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message)));
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console: ' + m.text()); });

  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 40000 });
  await page.waitForFunction('!!window.Cubix', { timeout: 20000 });

  await page.evaluate(() => window.Cubix.go('scan'));
  await page.waitForFunction('window.Cubix.scanner.ready === true', { timeout: 25000 })
    .then(() => check('camera opens and the video is ready', true))
    .catch(() => check('camera opens and the video is ready', false, 'timed out'));

  check('video element is playing frames', await page.evaluate(() => {
    const v = document.getElementById('camera');
    return !!v && v.readyState >= 2 && v.videoWidth > 0;
  }));

  // Walk the whole flow: 6 centres then 6 faces.
  const steps = 12;
  for (let i = 0; i < steps; i++) {
    await page.evaluate(() => document.getElementById('btn-capture').click());
    await new Promise((r) => setTimeout(r, 160));
  }
  await new Promise((r) => setTimeout(r, 800));

  const state = await page.evaluate(() => ({
    scanned: Object.keys(window.Cubix.scanned || {}).length,
    calibration: Object.keys(window.Cubix.scanner.calibration || {}).length,
    current: window.Cubix.current,
    facelets: window.Cubix.facelets,
  }));

  check('all six centres were calibrated', state.calibration === 6, `got ${state.calibration}`);
  check('all six faces were scanned', state.scanned === 6, `got ${state.scanned}`);
  check('scanning finishes on the review screen', state.current === 'review', `on ${state.current}`);
  check('the scanned colours reached the shared state',
    /^[URFDLB?]{54}$/.test(state.facelets), state.facelets);

  check('the camera is stopped after scanning',
    await page.evaluate(() => !window.Cubix.scanner.stream));

  check('no uncaught errors during scanning', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

  /* the review screen must say something useful even for nonsense input */
  const status = await page.$eval('#validate-status', (el) => el.textContent.trim());
  check('review reports on the scanned cube', status.length > 0, `status="${status}"`);
} finally {
  await browser.close();
  stop();
}

console.log(`\n${passed} scan-flow checks passed`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n  - ` + problems.join('\n  - '));
  process.exit(1);
}
