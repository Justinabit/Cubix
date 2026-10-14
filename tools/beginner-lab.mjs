/**
 * beginner-lab.mjs — a scratch lab used to DISCOVER (not guess) the move
 * sequences used by the beginner solver.
 *
 * Every algorithm the beginner solver applies was produced by the searches in
 * this file and then hardcoded; the runtime solver re-verifies each one by
 * simulation before using it, so a bad algorithm can never corrupt a solve.
 *
 * Run: node tools/beginner-lab.mjs [stage]
 */
import {
  SOLVED_FACELETS, FACELET_INFO, FACE_NAMES, applyMove, applyMoveSequence,
  tokenizeMoves, randomScramble, isSolved,
} from '../js/core/cube-model.js';

/* ------------------------------------------------------------------ *
 * Colour-level helpers (frame independent)
 * ------------------------------------------------------------------ */

const C = (state, face, row, col) => state[FACE_NAMES.indexOf(face) * 9 + row * 3 + col];
const center = (state, face) => C(state, face, 1, 1);

/** The six centre colours in URFDLB order. */
const centers = (s) => FACE_NAMES.map((f) => center(s, f));

/**
 * Which face (URFDLB index) currently holds `color` as its centre.
 * Lets us talk about "the white face" instead of "U".
 */
const faceOfCenter = (s, color) => FACE_NAMES.findIndex((f) => center(s, f) === color);

/** The sticker colours of the 9 facelets of a face, as a rows array. */
const faceRows = (s, face) => {
  const b = FACE_NAMES.indexOf(face) * 9;
  return [[s[b], s[b + 1], s[b + 2]], [s[b + 3], s[b + 4], s[b + 5]], [s[b + 6], s[b + 7], s[b + 8]]];
};

/* ------------------------------------------------------------------ *
 * Whole-cube rotations (state relabellings, NOT moves)
 * ------------------------------------------------------------------ */

/**
 * Physically rotate the cube by `map` (a function on 3D unit vectors) and
 * return the new facelet string. Used to put white on the bottom so the
 * standard layer-by-layer algorithms apply verbatim.
 */
function rotateCube(state, map) {
  const inv = new Map();
  for (const info of FACELET_INFO) {
    const p = map(info.coord);
    const dir = map(AXIS_OF[info.face]);
    inv.set(`${p.join(',')}|${dir.join(',')}`, state[info.index]);
  }
  const out = new Array(54);
  for (const info of FACELET_INFO) {
    out[info.index] = inv.get(`${info.coord.join(',')}|${AXIS_OF[info.face].join(',')}`);
  }
  return out.join('');
}

const AXIS_OF = { U: [0, 1, 0], R: [1, 0, 0], F: [0, 0, 1], D: [0, -1, 0], L: [-1, 0, 0], B: [0, 0, -1] };

/** 180° about X: U <-> D, F <-> B, R/L unchanged. Puts white on the bottom. */
export const x2 = (s) => rotateCube(s, ([x, y, z]) => [x, -y, -z]);

/** Move renaming induced by a physical rotation, for undoing x2 at the end. */
const RENAME_X2 = { U: 'D', D: 'U', F: 'B', B: 'F', R: 'R', L: 'L' };
export function renameMoves(moves, table = RENAME_X2) {
  return moves.map((m) => {
    const face = m[0], suffix = m.slice(1);
    return table[face] + suffix;
  });
}

/* ------------------------------------------------------------------ *
 * Stage predicates, written the way a person describes them
 * ------------------------------------------------------------------ */

/** All four edges of `face` show `face`'s own centre colour... white cross etc. */
function crossSolved(state, face) {
  const centerColor = center(state, face);
  const rows = faceRows(state, face);
  return rows[0][1] === centerColor && rows[1][0] === centerColor
      && rows[1][2] === centerColor && rows[2][1] === centerColor;
}

/** The whole `face` is one colour. */
const faceSolved = (state, face) => {
  const b = FACE_NAMES.indexOf(face) * 9;
  const c = state[b + 4];
  for (let i = 0; i < 9; i++) if (state[b + i] !== c) return false;
  return true;
};

/** Bottom two layers solved: D face complete + the lower two rings complete. */
function f2lSolved(state) {
  if (!faceSolved(state, 'D')) return false;
  // middle ring of each side face
  for (const f of ['F', 'R', 'B', 'L']) {
    const rows = faceRows(state, f);
    const c = center(state, f);
    if (rows[1][0] !== c || rows[1][2] !== c) return false;   // middle layer edges
    if (rows[2][0] !== c || rows[2][1] !== c || rows[2][2] !== c) return false; // bottom corners+edges
  }
  return true;
}

