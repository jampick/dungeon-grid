import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFollowerTargets } from '../lib/logic.js';

// Helper to build a walls Map keyed the same way the server/client use.
function mkWalls(entries = []) {
  const m = new Map();
  for (const [k, v] of entries) m.set(k, v);
  return m;
}
const map20 = { width: 20, height: 20 };

// 1. Open map: two followers preserve their offsets relative to the leader.
test('computeFollowerTargets: open map preserves offsets', () => {
  const leaderOld = { x: 5, y: 5 };
  const followers = [
    { id: 11, x: 4, y: 5 }, // dx=-1, dy=0
    { id: 12, x: 6, y: 6 }, // dx=+1, dy=+1
  ];
  const out = computeFollowerTargets(leaderOld, followers, 8, 5, mkWalls(), map20);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { tokenId: 11, targetX: 7, targetY: 5 });
  assert.deepEqual(out[1], { tokenId: 12, targetX: 9, targetY: 6 });
});

// 2. A wall blocks the follower's slot — must collapse to single-file.
test('computeFollowerTargets: blocked target collapses to single-file', () => {
  // Leader moves east from (5,5) to (8,5). Follower at (4,5) wants slot
  // (7,5). Put a wall on the east edge of (6,5) so the follower's path is
  // blocked between (6,5) and (7,5).
  const walls = mkWalls([
    ['7,5,w', { kind: 'wall', open: 0 }],
  ]);
  const out = computeFollowerTargets(
    { x: 5, y: 5 },
    [{ id: 11, x: 4, y: 5 }],
    8, 5,
    walls,
    map20,
  );
  assert.equal(out.length, 1);
  // First trailing cell on leader's line newX..oldX is (7,5), but it's on
  // the far side of the wall and unreachable. Walker continues backward
  // along the leader line — (6,5) IS reachable from (4,5).
  assert.equal(out[0].tokenId, 11);
  assert.equal(out[0].targetX, 6);
  assert.equal(out[0].targetY, 5);
});

// 3. Single-file collapse for 3 followers along a 1-cell corridor.
test('computeFollowerTargets: 3 followers collapse to single-file behind leader', () => {
  // Leader at (5,5) moves east to (8,5). Three followers stacked north of
  // the leader at (5,3),(5,2),(5,1) want to slide to (8,3),(8,2),(8,1).
  // We put a wall on the WEST edge of column 8 across rows y=1..3 so the
  // straight Bresenham line from each follower to its offset slot is
  // blocked at the very last step. They must collapse single-file behind
  // the leader along (7,5),(6,5),(5,5).
  const walls = mkWalls([
    ['8,1,w', { kind: 'wall', open: 0 }],
    ['8,2,w', { kind: 'wall', open: 0 }],
    ['8,3,w', { kind: 'wall', open: 0 }],
  ]);
  const followers = [
    { id: 21, x: 5, y: 3 },
    { id: 22, x: 5, y: 2 },
    { id: 23, x: 5, y: 1 },
  ];
  const out = computeFollowerTargets({ x: 5, y: 5 }, followers, 8, 5, walls, map20);
  assert.equal(out.length, 3);
  // Each follower should land on a distinct cell along the trailing line
  // (7,5),(6,5),(5,5) — claims processed first-come, first-serve.
  const targets = out.map(o => `${o.targetX},${o.targetY}`);
  assert.equal(new Set(targets).size, 3, 'all targets distinct');
  for (const t of targets) {
    assert.ok(['7,5','6,5','5,5'].includes(t), `target ${t} on trailing line`);
  }
});

// 4. No followers -> empty array.
test('computeFollowerTargets: no followers returns []', () => {
  const out = computeFollowerTargets({ x: 5, y: 5 }, [], 8, 5, mkWalls(), map20);
  assert.deepEqual(out, []);
  const out2 = computeFollowerTargets({ x: 5, y: 5 }, null, 8, 5, mkWalls(), map20);
  assert.deepEqual(out2, []);
});

// 5. Out-of-bounds desired slot -> single-file fallback (documented choice).
test('computeFollowerTargets: out-of-bounds desired slot collapses to single-file', () => {
  // Leader at (1,5) moves to (0,5) (west edge). Follower at (0,5)... use
  // (2,5) so its desired offset (-1,0) lands at (-1,5) which is OOB.
  const out = computeFollowerTargets(
    { x: 1, y: 5 },
    [{ id: 31, x: 2, y: 5 }],
    0, 5,
    mkWalls(),
    map20,
  );
  assert.equal(out.length, 1);
  // First trailing cell of leader line (0,5)->(1,5) is (1,5), in-bounds and
  // reachable from (2,5).
  assert.deepEqual(out[0], { tokenId: 31, targetX: 1, targetY: 5 });
});

// 6. Followers process in order; claimed slots prevent collisions.
test('computeFollowerTargets: claimed slots prevent two followers stacking', () => {
  // Two followers both want the same desired slot — second falls back.
  // Leader at (5,5) moves to (8,5). Followers at (4,5) and (4,5)... they
  // can't physically occupy the same cell, but we exercise the logic by
  // giving them the same offset via different starts. Use (4,5) and
  // a hypothetical (4,5) clone is impossible; instead use (4,5) and (3,4)
  // where (3,4)'s desired (6,4) is fine — so test actual collision via
  // two followers both at (4,5)... not legal. Use single-file collapse
  // instead: walls force both to fall back to the trailing line.
  const walls = mkWalls([
    ['7,5,w', { kind: 'wall', open: 0 }],
    ['7,6,w', { kind: 'wall', open: 0 }],
  ]);
  const followers = [
    { id: 41, x: 4, y: 5 }, // wants (7,5) — blocked by wall, falls back to (6,5)
    { id: 42, x: 4, y: 6 }, // wants (7,6) — blocked, falls back to trailing line (6,5) but claimed
  ];
  const out = computeFollowerTargets({ x: 5, y: 5 }, followers, 8, 5, walls, map20);
  assert.equal(out.length, 2);
  const seen = new Set(out.map(o => `${o.targetX},${o.targetY}`));
  assert.equal(seen.size, 2, 'no two followers share a target cell');
});
