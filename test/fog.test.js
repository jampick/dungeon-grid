import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { recomputeFog } from '../lib/logic.js';

function makeTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dgrid-test-'));
  const db = new Database(path.join(dir, 'grid.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE maps (
      id INTEGER PRIMARY KEY,
      session_id TEXT,
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

function seed(db) {
  const info = db.prepare('INSERT INTO maps (name, width, height, active) VALUES (?,?,?,1)').run('Test Map', 20, 20);
  const mapId = info.lastInsertRowid;
  // PC torch at (5,5)
  db.prepare('INSERT INTO tokens (map_id, kind, name, x, y, light_type, facing, owner_id) VALUES (?,?,?,?,?,?,?,?)')
    .run(mapId, 'pc', 'Hero', 5, 5, 'torch', 0, 1);
  // Monster torch at (15,15)
  db.prepare('INSERT INTO tokens (map_id, kind, name, x, y, light_type, facing, owner_id) VALUES (?,?,?,?,?,?,?,?)')
    .run(mapId, 'monster', 'Orc', 15, 15, 'torch', 0, null);
  return mapId;
}

test('recomputeFog: PC lights cells; monster with torch now also lights', () => {
  const { db } = makeTempDb();
  const mapId = seed(db);
  const fog = recomputeFog(db, () => {}, mapId);
  const fogSet = new Set(fog);
  // Cells around PC (5,5) should NOT be fogged
  assert.ok(!fogSet.has('5,5'), 'PC cell should be lit');
  assert.ok(!fogSet.has('6,5'), 'cell next to PC should be lit');
  assert.ok(!fogSet.has('5,6'));
  // Any token with a real light_type now emits light — the monster torch at
  // (15,15) illuminates its own cell and neighbors.
  assert.ok(!fogSet.has('15,15'), 'monster with torch should light its cell');
  assert.ok(!fogSet.has('14,15'));
  assert.ok(!fogSet.has('15,14'));
  // Far corner with no nearby light source remains fogged.
  assert.ok(fogSet.has('0,0'), 'far cell should remain fogged');
});

test('recomputeFog emits fog:state with JSON data', () => {
  const { db } = makeTempDb();
  const mapId = seed(db);
  const events = [];
  recomputeFog(db, (ev, payload) => events.push({ ev, payload }), mapId);
  assert.equal(events.length, 1);
  assert.equal(events[0].ev, 'fog:state');
  assert.ok(typeof events[0].payload.data === 'string');
  // DB row persisted
  const row = db.prepare('SELECT data FROM fog WHERE map_id=?').get(mapId);
  assert.ok(row && typeof row.data === 'string');
});

test('moving PC: cells behind re-fog, cells ahead clear', () => {
  const { db } = makeTempDb();
  const mapId = seed(db);
  // Initial: PC at (5,5). (8,5) is 3 away -> lit by torch radius 3.
  let fog = new Set(recomputeFog(db, () => {}, mapId));
  assert.ok(!fog.has('5,5'));
  assert.ok(!fog.has('7,5'), '(7,5) should be lit initially');

  // Move PC far right to (15,5). Previous cell (2,5) now fogged, (13,5) now lit.
  db.prepare('UPDATE tokens SET x=?, y=? WHERE kind=? AND map_id=?').run(15, 5, 'pc', mapId);
  fog = new Set(recomputeFog(db, () => {}, mapId));
  assert.ok(fog.has('2,5'), 'cell behind should re-fog after move');
  assert.ok(fog.has('5,5'), 'original PC spot should re-fog');
  assert.ok(!fog.has('15,5'), 'new PC spot should be lit');
  assert.ok(!fog.has('14,5'), 'cell adjacent to new PC spot should be lit');
});
