import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isBlocked,
  bresenhamLine,
  walkUntilBlocked,
  isReachable,
} from '../lib/logic.js';

// Helper to build a walls Map in the same shape the client/server use.
function mkWalls(entries = []) {
  const m = new Map();
  for (const [key, val] of entries) m.set(key, val);
  return m;
}

// --- isBlocked -----------------------------------------------------------

test('isBlocked: wall between (5,5) and (5,4) blocks north movement', () => {
  // The north edge of (5,5) is keyed "5,5,n" and separates (5,5) from (5,4).
  const ws = mkWalls([['5,5,n', { kind: 'wall', open: 0 }]]);
  assert.equal(isBlocked(ws, 5, 5, 5, 4), true);
  // reverse direction (moving south across the same edge) also blocks
  assert.equal(isBlocked(ws, 5, 4, 5, 5), true);
  // stepping east from (5,5) is unaffected
  assert.equal(isBlocked(ws, 5, 5, 6, 5), false);
});

test('isBlocked: closed door blocks, open door does not', () => {
  const closed = mkWalls([['5,5,n', { kind: 'door', open: 0 }]]);
  const open   = mkWalls([['5,5,n', { kind: 'door', open: 1 }]]);
  assert.equal(isBlocked(closed, 5, 5, 5, 4), true);
  assert.equal(isBlocked(open,   5, 5, 5, 4), false);
});

test('isBlocked: empty wallSet never blocks', () => {
  const ws = mkWalls();
  assert.equal(isBlocked(ws, 0, 0, 0, 1), false);
  assert.equal(isBlocked(ws, 3, 3, 4, 3), false);
});

// --- bresenhamLine -------------------------------------------------------

test('bresenhamLine: single point', () => {
  assert.deepEqual(bresenhamLine(4, 7, 4, 7), [[4, 7]]);
});

test('bresenhamLine: straight horizontal', () => {
  assert.deepEqual(bresenhamLine(2, 3, 5, 3), [[2,3],[3,3],[4,3],[5,3]]);
});

test('bresenhamLine: straight vertical (descending)', () => {
  assert.deepEqual(bresenhamLine(7, 5, 7, 2), [[7,5],[7,4],[7,3],[7,2]]);
});

test('bresenhamLine: pure 45-degree diagonal', () => {
  assert.deepEqual(bresenhamLine(0, 0, 3, 3), [[0,0],[1,1],[2,2],[3,3]]);
});

test('bresenhamLine: skewed line has the right length and endpoints', () => {
  const line = bresenhamLine(0, 0, 6, 2);
  assert.equal(line[0][0], 0);
  assert.equal(line[0][1], 0);
  assert.equal(line[line.length - 1][0], 6);
  assert.equal(line[line.length - 1][1], 2);
  // Bresenham for a 6x2 line produces 7 cells (max of |dx|, |dy| + 1).
  assert.equal(line.length, 7);
  // Monotonic along the dominant (x) axis
  for (let i = 1; i < line.length; i++) {
    assert.ok(line[i][0] >= line[i-1][0], 'x should not decrease');
  }
});

// --- walkUntilBlocked ----------------------------------------------------

test('walkUntilBlocked: open path returns the target cell', () => {
  const ws = mkWalls();
  const r = walkUntilBlocked(0, 0, 5, 0, ws);
  assert.deepEqual(r, { x: 5, y: 0 });
});

test('walkUntilBlocked: wall midway stops at the cell before the wall', () => {
  // Walking east from (0,5) toward (5,5); put a wall on the west edge of
  // (3,5) so the (2,5)->(3,5) step is blocked. Expected stop: (2,5).
  const ws = mkWalls([['3,5,w', { kind: 'wall', open: 0 }]]);
  const r = walkUntilBlocked(0, 5, 5, 5, ws);
  assert.deepEqual(r, { x: 2, y: 5 });
});

