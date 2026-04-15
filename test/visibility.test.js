import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRevealed } from '../lib/logic.js';

const map = { width: 20, height: 20 };

function torchAt(x, y, facing = 0) {
  return { x, y, light_type: 'torch', light_radius: 0, facing };
}

test('empty map, torch at (10,10): all revealed cells within euclidean radius', () => {
  const revealed = computeRevealed(torchAt(10, 10), map, new Map());
  assert.ok(revealed.length > 0);
  for (const key of revealed) {
    const [x, y] = key.split(',').map(Number);
    const dist = Math.hypot(x - 10, y - 10);
    assert.ok(dist <= 3.01, `cell ${key} at dist ${dist} outside radius`);
  }
});

function enclosed3x3Walls(cx, cy) {
  // Walls around the 3x3 room centered on (cx,cy): cells [cx-1..cx+1, cy-1..cy+1]
  const ws = new Map();
  const put = (k, v) => ws.set(k, v);
  for (let x = cx - 1; x <= cx + 1; x++) {
    put(`${x},${cy - 1},n`, { kind: 'wall', open: 0 }); // top
    put(`${x},${cy + 2},n`, { kind: 'wall', open: 0 }); // bottom
  }
  for (let y = cy - 1; y <= cy + 1; y++) {
    put(`${cx - 1},${y},w`, { kind: 'wall', open: 0 }); // left
    put(`${cx + 2},${y},w`, { kind: 'wall', open: 0 }); // right
  }
  return ws;
}

test('enclosed 3x3 room: exactly 9 cells revealed', () => {
  const ws = enclosed3x3Walls(10, 10);
  const revealed = computeRevealed(torchAt(10, 10), map, ws);
  assert.equal(revealed.length, 9);
  const set = new Set(revealed);
  for (let x = 9; x <= 11; x++) {
    for (let y = 9; y <= 11; y++) {
      assert.ok(set.has(`${x},${y}`), `missing cell ${x},${y}`);
    }
  }
});

test('open door in the 3x3 room lets light through', () => {
  const ws = enclosed3x3Walls(10, 10);
  // Replace north wall of (10,9) with an open door
  ws.set('10,9,n', { kind: 'door', open: 1 });
  const revealed = computeRevealed(torchAt(10, 10), map, ws);
  assert.ok(revealed.length > 9, `expected >9 cells, got ${revealed.length}`);
});

test('closed door blocks light like a wall', () => {
  const ws = enclosed3x3Walls(10, 10);
  // Replace same wall with a CLOSED door
  ws.set('10,9,n', { kind: 'door', open: 0 });
  const revealed = computeRevealed(torchAt(10, 10), map, ws);
  assert.equal(revealed.length, 9);
});

test('open-room torch: diagonal cells are lit, not a cross shape', () => {
  // Regression: a user reported a cross-shaped torch (only cardinals lit,
  // diagonals dark) in an open room with no walls. The BFS must produce a
  // roughly circular shape so that (11,11), (12,12), etc. are included and
  // cells just outside the Euclidean radius are not.
  const revealed = computeRevealed(torchAt(10, 10), map, new Map());
  const set = new Set(revealed);

  // Immediate diagonal neighbors (dist = sqrt(2) ~ 1.41) must be lit.
  assert.ok(set.has('11,11'), '(11,11) should be lit');
  assert.ok(set.has('9,9'),   '(9,9) should be lit');
  assert.ok(set.has('11,9'),  '(11,9) should be lit');
  assert.ok(set.has('9,11'),  '(9,11) should be lit');

  // Further diagonal (dist = sqrt(8) ~ 2.83, within radius 3) must be lit.
  assert.ok(set.has('12,12'), '(12,12) should be lit');

  // Just outside the radius (dist = sqrt(10) ~ 3.16) must NOT be lit.
  assert.ok(!set.has('13,11'), '(13,11) is outside radius 3 and must be dark');
  assert.ok(!set.has('11,13'), '(11,13) is outside radius 3 and must be dark');

  // Shape must not be a pure cross — count the diagonal (non-axis) lit cells.
  let diagonalCount = 0;
  for (const k of set) {
    const [x, y] = k.split(',').map(Number);
    if (x !== 10 && y !== 10) diagonalCount++;
  }
  assert.ok(diagonalCount >= 12,
    `expected a filled disc with many diagonals, got ${diagonalCount}`);
});

test('bullseye facing east lights cells east but nothing due west', () => {
  const tok = { x: 10, y: 10, light_type: 'bullseye', light_radius: 0, facing: 2 }; // facing E
  const revealed = computeRevealed(tok, map, new Map());
  const set = new Set(revealed);
  // At least one cell due east
  let anyEast = false;
  for (let x = 11; x <= 15; x++) if (set.has(`${x},10`)) { anyEast = true; break; }
  assert.ok(anyEast, 'expected at least one lit cell due east');
  // Zero cells due west (same row, x < tokenX)
  for (let x = 0; x < 10; x++) {
    assert.ok(!set.has(`${x},10`), `unexpected lit cell due west at ${x},10`);
  }
});
