# Cubix

An interactive 3D Rubik's Cube solver that runs **entirely in your browser**.

Point your camera at a scrambled cube — or tap the colours in by hand — and Cubix
checks the cube is actually possible, then teaches you how to solve it with
animated 3D instructions you can scrub through at your own pace.

**Nothing leaves your device.** The camera feed is drawn to an offscreen canvas,
averaged down to nine colours per face, and thrown away. There is no server, no
upload, no analytics, and no network request after the page loads.

---

## Running it

```bash
npm start          # serves the folder at http://localhost:5173
```

Any static file server works — there is no build step and no install. ES modules
are used directly, so it must be served over `http://` rather than opened as a
`file://` URL (browsers block module loading from the filesystem).

```bash
npm test                      # everything: unit + integration
node tests/run.mjs            # same thing, explicitly
node tests/model.test.mjs     # or one file at a time
```

Some tests drive a real headless Chrome and need `puppeteer`; if it is not
installed they skip themselves rather than fail:

```bash
npm i -D puppeteer
node tests/smoke.test.mjs     # full click-through in a browser
node tests/layout.test.mjs    # UI audit across 5 viewports and both themes
node tests/scan.test.mjs      # camera flow with a fake capture device
```

---

## What it does

1. **Landing** — a hero cube that idles and re-solves itself.
2. **Enter the cube** — either scan it with the camera or tap colours onto an
   unfolded net (and/or straight onto the 3D cube).
3. **Review** — validation with plain-English explanations and the offending
   stickers outlined, on both the net and the 3D cube.
4. **Solve** — animated moves, a step list grouped by stage, playback controls,
   a scrubbable progress bar, practice mode, and a notation cheat sheet.
5. **Done** — move count and the option to solve another.

Two solving methods:

| Method | Moves | Notes |
| --- | --- | --- |
| **Shortest** (Kociemba two-phase) | ~21–24 | Fast and short, but the moves will not teach you much. |
| **Beginner** (layer-by-layer) | ~90–170 | Seven stages, each with a goal and a plain-English reason for every move. |

---

## File layout

```
index.html              markup for all five screens
css/style.css           strictly monochrome theme (both light and dark)
js/
  main.js               entry point
  core/
    cube-model.js       THE cube model: 54-sticker state, moves, cubie level state
    cube-ops.js         colour-level helpers: slots, whole-cube rotations, renaming
    validator.js        the three ways a cube can be impossible
  solver/
    kociemba.js         Kociemba two-phase solver, implemented in-tree
    beginner.js         the seven-stage layer-by-layer method
  scan/
    classifier.js       HSV + Lab colour classification, with calibration
    scanner.js          getUserMedia, the 3x3 sampling grid, the scan flow
  three/
    cube3d.js           Three.js renderer: 27 cubies, animated turns, picking
  ui/
    net.js              unfolded-net editor with undo/redo
    player.js           solution playback, scrubbing, practice mode
    app.js              screen routing and wiring
tests/                  one file per module, plus browser-level tests
tools/
  serve.mjs             zero-dependency static server
  ll-lab.mjs            the lab that discovered the beginner-method algorithms
vendor/                 Three.js r186.1 (pinned, vendored) + OrbitControls
```

### One source of truth

Every part of the app reads and writes the same 54-character facelet string, in
Kociemba's **URFDLB** order, where each character is both a face name and a
colour (`U`=white, `R`=red, `F`=green, `D`=yellow, `L`=orange, `B`=blue).

The 3D view, the net editor, the validator, and both solvers all consume that
same string. The renderer is a strict *view*: it never owns cube state. When a
move is played, the model is updated first and the animation catches up, so the
two cannot drift apart.

---

## Design decisions worth knowing about

**The move tables are derived, not typed.** `cube-model.js` computes its move
permutations from 3D integer geometry (Rodrigues rotations) rather than from a
hand-written table. That is elegant but it means a single wrong sign can hide
from every internal check — a cube with the `U` turn inverted is still a
perfectly self-consistent cube, just not the one in your hands.

That happened during development, so the move engine is now pinned down three
independent ways in `tests/`:

- **Internal invariants** — turns are permutations, X⁴ = identity, centres never
  move, and facelet ↔ cubie-state round-trips over hundreds of scrambles.
- **An independent rotation model** — `permutation-truth.test.mjs` recomputes all
  54 sticker destinations per face from a textbook Rodrigues axis-angle formula
  and compares.
