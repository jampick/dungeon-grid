import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getRaces,
  defaultMoveForRace,
  walkWithRange,
  pathCost,
} from '../lib/logic.js';

function mkWalls(entries = []) {
  const m = new Map();
  for (const [k, v] of entries) m.set(k, v);
  return m;
}
const empty = mkWalls();

// --- race catalog --------------------------------------------------------

test('getRaces(1e) returns 7 entries with valid shape', () => {
  const r = getRaces('1e');
  assert.equal(r.length, 7);
  for (const x of r) {
    assert.equal(typeof x.id, 'string');
    assert.equal(typeof x.name, 'string');
    assert.equal(typeof x.move, 'number');
    assert.ok(x.move > 0);
  }
});

test('getRaces(5e) returns at least 7 entries with move >= 5', () => {
  const r = getRaces('5e');
  assert.ok(r.length >= 7);
  for (const x of r) assert.ok(x.move >= 5);
});

test('defaultMoveForRace(1e, human) is 12', () => {
  assert.equal(defaultMoveForRace('1e', 'human'), 12);
});

test('defaultMoveForRace(5e, dwarf) is 5', () => {
  assert.equal(defaultMoveForRace('5e', 'dwarf'), 5);
});

test('defaultMoveForRace(unknown ruleset, human) falls back to 1e value', () => {
  assert.equal(defaultMoveForRace('made-up-ruleset', 'human'), 12);
});

test('defaultMoveForRace(1e, nonexistent) returns default 6', () => {
  assert.equal(defaultMoveForRace('1e', 'nonexistent'), 6);
});

// --- walkWithRange -------------------------------------------------------

test('walkWithRange caps at budget when target is farther', () => {
  const r = walkWithRange(5, 5, 10, 5, empty, 3);
  assert.equal(r.x, 8);
  assert.equal(r.y, 5);
  assert.equal(r.cost, 3);
});

test('walkWithRange reaches target when budget exceeds distance', () => {
  const r = walkWithRange(5, 5, 10, 5, empty, 10);
  assert.equal(r.x, 10);
  assert.equal(r.y, 5);
  assert.equal(r.cost, 5);
});

test('walkWithRange stops before a wall on the path', () => {
  // wall on west edge of (8,5) blocks the (7,5)->(8,5) east step
  const ws = mkWalls([['8,5,w', { kind: 'wall', open: 0 }]]);
  const r = walkWithRange(5, 5, 10, 5, ws, 10);
  assert.equal(r.x, 7);
  assert.equal(r.y, 5);
  assert.ok(r.cost < 5);
});

// --- pathCost ------------------------------------------------------------

test('pathCost: open field cost equals Chebyshev distance', () => {
  assert.equal(pathCost(5, 5, 8, 5, empty, 10), 3);
});

test('pathCost: detour cost > direct OR Infinity if budget too small', () => {
  // wall blocking the direct east step from (5,5) -> (6,5)
  const ws = mkWalls([['6,5,w', { kind: 'wall', open: 0 }]]);
  const direct = 3;
  const c = pathCost(5, 5, 8, 5, ws, 10);
  // either a detour (cost > direct) or unreachable within budget
  assert.ok(c > direct || c === Infinity);
});

test('pathCost: unreachable within tight budget is Infinity', () => {
  assert.equal(pathCost(0, 0, 20, 20, empty, 5), Infinity);
});
