/**
 * cube-model.js — the mathematical heart of Cubix.
 *
 * SINGLE SOURCE OF TRUTH
 * ----------------------
 * A cube state is one 54 character "facelet string" in Kociemba's URFDLB order:
 *
 *     indices  0.. 8  = U face      9..17 = R face     18..26 = F face
 *     indices 27..35  = D face     36..44 = L face     45..53 = B face
 *
 * Each face is read row by row, left to right, looking *straight at that face*
 * with the cube oriented white-up / green-front:
 *
 *     U: row 0 is the BACK row (touching B),  col 0 is the LEFT column (touching L)
 *     R: row 0 is the TOP row,                col 0 is the FRONT column (touching F)
 *     F: row 0 is the TOP row,                col 0 is the LEFT column
 *     D: row 0 is the FRONT row (touching F), col 0 is the LEFT column
 *     L: row 0 is the TOP row,                col 0 is the BACK column (touching B)
 *     B: row 0 is the TOP row,                col 0 is the RIGHT column (touching R)
 *
 * Characters are face letters (U R F D L B) which double as colour names:
 *     U = white   R = red   F = green   D = yellow   L = orange   B = blue
 *
 * Everything else in the app (3D renderer, validator, solvers) is derived from
 * this string, and every move definition below is *computed geometrically*
 * rather than typed by hand, so the model cannot drift out of sync with itself.
 */

/* ------------------------------------------------------------------ *
 * 1. Constants
 * ------------------------------------------------------------------ */

export const SOLVED_FACELETS = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';

/** Face index constants (URFDLB order). */
export const F = Object.freeze({ U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 });
export const FACE_NAMES = Object.freeze(['U', 'R', 'F', 'D', 'L', 'B']);
export const FACE_HUMAN = Object.freeze({
  U: 'Up (white)', R: 'Right (red)', F: 'Front (green)',
  D: 'Down (yellow)', L: 'Left (orange)', B: 'Back (blue)',
});
export const LETTERS = Object.freeze(['U', 'R', 'F', 'D', 'L', 'B']);

/** Colour letters -> display name + hex. These six hexes are the ONLY colours in the app. */
export const COLOR_OF_LETTER = Object.freeze({
  U: { name: 'White',  hex: '#f5f5f5', swatchLetter: 'W' },
  R: { name: 'Red',    hex: '#d0342c', swatchLetter: 'R' },
  F: { name: 'Green',  hex: '#1f9d4d', swatchLetter: 'G' },
  D: { name: 'Yellow', hex: '#f2c200', swatchLetter: 'Y' },
  L: { name: 'Orange', hex: '#ef6c00', swatchLetter: 'O' },
  B: { name: 'Blue',   hex: '#1565d8', swatchLetter: 'B' },
});

/* ------------------------------------------------------------------ *
 * 2. Integer geometry helpers
 * ------------------------------------------------------------------ */

const AXIS = Object.freeze({
  U: [0, 1, 0], R: [1, 0, 0], F: [0, 0, 1],
  D: [0, -1, 0], L: [-1, 0, 0], B: [0, 0, -1],
});

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
/** Standard right-handed cross product a × b. */
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],   // NOTE: middle term is NEGATED (the classic slip)
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vkey = (v) => `${v[0]},${v[1]},${v[2]}`;
const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };

/**
 * Rotate an integer vector 90° about a unit axis.
 * @param {number[]} v
 * @param {number[]} axis  unit axis
 * @param {number} turns   +1 = R_axis(+90°) (counter-clockwise by the right-hand
 *                         rule), -1 = R_axis(-90°). Values are reduced mod 4.
 */
export function rot90(v, axis, turns) {
  let out = v.slice();
  const n = ((turns % 4) + 4) % 4;
  for (let i = 0; i < n; i++) {
    // Rodrigues at 90° (cos 0, sin 1): v' = (v·a)a + (a × v)  ==  R_axis(+90°) · v
    // Cross-checked against all six standard rotation-matrix identities:
    //   R_X(+90)·ŷ = ẑ   R_X(+90)·ẑ = -ŷ   R_Y(+90)·ẑ = x̂
    //   R_Y(+90)·x̂ = -ẑ   R_Z(+90)·x̂ = ŷ   R_Z(+90)·ŷ = -x̂
    out = add(scale(axis, dot(out, axis)), cross(axis, out)).map(Math.round);
  }
  return out;
}

