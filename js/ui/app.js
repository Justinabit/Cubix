/**
 * app.js — screen routing and wiring.
 *
 * Screens are just <section> elements; exactly one has the `is-active` class.
 * Every screen shares one 54-character state (this.facelets) and one validator
 * result, so there is no way for the 3D view, the net editor and the solver to
 * disagree about what the cube looks like.
 */
import {
  SOLVED_FACELETS, FACE_NAMES, COLOR_OF_LETTER, tokenizeMoves,
  applyMove, applyMoveSequence, isSolved, randomScramble,
} from '../core/cube-model.js';
import { validate, summary } from '../core/validator.js';
import { Cube3D } from '../three/cube3d.js';
import { NetEditor, FACE_LABELS } from './net.js';
import { Player, describeMove } from './player.js';
import { Scanner, SCAN_ORDER, SCAN_INSTRUCTIONS, CALIBRATION_INSTRUCTIONS } from '../scan/scanner.js';
import { getSolver, simplify as simplifyKociemba } from '../solver/kociemba.js';
import { solveBeginner, STAGES as BEGINNER_STAGES } from '../solver/beginner.js';

const SCREENS = ['landing', 'scan', 'manual', 'review', 'solve', 'done'];
const CHEAT_SHEET = [
  { move: 'R', text: 'Turn the RIGHT face clockwise, as you look at it.' },
  { move: 'L', text: 'Turn the LEFT face clockwise, as you look at it.' },
  { move: 'U', text: 'Turn the UP (top) face clockwise, looking down.' },
  { move: 'D', text: 'Turn the DOWN (bottom) face clockwise, looking up.' },
  { move: 'F', text: 'Turn the FRONT face clockwise, looking at it.' },
  { move: 'B', text: 'Turn the BACK face clockwise, looking at it.' },
  { move: "R'", text: "The apostrophe means anticlockwise: R' is R backwards." },
  { move: 'R2', text: 'The 2 means twice: a half turn. R2 twice is back to the start.' },
];

export class App {
  constructor() {
    this.facelets = SOLVED_FACELETS;
    this.method = 'kociemba';
    this.solution = null;
    this.validation = validate(SOLVED_FACELETS);
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.views = {};            // name -> Cube3D
    this.scanner = new Scanner();
    this.solverReady = false;
    this._cameraToken = 0;      // bumped on every camera start, to drop stale ones

    this._cacheDom();
    this._buildScreens();
    this._buildNet();
    this._buildPlayer();
    this._buildHelp();
    this._bindGlobal();
    this._syncThemeButton();

    this.go('landing');
    this._loop();
  }

  /* ---------------------------------- setup ---------------------------------- */

  _cacheDom() {
    this.el = {
      screens: Object.fromEntries(SCREENS.map((name) => [name, document.getElementById(`screen-${name}`)])),
      theme: document.getElementById('btn-theme'),
      themeGlyph: document.getElementById('theme-glyph'),
      help: document.getElementById('btn-help'),
      helpSheet: document.getElementById('sheet-help'),
      helpBody: document.getElementById('help-body'),
      toast: document.getElementById('toast'),

      palette: document.getElementById('palette'),
      net: document.getElementById('net'),
      faceTabs: document.getElementById('face-tabs'),
      counts: document.getElementById('counts'),
      letters: document.getElementById('chk-letters'),

      validateStatus: document.getElementById('validate-status'),
      validateIssues: document.getElementById('validate-issues'),
      solveHint: document.getElementById('solve-hint'),

      steps: document.getElementById('steps'),
      moveGlyph: document.getElementById('move-glyph'),
      moveText: document.getElementById('move-text'),
      scrub: document.getElementById('scrub'),
      progressLabel: document.getElementById('progress-label'),
      stageLabel: document.getElementById('stage-label'),
      speed: document.getElementById('speed'),
      speedLabel: document.getElementById('speed-label'),
      practice: document.getElementById('chk-practice'),
      practiceHint: document.getElementById('practice-hint'),
      solveSubtitle: document.getElementById('solve-subtitle'),

      video: document.getElementById('camera'),
      videoWrap: document.getElementById('video-wrap'),
      grid: document.getElementById('grid-overlay'),
      scanBadge: document.getElementById('scan-badge'),
      scanHint: document.getElementById('scan-hint'),
      scanStep: document.getElementById('scan-step-title'),
      scanInstruction: document.getElementById('scan-instruction'),
      miniCaption: document.getElementById('mini-caption'),
      faceProgress: document.getElementById('face-progress'),
      capture: document.getElementById('btn-capture'),
      switchCamera: document.getElementById('btn-switch-camera'),
      solvedCount: document.getElementById('done-moves'),
      doneNote: document.getElementById('done-note'),
    };
  }

