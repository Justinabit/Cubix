/**
 * cube-ops.js — colour-level operations and whole-cube rotations.
 *
 * Where cube-model.js is about *positions* (URFDLB facelet order, cubie slots),
 * this module is about *what a person sees*: "is the white cross done?", "put
 * white on the bottom", "rename these moves back into the original frame".
 *
 * The beginner (layer-by-layer) solver works entirely in terms of these colour
 * level predicates, so its stage goals read exactly like the instructions in a
 * beginner tutorial.
 */
import {
  FACE_NAMES, FACELET_INFO, SOLVED_FACELETS, CUBIES, SLOT_INDEX,
  applyMove, faceletsToCubieState, countColors,
} from './cube-model.js';

// Local aliases so the geometry helpers read clearly below.
const M_SLOT_INDEX = SLOT_INDEX;
const M_CUBIES = CUBIES;

/* ------------------------------------------------------------------ *
 * Facelet addressing by (face, row, col)
 * ------------------------------------------------------------------ */

export const faceIndex = (face) => FACE_NAMES.indexOf(face);
export const faceletIndex = (face, row, col) => faceIndex(face) * 9 + row * 3 + col;
export const at = (state, face, row, col) => state[faceletIndex(face, row, col)];
export const center = (state, face) => at(state, face, 1, 1);
export const centers = (state) => FACE_NAMES.map((f) => center(state, f));

/** The 3 rows of a face as arrays of colour letters. */
export function faceRows(state, face) {
  const b = faceIndex(face) * 9;
  return [
    [state[b], state[b + 1], state[b + 2]],
    [state[b + 3], state[b + 4], state[b + 5]],
    [state[b + 6], state[b + 7], state[b + 8]],
  ];
}

/** Which face currently shows `color` on its centre (or -1). */
export function faceOfCenter(state, color) {
  return FACE_NAMES.findIndex((f) => center(state, f) === color);
}

/* ------------------------------------------------------------------ *
 * Whole-cube rotations (relabellings of the state, NOT moves)
 * ------------------------------------------------------------------ */

const AXIS_OF = {
  U: [0, 1, 0], R: [1, 0, 0], F: [0, 0, 1],
  D: [0, -1, 0], L: [-1, 0, 0], B: [0, 0, -1],
};

/**
 * Physically rotate the whole cube by `map` (a function from unit vectors to
 * unit vectors) and return the resulting facelet string. Colours travel with
 * their stickers, so this is just a relabelling of the state.
 */
export function rotateCube(state, map) {
  const table = new Map();
  for (const info of FACELET_INFO) {
    const p = map(info.coord);
    const d = map(AXIS_OF[info.face]);
    table.set(`${p.join(',')}|${d.join(',')}`, state[info.index]);
  }
  const out = new Array(54);
  for (const info of FACELET_INFO) {
    out[info.index] = table.get(`${info.coord.join(',')}|${AXIS_OF[info.face].join(',')}`);
  }
  return out.join('');
}

/** 180° about the X axis: U <-> D and F <-> B. Puts the white face on the bottom. */
export const x2 = (state) => rotateCube(state, ([x, y, z]) => [x, -y, -z]);

/** 90° about Y, sending F -> R -> B -> L (the same direction as a U turn). */
export const y = (state) => rotateCube(state, ([x, y_, z]) => [z, y_, -x]);
export const y2 = (state) => y(y(state));
export const y3 = (state) => y(y2(state));

/**
 * Move renaming for translating a solution found in the x2-rotated frame back
 * into the frame the user is holding.
 *
 * Derivation: with φ = x2 and T = φ(S), a move sequence M that solves T gives
 *   S · t(M) = SOLVED   where   S · t(m) === φ(φ(S) · m)  for every move m.
 * t is what this table encodes, and it was verified empirically (see
 * tests/cube-ops.test.mjs) rather than derived by hand — the primes on the U/D
 * turns are easy to get backwards, and getting them backwards produces a
 * solution that very nearly works.
 */
export const RENAME_X2 = Object.freeze({ U: 'D', D: 'U', R: 'R', L: 'L', F: 'B', B: 'F' });
export const RENAME_Y = Object.freeze({ U: 'U', D: 'D', R: 'B', B: 'L', L: 'F', F: 'R' });
export const RENAME_Y3 = Object.freeze({ U: 'U', D: 'D', R: 'F', F: 'L', L: 'B', B: 'R' });

/** Apply a renaming table to a list of moves, preserving primes and doubles. */
export function renameMoves(moves, table = RENAME_X2) {
  return moves.map((mv) => {
    const face = mv[0];
    const suffix = mv.slice(1);
    const target = table[face];
    if (suffix === '2') return target[0] + '2';
    if (suffix === "'") return target.length > 1 ? target[0] : target[0] + "'";
    return target;
  });
}

/* ------------------------------------------------------------------ *
 * Stage predicates — phrased the way a tutorial phrases them
 * ------------------------------------------------------------------ */

/** Every sticker on `face` is the same colour. */
export function faceSolved(state, face) {
  const b = faceIndex(face) * 9;
  const c = state[b + 4];
  for (let i = 0; i < 9; i++) if (state[b + i] !== c) return false;
  return true;
}

