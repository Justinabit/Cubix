/**
 * ll-lab.mjs — characterise last-layer algorithms empirically.
 *
 * Instead of trusting remembered algorithms, we test each candidate on several
 * F2L-solved cubes and print exactly what it does to the last layer. The
 * beginner solver then only uses algorithms that this file proved to be
 * F2L-preserving, and tests/ verifies the generator set spans all 62208
 * last-layer states.
 *
 * Run: node tools/ll-lab.mjs
 */
import {
  SOLVED_FACELETS, FACE_NAMES, applyMove, applyMoveSequence, tokenizeMoves,
} from '../js/core/cube-model.js';

/* ---------- colour helpers (frame independent) ---------- */
const idx = (face, row, col) => FACE_NAMES.indexOf(face) * 9 + row * 3 + col;
const at = (s, face, row, col) => s[idx(face, row, col)];
const center = (s, face) => at(s, face, 1, 1);
const faceSolved = (s, face) => {
  const b = FACE_NAMES.indexOf(face) * 9, c = s[b + 4];
  for (let i = 0; i < 9; i++) if (s[b + i] !== c) return false;
  return true;
};
function f2lSolved(s) {
  if (!faceSolved(s, 'D')) return false;
  for (const f of ['F', 'R', 'B', 'L']) {
    const c = center(s, f);
    if (at(s, f, 1, 0) !== c || at(s, f, 1, 2) !== c) return false;
    if (at(s, f, 2, 0) !== c || at(s, f, 2, 1) !== c || at(s, f, 2, 2) !== c) return false;
  }
  return true;
}
const solved = (s) => FACE_NAMES.every((f) => faceSolved(s, f));

/** Last-layer signature: which piece sits in each U slot and whether it's oriented. */
function llSignature(s) {
  const u = center(s, 'U');
  const edges = {
    UF: [at(s, 'U', 2, 1), at(s, 'F', 0, 1)],
    UR: [at(s, 'U', 1, 2), at(s, 'R', 0, 1)],
    UB: [at(s, 'U', 0, 1), at(s, 'B', 0, 1)],
    UL: [at(s, 'U', 1, 0), at(s, 'L', 0, 1)],
  };
  const corners = {
    URF: [at(s, 'U', 2, 2), at(s, 'R', 0, 0), at(s, 'F', 0, 2)],
    UFL: [at(s, 'U', 2, 0), at(s, 'F', 0, 0), at(s, 'L', 0, 2)],
    ULB: [at(s, 'U', 0, 0), at(s, 'L', 0, 0), at(s, 'B', 0, 2)],
    UBR: [at(s, 'U', 0, 2), at(s, 'B', 0, 0), at(s, 'R', 0, 2)],
  };
  const sig = [];
  for (const [slot, cols] of Object.entries(edges)) {
    const [uc, sc] = cols;
    const home = slot;                       // where this colour pair belongs
    const target = [u, center(s, slot === 'UF' ? 'F' : slot === 'UR' ? 'R' : slot === 'UB' ? 'B' : 'L')];
    const correct = cols.slice().sort().join('') === target.slice().sort().join('');
    sig.push(`${slot}:${uc === u ? 'o' : '-'}${correct ? '*' : ''}`);
    void home;
  }
  for (const [slot, cols] of Object.entries(corners)) {
    const faces = [slot[0] === 'U' ? 'U' : 'D', ...slot.slice(1).split('')];
    void faces;
    const uCenter = u, s1 = center(s, slot[1]), s2 = center(s, slot[2]);
    const correct = cols.slice().sort().join('') === [uCenter, s1, s2].sort().join('');
    const oriented = cols[0] === u;
    sig.push(`${slot}:${oriented ? 'o' : '-'}${correct ? '*' : ''}`);
  }
  return sig.join(' ');
}

/* ---------- x2 rotation: put white on the bottom (standard LL frame) ---------- */
const AXIS_OF = { U: [0, 1, 0], R: [1, 0, 0], F: [0, 0, 1], D: [0, -1, 0], L: [-1, 0, 0], B: [0, 0, -1] };
const COORD_OF = {};
for (const face of FACE_NAMES) {
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    let v;
    if (face === 'U') v = [c - 1, 1, r - 1];
    else if (face === 'R') v = [1, 1 - r, 1 - c];
    else if (face === 'F') v = [c - 1, 1 - r, 1];
    else if (face === 'D') v = [c - 1, -1, 1 - r];
    else if (face === 'L') v = [-1, 1 - r, c - 1];
    else v = [1 - c, 1 - r, -1];
    COORD_OF[idx(face, r, c)] = { coord: v, face };
  }
}
function rotateCube(state, map) {
  const table = new Map();
  for (let i = 0; i < 54; i++) {
    const { coord, face } = COORD_OF[i];
    const p = map(coord), d = map(AXIS_OF[face]);
    table.set(p.join(',') + '|' + d.join(','), state[i]);
  }
  const out = new Array(54);
  for (let i = 0; i < 54; i++) {
    const { coord, face } = COORD_OF[i];
    out[i] = table.get(coord.join(',') + '|' + AXIS_OF[face].join(','));
  }
  return out.join('');
}
export const x2 = (s) => rotateCube(s, ([x, y, z]) => [x, -y, -z]);
// Re-exported from the shared module so the lab and the solver cannot drift.
export { RENAME_X2 } from '../js/core/cube-ops.js';
export const renameMoves = (moves, table = RENAME_X2) =>
  moves.map((m) => {
    const face = m[0], suffix = m.slice(1);
    const target = table[face];
    if (suffix === '') return target;
    if (suffix === '2') return target[0] + '2';
    // prime toggles
    return target.length > 1 ? target[0] : target[0] + "'";
  });