  _buildScreens() {
    // Create the renderer for each canvas lazily, the first time its screen shows.
    this.stageConfig = {
      landing: { canvas: 'landing-canvas', stage: 'landing-stage' },
      scan: { canvas: 'scan-canvas', stage: 'scan-stage' },
      manual: { canvas: 'manual-canvas', stage: 'manual-stage' },
      review: { canvas: 'review-canvas', stage: 'review-stage' },
      solve: { canvas: 'solve-canvas', stage: 'solve-stage' },
      done: { canvas: 'done-canvas', stage: 'done-stage' },
    };
  }

  /** Get (creating on first use) the 3D view for a screen. */
  view(name) {
    if (this.views[name]) return this.views[name];
    const config = this.stageConfig[name];
    if (!config) return null;
    const canvas = document.getElementById(config.canvas);
    if (!canvas) return null;
    const view = new Cube3D(canvas, { prefersReducedMotion: () => this.reducedMotion });
    view.setState(this.facelets);
    view.setShowLetters(this.el.letters.checked);
    if (name === 'landing') {
      // A gentle demo scramble on the hero cube, re-solved on a slow loop.
      this._animateHero(view);
    }
    if (name === 'manual') {
      view.onFaceClick = (hit) => this._paintFromCube(hit);
    }
    this.views[name] = view;
    return view;
  }

  _animateHero(view) {
    const run = () => {
      if (this.current !== 'landing') { setTimeout(run, 1500); return; }
      const scramble = randomScramble(9);
      view.applyMoves(scramble);
      const wait = scramble.length * 300 + 1600;
      setTimeout(() => {
        // Always undo the scramble, even if the user has moved on, so the hero
        // cube is solved again whenever they come back to it.
        view.applyMoves(scramble.slice().reverse().map(invertOne));
        setTimeout(run, 1400);
      }, wait);
    };
    setTimeout(run, 900);
    view.setAutoRotate(true);
  }

  _buildNet() {
    this.net = new NetEditor(this.el.net, this.el.palette, this.el.counts, {
      tabsContainer: this.el.faceTabs,
      onChange: (state) => {
        this.facelets = state;
        this.solution = null;          // any edit makes an old solution stale
        for (const name of ['manual', 'review', 'scan']) {
          if (this.views[name]) this.views[name].setState(state);
        }
      },
    });
  }

  _buildPlayer() {
    this.player = new Player({
      onApplyMove: (move, direction) => {
        // The app's facelet string stays the single source of truth; the 3D view
        // mirrors it and animates. Both apply the same verified move, so they
        // cannot drift apart.
        this.facelets = applyMove(this.facelets, move);
        const view = this.views.solve;
        if (!view) return;
        // Tapping Next faster than the cube can turn should not build up a
        // backlog of animations: finish the pending turns at once, then animate
        // only the newest one.
        if (view.busy && this.animatePlayback && direction) view.setState(view.facelets);
        view.applyMove(move, { animate: this.animatePlayback && !!direction });
      },
      waitForCube: () => !!(this.views.solve && this.views.solve.busy),
      onIndexChange: (index, info) => this._renderPlayback(index, info),
      // Reaching the end is handled in _renderPlayback, whichever way it happens.
      onFinish: () => {},
    });
  }

  _buildHelp() {
    const grid = document.createElement('div');
    grid.className = 'cheat-grid';
    for (const item of CHEAT_SHEET) {
      const cell = document.createElement('div');
      cell.className = 'cheat-item';
      cell.innerHTML = `<div class="cheat-move">${item.move}</div><div class="cheat-text">${item.text}</div>`;
      grid.appendChild(cell);
    }
    const note = document.createElement('p');
    note.className = 'cheat-note';
    note.textContent = 'Every instruction in Cubix is written out in words underneath the cube as well, '
      + 'so you never need to memorise the letters.';
    this.el.helpBody.append(grid, note);
  }