/** The four edges of `face` show its own centre colour (a cross, e.g. white). */
export function crossSolved(state, face) {
  const c = center(state, face);
  const rows = faceRows(state, face);
  return rows[0][1] === c && rows[1][0] === c && rows[1][2] === c && rows[2][1] === c;
}

/** How many of the four edges of `face` show its own centre colour. */
export function crossCount(state, face) {
  const c = center(state, face);
  const rows = faceRows(state, face);
  return [rows[0][1], rows[1][0], rows[1][2], rows[2][1]].filter((v) => v === c).length;
}

/** The 4 corners of `face` show `face`'s centre colour on `face` itself. */
export function cornersOriented(state, face) {
  const c = center(state, face);
  const rows = faceRows(state, face);
  return [rows[0][0], rows[0][2], rows[2][0], rows[2][2]].filter((v) => v === c).length;
}

/**
 * The whole `face` is one colour (used for "the yellow face is complete").
 */
export const faceComplete = faceSolved;

/**
 * Bottom two layers solved: the D face is finished and each side face's lower
 * two rows match its centre.
 */
export function f2lSolved(state) {
  if (!faceSolved(state, 'D')) return false;
  for (const f of ['F', 'R', 'B', 'L']) {
    const c = center(state, f);
    if (at(state, f, 1, 0) !== c || at(state, f, 1, 2) !== c) return false;  // middle layer
    if (at(state, f, 2, 0) !== c || at(state, f, 2, 1) !== c || at(state, f, 2, 2) !== c) return false;
  }
  return true;
}

/** Every face is a single colour. */
export function isUniform(state) {
  return FACE_NAMES.every((f) => faceSolved(state, f));
}

/* ------------------------------------------------------------------ *
 * Piece slots — coordinates derived from the geometry, never hand typed
 * ------------------------------------------------------------------ */

/**
 * slot -> [{ face, row, col, index }] for each sticker of that slot, plus the
 * slot's home colours.
 *
 * Every coordinate here is looked up from the 3D geometry in cube-model.js, so
 * this table cannot disagree with the move engine (hand-typed facelet
 * coordinates are the single most common source of "solver says solved but the
 * cube isn't" bugs).
 */
function buildSlots() {
  const out = {};
  const add = (pos) => {
    const slot = M_SLOT_INDEX.get(pos.join(','));
    const cubie = M_CUBIES[slot];
    const name = cubie.faces.join('');
    out[name] = {
      name,
      pos,
      kind: cubie.kind,
      faces: cubie.faces.slice(),
      stickers: cubie.faces.map((face) => {
        const info = FACELET_INFO.find((f) => f.slot === slot && f.face === face);
        return { face, row: info.row, col: info.col, index: info.index };
      }),
    };
    return out[name];
  };
  for (const pos of EDGE_COORDS) add(pos);
  for (const pos of CORNER_COORDS) add(pos);
  return out;
}

const EDGE_COORDS = [
  [0, 1, 1], [0, 1, -1], [-1, 1, 0], [1, 1, 0],
  [0, -1, 1], [0, -1, -1], [-1, -1, 0], [1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [-1, 0, -1], [1, 0, -1],
];
const CORNER_COORDS = [
  [1, 1, 1], [-1, 1, 1], [-1, 1, -1], [1, 1, -1],
  [1, -1, 1], [-1, -1, 1], [-1, -1, -1], [1, -1, -1],
];

export const SLOTS = buildSlots();

/** The colours a slot must show when the cube is solved, sorted. */
export function slotTarget(state, name) {
  return SLOTS[name].stickers.map((s) => center(state, s.face)).sort().join('');
}

/** The colours a slot currently shows, sorted. */
export function slotColors(state, name) {
  return SLOTS[name].stickers.map((s) => at(state, s.face, s.row, s.col)).sort().join('');
}

/** True when the piece in `name` is the right piece in the right orientation. */
export function slotSolved(state, name) {
  const slot = SLOTS[name];
  return slot.stickers.every((s) => at(state, s.face, s.row, s.col) === center(state, s.face));
}

/** True when the right *piece* is in this slot, ignoring its orientation. */
export function slotHasRightPiece(state, name) {
  return slotColors(state, name) === slotTarget(state, name);
}

/** Where is the piece whose home is `name`? Returns the slot name it occupies. */
export function findPiece(state, name) {
  const target = slotTarget(state, name);
  return Object.values(SLOTS)
    .filter((s) => s.kind === SLOTS[name].kind && slotColors(state, s.name) === target)
    .map((s) => s.name);
}

/** All eight D-layer + E-slice slots that make up the first two layers. */
export const F2L_SLOT_NAMES = ['DF', 'DR', 'DB', 'DL', 'FR', 'FL', 'BL', 'BR', 'DFR', 'DLF', 'DBL', 'DRB'];

export function f2lSlotsSolved(state) {
  return F2L_SLOT_NAMES.filter((n) => slotSolved(state, n));
}

/* ------------------------------------------------------------------ *
 * Misc
 * ------------------------------------------------------------------ */

/** True when the state could exist on a real cube (9 of each colour, legal pieces). */
export function isLegalCube(state) {
  if (typeof state !== 'string' || state.length !== 54) return false;
  const counts = countColors(state);
  if (Object.values(counts).some((n) => n !== 9)) return false;
  try {
    faceletsToCubieState(state);
    return true;
  } catch {
    return false;
  }
}

export { SOLVED_FACELETS, applyMove, FACE_NAMES };
