import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  TERRAIN_COLORS,
  TERRAIN_KINDS,
  pickTerrainColor,
  applyTerrainPaint,
  applyTerrainClear,
} from '../lib/logic.js';
import { duplicateMap, deleteMap, createMap } from '../lib/maps.js';

function makeTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dgrid-terrain-'));
  const db = new Database(path.join(dir, 'grid.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER
    );
    CREATE TABLE maps (
      id INTEGER PRIMARY KEY,
      session_id TEXT,
      name TEXT,
      grid_type TEXT DEFAULT 'square',
      grid_size INTEGER DEFAULT 50,
      width INTEGER DEFAULT 30,
      height INTEGER DEFAULT 20,
      background TEXT,
      active INTEGER DEFAULT 0,
      cell_feet INTEGER DEFAULT 5,
      fog_mode TEXT DEFAULT 'dungeon'
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
    CREATE TABLE terrain (
      map_id INTEGER,
      cx INTEGER,
      cy INTEGER,
      kind TEXT,
      PRIMARY KEY (map_id, cx, cy)
    );
  `);
  db.prepare("INSERT INTO sessions (id, name, created_at) VALUES ('test', ?, ?)").run('Test', Date.now());
  return { db, sessionId: 'test' };
}

test('TERRAIN_COLORS contains all 8 expected kinds with valid hex colors', () => {
  const expected = ['grass', 'forest', 'water', 'road', 'hill', 'desert', 'swamp', 'snow'];
  assert.equal(TERRAIN_KINDS.length, 8);
  for (const k of expected) {
    assert.ok(k in TERRAIN_COLORS, `missing kind ${k}`);
    assert.match(TERRAIN_COLORS[k], /^#[0-9a-fA-F]{6}$/, `bad color for ${k}`);
  }
});

test('pickTerrainColor returns the palette color and falls back for unknown', () => {
  assert.equal(pickTerrainColor('grass'), TERRAIN_COLORS.grass);
  assert.equal(pickTerrainColor('water'), TERRAIN_COLORS.water);
  // Unknown kind falls back to a neutral grey instead of crashing.
  const fb = pickTerrainColor('not-a-thing');
  assert.match(fb, /^#[0-9a-fA-F]{6}$/);
  assert.equal(pickTerrainColor(null), null);
});

test('insert a terrain row and read it back', () => {
  const { db, sessionId } = makeTempDb();
  const mapId = createMap(db, sessionId, { name: 'M' });
  db.prepare('INSERT INTO terrain (map_id, cx, cy, kind) VALUES (?,?,?,?)').run(mapId, 3, 4, 'forest');
  const row = db.prepare('SELECT * FROM terrain WHERE map_id=? AND cx=? AND cy=?').get(mapId, 3, 4);
  assert.ok(row);
  assert.equal(row.kind, 'forest');
});

test('applyTerrainPaint upserts a cell and rejects unknown kinds', () => {
  const { db, sessionId } = makeTempDb();
  const mapId = createMap(db, sessionId, { name: 'M' });

  const r1 = applyTerrainPaint(db, mapId, 1, 2, 'grass');
  assert.equal(r1.ok, true);
  assert.equal(db.prepare('SELECT kind FROM terrain WHERE map_id=? AND cx=? AND cy=?').get(mapId, 1, 2).kind, 'grass');

  // Repaint same cell to a new kind — upsert, not duplicate insert.
  const r2 = applyTerrainPaint(db, mapId, 1, 2, 'water');
  assert.equal(r2.ok, true);
  const rows = db.prepare('SELECT * FROM terrain WHERE map_id=? AND cx=? AND cy=?').all(mapId, 1, 2);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'water');

  // Unknown kind rejected, no insert.
  const r3 = applyTerrainPaint(db, mapId, 9, 9, 'lava');
  assert.equal(r3.ok, false);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM terrain WHERE map_id=? AND cx=9 AND cy=9').get(mapId).c, 0);

  // Bad coords rejected.
  assert.equal(applyTerrainPaint(db, mapId, 1.5, 2, 'grass').ok, false);

  // applyTerrainClear removes a cell.
  const c = applyTerrainClear(db, mapId, 1, 2);
  assert.equal(c.ok, true);
  assert.equal(c.removed, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM terrain WHERE map_id=?').get(mapId).c, 0);
});

test('deleteMap cascades terrain rows for that map', () => {
  const { db, sessionId } = makeTempDb();
  const a = createMap(db, sessionId, { name: 'A' });
  const b = createMap(db, sessionId, { name: 'B' });
  applyTerrainPaint(db, a, 0, 0, 'grass');
  applyTerrainPaint(db, a, 1, 1, 'water');
  applyTerrainPaint(db, b, 5, 5, 'snow');

  deleteMap(db, a);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM terrain WHERE map_id=?').get(a).c, 0);
  // B's terrain untouched.
  assert.equal(db.prepare('SELECT COUNT(*) c FROM terrain WHERE map_id=?').get(b).c, 1);
});

test('duplicateMap carries terrain to the new map', () => {
  const { db, sessionId } = makeTempDb();
  const a = createMap(db, sessionId, { name: 'A' });
  const b = createMap(db, sessionId, { name: 'B' }); // ensure not the only map
  applyTerrainPaint(db, a, 2, 3, 'desert');
  applyTerrainPaint(db, a, 4, 5, 'hill');

  const newId = duplicateMap(db, a);
  assert.ok(newId && newId !== a);
  const dup = db.prepare('SELECT cx, cy, kind FROM terrain WHERE map_id=? ORDER BY cx, cy').all(newId);
  assert.equal(dup.length, 2);
  assert.deepEqual(dup, [
    { cx: 2, cy: 3, kind: 'desert' },
    { cx: 4, cy: 5, kind: 'hill' },
  ]);
  // Source still has its terrain.
  assert.equal(db.prepare('SELECT COUNT(*) c FROM terrain WHERE map_id=?').get(a).c, 2);
  // Silence unused-var lint for b.
  assert.ok(b);
});
