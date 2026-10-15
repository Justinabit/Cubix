/**
 * scan-classify.test.mjs — can six camera captures be turned back into the
 * exact cube?
 *
 * Builds random legal cubes, "photographs" each face the way a phone camera
 * would see it (realistic sticker colours, a tinted light source, a different
 * brightness for every face because each is held up separately, and pixel
 * noise), then runs the same centre-based classification the app uses and
 * requires the result to match sticker for sticker.
 *
 * Run: node tests/scan-classify.test.mjs
 */
import assert from 'node:assert/strict';
import { classifyCube, assignMinCost, previewFace } from '../js/scan/classifier.js';
import { SOLVED_FACELETS, applyMoveSequence, randomScramble } from '../js/core/cube-model.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('  ok  ' + name); };

// Roughly what a phone camera records for a typical stickered cube.
const CAMERA = {
  U: [205, 206, 200], R: [178, 28, 38], F: [24, 150, 72],
  D: [215, 195, 35], L: [236, 104, 28], B: [22, 72, 175],
};
const LIGHTS = {
  daylight: [1, 1, 1],
  warm: [1.12, 0.98, 0.72],
  cool: [0.9, 0.98, 1.15],
  dim: [0.55, 0.55, 0.55],
};

// Small deterministic PRNG so failures are reproducible.
let seed = 12345;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

function photograph(facelets, light, { faceSpread = 0.3, noise = 14 } = {}) {
  const faces = {};
  ['U', 'R', 'F', 'D', 'L', 'B'].forEach((face, fi) => {
    const exposure = 1 - faceSpread / 2 + rand() * faceSpread;
    faces[face] = [];
    for (let i = 0; i < 9; i++) {
      const base = CAMERA[facelets[fi * 9 + i]];
      const px = base.map((c, k) => {
        const v = c * light[k] * exposure + (rand() - 0.5) * noise;
        return Math.max(0, Math.min(255, Math.round(v)));
      });
      faces[face].push({ r: px[0], g: px[1], b: px[2] });
    }
  });
  return faces;
}

console.log('scan classification (centre-based)');

test('the assignment solver finds the true minimum on a small case', () => {
  const cost = [[4, 1, 3], [2, 0, 5], [3, 2, 2]];
  const a = assignMinCost(cost);
  const total = a.reduce((s, c, r) => s + cost[r][c], 0);
  assert.equal(total, 5);
  assert.deepEqual([...a].sort(), [0, 1, 2]);
});

for (const [name, light] of Object.entries(LIGHTS)) {
  test(`reads 150 random cubes exactly under ${name} light`, () => {
    let wrong = 0;
    for (let t = 0; t < 150; t++) {
      const cube = applyMoveSequence(SOLVED_FACELETS, randomScramble(25));
      const { facelets } = classifyCube(photograph(cube, light));
      if (facelets !== cube) wrong++;
    }
    assert.equal(wrong, 0, `${wrong} of 150 cubes misread`);
  });
}

test('every colour always comes out exactly nine times', () => {
  for (let t = 0; t < 50; t++) {
    const cube = applyMoveSequence(SOLVED_FACELETS, randomScramble(25));
    const { facelets } = classifyCube(photograph(cube, LIGHTS.warm, { noise: 60, faceSpread: 0.6 }));
    for (const l of 'URFDLB') assert.equal(facelets.split(l).length - 1, 9);
  }
});

test('showing the same face twice is reported', () => {
  const faces = photograph(SOLVED_FACELETS, LIGHTS.daylight);
  faces.B = faces.F.map((p) => ({ ...p }));
  const { similarCentres } = classifyCube(faces);
  assert.ok(similarCentres.some(([a, b]) => (a === 'F' && b === 'B') || (a === 'B' && b === 'F')));
});

test('the live preview names stickers from the centres seen so far', () => {
  const faces = photograph(SOLVED_FACELETS, LIGHTS.warm);
  const letters = previewFace(faces.L, { L: faces.L[4], R: faces.R[4] });
  assert.deepEqual(letters, new Array(9).fill('L'));
});

console.log(`\n${passed} scan-classification checks passed`);
