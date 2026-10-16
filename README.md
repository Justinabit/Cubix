# Cubix

**An interactive 3D Rubik's Cube solver that runs entirely in your browser.**

### ▶ Try it: [cubix-flax.vercel.app](https://cubix-flax.vercel.app/)

Show Cubix your scrambled cube with your phone or laptop camera — or tap the
colours in by hand — and it checks the cube is actually possible, then shows
you how to solve it with animated 3D steps you can play, pause and scrub
through at your own pace.

- 📷 **Scan with your camera.** Hold up each face; it captures automatically
  when the cube is still, and judges colours against your own cube's centres.
- ✋ **Or enter colours by hand** on an unfolded net or straight onto the 3D cube.
- ✅ **Checks the cube is real** — wrong counts, twisted corners, flipped edges
  and swapped pieces are explained in plain English and outlined.
- 🧩 **Two ways to solve:** the shortest solution (~20–24 moves) or the
  seven-stage beginner method, with a reason for every move.
- 📱 **Mobile first**, installable to your home screen, light and dark themes.
- 🔒 **Private:** no accounts, no uploads, no analytics, no cookies.

---

## Using Cubix

1. Open [cubix-flax.vercel.app](https://cubix-flax.vercel.app/).
2. Choose **Scan my cube** or **Enter colours manually**.
   - *Scanning:* hold each face inside the square the way the small guide cube
     shows (the four sides with white on top, then white with blue on top, then
     yellow with green on top). Use even, white light and avoid glare.
3. **Review** the cube. Fix any outlined stickers by tapping **Edit colours**.
4. **Solve it.** Hold your real cube with **white on top and green facing you**,
   and copy each move. Press **Play**, or step with ◀◀ / ▶▶.

| Notation | Meaning |
| --- | --- |
| `R` `L` `U` `D` `F` `B` | Turn the Right, Left, Up, Down, Front or Back face **clockwise**, as you look at that face |
| `R'` | Anticlockwise (the apostrophe means "reverse") |
| `R2` | Half turn (twice) |

Keyboard on the solve screen: **Space** plays/pauses, **← / →** step through
the moves. The **?** button opens a notation cheat sheet, and the circular-arrow
button stops the cubes spinning.

---

## Privacy

Cubix is a static website. Everything — the camera processing, the colour
reading and both solvers — runs in your browser.

- Camera frames are drawn to an off-screen canvas, averaged down to nine
  colours, and discarded. Nothing is uploaded or stored, and the camera is
  switched off as soon as scanning finishes or you leave the scan screen.
- There is no back end, no analytics, no tracking and no cookies. The only
  things saved (in your browser's local storage) are your theme, spin and
  auto-capture preferences.
- After the page has loaded it makes no further network requests.

> **If you deploy your own copy:** keep it that way. Turning on Vercel Web
> Analytics or Speed Insights, or adding any third-party script, would make the
> statements above untrue — update this section if you do.

---

## Browser support

Any current version of Chrome, Edge, Safari (iOS and macOS) or Firefox.

- **3D view** needs WebGL. Without it the page still works but shows no cube.
- **Scanning** needs camera access, which browsers only allow on `https://`
  pages (or `localhost`). If the camera is blocked or missing, manual entry
  works everywhere.

---

## Running it locally

There is no build step and nothing to install to run the app — it is plain
HTML, CSS and ES modules. It does need to be served over `http://` (browsers
will not load ES modules from a `file://` URL).

```bash
git clone https://github.com/<your-username>/<your-repo>.git
cd <your-repo>
npm start            # http://localhost:5173  (any static server works)
```

`npm start` uses a tiny zero-dependency server (`tools/serve.mjs`) that also
sends the same security headers as production (read from `vercel.json`), so
you develop under the same rules the live site runs with.

### Tests

```bash
npm test                      # everything
node tests/run.mjs solver     # only files whose name matches a word
node tests/model.test.mjs     # or one file at a time
```

Each file runs in its own process. The browser tests (`smoke`, `layout`,
`scan`) drive headless Chrome through `puppeteer` and skip themselves if it is
not installed (`npm install`). `tests/scan.test.mjs` plays a video of a real
scrambled cube through a fake camera: the app must capture all six faces by
itself, read the cube exactly, and the on-screen steps of both methods must
solve it.

---

## Deploying to Vercel

The repo is ready to deploy as-is; `vercel.json` holds all the settings.

1. Push the repository to GitHub.
2. In Vercel, **Add New → Project**, import the repository and press **Deploy**.
   No settings need changing: `vercel.json` sets the framework to *Other*,
   skips the install and build steps (so the test-only `puppeteer` dependency is
   never downloaded), and serves the repository root.
3. Every push to the default branch redeploys; pull requests get preview URLs.

What `vercel.json` adds:

| Header | Why |
| --- | --- |
| `Content-Security-Policy` | Only the site's own files may run or load. The one inline script (which picks the theme before first paint) is allowed by its SHA-256 hash. |
| `Permissions-Policy` | The camera is allowed for this site only; microphone, location, payment and USB are switched off. |
| `X-Frame-Options`, `frame-ancestors` | The site cannot be embedded in another site's frame. |
| `X-Content-Type-Options`, `Referrer-Policy` | Standard hardening. |

> **Editing the inline script in `index.html`?** Its hash in `vercel.json` must
> change too, or the browser will refuse to run it. Recompute it with:
>
> ```bash
> node -e "const s=require('fs').readFileSync('index.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];console.log(\"'sha256-\"+require('crypto').createHash('sha256').update(s).digest('base64')+\"'\")"
> ```

`.vercelignore` lists the development-only folders (`tests/`, `tools/`) that
do not need to be deployed; they contain nothing private either way. Vercel
serves HTTPS automatically, which the camera requires.

Other static hosts (Netlify, Cloudflare Pages, GitHub Pages) also work: upload
`index.html`, `manifest.webmanifest`, `css/`, `js/`, `icons/` and `vendor/`.
All paths are relative, so a sub-folder such as `https://you.github.io/cubix/`
works too. Those hosts ignore `vercel.json`, so set equivalent headers there if
you want them.

---

## How it works

### One source of truth

Every part of the app reads and writes the same 54-character facelet string, in
Kociemba's **URFDLB** order, where each character is both a face and a colour
(`U`=white, `R`=red, `F`=green, `D`=yellow, `L`=orange, `B`=blue). The 3D view,
the net editor, the validator and both solvers all use that string. The
renderer is only a *view*: the model is updated first and the animation catches
up, and every turn animates in exactly the direction of the move it shows.

### Solving

- **Shortest** — the Kociemba two-phase algorithm, implemented in-tree so it
  shares the verified cube model. Phase 1 reaches ⟨U, D, R2, L2, F2, B2⟩ using
  pruning tables over (twist, slice) and (flip, slice); phase 2 finishes using
  tables over corner, edge and slice permutations. The tables are built once per
  visit (about 1.5 s); solving then takes milliseconds.
- **Beginner** — the seven-stage layer-by-layer method: white cross, white
  corners, middle layer, yellow cross, yellow edges, then position and twist the
  last corners. The algorithms were found by search (`tools/ll-lab.mjs`) rather
  than copied from memory, the last-layer stages use an exhaustive breadth-first
  search so they cannot get stuck, and every step is simulated before it is shown.

Both solvers are checked on thousands of random cubes in the tests.

### The move engine

`cube-model.js` derives its move tables from 3D geometry rather than a
hand-typed table, and is pinned down three independent ways: internal
invariants (turns are permutations, X⁴ = identity, centres never move), an
independent rotation model (`permutation-truth.test.mjs`), and external ground
truth (`reference.test.mjs`: the 18 facelet strings produced by cubejs 1.3.2,
plus known group orders — `R U` has order 105, `R U2 D' B D'` has order 1260).
The rule is uniform: a clockwise turn, as seen from outside, is −90° about that
face's outward normal.

### Scanning

You show each face once, held so the camera reads the stickers in the same
order the model numbers them. The nine stickers are previewed live and the face
is captured automatically once the cube is held still. After all six faces,
each face's **centre sticker becomes the reference for that colour** — measured
on your cube, in your light. Every sticker is then matched to a centre with
exposure removed (each face is lit differently), under the rule every real cube
obeys: exactly nine of each colour. Solving that as an assignment problem is
what separates red from orange and white from yellow. If the result is still
not a possible cube, the cheapest swap of two doubtful stickers that fixes it
is applied, and doubtful stickers are outlined for you to check.

### Accessibility and design

Keyboard navigation, ARIA labels on every sticker and control, visible focus,
`prefers-reduced-motion` support, optional letters on stickers for colour-blind
users, and a stop-spinning button. `tests/layout.test.mjs` audits contrast
(WCAG AA), tap-target size, text size and overflow across five screen sizes.
The stylesheet is mobile first (phone base, 720px tablet, 1040px desktop) and
strictly monochrome — the only colours on the page are the cube's own.

---

## Project layout

```
index.html              markup for all screens
manifest.webmanifest    lets phones add Cubix to the home screen
vercel.json             Vercel settings and security headers
css/style.css           mobile-first, monochrome theme (light and dark)
js/
  main.js               entry point
  core/                 cube model, colour helpers, validator
  solver/               Kociemba two-phase solver, beginner method
  scan/                 camera access, live sampling, centre-based colour reading
  three/cube3d.js       Three.js renderer: cubies, animated turns, picking
  ui/                   net editor, playback, screen wiring
icons/                  app icons
vendor/                 Three.js r186.1 (pinned) + OrbitControls
tests/                  unit tests and headless-browser tests
tools/                  local dev server; the lab that found the beginner algorithms
```

---

## Known limitations

- **Scanning depends on lighting.** In even, white light it is usually right
  first time. Very dim or strongly coloured light, and glossy stickers catching
  a highlight, can cause misreads (most often red/orange). Every face can be
  rescanned, doubtful stickers are outlined, and manual entry is always exact.
- **The shortest solution is short, not proven optimal** (typically 20–24
  moves). Proving optimality takes minutes, not milliseconds.
- **The beginner method is long** (roughly 90–200 moves). That is the price of
  steps you can learn and remember.
- **Standard colour scheme only** (white opposite yellow, green opposite blue,
  red opposite orange). Other schemes are rejected by validation.

---

## Contributing

Issues and pull requests are welcome. Please run `npm test` before opening a
pull request; the browser tests need `npm install` first.

## Third-party code

- [Three.js](https://threejs.org) r186.1 and its `OrbitControls` (MIT),
  vendored in `vendor/` so the app needs no CDN. `three.core.js` is the upstream
  `build/three.core.js` minified with Terser.
- [cubejs](https://github.com/ldez/cubejs) 1.3.2 is **not** a dependency; it was
  used only to produce reference data for `tests/reference.test.mjs`.

## License

[MIT](LICENSE)
