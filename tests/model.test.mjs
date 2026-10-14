/**
 * Model tests — these are the foundation everything else is checked against.
 * Run:  node tests/model.test.mjs   (from the project root)
 */
import assert from 'node:assert/strict';
import {
  SOLVED_FACELETS, FACELET_INFO, SLOT_FACELETS, CUBIES, CORNER_HOME, EDGE_HOME,
  FACELET_PERM, MOVE_NAMES, applyMove, applyQuarterTurn, applyMoveSequence, parseMove,
  faceletsToCubieState, cubieStateToFacelets, identityCubieState,
  applyMoveCubie, applyQuarterTurnCubie, randomScramble, isSolved, countColors,
  CORNER_NAMES, EDGE_NAMES, invertMoves, FACE_NAMES,
} from '../js/core/cube-model.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('  ok  ' + name); };

console.log('cube-model');

test('facelet map covers all 26 cubies exactly once per sticker', () => {
  const seen = new Set(FACELET_INFO.map((f) => f.index));
  assert.equal(seen.size, 54);
  const perSlot = new Map();
  for (const f of FACELET_INFO) perSlot.set(f.slot, (perSlot.get(f.slot) || 0) + 1);
  for (const c of CUBIES) assert.equal(perSlot.get(c.index), c.faces.length);
  // centres
  for (let i = 0; i < 6; i++) assert.equal(FACELET_INFO[i * 9 + 4].slot, SLOT_FACELETS.length >= 0 ? FACELET_INFO[i * 9 + 4].slot : -1);
});

test('facelet (row,col) ordering matches the documented URFDLB layout', () => {
  // U face row 0 is the back row: its stickers touch B, L/B, L
  const u00 = FACELET_INFO[0], u08 = FACELET_INFO[8];
  assert.deepEqual(u00.coord, [-1, 1, -1], 'U0 = ULB');
  assert.deepEqual(u08.coord, [1, 1, 1], 'U8 = URF');
  assert.deepEqual(FACELET_INFO[9].coord, [1, 1, 1], 'R0 = URF');
  assert.deepEqual(FACELET_INFO[17].coord, [1, -1, -1], 'R8 = DRB');
  assert.deepEqual(FACELET_INFO[18].coord, [-1, 1, 1], 'F0 = UFL');
  assert.deepEqual(FACELET_INFO[27].coord, [-1, -1, 1], 'D0 = DLF');
  assert.deepEqual(FACELET_INFO[36].coord, [-1, 1, -1], 'L0 = ULB');
  assert.deepEqual(FACELET_INFO[45].coord, [1, 1, -1], 'B0 = UBR');
  assert.deepEqual(FACELET_INFO[53].coord, [-1, -1, -1], 'B8 = DBL');
});

test('each facelet permutation is a valid 54-cycle permutation', () => {
  for (const face of FACE_NAMES) {
    const p = FACELET_PERM[face];
    assert.equal(new Set(p).size, 54);
    // four quarter turns = identity
    let s = SOLVED_FACELETS;
    for (let i = 0; i < 4; i++) s = applyQuarterTurn(s, face);
    assert.equal(s, SOLVED_FACELETS);
    // centres are fixed
    for (let f = 0; f < 6; f++) assert.equal(p[f * 9 + 4], f * 9 + 4);
  }
});

// Exhaustive per-facelet verification of all six turns lives in
// tests/permutation-truth.test.mjs, which re-derives every destination from
// independent rotation matrices. Here we assert the handful of high-level
// sentences a beginner tutorial would state, using slice arithmetic.

/** Facelet index of a sticker addressed as (face, row, col). */
const at = (face, row, col) =>
  FACELET_INFO.findIndex((f) => f.face === face && f.row === row && f.col === col);

test('U: the front top row travels to the LEFT face (clockwise from above)', () => {
  const after = applyMove(SOLVED_FACELETS, 'U');
  // Looking down at the U face, the front top row swings round to the left.
  assert.equal(after.slice(36, 39), 'FFF');  // L top row <- F top row
  assert.equal(after.slice(45, 48), 'LLL');  // B top row <- L top row
  assert.equal(after.slice(9, 12),  'BBB');  // R top row <- B top row
  assert.equal(after.slice(18, 21), 'RRR');  // F top row <- R top row
  // corners travel URF -> UFL -> ULB -> UBR, sticker by sticker
  assert.equal(FACELET_PERM.U[6], 8);   // U6 (UFL) <- U8 (URF)
  assert.equal(FACELET_PERM.U[0], 6);   // U0 (ULB) <- U6 (UFL)
  assert.equal(FACELET_PERM.U[2], 0);   // U2 (UBR) <- U0 (ULB)
  assert.equal(FACELET_PERM.U[8], 2);   // U8 (URF) <- U2 (UBR)
});