/** Every face uniform. */
const solved = (s) => FACE_NAMES.every((f) => faceSolved(s, f));

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

/**
 * Iterative-deepening DFS over `alphabet` for the shortest move sequence from
 * `state` that satisfies `goal`. Returns null if nothing is found by maxDepth.
 */
export function search(state, goal, { alphabet, maxDepth = 8, avoidRepeatFace = true, budget = 4e6 }) {
  let visited = 0;
  const path = [];
  const seen = new Set();

  function dfs(cur, depth, limit, lastFace) {
    if (goal(cur)) return true;
    if (depth === limit) return false;
    if (++visited > budget) throw new Error('search budget exhausted');
    for (const mv of alphabet) {
      const face = mv[0];
      if (avoidRepeatFace && face === lastFace) continue;
      const next = applyMove(cur, mv);
      const key = next + '|' + (limit - depth);
      if (seen.has(key)) continue;
      seen.add(key);
      path.push(mv);
      if (dfs(next, depth + 1, limit, face)) return true;
      path.pop();
    }
    return false;
  }

  for (let limit = 1; limit <= maxDepth; limit++) {
    seen.clear();
    path.length = 0;
    if (dfs(state, 0, limit, null)) return path.slice();
  }
  return null;
}

const ALL = tokenizeMoves("U U' U2 D D' D2 R R' R2 L L' L2 F F' F2 B B' B2");

/* ------------------------------------------------------------------ *
 * Experiments
 * ------------------------------------------------------------------ */

function show(label, state, moves) {
  const after = moves ? applyMoveSequence(state, moves) : state;
  console.log(`${label}: ${moves ? moves.join(' ') : '(start)'}`);
  for (const f of ['U', 'F', 'R']) console.log('   ' + f + ' ' + faceRows(after, f).map((r) => r.join('')).join(' / '));
  return after;
}

/** What does a sequence actually do, in plain terms? */
function describeEffect(before, moves) {
  const after = applyMoveSequence(before, moves);
  return {
    moves: moves.join(' '),
    f2l: f2lSolved(after),
    uEdgesOriented: countUOriented(after),
    uCornersOriented: countUCornersOriented(after),
    uFaceYellow: countUStickersWithCenterColor(after),
    solved: solved(after),
  };
}

function countUOriented(s) {
  const c = center(s, 'U');
  const rows = faceRows(s, 'U');
  let n = 0;
  if (rows[0][1] === c) n++;
  if (rows[1][0] === c) n++;
  if (rows[1][2] === c) n++;
  if (rows[2][1] === c) n++;
  return n;
}
function countUCornersOriented(s) {
  const c = center(s, 'U');
  const rows = faceRows(s, 'U');
  let n = 0;
  for (const [r, col] of [[0, 0], [0, 2], [2, 0], [2, 2]]) if (rows[r][col] === c) n++;
  return n;
}
function countUStickersWithCenterColor(s) {
  const c = center(s, 'U');
  const rows = faceRows(s, 'U');
  let n = 0;
  for (const row of rows) for (const v of row) if (v === c) n++;
  return n;
}

/** Standard frame: white on D, yellow on U, F2L solved. */
function standardFrame(scrambleMoves = []) {
  // start solved, put white on the bottom, then scramble the last layer only
  let s = x2(SOLVED_FACELETS);
  s = applyMoveSequence(s, scrambleMoves);
  return s;
}

const LAYER_SCRAMBLES = tokenizeMoves("U U' U2 R R' R2 F F' F2 D D' D2 L L' L2 B B' B2");

/* ------------------------------------------------------------------ */

const stage = process.argv[2] || 'all';

if (stage === 'orient' || stage === 'all') {
  console.log('=== Sanity: x2 puts white on the bottom ===');
  const s = x2(SOLVED_FACELETS);
  console.log('   centers URFDLB =', centers(s).join(''), ' (white should be at index 3 = D)');
  console.log('   rename check   =', renameMoves(tokenizeMoves("R U R' F2")).join(' '));

  console.log('\n=== Effects of candidate last-layer algorithms (F2L solved, random U layer) ===');
  const candidates = [
    "F R U R' U' F'",
    "F U R U' R' F'",
    "R U R' U R U2 R'",
    "R U2 R' U' R U' R'",
    "R U R' U' R' F R F' R F R' F'",
    "U R U' L' U R' U' L",
    "R' D' R D",
    "R U R' U'",
    "R' F R' B2 R F' R' B2 R2",
    "R U R' U' R' F R2 U' R' U' R U R' F'",
  ];
  // Build a start state: F2L solved, last layer scrambled (but keep F2L intact)
  let start = standardFrame();
  // scramble only the last layer: use a sequence that preserves F2L
  for (const m of tokenizeMoves("R U R' U' F R U R' U' F' R U R' U R U2 R'")) start = applyMove(start, m);
  console.log('   start: f2l=', f2lSolved(start), ' uEdges=', countUOriented(start), ' uCorners=', countUCornersOriented(start));
  for (const cand of candidates) {
    const mv = tokenizeMoves(cand);
    console.log('   ', JSON.stringify(describeEffect(start, mv)));
  }
}

