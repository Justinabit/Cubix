/**
 * beginner.test.mjs — end-to-end check of the layer-by-layer method.
 *
 * The beginner solver is built from algorithms that were discovered by search,
 * so the only meaningful test is "solve lots of random cubes and confirm every
 * stage goal was actually met".
 *
 * Run: node tests/beginner.test.mjs [trials]
 */
import assert from 'node:assert/strict';
import {
  SOLVED_FACELETS, applyMoveSequence, randomScramble, isSolved, FACE_NAMES,
} from '../js/core/cube-model.js';
import {
  solveBeginner, simplify,
} from '../js/solver/beginner.js';
import * as O from '../js/core/cube-ops.js';

/* ------------------------------------------------------------------ *
 * Stage goals, expressed exactly as the UI describes them
 * ------------------------------------------------------------------ */

const CROSS = ['DF', 'DR', 'DB', 'DL'];
const CORNERS = ['DFR', 'DBR', 'DBL', 'DFL'];
const MIDDLE = ['FR', 'BR', 'BL', 'FL'];
const U_EDGES = ['UF', 'UR', 'UB', 'UL'];
const U_CORNERS = ['UFR', 'UBR', 'UBL', 'UFL'];

const allSolved = (s, names) => names.every((n) => O.slotSolved(s, n));

function stageGoalMet(state, index) {
  switch (index) {
    case 0: return allSolved(state, CROSS);
    case 1: return allSolved(state, CROSS) && allSolved(state, CORNERS);
    case 2: return O.f2lSolved(state);
    case 3: return O.f2lSolved(state) && U_EDGES.every((n) => {
      const u = O.center(state, 'U');
      const st = O.SLOTS[n].stickers.find((x) => x.face === 'U');
      return O.at(state, 'U', st.row, st.col) === u;
    });
    case 4: return O.f2lSolved(state) && allSolved(state, U_EDGES);
    case 5: return O.f2lSolved(state) && allSolved(state, U_EDGES)
      && U_CORNERS.every((n) => O.slotHasRightPiece(state, n));
    case 6: return FACE_NAMES.every((f) => O.faceSolved(state, f));
    default: throw new Error('unknown stage ' + index);
  }
}


const TRIALS = Number(process.argv[2] || 60);
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('  ok  ' + name); };

console.log(`beginner method (${TRIALS} random cubes)`);

test('every stage goal is met, in order, and the cube ends up solved', () => {
  let failures = 0;
  const lengths = [];
  for (let i = 0; i < TRIALS; i++) {
    const scramble = randomScramble(25);
    const facelets = applyMoveSequence(SOLVED_FACELETS, scramble);
    const result = solveBeginner(facelets);
    assert.ok(result, `trial ${i}: the method gave up`);
    assert.equal(result.failedAt, -1,
      `trial ${i}: stage ${result.failedAt} could not be completed`);

    // Replay stage by stage and check each goal really holds at that moment.
    let state = O.x2(facelets);
    for (let s = 0; s < result.stages.length; s++) {
      for (const entry of result.stages[s].moves) {
        state = applyMoveSequence(state, O.renameMoves(entry.moves, O.RENAME_X2));
      }
      assert.ok(stageGoalMet(state, s), `trial ${i}: stage ${s} (${result.stages[s].id}) goal not met`);
    }
    // and the whole cube is finished
    const final = applyMoveSequence(facelets, result.moves);
    assert.ok(isSolved(final), `trial ${i}: cube not solved at the end`);
    lengths.push(result.moves.length);
    if (!isSolved(final)) failures++;
  }
  assert.equal(failures, 0);
  console.log(`     solution length: min ${Math.min(...lengths)}, max ${Math.max(...lengths)}, ` +
    `avg ${(lengths.reduce((a, b) => a + b, 0) / lengths.length).toFixed(1)} moves`);
});

test('stage explanations and move grouping are well formed', () => {
  const facelets = applyMoveSequence(SOLVED_FACELETS, randomScramble(25));
  const result = solveBeginner(facelets);
  assert.equal(result.stages.length, 7);
  for (const stage of result.stages) {
    assert.ok(stage.title && stage.goal, 'each stage needs a title and a goal');
    for (const entry of stage.moves) {
      assert.ok(entry.explanation, 'every step needs a plain-English explanation');
      assert.ok(entry.moves.length > 0, 'every step needs at least one move');
      for (const mv of entry.moves) assert.match(mv, /^[URFDLB](2|')?$/);
    }
  }
});

test('the simplifier collapses redundant moves', () => {
  assert.deepEqual(simplify(["R", "R'"]), []);
  assert.deepEqual(simplify(['R', 'R']), ['R2']);
  assert.deepEqual(simplify(['R', 'R2']), ["R'"]);
  assert.deepEqual(simplify(['R', "R'", 'F']), ['F']);
  assert.deepEqual(simplify(['R', 'F']), ['R', 'F']);
});

test('an already solved cube needs no moves', () => {
  const result = solveBeginner(SOLVED_FACELETS);
  assert.equal(result.failedAt, -1);
  assert.equal(result.moves.length, 0);
});

console.log(`\n${passed} beginner checks passed`);
