/**
 * cube-ops.test.mjs — whole-cube rotations, move renaming and slot predicates.
 *
 * The x2 rotation is what lets the beginner solver work in the standard
 * teaching orientation (white on the bottom); a wrong prime in the renaming
 * table yields a solution that looks right but leaves the cube scrambled, so
 * it is pinned down here against the move engine.
 *
 * Run: node tests/cube-ops.test.mjs
 */
import assert from 'node:assert/strict';
import {
  SOLVED_FACELETS, applyMove, applyMoveSequence, tokenizeMoves, randomScramble,
  FACELET_INFO, CUBIES,
} from '../js/core/cube-model.js';
import {
  x2, y, y2, renameMoves, RENAME_X2, SLOTS, slotSolved, slotTarget, slotColors,
  findPiece, center, at, faceSolved, crossSolved, f2lSolved, isUniform, isLegalCube,
} from '../js/core/cube-ops.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('  ok  ' + name); };
const ALL = tokenizeMoves("U U' U2 D D' D2 R R' R2 L L' L2 F F' F2 B B' B2");

console.log('cube-ops');

test('x2 is an involution and produces a legal cube', () => {
  let s = SOLVED_FACELETS;
  for (const mv of randomScramble(20)) s = applyMove(s, mv);
  assert.equal(x2(x2(s)), s);
  assert.ok(isLegalCube(x2(s)));
});

test('x2 puts white on the bottom', () => {
  const std = x2(SOLVED_FACELETS);
  assert.equal(center(std, 'D'), 'U');   // white letter U is now the D centre
  assert.equal(center(std, 'U'), 'D');   // yellow is on top
});

test('RENAME_X2 translates a rotated-frame solution back correctly', () => {
  // The defining property:  S . t(m) === x2( x2(S) . m )  for every state S, move m.
  let s = SOLVED_FACELETS;
  for (const mv of randomScramble(10)) s = applyMove(s, mv);
  for (const m of ALL) {
    const expected = x2(applyMove(x2(s), m));
    const actual = applyMove(s, renameMoves([m])[0]);
    assert.equal(actual, expected, `renameMoves(${m})`);
  }
});

test('RENAME_X2 is an involution, so it converts both ways', () => {
  for (const m of ALL) assert.equal(renameMoves(renameMoves([m]))[0], m);
});

test('solving in the rotated frame and translating back actually solves the cube', () => {
  for (let trial = 0; trial < 20; trial++) {
    const scramble = randomScramble(20);
    const facelets = applyMoveSequence(SOLVED_FACELETS, scramble);
    const rotated = x2(facelets);
    // solve in the rotated frame by undoing the (translated) scramble
    // Solving in the rotated frame lands on the rotated SOLVED string (white on
    // the bottom), because no sequence of face turns can rotate the whole cube.
    const invScramble = scramble.slice().reverse().map(invert);
    const rotatedSolution = renameMoves(invScramble);
    assert.equal(applyMoveSequence(rotated, rotatedSolution), x2(SOLVED_FACELETS));
    // Translating that solution back solves the cube in the user's frame.
    const back = renameMoves(rotatedSolution);
    assert.equal(back.join(' '), invScramble.join(' '));
    assert.equal(applyMoveSequence(facelets, back), SOLVED_FACELETS);
  }
});

function invert(mv) {
  const f = mv[0], suffix = mv.slice(1);
  if (suffix === '2') return f + '2';
  if (suffix === "'") return f;
  return f + "'";
}

test('y rotations cycle F -> R -> B -> L', () => {
  assert.equal(y(y(y(y(SOLVED_FACELETS)))), SOLVED_FACELETS);
  assert.equal(y2(SOLVED_FACELETS), y(y(SOLVED_FACELETS)));
});

test('every slot is solved on a solved cube, however it is rotated', () => {
  for (const rot of [x2, y, y2]) {
    const s = rot(SOLVED_FACELETS);
    for (const name of Object.keys(SLOTS)) {
      assert.ok(slotSolved(s, name), `${name} should be solved`);
    }
  }
});

test('slot coordinates agree with the move engine geometry', () => {
  // Each slot's stickers must sit on the cubie that occupies that position.
  for (const name of Object.keys(SLOTS)) {
    const slot = SLOTS[name];
    for (const sticker of slot.stickers) {
      const info = FACELET_INFO[sticker.index];
      assert.equal(info.slot, CUBIES.findIndex((c) => c.pos.join(',') === slot.pos.join(',')),
        `${name} sticker on ${sticker.face}`);
      assert.equal(info.face, sticker.face);
    }
  }
});

test('findPiece locates a piece and slotSolved detects a broken one', () => {
  const s = applyMove(SOLVED_FACELETS, 'R');
  assert.ok(!slotSolved(s, 'UFR'));
  const where = findPiece(s, 'UFR');
  assert.equal(where.length, 1);
  assert.ok(!slotSolved(s, where[0]));
});

test('predicates agree with the cube they describe', () => {
  const std = x2(SOLVED_FACELETS);
  assert.ok(crossSolved(std, 'D'));
  assert.ok(f2lSolved(std));
  assert.ok(isUniform(std));
  const moved = applyMove(std, 'R');
  assert.ok(!f2lSolved(moved));
  assert.ok(!isUniform(moved));
});

test('isLegalCube rejects impossible colour counts', () => {
  assert.ok(isLegalCube(SOLVED_FACELETS));
  const bad = SOLVED_FACELETS.split('');
  bad[0] = 'R'; bad[10] = 'U';
  assert.ok(!isLegalCube(bad.join('')));
  assert.ok(!isLegalCube('nonsense'));
});

console.log(`\n${passed} cube-ops checks passed`);
