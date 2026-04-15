import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  addPartySelfVisibility,
  computeFog,
  recomputeFog,
  isBlocked,
} from '../lib/logic.js';

// --- Helpers ---------------------------------------------------------------

function makeMap(w = 20, h = 20) {
  return { id: 1, width: w, height: h, grid_size: 50 };
}

function wallSetFromRows(rows) {
  return new Map(rows.map(w => [`${w.cx},${w.cy},${w.side}`, w]));
}

function makeTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dgrid-pcself-'));
  const db = new Database(path.join(dir, 'grid.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE maps (
      id INTEGER PRIMARY KEY,
      campaign_id INTEGER,
      name TEXT,
      grid_type TEXT DEFAULT 'square',
      grid_size INTEGER DEFAULT 50,
      width INTEGER DEFAULT 30,
      height INTEGER DEFAULT 20,
      background TEXT,
      active INTEGER DEFAULT 0
    );
    CREATE TABLE tokens (
      id INTEGER PRIMARY KEY,
      map_id INTEGER,
      kind TEXT,
      name TEXT,
      image TEXT,
      x REAL, y REAL,
      hp_current INTEGER, hp_max INTEGER,
      ac INTEGER,
      light_radius INTEGER DEFAULT 0,
      light_type TEXT DEFAULT 'none',
      facing INTEGER DEFAULT 0,
      color TEXT DEFAULT '#2a2a2a',
      owner_id INTEGER,
      size INTEGER DEFAULT 1
    );
    CREATE TABLE fog (
      map_id INTEGER PRIMARY KEY,
      data TEXT
    );
    CREATE TABLE walls (
      map_id INTEGER,
      cx INTEGER,
      cy INTEGER,
      side TEXT,
      kind TEXT DEFAULT 'wall',
      open INTEGER DEFAULT 0,
      PRIMARY KEY (map_id, cx, cy, side)
    );
  `);
  return { db, dir };
}

// --- Pure helper tests -----------------------------------------------------

test('addPartySelfVisibility: bare PC in empty room reveals all 9 cells', () => {
  const map = makeMap(20, 20);
  const tokens = [{ id: 1, kind: 'pc', x: 10, y: 10, light_type: 'none', owner_id: null }];
  const wallSet = wallSetFromRows([]);
  const lit = new Set();
  addPartySelfVisibility(tokens, wallSet, map, lit);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      assert.ok(lit.has(`${10 + dx},${10 + dy}`), `expected (${10 + dx},${10 + dy}) lit`);
    }
  }
  assert.equal(lit.size, 9);
});

test('addPartySelfVisibility: monster does not get self-visibility', () => {
  const map = makeMap(20, 20);
  const tokens = [{ id: 1, kind: 'monster', x: 10, y: 10, light_type: 'none', owner_id: null }];
  const wallSet = wallSetFromRows([]);
  const lit = new Set();
  addPartySelfVisibility(tokens, wallSet, map, lit);
  assert.equal(lit.size, 0);
  assert.ok(!lit.has('10,10'));
});

test('addPartySelfVisibility: player-owned non-pc token gets self-zone', () => {
  const map = makeMap(20, 20);
  const tokens = [{ id: 1, kind: 'monster', x: 4, y: 4, light_type: 'none', owner_id: 7 }];
  const wallSet = wallSetFromRows([]);
  const lit = new Set();
  addPartySelfVisibility(tokens, wallSet, map, lit);
  assert.equal(lit.size, 9);
  assert.ok(lit.has('4,4'));
});

test('addPartySelfVisibility: wall east of PC blocks (11,10) and corner diagonals', () => {
  const map = makeMap(20, 20);
  const tokens = [{ id: 1, kind: 'pc', x: 10, y: 10, light_type: 'none', owner_id: null }];
  // Wall on the west edge of (11,10) == between (10,10) and (11,10)
  const wallSet = wallSetFromRows([{ cx: 11, cy: 10, side: 'w', kind: 'wall', open: 0 }]);
  // Sanity: isBlocked agrees
  assert.ok(isBlocked(wallSet, 10, 10, 11, 10));
  const lit = new Set();
  addPartySelfVisibility(tokens, wallSet, map, lit);
  assert.ok(lit.has('10,10'), 'own cell');
  assert.ok(lit.has('9,10'), 'west open');
  assert.ok(lit.has('10,9'), 'north open');
  assert.ok(lit.has('10,11'), 'south open');
  assert.ok(!lit.has('11,10'), 'east blocked by wall');
  // Diagonals to (11,9) and (11,11): one orthogonal path goes via (11,10)
  // which is blocked at (10,10)->(11,10). The other path via (10,9)->(11,9)
  // is unblocked, so the diagonal IS reachable per the rule (need EITHER
  // gap-pair fully open). Confirm at least one corner is lit.
  // The implementation uses computeRevealed-style: BOTH gap pairs must NOT
  // be blocked? Actually it requires EITHER pair fully unblocked — let's
  // verify against the actual computeRevealed semantics.
  // From the impl: blocks the diagonal if EITHER pair has any blocked edge.
  // For (11,9) from (10,10): pair A = (10,10)->(11,10) blocked, (11,10)->(11,9) open;
  //                          pair B = (10,10)->(10,9) open, (10,9)->(11,9) open.
  // Pair A is blocked → impl returns blocked. Pair B is open → impl returns open.
  // The impl's logic: "if (blocked A1 or A2) continue; if (blocked B1 or B2) continue"
  // means BOTH pairs must be fully open — strict. So (11,9) IS blocked.
  assert.ok(!lit.has('11,9'), 'NE diagonal blocked under strict rule');
  assert.ok(!lit.has('11,11'), 'SE diagonal blocked under strict rule');
});

test('addPartySelfVisibility: two PCs far apart both lit', () => {
  const map = makeMap(20, 20);
  const tokens = [
    { id: 1, kind: 'pc', x: 5, y: 5, light_type: 'none', owner_id: null },
    { id: 2, kind: 'pc', x: 15, y: 15, light_type: 'none', owner_id: null },
  ];
  const wallSet = wallSetFromRows([]);
  const lit = new Set();
  addPartySelfVisibility(tokens, wallSet, map, lit);
  assert.equal(lit.size, 18);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      assert.ok(lit.has(`${5 + dx},${5 + dy}`));
      assert.ok(lit.has(`${15 + dx},${15 + dy}`));
    }
  }
});

test('addPartySelfVisibility: PC at edge of map clamps without crashing', () => {
  const map = makeMap(20, 20);
  const tokens = [{ id: 1, kind: 'pc', x: 0, y: 0, light_type: 'none', owner_id: null }];
  const wallSet = wallSetFromRows([]);
  const lit = new Set();
  addPartySelfVisibility(tokens, wallSet, map, lit);
  // Only (0,0), (1,0), (0,1), (1,1) are in-bounds.
  assert.equal(lit.size, 4);
  assert.ok(lit.has('0,0'));
  assert.ok(lit.has('1,0'));
  assert.ok(lit.has('0,1'));
  assert.ok(lit.has('1,1'));
});

// --- computeFog integration ------------------------------------------------

test('computeFog: bare PC unfogs the 3x3 around itself', () => {
  const map = makeMap(20, 20);
  const tokens = [{ id: 1, kind: 'pc', x: 10, y: 10, light_type: 'none', owner_id: null }];
  const fog = new Set(computeFog(map, tokens, []));
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      assert.ok(!fog.has(`${10 + dx},${10 + dy}`), `(${10 + dx},${10 + dy}) should be lit`);
    }
  }
  // Far cell still fogged.
  assert.ok(fog.has('0,0'));
});

test('computeFog: monster with no light stays fogged', () => {
  const map = makeMap(20, 20);
  const tokens = [{ id: 1, kind: 'monster', x: 10, y: 10, light_type: 'none', owner_id: null }];
  const fog = new Set(computeFog(map, tokens, []));
  assert.ok(fog.has('10,10'), 'monster cell should remain fogged');
});

test('computeFog: PC with torch — torch radius subsumes 3x3 self-zone', () => {
  const map = makeMap(20, 20);
  const tokens = [{ id: 1, kind: 'pc', x: 10, y: 10, light_type: 'torch', owner_id: null }];
  const fog = new Set(computeFog(map, tokens, []));
  // 3x3 still lit
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      assert.ok(!fog.has(`${10 + dx},${10 + dy}`));
    }
  }
  // Torch reaches further than 1 cell.
  assert.ok(!fog.has('12,10'), 'torch radius extends past 3x3');
});

// --- recomputeFog integration (DB) -----------------------------------------

test('recomputeFog: bare PC self-zone written to fog', () => {
  const { db } = makeTempDb();
  const info = db.prepare('INSERT INTO maps (name, width, height, active) VALUES (?,?,?,1)')
    .run('Test Map', 20, 20);
  const mapId = info.lastInsertRowid;
  db.prepare('INSERT INTO tokens (map_id, kind, name, x, y, light_type, owner_id) VALUES (?,?,?,?,?,?,?)')
    .run(mapId, 'pc', 'Hero', 10, 10, 'none', null);
  const fog = new Set(recomputeFog(db, () => {}, mapId));
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      assert.ok(!fog.has(`${10 + dx},${10 + dy}`), `(${10 + dx},${10 + dy}) should be lit`);
    }
  }
  assert.ok(fog.has('0,0'));
});

test('recomputeFog: monster with no light stays fogged', () => {
  const { db } = makeTempDb();
  const info = db.prepare('INSERT INTO maps (name, width, height, active) VALUES (?,?,?,1)')
    .run('Test Map', 20, 20);
  const mapId = info.lastInsertRowid;
  db.prepare('INSERT INTO tokens (map_id, kind, name, x, y, light_type, owner_id) VALUES (?,?,?,?,?,?,?)')
    .run(mapId, 'monster', 'Orc', 10, 10, 'none', null);
  const fog = new Set(recomputeFog(db, () => {}, mapId));
  assert.ok(fog.has('10,10'), 'monster cell should remain fogged');
});

test('recomputeFog: wall east of bare PC blocks self-zone east cell', () => {
  const { db } = makeTempDb();
  const info = db.prepare('INSERT INTO maps (name, width, height, active) VALUES (?,?,?,1)')
    .run('Test Map', 20, 20);
  const mapId = info.lastInsertRowid;
  db.prepare('INSERT INTO tokens (map_id, kind, name, x, y, light_type, owner_id) VALUES (?,?,?,?,?,?,?)')
    .run(mapId, 'pc', 'Hero', 10, 10, 'none', null);
  // Wall on west edge of (11,10).
  db.prepare('INSERT INTO walls (map_id, cx, cy, side, kind, open) VALUES (?,?,?,?,?,?)')
    .run(mapId, 11, 10, 'w', 'wall', 0);
  const fog = new Set(recomputeFog(db, () => {}, mapId));
  assert.ok(!fog.has('10,10'), 'own cell lit');
  assert.ok(!fog.has('9,10'), 'west open');
  assert.ok(fog.has('11,10'), 'east blocked');
});
