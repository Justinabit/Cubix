/**
 * Runs every test file in tests/.
 *   npm test              -- or: node tests/run.mjs
 *   node tests/run.mjs solver smoke   -- only files whose name contains a word
 *
 * Each file runs in its OWN child process. That isolation is deliberate: the
 * browser tests (smoke, layout, scan) call process.exit() both to skip cleanly
 * when puppeteer is not installed and to report failure. Either call would
 * kill an in-process runner partway down the file list and silently swallow
 * every remaining suite. Spawning keeps one file's exit from ending the run,
 * and lets us tell "skipped" apart from "passed" via the SKIP_MARKER line the
 * browser tests print before they exit.
 */
import { readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SKIP_MARKER } from './skip.mjs';

const here = dirname(fileURLToPath(import.meta.url));

const filters = process.argv.slice(2).map((s) => s.toLowerCase());
const files = readdirSync(here)
  .filter((f) => f.endsWith('.test.mjs'))
  .filter((f) => filters.length === 0 || filters.some((s) => f.toLowerCase().includes(s)))
  .sort();

if (files.length === 0) {
  console.error(`No test files matched${filters.length ? ` filter: ${filters.join(', ')}` : ''}.`);
  process.exit(1);
}

/** Run one file and resolve with its exit code and combined output. */
function runFile(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(here, file)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', (err) => resolve({ code: 1, out: out + String(err.message) }));
    child.on('close', (code) => resolve({ code: code ?? 1, out }));
  });
}

const results = [];
for (const file of files) {
  const started = Date.now();
  const { code, out } = await runFile(file);
  const ms = Date.now() - started;
  const skipped = out.includes(SKIP_MARKER);

  // Relay the file's own output verbatim, then stamp our verdict.
  const body = out.trimEnd();
  if (body) console.log(body);
  if (skipped) console.log(`\n⊘ ${file}  (skipped)`);
  else if (code === 0) console.log(`\n✓ ${file}  (${ms} ms)`);
  else console.log(`\n✗ ${file}  (exit ${code}, ${ms} ms)`);

  results.push({ file, code, skipped, ms });
}

const passed = results.filter((r) => r.code === 0 && !r.skipped);
const skipped = results.filter((r) => r.skipped);
const failed = results.filter((r) => r.code !== 0);

console.log(
  `\n${passed.length} passed, ${skipped.length} skipped, ${failed.length} failed` +
    `  (${files.length} file${files.length === 1 ? '' : 's'}, ${results.reduce((n, r) => n + r.ms, 0)} ms)`
);
if (failed.length) console.error(`Failing: ${failed.map((r) => r.file).join(', ')}`);

process.exit(failed.length ? 1 : 0);
