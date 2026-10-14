/**
 * classifier.js — turn a patch of camera pixels into one of the six colours.
 *
 * Two stages:
 *
 *  1. A robust fallback classifier that works with no setup at all. It converts
 *     the average colour to HSV and reasons about it the way a person does:
 *     near-black is ignored, desaturated-and-bright is white, and the rest is
 *     decided by hue. Red and orange overlap the most in hue, so they are
 *     separated by hue plus saturation working together.
 *
 *  2. A calibrated classifier, used once the user has shown the six centres.
 *     Rather than trusting absolute thresholds (which fail badly under warm
 *     indoor light or a phone auto-white-balance shift), it measures the six
 *     reference colours from the user's own cube and lighting, then assigns each
 *     sample to the nearest reference in Lab space, which approximates how
 *     similar two colours look.
 *
 * Nothing here ever leaves the device: the samples are averaged in the page.
 */

/* ------------------------------------------------------------------ *
 * Colour space conversions
 * ------------------------------------------------------------------ */

/** sRGB (0..255) -> linear RGB (0..1). */
function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** Linear RGB -> CIE Lab, using a D65 white point. */
export function rgbToLab({ r, g, b }) {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
  // sRGB -> XYZ (D65)
  let X = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  let Y = (R * 0.2126729 + G * 0.7151522 + B * 0.0721750) / 1.00000;
  let Z = (R * 0.0193339 + G * 0.1191920 + B * 0.9503041) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  X = f(X); Y = f(Y); Z = f(Z);
  return { L: 116 * Y - 16, a: 500 * (X - Y), b: 200 * (Y - Z) };
}

/** sRGB -> HSV with H in degrees (0..360), S and V in 0..1. */
export function rgbToHsv({ r, g, b }) {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === R) h = 60 * (((G - B) / d) % 6);
    else if (max === G) h = 60 * ((B - R) / d + 2);
    else h = 60 * ((R - G) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/** Perceptual-ish distance in Lab (CIE76 — plenty for six well-spaced hues). */
export function labDistance(a, b) {
  return Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b);
}

/* ------------------------------------------------------------------ *
 * Reference colours
 * ------------------------------------------------------------------ */

/** The six cube colours with the hue bands used by the uncalibrated fallback. */
export const REFERENCE_COLORS = [
  { letter: 'U', name: 'White',  hex: '#f5f5f5', hue: null, minSat: 0.00, maxSat: 0.22, minVal: 0.55 },
  { letter: 'D', name: 'Yellow', hex: '#f2c200', hue: 48,  hueTol: 18, minSat: 0.45, minVal: 0.45 },
  { letter: 'R', name: 'Red',    hex: '#d0342c', hue: 4,   hueTol: 16, minSat: 0.45, minVal: 0.25 },
  { letter: 'L', name: 'Orange', hex: '#ef6c00', hue: 26,  hueTol: 12, minSat: 0.50, minVal: 0.35 },
  { letter: 'F', name: 'Green',  hex: '#1f9d4d', hue: 140, hueTol: 45, minSat: 0.30, minVal: 0.20 },
  { letter: 'B', name: 'Blue',   hex: '#1565d8', hue: 218, hueTol: 32, minSat: 0.35, minVal: 0.20 },
];

const hueDistance = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/**
 * Classify an average colour without calibration.
 * @returns {{letter:string, name:string, confidence:number}|null}
 */
export function classifyByHsv({ r, g, b }) {
  const { h, s, v } = rgbToHsv({ r, g, b });
  if (v < 0.12) return null;                    // too dark to say anything
  if (s < 0.18 && v > 0.55) return result('U'); // washed out and bright
  if (s < 0.15) return null;                    // grey: not a cube colour

  let best = null;
  let bestScore = Infinity;
  for (const ref of REFERENCE_COLORS) {
    if (ref.hue === null) continue;
    const dh = hueDistance(h, ref.hue);
    if (dh > ref.hueTol * 1.8) continue;
    if (s < ref.minSat * 0.6 || v < ref.minVal * 0.6) continue;
    // Hue mismatch dominates; saturation/value shortfalls are a milder penalty.
    const score = dh / ref.hueTol
      + Math.max(0, (ref.minSat - s)) * 1.5
      + Math.max(0, (ref.minVal - v)) * 1.2;
    if (score < bestScore) { bestScore = score; best = ref; }
  }
  if (!best) return null;

  // Red and orange are the only pair that routinely collide. Red sits at a lower
  // hue and is usually deeper; orange is brighter and warmer still.
  if (best.letter === 'R' || best.letter === 'L') {
    const isOrange = h > 18 && h < 48 && s > 0.5 && v > 0.45;
    best = REFERENCE_COLORS.find((c) => c.letter === (isOrange ? 'L' : 'R'));
  }
  return result(best.letter, bestScore);

  function result(letter, score = 0) {
    const ref = REFERENCE_COLORS.find((c) => c.letter === letter);
    return { letter, name: ref.name, hex: ref.hex, confidence: 1 / (1 + score) };
  }
}

