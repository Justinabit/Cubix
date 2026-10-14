/**
 * main.js — entry point. Wires the app together and starts it.
 */
import { App, setCubieStateFunction } from './ui/app.js';
import { faceletsToCubieState } from './core/cube-model.js';

// The solver needs the cubie representation; the UI asks for it through this
// hook so that neither module has to know about the other.
setCubieStateFunction(faceletsToCubieState);

const app = new App();

// Handy for poking at the cube from the console, and used by the smoke test.
window.Cubix = app;

export default app;
