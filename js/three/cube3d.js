/**
 * cube3d.js — the 3D cube: geometry, materials, animation and picking.
 *
 * Design decisions worth knowing:
 *
 *  - The renderer is a VIEW, never a source of truth. It reads a 54-character
 *    facelet string and rebuilds sticker colours from it. Every logical move
 *    happens in the model first; the animation is purely cosmetic and the model
 *    is updated the instant a turn begins, so the two can never drift.
 *
 *  - Each of the 26 cubies is a rounded box with six sticker planes. Turns are
 *    done by re-parenting the nine moving cubies into a temporary pivot object,
 *    rotating the pivot, then re-parenting and snapping to exact integer angles.
 *    That avoids cumulative floating point drift over thousands of turns.
 *
 *  - Reduced motion is respected: when the user prefers reduced motion, turns
 *    complete instantly and the idle spin is disabled.
 */
import * as THREE from '../../vendor/three.js';
import { OrbitControls } from '../../vendor/three-orbit.js';
import {
  FACE_NAMES, COLOR_OF_LETTER, SLOT_INDEX, CUBIES, FACELET_INFO,
  parseMove, applyQuarterTurn, SOLVED_FACELETS, MOVE_TURNS,
} from '../core/cube-model.js';

const AXIS = {
  U: new THREE.Vector3(0, 1, 0), R: new THREE.Vector3(1, 0, 0), F: new THREE.Vector3(0, 0, 1),
  D: new THREE.Vector3(0, -1, 0), L: new THREE.Vector3(-1, 0, 0), B: new THREE.Vector3(0, 0, -1),
};

const CUBIE = 0.94;          // cubie edge length
const GAP = 0.035;           // visual gap between cubies
const STICKER_INSET = 0.06;  // sticker border
const STICKER_LIFT = 0.001;  // avoid z-fighting with the cubie face

