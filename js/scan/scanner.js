/**
 * scanner.js — read a cube from the webcam, one face at a time.
 *
 * Privacy: frames are drawn into an offscreen canvas, averaged down to nine
 * colours, and then discarded. Nothing is uploaded, stored, or sent anywhere —
 * the camera stream is stopped as soon as scanning finishes.
 *
 * The flow is:
 *   1. calibrate  — the user shows each face's centre; we keep those six colours
 *                   as reference clusters for that cube in that lighting.
 *   2. scan       — for each face in turn, sample a 3x3 grid and classify.
 *   3. confirm    — the user reviews the detected 3x3 and taps any sticker to fix.
 *
 * Because the cube must be turned between faces, the app tells the user exactly
 * which face to show and how to hold it (see SCAN_ORDER below).
 */
import {
  sampleRegion, classifyByHsv, createCalibratedClassifier, assessLighting, rgbToLab,
} from './classifier.js';
import { FACE_NAMES, COLOR_OF_LETTER } from '../core/cube-model.js';

/** Faces in scanning order, with the instruction shown for each. */
export const SCAN_ORDER = ['U', 'R', 'F', 'D', 'L', 'B'];
export const SCAN_INSTRUCTIONS = {
  U: 'White face up. Hold the cube with green towards you.',
  R: 'Turn the cube so the RED face is up. Keep green on the left.',
  F: 'Turn the cube so the GREEN face is up. Keep white on the right.',
  D: 'Turn the cube so the YELLOW face is up. Keep green towards you.',
  L: 'Turn the cube so the ORANGE face is up. Keep green on the right.',
  B: 'Turn the cube so the BLUE face is up. Keep white on the left.',
};
export const CALIBRATION_INSTRUCTIONS = {
  U: 'Show the WHITE centre',
  R: 'Show the RED centre',
  F: 'Show the GREEN centre',
  D: 'Show the YELLOW centre',
  L: 'Show the ORANGE centre',
  B: 'Show the BLUE centre',
};

export class Scanner {
  constructor() {
    this.stream = null;
    this.video = null;
    this.canvas = null;
    this.ctx = null;
    this.classifier = null;
    this.calibration = {};
    this.facingMode = 'environment';
  }

