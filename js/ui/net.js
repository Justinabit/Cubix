/**
 * net.js — the unfolded-net colour editor used for manual entry.
 *
 * Owns an undo/redo history of 54-character states so every edit is reversible,
 * and reports every change through a single callback so the 3D view, the counts
 * and the validator all stay in step with one source of truth.
 */
import {
  SOLVED_FACELETS, FACE_NAMES, COLOR_OF_LETTER, LETTERS, countColors, centerLetter,
  randomScramble, applyMoveSequence,
} from '../core/cube-model.js';

const NET_LAYOUT = ['U', 'L', 'F', 'R', 'B', 'D'];   // CSS grid placement order
const FACE_LABELS = { U: 'Up', L: 'Left', F: 'Front', R: 'Right', B: 'Back', D: 'Down' };

export class NetEditor {
  /**
   * @param {HTMLElement} container
   * @param {{onChange: (state:string, cause:string) => void}} options
   */
  constructor(container, paletteContainer, countsContainer, options = {}) {
    this.container = container;
    this.paletteContainer = paletteContainer;
    this.countsContainer = countsContainer;
    this.options = options;
    this.state = SOLVED_FACELETS;
    this.selected = 'R';
    this.history = [SOLVED_FACELETS];
    this.future = [];
    this.suspect = new Set();
    this.showLetters = false;

    this._buildPalette();
    this._buildNet();
    this._buildCounts();
    this.render();
  }

  /* ------------------------------- building ------------------------------- */

  _buildPalette() {
    this.paletteContainer.innerHTML = '';
    this.paletteButtons = {};
    for (const letter of LETTERS) {
      const colour = COLOR_OF_LETTER[letter];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'swatch';
      button.dataset.letter = letter;
      button.style.background = colour.hex;
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', String(letter === this.selected));
      button.setAttribute('aria-label', `${colour.name} (${letter})`);
      button.innerHTML = `<span class="swatch-letter" aria-hidden="true">${colour.swatchLetter}</span>`;
      button.addEventListener('click', () => this.select(letter));
      this.paletteContainer.appendChild(button);
      this.paletteButtons[letter] = button;
    }
  }

  _buildNet() {
    this.container.innerHTML = '';
    this.stickerButtons = [];
    for (const face of FACE_NAMES) {
      const faceEl = document.createElement('div');
      faceEl.className = 'net-face';
      faceEl.dataset.face = face;
      faceEl.setAttribute('role', 'group');
      faceEl.setAttribute('aria-label', `${FACE_LABELS[face]} face`);
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
          const index = this._index(face, row, col);
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'sticker' + (row === 1 && col === 1 ? ' is-center' : '');
          button.dataset.index = String(index);
          button.dataset.face = face;
          button.dataset.row = String(row);
          button.dataset.col = String(col);
          if (row === 1 && col === 1) {
            button.disabled = true;
            button.title = 'Centre stickers are fixed — they define the colour of the face';
          } else {
            button.addEventListener('click', () => this.paint(index));
          }
          faceEl.appendChild(button);
          this.stickerButtons[index] = button;
        }
      }
      this.container.appendChild(faceEl);
    }
    void NET_LAYOUT;
  }

  _buildCounts() {
    this.countsContainer.innerHTML = '';
    this.countElements = {};
    for (const letter of LETTERS) {
      const el = document.createElement('div');
      el.className = 'count';
      el.dataset.letter = letter;
      el.innerHTML = `<span class="count-swatch" style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${COLOR_OF_LETTER[letter].hex};border:1px solid rgba(0,0,0,.35)"></span>`
        + `<span class="count-value" data-count-value>0</span>`
        + `<span>${COLOR_OF_LETTER[letter].name}</span>`;
      this.countsContainer.appendChild(el);
      this.countElements[letter] = el;
    }
  }

  _index(face, row, col) {
    return FACE_NAMES.indexOf(face) * 9 + row * 3 + col;
  }

  /* -------------------------------- editing -------------------------------- */

  select(letter) {
    this.selected = letter;
    for (const [key, button] of Object.entries(this.paletteButtons)) {
      const active = key === letter;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-checked', String(active));
    }
  }

  /** Paint one sticker with the selected colour. */
  paint(index) {
    if (this.state[index] === this.selected) return;
    const next = this.state.split('');
    next[index] = this.selected;
    this.set(next.join(''), { record: true });
  }

  /** Paint every non-centre sticker of a face with the selected colour. */
  fillFace(face) {
    const next = this.state.split('');
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        if (row === 1 && col === 1) continue;
        next[this._index(face, row, col)] = this.selected;
      }
    }
    this.set(next.join(''), { record: true });
  }

  /** Replace the whole state (used by the scanner and by undo/redo). */
  set(state, { record = false, cause = 'edit' } = {}) {
    if (state === this.state && record) return;
    if (record) {
      this.history.push(this.state);
      if (this.history.length > 200) this.history.shift();
      this.future.length = 0;
    }
    this.state = state;
    this.render();
    if (this.options.onChange) this.options.onChange(this.state, cause);
  }

  undo() {
    if (this.history.length < 2) return false;
    this.future.push(this.state);
    this.state = this.history.pop();
    this.render();
    if (this.options.onChange) this.options.onChange(this.state, 'undo');
    return true;
  }

  redo() {
    if (!this.future.length) return false;
    this.history.push(this.state);
    this.state = this.future.pop();
    this.render();
    if (this.options.onChange) this.options.onChange(this.state, 'redo');
    return true;
  }

  reset() {
    this.set(SOLVED_FACELETS, { record: true, cause: 'reset' });
  }

  /** Fill the cube with a random, definitely solvable scramble. */
  scramble(length = 24) {
    const moves = randomScramble(length);
    this.set(applyMoveSequence(SOLVED_FACELETS, moves), { record: true, cause: 'scramble' });
  }

  /** Outline the stickers the validator is unhappy about. */
  setSuspect(indices) {
    this.suspect = new Set(indices || []);
    this.stickerButtons.forEach((button, index) => {
      button.classList.toggle('is-suspect', this.suspect.has(index));
    });
  }

  setShowLetters(on) {
    this.showLetters = !!on;
    this.render();
  }

  /* -------------------------------- drawing -------------------------------- */

  render() {
    for (let index = 0; index < 54; index++) {
      const button = this.stickerButtons[index];
      if (!button) continue;
      const letter = this.state[index];
      const colour = COLOR_OF_LETTER[letter];
      button.style.background = colour ? colour.hex : '#3a3a3a';
      button.dataset.letter = letter || '';
      button.textContent = this.showLetters && colour ? colour.swatchLetter : '';
      const face = button.dataset.face;
      const row = Number(button.dataset.row), col = Number(button.dataset.col);
      const isCentre = row === 1 && col === 1;
      button.setAttribute('aria-label',
        `${FACE_LABELS[face]} face, row ${row + 1}, column ${col + 1}: ${colour ? colour.name : 'empty'}`);
      button.classList.toggle('is-suspect', !isCentre && this.suspect.has(index));
    }

    const counts = countColors(this.state);
    for (const letter of LETTERS) {
      const el = this.countElements[letter];
      const value = el.querySelector('[data-count-value]');
      value.textContent = String(counts[letter]);
      el.classList.toggle('is-complete', counts[letter] === 9);
      el.classList.toggle('is-over', counts[letter] > 9);
    }
  }

  /** The colour letter currently at the centre of each face. */
  centerLetters() {
    return FACE_NAMES.map((f, i) => centerLetter(this.state, i));
  }
}

export { FACE_LABELS };
