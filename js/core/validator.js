/**
 * validator.js — is this sticker layout something a real cube could show?
 *
 * A physical 3x3 has exactly three ways to be impossible, and each one gets its
 * own plain-English explanation plus the list of stickers to highlight:
 *
 *   1. COUNTS      — not exactly nine of each colour, or two centres the same.
 *   2. PIECES      — a corner or edge whose colour combination cannot exist
 *                    (for example a corner showing both white and yellow).
 *   3. PARITY      — the three conservation laws: corner twists sum to 0 mod 3,
 *                    edge flips sum to 0 mod 2, and the corner and edge
 *                    permutations have the same sign.
 *
 * The first two are things the user mis-entered; the third means two stickers
 * were swapped somewhere, which is why we point at the pieces involved.
 */
import {
  FACE_NAMES, LETTERS, COLOR_OF_LETTER, countColors, centerLetter,
  faceletsToCubieState, CORNER_NAMES, EDGE_NAMES, CORNER_FACELETS, EDGE_FACELETS,
  SLOT_FACELETS, CUBIES, CORNER_HOME, EDGE_HOME, SOLVED_FACELETS, isSolved,
} from './cube-model.js';

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const OPPOSITE = { U: 'D', D: 'U', R: 'L', L: 'R', F: 'B', B: 'F' };

/** Sign of a permutation given as an array. */
function permutationSign(perm) {
  const seen = new Array(perm.length).fill(false);
  let sign = 1;
  for (let i = 0; i < perm.length; i++) {
    if (seen[i]) continue;
    let len = 0;
    let j = i;
    while (!seen[j]) { seen[j] = true; j = perm[j]; len++; }
    if (len % 2 === 0) sign = -sign;
  }
  return sign;
}

/** Facelet indices belonging to a named corner/edge slot. */
const slotFacelets = (slotIndex) => SLOT_FACELETS[slotIndex];

/* ------------------------------------------------------------------ *
 * The validator
 * ------------------------------------------------------------------ */

/**
 * @param {string} facelets 54-character state (any characters; unknown ones are
 *   reported as missing stickers rather than throwing).
 * @returns {{
 *   valid: boolean,
 *   complete: boolean,
 *   counts: Object<string,number>,
 *   issues: Array<{code, message, facelets:number[], piece?:string}>,
 *   suspectFacelets: number[]
 * }}
 */
