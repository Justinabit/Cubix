/** Runs every test file in tests/. Usage: npm test  (or: node tests/run.mjs) */
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here).filter((f) => f.endsWith('.test.mjs')).sort();

let failed = 0;
for (const file of files) {
  try {
    await import(pathToFileURL(join(here, file)).href);
    console.log(`\n✓ ${file}`);
  } catch (err) {
    failed++;
    console.error(`\n✗ ${file}\n${err.stack || err.message}`);
  }
}
console.log(failed ? `\n${failed} test file(s) failed` : `\nAll ${files.length} test file(s) passed.`);
process.exit(failed ? 1 : 0);
