/**
 * scanner.js — read a cube from the camera, one face at a time.
 *
 * Privacy: frames are drawn into an offscreen canvas, averaged down to nine
 * colours, and then discarded. Nothing is uploaded, stored, or sent anywhere —
 * the camera stream is stopped as soon as scanning finishes.
 *
 * The flow:
 *   1. The user shows each face in turn, held a specific way (SCAN_STEPS).
 *      While the camera is pointed at the cube, the nine stickers are sampled
 *      several times a second and previewed live on the grid.
 *   2. When the cube has been held still for a moment, the face is captured
 *      automatically (the Capture button does the same thing on demand).
 *   3. After all six faces, the six CENTRE stickers become the colour
 *      references and every sticker is matched to them (classifyCube), so the
 *      colours are judged on the user's own cube, in the user's own light.
 *
 * How each face is held matters: the nine samples are read row by row as the
 * camera sees them, and that must line up with how the cube model numbers the
 * stickers of that face. The holds below are exactly that numbering:
 *   - the four side faces with WHITE on top,
 *   - the white face with BLUE on top (tip the top of the cube towards you),
 *   - the yellow face with GREEN on top (tip the bottom towards you).
 */
import { sampleRegion, assessLighting, rgbToHsv, stickerLab, stickerDistance } from './classifier.js';
import { COLOR_OF_LETTER } from '../core/cube-model.js';

/** Faces in scanning order: round the sides, then the top, then the bottom. */
export const SCAN_ORDER = ['F', 'R', 'B', 'L', 'U', 'D'];

/** Which face must be at the top of the picture for each face being scanned. */
export const SCAN_UP = { F: 'U', R: 'U', B: 'U', L: 'U', U: 'B', D: 'F' };

const name = (letter) => COLOR_OF_LETTER[letter].name.toLowerCase();

/** What to tell the user for each face. */
export const SCAN_INSTRUCTIONS = {
  F: `Hold the cube with the ${name('F')} centre facing the camera and ${name('U')} on top.`,
  R: `Turn the whole cube a quarter turn so the ${name('R')} centre faces the camera. Keep ${name('U')} on top.`,
  B: `Another quarter turn: ${name('B')} centre facing the camera, ${name('U')} still on top.`,
  L: `One more quarter turn: ${name('L')} centre facing the camera, ${name('U')} on top.`,
  U: `Now tip the cube so the ${name('U')} centre faces the camera, with ${name('B')} on top.`,
  D: `Last one: ${name('D')} centre facing the camera, with ${name('F')} on top.`,
};

export class Scanner {
  constructor() {
    this.stream = null;
    this.video = null;
    this.canvas = null;
    this.ctx = null;
    this.facingMode = 'environment';
  }

  /**
   * Open the camera. Rejects with a friendly, specific error.
   * @param {'user'|'environment'} [prefer]
   */
  async start(prefer = 'environment') {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const err = new Error(window.isSecureContext === false
        ? 'The camera only works on a secure (https://) page. You can enter the colours by hand instead.'
        : 'This browser does not expose a camera API. You can enter the colours by hand instead.');
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
        // A refusal will not change by asking for the other camera.
        if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) break;
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
    return !!(this.video && this.video.readyState >= 2 && this.video.videoWidth > 0);
  }

  /**
   * True when the picture should be shown mirrored: a camera that faces the
   * user (a selfie camera or a laptop webcam). Only the on-screen picture is
   * mirrored; the samples are always read from the real, unmirrored frame.
   */
  get mirrored() {
    const track = this.stream && this.stream.getVideoTracks()[0];
    const settings = track && track.getSettings ? track.getSettings() : {};
    if (settings.facingMode) return settings.facingMode === 'user';
    // Laptops do not report a facing mode; their only camera faces the user.
    return this.facingMode === 'user' || !/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  }

  /** Flip to the other camera. */
  async switchCamera() {
    const prefer = this.facingMode === 'environment' ? 'user' : 'environment';
    this.stop();
    return this.start(prefer);
  }

  /**
   * Grab the current frame and return the square region of interest: centred,
   * 62% of the shorter side (the overlay square on screen is drawn to match).
   */
  grab() {
    if (!this.ready || !this.ctx) return null;
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    const size = Math.floor(Math.min(vw, vh) * 0.62);
    const x = Math.floor((vw - size) / 2);
    const y = Math.floor((vh - size) / 2);
    // Only the square is needed, so only the square is drawn and read.
    this.canvas.width = size;
    this.canvas.height = size;
    this.ctx.drawImage(this.video, x, y, size, size, 0, 0, size, size);
    const imageData = this.ctx.getImageData(0, 0, size, size);
    return { imageData, region: { x, y, size, vw, vh } };
  }

  /**
   * Sample the 3x3 grid over the region of interest.
   * @returns {Array<{r:number,g:number,b:number}>|null} nine colours, row-major
   */
  sampleGrid() {
    const frame = this.grab();
    if (!frame) return null;
    const { imageData, region } = frame;
    const cell = region.size / 3;
    const out = [];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        // The middle of each cell, so small alignment errors do not matter.
        out.push(sampleRegion(imageData, { x: col * cell + cell / 2, y: row * cell + cell / 2, size: cell * 0.45 }));
      }
    }
    return out.some((c) => !c) ? null : out;
  }
}

