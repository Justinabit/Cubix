/**
 * scan.test.mjs — the camera path, end to end, in a real browser.
 *
 * Part 1 uses Chrome's stock fake camera (a moving test pattern): it checks
 * the flow works — the camera opens, the live preview runs, six manual
 * captures land the user on the review screen, and the camera is switched off.
 *
 * Part 2 is the real test of the scanner. It writes a video of an actual
 * scrambled cube — each face held the way the app asks, with realistic sticker
 * colours, a different exposure per face and dark gaps while the cube is
 * "turned" — and plays it through Chrome's fake camera. The app must capture
 * all six faces BY ITSELF (auto-capture) and read back exactly that cube.
 *
 * Run: node tests/scan.test.mjs
 */
let puppeteer;
try {
  puppeteer = (await import('puppeteer')).default;
} catch {
  console.log(`${SKIP_MARKER} scan test skipped — install puppeteer to run it (npm i -D puppeteer)`);
  process.exit(0);
}
import { SKIP_MARKER } from './skip.mjs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { openSync, writeSync, closeSync, unlinkSync } from 'node:fs';
import { SOLVED_FACELETS, applyMoveSequence } from '../js/core/cube-model.js';

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

const BASE_ARGS = [
  '--no-sandbox', '--disable-setuid-sandbox',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
];

async function openScan(browser) {
  const context = browser.defaultBrowserContext();
  await context.overridePermissions(BASE, ['camera']);
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 40000 });
  await page.waitForFunction('!!window.Cubix', { timeout: 20000 });
  return { page, errors };
}

/* ------------------------- a video of a real cube ------------------------- */

// What a phone camera records for a typical stickered cube.
const CAMERA = {
  U: [205, 206, 200], R: [178, 28, 38], F: [24, 150, 72],
  D: [215, 195, 35], L: [236, 104, 28], B: [22, 72, 175],
};
const FACE_INDEX = { U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 };
const ORDER = ['F', 'R', 'B', 'L', 'U', 'D'];   // the order the app asks for
const W = 320, H = 240, FPS = 10;
const FACE_SECONDS = 3.0, GAP_SECONDS = 0.6, LEAD_SECONDS = 1.0;

function writeCubeVideo(path, facelets) {
  const fd = openSync(path, 'w');
  writeSync(fd, `YUV4MPEG2 W${W} H${H} F${FPS}:1 Ip A1:1 C420jpeg\n`);
  const size = Math.floor(Math.min(W, H) * 0.62);
  const x0 = Math.floor((W - size) / 2), y0 = Math.floor((H - size) / 2);
  const cell = size / 3;
  const exposures = [1.0, 0.82, 1.12, 0.9, 1.05, 0.78];

  const frame = (pixel) => {
    const Y = Buffer.alloc(W * H), U = Buffer.alloc((W / 2) * (H / 2)), V = Buffer.alloc((W / 2) * (H / 2));
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const [r, g, b] = pixel(x, y);
        Y[y * W + x] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        if (x % 2 === 0 && y % 2 === 0) {
          const i = (y / 2) * (W / 2) + x / 2;
          U[i] = Math.max(0, Math.min(255, Math.round(-0.1687 * r - 0.3313 * g + 0.5 * b + 128)));
          V[i] = Math.max(0, Math.min(255, Math.round(0.5 * r - 0.4187 * g - 0.0813 * b + 128)));
        }
      }
    }
    writeSync(fd, 'FRAME\n'); writeSync(fd, Y); writeSync(fd, U); writeSync(fd, V);
  };
  const dark = () => frame(() => [14, 14, 16]);
  const face = (letter, exposure) => frame((x, y) => {
    const cx = x - x0, cy = y - y0;
    if (cx < -6 || cy < -6 || cx >= size + 6 || cy >= size + 6) return [70, 62, 55];   // a wooden table
    const col = Math.floor(cx / cell), row = Math.floor(cy / cell);
    const inX = cx - col * cell, inY = cy - row * cell;
    if (col < 0 || row < 0 || col > 2 || row > 2 || inX < 4 || inY < 4 || inX > cell - 4 || inY > cell - 4) return [12, 12, 12];
    const sticker = facelets[FACE_INDEX[letter] * 9 + row * 3 + col];
    return CAMERA[sticker].map((c) => Math.min(255, Math.round(c * exposure)));
  });

  for (let i = 0; i < LEAD_SECONDS * FPS; i++) dark();
  ORDER.forEach((letter, k) => {
    for (let i = 0; i < FACE_SECONDS * FPS; i++) face(letter, exposures[k]);
    for (let i = 0; i < GAP_SECONDS * FPS; i++) dark();
  });
  for (let i = 0; i < 8 * FPS; i++) dark();      // then nothing, so nothing is re-captured
  closeSync(fd);
}

