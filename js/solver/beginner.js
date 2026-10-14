/**
 * beginner.js — the layer-by-layer ("beginner") method, in seven stages.
 *
 * ── Design notes ────────────────────────────────────────────────────────────
 * Every algorithm below was *produced by search* against the verified move
 * engine and then hardcoded here; none of them were copied from memory. The
 * file tools/ll-lab.mjs is the lab that produced them, and
 * tests/beginner.test.mjs re-checks the whole method on random scrambles.
 *
 * The cube is first rotated 180° about X so that white is on the bottom and
 * yellow on top, which is the orientation every beginner tutorial uses. Moves
 * are translated back into the user's frame at the end (see RENAME_X2).
 *
 * Stages (matching the classic seven-step method):
 *   1 white cross      4 yellow cross            (orient the last-layer edges)
 *   2 white corners    5 yellow edges positioned (permute them, still oriented)
 *   3 middle layer     6 yellow corners positioned
 *                      7 yellow corners oriented
 */

import {
  SOLVED_FACELETS, FACE_NAMES, applyMove, applyMoveSequence, tokenizeMoves,
} from '../core/cube-model.js';
import {
  x2, renameMoves, center, at, SLOTS, slotSolved, slotHasRightPiece, findPiece,
} from '../core/cube-ops.js';

const ALL_MOVES = tokenizeMoves("U U' U2 D D' D2 R R' R2 L L' L2 F F' F2 B B' B2");
const U_SETUPS = ['', 'U', "U'", 'U2'];

/* ------------------------------------------------------------------ *
 * Slot tables
 * ------------------------------------------------------------------ */

const CROSS_SLOTS = ['DF', 'DR', 'DB', 'DL'];          // white cross (bottom)
const CORNER_SLOTS = ['DFR', 'DBR', 'DBL', 'DFL'];     // white corners (bottom)
const MIDDLE_SLOTS = ['FR', 'BR', 'BL', 'FL'];         // middle layer
const U_EDGE_SLOTS = ['UF', 'UR', 'UB', 'UL'];
const U_CORNER_SLOTS = ['UFR', 'UBR', 'UBL', 'UFL'];

/**
 * Face substitution for rotating the canonical algorithms around the vertical
 * axis. Step 0 is the front-right position; each step is a y rotation
 * (F -> R -> B -> L), which is a symmetry of the cube, so primes are preserved.
 */
const FACE_STEP = [
  { F: 'F', R: 'R', B: 'B', L: 'L', U: 'U', D: 'D' },
  { F: 'R', R: 'B', B: 'L', L: 'F', U: 'U', D: 'D' },
  { F: 'B', R: 'L', B: 'F', L: 'R', U: 'U', D: 'D' },
  { F: 'L', R: 'F', B: 'R', L: 'B', U: 'U', D: 'D' },
];

function mapFaces(moves, step) {
  const table = FACE_STEP[step];
  return moves.map((m) => table[m[0]] + m.slice(1));
}

/* ------------------------------------------------------------------ *
 * Verified algorithms
 * ------------------------------------------------------------------ */

/**
 * White corner insertion, for a corner parked in the U layer directly above its
 * home. Discovered by search (tools/ll-lab.mjs); the three cases are "where is
 * the white sticker": on the U face, on the first side face, on the second.
 */
const CORNER_INSERT = [
  "R U R'",        // white on the R face
  "F' U' F",       // white on the F face
  "U F2 R' F2 R",  // white on the U face
].map(tokenizeMoves);

/**
 * Middle-layer edge insertion from the U layer. Discovered by search: the first
 * sends the edge to the right-hand slot, the second to the left-hand slot.
 */
const MIDDLE_INSERT_RIGHT = tokenizeMoves("U R U' R' U' F' U F");
const MIDDLE_INSERT_LEFT = tokenizeMoves("U' F' U F U R U' R'");

/** Last-layer edge orientation ("yellow cross"). */
const OLL_CROSS = [
  tokenizeMoves("F R U R' U' F'"),
  tokenizeMoves("F U R U' R' F'"),
];

/** Last-layer corner orientation (Sune family). */
const OLL_CORNERS = [
  tokenizeMoves("R U R' U R U2 R'"),
  tokenizeMoves("R U2 R' U' R U' R'"),
];

