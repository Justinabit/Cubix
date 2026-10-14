/**
 * ll-lab.mjs — the lab that produced the beginner method's algorithms.
 *
 * Nothing in js/solver/beginner.js was copied from memory. This file builds
 * canonical situations with the verified move engine and asks it, by search,
 * what actually works. It also proves two things the solver depends on:
 *
 *   1. the x2 rotation and its move renaming are right (a wrong prime here gives
 *      a solution that looks correct and leaves the cube scrambled);
 *   2. the last-layer generator set spans everything it needs to — in
 *      particular that the "pure corner twisters" reach all 27 corner
 *      orientation states.
 *
 * Run: node tools/ll-lab.mjs [section]     (section: rename | algs | coverage)
 */
import {
  SOLVED_FACELETS, FACE_NAMES, applyMove, applyMoveSequence, tokenizeMoves,
} from '../js/core/cube-model.js';
import {
  x2, renameMoves, RENAME_X2, SLOTS, slotSolved, slotHasRightPiece, findPiece, center, at,
} from '../js/core/cube-ops.js';

const ALL = tokenizeMoves("U U' U2 D D' D2 R R' R2 L L' L2 F F' F2 B B' B2");
const U_EDGES = ['UF', 'UR', 'UB', 'UL'];
const U_CORNERS = ['UFR', 'UBR', 'UBL', 'UFL'];
const F2L = ['DF', 'DR', 'DB', 'DL', 'DFR', 'DBR', 'DBL', 'DFL', 'FR', 'BR', 'BL', 'FL'];

const ok = (s, names) => names.every((n) => slotSolved(s, n));
const std = x2(SOLVED_FACELETS);

/* ══════════════════════ 1. rotation and renaming ══════════════════════ */

function checkRenaming() {
  // The defining property of the translation table:
  //     S . t(m)  ===  x2( x2(S) . m )   for every state S and move m.
  let s = SOLVED_FACELETS;
  for (const mv of ["R", "U", "F'", "D2", "L"]) s = applyMove(s, mv);
  let bad = 0;
  for (const m of ALL) {
    const expected = x2(applyMove(x2(s), m));
    if (applyMove(s, renameMoves([m])[0]) !== expected) {
      bad++;
      console.log(`   MISMATCH ${m} -> ${renameMoves([m])[0]}`);
    }
  }
  console.log(`   translation table: ${bad === 0 ? 'correct for all 18 moves' : bad + ' WRONG'}`);
  console.log('   table:', ALL.map((m) => `${m}->${renameMoves([m])[0]}`).join(' '));
  console.log(`   involution (so it converts both ways): ${ALL.every((m) => renameMoves(renameMoves([m]))[0] === m)}`);
  void FACE_NAMES;
}

/* ══════════════════════ 2. what does each algorithm do? ══════════════════════ */

const ALGORITHMS = {
  'OLL cross 1': "F R U R' U' F'",
  'OLL cross 2': "F U R U' R' F'",
  'Sune': "R U R' U R U2 R'",
  'Antisune': "R U2 R' U' R U' R'",
  'T-perm': "R U R' U' R' F R2 U' R' U' R U R' F'",
  'Y-perm': "F R U' R' U' R U R' F' R U R' U' R' F R F'",
  'Aa-perm': "R' F R' B2 R F' R' B2 R2",
  'Ab-perm': "R2 B2 R F R' B2 R F' R",
  'Ua-perm': "R U' R U R U R U' R' U' R2",
  'Ub-perm': "R2 U R U R' U' R' U' R' U R'",
  'H-perm': "R2 U2 R U2 R2 U2 R2 U2 R U2 R2",
  'Niklas': "R U' L' U R' U' L",
  'sexy move': "R U R' U'",
  'sledgehammer': "R' F R F'",
  "R' D' R D": "R' D' R D",
};

function characterise() {
  console.log('   algorithm            F2L safe?   effect on the last layer');
  for (const [name, notation] of Object.entries(ALGORITHMS)) {
    const moves = tokenizeMoves(notation);
    const after = applyMoveSequence(std, moves);
    const safe = ok(after, F2L);
    const edges = U_EDGES.filter((n) => slotSolved(after, n)).length;
    const cornersPlaced = U_CORNERS.filter((n) => slotHasRightPiece(after, n)).length;
    const u = center(after, 'U');
    const cornersOriented = U_CORNERS.filter((n) => {
      const st = SLOTS[n].stickers.find((x) => x.face === 'U');
      return at(after, 'U', st.row, st.col) === u;
    }).length;
    console.log(
      `   ${name.padEnd(20)} ${(safe ? 'yes' : 'NO').padEnd(11)} `
      + `edges ${edges}/4 solved, corners ${cornersPlaced}/4 placed, ${cornersOriented}/4 oriented`
    );
  }
}

/* ══════════════════════ 3. do the generators span what they must? ══════════════════════ */

