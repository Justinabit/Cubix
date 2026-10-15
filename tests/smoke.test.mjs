/**
 * smoke.test.mjs — drives the real page in a headless browser.
 *
 * This is the test that catches the things unit tests cannot: a missing export,
 * a typo in an element id, a WebGL context that never appears, or a solver that
 * promises a solution and then does not deliver one.
 *
 * Requires puppeteer (`npm i -D puppeteer`) and a running server on PORT
 * (default 5173). Run with:  node tests/smoke.test.mjs
 */
let puppeteer;
try {
  puppeteer = (await import('puppeteer')).default;
} catch {
  console.log(`${SKIP_MARKER} smoke test skipped — install puppeteer to run it (npm i -D puppeteer)`);
  process.exit(0);
}
import { SKIP_MARKER } from './skip.mjs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const PORT = Number(process.env.PORT || 5199);
const BASE = `http://127.0.0.1:${PORT}`;

const problems = [];
let passed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log(`  ok  ${name}`); }
  else { problems.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};

/* ------------------------------- start server ------------------------------- */
const server = spawn(process.execPath, [resolve(ROOT, 'tools/serve.mjs')], {
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
  stdio: 'ignore',
});
const stopServer = () => { try { server.kill(); } catch {} };
process.on('exit', stopServer);

async function waitForServer(timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE, { signal: AbortSignal.timeout(800) });
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

/* ---------------------------------- main ---------------------------------- */

console.log('smoke test (headless Chrome)');
check('static server starts', await waitForServer());
if (problems.length) { stopServer(); process.exit(1); }

