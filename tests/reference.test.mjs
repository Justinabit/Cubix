/**
 * reference.test.mjs — checks the move engine against external ground truth.
 *
 * The model derives its move tables geometrically, which is elegant but means a
 * single wrong sign can survive every *internal* consistency check (a cube with
 * U inverted is still a perfectly self-consistent cube — just not the one in the
 * user's hands). This file pins the tables to facts from outside the codebase.
 *
 * Run: node tests/reference.test.mjs
 */
import assert from 'node:assert/strict';
import {
  SOLVED_FACELETS, applyMove, applyMoveSequence, tokenizeMoves,
  FACE_NAMES, FACELET_PERM, MOVE_NAMES, randomScramble, isSolved,
} from '../js/core/cube-model.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('  ok  ' + name); };

console.log('reference checks');

/* ------------------------------------------------------------------ *
 * 1. Facelet strings for all 18 moves, transcribed from cubejs 1.3.2
 *    (https://www.npmjs.com/package/cubejs, MIT). These were captured by
 *    running:  Cube.fromString(SOLVED).move(m).asString()
 * ------------------------------------------------------------------ */
const CUBEJS = {
  U:  'UUUUUUUUUBBBRRRRRRRRRFFFFFFDDDDDDDDDFFFLLLLLLLLLBBBBBB',
  "U'": 'UUUUUUUUUFFFRRRRRRLLLFFFFFFDDDDDDDDDBBBLLLLLLRRRBBBBBB',
  U2: 'UUUUUUUUULLLRRRRRRBBBFFFFFFDDDDDDDDDRRRLLLLLLFFFBBBBBB',
  R:  'UUFUUFUUFRRRRRRRRRFFDFFDFFDDDBDDBDDBLLLLLLLLLUBBUBBUBB',
  "R'": 'UUBUUBUUBRRRRRRRRRFFUFFUFFUDDFDDFDDFLLLLLLLLLDBBDBBDBB',
  R2: 'UUDUUDUUDRRRRRRRRRFFBFFBFFBDDUDDUDDULLLLLLLLLFBBFBBFBB',
  F:  'UUUUUULLLURRURRURRFFFFFFFFFRRRDDDDDDLLDLLDLLDBBBBBBBBB',
  "F'": 'UUUUUURRRDRRDRRDRRFFFFFFFFFLLLDDDDDDLLULLULLUBBBBBBBBB',
  F2: 'UUUUUUDDDLRRLRRLRRFFFFFFFFFUUUDDDDDDLLRLLRLLRBBBBBBBBB',
  D:  'UUUUUUUUURRRRRRFFFFFFFFFLLLDDDDDDDDDLLLLLLBBBBBBBBBRRR',
  "D'": 'UUUUUUUUURRRRRRBBBFFFFFFRRRDDDDDDDDDLLLLLLFFFBBBBBBLLL',
  D2: 'UUUUUUUUURRRRRRLLLFFFFFFBBBDDDDDDDDDLLLLLLRRRBBBBBBFFF',
  L:  'BUUBUUBUURRRRRRRRRUFFUFFUFFFDDFDDFDDLLLLLLLLLBBDBBDBBD',
  "L'": 'FUUFUUFUURRRRRRRRRDFFDFFDFFBDDBDDBDDLLLLLLLLLBBUBBUBBU',
  L2: 'DUUDUUDUURRRRRRRRRBFFBFFBFFUDDUDDUDDLLLLLLLLLBBFBBFBBF',
  B:  'RRRUUUUUURRDRRDRRDFFFFFFFFFDDDDDDLLLULLULLULLBBBBBBBBB',
  "B'": 'LLLUUUUUURRURRURRUFFFFFFFFFDDDDDDRRRDLLDLLDLLBBBBBBBBB',
  B2: 'DDDUUUUUURRLRRLRRLFFFFFFFFFDDDDDDUUURLLRLLRLLBBBBBBBBB',
};

