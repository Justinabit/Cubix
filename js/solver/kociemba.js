/**
 * kociemba.js — Kociemba's two-phase algorithm, implemented in-tree.
 *
 * Why not just pull in cubejs? Because this solver shares the exact cube model
 * the rest of the app uses (js/core/cube-model.js), so there is a single source
 * of truth for what "R" means, and it works offline with no dependencies.
 *
 * ── The algorithm in one paragraph ──────────────────────────────────────────
 * Phase 1 scrambles the cube only with moves from G1 = <U, D, R2, L2, F2, B2>
 * until every edge is oriented, every corner is oriented and the four
 * middle-layer ("UD slice") edges are back in the middle layer. That state is
 * reachable from solved using only G1 moves, so phase 2 finishes the cube
 * without ever leaving G1. Each phase is an IDA* search guided by a pruning
 * table: phase 1 indexes (twist, slice) and (flip, slice); phase 2 indexes
 * (corner permutation, slice permutation) and (edge permutation, slice
 * permutation). The tables give a lower bound on the remaining moves, which
 * makes the search fast enough for a browser.
 *
 * Coordinate definitions follow Kociemba's original paper, and the corner/edge
 * numbering is the one already verified in js/core/cube-model.js (corners UFR,
 * UFL, ULB, UBR, DFR, DLF, DBL, DRB; edges UF, UB, UL, UR, DF, DB, DL, DR, FR,
 * FL, BL, BR — so the four UD-slice edges are indices 8..11).
 */

import {
  MOVE_NAMES, MOVE_EFFECTS, identityCubieState, applyQuarterTurnCubieOnce,
  parseMove, tokenizeMoves, invertMoves,
} from '../core/cube-model.js';

/* ------------------------------------------------------------------ *
 * Move naming
 * ------------------------------------------------------------------ */

/** All 18 face turns, indexed 0..17 as (face, power). */
export const ALL_MOVES = MOVE_NAMES.flatMap((f, fi) => [
  { name: f, face: fi, power: 1 },
  { name: f + '2', face: fi, power: 2 },
  { name: f + "'", face: fi, power: 3 },
]);

/** The 10 moves of G1 = <U, D, R2, L2, F2, B2> (indices into ALL_MOVES). */
export const PHASE2_MOVES = ALL_MOVES
  .map((m, i) => ({ ...m, i }))
  .filter((m) => m.name[0] === 'U' || m.name[0] === 'D' || m.name.endsWith('2'))
  .map((m) => m.i);

/**
 * True when following face `a` with face `b` can never be better than the
 * reverse order: the same face twice is always reducible, and opposite faces
 * commute (so only the U-then-D / R-then-L / F-then-B order is explored).
 */
const redundant = (a, b) => a === b || (((a + 3) % 6 === b) && b < a);

/** Apply ALL_MOVES[i] to a cubie state. */
function applyMoveIndex(state, i) {
  const m = ALL_MOVES[i];
  let s = state;
  for (let k = 0; k < m.power; k++) s = applyQuarterTurnCubieOnce(s, MOVE_NAMES[m.face]);
  return s;
}

/* ------------------------------------------------------------------ *
 * Coordinate encodings
 * ------------------------------------------------------------------ */

/** Corner orientation, 0..2186 (the 8th corner is forced by the other seven). */
function getTwist({ co }) {
  let r = 0;
  for (let i = 0; i < 7; i++) r = 3 * r + co[i];
  return r;
}
function setTwist(t) {
  const co = [0, 0, 0, 0, 0, 0, 0, 0];
  let sum = 0;
  for (let i = 6; i >= 0; i--) { co[i] = t % 3; t = Math.floor(t / 3); sum += co[i]; }
  co[7] = (3 - (sum % 3)) % 3;
  return { cp: [0, 1, 2, 3, 4, 5, 6, 7], co, ep: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], eo: new Array(12).fill(0) };
}

/** Edge orientation, 0..2047 (the 12th edge is forced). */
function getFlip({ eo }) {
  let r = 0;
  for (let i = 0; i < 11; i++) r = 2 * r + eo[i];
  return r;
}
function setFlip(f) {
  const eo = new Array(12).fill(0);
  let sum = 0;
  for (let i = 10; i >= 0; i--) { eo[i] = f % 2; f = Math.floor(f / 2); sum += eo[i]; }
  eo[11] = (2 - (sum % 2)) % 2;
  return { cp: [0, 1, 2, 3, 4, 5, 6, 7], co: new Array(8).fill(0), ep: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], eo };
}

