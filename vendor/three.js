/**
 * Cubix — local Three.js shim.
 *
 * Three.js r186 (pinned) is vendored here so the app runs with zero network
 * access. `three.js` re-exports the pinned minified build and `three-orbit.js`
 * re-exports OrbitControls with its bare `three` import rewritten to this file.
 *
 * Upstream: https://github.com/mrdoob/three.js  (MIT License)
 * Version : 0.186.1  (pinned — do not float)
 */
export * from './three.module.min.js';