test('walkUntilBlocked: closed door stops the walker, open door does not', () => {
  const closed = mkWalls([['3,5,w', { kind: 'door', open: 0 }]]);
  const open   = mkWalls([['3,5,w', { kind: 'door', open: 1 }]]);
  assert.deepEqual(walkUntilBlocked(0, 5, 5, 5, closed), { x: 2, y: 5 });
  assert.deepEqual(walkUntilBlocked(0, 5, 5, 5, open),   { x: 5, y: 5 });
});

test('walkUntilBlocked: no movement when origin equals target', () => {
  const ws = mkWalls();
  assert.deepEqual(walkUntilBlocked(4, 4, 4, 4, ws), { x: 4, y: 4 });
});

test('walkUntilBlocked: diagonal through a wall corner is blocked', () => {
  // Walking NE from (5,5) to (6,4). Put a wall on the north edge of (5,5)
  // (blocks the (5,5)->(5,4) ortho step on one side of the diagonal). The
  // "both orthogonals open" rule should block the diagonal.
  const ws = mkWalls([['5,5,n', { kind: 'wall', open: 0 }]]);
  const r = walkUntilBlocked(5, 5, 6, 4, ws);
  assert.deepEqual(r, { x: 5, y: 5 });
});

// --- isReachable ---------------------------------------------------------

const smallMap = { width: 20, height: 20 };

test('isReachable: two cells in the same empty room -> true', () => {
  assert.equal(isReachable(2, 2, 8, 5, smallMap, mkWalls()), true);
});

test('isReachable: separated by a continuous wall -> false', () => {
  // Seal column x=5 by walling the west edge of every cell at x=5 and also
  // the west edge of the column at x=6? Actually a west-edge wall on column
  // x=5 separates x<5 from x>=5. We only need one straight line of walls.
  const ws = mkWalls();
  for (let y = 0; y < 20; y++) ws.set(`5,${y},w`, { kind: 'wall', open: 0 });
  // Also block diagonal leaks: a vertical wall of west-edges along x=5 does
  // NOT by itself block a NE diagonal from (4,y) to (5,y-1) through the
  // (5,y-1)-column, because that diagonal must cross the x=5 west edge on
  // one of its orthogonal sub-steps — which is blocked. Good.
  assert.equal(isReachable(2, 10, 8, 10, smallMap, ws), false);
});

test('isReachable: wall with an open door is traversable', () => {
  const ws = mkWalls();
  for (let y = 0; y < 20; y++) ws.set(`5,${y},w`, { kind: 'wall', open: 0 });
  // Replace one wall with an open door
  ws.set('5,10,w', { kind: 'door', open: 1 });
  assert.equal(isReachable(2, 10, 8, 10, smallMap, ws), true);
});

test('isReachable: destination outside the map -> false', () => {
  assert.equal(isReachable(2, 2, -1, 2, smallMap, mkWalls()), false);
  assert.equal(isReachable(2, 2, 99, 2, smallMap, mkWalls()), false);
});

test('isReachable: same cell -> true even inside a sealed room', () => {
  // A fully sealed 1x1 box around (10,10).
  const ws = mkWalls([
    ['10,10,n', { kind: 'wall', open: 0 }],
    ['10,11,n', { kind: 'wall', open: 0 }],
    ['10,10,w', { kind: 'wall', open: 0 }],
    ['11,10,w', { kind: 'wall', open: 0 }],
  ]);
  assert.equal(isReachable(10, 10, 10, 10, smallMap, ws), true);
  // And can't escape to an adjacent cell.
  assert.equal(isReachable(10, 10, 10, 9, smallMap, ws), false);
});

test('isReachable: respects maxDist cap', () => {
  // Far destination with plenty of open space — maxDist=3 should fail.
  assert.equal(isReachable(0, 0, 15, 15, smallMap, mkWalls(), 3), false);
  // Generous cap succeeds.
  assert.equal(isReachable(0, 0, 15, 15, smallMap, mkWalls(), 100), true);
});