  _bindGlobal() {
    document.addEventListener('click', (event) => {
      const goto = event.target.closest('[data-goto]');
      if (goto) { this.go(goto.dataset.goto); return; }
      const close = event.target.closest('[data-close-sheet]');
      if (close) { this._closeHelp(); return; }
      if (event.target === this.el.helpSheet) this._closeHelp();
    });

    this.el.help.addEventListener('click', () => this._openHelp());
    this.el.theme.addEventListener('click', () => this._toggleTheme());
    document.addEventListener('keydown', (event) => this._onKey(event));

    // ---- manual screen ----
    this.el.letters.addEventListener('change', () => {
      const on = this.el.letters.checked;
      this.net.setShowLetters(on);
      for (const view of Object.values(this.views)) view.setShowLetters(on);
    });
    document.getElementById('btn-undo').addEventListener('click', () => this.net.undo());
    document.getElementById('btn-redo').addEventListener('click', () => this.net.redo());
    document.getElementById('btn-fill-face').addEventListener('click', () => {
      // Fill the face being edited: the last one touched, or the selected tab.
      const face = this.net.activeFace;
      this.net.fillFace(face);
      this._toast(`Filled the ${FACE_LABELS[face].toLowerCase()} face with ${COLOR_OF_LETTER[this.net.selected].name.toLowerCase()}.`);
    });
    document.getElementById('btn-random').addEventListener('click', () => {
      this.net.scramble(24);
      this._toast('Filled with a random scramble you can practise on.');
    });
    document.getElementById('btn-clear').addEventListener('click', () => {
      this.net.reset();
      this._toast('Reset to a solved cube.');
    });
    document.getElementById('btn-reset-view').addEventListener('click', () => {
      if (this.views.manual) this.views.manual.resetView();
    });
    document.getElementById('btn-review').addEventListener('click', () => this.go('review'));
    document.getElementById('btn-review-back').addEventListener('click', () => this.go('manual'));
    document.getElementById('btn-edit-colours').addEventListener('click', () => this.go('manual'));
    document.getElementById('btn-solve').addEventListener('click', () => this._solve());
    document.getElementById('btn-solve-back').addEventListener('click', () => this.go('review'));
    document.getElementById('btn-done-replay').addEventListener('click', () => {
      this.go('solve');
      this.player.restart();
    });
    document.getElementById('btn-done-another').addEventListener('click', () => {
      // Leave the solve flow first (which restores the entered cube), then
      // start the new cube from solved; Undo still brings the old one back.
      this.go('manual');
      this.net.reset();
    });

    // ---- method switch ----
    for (const chip of document.querySelectorAll('[data-method]')) {
      chip.addEventListener('click', () => {
        // Ignore a switch while a solve is still being computed, so the chip
        // shown as selected always matches the solution on screen.
        if (this._solving || chip.dataset.method === this.method) return;
        this.method = chip.dataset.method;
        for (const other of document.querySelectorAll('[data-method]')) {
          const active = other === chip;
          other.classList.toggle('is-active', active);
          other.setAttribute('aria-checked', String(active));
        }
        this._solve();
      });
    }

    // ---- playback ----
    document.getElementById('btn-play').addEventListener('click', () => {
      this.player.toggle();
      this._renderPlayback(this.player.index, { current: this.player.current, playing: this.player.playing, atEnd: this.player.atEnd, total: this.player.length });
    });
    document.getElementById('btn-next').addEventListener('click', () => this.player.next());
    document.getElementById('btn-prev').addEventListener('click', () => this.player.previous());
    document.getElementById('btn-restart').addEventListener('click', () => this.player.restart());
    this.el.scrub.addEventListener('input', () => {
      this.player.pause();
      this.player.seek(Number(this.el.scrub.value));
    });
    this.el.speed.addEventListener('input', () => {
      const value = Number(this.el.speed.value);
      this.player.setSpeed(value);
      if (this.views.solve) this.views.solve.setSpeed(value);
      this.el.speedLabel.textContent = `${value}×`;
    });
    this.el.practice.addEventListener('change', () => {
      const on = this.el.practice.checked;
      this.player.setPractice(on);
      this.el.practiceHint.hidden = !on;
    });

    // ---- scan screen ----
    this.el.capture.addEventListener('click', () => this._capture());
    this.el.switchCamera.addEventListener('click', async () => {
      const token = ++this._cameraToken;
      this.el.capture.disabled = true;
      this.el.switchCamera.disabled = true;
      this.el.scanBadge.textContent = 'Switching camera…';
      try {
        const video = await this.scanner.switchCamera();
        if (token !== this._cameraToken || this.current !== 'scan') { this._stopCamera(); return; }
        this._attachVideo(video);
        this._updateScanStep();
      } catch (err) {
        this.el.scanBadge.textContent = 'Camera unavailable';
        this._toast(err.message);
      } finally {
        this.el.switchCamera.disabled = false;
      }
    });
    document.getElementById('btn-restart-calibration').addEventListener('click', () => {
      this.scanner.calibration = {};
      this.scanner.classifier = null;
      this.scanned = {};
      this._beginCalibration();
    });
    document.getElementById('btn-to-manual').addEventListener('click', () => {
      this._stopCamera();
      this.go('manual');
    });
  }

