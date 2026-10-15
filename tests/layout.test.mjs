/**
 * layout.test.mjs — automated UI audit in a real browser.
 *
 * Catches the things a screenshot would show but unit tests never will: content
 * overflowing the viewport, text that is too small or low contrast to read,
 * buttons too small to tap, and cubes that collapse to nothing on a phone.
 *
 * Run: node tests/layout.test.mjs
 */
let puppeteer;
try {
  puppeteer = (await import('puppeteer')).default;
} catch {
  console.log(`${SKIP_MARKER} layout test skipped — install puppeteer to run it (npm i -D puppeteer)`);
  process.exit(0);
}
import { SKIP_MARKER } from './skip.mjs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 5213);
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

console.log('layout audit');
check('server starts', await waitForServer());
if (problems.length) { stop(); process.exit(1); }

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

/* ---------- helper injected into the page ---------- */
const AUDIT = () => {
  const out = { overflow: null, tiny: [], lowContrast: [], smallTargets: [], zeroSize: [] };
  const doc = document.documentElement;
  if (doc.scrollWidth > doc.clientWidth + 1) {
    out.overflow = { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
  }

  const parseRgb = (value) => {
    const m = String(value).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const parts = m[1].split(',').map((v) => parseFloat(v));
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const luminance = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const contrast = (a, b) => {
    const l1 = luminance(a), l2 = luminance(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const effectiveBackground = (el) => {
    let node = el;
    while (node && node !== document.documentElement) {
      const bg = parseRgb(getComputedStyle(node).backgroundColor);
      if (bg && bg.a > 0.5) return bg;
      node = node.parentElement;
    }
    return parseRgb(getComputedStyle(document.body).backgroundColor) || { r: 0, g: 0, b: 0, a: 1 };
  };

  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };

  for (const el of document.querySelectorAll('main *')) {
    if (!visible(el)) continue;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);

    // text that is too small to read
    const ownText = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join('');
    if (ownText.length > 1) {
      const size = parseFloat(style.fontSize);
      if (size < 11) out.tiny.push({ text: ownText.slice(0, 40), size });
      const fg = parseRgb(style.color);
      if (fg) {
        const ratio = contrast(fg, effectiveBackground(el));
        const large = size >= 24 || (size >= 18.66 && parseInt(style.fontWeight, 10) >= 700);
        const min = large ? 3 : 4.5;
        if (ratio < min) {
          out.lowContrast.push({ text: ownText.slice(0, 40), ratio: Number(ratio.toFixed(2)), min, size });
        }
      }
    }

    // interactive targets that are too small to tap
    // tabindex="-1" only makes an element focusable from script (the screen
    // heading gets focus on navigation); it is not something to tap.
    const interactive = el.matches('button, a[href], input[type="checkbox"], input[type="range"], [tabindex]:not([tabindex="-1"])');
    if (interactive && !el.disabled) {
      // A checkbox is operated through its label, so the label is the target.
      const target = el.type === 'checkbox' && el.closest('label') ? el.closest('label') : el;
      const targetRect = target.getBoundingClientRect();
      if (targetRect.height < 24 || targetRect.width < 24) {
        out.smallTargets.push({
          tag: el.tagName.toLowerCase(),
          label: (el.getAttribute('aria-label') || el.textContent || el.className || '').trim().slice(0, 40),
          w: Math.round(targetRect.width), h: Math.round(targetRect.height),
        });
      }
    }
  }

  // The 3D cube on the CURRENT screen must occupy real space. (Canvases on
  // hidden screens are legitimately 0x0, so they are not audited.)
  const active = document.querySelector('.screen.is-active');
  if (active) {
    for (const canvas of active.querySelectorAll('canvas')) {
      const parent = canvas.closest('.cube-stage');
      if (!parent) continue;
      const rect = parent.getBoundingClientRect();
      if (rect.width < 80 || rect.height < 80) {
        out.zeroSize.push({ id: canvas.id, w: Math.round(rect.width), h: Math.round(rect.height) });
      }
    }
  }
  return out;
};

const VIEWPORTS = [
  { name: 'desktop 1440x900', width: 1440, height: 900 },
  { name: 'laptop 1280x800', width: 1280, height: 800 },
  { name: 'tablet 834x1112', width: 834, height: 1112 },
  { name: 'phone 390x844', width: 390, height: 844 },
  { name: 'small phone 320x568', width: 320, height: 568 },
];
const SCREENS = ['landing', 'scan', 'manual', 'review', 'solve'];

try {
  for (const vp of VIEWPORTS) {
    const page = await browser.newPage();
    await page.setViewport({ width: vp.width, height: vp.height });
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 40000 });
    await page.waitForFunction('!!window.Cubix', { timeout: 20000 });
    await page.evaluate(() => window.Cubix.net.scramble(20));
    await page.evaluate(() => window.Cubix.go('review'));
    await new Promise((r) => setTimeout(r, 500));
    await page.evaluate(() => document.getElementById('btn-solve').click());
    await page.waitForFunction('document.querySelectorAll(".step-row").length > 0', { timeout: 90000 });

    for (const screen of SCREENS) {
      await page.evaluate((s) => window.Cubix.go(s), screen);
      await new Promise((r) => setTimeout(r, 450));
      const audit = await page.evaluate(AUDIT);
      const where = `${vp.name} / ${screen}`;

      check(`${where}: no horizontal overflow`, !audit.overflow,
        audit.overflow ? `scrollWidth ${audit.overflow.scrollWidth} > ${audit.overflow.clientWidth}` : '');
      check(`${where}: no text smaller than 11px`, audit.tiny.length === 0,
        JSON.stringify(audit.tiny.slice(0, 3)));
      check(`${where}: text meets WCAG AA contrast`, audit.lowContrast.length === 0,
        JSON.stringify(audit.lowContrast.slice(0, 3)));
      check(`${where}: tap targets are at least 24px`, audit.smallTargets.length === 0,
        JSON.stringify(audit.smallTargets.slice(0, 3)));
      check(`${where}: cube canvas has real size`, audit.zeroSize.length === 0,
        JSON.stringify(audit.zeroSize));
    }
    await page.close();
  }

  /* -------------------- light theme gets the same scrutiny -------------------- */
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  // The first theme follows the system setting, so pin it to dark.
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await page.waitForFunction('!!window.Cubix');
  await page.evaluate(() => document.getElementById('btn-theme').click());
  await new Promise((r) => setTimeout(r, 400));
  check('theme toggle switches to light', await page.evaluate(() => document.documentElement.dataset.theme) === 'light');
  for (const screen of ['landing', 'manual']) {
    await page.evaluate((s) => window.Cubix.go(s), screen);
    await new Promise((r) => setTimeout(r, 400));
    const audit = await page.evaluate(AUDIT);
    check(`light theme / ${screen}: text meets WCAG AA contrast`, audit.lowContrast.length === 0,
      JSON.stringify(audit.lowContrast.slice(0, 4)));
    check(`light theme / ${screen}: no horizontal overflow`, !audit.overflow, JSON.stringify(audit.overflow));
  }
  await page.close();
} finally {
  await browser.close();
  stop();
}

console.log(`\n${passed} layout checks passed`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n  - ` + problems.join('\n  - '));
  process.exit(1);
}