const browser = await puppeteer.launch({
  headless: 'new',
  args: [
    '--no-sandbox', '--disable-setuid-sandbox',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1400,1000',
  ],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));
  page.on('requestfailed', (req) => {
    // Ignore the camera, which we never grant in the test.
    if (/camera|media/i.test(req.url())) return;
    consoleErrors.push(`request failed: ${req.url()}`);
  });

  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 40000 });
  await page.waitForFunction('!!window.Cubix', { timeout: 20000 });

  check('page loads with no uncaught errors', pageErrors.length === 0, pageErrors.join(' | '));
  check('page loads with no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  /* ------------------------------ landing screen ------------------------------ */
  check('landing screen is visible', await page.$eval('#screen-landing', (el) => !el.hidden));
  const glOk = await page.evaluate(() => {
    const canvas = document.getElementById('landing-canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    return !!gl && !gl.isContextLost();
  });
  check('3D cube renderer has a live WebGL context', glOk);

  await new Promise((r) => setTimeout(r, 900));   // let a few frames render
  const shot = await page.screenshot({ encoding: 'base64', clip: await page.$eval('#landing-canvas', (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }) });
  // Decode just enough of the PNG to see that the canvas is not a flat colour:
  // a rendered cube produces many distinct byte values, an empty one almost none.
  const bytes = Buffer.from(shot, 'base64');
  const distinct = new Set();
  for (let i = 0; i < bytes.length; i += 97) distinct.add(bytes[i]);
  check('cube is actually drawn (rendered canvas is not a flat fill)', distinct.size > 12,
    `${distinct.size} distinct sampled byte values, ${bytes.length} bytes`);

  /* ------------------------------- manual entry ------------------------------- */
  await page.click('[data-goto="manual"]');
  await page.waitForFunction('document.getElementById("screen-manual").hidden === false', { timeout: 8000 });
  check('manual screen opens', true);

  const stickerCount = await page.$$eval('#net .sticker', (els) => els.length);
  check('net shows 54 stickers', stickerCount === 54, `saw ${stickerCount}`);
  const swatchCount = await page.$$eval('#palette .swatch', (els) => els.length);
  check('palette shows 6 colours', swatchCount === 6, `saw ${swatchCount}`);
  check('the selected colour is highlighted from the start',
    await page.$$eval('#palette .swatch.is-active', (els) => els.length) === 1);

  // Paint one sticker and confirm the shared state changed.
  await page.click('#palette .swatch[data-letter="D"]');
  await page.click('#net .net-face[data-face="F"] .sticker:not(.is-center)');
  const afterPaint = await page.evaluate(() => window.Cubix.facelets);
  check('painting a sticker updates the shared state', afterPaint[18] === 'D' || afterPaint[19] === 'D' || afterPaint[20] === 'D',
    `state=${afterPaint}`);

  // Clicking a sticker on the 3D cube should paint it, same as the net.
  const beforeCubeClick = await page.evaluate(() => window.Cubix.facelets);
  const box = await page.$eval('#manual-canvas', (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  // Pick a colour the visible faces are unlikely to already be, otherwise
  // "paint it the same colour again" is a legitimate no-op.
  await page.click('#palette .swatch[data-letter="D"]');
  const pick = await page.evaluate(({ x, y }) => window.Cubix.views.manual._pick({ clientX: x, clientY: y }), box);
  check('the 3D cube can tell which sticker was clicked', !!pick, JSON.stringify(pick));
  await page.mouse.click(box.x, box.y);
  await new Promise((r) => setTimeout(r, 300));
  const afterCubeClick = await page.evaluate(() => window.Cubix.facelets);
  check('clicking the 3D cube paints a sticker', afterCubeClick !== beforeCubeClick,
    'state unchanged');

  // Letters on stickers (the colour-blind aid) should toggle.
  await page.click('#chk-letters');
  await new Promise((r) => setTimeout(r, 250));
  const lettersShown = await page.$$eval('#net .sticker', (els) => els.filter((e) => e.textContent.trim()).length);
  check('letters can be shown on stickers', lettersShown > 0, `${lettersShown} stickers labelled`);
  await page.click('#chk-letters');

  /* -------------------------- scramble, review, solve -------------------------- */
  await page.click('#btn-random');
  await new Promise((r) => setTimeout(r, 400));
  const scrambled = await page.evaluate(() => window.Cubix.facelets);
  check('random scramble produces a legal, unsolved cube',
    scrambled !== 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB');

  await page.click('#btn-review');
  await page.waitForFunction('document.getElementById("screen-review").hidden === false', { timeout: 8000 });
  const status = await page.$eval('#validate-status', (el) => el.textContent.trim());
  check('review validates the scramble as solvable', /real cube/i.test(status), `status="${status}"`);
  const solveEnabled = await page.$eval('#btn-solve', (el) => !el.disabled);
  check('solve button is enabled for a valid cube', solveEnabled);

  await page.click('#btn-solve');
  await page.waitForFunction(
    'document.getElementById("screen-solve").hidden === false && document.querySelectorAll(".step-row").length > 0',
    { timeout: 90000 }
  );
  const moveCount = await page.$$eval('.step-row', (els) => els.length);
  check('a solution is produced', moveCount > 0, `${moveCount} moves`);
  check('solution is short enough to be useful', moveCount <= 26, `${moveCount} moves`);

  // Regression: after animated turns, every sticker on the 3D cube must still
  // show the colour the model says is at that position (the renderer used to
  // repaint moved cubies as if they were still in their home slots).
  const wrongStickers = await page.evaluate(async () => {
    const app = window.Cubix;
    const view = app.views.solve;
    const { FACELET_INFO, CUBIES, COLOR_OF_LETTER } = await import('./js/core/cube-model.js');
    const THREE = await import('./vendor/three.js');
    view.root.rotation.y = 0.8;                       // as if the idle spin had run
    for (const mv of ['R', "F'", 'U2', 'L', "B'"]) view.applyMove(mv, { animate: true });
    while (view.busy) await new Promise((r) => setTimeout(r, 40));
    let bad = 0;
    for (const cubie of view.cubies) {
      for (const sticker of Object.values(cubie.userData.stickers)) {
        const p = new THREE.Vector3(); sticker.getWorldPosition(p); view.root.worldToLocal(p);
        const c = new THREE.Vector3(); cubie.getWorldPosition(c); view.root.worldToLocal(c);
        const d = p.clone().sub(c);
        const axis = ['x', 'y', 'z'].reduce((a, b) => (Math.abs(d[a]) > Math.abs(d[b]) ? a : b));
        const face = axis === 'x' ? (d.x > 0 ? 'R' : 'L') : axis === 'y' ? (d.y > 0 ? 'U' : 'D') : (d.z > 0 ? 'F' : 'B');
        const pos = [c.x, c.y, c.z].map(Math.round).join();
        const info = FACELET_INFO.find((f) => f.face === face && CUBIES[f.slot].pos.join() === pos);
        if (!info || !sticker.material.color.equals(new THREE.Color(COLOR_OF_LETTER[view.facelets[info.index]].hex))) bad++;
      }
    }
    view.setState(app.facelets);
    view.root.rotation.y = 0;
    return bad;
  });
  check('the 3D cube shows the right colours after animated turns', wrongStickers === 0, `${wrongStickers} wrong`);

  // Regression: playing part of the solution and going back must not change
  // the cube the user entered.
  const entered = await page.evaluate(() => window.Cubix.facelets);
  await page.evaluate(() => { for (let i = 0; i < 3; i++) document.getElementById('btn-next').click(); });
  await page.click('#btn-solve-back');
  await page.waitForFunction('document.getElementById("screen-review").hidden === false', { timeout: 8000 });
  check('going back from the solution restores the entered cube',
    await page.evaluate(() => window.Cubix.facelets) === entered);
  await page.click('#btn-solve');
  await page.waitForFunction('document.querySelectorAll(".step-row").length > 0', { timeout: 90000 });

  // Step all the way through and confirm the app reports a solved cube.
  // Click via JS because the solve screen is hidden the moment the cube is done.
  for (let i = 0; i < moveCount + 2; i++) {
    await page.evaluate(() => document.getElementById('btn-next').click());
  }
  // The finished screen waits for the last turn to play before it appears.
  await page.waitForFunction('document.getElementById("screen-done").hidden === false', { timeout: 8000 }).catch(() => {});
  const finalState = await page.evaluate(() => window.Cubix.facelets);
  check('following every move leaves a solved cube',
    finalState === 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB', finalState);
  const doneVisible = await page.$eval('#screen-done', (el) => !el.hidden);
  check('the finished screen appears', doneVisible);

  /* ------------------------------ beginner method ------------------------------ */
  await page.click('#btn-done-another');
  await page.waitForFunction('document.getElementById("screen-manual").hidden === false', { timeout: 8000 });
  await page.click('#btn-random');
  await new Promise((r) => setTimeout(r, 400));
  await page.click('#btn-review');
  await page.waitForFunction('document.getElementById("screen-review").hidden === false', { timeout: 8000 });
  await page.click('#btn-solve');
  await page.waitForFunction('document.querySelectorAll(".step-row").length > 0', { timeout: 90000 });
  await page.click('[data-method="beginner"]');
  await page.waitForFunction(
    'document.querySelectorAll(".step-stage").length > 0 && document.querySelectorAll(".step-row").length > 0',
    { timeout: 90000 }
  );
  const stageCount = await page.$$eval('.step-stage', (els) => els.length);
  check('beginner method shows all 7 stages', stageCount === 7, `saw ${stageCount}`);

  const beginnerMoves = await page.$$eval('.step-row', (els) => els.length);
  for (let i = 0; i < beginnerMoves + 2; i++) {
    await page.evaluate(() => document.getElementById('btn-next').click());
  }
  await page.waitForFunction('document.getElementById("screen-done").hidden === false', { timeout: 8000 }).catch(() => {});
  const beginnerFinal = await page.evaluate(() => window.Cubix.facelets);
  check('beginner method solves the cube too',
    beginnerFinal === 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB', beginnerFinal);

  /* --------------------------------- validation --------------------------------- */
  await page.click('#btn-done-another');
  await page.waitForFunction('document.getElementById("screen-manual").hidden === false', { timeout: 8000 });
  // (a) too many of one colour — the simplest way to get the count wrong.
  await page.evaluate(() => {
    const s = window.Cubix.facelets.split('');
    s[0] = 'R';
    window.Cubix.net.set(s.join(''));
  });
  await page.click('#btn-review');
  await page.waitForFunction('document.getElementById("screen-review").hidden === false', { timeout: 8000 });
  const countStatus = await page.$eval('#validate-status', (el) => el.textContent.trim());
  const countIssues = await page.$$eval('#validate-issues li', (els) => els.map((e) => e.textContent));
  check('a cube with the wrong number of stickers is rejected',
    countIssues.length > 0 && /should be exactly 9/i.test(countIssues.join(' ')),
    `status="${countStatus}" issues=${JSON.stringify(countIssues)}`);
  check('solving is blocked when the counts are wrong', await page.$eval('#btn-solve', (el) => el.disabled));

  // (b) a physically impossible twist — swap two stickers of one corner.
  await page.click('#btn-edit-colours');
  await page.waitForFunction('document.getElementById("screen-manual").hidden === false', { timeout: 8000 });
  await page.click('#btn-random');
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate(() => {
    const s = window.Cubix.facelets.split('');
    // Swap the two stickers of the UB edge — that always flips an edge, and a
    // single flipped edge is something no real cube can show.
    const t = s[1]; s[1] = s[46]; s[46] = t;
    window.Cubix.net.set(s.join(''));
  });
  await page.click('#btn-review');
  await page.waitForFunction('document.getElementById("screen-review").hidden === false', { timeout: 8000 });
  const twistIssues = await page.$$eval('#validate-issues li', (els) => els.map((e) => e.textContent));
  const highlighted = await page.evaluate(() => window.Cubix.validation.suspectFacelets.length);
  check('an impossible single flipped edge is rejected with an explanation', twistIssues.length > 0,
    `issues=${JSON.stringify(twistIssues)}`);
  check('the suspicious stickers are highlighted for the user', highlighted > 0, `${highlighted} highlighted`);
  check('solving is blocked for an impossible cube', await page.$eval('#btn-solve', (el) => el.disabled));

  /* --------------------------------- misc UI --------------------------------- */
  await page.click('#btn-help');
  const helpVisible = await page.$eval('#sheet-help', (el) => !el.hidden);
  check('notation cheat sheet opens', helpVisible);
  await page.click('#sheet-help [data-close-sheet]');

  const themeBefore = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.click('#btn-theme');
  const themeAfter = await page.evaluate(() => document.documentElement.dataset.theme);
  check('theme toggle switches themes', themeBefore !== themeAfter, `${themeBefore} -> ${themeAfter}`);

  /* ------------------------------ error tally ------------------------------ */
  check('no uncaught errors during the whole run', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  const realConsoleErrors = consoleErrors.filter((e) => !/camera|media|getUserMedia/i.test(e));
  check('no console errors during the whole run', realConsoleErrors.length === 0, realConsoleErrors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  stopServer();
}

console.log(`\n${passed} smoke checks passed`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n  - ` + problems.join('\n  - '));
  process.exit(1);
}
