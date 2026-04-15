import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateRandomDungeon } from '../lib/logic.js';

test('generateRandomDungeon: returns walls array for a 30x20 map with seed', () => {
  const out = generateRandomDungeon(30, 20, 12345);
  assert.ok(out && Array.isArray(out.walls), 'returns { walls: [] }');
  assert.ok(out.walls.length > 0, 'has at least one wall');
});

test('generateRandomDungeon: all walls have valid cx/cy/side within bounds', () => {
  const W = 30, H = 20;
  const { walls } = generateRandomDungeon(W, H, 7);
  for (const w of walls) {
    assert.ok(Number.isInteger(w.cx), `cx integer: ${w.cx}`);
    assert.ok(Number.isInteger(w.cy), `cy integer: ${w.cy}`);
    assert.ok(w.side === 'n' || w.side === 'w', `side n|w: ${w.side}`);
    assert.ok(w.cx >= 0 && w.cx <= W, `cx in [0..W]: ${w.cx}`);
    assert.ok(w.cy >= 0 && w.cy <= H, `cy in [0..H]: ${w.cy}`);
    assert.ok(w.kind === 'wall' || w.kind === 'door', `kind: ${w.kind}`);
  }
});

test('generateRandomDungeon: same seed -> same output (deterministic)', () => {
  const a = generateRandomDungeon(30, 20, 42);
  const b = generateRandomDungeon(30, 20, 42);
  assert.strictEqual(a.walls.length, b.walls.length);
  for (let i = 0; i < a.walls.length; i++) {
    assert.deepStrictEqual(a.walls[i], b.walls[i]);
  }
});

test('generateRandomDungeon: different seeds -> different output', () => {
  const a = generateRandomDungeon(30, 20, 1);
  const b = generateRandomDungeon(30, 20, 9999);
  // Either lengths differ, or at least one wall differs.
  let differ = a.walls.length !== b.walls.length;
  if (!differ) {
    for (let i = 0; i < a.walls.length; i++) {
      const x = a.walls[i], y = b.walls[i];
      if (x.cx !== y.cx || x.cy !== y.cy || x.side !== y.side || x.kind !== y.kind) {
        differ = true; break;
      }
    }
  }
  assert.ok(differ, 'expected different seeds to produce different dungeons');
});

test('generateRandomDungeon: 10x10 produces at least one room and one door', () => {
  // Try a couple of seeds — small maps occasionally lack room-corridor crossings,
  // but at this size the algorithm reliably places rooms and doors.
  let foundDoor = false;
  let foundWalls = false;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const { walls } = generateRandomDungeon(10, 10, seed);
    if (walls.length > 0) foundWalls = true;
    if (walls.some(w => w.kind === 'door')) { foundDoor = true; break; }
  }
  assert.ok(foundWalls, 'expected at least one room/wall on a 10x10 map');
  assert.ok(foundDoor, 'expected at least one door across small-map seeds');
});

test('generateRandomDungeon: every wall fits within map (cx<=W, cy<=H)', () => {
  const W = 30, H = 20;
  const { walls } = generateRandomDungeon(W, H, 314159);
  for (const w of walls) {
    assert.ok(w.cx <= W, `cx ${w.cx} <= W ${W}`);
    assert.ok(w.cy <= H, `cy ${w.cy} <= H ${H}`);
    assert.ok(w.cx >= 0 && w.cy >= 0, `non-negative coords`);
  }
});
