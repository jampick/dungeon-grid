import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasLineOfSight } from '../lib/logic.js';

// Line-of-sight helper used for effect-token visibility: spell AOEs
// (fireball, cone of cold, lightning bolt) are bright magical events, so a
// player sees them if ANY party token has an unblocked straight line to the
// effect origin — even if the viewer's own cell is dark. Walls and closed
// doors block; open doors don't.

// wallSet is a Map keyed "cx,cy,side" -> { kind, open } where side is
// 'n' (north edge of cell cx,cy) or 'w' (west edge of cell cx,cy).
function makeWalls(entries = []) {
  const m = new Map();
  for (const [cx, cy, side, kind = 'wall', open = false] of entries) {
    m.set(`${cx},${cy},${side}`, { kind, open });
  }
  return m;
}

test('hasLineOfSight: straight horizontal line with no walls', () => {
  const walls = makeWalls();
  assert.equal(hasLineOfSight(5, 5, 10, 5, walls), true);
});

test('hasLineOfSight: horizontal line blocked by a wall at the midpoint', () => {
  // West edge of cell (8,5) separates (7,5) from (8,5).
  const walls = makeWalls([[8, 5, 'w']]);
  assert.equal(hasLineOfSight(5, 5, 10, 5, walls), false);
});

test('hasLineOfSight: same cell is always visible', () => {
  const walls = makeWalls();
  assert.equal(hasLineOfSight(5, 5, 5, 5, walls), true);
});

test('hasLineOfSight: diagonal LOS across open space', () => {
  const walls = makeWalls();
  assert.equal(hasLineOfSight(5, 5, 10, 10, walls), true);
});

test('hasLineOfSight: diagonal LOS blocked by a corner wall', () => {
  // Surround cell (6,6) on its north and west edges so a diagonal step
  // from (5,5) into (6,6) has both orthogonal sub-paths blocked.
  const walls = makeWalls([
    [6, 6, 'n'],
    [6, 6, 'w'],
    [6, 5, 'w'],
    [5, 6, 'n'],
  ]);
  assert.equal(hasLineOfSight(5, 5, 10, 10, walls), false);
});

test('hasLineOfSight: closed door blocks, open door does not', () => {
  const closed = makeWalls([[8, 5, 'w', 'door', false]]);
  assert.equal(hasLineOfSight(5, 5, 10, 5, closed), false);
  const open = makeWalls([[8, 5, 'w', 'door', true]]);
  assert.equal(hasLineOfSight(5, 5, 10, 5, open), true);
});