  /* ------------------------------- navigation ------------------------------- */

  go(name) {
    if (!SCREENS.includes(name)) return;
    const previous = this.current;
    if ((previous === 'solve' || previous === 'done') && name !== 'solve' && name !== 'done') {
      // Playing the solution changes the cube shown on the solve screen, but
      // the cube the user entered must not change: going back should show it
      // exactly as they left it.
      this._cancelFinish();
      this.player.pause();
      if (this.solveStart) this.facelets = this.solveStart;
      this.solution = null;
      this.player.load([], null);
    }
    this.current = name;
    for (const [key, section] of Object.entries(this.el.screens)) {
      const active = key === name;
      section.hidden = !active;
      section.classList.toggle('is-active', active);
    }
    if (name !== 'scan') this._stopCamera();
    if (name === 'scan') this._enterScan();
    if (name === 'manual') this.view('manual').setState(this.facelets);
    if (name === 'review') this._renderReview();
    if (name === 'solve') {
      this.view('solve').setState(this.facelets);
      // Arriving here without a solution (a back button, or a resumed session)
      // should still produce one rather than showing an empty move list. The
      // guard matters: _solve() itself routes through here.
      if (!this.solution && !this._solving && this.validation.valid) { this._solve(); return; }
    }
    if (name === 'done') this.view('done').setState(SOLVED_FACELETS);
    this.view(name);
    window.scrollTo({ top: 0, behavior: 'auto' });
    // Move keyboard / screen-reader focus to the new screen's heading.
    const heading = this.el.screens[name].querySelector('h1, h2');
    if (heading && previous && previous !== name) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
  }

  /* --------------------------------- manual --------------------------------- */

  _paintFromCube(hit) {
    if (!hit) return;
    this.net.paint(hit.facelet);
  }

  /* --------------------------------- review --------------------------------- */

  /** Show the review screen (validating on the way in). */
  _review() {
    this.go('review');
  }

  _renderReview() {
    this.validation = validate(this.facelets);
    const view = this.view('review');
    view.setState(this.facelets);
    view.setHighlight(this.validation.suspectFacelets);
    this.net.setSuspect(this.validation.suspectFacelets);

    const status = this.el.validateStatus;
    status.classList.toggle('is-ok', this.validation.valid);
    status.classList.toggle('is-bad', !this.validation.valid);
    status.textContent = summary(this.validation);

    this.el.validateIssues.innerHTML = '';
    for (const issue of this.validation.issues) {
      const li = document.createElement('li');
      li.textContent = issue.message;
      this.el.validateIssues.appendChild(li);
    }

    const complete = this.validation.complete;
    const solved = isSolved(this.facelets);
    document.getElementById('btn-solve').disabled = !this.validation.valid || solved;
    this.el.solveHint.textContent = !complete
      ? `Fill in the remaining ${this.validation.missing} sticker${this.validation.missing === 1 ? '' : 's'} on the previous screen.`
      : !this.validation.valid ? 'Fix the highlighted stickers to continue.'
        : solved ? 'Nothing to solve yet. Edit the colours to match your cube, or try a random scramble.'
          : '';
  }

  /* ---------------------------------- solve ---------------------------------- */