/* --------------------------------- part 1 --------------------------------- */

console.log('camera flow (fake capture device)');
check('server starts', await waitForServer());
if (problems.length) { stop(); process.exit(1); }

{
  const browser = await puppeteer.launch({ headless: 'new', args: BASE_ARGS });
  try {
    const { page, errors } = await openScan(browser);
    await page.evaluate(() => window.Cubix.go('scan'));
    await page.waitForFunction('window.Cubix.scanner.ready === true', { timeout: 25000 })
      .then(() => check('camera opens and the video is ready', true))
      .catch(() => check('camera opens and the video is ready', false, 'timed out'));
    check('video element is playing frames', await page.evaluate(() => {
      const v = document.getElementById('camera');
      return !!v && v.readyState >= 2 && v.videoWidth > 0;
    }));
    await new Promise((r) => setTimeout(r, 600));
    check('the live preview loop is sampling the picture',
      await page.evaluate(() => !!window.Cubix._lastSample && window.Cubix._lastSample.length === 9));

    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => document.getElementById('btn-capture').click());
      await new Promise((r) => setTimeout(r, 200));
    }
    await new Promise((r) => setTimeout(r, 600));
    const state = await page.evaluate(() => ({
      scanned: Object.keys(window.Cubix.scanned || {}).length,
      current: window.Cubix.current,
      facelets: window.Cubix.facelets,
    }));
    check('six manual captures scan all six faces', state.scanned === 6, `got ${state.scanned}`);
    check('scanning finishes on the review screen', state.current === 'review', `on ${state.current}`);
    check('the scanned colours reached the shared state', /^[URFDLB]{54}$/.test(state.facelets), state.facelets);
    check('the camera is stopped after scanning', await page.evaluate(() => !window.Cubix.scanner.stream));
    const status = await page.$eval('#validate-status', (el) => el.textContent.trim());
    check('review reports on the scanned cube', status.length > 0, `status="${status}"`);
    check('no uncaught errors during scanning', errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
  }
}

/* --------------------------------- part 2 --------------------------------- */

console.log('scanning a real cube video (auto-capture)');
const SCRAMBLE = "R U2 F' L D B2 R' U L2 F D' B U' R2 F2 L' D2 B'".split(' ');
const CUBE = applyMoveSequence(SOLVED_FACELETS, SCRAMBLE);
const video = join(tmpdir(), `cubix-scan-${process.pid}.y4m`);
writeCubeVideo(video, CUBE);
{
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [...BASE_ARGS, `--use-file-for-fake-video-capture=${video}`],
  });
  try {
    const { page, errors } = await openScan(browser);
    await page.evaluate(() => window.Cubix.go('scan'));
    await page.waitForFunction('window.Cubix.current === "review"', { timeout: 60000 })
      .then(() => check('all six faces were captured automatically', true))
      .catch(async () => check('all six faces were captured automatically', false,
        `captured ${await page.evaluate(() => Object.keys(window.Cubix.scanned || {}).join(','))}`));
    const read = await page.evaluate(() => window.Cubix.facelets);
    let diff = 0;
    for (let i = 0; i < 54; i++) if (read[i] !== CUBE[i]) diff++;
    check('the scanned cube matches the real cube sticker for sticker', diff === 0,
      `${diff} stickers differ\n      read   ${read}\n      actual ${CUBE}`);
    const solveEnabled = await page.$eval('#btn-solve', (el) => !el.disabled);
    check('the scanned cube is accepted for solving', solveEnabled);

    // Follow the instructions exactly as written on screen, on the REAL cube.
    for (const method of ['kociemba', 'beginner']) {
      if (method === 'kociemba') {
        await page.click('#btn-solve');
      } else {
        await page.click('[data-method="beginner"]');
      }
      await page.waitForFunction((m) => document.querySelectorAll('.step-row').length > 0
        && (m === 'beginner') === (document.querySelectorAll('.step-stage').length > 0), { timeout: 90000 }, method);
      const written = await page.$$eval('.step-row .step-move', (els) => els.map((e) => e.textContent.trim()));
      const after = applyMoveSequence(CUBE, written);
      check(`following the ${method === 'kociemba' ? 'shortest' : 'beginner'} steps on the real cube solves it`,
        after === SOLVED_FACELETS, `${written.length} moves → ${after}`);
    }
    check('no uncaught errors while auto-scanning', errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    try { unlinkSync(video); } catch {}
  }
}

stop();
console.log(`\n${passed} scan-flow checks passed`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n  - ` + problems.join('\n  - '));
  process.exit(1);
}