/* --- combinadics for the slice coordinate --- */
const C = (n, k) => (k < 0 || k > n ? 0 : Math.round(
  Array.from({ length: k }, (_, i) => (n - i) / (i + 1)).reduce((a, b) => a * b, 1)
));

/** Which four positions hold the UD-slice edges (pieces 8..11), 0..494. */
function getSlice({ ep }) {
  const pos = [];
  for (let i = 0; i < 12; i++) if (ep[i] >= 8) pos.push(i);
  return C(pos[0], 1) + C(pos[1], 2) + C(pos[2], 3) + C(pos[3], 4);
}
function setSlice(idx) {
  const ep = new Array(12).fill(-1);
  const pos = [];
  for (let k = 4; k >= 1; k--) {           // combinadic unranking
    let c = k - 1;
    while (C(c + 1, k) <= idx) c++;
    idx -= C(c, k);
    pos.push(c);
  }
  pos.reverse();
  pos.forEach((p, i) => { ep[p] = 8 + i; });
  let next = 0;
  for (let i = 0; i < 12; i++) if (ep[i] === -1) ep[i] = next++;
  return { cp: [0, 1, 2, 3, 4, 5, 6, 7], co: new Array(8).fill(0), ep, eo: new Array(12).fill(0) };
}

/* --- permutation ranks --- */
function getPerm(arr, n = arr.length) {
  let idx = 0;
  for (let i = 0; i < n; i++) {
    idx *= (n - i);
    for (let j = i + 1; j < n; j++) if (arr[j] < arr[i]) idx++;
  }
  return idx;
}
let FACT = [1];
const factorial = (n) => {
  while (FACT.length <= n) FACT.push(FACT[FACT.length - 1] * FACT.length);
  return FACT[n];
};

/**
 * Inverse of getPerm: turning a Lehmer code back into a permutation.
 * At step i we choose the (idx / (n-1-i)!)-th smallest remaining element.
 */
function setPerm(idx, n) {
  const remaining = Array.from({ length: n }, (_, i) => i);
  const res = [];
  for (let i = 0; i < n; i++) {
    const f = factorial(n - 1 - i);
    const pick = Math.floor(idx / f);
    idx %= f;
    res.push(remaining.splice(pick, 1)[0]);
  }
  return res;
}

/** Corner permutation, 0..40319. */
const getCPerm = ({ cp }) => getPerm(cp, 8);
function setCPerm(idx) {
  return { cp: setPerm(idx, 8), co: new Array(8).fill(0), ep: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], eo: new Array(12).fill(0) };
}

/** Permutation of the eight U/D-layer edges (ep[0..7]), 0..40319. */
const getEPerm = ({ ep }) => getPerm(ep.slice(0, 8), 8);
function setEPerm(idx) {
  const first = setPerm(idx, 8);
  return { cp: [0, 1, 2, 3, 4, 5, 6, 7], co: new Array(8).fill(0), ep: [...first, 8, 9, 10, 11], eo: new Array(12).fill(0) };
}

/** Permutation of the four UD-slice edges among their slots, 0..23. */
function getMPerm({ ep }) {
  const vals = [];
  for (let i = 0; i < 12; i++) if (ep[i] >= 8) vals.push(ep[i] - 8);
  return getPerm(vals, 4);
}
function setMPerm(idx) {
  const perm = setPerm(idx, 4).map((v) => v + 8);
  const ep = [0, 1, 2, 3, 4, 5, 6, 7, ...perm];
  return { cp: [0, 1, 2, 3, 4, 5, 6, 7], co: new Array(8).fill(0), ep, eo: new Array(12).fill(0) };
}

export const N_TWIST = 2187, N_FLIP = 2048, N_SLICE = 495, N_PERM = 40320, N_MPERM = 24;
const SOLVED_SLICE = getSlice(identityCubieState());

/* ------------------------------------------------------------------ *
 * The solver
 * ------------------------------------------------------------------ */

export class KociembaSolver {
  constructor() {
    this.ready = false;
  }