  async _solve() {
    if (this._solving) return;
    if ((this.current === 'solve' || this.current === 'done') && this.solveStart) {
      // Re-solving (e.g. after switching method) always starts from the cube
      // the user entered, not from wherever playback had got to.
      this._cancelFinish();
      this.player.stop();
      this.facelets = this.solveStart;
    }
    this.validation = validate(this.facelets);
    if (!this.validation.valid || isSolved(this.facelets)) return;
    this.solveStart = this.facelets;
    this.solution = null;
    this._solving = true;
    try {
      await this._doSolve();
    } finally {
      this._solving = false;
    }
  }

  async _doSolve() {
    if (!this.validation.valid) return;
    if (this.current !== 'solve') this.go('solve');
    this.animatePlayback = true;
    const view = this.view('solve');
    view.setState(this.facelets);
    this.player.load([], null);
    this.el.steps.innerHTML = '';
    this.el.solveSubtitle.textContent = 'Working out a solution…';
    // Let the browser paint the screen before the (synchronous) solver runs.
    await new Promise((resolve) => setTimeout(resolve, 30));

    const method = this.method;
    let solution = null;
    if (method === 'beginner') {
      const result = solveBeginner(this.facelets);
      if (result && result.failedAt === -1) {
        solution = { stages: result.stages, moves: result.moves };
      } else {
        // Never leave the user stranded: fall back to the fast method and say so.
        this._toast('The beginner method hit an unusual case — using the short solution instead.');
      }
    }
    if (!solution) {
      solution = await this._solveWithKociemba();
      if (!solution) return;
    }
    // The user may have left the solve screen while the tables were building.
    if (this.current !== 'solve' || this.facelets !== this.solveStart) return;

    this.solution = solution;
    this._loadSolution(solution);
  }

  async _solveWithKociemba() {
    // Shared singleton: building the pruning tables costs about a second and a
    // half, so it is done at most once per page load.
    const solver = getSolver();
    if (!solver.ready) {
      this.el.solveSubtitle.textContent = 'Preparing the solver (first run only)…';
      await solver.build();
    }
    this.el.solveSubtitle.textContent = '';
    const moves = solver.solve(this._cubieState());
    if (!moves) {
      this._toast('Could not find a solution for this cube. Check the colours on the previous screen.');
      return null;
    }
    return { moves, stages: null };
  }

  _cubieState() {
    // Imported lazily to keep the initial bundle small.
    return cubieStateOf(this.facelets);
  }

  _loadSolution(solution) {
    this.finished = false;
    // Only the short solution is simplified: merging moves in the beginner
    // method would shift the move indices out of line with its stages.
    const moves = solution.stages ? solution.moves : simplifyKociemba(solution.moves);
    this.player.load(moves, solution.stages);
    this._renderSteps(solution, moves);

    this.el.scrub.max = String(moves.length);
    this.el.scrub.value = '0';
    this.el.solveSubtitle.textContent = solution.stages
      ? `${moves.length} moves in ${solution.stages.length} stages — slow, easy to follow, and each stage has a goal.`
      : `${moves.length} moves — short, but the moves will not mean much until you know some theory.`;
    this.el.moveGlyph.textContent = '—';
    this.el.moveText.textContent = `Press play, or step through one move at a time.`;
    this.el.stageLabel.textContent = '';
  }

  _renderSteps(solution, moves) {
    this.el.steps.innerHTML = '';
    if (!solution.stages) {
      for (let i = 0; i < moves.length; i++) {
        this.el.steps.appendChild(this._stepRow(i, moves[i], null));
      }
      return;
    }
    let index = 0;
    for (const stage of solution.stages) {
      const heading = document.createElement('div');
      heading.className = 'step-stage';
      heading.innerHTML = `${stage.title}`
        + (stage.goal ? `<div class="step-stage-goal">${stage.goal}</div>` : '');
      heading.setAttribute('role', 'listitem');
      this.el.steps.appendChild(heading);
      for (const entry of stage.moves) {
        for (const move of entry.moves) {
          this.el.steps.appendChild(this._stepRow(index, move, entry.explanation));
          index += 1;
        }
      }
    }
  }