const TWISTERS = [
  "R U R' U R U2 R' U' R U' R U R U R U' R' U' R2 U'",
  "R U2 R' U' R U' R' U R2 U R U R' U' R' U' R' U R' U",
  "R2 B2 R F R' B2 R F' R U' L' U R U' L U R'",
  "L' U R U' L U R' R2 B2 R F R' B2 R F' R U'",
  "R U' R U R U R U' R' U' R2 U' R U R' U R U2 R' U'",
  "R2 U R U R' U' R' U' R' U R' U R U2 R' U' R U' R' U",
];

function coverage() {
  // U^k T U^-k keeps every piece in place and moves only the twists around,
  // which is exactly what the final stage needs.
  const generators = [];
  for (const t of TWISTERS) {
    for (const setup of ['', 'U', "U'", 'U2']) {
      const inverse = { '': '', U: "U'", "U'": 'U', U2: 'U2' }[setup];
      generators.push(tokenizeMoves(`${setup} ${t} ${inverse}`.trim()));
    }
  }

  const keepsPlace = (s) => ok(s, F2L) && ok(s, U_EDGES) && U_CORNERS.every((n) => slotHasRightPiece(s, n));
  const good = generators.filter((g) => keepsPlace(applyMoveSequence(std, g)));
  console.log(`   ${good.length}/${generators.length} conjugated twisters preserve every piece position`);

  const key = (s) => U_CORNERS.map((n) => SLOTS[n].stickers.map((x) => at(s, x.face, x.row, x.col)).join('')).join('|');
  const seen = new Set([key(std)]);
  let frontier = [std];
  while (frontier.length) {
    const next = [];
    for (const s of frontier) {
      for (const g of good) {
        const t = applyMoveSequence(s, g);
        const k = key(t);
        if (!seen.has(k)) { seen.add(k); next.push(t); }
      }
    }
    frontier = next;
  }
  console.log(`   corner-orientation states reachable: ${seen.size} (27 means every case can be solved)`);
  console.log(seen.size === 27 ? '   OK — the final stage can always be finished.' : '   PROBLEM — the final stage can get stuck.');
}

/* ══════════════════════ 4. corner insertion cases ══════════════════════ */

function cornerInsertions() {
  const CROSS = ['DF', 'DR', 'DB', 'DL'];
  const search = (start, goal, maxDepth = 6, alpha = ALL) => {
    const path = [];
    for (let limit = 1; limit <= maxDepth; limit++) {
      const seen = new Set();
      path.length = 0;
      const dfs = (cur, depth, lastFace) => {
        if (goal(cur)) return true;
        if (depth === limit) return false;
        for (const mv of alpha) {
          if (mv[0] === lastFace) continue;
          const next = applyMove(cur, mv);
          const k = next + '#' + (limit - depth);
          if (seen.has(k)) continue;
          seen.add(k);
          path.push(mv);
          if (dfs(next, depth + 1, mv[0])) return true;
          path.pop();
        }
        return false;
      };
      if (dfs(start, 0, null)) return path.slice();
    }
    return null;
  };

  const white = center(std, 'D');
  console.log('   corner parked above its home (cross already solved):');
  const queue = [{ s: std, moves: [] }];
  const visited = new Set([std]);
  const found = new Map();
  while (queue.length && found.size < 3) {
    const { s, moves } = queue.shift();
    if (moves.length >= 5) continue;
    for (const mv of ALL) {
      const next = applyMove(s, mv);
      if (visited.has(next)) continue;
      visited.add(next);
      const m = moves.concat(mv);
      const parked = findPiece(next, 'DFR')[0] === 'UFR';
      if (ok(next, CROSS) && parked && !slotSolved(next, 'DFR')) {
        const pattern = SLOTS.UFR.stickers.map((st) => (at(next, st.face, st.row, st.col) === white ? 'W' : '-')).join('');
        if (!found.has(pattern)) {
          const solution = search(next, (x) => ok(x, CROSS) && slotSolved(x, 'DFR'), 6,
            tokenizeMoves("U U' U2 R R' R2 F F' F2 D D' D2"));
          found.set(pattern, solution ? solution.join(' ') : 'NOT FOUND');
          console.log(`     white on ${SLOTS.UFR.faces.join('')} = ${pattern}  ->  ${found.get(pattern)}`);
        }
      }
      queue.push({ s: next, moves: m });
    }
  }
}

/* ══════════════════════ main ══════════════════════ */

const section = process.argv[2] || 'all';
if (section === 'all' || section === 'rename') {
  console.log('=== 1. whole-cube rotation and move translation ===');
  checkRenaming();
}
if (section === 'all' || section === 'algs') {
  console.log('\n=== 2. what each last-layer algorithm actually does ===');
  characterise();
  console.log('\n=== 4. white corner insertion, discovered by search ===');
  cornerInsertions();
}
if (section === 'all' || section === 'coverage') {
  console.log('\n=== 3. does the final stage reach every corner orientation? ===');
  coverage();
}
