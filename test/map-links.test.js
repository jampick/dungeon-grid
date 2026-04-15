import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { performTravel, nullLinksToMap, deleteMap, createMap } from '../lib/maps.js';

// Self-contained temp DB mirroring the production schema for the columns
// exercised by the map-link feature: tokens carry link_map_id / link_x /
// link_y, and maps belong to a campaign. Kept separate from maps.test.js
// so we can evolve the stairs schema without disturbing legacy tests.
function makeTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dgrid-maplinks-'));
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
      cell_feet INTEGER DEFAULT 5
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
      size INTEGER DEFAULT 1,
      link_map_id INTEGER,
      link_x INTEGER,
      link_y INTEGER
    );
    CREATE TABLE fog (map_id INTEGER PRIMARY KEY, data TEXT);
    CREATE TABLE walls (
      map_id INTEGER, cx INTEGER, cy INTEGER,
      side TEXT, kind TEXT DEFAULT 'wall', open INTEGER DEFAULT 0,
      PRIMARY KEY (map_id, cx, cy, side)
    );
  `);
  const info = db.prepare('INSERT INTO campaigns (name, created_at) VALUES (?, ?)').run('Test', Date.now());
  return { db, campaignId: info.lastInsertRowid };
}

function insertToken(db, row) {
  return db.prepare(
    `INSERT INTO tokens (map_id, kind, name, x, y, hp_current, hp_max, ac, owner_id, link_map_id, link_x, link_y)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    row.map_id, row.kind || 'pc', row.name || '?',
    row.x ?? 1, row.y ?? 1,
    row.hp_current ?? 10, row.hp_max ?? 10, row.ac ?? 10,
    row.owner_id ?? null,
    row.link_map_id ?? null, row.link_x ?? null, row.link_y ?? null,
  ).lastInsertRowid;
}

test('performTravel moves an owned token to the linked map & destination cell', () => {
  const { db, campaignId } = makeTempDb();
  const map1 = createMap(db, campaignId, { name: 'Level 1' });
  const map2 = createMap(db, campaignId, { name: 'Level 2' });
  const stairsId = insertToken(db, { map_id: map1, kind: 'object', name: 'Stairs',
    x: 3, y: 3, link_map_id: map2, link_x: 7, link_y: 8 });
  const playerId = 42;
  const pcId = insertToken(db, { map_id: map1, kind: 'pc', name: 'Hero',
    x: 2, y: 2, owner_id: playerId });

  const result = performTravel(db, playerId, stairsId);
  assert.equal(result.ok, true);
  assert.equal(result.toMapId, map2);
  assert.deepEqual(result.movedIds, [pcId]);

  const pc = db.prepare('SELECT * FROM tokens WHERE id=?').get(pcId);
  assert.equal(pc.map_id, map2);
  assert.equal(pc.x, 7);
  assert.equal(pc.y, 8);

  // Stairs token itself must be unchanged.
  const stairs = db.prepare('SELECT * FROM tokens WHERE id=?').get(stairsId);
  assert.equal(stairs.map_id, map1);
  assert.equal(stairs.x, 3);
  assert.equal(stairs.y, 3);
  assert.equal(stairs.link_map_id, map2);
});

test('performTravel with no link_map_id is a no-op', () => {
  const { db, campaignId } = makeTempDb();
  const map1 = createMap(db, campaignId, { name: 'Level 1' });
  const propId = insertToken(db, { map_id: map1, kind: 'object', name: 'Visual Stairs', x: 4, y: 4 });
  insertToken(db, { map_id: map1, kind: 'pc', name: 'Hero', owner_id: 1 });

  const r = performTravel(db, 1, propId);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not-a-link');

  // Hero still on map1 at its original coords.
  const hero = db.prepare("SELECT * FROM tokens WHERE kind='pc'").get();
  assert.equal(hero.map_id, map1);
});

test('performTravel with a stale link_map_id (target map deleted) is a no-op', () => {
  const { db, campaignId } = makeTempDb();
  const map1 = createMap(db, campaignId, { name: 'Level 1' });
  // Manually insert a stairs token pointing at a bogus map id.
  const stairsId = insertToken(db, { map_id: map1, kind: 'object', name: 'Broken',
    x: 1, y: 1, link_map_id: 9999, link_x: 0, link_y: 0 });
  insertToken(db, { map_id: map1, kind: 'pc', name: 'Hero', owner_id: 7 });

  const r = performTravel(db, 7, stairsId);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'target-missing');
});

test('performTravel with no owned token on source map is a no-op', () => {
  const { db, campaignId } = makeTempDb();
  const map1 = createMap(db, campaignId, { name: 'L1' });
  const map2 = createMap(db, campaignId, { name: 'L2' });
  const stairsId = insertToken(db, { map_id: map1, kind: 'object',
    link_map_id: map2, link_x: 1, link_y: 1 });
  const r = performTravel(db, 99, stairsId);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-owned-token');
});

test('deleteMap cascades link_map_id to NULL on surviving tokens', () => {
  const { db, campaignId } = makeTempDb();
  const map1 = createMap(db, campaignId, { name: 'L1' });
  const map2 = createMap(db, campaignId, { name: 'L2' });
  // stairs on map1 -> map2
  const stairsId = insertToken(db, { map_id: map1, kind: 'object', name: 'Stairs',
    link_map_id: map2, link_x: 5, link_y: 5 });

  deleteMap(db, map2);
  const stairs = db.prepare('SELECT * FROM tokens WHERE id=?').get(stairsId);
  assert.equal(stairs.link_map_id, null);
  assert.equal(stairs.link_x, null);
  assert.equal(stairs.link_y, null);
});

test('nullLinksToMap clears all dangling links to a given map', () => {
  const { db, campaignId } = makeTempDb();
  const m1 = createMap(db, campaignId, { name: 'L1' });
  const m2 = createMap(db, campaignId, { name: 'L2' });
  const m3 = createMap(db, campaignId, { name: 'L3' });
  const aId = insertToken(db, { map_id: m1, link_map_id: m2, link_x: 1, link_y: 2 });
  const bId = insertToken(db, { map_id: m1, link_map_id: m3, link_x: 3, link_y: 4 });
  nullLinksToMap(db, m2);
  assert.equal(db.prepare('SELECT link_map_id FROM tokens WHERE id=?').get(aId).link_map_id, null);
  // Unrelated link survives.
  assert.equal(db.prepare('SELECT link_map_id FROM tokens WHERE id=?').get(bId).link_map_id, m3);
});
