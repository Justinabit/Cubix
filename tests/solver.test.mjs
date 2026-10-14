/**
 * solver.test.mjs — the Kociemba two-phase solver.
 *
 * The property that matters is not elegance but "does it actually solve the
 * cube", so this throws a lot of random cubes at it and verifies the result by
 * applying it. It also checks the solver finds genuinely short solutions for
 * cases with a known optimum.
 *
 * Run: node tests/solver.test.mjs [trials]
 */
import assert from 'node:assert/strict';
import {
  SOLVED_FACELETS, applyMoveSequence, tokenizeMoves, randomScramble,
  isSolved, faceletsToCubieState, invertMoves,
} from '../js/core/cube-model.js';
import { simplify, solveFacelets, getSolver } from '../js/solver/kociemba.js';
import {
  getTwist, getFlip, getSlice, getCPerm, getEPerm, getMPerm,
  setTwist, setFlip, setSlice, setCPerm, setEPerm, setMPerm,
} from '../js/solver/kociemba.js';

const TRIALS = Number(process.argv[2] || 40);
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('  ok  ' + name); };

console.log(`solver (${TRIALS} random cubes)`);

const solver = getSolver();          // the same instance the app uses
const t0 = Date.now();
await solver.build();
console.log(`     tables built in ${Date.now() - t0}ms`);

test('coordinate encodings round-trip over their whole range', () => {
  // Every coordinate must survive encode -> decode -> encode unchanged,
  // otherwise the pruning tables are indexing the wrong states.
  for (let i = 0; i < 2187; i += 13) assert.equal(getTwist(setTwist(i)), i, `twist ${i}`);
  for (let i = 0; i < 2048; i += 7) assert.equal(getFlip(setFlip(i)), i, `flip ${i}`);
  for (let i = 0; i < 495; i += 3) assert.equal(getSlice(setSlice(i)), i, `slice ${i}`);
  for (let i = 0; i < 40320; i += 271) assert.equal(getCPerm(setCPerm(i)), i, `cperm ${i}`);
  for (let i = 0; i < 40320; i += 271) assert.equal(getEPerm(setEPerm(i)), i, `eperm ${i}`);
  for (let i = 0; i < 24; i++) assert.equal(getMPerm(setMPerm(i)), i, `mperm ${i}`);
});

test('the solved cube sits at coordinate zero in every phase', () => {
  const solved = faceletsToCubieState(SOLVED_FACELETS);
  assert.equal(getTwist(solved), 0);
  assert.equal(getFlip(solved), 0);
  assert.equal(getCPerm(solved), 0);
  assert.equal(getEPerm(solved), 0);
  assert.equal(getMPerm(solved), 0);
  assert.notEqual(getSlice(solved), 0, 'the slice coordinate is a combination rank, not a distance');
  // ...but it must be the value the pruning tables treat as home.
  assert.equal(solver.pruneTwistSlice[0 * 495 + getSlice(solved)], 0);
  assert.equal(solver.pruneFlipSlice[0 * 495 + getSlice(solved)], 0);
});

test('an already solved cube needs no moves', () => {
  assert.deepEqual(solver.solve(faceletsToCubieState(SOLVED_FACELETS)), []);
});

test('random scrambles are solved correctly', () => {
  const lengths = [];
  for (let i = 0; i < TRIALS; i++) {
    const scramble = randomScramble(30);
    const facelets = applyMoveSequence(SOLVED_FACELETS, scramble);
    const solution = solver.solve(faceletsToCubieState(facelets));
    assert.ok(solution, `trial ${i}: no solution found`);
    assert.ok(solution.length > 0, `trial ${i}: empty solution for a scrambled cube`);
    assert.ok(isSolved(applyMoveSequence(facelets, solution)),
      `trial ${i}: solution did not solve the cube (${solution.join(' ')})`);
    lengths.push(solution.length);
  }
  const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  console.log(`     length: min ${Math.min(...lengths)}, max ${Math.max(...lengths)}, avg ${avg.toFixed(1)} moves`);
  assert.ok(avg <= 24, `average solution ${avg.toFixed(1)} moves is too long`);
});

test('solutions are optimal for short, known cases', () => {
  const cases = [
    ["R U R' U'", 4],                 // the sexy move has order 6; inverse is 4 moves
    ["R U R' U R U2 R'", 7],          // Sune: the inverse is the shortest fix
    ['R2 U2 R2 U2 R2 U2', 6],
    ['R', 1],
    ["R'", 1],
    ['R2', 1],
  ];
  for (const [scramble, expected] of cases) {
    const facelets = applyMoveSequence(SOLVED_FACELETS, tokenizeMoves(scramble));
    const solution = solver.solve(faceletsToCubieState(facelets));
    assert.equal(solution.length, expected,
      `"${scramble}": expected ${expected} moves, got ${solution.length} (${solution.join(' ')})`);
  }
});

test('a solved cube is recognised without searching', () => {
  assert.deepEqual(solver.solve(faceletsToCubieState(SOLVED_FACELETS)), []);
});

test('simplify() removes redundant pairs', () => {
  assert.deepEqual(simplify(['R', "R'"]), []);
  assert.deepEqual(simplify(['R', 'R']), ['R2']);
  assert.deepEqual(simplify(['R', 'R2']), ["R'"]);
  assert.deepEqual(simplify(['R', "R'", 'U']), ['U']);
  assert.deepEqual(simplify(['R', 'R2', 'R2']), ['R']);
});

test('solveFacelets uses the one shared, already-built solver', () => {
  const singleton = getSolver();
  assert.equal(singleton, solver, 'the solver instance is reused so tables build once');
  assert.ok(singleton.ready);
  const scramble = randomScramble(20);
  const facelets = applyMoveSequence(SOLVED_FACELETS, scramble);
  const solution = solveFacelets(facelets, faceletsToCubieState(facelets));
  assert.ok(isSolved(applyMoveSequence(facelets, solution)));
});

test('inverting a solution and applying it to a solved cube scrambles correctly', () => {
  const scramble = randomScramble(15);
  const facelets = applyMoveSequence(SOLVED_FACELETS, scramble);
  const solution = solver.solve(faceletsToCubieState(facelets));
  // Applying the solution then its inverse must return to the scrambled state.
  const back = applyMoveSequence(applyMoveSequence(facelets, solution), invertMoves(solution));
  assert.equal(back, facelets);
});

console.log(`\n${passed} solver checks passed`);