/**
 * Rotate an integer vector 120° about a (possibly diagonal) axis.
 * turns = +1 is R_axis(+120°) (counter-clockwise by the right-hand rule).
 */
export function rot120(v, axis, turns) {
  let out = v.slice();
  const a = norm3(axis);
  const n = ((turns % 3) + 3) % 3;
  const cos = -0.5, sin = Math.sqrt(3) / 2;
  for (let i = 0; i < n; i++) {
    const d = dot(out, a);
    const c = cross(a, out);
    out = [0, 1, 2].map((k) => Math.round(out[k] * cos + c[k] * sin + a[k] * d * (1 - cos)));
  }
  return out;
}

function faceOfDir(v) {
  for (const f of FACE_NAMES) {
    const a = AXIS[f];
    if (a[0] === v[0] && a[1] === v[1] && a[2] === v[2]) return f;
  }
  throw new Error('Not a face normal: ' + v);
}

/* ------------------------------------------------------------------ *
 * 3. The 26 cubie positions ("slots") and their sticker faces
 * ------------------------------------------------------------------ */

export const SLOTS = (() => {
  const list = [];
  for (let x = -1; x <= 1; x++)
    for (let y = -1; y <= 1; y++)
      for (let z = -1; z <= 1; z++) {
        if (x === 0 && y === 0 && z === 0) continue;
        list.push([x, y, z]);
      }
  return list;
})();

export const SLOT_INDEX = new Map(SLOTS.map((v, i) => [vkey(v), i]));

/**
 * Faces a slot touches, ordered so the orientation *reference* face comes first:
 * U/D for corners and U/D-layer edges, F/B for middle-layer edges.
 */
function slotFaces(v) {
  const [x, y, z] = v;
  const f = [];
  if (y === 1) f.push('U');
  if (y === -1) f.push('D');
  if (z === 1) f.push('F');
  if (z === -1) f.push('B');
  if (x === 1) f.push('R');
  if (x === -1) f.push('L');
  return f;
}

export const CUBIES = SLOTS.map((pos, index) => {
  const faces = slotFaces(pos);
  return {
    index,
    pos,
    faces,
    dirs: faces.map((f) => AXIS[f].slice()),
    kind: faces.length === 3 ? 'corner' : faces.length === 2 ? 'edge' : 'center',
  };
});

/* ------------------------------------------------------------------ *
 * 4. Facelet <-> geometry map (derived, never hand-typed)
 * ------------------------------------------------------------------ */

function faceletCoord(face, row, col) {
  switch (face) {
    case 'U': return [col - 1, 1, row - 1];   // row 0 -> z = -1 (back)
    case 'R': return [1, 1 - row, 1 - col];   // col 0 -> z = +1 (front)
    case 'F': return [col - 1, 1 - row, 1];
    case 'D': return [col - 1, -1, 1 - row];  // row 0 -> z = +1 (front)
    case 'L': return [-1, 1 - row, col - 1];  // col 0 -> z = -1 = BACK column
    case 'B': return [1 - col, 1 - row, -1];  // col 0 -> x = +1 (right)
    default: throw new Error('bad face ' + face);
  }
}

/** facelet index -> { index, face, faceIndex, row, col, slot, coord } */
export const FACELET_INFO = (() => {
  const arr = [];
  FACE_NAMES.forEach((face, faceIndex) => {
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const coord = faceletCoord(face, row, col);
        arr.push({
          index: faceIndex * 9 + row * 3 + col,
          face, faceIndex, row, col, coord,
          slot: SLOT_INDEX.get(vkey(coord)),
        });
      }
    }
  });
  return arr;
})();

/** slot -> { faceLetter: faceletIndex } for its home stickers */
const SLOT_FACELET_BY_FACE = SLOTS.map(() => ({}));
for (const info of FACELET_INFO) SLOT_FACELET_BY_FACE[info.slot][info.face] = info.index;