- **External ground truth** — `reference.test.mjs` compares against every one of
  the 18 facelet strings produced by cubejs 1.3.2, and against known group
  orders (`R U` has order 105; `R U2 D' B D'` has order 1260, the group maximum).
  The correct rule, in the end, is uniform: **a clockwise turn as seen from
  outside is −90° about that face's outward normal** — the two faces I had
  hand-tuned wrongly (U and L) were the ones that broke it.

**The beginner method's algorithms were discovered, not recalled.** Rather than
copy `R U R' U R U2 R'` from memory and hope, `tools/ll-lab.mjs` searches for
them: it builds canonical situations with the verified move engine and asks for
the shortest sequence that achieves each stage goal. That is where the corner
insertions (`R U R'`, `F' U' F`, `U F2 R' F2 R`), the middle-layer insertions,
and the six "pure corner twisters" come from. Every one is re-verified at solve
time — the solver simulates before it commits, so a wrong algorithm cannot
produce a wrong solution.

**Last-layer stages are solved by breadth-first search, not heuristics.** Each
stage's state space, once earlier stages are fixed, is small (27 states for the
final corner twists, a few thousand for the rest). So instead of a "keep making
progress" loop — which can stall in a local optimum, and did — each stage runs a
BFS over verified algorithms restricted to states where earlier stages still
hold. It is exhaustive, so it cannot get stuck, and it chains steps (push a
misplaced piece out, then insert) without special-casing.

**The Kociemba solver is implemented in-tree** rather than pulled from npm, so
that it shares the verified cube model. It is the standard two-phase algorithm:
phase 1 reaches G1 = ⟨U, D, R2, L2, F2, B2⟩ using pruning tables over
(twist, slice) and (flip, slice); phase 2 finishes inside G1 using tables over
(corner permutation, slice permutation) and (edge permutation, slice
permutation). Tables take about 1.5 s to build and are built once per page load,
with a progress indicator and yields so the page stays responsive.

**Colour classification is comparative, not absolute.** Absolute hue thresholds
fail badly under a warm bulb or when a phone's auto-white-balance shifts. So
after you show the six centres, the app measures *your* six colours in *your*
lighting and classifies every other sticker by nearest neighbour in Lab space,
which approximates perceptual distance. Before calibration it falls back to HSV
reasoning. Red versus orange — the classic confusion — is separated by hue and
saturation together, and both paths are covered by `tests/classifier.test.mjs`
under simulated warm, cool, dim and bright lighting.

**Accessibility.** Full keyboard navigation, ARIA labels on every sticker and
control, visible focus rings, `prefers-reduced-motion` support (turns complete
instantly, the idle spin and solved animations stop), optional letters on
stickers for colour-blind users, and a light/dark toggle that stays monochrome.
`tests/layout.test.mjs` audits contrast (WCAG AA), tap-target size, text size and
horizontal overflow across five viewports in both themes.

**Theme.** Strictly black, white and greys — the only colours anywhere on the
page are the cube's stickers and the six palette swatches. The 3D cube sits on a
dark charcoal gradient so it reads as the hero. Headings use a geometric sans;
move notation uses a monospace face.

---

## Known limitations

- **Scanning accuracy depends on lighting.** Camera scanning is the least
  reliable part. In good, even, white light it is usually right first time; under
  coloured or very dim light it can misread stickers — most often red/orange or
  blue/green. That is why every face shows a preview you can tap to correct
  before confirming, and why the review screen re-validates. Glossy stickers that
  catch a highlight are the hardest case; tilting the cube a few degrees usually
  fixes it. Manual entry is always available and is exact.
- **The shortest solver is not guaranteed optimal.** It finds short solutions
  (typically 21–24 moves, and optimal for the short cases in the tests) but it is
  not a full optimal solver — proving optimality takes minutes, not
  milliseconds.
- **The beginner method is long.** Roughly 90–170 moves versus ~22 for the short
  solution. That is inherent to layer-by-layer: it trades move count for
  memorability.
- **Built for standard 3×3 colour schemes.** Non-standard sticker layouts (for
  example a cube whose opposite-face pairs differ from the usual) are rejected by
  validation rather than solved.
- **Requires WebGL and, for scanning, `getUserMedia`** (so a secure context —
  `https://` or `localhost`). Without WebGL the page still works but shows no
  3D cube; without a camera you can still enter colours by hand.

---

## Third-party code

- [Three.js](https://threejs.org) **r186.1** (MIT), vendored in `vendor/` so the
  app works offline with no CDN. Versions are pinned, not floated.
- `OrbitControls` from the same Three.js release.
- cubejs 1.3.2 is **not** a dependency; it was used during development only, to
  capture reference facelet strings for `tests/reference.test.mjs`.

## License

MIT.