export function validate(facelets) {
  const issues = [];
  const state = typeof facelets === 'string' ? facelets : '';
  const complete = state.length === 54 && [...state].every((c) => c in COLOR_OF_LETTER);

  const counts = countColors(state);
  const missing = LETTERS.reduce((n, l) => n + Math.max(0, 9 - counts[l]), 0);
  const suspect = [];

  /* ---- 1. counts and centres ---- */
  for (const letter of LETTERS) {
    if (counts[letter] !== 9) {
      issues.push({
        code: 'COUNT',
        message: `There are ${counts[letter]} ${COLOR_OF_LETTER[letter].name.toLowerCase()} stickers but there should be exactly 9.`,
        facelets: faceletsWithColor(state, letter),
      });
    }
  }

  const centers = FACE_NAMES.map((_, i) => centerLetter(state, i));
  const seenCenters = new Map();
  centers.forEach((letter, faceIndex) => {
    if (!(letter in COLOR_OF_LETTER)) {
      issues.push({
        code: 'CENTER_MISSING',
        message: `The centre of the ${['up', 'right', 'front', 'down', 'left', 'back'][faceIndex]} face has not been set.`,
        facelets: [faceIndex * 9 + 4],
      });
      return;
    }
    if (seenCenters.has(letter)) {
      issues.push({
        code: 'CENTER_DUPLICATE',
        message: `Two faces both show ${COLOR_OF_LETTER[letter].name.toLowerCase()} in the centre — each colour has exactly one centre.`,
        facelets: [faceIndex * 9 + 4, seenCenters.get(letter) * 9 + 4],
      });
    } else {
      seenCenters.set(letter, faceIndex);
    }
  });

  if (issues.length || !complete) {
    return finish(state, issues, counts, complete, missing);
  }

  /* ---- 2. every corner and edge must be a real piece ---- */
  let cubie;
  try {
    cubie = faceletsToCubieState(state);
  } catch (err) {
    issues.push({ code: 'IMPOSSIBLE', message: humaniseModelError(err), facelets: [] });
    return finish(state, issues, counts, complete, missing);
  }

  /* ---- 3. the three parity laws ---- */
  const twistSum = cubie.co.reduce((a, b) => a + b, 0) % 3;
  if (twistSum !== 0) {
    const twisted = [];
    cubie.co.forEach((t, i) => { if (t !== 0) twisted.push(i); });
    issues.push({
      code: 'TWIST_PARITY',
      message: 'The corners are twisted in a way a real cube cannot be: one of the highlighted corners needs turning. Check that no two corner stickers were swapped.',
      facelets: twisted.flatMap((i) => slotFacelets(CORNER_HOME[i])),
      piece: 'corners',
    });
  }

  const flipSum = cubie.eo.reduce((a, b) => a + b, 0) % 2;
  if (flipSum !== 0) {
    const flipped = [];
    cubie.eo.forEach((f, i) => { if (f !== 0) flipped.push(i); });
    issues.push({
      code: 'FLIP_PARITY',
      message: 'One edge is flipped over. A single edge can never be flipped on its own, so one of the highlighted edges has its colours swapped.',
      facelets: flipped.flatMap((i) => slotFacelets(EDGE_HOME[i])),
      piece: 'edges',
    });
  }

  const cornerSign = permutationSign(cubie.cp);
  const edgeSign = permutationSign(cubie.ep);
  if (cornerSign !== edgeSign) {
    issues.push({
      code: 'PERMUTATION_PARITY',
      message: 'Two pieces have been swapped. Corners and edges are always swapped in pairs, so check the highlighted pieces for a pair of stickers that changed places.',
      facelets: [
        ...oddCycles(cubie.cp).flatMap((i) => slotFacelets(CORNER_HOME[i])),
        ...oddCycles(cubie.ep).flatMap((i) => slotFacelets(EDGE_HOME[i])),
      ],
      piece: 'both',
    });
  }

  return finish(state, issues, counts, complete, missing);
}

/** Indices taking part in an odd-length cycle of a permutation. */
function oddCycles(perm) {
  const seen = new Array(perm.length).fill(false);
  const out = [];
  for (let i = 0; i < perm.length; i++) {
    if (seen[i]) continue;
    const cycle = [];
    let j = i;
    while (!seen[j]) { seen[j] = true; cycle.push(j); j = perm[j]; }
    if (cycle.length % 2 === 0) out.push(...cycle);
  }
  return out;
}

function faceletsWithColor(state, letter) {
  const out = [];
  for (let i = 0; i < state.length; i++) if (state[i] === letter) out.push(i);
  return out;
}

function humaniseModelError(err) {
  const msg = String(err.message || err);
  const colours = msg.replace(/No (corner|edge) piece has the colours /, '')
    .replace(/ \(slot [A-Z]+\)/, '');
  if (/corner/i.test(msg)) {
    return `No corner on a real cube has the colours ${colours}. Two of these stickers must be wrong.`;
  }
  if (/edge/i.test(msg)) {
    return `No edge on a real cube has the colours ${colours}. One of these stickers must be wrong.`;
  }
  return msg;
}

function finish(state, issues, counts, complete, missing) {
  const suspect = [];
  const seen = new Set();
  for (const issue of issues) {
    for (const f of issue.facelets || []) {
      if (!seen.has(f)) { seen.add(f); suspect.push(f); }
    }
  }
  return {
    valid: issues.length === 0 && complete,
    complete,
    solved: complete && isSolved(state),
    counts,
    missing,
    issues,
    suspectFacelets: suspect,
  };
}

/* ------------------------------------------------------------------ *
 * Convenience
 * ------------------------------------------------------------------ */

/** A one-line summary suitable for a status line. */
export function summary(result) {
  if (result.solved) return 'This cube is already solved.';
  if (!result.complete) return `${result.missing} sticker${result.missing === 1 ? '' : 's'} still to fill in.`;
  if (result.valid) return 'This looks like a real cube.';
  if (result.issues.length === 1) return result.issues[0].message;
  return `${result.issues.length} problems found. The highlighted stickers are the ones to check.`;
}

export { OPPOSITE };
