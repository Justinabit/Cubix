/**
 * validator.test.mjs — the three ways a cube can be impossible.
 *
 * Run: node tests/validator.test.mjs
 */
import assert from 'node:assert/strict';
import {
  SOLVED_FACELETS, applyMoveSequence, randomScramble, faceletsToCubieState,
} from '../js/core/cube-model.js';
import { validate, summary } from '../js/core/validator.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('  ok  ' + name); };

const swap = (s, i, j) => { const a = s.split(''); const t = a[i]; a[i] = a[j]; a[j] = t; return a.join(''); };

console.log('validator');

test('a solved cube is valid and reported as solved', () => {
  const r = validate(SOLVED_FACELETS);
  assert.equal(r.valid, true);
  assert.equal(r.solved, true);
  assert.equal(r.issues.length, 0);
});

test('random scrambles are always valid', () => {
  for (let i = 0; i < 40; i++) {
    const state = applyMoveSequence(SOLVED_FACELETS, randomScramble(30));
    const r = validate(state);
    assert.equal(r.valid, true, `scramble ${i} rejected: ${r.issues.map((x) => x.message).join('; ')}`);
  }
});

test('wrong sticker counts are reported for each colour', () => {
  const bad = SOLVED_FACELETS.split('');
  bad[0] = 'R';                                   // one white sticker becomes red
  const r = validate(bad.join(''));
  assert.equal(r.valid, false);
  const messages = r.issues.map((i) => i.message).join(' ');
  assert.match(messages, /10 red/, messages);
  assert.match(messages, /8 white/, messages);
  assert.ok(r.issues.some((i) => i.code === 'COUNT'));
});

test('an incomplete cube is reported as incomplete, not invalid-by-pieces', () => {
  const partial = SOLVED_FACELETS.split('');
  partial[0] = '?';
  const r = validate(partial.join(''));
  assert.equal(r.complete, false);
  assert.equal(r.valid, false);
  assert.equal(r.missing, 1);
});

test('duplicate centres are caught', () => {
  // Put a second white centre on the D face (index 31 is the D centre).
  const bad = SOLVED_FACELETS.split('');
  bad[31] = 'U';            // make the D centre white, just like the U centre
  const centreResult = validate(bad.join(''));
  const r = validate(bad);
  assert.ok(centreResult.issues.some((i) => i.code === 'CENTER_DUPLICATE'), JSON.stringify(centreResult.issues));
});

test('a single flipped edge is caught and the edge is highlighted', () => {
  // Swap the two stickers of the UB edge (indices 1 and 46).
  const bad = swap(SOLVED_FACELETS, 1, 46);
  const r = validate(bad);
  assert.equal(r.valid, false);
  const flip = r.issues.find((i) => i.code === 'FLIP_PARITY');
  assert.ok(flip, JSON.stringify(r.issues.map((i) => i.code)));
  assert.ok(flip.facelets.length > 0, 'the offending edge should be highlighted');
  assert.match(flip.message, /flipped/i);
});

test('a single twisted corner is caught and the corner is highlighted', () => {
  // Rotate the three stickers of the URF corner (8, 9, 20) by one place, which
  // is a twist rather than a reflection.
  const bad = SOLVED_FACELETS.split('');
  const a = bad[8], b = bad[9], c = bad[20];
  bad[8] = b; bad[9] = c; bad[20] = a;
  const r = validate(bad.join(''));
  assert.equal(r.valid, false);
  const twist = r.issues.find((i) => i.code === 'TWIST_PARITY');
  assert.ok(twist, JSON.stringify(r.issues.map((i) => i.code)));
  assert.equal(twist.facelets.length, 3, 'all three stickers of the corner');
});

test('swapping two pieces is caught as a permutation parity error', () => {
  // Exchange the UF and UR edges wholesale (4 stickers) — an odd permutation.
  const bad = SOLVED_FACELETS.split('');
  const uf = [7, 19], ur = [5, 11];
  const tmp = uf.map((i) => bad[i]);
  uf.forEach((slot, k) => { bad[slot] = bad[ur[k]]; });
  ur.forEach((slot, k) => { bad[slot] = tmp[k]; });
  const r = validate(bad.join(''));
  assert.equal(r.valid, false, JSON.stringify(r.issues.map((i) => i.code)));
  assert.ok(r.issues.some((i) => i.code === 'PERMUTATION_PARITY' || i.code === 'IMPOSSIBLE'),
    JSON.stringify(r.issues.map((i) => i.code)));
});

test('an impossible colour combination on one piece is explained in words', () => {
  // Give the URF corner both blue and green — opposite faces, so no such corner
  // exists. Swapping keeps the colour counts right, so this isolates the
  // "no such piece" check from the count check.
  const bad = swap(SOLVED_FACELETS, 8, 45);
  const r = validate(bad);
  assert.equal(r.valid, false);
  const message = r.issues.map((i) => i.message).join(' ');
  assert.match(message, /corner/i, message);
});

test('every issue carries the stickers to highlight', () => {
  const bad = swap(SOLVED_FACELETS, 1, 46);
  const r = validate(bad);
  assert.ok(r.suspectFacelets.length > 0);
  for (const index of r.suspectFacelets) {
    assert.ok(index >= 0 && index < 54, `facelet ${index} out of range`);
  }
});

test('summary() reads sensibly for each state', () => {
  assert.match(summary(validate(SOLVED_FACELETS)), /already solved/i);
  assert.match(summary(validate(SOLVED_FACELETS.split('').map((c, i) => (i === 0 ? '?' : c)).join(''))), /sticker/i);
  const scrambled = applyMoveSequence(SOLVED_FACELETS, randomScramble(20));
  assert.match(summary(validate(scrambled)), /real cube/i);
});

console.log(`\n${passed} validator checks passed`);
