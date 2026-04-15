import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  listMaps,
  createMap,
  renameMap,
  activateMap,
  duplicateMap,
  deleteMap,
  getMap,
} from '../lib/maps.js';

function makeTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dgrid-maps-'));
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
  `);
  const info = db.prepare('INSERT INTO campaigns (name, created_at) VALUES (?, ?)').run('Test', Date.now());
  return { db, campaignId: info.lastInsertRowid };
}

function seedMapWithContent(db, campaignId, { tokens = 0, walls = 0, active = 0, name = 'Seed' } = {}) {
  const info = db.prepare('INSERT INTO maps (campaign_id, name, width, height, active) VALUES (?,?,?,?,?)')
    .run(campaignId, name, 20, 20, active);
  const mapId = info.lastInsertRowid;
  for (let i = 0; i < tokens; i++) {
    db.prepare('INSERT INTO tokens (map_id, kind, name, x, y, hp_current, hp_max, ac, color) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(mapId, 'pc', `Hero${i}`, i + 1, i + 2, 10, 10, 10, '#123456');
  }
  const sides = ['n', 'w'];
  for (let i = 0; i < walls; i++) {
    db.prepare('INSERT INTO walls (map_id, cx, cy, side, kind, open) VALUES (?,?,?,?,?,?)')
      .run(mapId, i, i, sides[i % 2], 'wall', 0);
  }
  return mapId;
}

test('duplicateMap copies tokens and walls to the new map_id', () => {
  const { db, campaignId } = makeTempDb();
  const srcId = seedMapWithContent(db, campaignId, { tokens: 2, walls: 3, active: 1, name: 'Source' });

  const newId = duplicateMap(db, srcId);
  assert.ok(newId && newId !== srcId, 'returns a new id');

  const srcTokens = db.prepare('SELECT * FROM tokens WHERE map_id=?').all(srcId);
  const dupTokens = db.prepare('SELECT * FROM tokens WHERE map_id=?').all(newId);
  assert.equal(dupTokens.length, 2, 'duplicate has 2 tokens');
  assert.equal(srcTokens.length, 2, 'source still has 2 tokens');
  assert.deepEqual(
    dupTokens.map(t => t.name).sort(),
    srcTokens.map(t => t.name).sort()
  );

  const dupWalls = db.prepare('SELECT * FROM walls WHERE map_id=?').all(newId);
  assert.equal(dupWalls.length, 3, 'duplicate has 3 walls');
  for (const w of dupWalls) assert.equal(w.map_id, newId);

  // Duplicate must start inactive and source stays active.
  const dup = getMap(db, newId);
  assert.equal(dup.active, 0);
  const src = getMap(db, srcId);
  assert.equal(src.active, 1);
});

test('deleteMap refuses to delete the last remaining map', () => {
  const { db, campaignId } = makeTempDb();
  const onlyId = createMap(db, campaignId, { name: 'Only' });
  activateMap(db, onlyId);

  assert.throws(() => deleteMap(db, onlyId), /last map/);
  // Still present
  assert.ok(getMap(db, onlyId));
});

test('deleteMap removes children and reactivates another map when deleting the active one', () => {
  const { db, campaignId } = makeTempDb();
  const aId = seedMapWithContent(db, campaignId, { tokens: 1, walls: 1, active: 1, name: 'A' });
  const bId = createMap(db, campaignId, { name: 'B' });

  deleteMap(db, aId);
  assert.equal(getMap(db, aId), undefined);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM tokens WHERE map_id=?').get(aId).c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM walls WHERE map_id=?').get(aId).c, 0);
  const b = getMap(db, bId);
  assert.equal(b.active, 1, 'remaining map becomes active');
});

test('renameMap persists the new name', () => {
  const { db, campaignId } = makeTempDb();
  const id = createMap(db, campaignId, { name: 'Old' });
  const ok = renameMap(db, id, 'Shiny New Name');
  assert.equal(ok, true);
  assert.equal(getMap(db, id).name, 'Shiny New Name');

  // Rejects empty/whitespace-only
  assert.equal(renameMap(db, id, '   '), false);
  assert.equal(getMap(db, id).name, 'Shiny New Name');
});

test('activateMap sets only the target map active and clears others', () => {
  const { db, campaignId } = makeTempDb();
  const a = createMap(db, campaignId, { name: 'A' });
  const b = createMap(db, campaignId, { name: 'B' });
  const c = createMap(db, campaignId, { name: 'C' });
  activateMap(db, a);
  activateMap(db, c);

  const rows = listMaps(db, campaignId);
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  assert.equal(byId[a].active, 0);
  assert.equal(byId[b].active, 0);
  assert.equal(byId[c].active, 1);
  const activeCount = rows.filter(r => r.active === 1).length;
  assert.equal(activeCount, 1);
});