  /**
   * Build the move and pruning tables. This costs a couple of seconds, so it
   * reports progress and yields to the event loop between chunks.
   * @param {(fraction:number, label:string)=>void} [onProgress]
   */
  async build(onProgress = () => {}) {
    const yieldToBrowser = () => new Promise((r) => setTimeout(r, 0));
    const report = (f, l) => { onProgress(f, l); };

    report(0.0, 'move tables');
    this.twistMove = buildMoveTable(N_TWIST, setTwist, getTwist);
    this.flipMove = buildMoveTable(N_FLIP, setFlip, getFlip);
    this.sliceMove = buildMoveTable(N_SLICE, setSlice, getSlice);
    this.cPermMove = buildMoveTable(N_PERM, setCPerm, getCPerm);
    this.ePermMove = buildMoveTable(N_PERM, setEPerm, getEPerm);
    this.mPermMove = buildMoveTable(N_MPERM, setMPerm, getMPerm);
    await yieldToBrowser();

    report(0.1, 'pruning: corner orientation');
    this.pruneTwistSlice = buildPruneTable(
      N_TWIST * N_SLICE,
      (i) => [Math.floor(i / N_SLICE), i % N_SLICE],
      (t, s) => t * N_SLICE + s,
      this.twistMove, this.sliceMove,
      [0, SOLVED_SLICE]
    );
    await yieldToBrowser();

    report(0.35, 'pruning: edge orientation');
    this.pruneFlipSlice = buildPruneTable(
      N_FLIP * N_SLICE,
      (i) => [Math.floor(i / N_SLICE), i % N_SLICE],
      (f, s) => f * N_SLICE + s,
      this.flipMove, this.sliceMove,
      [0, SOLVED_SLICE]
    );
    await yieldToBrowser();

    report(0.6, 'pruning: corner permutation');
    this.pruneCPerm = buildPruneTable(
      N_PERM * N_MPERM,
      (i) => [Math.floor(i / N_MPERM), i % N_MPERM],
      (c, m) => c * N_MPERM + m,
      this.cPermMove, this.mPermMove,
      [0, 0], PHASE2_MOVES
    );
    await yieldToBrowser();

    report(0.85, 'pruning: edge permutation');
    this.pruneEPerm = buildPruneTable(
      N_PERM * N_MPERM,
      (i) => [Math.floor(i / N_MPERM), i % N_MPERM],
      (e, m) => e * N_MPERM + m,
      this.ePermMove, this.mPermMove,
      [0, 0], PHASE2_MOVES
    );

    report(1, 'ready');
    this.ready = true;
    return this;
  }

  /**
   * Solve a cubie state.
   * @returns {string[]} the solution in standard notation, or null if none was
   *   found within the limits (which should not happen for a legal cube).
   */
  solve(cubieState, { maxLength = 24, phase1Max = 12 } = {}) {
    if (!this.ready) throw new Error('KociembaSolver.build() must be called first');
    let state = cubieState;

    const twist0 = getTwist(state), flip0 = getFlip(state), slice0 = getSlice(state);
    if (twist0 === 0 && flip0 === 0 && slice0 === SOLVED_SLICE
        && getCPerm(state) === 0 && getEPerm(state) === 0 && getMPerm(state) === 0) {
      return [];
    }

    // Phase 1: reach G1, then finish with phase 2 inside the remaining budget.
    for (let len1 = this._h1(twist0, flip0, slice0); len1 <= phase1Max; len1++) {
      const found = this._searchPhase1(twist0, flip0, slice0, len1, (phase1) => {
        let s = state;
        for (const mi of phase1) s = applyMoveIndex(s, mi);
        if (getSlice(s) !== SOLVED_SLICE) return null;
        const phase2 = this._searchPhase2(s, Math.min(maxLength - len1, 20));
        if (phase2 === null) return null;
        return [
          ...phase1.map((mi) => ALL_MOVES[mi].name),
          ...phase2.map((mi) => ALL_MOVES[mi].name),
        ];
      });
      // `found` is null while the search is still looking; a solution (even an
      // empty one, for an already-solved cube) is an array.
      if (found !== null && found !== undefined) return simplify(found);
    }
    return null;
  }

  _h1(twist, flip, slice) {
    return Math.max(
      this.pruneTwistSlice[twist * N_SLICE + slice],
      this.pruneFlipSlice[flip * N_SLICE + slice]
    );
  }

  /** Depth-first phase 1 search; `onSolution` may return a solution to stop. */
  _searchPhase1(twist, flip, slice, depth, onSolution, path = []) {
    if (depth === 0) {
      return (twist === 0 && flip === 0 && slice === SOLVED_SLICE) ? onSolution(path) : null;
    }
    if (this._h1(twist, flip, slice) > depth) return null;
    // Never turn the same face twice in a row, and never turn a face whose
    // "higher" partner was just turned (U then D commute, so order them).
    const last = path.length ? ALL_MOVES[path[path.length - 1]] : null;
    for (let i = 0; i < ALL_MOVES.length; i++) {
      const m = ALL_MOVES[i];
      if (last && redundant(last.face, m.face)) continue;
      path.push(i);
      const r = this._searchPhase1(
        this.twistMove[twist * 18 + i],
        this.flipMove[flip * 18 + i],
        this.sliceMove[slice * 18 + i],
        depth - 1, onSolution, path
      );
      path.pop();
      if (r) return r;
    }
    return null;
  }