/** slot -> facelet indices in the slot's `faces` order */
export const SLOT_FACELETS = CUBIES.map((c) => c.faces.map((f) => SLOT_FACELET_BY_FACE[c.index][f]));

/** facelet index -> the facelet index of the sticker at (slot, face) */
const FACELET_OF = new Map();
for (const info of FACELET_INFO) FACELET_OF.set(`${info.slot}|${info.face}`, info.index);

/* ------------------------------------------------------------------ *
 * 5. Cubie-level indexing (corners / edges) and orientation conventions
 * ------------------------------------------------------------------ */

const CORNER_COORDS = [
  [1, 1, 1], [-1, 1, 1], [-1, 1, -1], [1, 1, -1],
  [1, -1, 1], [-1, -1, 1], [-1, -1, -1], [1, -1, -1],
];
const EDGE_COORDS = [
  [0, 1, 1], [0, 1, -1], [-1, 1, 0], [1, 1, 0],
  [0, -1, 1], [0, -1, -1], [-1, -1, 0], [1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [-1, 0, -1], [1, 0, -1],
];

export const CORNER_HOME = CORNER_COORDS.map((c) => SLOT_INDEX.get(vkey(c)));
export const EDGE_HOME = EDGE_COORDS.map((c) => SLOT_INDEX.get(vkey(c)));
export const CORNER_NAMES = Object.freeze(['URF', 'UFL', 'ULB', 'UBR', 'DFR', 'DLF', 'DBL', 'DRB']);
export const EDGE_NAMES = Object.freeze(['UF', 'UB', 'UL', 'UR', 'DF', 'DB', 'DL', 'DR', 'FR', 'FL', 'BL', 'BR']);
export const CORNER_FACELETS = CORNER_HOME.map((s) => SLOT_FACELETS[s]);
export const EDGE_FACELETS = EDGE_HOME.map((s) => SLOT_FACELETS[s]);

/**
 * Twist numbering for each corner slot: which *slot face* holds the piece's
 * U/D sticker for twist 0/1/2. Derived by rotating the reference direction
 * ±120° about the outward diagonal, so the chirality is guaranteed consistent.
 */
const TWIST_FACE_FOR_VALUE = (() => {
  const out = [];
  for (let ci = 0; ci < 8; ci++) {
    const cubie = CUBIES[CORNER_HOME[ci]];
    const axis = cubie.pos;
    const ref = cubie.dirs[0];
    const a = rot120(ref, axis, 1), b = rot120(ref, axis, -1);
    out.push([cubie.faces[0], faceOfDir(a), faceOfDir(b)]);
    if (new Set(out[ci]).size !== 3) throw new Error('degenerate twist map for ' + CORNER_NAMES[ci]);
  }
  return out;
})();

/** slot face index -> twist value */
const TWIST_VALUE_FOR_FACE_INDEX = TWIST_FACE_FOR_VALUE.map((faces) => {
  const m = new Map();
  faces.forEach((f, t) => m.set(f, t));
  return m;
});

/**
 * The three faces of each corner in cyclic order under a +120° rotation about
 * the corner's own outward diagonal: order[0] is the U/D face, order[1] is where
 * order[0] goes after +120°, order[2] after another +120°.
 *
 * This matters because placing a corner cubie into a slot is always a PROPER
 * rotation, and proper rotations commute with rot120 (R·rot_n = rot_{R n}·R), so
 * a piece's cyclic order is always carried onto the slot's cyclic order with a
 * single shift. That single shift is exactly what "twist" records.
 */
const CORNER_CYCLIC_ORDER = CORNER_HOME.map((slot) => {
  const cubie = CUBIES[slot];
  const order = [cubie.faces[0]];
  let dir = AXIS[cubie.faces[0]];
  for (let k = 1; k < 3; k++) {
    dir = rot120(dir, cubie.pos, 1);
    order.push(faceOfDir(dir));
  }
  if (new Set(order).size !== 3) throw new Error('degenerate corner cycle ' + CORNER_NAMES[CORNER_HOME.indexOf(slot)]);
  return order;
});

/**
 * TWIST_OFFSET[corner][twist] = the index in CORNER_CYCLIC_ORDER[corner] of the
 * slot face that holds the piece's U/D sticker at that twist value.
 */
const TWIST_OFFSET = CORNER_HOME.map((slot, ci) => {
  const order = CORNER_CYCLIC_ORDER[ci];
  return TWIST_FACE_FOR_VALUE[ci].map((face) => {
    const at = order.indexOf(face);
    if (at < 0) throw new Error('twist face not in cycle');
    return at;
  });
});

/** The face an edge's reference sticker must point at when unflipped. */
const EDGE_REF_FACE = EDGE_HOME.map((s) => CUBIES[s].faces[0]);

/* ------------------------------------------------------------------ *
 * 6. Moves
 * ------------------------------------------------------------------ */

export const MOVE_NAMES = Object.freeze(['U', 'R', 'F', 'D', 'L', 'B']);

/**
 * One CLOCKWISE quarter turn of each face, expressed as a rotation about that
 * face's OUTWARD normal using rot90's honest semantics (turns = +1 is
 * R_normal(+90°), counter-clockwise by the right-hand rule).
 *
 * Looking straight AT a face, "clockwise" is a NEGATIVE rotation about the
 * normal pointing back at you, so every entry is -1. The uniformity is the
 * point: an earlier version of this file carried hand-tuned per-face signs, two
 * of which were wrong (U and L) in a way that no internal consistency check
 * could catch. This table is now checked move-by-move against cubejs 1.3.2 in
 * tests/reference.test.mjs, and against these plain-language consequences:
 *
 *   U  (+Y): the front top row travels to the LEFT face   (F -> L -> B -> R)
 *   R  (+X): the front-right column travels UP            (FR -> UR -> BR -> DR)
 *   F  (+Z): the top row travels to the RIGHT column      (UF -> FR -> DF -> FL)
 *   D  (-Y): the front bottom row travels to the LEFT face
 *   L  (-X): the front-left column travels DOWN
 *   B  (-Z): the top row travels to the LEFT column
 */
export const MOVE_TURNS = Object.freeze({ U: -1, R: -1, F: -1, D: -1, L: -1, B: -1 });

const OPPOSITES = { U: 'D', D: 'U', R: 'L', L: 'R', F: 'B', B: 'F' };
export const isOpposite = (a, b) => OPPOSITES[a] === b;

/**
 * FACELET_PERM[face][i] = the facelet index whose sticker lands at index i
 * after one clockwise quarter turn of `face`. Derived geometrically:
 * a sticker travels with its cubie and ends up on the face its (rotated)
 * normal points to.
 */
export const FACELET_PERM = (() => {
  const out = {};
  for (const face of MOVE_NAMES) {
    const axis = AXIS[face], turns = MOVE_TURNS[face];
    const perm = new Array(54);
    for (const info of FACELET_INFO) {
      const cubie = CUBIES[info.slot];
      if (dot(cubie.pos, axis) !== 1) { perm[info.index] = info.index; continue; }
      const newSlot = SLOT_INDEX.get(vkey(rot90(cubie.pos, axis, turns)));
      const newFace = faceOfDir(rot90(AXIS[info.face], axis, turns));
      perm[FACELET_OF.get(`${newSlot}|${newFace}`)] = info.index;
    }
    if (perm.some((v) => v === undefined)) throw new Error('bad facelet perm for ' + face);
    out[face] = perm;
  }
  return out;
})();

/** Counter-clockwise quarter turn permutations. */
export const FACELET_PERM_INV = Object.fromEntries(
  Object.entries(FACELET_PERM).map(([face, perm]) => {
    const inv = new Array(54);
    perm.forEach((v, i) => { inv[v] = i; });
    return [face, inv];
  })
);

export function applyQuarterTurn(facelets, face, sign = 1) {
  const perm = sign > 0 ? FACELET_PERM[face] : FACELET_PERM_INV[face];
  const out = new Array(54);
  for (let i = 0; i < 54; i++) out[i] = facelets[perm[i]];
  return out.join('');
}

/**
 * Parse "R" | "R'" | "R2".
 * `power` is the number of quarter turns to repeat, `sign` their direction, so a
 * prime is { power: 1, sign: -1 } (NOT power 3 — see applyMove).
 */
export function parseMove(move) {
  const m = /^([URFDLB])(2|')?$/.exec(String(move).trim());
  if (!m) throw new Error('Unsupported move notation: "' + move + '"');
  const face = m[1];
  if (m[2] === '2') return { face, power: 2, sign: 1, name: face + '2' };
  // A prime is ONE counter-clockwise quarter turn. (It must not be expressed as
  // "3 turns with sign -1", or applyMove would apply the inverse three times.)
  if (m[2] === "'") return { face, power: 1, sign: -1, name: face + "'" };
  return { face, power: 1, sign: 1, name: face };
}

export function applyMove(facelets, move) {
  const m = parseMove(move);
  let s = facelets;
  for (let i = 0; i < m.power; i++) s = applyQuarterTurn(s, m.face, m.sign);
  return s;
}

export function applyMoveSequence(facelets, moves) {
  let s = facelets;
  for (const m of moves) s = applyMove(s, m);
  return s;
}

export function invertMoves(moves) {
  return moves.slice().reverse().map((m) => {
    const p = parseMove(m);
    if (p.sign === -1) return p.face;        // prime  -> its inverse is the plain turn
    if (p.power === 2) return p.face + '2';  // double -> self inverse
    return p.face + "'";
  });
}

export function tokenizeMoves(str) {
  return String(str).trim().split(/[\s,]+/).filter(Boolean);
}

/* ------------------------------------------------------------------ *
 * 7. Cubie level state + move effects (used by the two-phase solver)
 * ------------------------------------------------------------------ */

/**
 * Effect of one clockwise quarter turn of each face on the cubie state:
 * cp[i] = corner index that moves INTO slot i, co[i] = its twist there.
 */
const MOVE_EFFECT = (() => {
  const out = {};
  for (const face of MOVE_NAMES) {
    const axis = AXIS[face], turns = MOVE_TURNS[face];
    const cp = new Array(8).fill(-1), co = new Array(8).fill(0);
    const ep = new Array(12).fill(-1), eo = new Array(12).fill(0);

    for (let ci = 0; ci < 8; ci++) {
      const cubie = CUBIES[CORNER_HOME[ci]];
      if (dot(cubie.pos, axis) !== 1) { cp[ci] = ci; co[ci] = 0; continue; }
      const toCi = CORNER_HOME.indexOf(SLOT_INDEX.get(vkey(rot90(cubie.pos, axis, turns))));
      cp[toCi] = ci;
      co[toCi] = TWIST_VALUE_FOR_FACE_INDEX[toCi].get(faceOfDir(rot90(cubie.dirs[0], axis, turns)));
    }
    for (let ei = 0; ei < 12; ei++) {
      const cubie = CUBIES[EDGE_HOME[ei]];
      if (dot(cubie.pos, axis) !== 1) { ep[ei] = ei; eo[ei] = 0; continue; }
      const toEi = EDGE_HOME.indexOf(SLOT_INDEX.get(vkey(rot90(cubie.pos, axis, turns))));
      ep[toEi] = ei;
      eo[toEi] = faceOfDir(rot90(cubie.dirs[0], axis, turns)) === EDGE_REF_FACE[toEi] ? 0 : 1;
    }
    if (cp.includes(-1) || ep.includes(-1)) throw new Error('bad move effect for ' + face);
    out[face] = { cp, co, ep, eo };
  }
  return out;
})();

export const MOVE_EFFECTS = MOVE_EFFECT;

export function identityCubieState() {
  return {
    cp: [0, 1, 2, 3, 4, 5, 6, 7],
    co: [0, 0, 0, 0, 0, 0, 0, 0],
    ep: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    eo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  };
}

/** One clockwise quarter turn of `face` on a cubie state. */
export function applyQuarterTurnCubieOnce(state, face) {
  const e = MOVE_EFFECT[face];
  const cp = new Array(8), co = new Array(8), ep = new Array(12), eo = new Array(12);
  for (let i = 0; i < 8; i++) {
    cp[i] = state.cp[e.cp[i]];
    co[i] = (state.co[e.cp[i]] + e.co[i]) % 3;
  }
  for (let i = 0; i < 12; i++) {
    ep[i] = state.ep[e.ep[i]];
    eo[i] = (state.eo[e.ep[i]] + e.eo[i]) % 2;
  }
  return { cp, co, ep, eo };
}

/**
 * A quarter turn of `face` in the given direction. The counter-clockwise
 * direction is simply three clockwise quarter turns (the move tables only store
 * the clockwise effect), which keeps the two representations in lockstep.
 */
export function applyQuarterTurnCubie(state, face, sign = 1) {
  const times = sign > 0 ? 1 : 3;
  let s = state;
  for (let i = 0; i < times; i++) s = applyQuarterTurnCubieOnce(s, face);
  return s;
}

export function applyMoveCubie(state, move) {
  const m = parseMove(move);
  let s = state;
  for (let i = 0; i < m.power; i++) s = applyQuarterTurnCubie(s, m.face, m.sign);
  return s;
}

/* ------------------------------------------------------------------ *
 * 8. Facelet string <-> cubie state
 * ------------------------------------------------------------------ */

/** Colour multiset of each corner / edge piece at home (for piece identification). */
const CORNER_COLOUR_KEYS = CORNER_HOME.map((s) => CUBIES[s].faces.slice().sort().join(''));
const EDGE_COLOUR_KEYS = EDGE_HOME.map((s) => CUBIES[s].faces.slice().sort().join(''));

/**
 * Convert a 54 facelet string into a cubie state.
 * Throws a descriptive Error if the sticker layout cannot exist on a real cube;
 * `validator.js` turns those into friendly, highlighted diagnostics.
 */
export function faceletsToCubieState(facelets) {
  if (typeof facelets !== 'string' || facelets.length !== 54) {
    throw new Error('A cube state must be exactly 54 stickers.');
  }
  const st = identityCubieState();
  const seenCorners = new Set();
  const seenEdges = new Set();

  for (let ci = 0; ci < 8; ci++) {
    const slot = CORNER_HOME[ci];
    const idx = SLOT_FACELETS[slot];
    const colors = idx.map((i) => facelets[i]);
    const piece = CORNER_COLOUR_KEYS.indexOf(colors.slice().sort().join(''));
    if (piece < 0) throw cornerError(ci, colors);
    if (seenCorners.has(piece)) throw new Error(`Duplicate corner piece ${CORNER_NAMES[piece]}`);
    seenCorners.add(piece);
    st.cp[ci] = piece;

    const refLetter = CUBIES[CORNER_HOME[piece]].faces[0];   // 'U' or 'D'
    const at = colors.indexOf(refLetter);
    if (at < 0) throw cornerError(ci, colors);
    st.co[ci] = TWIST_VALUE_FOR_FACE_INDEX[ci].get(CUBIES[slot].faces[at]);
  }

  for (let ei = 0; ei < 12; ei++) {
    const slot = EDGE_HOME[ei];
    const idx = SLOT_FACELETS[slot];
    const colors = idx.map((i) => facelets[i]);
    const piece = EDGE_COLOUR_KEYS.indexOf(colors.slice().sort().join(''));
    if (piece < 0) throw edgeError(ei, colors);
    if (seenEdges.has(piece)) throw new Error(`Duplicate edge piece ${EDGE_NAMES[piece]}`);
    seenEdges.add(piece);
    st.ep[ei] = piece;
    st.eo[ei] = colors[0] === CUBIES[EDGE_HOME[piece]].faces[0] ? 0 : 1;
  }
  return st;
}

function cornerError(ci, colors) {
  const e = new Error(`No corner piece has the colours ${colors.map(describe).join(' + ')} (slot ${CORNER_NAMES[ci]})`);
  e.code = 'IMPOSSIBLE_CORNER'; e.slot = ci;
  return e;
}
function edgeError(ei, colors) {
  const e = new Error(`No edge piece has the colours ${colors.map(describe).join(' + ')} (slot ${EDGE_NAMES[ei]})`);
  e.code = 'IMPOSSIBLE_EDGE'; e.slot = ei;
  return e;
}
const describe = (l) => COLOR_OF_LETTER[l] ? COLOR_OF_LETTER[l].name : String(l);

/**
 * Inverse mapping — rebuild a facelet string from a cubie state.
 * Used by the tests (round-trip proof) and by the renderer's letter overlays.
 */
export function cubieStateToFacelets(state) {
  const out = new Array(54).fill('?');
  for (let ci = 0; ci < 6; ci++) out[ci * 9 + 4] = FACE_NAMES[ci];

  for (let ci = 0; ci < 8; ci++) {
    const piece = state.cp[ci];
    const slot = CORNER_HOME[ci];
    const slotFaces = CUBIES[slot].faces;
    const homeFaces = CUBIES[CORNER_HOME[piece]].faces;
    const idx = SLOT_FACELETS[slot];
    const map = cornerStickerMap(ci, piece, state.co[ci]);
    for (let k = 0; k < 3; k++) out[idx[k]] = map.get(slotFaces[k]);
  }

  for (let ei = 0; ei < 12; ei++) {
    const piece = state.ep[ei];
    const homeFaces = CUBIES[EDGE_HOME[piece]].faces;
    const idx = SLOT_FACELETS[EDGE_HOME[ei]];
    if (state.eo[ei] === 0) { out[idx[0]] = homeFaces[0]; out[idx[1]] = homeFaces[1]; }
    else { out[idx[0]] = homeFaces[1]; out[idx[1]] = homeFaces[0]; }
  }
  return out.join('');
}

/**
 * For the corner sitting in slot `ci` (piece `piece`, twist `twist`), return a
 * Map from slot face -> home face.
 *
 * Derivation: a proper rotation carries the piece's cyclic order onto the slot's
 * cyclic order with a single shift s = TWIST_OFFSET[ci][twist], so the slot face
 * order[j] carries the home face homeOrder[(j - s) mod 3].
 */
const STICKER_MAP_CACHE = new Map();
function cornerStickerMap(ci, piece, twist) {
  const key = `${ci}|${piece}|${twist}`;
  let cached = STICKER_MAP_CACHE.get(key);
  if (cached) return cached;
  const slotOrder = CORNER_CYCLIC_ORDER[ci];
  const homeOrder = CORNER_CYCLIC_ORDER[piece];
  const shift = TWIST_OFFSET[ci][twist];
  cached = new Map(slotOrder.map((face, j) => [face, homeOrder[(j - shift + 3) % 3]]));
  STICKER_MAP_CACHE.set(key, cached);
  return cached;
}

/* ------------------------------------------------------------------ *
 * 9. Utilities used across the app
 * ------------------------------------------------------------------ */

export const isSolved = (facelets) => facelets === SOLVED_FACELETS;

export function countColors(facelets) {
  const c = { U: 0, R: 0, F: 0, D: 0, L: 0, B: 0 };
  for (const ch of facelets) if (ch in c) c[ch]++;
  return c;
}

export const centerLetter = (facelets, faceIndex) => facelets[faceIndex * 9 + 4];

export function faceIndexOfCenter(facelets, letter) {
  for (let i = 0; i < 6; i++) if (facelets[i * 9 + 4] === letter) return i;
  return -1;
}

/** A pseudo-random scramble that never repeats a face or does R L R style noise. */
export function randomScramble(length = 25, rng = Math.random) {
  const out = [];
  let last = null, before = null;
  while (out.length < length) {
    const f = MOVE_NAMES[Math.floor(rng() * 6)];
    if (f === last) continue;
    if (f === before && isOpposite(f, last)) continue;
    out.push(f + ['', "'", '2'][Math.floor(rng() * 3)]);
    before = last; last = f;
  }
  return out;
}

/** All 18 quarter/half/inverse turns, grouped by face. */
export const ALL_MOVES = Object.freeze(
  MOVE_NAMES.flatMap((f) => [f, f + "'", f + '2'])
);