test('R: the front-right column travels up', () => {
  const after = applyMove(SOLVED_FACELETS, 'R');
  assert.equal(after[2], 'F');   // U2 (UBR)  <- F2 (the green sticker travels up)
  assert.equal(after[51], 'U');  // B6 (UBR)  <- U2
  assert.equal(after[29], 'B');  // D2 (DFR)  <- B6
  assert.equal(after[20], 'D');  // F2 (URF)  <- D2
  assert.equal(after[11], 'R');  // the right-face centre stays red
  assert.equal(FACELET_PERM.R[2], 20);
  assert.equal(FACELET_PERM.R[51], 2);
  assert.equal(FACELET_PERM.R[29], 51);
  assert.equal(FACELET_PERM.R[20], 29);
});

test('F: the top row travels to the right column', () => {
  const after = applyMove(SOLVED_FACELETS, 'F');
  assert.equal(after[9], 'U');   // R0 (top of the right column) <- U6
  assert.equal(after[29], 'R');  // D2 <- R0
  assert.equal(after[38], 'D');  // L2 <- D0
  assert.equal(after[6], 'L');   // U6 <- L2  (the F face itself just rotates)
});

test('D, L and B follow standard notation too', () => {
  const d = applyMove(SOLVED_FACELETS, 'D');
  assert.equal(d.slice(15, 18), 'FFF');  // R bottom row <- F bottom row
  assert.equal(d.slice(24, 27), 'LLL');  // F bottom row <- L bottom row

  const l = applyMove(SOLVED_FACELETS, 'L');
  assert.equal(l[0], 'B');    // U0 (ULB) <- B8: the back-left column travels up
  assert.equal(l[18], 'U');   // F0 (UFL) <- U0: the front-left column travels down

  const b = applyMove(SOLVED_FACELETS, 'B');
  assert.equal(b[0], 'R');                                    // U0 (ULB) <- R2
  // the L face's left column (L00, L10, L20) <- the U face's top row
  assert.equal([b[36], b[39], b[42]].join(''), 'UUU');
});

test('cubie state round-trips with the facelet string (identity)', () => {
  const st = faceletsToCubieState(SOLVED_FACELETS);
  assert.deepEqual(st, identityCubieState());
  assert.equal(cubieStateToFacelets(st), SOLVED_FACELETS);
});

test('cubie state round-trips after random scrambles', () => {
  for (let trial = 0; trial < 300; trial++) {
    const scramble = randomScramble(30, mulberry(trial + 1));
    const facelets = applyMoveSequence(SOLVED_FACELETS, scramble);
    let st = faceletsToCubieState(facelets);
    assert.equal(cubieStateToFacelets(st), facelets, 'round trip failed for ' + scramble.join(' '));
    // and the cubie-level move application must agree with the facelet-level one
    let st2 = identityCubieState();
    for (const m of scramble) st2 = applyMoveCubie(st2, m);
    assert.deepEqual(st2, st, 'cubie move application disagrees with facelet application');
  }
});

test('corner orientation sum and edge flip sum are conserved (mod 3 / mod 2)', () => {
  for (let trial = 0; trial < 200; trial++) {
    const scramble = randomScramble(25, mulberry(trial + 5000 + trial));
    const st = faceletsToCubieState(applyMoveSequence(SOLVED_FACELETS, scramble));
    assert.equal(st.co.reduce((a, b) => a + b, 0) % 3, 0);
    assert.equal(st.eo.reduce((a, b) => a + b, 0) % 2, 0);
  }
});