  /** Iterative-deepening phase 2 search inside G1. */
  _searchPhase2(state, maxDepth) {
    const c0 = getCPerm(state), e0 = getEPerm(state), m0 = getMPerm(state);
    if (c0 === 0 && e0 === 0 && m0 === 0) return [];
    for (let d = this._h2(c0, e0, m0); d <= maxDepth; d++) {
      const path = [];
      if (this._dfsPhase2(c0, e0, m0, d, path)) return path;
    }
    return null;
  }

  _h2(c, e, m) {
    return Math.max(this.pruneCPerm[c * N_MPERM + m], this.pruneEPerm[e * N_MPERM + m]);
  }

  _dfsPhase2(c, e, m, depth, path) {
    if (depth === 0) return c === 0 && e === 0 && m === 0;
    if (this._h2(c, e, m) > depth) return false;
    const last = path.length ? ALL_MOVES[path[path.length - 1]] : null;
    for (const i of PHASE2_MOVES) {
      const mv = ALL_MOVES[i];
      if (last && redundant(last.face, mv.face)) continue;
      path.push(i);
      if (this._dfsPhase2(
        this.cPermMove[c * 18 + i],
        this.ePermMove[e * 18 + i],
        this.mPermMove[m * 18 + i],
        depth - 1, path
      )) return true;
      path.pop();
    }
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Table construction
 * ------------------------------------------------------------------ */

/** moveTable[coord * 18 + moveIndex] = resulting coord. */
function buildMoveTable(n, setCoord, getCoord) {
  const table = new Uint32Array(n * 18);
  for (let i = 0; i < n; i++) {
    const base = setCoord(i);
    for (let m = 0; m < 18; m++) {
      table[i * 18 + m] = getCoord(applyMoveIndex(base, m));
    }
  }
  return table;
}

/**
 * Breadth-first distance table over pairs (a, b), used as an admissible
 * heuristic. Distances above 255 are clamped — a legal cube never needs more.
 */
function buildPruneTable(size, decode, encode, moveA, moveB, goals, moves = null) {
  const dist = new Uint8Array(size).fill(255);
  const moveList = moves || Array.from({ length: 18 }, (_, i) => i);
  let frontier = [encode(goals[0], goals[1])];
  dist[frontier[0]] = 0;
  let depth = 0;
  while (frontier.length) {
    depth++;
    const next = [];
    for (const idx of frontier) {
      const [a, b] = decode(idx);
      for (const m of moveList) {
        const na = moveA[a * 18 + m], nb = moveB[b * 18 + m];
        const ni = encode(na, nb);
        if (dist[ni] === 255) { dist[ni] = depth; next.push(ni); }
      }
    }
    frontier = next;
  }
  return dist;
}

/* ------------------------------------------------------------------ *
 * Convenience API used by the UI
 * ------------------------------------------------------------------ */

let singleton = null;

/** The shared solver instance (tables are built once per page load). */
export function getSolver() {
  if (!singleton) singleton = new KociembaSolver();
  return singleton;
}

/**
 * Solve a facelet string end to end.
 * @param {string} facelets 54-character URFDLB state
 * @param {import('../core/cube-model.js').CubieState} [cubieState] precomputed
 * @returns {string[]|null}
 */
export function solveFacelets(facelets, cubieState) {
  const solver = getSolver();
  return solver.solve(cubieState);
}

/** Tidy up a move list: drop X X' pairs and collapse X X into X2. */
export function simplify(moves) {
  const out = [];
  for (const mv of moves) {
    const last = out[out.length - 1];
    if (!last) { out.push(mv); continue; }
    if (last[0] !== mv[0]) { out.push(mv); continue; }
    const a = parseMove(last), b = parseMove(mv);
    const total = (a.power * a.sign + b.power * b.sign);
    const norm = ((total % 4) + 4) % 4;
    out.pop();
    if (norm === 1) out.push(a.face);
    else if (norm === 2) out.push(a.face + '2');
    else if (norm === 3) out.push(a.face + "'");
  }
  return out;
}

export { getTwist, getFlip, getSlice, getCPerm, getEPerm, getMPerm, getPerm, setPerm, setSlice, setCPerm, setEPerm, setMPerm, PHASE2_MOVES as G1_MOVES };
export const invert = invertMoves;
export const tokenize = tokenizeMoves;