/** Corner 3-cycles (PLL): move corners without disturbing the edges. */
const PLL_CORNERS = [
  tokenizeMoves("R' F R' B2 R F' R' B2 R2"),
  tokenizeMoves("R2 B2 R F R' B2 R F' R"),
  tokenizeMoves("R U' L' U R' U' L"),
  tokenizeMoves("L' U R U' L U R'"),
];

/** Edge permutations (PLL): move edges without disturbing their orientation. */
const PLL_EDGES = [
  tokenizeMoves("R U' R U R U R U' R' U' R2"),
  tokenizeMoves("R2 U R U R' U' R' U' R' U R'"),
  tokenizeMoves("R2 U2 R U2 R2 U2 R2 U2 R U2 R2"),
  tokenizeMoves("R U R' U' R' F R2 U' R' U' R U R' F'"), // T-perm: fixes odd parity
  tokenizeMoves("F R U' R' U' R U R' F' R U R' U' R' F R F'"),
];

/**
 * Pure corner twisters: they keep every piece in place and only twist corners.
 * Found by composing OLLs with corner 3-cycles and keeping the compositions
 * whose net effect on permutation is identity (tools/ll-lab.mjs did this).
 */
const CORNER_TWISTERS = [
  "R U R' U R U2 R' U' R U' R U R U R U' R' U' R2 U'",
  "R U2 R' U' R U' R' U R2 U R U R' U' R' U' R' U R' U",
  "R2 B2 R F R' B2 R F' R U' L' U R U' L U R'",
  "L' U R U' L U R' R2 B2 R F R' B2 R F' R U'",
  "R U' R U R U R U' R' U' R2 U' R U R' U R U2 R' U'",
  "R2 U R U R' U' R' U' R' U R' U R U2 R' U' R U' R' U",
].map(tokenizeMoves);

/** U^k T U^-k: the same twists applied to whichever corner is where. */
function conjugateByU(moves, setup) {
  const inverse = { '': '', U: "U'", "U'": 'U', U2: 'U2' }[setup];
  return tokenizeMoves(`${setup} ${moves.join(' ')} ${inverse}`.trim());
}

/* ------------------------------------------------------------------ *
 * Small search used for the first two layers
 * ------------------------------------------------------------------ */

/**
 * Iterative-deepening search for the shortest sequence satisfying `goal`.
 * The transposition table is keyed by (state, remaining depth) — keying by
 * state alone is a classic IDDFS bug that silently misses solutions.
 */
