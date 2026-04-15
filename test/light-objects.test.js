import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { tokenIsLightSource, recomputeFog } from '../lib/logic.js';

test('tokenIsLightSource: PCs always light up', () => {
  assert.equal(tokenIsLightSource({ kind: 'pc' }), true);
});

test('tokenIsLightSource: monsters never light up', () => {
  assert.equal(tokenIsLightSource({ kind: 'monster' }), false);
});

test('tokenIsLightSource: monsters with a torch field still do not light up', () => {
  // Scary dungeons stay scary: a monster carrying a torch does not contribute.
  assert.equal(tokenIsLightSource({ kind: 'monster', light_type: 'torch' }), false);
});

test('tokenIsLightSource: dropped object with a real light_type lights up', () => {
  assert.equal(tokenIsLightSource({ kind: 'object', light_type: 'torch' }), true);
});

test('tokenIsLightSource: object with light_type "none" does not light up', () => {
  assert.equal(tokenIsLightSource({ kind: 'object', light_type: 'none' }), false);
});

test('tokenIsLightSource: object with no light_type at all does not light up', () => {
  assert.equal(tokenIsLightSource({ kind: 'object' }), false);
});

test('tokenIsLightSource: player-owned tokens light up', () => {
  assert.equal(tokenIsLightSource({ kind: 'player', owner_id: 5 }), true);
});

// --- DB scenario: dropped lantern lights cells around it even with a monster present ---

function makeTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dgrid-lightobj-'));
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
  return db;
}

function addToken(db, mapId, opts) {
  return db.prepare(`INSERT INTO tokens
    (map_id, kind, name, x, y, light_type, facing, owner_id, color, size, hp_current, hp_max, image)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      mapId, opts.kind || 'npc', opts.name || 'T',
      opts.x, opts.y, opts.light_type || 'none', opts.facing || 0,
      opts.owner_id || null, opts.color || '#2a2a2a', opts.size || 1,
      opts.hp_current || null, opts.hp_max || null, opts.image || null
    ).lastInsertRowid;
}

test('dropped lantern (object) lights cells even when only a monster shares the cell', () => {
  const db = makeTempDb();
  const mapId = db.prepare('INSERT INTO maps (campaign_id, name, width, height, active) VALUES (?,?,?,?,1)')
    .run(1, 'LightTest', 20, 20).lastInsertRowid;
  // Monster + dropped lantern in the same cell — no party tokens at all.
  addToken(db, mapId, { kind: 'monster', name: 'Goblin', x: 10, y: 10 });
  addToken(db, mapId, { kind: 'object', name: 'Lantern', x: 10, y: 10, light_type: 'lantern' });

  const fog = recomputeFog(db, () => {}, mapId);
  const fogSet = new Set(fog);
  // Lantern radius is 6 — these cells should be lit (not in fog).
  assert.ok(!fogSet.has('10,10'), 'lantern cell should be lit');
  assert.ok(!fogSet.has('11,10'), 'adjacent cell should be lit');
  assert.ok(!fogSet.has('10,12'), 'nearby cell should be lit');
  // Far corner should still be fogged.
  assert.ok(fogSet.has('0,0'), 'far cell should remain fogged');

  // And the explored_cells should reflect the lantern's lit area.
  const explored = db.prepare('SELECT cx, cy FROM explored_cells WHERE map_id=?').all(mapId);
  const exSet = new Set(explored.map(r => `${r.cx},${r.cy}`));
  assert.ok(exSet.has('10,10'), 'lantern cell explored');
});