  /**
   * Open the camera. Rejects with a friendly, specific error.
   * @param {'user'|'environment'} [prefer]
   */
  async start(prefer = 'environment') {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const err = new Error('This browser does not expose a camera API.');
      err.code = 'UNSUPPORTED';
      throw err;
    }
    const attempts = prefer === 'environment' ? ['environment', 'user'] : ['user', 'environment'];
    let lastError = null;
    for (const facing of attempts) {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        this.facingMode = facing;
        break;
      } catch (e) {
        lastError = e;
        this.stream = null;
      }
    }
    if (!this.stream) throw normaliseCameraError(lastError);

    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.autoplay = true;
    this.video.srcObject = this.stream;
    await new Promise((resolve, reject) => {
      this.video.onloadedmetadata = () => resolve();
      this.video.onerror = () => reject(normaliseCameraError(new Error('video failed to load')));
      setTimeout(resolve, 4000);
    });
    await this.video.play().catch(() => {});

    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    return this.video;
  }

  stop() {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.video) { this.video.srcObject = null; this.video = null; }
    this.ctx = null;
    this.canvas = null;
  }

  get ready() {
    return !!(this.video && this.video.readyState >= 2);
  }

  /** Flip to the other camera, keeping the same session state. */
  async switchCamera() {
    const prefer = this.facingMode === 'environment' ? 'user' : 'environment';
    this.stop();
    return this.start(prefer);
  }

  /**
   * Grab the current frame and return an ImageData plus the square region of
   * interest (centred, sized to the smaller video dimension).
   */
  grab() {
    if (!this.ready) return null;
    const vw = this.video.videoWidth || 640;
    const vh = this.video.videoHeight || 480;
    const size = Math.floor(Math.min(vw, vh) * 0.62);
    const x = Math.floor((vw - size) / 2);
    const y = Math.floor((vh - size) / 2);
    this.canvas.width = vw;
    this.canvas.height = vh;
    this.ctx.drawImage(this.video, 0, 0, vw, vh);
    const imageData = this.ctx.getImageData(x, y, size, size);
    return { imageData, region: { x, y, size, vw, vh } };
  }

  /**
   * Sample the 3x3 grid over the region of interest.
   * @returns {Array<{r:number,g:number,b:number}|null>} nine colours, row-major
   */
  sampleGrid() {
    const frame = this.grab();
    if (!frame) return new Array(9).fill(null);
    const { imageData, region } = frame;
    const { size } = region;
    const cell = size / 3;
    const out = [];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const cx = col * cell + cell / 2;
        const cy = row * cell + cell / 2;
        // sample the middle of the cell so small alignment errors do not matter
        out.push(sampleRegion(imageData, { x: cx, y: cy, size: cell * 0.5 }));
      }
    }
    return out;
  }

  /** Average colour of the centre cell, used for lighting advice. */
  centreSample() {
    const frame = this.grab();
    if (!frame) return null;
    const { imageData, region } = frame;
    return sampleRegion(imageData, { x: region.size / 2, y: region.size / 2, size: region.size * 0.2 });
  }

  /** Current lighting assessment for the on-screen hint. */
  lighting() {
    const rgb = this.centreSample();
    if (!rgb) return null;
    return assessLighting(rgb);
  }

  /* ---------------------------- calibration ---------------------------- */

  /**
   * Record the centre colour of `letter` from the middle of the frame.
   * @returns {{r:number,g:number,b:number}}
   */
  captureCalibration(letter) {
    const rgb = this.centreSample();
    if (!rgb) throw new Error('The camera is not ready yet.');
    this.calibration[letter] = rgb;
    this.classifier = createCalibratedClassifier(this.calibration);
    return rgb;
  }

  /**
   * Accept a batch of calibration colours captured elsewhere (used by the tests
   * and by the "skip calibration" path).
   */
  setCalibration(samples) {
    this.calibration = { ...samples };
    this.classifier = createCalibratedClassifier(this.calibration);
    return this.classifier;
  }

  get calibrated() {
    return FACE_NAMES.every((f) => this.calibration[f]);
  }

  /* ------------------------------- scanning ------------------------------- */

  /**
   * Read the nine stickers currently in view.
   * @returns {{colours: Array<{r,g,b}>, letters: Array<string|null>, results: Array}}
   */
  scanFace() {
    const colours = this.sampleGrid();
    const results = colours.map((rgb) => this._classifyOne(rgb));
    return { colours, results, letters: results.map((r) => (r ? r.letter : null)) };
  }

  _classifyOne(rgb) {
    if (!rgb) return null;
    if (this.classifier) return this.classifier.classify(rgb);
    return classifyByHsv(rgb);
  }

  /**
   * Classify nine colours that were captured earlier (used when re-processing a
   * held frame, and by the tests).
   */
  classifyGrid(colours) {
    return colours.map((rgb) => this._classifyOne(rgb));
  }
}

/**
 * After a face is scanned, check the result for obvious mistakes: the centre
 * must match the face being scanned, and no colour may appear more than nine
 * times across the whole cube.
 */
export function reviewFace(letters, expectedCentreLetter) {
  const warnings = [];
  if (!letters || letters.length !== 9) {
    return { ok: false, warnings: ['Could not read nine stickers. Try again with the cube filling the frame.'] };
  }
  const centre = letters[4];
  if (centre !== expectedCentreLetter) {
    warnings.push(`The centre should be ${COLOR_OF_LETTER[expectedCentreLetter].name} — double check you are showing the right face.`);
  }
  if (letters.some((l) => !l)) {
    warnings.push('One or more stickers could not be identified. Tap a sticker to set it by hand.');
  }
  return { ok: warnings.length === 0, warnings, centre };
}

function normaliseCameraError(error) {
  const name = (error && error.name) || '';
  const message = new Error('');
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    message.message = 'Camera access was blocked. Allow the camera in your browser settings (or the address bar) and try again.';
    message.code = 'DENIED';
  } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    message.message = 'No camera was found on this device. You can enter the colours by hand instead.';
    message.code = 'NO_CAMERA';
  } else if (name === 'NotReadableError' || name === 'TrackStartError') {
    message.message = 'The camera is already in use by another app. Close it and try again.';
    message.code = 'BUSY';
  } else if (name === 'OverconstrainedError') {
    message.message = 'No camera matches the requested settings. Try the other camera.';
    message.code = 'CONSTRAINED';
  } else {
    message.message = 'The camera could not be opened. You can enter the colours by hand instead.';
    message.code = 'UNKNOWN';
  }
  message.cause = error;
  return message;
}