function search(state, goal, { maxDepth = 6, alpha = ALL_MOVES, budget = 4e6 } = {}) {
  const path = [];
  let nodes = 0;
  for (let limit = 1; limit <= maxDepth; limit++) {
    const seen = new Set();
    path.length = 0;
    const dfs = (cur, depth, lastFace) => {
      if (goal(cur)) return true;
      if (depth === limit) return false;
      if (++nodes > budget) throw new Error('search budget exhausted');
      for (const mv of alpha) {
        const face = mv[0];
        if (face === lastFace) continue;
        const next = applyMove(cur, mv);
        const key = next + '#' + (limit - depth);
        if (seen.has(key)) continue;
        seen.add(key);
        path.push(mv);
        if (dfs(next, depth + 1, face)) return true;
        path.pop();
      }
      return false;
    };
    if (dfs(state, 0, null)) return path.slice();
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Stage predicates
 * ------------------------------------------------------------------ */

const slotsOk = (s, names) => names.every((n) => slotSolved(s, n));
const whiteFace = (s) => center(s, 'D');

/** A white edge is a "petal" when it is in the U layer showing white on U. */
function isPetal(s, sideColor) {
  const white = whiteFace(s);
  return U_EDGE_SLOTS.some((n) => {
    const st = SLOTS[n].stickers;
    return at(s, st[0].face, st[0].row, st[0].col) === white
        && at(s, st[1].face, st[1].row, st[1].col) === sideColor;
  });
}

/* ------------------------------------------------------------------ *
 * The seven stages
 * ------------------------------------------------------------------ */

/**
 * Stage 1 — the white cross.
 *
 * Classic "daisy" method: float each white edge to the top layer with white
 * facing up, then line it up above its own side colour and turn that face twice
 * to drop it into the bottom layer. Edges that are already correct (common when
 * re-solving a nearly finished cube) are left completely alone.
 */
function stageWhiteCross(state, emit) {
  const finished = [];
  for (const slot of CROSS_SLOTS) {
    if (slotSolved(state, slot)) { finished.push(slot); continue; }
    const side = SLOTS[slot].stickers.find((st) => st.face !== 'D');
    const sideColor = center(state, side.face);

    // 1. float the edge up to the top layer, white facing up
    const asPetal = (x) => isPetal(x, sideColor) && finished.every((d) => slotSolved(x, d));
    if (!asPetal(state)) {
      const moves = search(state, asPetal, { maxDepth: 6 });
      if (!moves) return null;
      emit(moves, `Float the white–${colorName(sideColor)} edge to the top`);
      state = applyMoveSequence(state, moves);
    }

    // 2. turn the top until the petal sits above its own colour, then flip it down
    let flipped = false;
    for (const setup of U_SETUPS) {
      const candidate = setup ? applyMove(state, setup) : state;
      for (const name of U_EDGE_SLOTS) {
        const st = SLOTS[name].stickers;
        if (at(candidate, st[0].face, st[0].row, st[0].col) !== whiteFace(candidate)) continue;
        const petalSide = st[1];
        if (at(candidate, petalSide.face, petalSide.row, petalSide.col) !== sideColor) continue;
        if (center(candidate, petalSide.face) !== sideColor) continue;
        const moves = setup ? [setup, petalSide.face + '2'] : [petalSide.face + '2'];
        emit(moves, `Drop the white–${colorName(sideColor)} edge into place`);
        state = applyMoveSequence(state, moves);
        flipped = true;
        break;
      }
      if (flipped) break;
    }
    if (!flipped) return null;
    finished.push(slot);
  }
  return state;
}

/**
 * Stages 2 and 3 — the white corners and the four middle-layer edges.
 *
 * Both use the same pair of ideas, discovered by search in tools/ll-lab.mjs:
 *   - an insertion algorithm drops a piece from the U layer into its home;
 *   - applying that insertion to a slot that holds the WRONG piece kicks that
 *     piece up to the U layer, which is how a beginner frees a stuck piece.
 *
 * Rather than hand-code "if stuck then push", we hand the BFS below every
 * insertion (for every slot and every U-layer alignment) and let it chain them.
 * That cannot dead-end in the way a hand-written if/else chain can.
 */
function stageWhiteCorners(state, emit) {
  const placed = [];
  for (let i = 0; i < CORNER_SLOTS.length; i++) {
    const home = CORNER_SLOTS[i];
    const safe = (x) => slotsOk(x, CROSS_SLOTS) && placed.every((p) => slotSolved(x, p));
    if (safe(state) && slotSolved(state, home)) { placed.push(home); continue; }

    const algs = CORNER_SLOTS.flatMap((_, j) =>
      U_SETUPS.flatMap((u) => CORNER_INSERT.map((alg) =>
        tokenizeMoves(`${u} ${mapFaces(alg, j).join(' ')}`.trim()))));

    const result = searchStage(state, {
      algs, setups: [''],
      invariant: safe,
      goal: (x) => safe(x) && slotSolved(x, home),
      maxStates: 40000,
    });
    if (!result) return null;
    for (const moves of result.steps) emit(moves, 'Place the next white corner');
    state = result.state;
    placed.push(home);
  }
  return state;
}

/** Stage 3 — the four middle-layer edges. */
function stageMiddleLayer(state, emit) {
  const placed = [];
  for (let i = 0; i < MIDDLE_SLOTS.length; i++) {
    const home = MIDDLE_SLOTS[i];
    const safe = (x) => slotsOk(x, [...CROSS_SLOTS, ...CORNER_SLOTS])
      && placed.every((p) => slotSolved(x, p));
    if (safe(state) && slotSolved(state, home)) { placed.push(home); continue; }

    const algs = MIDDLE_SLOTS.flatMap((_, j) =>
      U_SETUPS.flatMap((u) => [MIDDLE_INSERT_RIGHT, MIDDLE_INSERT_LEFT].map((alg) =>
        tokenizeMoves(`${u} ${mapFaces(alg, j).join(' ')}`.trim()))));

    const result = searchStage(state, {
      algs, setups: [''],
      invariant: safe,
      goal: (x) => safe(x) && slotSolved(x, home),
      maxStates: 40000,
    });
    if (!result) return null;
    for (const moves of result.steps) emit(moves, 'Place the next middle-layer edge');
    state = result.state;
    placed.push(home);
  }
  return state;
}

/**
 * Breadth-first search for a sequence of verified algorithms that completes a
 * stage, never leaving the set of states where earlier stages still hold.
 *
 * BFS rather than a greedy "most progress wins" loop: the last-layer state
 * spaces are small (a few thousand states once earlier stages are fixed), so an
 * exhaustive search is cheap and cannot stall in a local optimum the way a
 * hill-climbing loop can.
 */
function searchStage(state, { algs, setups, invariant, goal, maxStates = 200000 }) {
  if (goal(state)) return { state, steps: [] };
  const prev = new Map([[state, null]]);
  let frontier = [state];
  let visited = 1;
  while (frontier.length && visited < maxStates) {
    const next = [];
    for (const cur of frontier) {
      for (const setup of setups) {
        for (const alg of algs) {
          const moves = tokenizeMoves(`${setup} ${alg.join(' ')}`.trim());
          if (!moves.length) continue;
          const after = applyMoveSequence(cur, moves);
          if (!invariant(after) || prev.has(after)) continue;
          prev.set(after, { from: cur, moves });
          visited++;
          if (goal(after)) {
            // walk the parent chain back to the start
            const steps = [];
            let node = after;
            while (prev.get(node)) { steps.unshift(prev.get(node).moves); node = prev.get(node).from; }
            return { state: after, steps };
          }
          next.push(after);
        }
      }
    }
    frontier = next;
  }
  return null;
}

const uEdgesOriented = (s) => U_EDGE_SLOTS.every((n) => {
  const u = center(s, 'U');
  const st = SLOTS[n].stickers.find((x) => x.face === 'U');
  return at(s, 'U', st.row, st.col) === u;
});
const uCornersOriented = (s) => U_CORNER_SLOTS.every((n) => {
  const u = center(s, 'U');
  const st = SLOTS[n].stickers.find((x) => x.face === 'U');
  return at(s, 'U', st.row, st.col) === u;
});
const f2lOk = (s) => slotsOk(s, [...CROSS_SLOTS, ...CORNER_SLOTS, ...MIDDLE_SLOTS]);

const countIf = (names, fn) => (s) => names.filter((n) => fn(s, n)).length;

/** Stage 4 — orient the last-layer edges to make a yellow cross. */
function stageYellowCross(state, emit) {
  const result = searchStage(state, {
    algs: OLL_CROSS, setups: U_SETUPS,
    invariant: f2lOk,
    goal: (s) => f2lOk(s) && uEdgesOriented(s),
  });
  if (!result) return null;
  for (const moves of result.steps) emit(moves, 'Flip another top edge to yellow');
  return result.state;
}

/** Stage 5 — put the last-layer edges in their final places. */
function stagePositionEdges(state, emit) {
  const result = searchStage(state, {
    algs: PLL_EDGES, setups: U_SETUPS,
    invariant: (s) => f2lOk(s) && uEdgesOriented(s),
    goal: (s) => f2lOk(s) && uEdgesOriented(s) && slotsOk(s, U_EDGE_SLOTS),
  });
  if (!result) return null;
  for (const moves of result.steps) emit(moves, 'Cycle the top edges into place');
  return result.state;
}

/** Stage 6 — put the last-layer corners in their final corners. */
function stagePositionCorners(state, emit) {
  const result = searchStage(state, {
    algs: PLL_CORNERS, setups: U_SETUPS,
    invariant: (s) => f2lOk(s) && slotsOk(s, U_EDGE_SLOTS),
    goal: (s) => f2lOk(s) && slotsOk(s, U_EDGE_SLOTS)
      && U_CORNER_SLOTS.every((n) => slotHasRightPiece(s, n)),
  });
  if (!result) return null;
  for (const moves of result.steps) emit(moves, 'Cycle the corners into place');
  return result.state;
}

/** Stage 7 — twist the last-layer corners in place. */
function stageOrientCorners(state, emit) {
  const algs = CORNER_TWISTERS.flatMap((t) => U_SETUPS.map((u) => conjugateByU(t, u)));
  const result = searchStage(state, {
    algs, setups: [''],                 // a U setup here would undo the placement
    invariant: (s) => f2lOk(s) && slotsOk(s, U_EDGE_SLOTS)
      && U_CORNER_SLOTS.every((n) => slotHasRightPiece(s, n)),
    goal: (s) => FACE_NAMES.every((f) => {
      const c = center(s, f);
      const b = FACE_NAMES.indexOf(f) * 9;
      for (let i = 0; i < 9; i++) if (s[b + i] !== c) return false;
      return true;
    }),
  });
  if (!result) return null;
  for (const moves of result.steps) emit(moves, 'Twist the last corners so yellow faces up');
  return result.state;
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

const COLOR_NAMES = { U: 'white', R: 'red', F: 'green', D: 'yellow', L: 'orange', B: 'blue' };
const colorName = (letter) => COLOR_NAMES[letter] || letter;

export const STAGES = [
  { id: 'white-cross', title: 'White cross', goal: 'Build a white cross on the bottom, with each edge also matching its side colour.' },
  { id: 'white-corners', title: 'White corners', goal: 'Put the four white corners in, completing the whole white face.' },
  { id: 'middle-layer', title: 'Middle layer', goal: 'Slide the four middle-layer edges home, finishing the bottom two layers.' },
  { id: 'yellow-cross', title: 'Yellow cross', goal: 'Flip the top edges so they form a yellow cross (corners do not matter yet).' },
  { id: 'yellow-edges', title: 'Yellow edges', goal: 'Move the yellow edges so each one sits above its matching side colour.' },
  { id: 'yellow-corners-position', title: 'Position corners', goal: 'Move the four corners to their correct corners of the cube, ignoring their twist for now.' },
  { id: 'yellow-corners-orient', title: 'Orient corners', goal: 'Twist the corners in place so the yellow face is complete.' },
];

/**
 * Solve a cube with the beginner method.
 * @param {string} facelets 54-character URFDLB state (white up)
 * @returns {{stages: Array, moves: string[], failedAt: number, residual: string}}
 *   `failedAt` is -1 when all seven stages completed.
 */
export function solveBeginner(facelets) {
  // Work in the standard teaching orientation: white on the bottom, yellow up.
  let state = x2(facelets);
  const stages = STAGES.map((s) => ({ ...s, moves: [] }));

  const emitInto = (index) => (moves, explanation) => {
    stages[index].moves.push({ moves: moves.slice(), explanation });
  };

  const runners = [
    (s) => stageWhiteCross(s, emitInto(0)),
    (s) => stageWhiteCorners(s, emitInto(1)),
    (s) => stageMiddleLayer(s, emitInto(2)),
    (s) => stageYellowCross(s, emitInto(3)),
    (s) => stagePositionEdges(s, emitInto(4)),
    (s) => stagePositionCorners(s, emitInto(5)),
    (s) => stageOrientCorners(s, emitInto(6)),
  ];

  // Keep going even if a stage cannot finish: the caller can then hand the
  // remaining work to the Kociemba solver and still show what was achieved.
  let failedAt = -1;
  for (let i = 0; i < runners.length; i++) {
    const next = runners[i](state);
    if (next === null) { failedAt = i; break; }
    state = next;
  }

  // Translate every move back into the frame the user is holding.
  const all = [];
  for (const stage of stages) {
    for (const entry of stage.moves) {
      entry.moves = renameMoves(entry.moves);
      all.push(...entry.moves);
    }
  }
  return { stages, moves: simplify(all), failedAt, residual: state };
}

/** Drop X X' pairs and fold X X into X2 across a move list. */
export function simplify(moves) {
  const out = [];
  for (const mv of moves) {
    const last = out[out.length - 1];
    if (!last || last[0] !== mv[0]) { out.push(mv); continue; }
    const val = (n) => (n.endsWith('2') ? 2 : n.endsWith("'") ? 3 : 1);
    const total = (val(last) + val(mv)) % 4;
    out.pop();
    if (total === 1) out.push(mv[0]);
    else if (total === 2) out.push(mv[0] + '2');
    else if (total === 3) out.push(mv[0] + "'");
  }
  return out;
}

export {
  colorName, search, mapFaces, searchStage,
  stageWhiteCross, stageWhiteCorners, stageMiddleLayer,
  stageYellowCross, stagePositionEdges, stagePositionCorners, stageOrientCorners,
};
