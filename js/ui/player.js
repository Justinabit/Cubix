/**
 * player.js — steps through a solution, animating each move.
 *
 * The player is deliberately dumb: it owns a cursor into a flat list of moves
 * and reports "we are now at index N". The cube renderer does the animating and
 * the app decides what to show. That keeps scrubbing (jumping to an arbitrary
 * index) as simple as playing, because both are just "move the cursor".
 *
 * Practice mode only changes one thing: after advancing, playback pauses so the
 * user can do the move on their real cube and press Next themselves.
 */
import { parseMove, invertMoves, tokenizeMoves } from '../core/cube-model.js';

const DIRECTION_WORDS = {
  U: 'Turn the top layer clockwise (as seen from above).',
  "U'": 'Turn the top layer anticlockwise (as seen from above).',
  U2: 'Turn the top layer half way round.',
  D: 'Turn the bottom layer clockwise (as seen from below).',
  "D'": 'Turn the bottom layer anticlockwise (as seen from below).',
  D2: 'Turn the bottom layer half way round.',
  R: 'Turn the right layer clockwise (as seen from the right).',
  "R'": 'Turn the right layer anticlockwise (as seen from the right).',
  R2: 'Turn the right layer half way round.',
  L: 'Turn the left layer clockwise (as seen from the left).',
  "L'": 'Turn the left layer anticlockwise (as seen from the left).',
  L2: 'Turn the left layer half way round.',
  F: 'Turn the front layer clockwise (looking at the front).',
  "F'": 'Turn the front layer anticlockwise (looking at the front).',
  F2: 'Turn the front layer half way round.',
  B: 'Turn the back layer clockwise (as seen from behind).',
  "B'": 'Turn the back layer anticlockwise (as seen from behind).',
  B2: 'Turn the back layer half way round.',
};

const FACE_WORDS = { U: 'top', D: 'bottom', R: 'right', L: 'left', F: 'front', B: 'back' };

/**
 * A plain-English description of a single move, used both in the step list and
 * in the live readout under the cube.
 */
export function describeMove(move) {
  if (DIRECTION_WORDS[move]) return DIRECTION_WORDS[move];
  const parsed = parseMove(move);
  const face = FACE_WORDS[parsed.face];
  if (parsed.power === 2) return `Turn the ${face} layer half way round.`;
  return `Turn the ${face} layer ${parsed.sign > 0 ? 'clockwise' : 'anticlockwise'}.`;
}

/** Inverse of a single move, for stepping backwards. */
export function invertMove(move) {
  return invertMoves([move])[0];
}

export class Player {
  /**
   * @param {{
   *   onIndexChange: (index:number, info:object) => void,
   *   onFinish: () => void,
   *   onApplyMove: (move:string, direction:1|-1) => void,
   *   waitForCube: () => boolean,
   * }} handlers
   */
  constructor(handlers) {
    this.handlers = handlers;
    this.steps = [];
    this.index = 0;
    this.playing = false;
    this.practice = false;
    this.speed = 1;
    this._timer = null;
  }

  /**
   * Load a solution.
   * @param {string[]} moves flat list in order
   * @param {Array<{title?:string, goal?:string, moves:Array}>} [stages] optional grouping
   */
  load(moves, stages = null) {
    this.steps = moves.map((move, i) => ({
      move,
      index: i,
      description: describeMove(move),
      stage: stages ? findStage(stages, i) : null,
    }));
    this.index = 0;
    this.stop();
    this._emit();
  }

  get length() { return this.steps.length; }
  get atEnd() { return this.index >= this.steps.length; }
  get current() { return this.steps[this.index] || null; }

  /** Move count completed so far. */
  get position() { return this.index; }

  /* ------------------------------- transport ------------------------------- */

  play() {
    if (this.atEnd || this.steps.length === 0) return;
    this.playing = true;
    this._tick();
    this._emit();
  }

  pause() {
    this.playing = false;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    this._emit();
  }

  stop() {
    this.playing = false;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
  }

  toggle() {
    if (this.playing) this.pause(); else this.play();
  }

  next({ animate = true } = {}) {
    if (this.atEnd) return false;
    const move = this.steps[this.index].move;
    this.index += 1;
    if (this.handlers.onApplyMove) this.handlers.onApplyMove(move, animate ? 1 : 0);
    if (this.practice) this.pause();
    this._emit();
    return true;
  }

  previous() {
    if (this.index === 0) return false;
    const move = this.steps[this.index - 1].move;
    this.index -= 1;
    if (this.handlers.onApplyMove) this.handlers.onApplyMove(invertMove(move), 1);
    if (this.practice) this.pause();
    this._emit();
    return true;
  }

  /** Jump to an absolute move count, animating as little as possible. */
  seek(target) {
    target = Math.max(0, Math.min(this.steps.length, target));
    if (target === this.index) return;
    const forward = target > this.index;
    const count = Math.abs(target - this.index);
    for (let i = 0; i < count; i++) {
      if (forward) {
        const move = this.steps[this.index].move;
        this.index += 1;
        if (this.handlers.onApplyMove) this.handlers.onApplyMove(move, 0);
      } else {
        const move = invertMove(this.steps[this.index - 1].move);
        this.index -= 1;
        if (this.handlers.onApplyMove) this.handlers.onApplyMove(move, 0);
      }
    }
    this._emit();
  }

  restart() {
    this.seek(0);
    this.playing = false;
  }

  setSpeed(multiplier) {
    this.speed = multiplier;
  }

  setPractice(on) {
    this.practice = !!on;
    if (this.practice) this.pause();
  }

  /* --------------------------------- loop --------------------------------- */

  _tick() {
    if (!this.playing) return;
    if (this.handlers.waitForCube && this.handlers.waitForCube()) {
      // the 3D view is still animating the previous turn
      this._timer = setTimeout(() => this._tick(), 40);
      return;
    }
    if (this.atEnd) {
      this.playing = false;
      this._emit();
      if (this.handlers.onFinish) this.handlers.onFinish();
      return;
    }
    this.next();
    if (this.practice) { this.playing = false; this._emit(); return; }
    const delay = Math.max(90, 620 / this.speed);
    this._timer = setTimeout(() => this._tick(), delay);
  }

  _emit() {
    if (!this.handlers.onIndexChange) return;
    this.handlers.onIndexChange(this.index, {
      current: this.current,
      playing: this.playing,
      atEnd: this.atEnd,
      total: this.steps.length,
      stage: this.current ? this.current.stage : null,
    });
  }
}

function findStage(stages, moveIndex) {
  let seen = 0;
  for (const stage of stages) {
    const size = stage.moves ? countMoves(stage.moves) : 0;
    if (moveIndex < seen + size) return stage;
    seen += size;
  }
  return stages[stages.length - 1] || null;
}

function countMoves(stageMoves) {
  return stageMoves.reduce((n, entry) => n + entry.moves.length, 0);
}

export { tokenizeMoves };
