/**
 * classifier.test.mjs — does the camera pipeline actually name colours right?
 *
 * Covers the two failure modes that matter in the real world:
 *   1. red vs orange, which overlap badly in hue and are the classic mistake;
 *   2. coloured lighting, where absolute thresholds fail but comparing against
 *      the user's own six centre colours still works.
 *
 * Run: node tests/classifier.test.mjs
 */
import assert from 'node:assert/strict';
import {
  rgbToHsv, rgbToLab, labDistance, classifyByHsv, createCalibratedClassifier,
  assessLighting, REFERENCE_COLORS,
} from '../js/scan/classifier.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('  ok  ' + name); };

const hexToRgb = (hex) => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16),
});

/** Scale a colour as if the lighting were dimmer or brighter. */
const shade = (rgb, factor) => ({
  r: Math.max(0, Math.min(255, Math.round(rgb.r * factor))),
  g: Math.max(0, Math.min(255, Math.round(rgb.g * factor))),
  b: Math.max(0, Math.min(255, Math.round(rgb.b * factor))),
});

/** Push a colour towards a light source tint (simulating a warm lamp). */
const tint = (rgb, [tr, tg, tb], amount = 0.25) => ({
  r: Math.max(0, Math.min(255, Math.round(rgb.r * (1 - amount) + tr * amount))),
  g: Math.max(0, Math.min(255, Math.round(rgb.g * (1 - amount) + tg * amount))),
  b: Math.max(0, Math.min(255, Math.round(rgb.b * (1 - amount) + tb * amount))),
});

console.log('classifier');

test('HSV conversion is correct for known colours', () => {
  const white = rgbToHsv({ r: 255, g: 255, b: 255 });
  assert.equal(Math.round(white.h), 0);
  assert.equal(Math.round(white.s * 100), 0);
  assert.equal(Math.round(white.v * 100), 100);

  const red = rgbToHsv({ r: 208, g: 52, b: 44 });
  assert.ok(Math.abs(red.h - 2) < 3, `red hue ${red.h}`);
  assert.ok(red.s > 0.6 && red.v > 0.7, `red s=${red.s} v=${red.v}`);

  const green = rgbToHsv({ r: 31, g: 157, b: 77 });
  assert.ok(Math.abs(green.h - 141) < 6, `green hue ${green.h}`);

  const blue = rgbToHsv({ r: 21, g: 101, b: 216 });
  assert.ok(Math.abs(blue.h - 218) < 6, `blue hue ${blue.h}`);
});

test('Lab conversion puts white at high L and near zero a/b', () => {
  const lab = rgbToLab({ r: 245, g: 245, b: 245 });
  assert.ok(lab.L > 95, `L=${lab.L}`);
  assert.ok(Math.abs(lab.a) < 3 && Math.abs(lab.b) < 3, `a=${lab.a} b=${lab.b}`);
});

test('the uncalibrated classifier names all six reference colours', () => {
  for (const ref of REFERENCE_COLORS) {
    const guess = classifyByHsv(hexToRgb(ref.hex));
    assert.ok(guess, `no guess for ${ref.name}`);
    assert.equal(guess.letter, ref.letter, `${ref.name} classified as ${guess.name}`);
  }
});

test('the uncalibrated classifier survives dim and bright lighting', () => {
  const factors = [0.62, 0.8, 1.25];
  for (const ref of REFERENCE_COLORS) {
    for (const factor of factors) {
      const guess = classifyByHsv(shade(hexToRgb(ref.hex), factor));
      assert.ok(guess, `no guess for ${ref.name} at ${factor}x`);
      assert.equal(guess.letter, ref.letter, `${ref.name} at ${factor}x -> ${guess.name}`);
    }
  }
});

test('red and orange are told apart, which is the hard case', () => {
  const reds = ['#d0342c', '#c0392b', '#b8271f', '#e0463c'];
  const oranges = ['#ef6c00', '#e67e22', '#f57c00', '#ff8c1a'];
  for (const hex of reds) {
    const guess = classifyByHsv(hexToRgb(hex));
    assert.equal(guess && guess.letter, 'R', `${hex} -> ${guess && guess.name}`);
  }
  for (const hex of oranges) {
    const guess = classifyByHsv(hexToRgb(hex));
    assert.equal(guess && guess.letter, 'L', `${hex} -> ${guess && guess.name}`);
  }
});

test('a calibrated classifier reads colours under strongly tinted lighting', () => {
  // Warm indoor bulb: everything shifts towards orange.
  const lamp = [255, 190, 130];
  const references = {};
  const samples = {};
  for (const ref of REFERENCE_COLORS) {
    references[ref.letter] = tint(hexToRgb(ref.hex), lamp, 0.32);
    samples[ref.letter] = tint(shade(hexToRgb(ref.hex), 0.85), lamp, 0.32);
  }
  const classifier = createCalibratedClassifier(references);
  let right = 0;
  for (const ref of REFERENCE_COLORS) {
    const guess = classifier.classify(samples[ref.letter]);
    if (guess && guess.letter === ref.letter) right++;
  }
  assert.equal(right, REFERENCE_COLORS.length, `${right}/${REFERENCE_COLORS.length} correct under warm light`);
});

test('a calibrated classifier beats absolute thresholds once lighting drifts', () => {
  // A cool, dim light: the uncalibrated path should struggle here.
  const cool = [140, 160, 255];
  const references = {};
  for (const ref of REFERENCE_COLORS) references[ref.letter] = tint(hexToRgb(ref.hex), cool, 0.35);
  const classifier = createCalibratedClassifier(references);
  let right = 0;
  for (const ref of REFERENCE_COLORS) {
    const guess = classifier.classify(tint(shade(hexToRgb(ref.hex), 0.9), cool, 0.35));
    if (guess && guess.letter === ref.letter) right++;
  }
  assert.ok(right >= 5, `only ${right}/6 under cool light`);
});

test('the classifier reports a runner-up and a confidence', () => {
  const classifier = createCalibratedClassifier(Object.fromEntries(
    REFERENCE_COLORS.map((r) => [r.letter, hexToRgb(r.hex)])
  ));
  const guess = classifier.classify(hexToRgb('#d0342c'));
  assert.ok(guess.confidence >= 0 && guess.confidence <= 1);
  assert.ok(guess.second, 'a runner-up should be reported');
  assert.equal(guess.letter, 'R');
});

test('near-black and grey samples are refused rather than guessed', () => {
  assert.equal(classifyByHsv({ r: 12, g: 12, b: 12 }), null);
  assert.equal(classifyByHsv({ r: 120, g: 120, b: 122 }), null);
});

test('lighting advice flags too-dark and glaring scenes', () => {
  assert.equal(assessLighting({ r: 20, g: 20, b: 20 }).ok, false);
  assert.match(assessLighting({ r: 20, g: 20, b: 20 }).advice, /dark/i);
  const glare = assessLighting({ r: 250, g: 250, b: 248 });
  assert.match(glare.advice, /glare/i);
  const good = assessLighting({ r: 160, g: 120, b: 90 });
  assert.equal(good.ok, true);
});

test('Lab distance is zero for identical colours and grows with difference', () => {
  const a = rgbToLab({ r: 200, g: 50, b: 40 });
  const b = rgbToLab({ r: 200, g: 50, b: 40 });
  const c = rgbToLab({ r: 30, g: 120, b: 200 });
  assert.ok(labDistance(a, b) < 0.001);
  assert.ok(labDistance(a, c) > 40);
});

console.log(`\n${passed} classifier checks passed`);