/* ------------------------------------------------------------------ *
 * Helpers for the live capture loop
 * ------------------------------------------------------------------ */

/** Largest colour change of any of the nine stickers between two samples. */
export function gridChange(a, b) {
  if (!a || !b) return Infinity;
  let worst = 0;
  for (let i = 0; i < 9; i++) {
    const d = stickerDistance(stickerLab(a[i]), stickerLab(b[i]));
    const dv = Math.abs(rgbToHsv(a[i]).v - rgbToHsv(b[i]).v) * 100;
    worst = Math.max(worst, d, dv);
  }
  return worst;
}

/**
 * Does this look like a face of a cube (rather than the table, a hand or the
 * wall)? Cube stickers are either clearly coloured or bright white, and are
 * not dark. Eight of the nine cells must look like that.
 */
export function looksLikeCube(nine) {
  if (!nine) return false;
  let good = 0;
  for (const rgb of nine) {
    const { s, v } = rgbToHsv(rgb);
    if (v > 0.16 && (s > 0.35 || (s < 0.3 && v > 0.42))) good++;
  }
  return good >= 8;
}

/** Lighting advice for the middle of the picture. */
export function lightingAdvice(nine) {
  if (!nine) return null;
  const c = nine[4];
  return assessLighting(c);
}

function normaliseCameraError(error) {
  const errName = (error && error.name) || '';
  const message = new Error('');
  if (errName === 'NotAllowedError' || errName === 'SecurityError') {
    message.message = 'Camera access was blocked. Allow the camera in your browser settings (or the address bar) and try again — or enter the colours by hand.';
    message.code = 'DENIED';
  } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
    message.message = 'No camera was found on this device. You can enter the colours by hand instead.';
    message.code = 'NO_CAMERA';
  } else if (errName === 'NotReadableError' || errName === 'TrackStartError') {
    message.message = 'The camera is already in use by another app. Close it and try again.';
    message.code = 'BUSY';
  } else if (errName === 'OverconstrainedError') {
    message.message = 'No camera matches the requested settings. Try the other camera.';
    message.code = 'CONSTRAINED';
  } else {
    message.message = 'The camera could not be opened. You can enter the colours by hand instead.';
    message.code = 'UNKNOWN';
  }
  message.cause = error;
  return message;
}

/**
 * If the colours read do not make a possible cube (a twisted corner, a flipped
 * edge or a parity error — usually one pair of stickers read the wrong way
 * round), try swapping each pair among the least certain stickers and keep
 * the cheapest swap that gives a real cube.
 *
 * @param {string} facelets result of classifyCube
 * @param {Object<string, Array<{r,g,b}>>} faces the raw samples
 * @param {(f:string)=>{valid:boolean}} validateFn
 * @returns {{facelets:string, swapped:number[]}}
 */
export function repairToValid(facelets, faces, validateFn) {
  if (validateFn(facelets).valid) return { facelets, swapped: [] };
  const order = ['U', 'R', 'F', 'D', 'L', 'B'];
  const centre = Object.fromEntries(order.map((f) => [f, stickerLab(faces[f][4])]));
  const labOf = (i) => stickerLab(faces[order[Math.floor(i / 9)]][i % 9]);
  const cost = (i, letter) => stickerDistance(labOf(i), centre[letter]);

  // The stickers whose second-best colour is nearly as good as their own.
  const margin = [];
  for (let i = 0; i < 54; i++) {
    if (i % 9 === 4) continue;
    const own = cost(i, facelets[i]);
    const next = Math.min(...order.filter((f) => f !== facelets[i]).map((f) => cost(i, f)));
    margin.push({ i, gap: next - own });
  }
  margin.sort((a, b) => a.gap - b.gap);
  const pool = margin.slice(0, 16).map((m) => m.i);

  let best = null;
  for (let a = 0; a < pool.length; a++) {
    for (let b = a + 1; b < pool.length; b++) {
      const i = pool[a], j = pool[b];
      if (facelets[i] === facelets[j]) continue;
      const s = facelets.split('');
      [s[i], s[j]] = [s[j], s[i]];
      const next = s.join('');
      if (!validateFn(next).valid) continue;
      const extra = cost(i, next[i]) + cost(j, next[j]) - cost(i, facelets[i]) - cost(j, facelets[j]);
      if (!best || extra < best.extra) best = { facelets: next, swapped: [i, j], extra };
    }
  }
  return best ? { facelets: best.facelets, swapped: best.swapped } : { facelets, swapped: [] };
}