/* ------------------------------------------------------------------ *
 * Calibrated classification
 * ------------------------------------------------------------------ */

/**
 * Build a classifier from the six centre colours the user showed the camera.
 * @param {Object<string,{r:number,g:number,b:number}>} samples keyed by letter
 */
export function createCalibratedClassifier(samples) {
  const refs = [];
  for (const letter of Object.keys(samples)) {
    const rgb = samples[letter];
    if (!rgb) continue;
    refs.push({ letter, rgb, lab: rgbToLab(rgb) });
  }
  if (refs.length < 2) return { classify: (rgb) => classifyByHsv(rgb), references: refs };

  return {
    references: refs,
    /**
     * @param {{r:number,g:number,b:number}} rgb
     * @returns {{letter:string,name:string,confidence:number,distance:number,second:string|null}}
     */
    classify(rgb) {
      const lab = rgbToLab(rgb);
      let best = null, second = null;
      for (const ref of refs) {
        const d = labDistance(lab, ref.lab);
        const entry = { ...ref, distance: d };
        if (!best || d < best.distance) { second = best; best = entry; }
        else if (!second || d < second.distance) { second = entry; }
      }
      if (!best) return null;
      // Confidence is a ratio: how much closer the winner is than the runner-up.
      const margin = second ? (second.distance - best.distance) / Math.max(second.distance, 1) : 1;
      const meta = REFERENCE_COLORS.find((c) => c.letter === best.letter);
      return {
        letter: best.letter,
        name: meta ? meta.name : best.letter,
        hex: meta ? meta.hex : '#888888',
        distance: best.distance,
        second: second ? second.letter : null,
        confidence: Math.max(0, Math.min(1, margin * 1.5)),
      };
    },
  };
}

/* ------------------------------------------------------------------ *
 * Sampling
 * ------------------------------------------------------------------ */

/**
 * Average the pixels of a small square patch, ignoring the very lightest and
 * darkest few percent so a specular highlight or a shadow line does not drag the
 * whole sample off course.
 *
 * @param {ImageData} imageData
 * @param {{x:number,y:number,size:number}} region in image pixels
 */
export function sampleRegion(imageData, { x, y, size }) {
  const { data, width, height } = imageData;
  const x0 = Math.max(0, Math.round(x - size / 2));
  const y0 = Math.max(0, Math.round(y - size / 2));
  const x1 = Math.min(width, Math.round(x + size / 2));
  const y1 = Math.min(height, Math.round(y + size / 2));

  const pixels = [];
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const i = (py * width + px) * 4;
      pixels.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
    }
  }
  if (!pixels.length) return null;

  // trim the extremes by luminance
  const lum = (p) => 0.2126 * p.r + 0.7152 * p.g + 0.0722 * p.b;
  pixels.sort((a, b) => lum(a) - lum(b));
  const trim = Math.floor(pixels.length * 0.15);
  const kept = pixels.slice(trim, pixels.length - trim || pixels.length);
  const use = kept.length ? kept : pixels;

  let r = 0, g = 0, b = 0;
  for (const p of use) { r += p.r; g += p.g; b += p.b; }
  const n = use.length;
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
}

/**
 * Rough lighting check, used to warn the user before they scan.
 * @returns {{ok:boolean, brightness:number, spread:number, advice:string}}
 */
export function assessLighting(rgb) {
  const { s, v } = rgbToHsv(rgb);
  const brightness = v;
  const spread = s;
  let advice = 'Lighting looks good.';
  if (brightness < 0.25) advice = 'It is quite dark — move somewhere brighter or turn on a light.';
  else if (brightness > 0.92 && spread < 0.12) advice = 'There is a strong glare — tilt the cube slightly away from the light.';
  else if (spread > 0.85) advice = 'The lighting looks very coloured — try daylight or a white lamp.';
  return {
    ok: brightness > 0.18 && brightness < 0.97,
    brightness,
    spread,
    advice,
  };
}
