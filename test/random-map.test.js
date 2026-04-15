import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateRandomDungeon, ROOM_THEMES } from '../lib/logic.js';

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

// Regression: every room's perimeter must be fully enclosed by walls or
// doors. The previous floor-edge-delta algorithm dropped wall segments
// where corridors brushed along a room's outer edge, leaving L-shaped
// gaps. The fix walks each room's boundary and asserts every edge.
test('generateRandomDungeon: every room perimeter edge is a wall or door', () => {
  const seeds = [42, 1234, 7777, 314159, 271828];
  for (const seed of seeds) {
    const { walls, rooms } = generateRandomDungeon(30, 20, seed);
    assert.ok(Array.isArray(rooms) && rooms.length > 0, `seed ${seed}: rooms returned`);
    const wallSet = new Map(walls.map(w => [`${w.cx},${w.cy},${w.side}`, w]));
    for (const r of rooms) {
      const checks = [];
      for (let x = r.x; x < r.x + r.w; x++) {
        checks.push([`${x},${r.y},n`, 'top']);
        checks.push([`${x},${r.y + r.h},n`, 'bottom']);
      }
      for (let y = r.y; y < r.y + r.h; y++) {
        checks.push([`${r.x},${y},w`, 'left']);
        checks.push([`${r.x + r.w},${y},w`, 'right']);
      }
      for (const [key, where] of checks) {
        const e = wallSet.get(key);
        assert.ok(e, `seed ${seed}: missing ${where} edge ${key} for room ${JSON.stringify(r)}`);
        assert.ok(e.kind === 'wall' || e.kind === 'door',
          `seed ${seed}: bad kind at ${key}: ${e.kind}`);
      }
    }
  }
});

test('generateRandomDungeon: returns rooms and furniture arrays', () => {
  const out = generateRandomDungeon(30, 20, 12345);
  assert.ok(Array.isArray(out.rooms), 'has rooms[]');
  assert.ok(Array.isArray(out.furniture), 'has furniture[]');
  // At seed 12345 on 30x20, we reliably get >=1 themed room with furniture.
  let furnishedRoomCount = 0;
  for (const r of out.rooms) {
    const inRoom = out.furniture.filter(f =>
      f.cx >= r.x && f.cx < r.x + r.w && f.cy >= r.y && f.cy < r.y + r.h);
    if (inRoom.length > 0) furnishedRoomCount++;
  }
  assert.ok(furnishedRoomCount > 0, 'at least one room has furniture');
  // Every furniture item must lie inside *some* room interior.
  for (const f of out.furniture) {
    const host = out.rooms.find(r =>
      f.cx >= r.x && f.cx < r.x + r.w && f.cy >= r.y && f.cy < r.y + r.h);
    assert.ok(host, `furniture at (${f.cx},${f.cy}) is inside a room`);
  }
});

test('generateRandomDungeon: themed rooms contain only theme-appropriate objects', () => {
  // Try several seeds until we hit a barracks room. With a 30x20 map and
  // 9 themes, a barracks shows up well within the seed budget.
  const allowedByTheme = {
    barracks: new Set(['bed', 'weapon_rack']),
    storage:  new Set(['crate', 'barrel']),
    dining:   new Set(['table', 'chair']),
    library:  new Set(['bookshelf', 'desk']),
    smithy:   new Set(['anvil', 'firepit', 'weapon_rack']),
    treasure: new Set(['chest', 'statue']),
    throne:   new Set(['throne', 'statue']),
    shrine:   new Set(['altar', 'statue']),
    empty:    new Set(),
  };
  let sawBarracksWithBed = false;
  for (let seed = 1; seed <= 50 && !sawBarracksWithBed; seed++) {
    const { rooms, furniture } = generateRandomDungeon(30, 20, seed);
    for (const r of rooms) {
      const inRoom = furniture.filter(f =>
        f.cx >= r.x && f.cx < r.x + r.w && f.cy >= r.y && f.cy < r.y + r.h);
      const allowed = allowedByTheme[r.theme];
      assert.ok(allowed, `unknown theme ${r.theme}`);
      for (const f of inRoom) {
        assert.ok(allowed.has(f.preset),
          `seed ${seed}: ${r.theme} room contains forbidden ${f.preset}`);
      }
      if (r.theme === 'barracks' && inRoom.some(f => f.preset === 'bed')) {
        sawBarracksWithBed = true;
      }
    }
  }
  assert.ok(sawBarracksWithBed, 'expected at least one barracks-with-bed across seeds 1..50');
});

test('ROOM_THEMES exposes the 9 expected themes', () => {
  assert.deepStrictEqual(ROOM_THEMES.length, 9);
  for (const t of ['barracks','storage','dining','library','smithy','treasure','throne','shrine','empty']) {
    assert.ok(ROOM_THEMES.includes(t), `missing theme ${t}`);
  }
});