  _stepRow(index, move, explanation) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'step-row';
    row.dataset.index = String(index);
    row.setAttribute('role', 'listitem');
    row.innerHTML = `<span class="step-index">${index + 1}</span>`
      + `<span class="step-move">${move}</span>`
      + `<span class="step-say">${explanation || describeMove(move)}</span>`;
    row.addEventListener('click', () => {
      this.animatePlayback = false;
      this.player.pause();
      this.player.seek(index);
      this.animatePlayback = true;
    });
    return row;
  }

  _renderPlayback(index, info) {
    const total = info.total;
    this.el.scrub.value = String(index);
    this.el.progressLabel.textContent = `Move ${index} of ${total}`;
    this.el.stageLabel.textContent = info.stage && info.stage.title ? info.stage.title : '';

    const move = index < total ? this.player.steps[index].move : null;
    this.el.moveGlyph.textContent = move || '✓';
    if (move) {
      const explanation = this.player.steps[index].description;
      this.el.moveText.textContent = `${index + 1}. ${explanation}`;
    } else if (total > 0) {
      this.el.moveText.textContent = 'That is the last move — your cube should be solved.';
    }

    for (const row of this.el.steps.querySelectorAll('.step-row')) {
      const i = Number(row.dataset.index);
      row.classList.toggle('is-current', i === index);
      row.classList.toggle('is-done', i < index);
    }
    // Keep the current step in view by scrolling the list itself only.
    // (scrollIntoView would also scroll the page, dragging the cube off screen
    // on a phone while the user is watching it.)
    const current = this.el.steps.querySelector('.step-row.is-current');
    if (current) {
      const list = this.el.steps;
      const listRect = list.getBoundingClientRect();
      const rowRect = current.getBoundingClientRect();
      let delta = 0;
      if (rowRect.top < listRect.top) delta = rowRect.top - listRect.top - 8;
      else if (rowRect.bottom > listRect.bottom) delta = rowRect.bottom - listRect.bottom + 8;
      if (delta) list.scrollBy({ top: delta, behavior: this.reducedMotion ? 'auto' : 'smooth' });
    }

    const play = document.getElementById('btn-play');
    play.textContent = info.playing ? '❚❚ Pause' : '▶ Play';
    play.setAttribute('aria-label', info.playing ? 'Pause' : 'Play');

    // Reaching the end counts whether the user played or stepped there by hand.
    // The finished screen waits for the last turn to be seen first.
    if (info.total > 0 && info.atEnd && !this.finished) {
      this.finished = true;
      this.player.stop();
      play.textContent = '▶ Play';
      play.setAttribute('aria-label', 'Play');
      this._scheduleFinish();
    }
    if (!info.atEnd) {
      this.finished = false;
      this._cancelFinish();
    }

    if (this.views.solve) {
      const view = this.views.solve;
      view.showFaceIndicator(move ? move[0] : null);
    }
  }

  _scheduleFinish() {
    this._cancelFinish();
    const started = performance.now();
    const poll = () => {
      const view = this.views.solve;
      const busy = view && view.busy && performance.now() - started < 8000;
      this._finishTimer = busy ? setTimeout(poll, 60) : setTimeout(() => {
        this._finishTimer = null;
        if (this.current === 'solve' && this.player.atEnd && this.player.length > 0) this._finish();
      }, this.reducedMotion ? 150 : 650);
    };
    poll();
  }

  _cancelFinish() {
    clearTimeout(this._finishTimer);
    this._finishTimer = null;
  }

  _finish() {
    const count = this.player.length;
    this.el.solvedCount.textContent = String(count);
    this.el.doneNote.textContent = this.method === 'beginner'
      ? 'That is the full layer-by-layer method. With practice the same cube takes well under two minutes.'
      : 'This is the short solution. Switch to the Beginner method on the solution screen to learn it step by step.';
    const view = this.view('done');
    view.setState(SOLVED_FACELETS);
    view.setAutoRotate(true);
    this.go('done');
  }

  /* ---------------------------------- scan ---------------------------------- */

  async _enterScan() {
    const token = ++this._cameraToken;
    this.scanned = {};
    this.mode = null;
    this.el.capture.disabled = true;
    this.el.scanBadge.textContent = 'Starting camera…';
    this.el.scanHint.textContent = 'Allow camera access if your browser asks.';
    this.el.grid.classList.add('is-calibrating');
    this.el.faceProgress.innerHTML = '';
    for (const face of SCAN_ORDER) {
      const li = document.createElement('li');
      li.dataset.face = face;
      li.textContent = FACE_LABELS[face];
      this.el.faceProgress.appendChild(li);
    }
    this._beginCalibration();
    if (this.views.scan) this.views.scan.setState(SOLVED_FACELETS);
    try {
      const video = await this.scanner.start('environment');
      // The user may have left the scan screen while the permission prompt
      // was open; never leave the camera running in the background.
      if (token !== this._cameraToken || this.current !== 'scan') { this._stopCamera(); return; }
      this._attachVideo(video);
      this._updateScanStep();
      this.el.scanHint.textContent = 'Fill the square with the sticker, in even light, then press Capture.';
    } catch (err) {
      if (token !== this._cameraToken) return;
      this.el.scanBadge.textContent = 'Camera unavailable';
      this.el.scanHint.textContent = /by hand/.test(err.message)
        ? err.message
        : `${err.message} You can also enter the colours by hand instead.`;
      this.el.capture.disabled = true;
      this._toast(err.message);
    }
  }

  _attachVideo(video) {
    this.el.video.srcObject = video.srcObject;
    this.el.video.play().catch(() => {});
    this.el.capture.disabled = false;
  }

  _beginCalibration() {
    this.mode = 'calibrate';
    this.calibrationIndex = 0;
    this.el.grid.classList.add('is-calibrating');
    this._updateScanStep();
  }

  _updateScanStep() {
    const faces = this.mode === 'calibrate' ? SCAN_ORDER : SCAN_ORDER;
    const face = faces[this.calibrationIndex];
    if (!face) return;
    const total = SCAN_ORDER.length + 1;
    const stepNo = this.mode === 'calibrate' ? this.calibrationIndex + 1 : this.calibrationIndex + 2;
    this.el.scanStep.textContent = `Step ${stepNo} of ${total} · ${this.mode === 'calibrate' ? 'Centres' : 'Faces'}`;
    this.el.scanInstruction.textContent = this.mode === 'calibrate'
      ? CALIBRATION_INSTRUCTIONS[face]
      : SCAN_INSTRUCTIONS[face];
    this.el.miniCaption.textContent = this.mode === 'calibrate'
      ? CALIBRATION_INSTRUCTIONS[face]
      : `Now showing: ${FACE_LABELS[face]} (${COLOR_OF_LETTER[face].name})`;
    this.el.scanBadge.textContent = this.mode === 'calibrate'
      ? `Centre ${this.calibrationIndex + 1}/6`
      : `Face ${this.calibrationIndex + 1}/6`;
    for (const li of this.el.faceProgress.children) {
      li.classList.toggle('is-current', this.mode === 'scan' && li.dataset.face === face);
      li.classList.toggle('is-done', this.mode === 'scan' && !!this.scanned[li.dataset.face]);
    }
    const view = this.view('scan');
    view.setHighlight([]);
    view.showFaceIndicator(face);
  }

  async _capture() {
    if (!this.scanner.ready) {
      this._toast('The camera is not ready yet.');
      return;
    }
    if (this.mode === 'calibrate') {
      const face = SCAN_ORDER[this.calibrationIndex];
      try {
        this.scanner.captureCalibration(face);
      } catch (err) {
        this._toast(err.message);
        return;
      }
      this.calibrationIndex += 1;
      if (this.calibrationIndex < SCAN_ORDER.length) {
        this._updateScanStep();
        this._toast(`${COLOR_OF_LETTER[face].name} centre recorded.`);
        return;
      }
      this.mode = 'scan';
      this.calibrationIndex = 0;
      this.el.grid.classList.remove('is-calibrating');
      this._updateScanStep();
      this._toast('Centres captured. Now scan each face.');
      return;
    }

    const face = SCAN_ORDER[this.calibrationIndex];
    if (!face) return;
    const { results, letters } = this.scanner.scanFace();
    this.scanned[face] = letters;
    this._applyScanned();

    const warnings = [];
    if (letters[4] && letters[4] !== face) {
      warnings.push(`The middle sticker looked ${COLOR_OF_LETTER[letters[4]].name.toLowerCase()}, not ${COLOR_OF_LETTER[face].name.toLowerCase()} — was the right face showing?`);
    }
    if (results.some((r) => !r || r.confidence < 0.35)) {
      warnings.push('Some stickers were hard to read — check them before continuing.');
    }
    this.el.scanHint.textContent = warnings[0] || `Captured the ${COLOR_OF_LETTER[face].name.toLowerCase()} face.`;

    this.calibrationIndex += 1;
    if (this.calibrationIndex < SCAN_ORDER.length) {
      this._updateScanStep();
      return;
    }
    // All six faces captured.
    this._stopCamera();
    const ok = validate(this.facelets).valid;
    this._toast(ok
      ? 'Scanning finished. Check the result on the next screen.'
      : 'Scanning finished — a few stickers need checking.');
    this.go('review');
  }

  /** Copy what has been scanned so far into the shared state. */
  _applyScanned() {
    const next = this.facelets.split('');
    for (const [face, letters] of Object.entries(this.scanned)) {
      if (!letters) continue;
      const base = FACE_NAMES.indexOf(face) * 9;
      for (let i = 0; i < 9; i++) {
        if (i === 4) continue;                       // centres are fixed by definition
        if (letters[i]) next[base + i] = letters[i];
      }
    }
    this.facelets = next.join('');
    this.net.set(this.facelets, { record: true, cause: 'scan' });
    // The little guide cube shows only what has been scanned so far, on top of
    // a solved cube, rather than whatever was in the editor before scanning.
    if (this.views.scan) {
      const guide = SOLVED_FACELETS.split('');
      for (const face of Object.keys(this.scanned)) {
        const base = FACE_NAMES.indexOf(face) * 9;
        for (let i = 0; i < 9; i++) guide[base + i] = this.facelets[base + i];
      }
      this.views.scan.setState(guide.join(''));
    }
  }

  _stopCamera() {
    if (this.scanner.stream) this.scanner.stop();
    if (this.el.video.srcObject) this.el.video.srcObject = null;
  }

  /* --------------------------------- helpers --------------------------------- */

  _toggleTheme() {
    const root = document.documentElement;
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem('cubix-theme', next); } catch { /* private mode */ }
    this._syncThemeButton();
  }

  _syncThemeButton() {
    const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    this.el.theme.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`);
    this.el.themeGlyph.textContent = theme === 'dark' ? '◐' : '◑';
    const meta = document.querySelector('meta[name="theme-color"]:not([media])');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0d0d0f' : '#f4f4f6');
  }

  _openHelp() {
    this._helpReturnFocus = document.activeElement;
    this.el.helpSheet.hidden = false;
    document.body.classList.add('has-sheet');
    const close = this.el.helpSheet.querySelector('[data-close-sheet]');
    if (close) close.focus();
  }

  _closeHelp() {
    if (this.el.helpSheet.hidden) return;
    this.el.helpSheet.hidden = true;
    document.body.classList.remove('has-sheet');
    if (this._helpReturnFocus && this._helpReturnFocus.focus) this._helpReturnFocus.focus();
  }

  _onKey(event) {
    if (!this.el.helpSheet.hidden) {
      if (event.key === 'Escape') this._closeHelp();
      if (event.key === 'Tab') {
        // Keep focus inside the open dialog.
        const focusables = this.el.helpSheet.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])');
        if (focusables.length) {
          const first = focusables[0], last = focusables[focusables.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }
      return;
    }
    // Playback shortcuts on the solve screen, unless the user is typing in or
    // operating another control.
    if (this.current !== 'solve' || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target.closest && event.target.closest('input, textarea, select, button')) return;
    if (event.key === ' ' || event.key === 'k') { event.preventDefault(); document.getElementById('btn-play').click(); }
    else if (event.key === 'ArrowRight' || event.key === 'l') { event.preventDefault(); this.player.next(); }
    else if (event.key === 'ArrowLeft' || event.key === 'j') { event.preventDefault(); this.player.previous(); }
  }

  _toast(message) {
    const toast = this.el.toast;
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { toast.hidden = true; }, 4200);
  }

  /** One animation loop drives whichever view is on screen. */
  _loop() {
    const frame = (now) => {
      const view = this.views[this.current];
      if (view) {
        // Keep a view only rendering while it is visible, to save battery.
        view.render(now);
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
}

/* ------------------------------------------------------------------ */

let cubieStateFn = null;
function cubieStateOf(facelets) {
  return cubieStateFn(facelets);
}

/** Wired up by main.js so the model stays importable on its own in tests. */
export function setCubieStateFunction(fn) {
  cubieStateFn = fn;
}

function invertOne(move) {
  if (move.endsWith('2')) return move;
  return move.endsWith("'") ? move[0] : move + "'";
}

export { tokenizeMoves, applyMoveSequence, isSolved, BEGINNER_STAGES };