test('all 18 face turns reproduce the cubejs 1.3.2 facelet strings', () => {
  for (const [move, expected] of Object.entries(CUBEJS)) {
    assert.equal(applyMove(SOLVED_FACELETS, move), expected, `move ${move}`);
  }
});

/* ------------------------------------------------------------------ *
 * 2. Well-known orders of move sequences (group-theory facts that any
 *    bug in a face turn would break).
 * ------------------------------------------------------------------ */
function order(seq, limit = 1400) {
  let s = SOLVED_FACELETS;
  for (let n = 1; n <= limit; n++) {
    s = applyMoveSequence(s, tokenizeMoves(seq));
    if (s === SOLVED_FACELETS) return n;
  }
  return null;
}

test('move sequences have their known orders in the cube group', () => {
  assert.equal(order('R'), 4);
  assert.equal(order('R U R\' U\''), 6, 'the "sexy move" has order 6');
  assert.equal(order('R U\' R\' U'), 6);
  assert.equal(order('R2 U2'), 6);
  assert.equal(order('R U R\' U R U2 R\''), 6, 'Sune has order 6');
  assert.equal(order('R U'), 105, 'R U has order 105');
  assert.equal(order('F R'), 105, 'F R has the same order as R U (adjacent faces)');
  assert.equal(order('R U2 D\' B D\''), 1260, 'the maximum order in the cube group');
  assert.equal(order("R U R' U' R' F R F' R U R' U' R' F R F'"), 3, 'Bruno repeated thrice');
});

test('the two adjacent-face products R U and F R are conjugate-symmetric', () => {
  // Any two adjacent faces are related by a symmetry of the cube, so R·U and
  // F·R must have the same order. This catches a single inverted face.
  const seq = (a, b) => order(`${a} ${b}`);
  const pairs = [['R', 'U'], ['F', 'R'], ['U', 'L'], ['D', 'F'], ['B', 'U'], ['L', 'B']];
  const orders = pairs.map(([a, b]) => seq(a, b));
  assert.ok(new Set(orders).size === 1, `adjacent-face orders differ: ${orders.join(',')}`);
  assert.equal(orders[0], 105);
});

/* ------------------------------------------------------------------ *
 * 3. Structural invariants
 * ------------------------------------------------------------------ */

test('each face turn is a permutation whose fourth power is the identity', () => {
  for (const face of MOVE_NAMES) {
    let s = SOLVED_FACELETS;
    for (let i = 0; i < 4; i++) s = applyMove(s, face);
    assert.equal(s, SOLVED_FACELETS, `${face}4 should be identity`);
    assert.equal(new Set(FACELET_PERM[face]).size, 54);
  }
});

test("a move followed by its inverse is the identity", () => {
  for (const face of MOVE_NAMES) {
    assert.equal(applyMove(applyMove(SOLVED_FACELETS, face), face + "'"), SOLVED_FACELETS);
    assert.equal(applyMove(applyMove(SOLVED_FACELETS, face + '2'), face + '2'), SOLVED_FACELETS);
  }
});

test('random scrambles are always undone by their inverse', () => {
  for (let i = 0; i < 50; i++) {
    const scramble = randomScramble(20);
    const s = applyMoveSequence(SOLVED_FACELETS, scramble);
    assert.ok(!isSolved(s), 'a 20 move scramble should not leave the cube solved');
    const back = applyMoveSequence(s, scramble.slice().reverse().map((m) => {
      const f = m[0], suffix = m.slice(1);
      if (suffix === '2') return f + '2';
      if (suffix === "'") return f;
      return f + "'";
    }));
    assert.equal(back, SOLVED_FACELETS);
  }
});

test('the six centres never move', () => {
  for (const face of MOVE_NAMES) {
    const after = applyMove(SOLVED_FACELETS, face);
    for (let f = 0; f < 6; f++) {
      assert.equal(after[f * 9 + 4], FACE_NAMES[f]);
    }
  }
});

console.log(`\n${passed} reference checks passed`);