export class Cube3D {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{prefersReducedMotion?: () => boolean}} [options]
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.options = options;
    this.facelets = SOLVED_FACELETS;
    this.queue = [];
    this.animating = null;
    this.userInteracting = false;
    this.autoRotate = true;
    this.onFaceClick = null;
    this.highlight = new Set();
    this.showLetters = false;
    this.turnDuration = 260;

    this._initScene();
    this._buildCube();
    this._initInput();
    this.resize();
  }

  /* ------------------------------- setup ------------------------------- */

  _initScene() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    this.camera.position.set(4.6, 4.2, 6.2);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.enablePan = true;
    this.controls.minDistance = 5.2;
    this.controls.maxDistance = 16;
    this.controls.addEventListener('start', () => { this.userInteracting = true; });
    this.controls.addEventListener('end', () => {
      this.userInteracting = false;
      this._lastInteraction = performance.now();
    });

    // Lighting: a soft key light plus fill, tuned for a dark charcoal page.
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x202020, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(5, 8, 6);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5);
    fill.position.set(-6, -3, -5);
    this.scene.add(fill);

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);
  }

  _buildCube() {
    this.cubieGroup = new THREE.Group();
    this.root.add(this.cubieGroup);

    const bodyGeometry = roundedBoxGeometry(CUBIE, 0.12, 3);
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.55, metalness: 0.05 });
    const stickerGeometry = roundedPlaneGeometry(CUBIE - STICKER_INSET * 2, 0.09);

    this.cubies = [];
    for (const cubie of CUBIES) {
      const mesh = new THREE.Mesh(bodyGeometry, bodyMaterial);
      mesh.position.set(cubie.pos[0], cubie.pos[1], cubie.pos[2]);
      mesh.userData.slot = cubie.index;

      // One sticker mesh per face this cubie can show.
      mesh.userData.stickers = {};
      for (const face of cubie.faces) {
        const label = new THREE.Mesh(
          stickerGeometry,
          new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 0.28, metalness: 0.02 })
        );
        const normal = AXIS[face];
        label.position.copy(normal).multiplyScalar(CUBIE / 2 + STICKER_LIFT);
        orientToNormal(label, normal);
        label.userData.face = face;
        label.userData.cubieSlot = cubie.index;
        mesh.add(label);

        const letter = makeLetterSprite('');
        letter.position.copy(normal).multiplyScalar(CUBIE / 2 + STICKER_LIFT + 0.006);
        orientToNormal(letter, normal);
        letter.visible = false;
        label.userData.letter = letter;
        mesh.add(letter);

        mesh.userData.stickers[face] = label;
      }
      this.cubieGroup.add(mesh);
      this.cubies[cubie.index] = mesh;
    }

    // Outline used to flag suspicious stickers during validation.
    const outlineGeometry = roundedPlaneGeometry(CUBIE - STICKER_INSET * 2 + 0.05, 0.1);
    this.outlines = [];
    for (let i = 0; i < 54; i++) {
      const info = FACELET_INFO[i];
      const mesh = new THREE.Mesh(outlineGeometry, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false,
      }));
      const normal = AXIS[info.face];
      mesh.position.copy(normal).multiplyScalar(CUBIE / 2 + STICKER_LIFT + 0.004);
      orientToNormal(mesh, normal);
      mesh.visible = false;
      const cubie = this.cubies[info.slot];
      cubie.add(mesh);
      const q = new THREE.Quaternion();
      cubie.getWorldQuaternion(q);
      this.outlines.push(mesh);
    }
  }

  _initInput() {
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    let downAt = null;
    this.canvas.addEventListener('pointerdown', (e) => {
      downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    this.canvas.addEventListener('pointerup', (e) => {
      if (!downAt) return;
      const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
      const held = performance.now() - downAt.t;
      downAt = null;
      // Treat it as a click only if the pointer barely moved (so orbiting does
      // not select faces) and it was not a long press.
      if (moved > 8 || held > 600) return;
      const hit = this._pick(e);
      if (hit && this.onFaceClick) this.onFaceClick(hit);
    });

    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(this.canvas.parentElement || this.canvas);
  }

  _pick(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.cubieGroup.children, true);
    for (const hit of hits) {
      const sticker = hit.object.userData && hit.object.userData.face ? hit.object : null;
      if (!sticker) continue;
      const info = FACELET_INFO.find((f) => f.slot === sticker.userData.cubieSlot && f.face === sticker.userData.face);
      if (info) return { facelet: info.index, face: info.face, slot: info.slot };
    }
    return null;
  }

  /* ------------------------------ public API ------------------------------ */

  /** Repaint every sticker from a 54-character state. */
  setState(facelets) {
    this.facelets = facelets;
    for (const info of FACELET_INFO) {
      const letter = facelets[info.index];
      const sticker = this.cubies[info.slot].userData.stickers[info.face];
      if (!sticker) continue;
      const colour = COLOR_OF_LETTER[letter];
      sticker.material.color.set(colour ? colour.hex : '#3a3a3a');
      sticker.userData.letter.setLetter(colour ? colour.swatchLetter : '');
      sticker.userData.letter.visible = this.showLetters;
    }
  }

  /**
   * Apply one move, given either as notation ("R", "R'", "R2" or an object
   * {face, sign, power}). The model is updated immediately; the animation
   * catches up afterwards, so the two can never disagree.
   */
  applyMove(move, { animate = true } = {}) {
    const parsed = typeof move === 'string' ? parseMove(move) : move;
    const sign = parsed.sign === undefined ? 1 : parsed.sign;
    const power = parsed.power === undefined ? 1 : parsed.power;
    const instant = !animate || this._reducedMotion();

    for (let i = 0; i < power; i++) {
      this.facelets = applyQuarterTurn(this.facelets, parsed.face, sign);
      if (!instant) this.queue.push({ face: parsed.face, sign, duration: this.turnDuration });
    }
    if (instant) this.setState(this.facelets);
    else if (!this.animating) this._startNext();
  }

  /** Queue a whole notation string ("R U R'"). */
  applyMoves(moves) {
    for (const mv of moves) this.applyMove(mv);
  }

  /** True while a turn animation is playing or queued. */
  get busy() {
    return !!this.animating || this.queue.length > 0;
  }

  /** Speed multiplier for the playback controls (1 = normal). */
  setSpeed(multiplier) {
    this.turnDuration = Math.round(260 / Math.max(0.15, multiplier));
  }

  setAutoRotate(on) {
    this.autoRotate = !!on;
  }

  setShowLetters(on) {
    this.showLetters = !!on;
    for (const cubie of this.cubies) {
      for (const face of Object.keys(cubie.userData.stickers)) {
        cubie.userData.stickers[face].userData.letter.visible = this.showLetters;
      }
    }
  }

  /** Highlight the given facelet indices with a pulsing white outline. */
  setHighlight(faceletIndices) {
    this.highlight = new Set(faceletIndices || []);
    this.outlines.forEach((mesh, i) => {
      const on = this.highlight.has(i);
      mesh.visible = on;
      if (!on) mesh.material.opacity = 0;
    });
  }

  /** Show an arrow on one face, used to point at the face being turned. */
  showFaceIndicator(face) {
    if (this.indicator) { this.root.remove(this.indicator); this.indicator = null; }
    if (!face || !AXIS[face]) return;
    const group = new THREE.Group();
    const colour = 0xffffff;
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.34, 0.7, 20),
      new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.85 })
    );
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.55, 0.045, 12, 40),
      new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.5 })
    );
    group.add(cone);
    group.add(ring);
    const normal = AXIS[face];
    group.position.copy(normal).multiplyScalar(2.5);
    orientToNormal(group, normal);
    cone.rotation.x = -Math.PI / 2;   // point the cone along the face normal
    group.userData.ring = ring;
    this.indicator = group;
    this.root.add(group);
  }

  /** Reset the camera to the three-quarter starting view. */
  resetView() {
    this.camera.position.set(4.6, 4.2, 6.2);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  resize() {
    const parent = this.canvas.parentElement;
    const w = Math.max(1, (parent ? parent.clientWidth : this.canvas.clientWidth) || 1);
    const h = Math.max(1, (parent ? parent.clientHeight : this.canvas.clientHeight) || 1);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Render one frame. Call from a requestAnimationFrame loop. */
  render(now) {
    this.controls.update();
    this._stepAnimation(now);

    // Idle spin: only when the user has not touched anything for a moment and
    // nothing is animating.
    if (this.autoRotate && !this.userInteracting && !this.animating && !this._reducedMotion()) {
      const since = now - (this._lastInteraction || 0);
      if (since > 1800) this.root.rotation.y += 0.0016;
    }

    // Pulse the validation highlight.
    if (this.highlight.size) {
      const pulse = 0.45 + 0.35 * Math.sin(now / 260);
      this.outlines.forEach((mesh, i) => {
        if (this.highlight.has(i)) mesh.material.opacity = pulse;
      });
    }
    if (this.indicator) {
      this.indicator.userData.ring.rotation.z += 0.02;
      this.indicator.children[0].position.z = Math.sin(now / 300) * 0.06;
    }

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this._resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
  }

  /* --------------------------- turn animation --------------------------- */

  _reducedMotion() {
    return this.options.preferReducedMotion ? this.options.preferReducedMotion() : false;
  }

  _startNext() {
    const next = this.queue.shift();
    if (!next) { this.animating = null; return; }

    const axis = AXIS[next.face];
    const layer = next.face === 'U' || next.face === 'D' ? 'y'
      : next.face === 'R' || next.face === 'L' ? 'x' : 'z';
    const sign = next.face === 'U' || next.face === 'R' || next.face === 'F' ? 1 : -1;
    // A clockwise turn (as seen from outside) is -90° about the outward normal.
    const target = -Math.PI / 2 * next.sign * sign;

    // Move the nine cubies of this layer into the pivot.
    const members = [];
    for (const cubie of this.cubies) {
      const v = cubie.position;
      if (Math.round(v[layer]) === sign) {
        members.push(cubie);
        this.pivot.attach(cubie);
      }
    }
    this.pivot.rotation.set(0, 0, 0);
    this.animating = {
      axis, layer, target, members, start: null, duration: next.duration, from: 0,
    };
  }

  _stepAnimation(now) {
    const anim = this.animating;
    if (!anim) return;
    if (anim.start === null) anim.start = now;
    const t = Math.min(1, (now - anim.start) / anim.duration);
    const eased = easeInOutCubic(t);
    this.pivot.setRotationFromAxisAngle(anim.axis, anim.target * eased);

    if (t >= 1) {
      // Snap to the exact angle and hand the cubies back, then round their
      // transforms so thousands of turns cannot accumulate float error.
      this.pivot.setRotationFromAxisAngle(anim.axis, anim.target);
      this.pivot.updateMatrixWorld(true);
      for (const cubie of anim.members) {
        this.cubieGroup.attach(cubie);
        cubie.position.set(
          Math.round(cubie.position.x),
          Math.round(cubie.position.y),
          Math.round(cubie.position.z)
        );
        snapQuaternion(cubie.quaternion);
      }
      this.pivot.rotation.set(0, 0, 0);
      this.animating = null;
      this.setState(this.facelets);
      this._startNext();
    }
  }
}

/* ------------------------------------------------------------------ *
 * Geometry helpers
 * ------------------------------------------------------------------ */

/** A box with rounded edges, built from a lathe-free approach: use a sphere-ish
 *  corner by scaling a rounded extrusion. We approximate with a chamfered box
 *  made from a Box plus edge fillets via ExtrudeGeometry with a rounded shape. */
function roundedBoxGeometry(size, radius, segments = 3) {
  const shape = roundedSquareShape(size - radius * 2, radius, segments);
  const depth = size - radius * 2;
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: radius,
    bevelSize: radius,
    bevelSegments: segments,
    curveSegments: segments * 2,
  });
  geometry.translate(0, 0, -depth / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function roundedSquareShape(size, radius, segments) {
  const shape = new THREE.Shape();
  const h = size / 2;
  shape.moveTo(-h + radius, -h);
  shape.lineTo(h - radius, -h);
  shape.quadraticCurveTo(h, -h, h, -h + radius);
  shape.lineTo(h, h - radius);
  shape.quadraticCurveTo(h, h, h - radius, h);
  shape.lineTo(-h + radius, h);
  shape.quadraticCurveTo(-h, h, -h, h - radius);
  shape.lineTo(-h, -h + radius);
  shape.quadraticCurveTo(-h, -h, -h + radius, -h);
  void segments;
  return shape;
}

function roundedPlaneGeometry(size, radius) {
  const shape = roundedSquareShape(size, radius, 3);
  return new THREE.ShapeGeometry(shape, 6);
}

/** Rotate an object so its +Z axis points along `normal`. */
function orientToNormal(object, normal) {
  const target = new THREE.Vector3(0, 0, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(target, normal.clone().normalize());
  object.quaternion.copy(q);
}

/** Snap a quaternion to the nearest 90° orientation. */
function snapQuaternion(q) {
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  const snap = (v) => Math.round(v / (Math.PI / 2)) * (Math.PI / 2);
  e.set(snap(e.x), snap(e.y), snap(e.z));
  q.setFromEuler(e);
}

/** A small text label drawn on a sticker, for colour-blind users. */
function makeLetterSprite(text) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.9 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), material);
  mesh.setLetter = (letter) => {
    ctx.clearRect(0, 0, 64, 64);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.font = 'bold 40px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter || '', 32, 34);
    texture.needsUpdate = true;
  };
  mesh.setLetter(text);
  return mesh;
}

/** Smooth acceleration and deceleration. */
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