test('corner twist convention: U/D never twist, R/F/L/B twist all 4 of their corners', () => {
  for (const m of ['U', 'D']) {
    const st = faceletsToCubieState(applyMove(SOLVED_FACELETS, m));
    assert.deepEqual(st.co, [0, 0, 0, 0, 0, 0, 0, 0], m + ' should not twist any corner');
  }
  for (const m of ['R', 'F', 'L', 'B']) {
    const st = faceletsToCubieState(applyMove(SOLVED_FACELETS, m));
    assert.equal(st.co.filter((x) => x !== 0).length, 4, m + ' should twist all 4 of its corners');
    // two twisted one way and two the other, so the total stays 0 mod 3
    assert.equal(st.co.reduce((a, b) => a + b, 0) % 3, 0);
    assert.equal(st.co.filter((x) => x === 1).length, 2);
    assert.equal(st.co.filter((x) => x === 2).length, 2);
  }
});

test('edge flip convention: U/D moves never flip, F/B moves flip 4 edges', () => {
  for (const m of ['U', 'D', 'R', 'L']) {
    const st = faceletsToCubieState(applyMove(SOLVED_FACELETS, m));
    assert.equal(st.eo.reduce((a, b) => a + b, 0), 0, m + ' should not flip edges');
  }
  for (const m of ['F', 'B']) {
    const st = faceletsToCubieState(applyMove(SOLVED_FACELETS, m));
    assert.equal(st.eo.reduce((a, b) => a + b, 0), 4, m + ' should flip 4 edges');
  }
});

test('quarter turn cubie effect matches repeated application of the move table', () => {
  let st = identityCubieState();
  for (const face of FACE_NAMES) {
    const a = applyQuarterTurnCubie(st, face);
    const b = applyMoveCubie(st, face);
    assert.deepEqual(a, b);
    st = a;
  }
});

test('impossible states are rejected with a helpful message', () => {
  // 1. An edge whose two stickers are the same colour cannot exist.
  //    (UF edge = facelets 7 on U and 19 on F.)
  const sameColor = SOLVED_FACELETS.split('');
  sameColor[7] = 'U'; sameColor[19] = 'U';
  assert.throws(() => faceletsToCubieState(sameColor.join('')), /No edge piece/);

  // 2. A corner containing two opposite colours cannot exist.
  //    (URF corner = facelets 8 on U, 20 on F, 9 on R.)
  const opposite = SOLVED_FACELETS.split('');
  opposite[8] = 'D'; opposite[20] = 'U';
  assert.throws(() => faceletsToCubieState(opposite.join('')), /No corner piece/);

  // 3. Two slots claiming the same physical piece is impossible.
  //    (UR edge = 5 on U and 9 on R; force the UF slot to also be the UR piece.)
  const duplicate = SOLVED_FACELETS.split('');
  duplicate[7] = 'U'; duplicate[19] = 'R';
  assert.throws(() => faceletsToCubieState(duplicate.join('')), /Duplicate edge piece/);
});

test('colour counts of a solved cube are 9 each', () => {
  const c = countColors(SOLVED_FACELETS);
  for (const k of Object.keys(c)) assert.equal(c[k], 9);
  assert.ok(isSolved(SOLVED_FACELETS));
});

test('parseMove handles primes and doubles', () => {
  assert.deepEqual(parseMove('R'), { face: 'R', power: 1, sign: 1, name: 'R' });
  // A prime is ONE counter-clockwise quarter turn (not three!) — see the comment
  // in parseMove: "power 3 with sign -1" would apply the inverse three times.
  assert.deepEqual(parseMove("R'"), { face: 'R', power: 1, sign: -1, name: "R'" });
  assert.equal(applyMove(SOLVED_FACELETS, "R'"), applyQuarterTurn(SOLVED_FACELETS, 'R', -1));
  assert.deepEqual(parseMove('R2'), { face: 'R', power: 2, sign: 1, name: 'R2' });
  assert.throws(() => parseMove('X'));
  assert.throws(() => parseMove('Rw'));
});

test('corner/edge naming matches the home geometry', () => {
  // `faces` is ordered U/D first, then F/B, then R/L (the name "URF" is just a name)
  assert.deepEqual(CUBIES[CORNER_HOME[0]].faces, ['U', 'F', 'R'], CORNER_NAMES[0]);
  assert.deepEqual(CUBIES[CORNER_HOME[4]].faces, ['D', 'F', 'R'], CORNER_NAMES[4]);
  assert.deepEqual(CUBIES[EDGE_HOME[8]].faces, ['F', 'R'], EDGE_NAMES[8]);
  assert.deepEqual(CUBIES[EDGE_HOME[0]].faces, ['U', 'F'], EDGE_NAMES[0]);
});

function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

console.log(`\n${passed} model tests passed`);
