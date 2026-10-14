/**
 * permutation-truth.test.mjs — re-derives all six face turns from scratch.
 *
 * cube-model.js builds its move tables with integer geometry, which is fast and
 * elegant but means a sign error can hide from every internal check. This file
 * recomputes where all 54 stickers must go using an independent, textbook
 * Rodrigues axis-angle rotation, then compares.
 *
 * The single definition used here: a CLOCKWISE turn of a face, as seen by
 * someone looking straight at that face, is a rotation of -90° about the face's
 * OUTWARD normal (right-hand rule).
 *
 * Run: node tests/permutation-truth.test.mjs
 */
import assert from 'node:assert/strict';
import * as M from '../js/core/cube-model.js';

/* ---------- independent rotation maths (does not use cube-model's rot90) ---------- */
const NORMAL = { U: [0, 1, 0], D: [0, -1, 0], F: [0, 0, 1], B: [0, 0, -1], R: [1, 0, 0], L: [-1, 0, 0] };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Rodrigues: rotate v about the unit axis `axis` by `angle` radians. */
function rotate(v, axis, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const k = cross(axis, v);
  const d = dot(axis, v) * (1 - c);
  return [
    Math.round(v[0] * c + k[0] * s + axis[0] * d),
    Math.round(v[1] * c + k[1] * s + axis[1] * d),
    Math.round(v[2] * c + k[2] * s + axis[2] * d),
  ];
}

const faceOfNormal = (n) => Object.keys(NORMAL).find((f) => NORMAL[f].every((v, i) => v === n[i]));
const name = (k) => M.FACELET_INFO[k].face + M.FACELET_INFO[k].row + M.FACELET_INFO[k].col;
const CLOCKWISE = -Math.PI / 2;   // clockwise seen from outside == -90° about the outward normal

let failures = 0;
const travel = {};

for (const face of M.MOVE_NAMES) {
  const n = NORMAL[face];
  const expected = new Array(54);

  for (const info of M.FACELET_INFO) {
    const pos = M.CUBIES[info.slot].pos;
    // Only the layer on this face moves.
    if (dot(pos, n) !== 1) { expected[info.index] = info.index; continue; }
    const newPos = rotate(pos, n, CLOCKWISE);
    const newFace = faceOfNormal(rotate(NORMAL[info.face], n, CLOCKWISE));
    const dest = M.FACELET_INFO.find(
      (f) => f.slot === M.SLOT_INDEX.get(newPos.join(',')) && f.face === newFace
    );
    assert.ok(dest, `no destination for ${name(info.index)} under ${face}`);
    expected[dest.index] = info.index;      // perm[destination] = source
  }

  const perm = M.FACELET_PERM[face];
  const diffs = [];
  for (let i = 0; i < 54; i++) {
    if (expected[i] !== perm[i]) {
      diffs.push(`facelet ${i} (${name(i)}): reference <- ${expected[i]} (${name(expected[i])}), model <- ${perm[i]}`);
    }
  }
  if (diffs.length) {
    failures++;
    console.log(`${face}: MISMATCH\n    ` + diffs.join('\n    '));
  } else {
    console.log(`${face}: OK — all 54 stickers land where an independent rotation says they must`);
  }

  travel[face] = [];
  for (let dest = 0; dest < 54; dest++) {
    if (perm[dest] !== dest) travel[face].push(`${name(perm[dest])}>${name(dest)}`);
  }
}

console.log('\nSticker travel (source > destination):');
for (const face of M.MOVE_NAMES) console.log('  ' + face + ': ' + travel[face].join(' '));

if (failures) {
  console.error(`\n${failures} face(s) disagreed with the reference rotation`);
  process.exit(1);
}
console.log('\nAll 6 face turns agree with an independently written rotation model.');