if (stage === 'middle' || stage === 'all') {
  console.log('\n=== Discover middle-layer edge insertion algorithms ===');
  // Take an F2L-solved cube, then pull one middle edge up to the U layer, and
  // search for the shortest sequence that restores F2L.
  const base = standardFrame();                     // white on D, all solved
  const disrupted = applyMoveSequence(base, tokenizeMoves("R U R' U'"));  // lifts the FR edge
  console.log('   disrupted f2l?', f2lSolved(disrupted));
  const s2 = applyMoveSequence(base, tokenizeMoves("R U R' U' R U R' U' R U R' U'")); // back to solved
  console.log('   (R U R\' U\')^3 f2l?', f2lSolved(s2), 'solved?', solved(s2));

  for (const lift of ["R U R' U'", "F' U' F U", "R U' R' U", "F' U F U'"]) {
    const st = applyMoveSequence(base, tokenizeMoves(lift));
    if (f2lSolved(st)) { console.log(`   lift ${lift} does not break F2L, skipping`); continue; }
    const found = search(st, f2lSolved, { alphabet: ALL, maxDepth: 7 });
    console.log(`   lift ${lift.padEnd(12)} -> ${found ? found.join(' ') : 'NOT FOUND'}`);
  }
}

if (stage === 'cross' || stage === 'all') {
  console.log('\n=== Discover yellow-cross algorithms ===');
  const base = standardFrame();
  // F2L solved, and the U layer edges are in a "dot" / "L" / "line" pattern.
  const setups = ['', "F U R U' R' F'", "F R U R' U' F'", "F U R U' R' F' F R U R' U' F'"];
  for (const setup of setups) {
    const st = applyMoveSequence(base, tokenizeMoves(setup));
    if (!f2lSolved(st)) { console.log(`   setup "${setup}" broke F2L, skipping`); continue; }
    const n = countUOriented(st);
    const found = search(st, (s) => f2lSolved(s) && countUOriented(s) === 4, { alphabet: ALL, maxDepth: 7 });
    console.log(`   start with ${n} oriented -> ${found ? found.join(' ') : 'NOT FOUND'}`);
  }
}

if (stage === 'corners' || stage === 'all') {
  console.log('\n=== Discover corner orientation (Sune-style) algorithms ===');
  const base = standardFrame();
  const setups = ['', "R U R' U R U2 R'", "R U R' U R U2 R' R U R' U R U2 R'", "R U2 R' U' R U' R'"];
  for (const setup of setups) {
    const st = applyMoveSequence(base, tokenizeMoves(setup));
    if (!f2lSolved(st)) { console.log('   setup broke F2L, skipping'); continue; }
    const found = search(st, (s) => f2lSolved(s) && countUOriented(s) === 4 && countUCornersOriented(s) === 4, { alphabet: ALL, maxDepth: 8 });
    console.log(`   start corners=${countUCornersOriented(st)} edges=${countUOriented(st)} -> ${found ? found.join(' ') : 'NOT FOUND'}`);
  }
}

if (stage === 'permute' || stage === 'all') {
  console.log('\n=== Discover corner permutation + final solve algorithms ===');
  const base = standardFrame();
  const setups = ["U R U' L' U R' U' L", "R U R' U' R' F R2 U' R' U' R U R' F'", "R' F R' B2 R F' R' B2 R2"];
  for (const setup of setups) {
    const st = applyMoveSequence(base, tokenizeMoves(setup));
    if (!f2lSolved(st)) { console.log('   setup broke F2L, skipping'); continue; }
    const found = search(st, (s) => solved(s), { alphabet: ALL, maxDepth: 10 });
    console.log(`   "${setup}" -> ${found ? found.join(' ') : 'NOT FOUND'}`);
  }
}

export { faceRows, crossSolved, faceSolved, f2lSolved, solved, center, faceOfCenter, countUOriented, countUCornersOriented, ALL };
