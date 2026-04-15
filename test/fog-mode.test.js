import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { recomputeFog } from '../lib/logic.js';
import { createMap, getMap } from '../lib/maps.js';

function makeTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dgrid-fogmode-'));
  const db = new Database(path.join(dir, 'grid.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE campaigns (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER
    );
    CREATE TABLE maps (
      id INTEGER PRIMARY KEY,
      campaign_id INTEGER,
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
    CREATE TABLE explored_cells (
      map_id INTEGER,
      cx INTEGER,
      cy INTEGER,
      PRIMARY KEY (map_id, cx, cy)
    );
    CREATE TABLE cell_memory (
      map_id INTEGER,
      cx INTEGER,
      cy INTEGER,
      token_id INTEGER,
      snapshot TEXT,
      PRIMARY KEY (map_id, cx, cy, token_id)
    );
  `);
  const info = db.prepare('INSERT INTO campaigns (name, created_at) VALUES (?,?)').run('Test', Date.now());
  return { db, campaignId: info.lastInsertRowid };
}

function addPcTorch(db, mapId) {
  db.prepare('INSERT INTO tokens (map_id, kind, name, x, y, light_type, facing, owner_id) VALUES (?,?,?,?,?,?,?,?)')
    .run(mapId, 'pc', 'Hero', 5, 5, 'torch', 0, 1);
}

test('createMap with fog_mode=outdoor persists the value', () => {
  const { db, campaignId } = makeTempDb();
  const id = createMap(db, campaignId, { name: 'Field', fog_mode: 'outdoor', width: 10, height: 10 });
  const row = getMap(db, id);
  assert.equal(row.fog_mode, 'outdoor');
});

test('createMap defaults fog_mode to dungeon', () => {
  const { db, campaignId } = makeTempDb();
  const id = createMap(db, campaignId, { name: 'Crypt', width: 10, height: 10 });
  assert.equal(getMap(db, id).fog_mode, 'dungeon');
});

test('recomputeFog on dungeon map with PC+torch returns non-empty fog', () => {
  const { db, campaignId } = makeTempDb();
  const id = createMap(db, campaignId, { name: 'D', fog_mode: 'dungeon', width: 20, height: 20 });
  addPcTorch(db, id);
  const fog = recomputeFog(db, () => {}, id);
  assert.ok(Array.isArray(fog));
  assert.ok(fog.length > 0, 'cells outside the torch should be fogged');
  const fogSet = new Set(fog);
  assert.ok(!fogSet.has('5,5'), 'PC cell should be lit');
  assert.ok(fogSet.has('19,19'), 'far corner should be fogged');
});

test('recomputeFog on outdoor map returns empty fog regardless of lights', () => {
  const { db, campaignId } = makeTempDb();
  const id = createMap(db, campaignId, { name: 'Field', fog_mode: 'outdoor', width: 20, height: 20 });
  addPcTorch(db, id);
  const fog = recomputeFog(db, () => {}, id);
  assert.deepEqual(fog, []);
  // Persisted fog row should be the empty JSON array.
  const row = db.prepare('SELECT data FROM fog WHERE map_id=?').get(id);
  assert.equal(row.data, '[]');
  // No memory writes either.
  const ec = db.prepare('SELECT COUNT(*) c FROM explored_cells WHERE map_id=?').get(id).c;
  assert.equal(ec, 0, 'explored_cells should not be touched for outdoor maps');
  const cm = db.prepare('SELECT COUNT(*) c FROM cell_memory WHERE map_id=?').get(id).c;
  assert.equal(cm, 0, 'cell_memory should not be touched for outdoor maps');
});

test('recomputeFog on none map returns empty fog', () => {
  const { db, campaignId } = makeTempDb();
  const id = createMap(db, campaignId, { name: 'Open', fog_mode: 'none', width: 15, height: 15 });
  addPcTorch(db, id);
  const fog = recomputeFog(db, () => {}, id);
  assert.deepEqual(fog, []);
});

test('recomputeFog emits fog:state with empty array for outdoor maps', () => {
  const { db, campaignId } = makeTempDb();
  const id = createMap(db, campaignId, { name: 'Field', fog_mode: 'outdoor', width: 10, height: 10 });
  addPcTorch(db, id);
  const events = [];
  recomputeFog(db, (ev, payload) => events.push({ ev, payload }), id);
  assert.equal(events.length, 1);
  assert.equal(events[0].ev, 'fog:state');
  assert.equal(events[0].payload.data, '[]');
});

test('toggling dungeon -> outdoor clears fog; outdoor -> dungeon restores it', () => {
  const { db, campaignId } = makeTempDb();
  const id = createMap(db, campaignId, { name: 'M', fog_mode: 'dungeon', width: 20, height: 20 });
  addPcTorch(db, id);

  // Dungeon: fog has entries.
  let fog = recomputeFog(db, () => {}, id);
  assert.ok(fog.length > 0, 'dungeon fog should be non-empty');
  const dungeonFogCount = fog.length;

  // Toggle to outdoor.
  db.prepare('UPDATE maps SET fog_mode=? WHERE id=?').run('outdoor', id);
  fog = recomputeFog(db, () => {}, id);
  assert.deepEqual(fog, [], 'outdoor fog should be empty');
  assert.equal(db.prepare('SELECT data FROM fog WHERE map_id=?').get(id).data, '[]');

  // Toggle back to dungeon.
  db.prepare('UPDATE maps SET fog_mode=? WHERE id=?').run('dungeon', id);
  fog = recomputeFog(db, () => {}, id);
  assert.equal(fog.length, dungeonFogCount, 'dungeon fog should be restored to original count');
  const fogSet = new Set(fog);
  assert.ok(!fogSet.has('5,5'), 'PC cell still lit after toggle back');
  assert.ok(fogSet.has('19,19'), 'far cell fogged again');
});