/* ---------- verify the renaming identity: phi(S . m) == phi(S) . r(m) ---------- */
function verifyRenaming() {
  const S0 = SOLVED_FACELETS;
  let ok = true;
  for (const mv of tokenizeMoves("U U' U2 D D' D2 R R' R2 L L' L2 F F' F2 B B' B2")) {
    const lhs = x2(applyMove(S0, mv));
    const rhs = applyMove(x2(S0), renameMoves([mv])[0]);
    if (lhs !== rhs) { ok = false; console.log('   rename mismatch for', mv); }
  }
  console.log('x2 + move renaming identity holds:', ok);
  return ok;
}

/* ---------- candidate last-layer algorithms ---------- */
const CANDIDATES = [
  ['U', "U"], ['U2', "U2"], ["U'", "U'"],
  ['OLL-cross-1', "F R U R' U' F'"],
  ['OLL-cross-2', "F U R U' R' F'"],
  ['Sune', "R U R' U R U2 R'"],
  ['Antisune', "R U2 R' U' R U' R'"],
  ['Sune-left', "L' U' L U' L' U2 L"],
  ['Bruno', "R U R' U' R' F R F'"],
  ['Sledgehammer', "R' F R F'"],
  ['Sexy x2', "R U R' U' R U R' U'"],
  ['T-perm', "R U R' U' R' F R2 U' R' U' R U R' F'"],
  ['Y-perm', "F R U' R' U' R U R' F' R U R' U' R' F R F'"],
  ['Aa-perm', "R' F R' B2 R F' R' B2 R2"],
  ['Ab-perm', "R2 B2 R F R' B2 R F' R"],
  ['Ua-perm', "R U' R U R U R U' R' U' R2"],
  ['Ub-perm', "R2 U R U R' U' R' U' R' U R'"],
  ['H-perm-1', "R2 U2 R U2 R2 U2 R2 U2 R U2 R2"],
  ['H-perm-2', "R L U2 R' L' F' B' U2 F B"],
  ['Z-perm-1', "R' U' R U' R U R U' R' U R U R2 U' R' U2 R"],
  ['Z-perm-2', "M2 U M2 U M' U2 M2 U2 M'"],
  ['J-perm', "R U R' F' R U R' U' R' F R2 U' R' U'"],
  ['Ja-perm', "L' U' L F L' U' L U L F' L2 U L U"],
  ['R-perm', "R U' R' U' R U R D R' U' R D' R' U2 R'"],
  ['V-perm', "R' U R' U' R D' R' D R' U D' R2 U' R2 D R2"],
  ['N-perm-a', "R U R' U R U R' F' R U R' U' R' F R2 U' R' U2 R U' R'"],
  ['corner-twist-1', "R' D' R D"],
  ['corner-twist-2', "R D R' D'"],
  ['corner-twist-sexy', "R U R' U' R U R' U'"],
  ['niklas', "R U' L' U R' U' L"],
  ['sune-antisune', "R U R' U R U2 R' R U2 R' U' R U' R'"],
];

function main() {
  console.log('=== Verify whole-cube rotation + move renaming ===');
  verifyRenaming();
  const std = x2(SOLVED_FACELETS);
  console.log('   standard frame centres (URFDLB):', FACE_NAMES.map((f) => center(std, f)).join(''),
    '   (D should be U=white, U should be D=yellow)');

  console.log('\n=== Candidate algorithms: do they preserve F2L, and what do they do to the LL? ===');
  // Testing on the SOLVED standard frame is rigorous: a sequence preserves the
  // F2L-solved set iff it fixes every F2L piece, and that is exactly what we see
  // when we apply it to a solved cube.
  const probes = [std];
  const report = [];
  for (const [name, alg] of CANDIDATES) {
    if (/\bM\b/.test(alg)) { report.push([name, alg, 'SKIP (uses slice moves)']); continue; }
    const moves = tokenizeMoves(alg);
    let preserves = true;
    for (const p of probes) if (!f2lSolved(applyMoveSequence(p, moves))) preserves = false;
    const before = llSignature(probes[0]);
    const after = llSignature(applyMoveSequence(probes[0], moves));
    report.push([name, alg, preserves ? 'F2L-safe' : 'breaks F2L', before, after]);
  }
  for (const r of report) {
    if (r.length === 3) { console.log(`  ${r[0].padEnd(20)} ${r[2]}`); continue; }
    const [name, alg, verdict, before, after] = r;
    console.log(`  ${name.padEnd(20)} ${verdict.padEnd(12)} ${alg}`);
    console.log(`  ${''.padEnd(20)} before: ${before}`);
    console.log(`  ${''.padEnd(20)} after : ${after}`);
  }
}

main();
export { f2lSolved, solved, llSignature, center, at, faceSolved, idx };
