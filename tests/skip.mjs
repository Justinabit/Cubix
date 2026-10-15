/**
 * Shared marker for tests that skip themselves.
 *
 * It lives in its own module on purpose. tests/run.mjs imports this constant,
 * and the browser tests import it too -- if it were exported from run.mjs,
 * importing it would execute the runner and spawn every test recursively.
 */
export const SKIP_MARKER = '__CUBIX_TEST_SKIPPED__';
