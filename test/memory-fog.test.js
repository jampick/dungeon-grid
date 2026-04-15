import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  recomputeFog,
  snapshotTokenForMemory,
  computeMemoryFromDb,
  computeMemoryTokensFromDb,
} from '../lib/logic.js';
import { duplicateMap } from '../lib/maps.js';

// Build a temp DB with the full schema (including the new memory tables).
function makeTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dgrid-memfog-'));
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
  return { db, dir };
}

function makeMap(db, w = 20, h = 20) {
  return db.prepare('INSERT INTO maps (campaign_id, name, width, height, active) VALUES (?,?,?,?,1)')
    .run(1, 'Test', w, h).lastInsertRowid;
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

test('snapshotTokenForMemory captures key fields', () => {
  const t = { id: 5, name: 'Goblin', color: '#0f0', kind: 'monster', image: '/u/g.png',
    facing: 3, size: 1, hp_current: 4, hp_max: 7, x: 1, y: 2, ac: 12 };
  const s = snapshotTokenForMemory(t);
  assert.equal(s.name, 'Goblin');
  assert.equal(s.kind, 'monster');
  assert.equal(s.facing, 3);
  assert.equal(s.hp_current, 4);
  assert.equal(s.hp_max, 7);
  // Non-memory fields not included
  assert.equal(s.x, undefined);
  assert.equal(s.id, undefined);
  assert.equal(s.ac, undefined);
});

test('lit cells are added to explored_cells after recomputeFog', () => {
  const { db } = makeTempDb();
  const mapId = makeMap(db);
  addToken(db, mapId, { kind: 'pc', name: 'Hero', x: 5, y: 5, light_type: 'torch', owner_id: 1 });
  recomputeFog(db, () => {}, mapId);
  const rows = db.prepare('SELECT cx, cy FROM explored_cells WHERE map_id=?').all(mapId);
  assert.ok(rows.length > 0, 'should have explored cells');
  const set = new Set(rows.map(r => `${r.cx},${r.cy}`));
  assert.ok(set.has('5,5'), 'PC cell explored');
  assert.ok(set.has('6,5'), 'adjacent cell explored');
});

test('snapshot of token in lit cell is stored in cell_memory', () => {
  const { db } = makeTempDb();
  const mapId = makeMap(db);
  addToken(db, mapId, { kind: 'pc', name: 'Hero', x: 5, y: 5, light_type: 'torch', owner_id: 1 });
  const goblinId = addToken(db, mapId, { kind: 'monster', name: 'Goblin', x: 6, y: 5 });
  recomputeFog(db, () => {}, mapId);
  const row = db.prepare('SELECT snapshot FROM cell_memory WHERE map_id=? AND cx=? AND cy=? AND token_id=?')
    .get(mapId, 6, 5, goblinId);
  assert.ok(row, 'goblin snapshot stored');
  const snap = JSON.parse(row.snapshot);
  assert.equal(snap.name, 'Goblin');
});

test('cell leaves light: snapshot remains in cell_memory', () => {
  const { db } = makeTempDb();
  const mapId = makeMap(db);
  const heroId = addToken(db, mapId, { kind: 'pc', name: 'Hero', x: 5, y: 5, light_type: 'torch', owner_id: 1 });
  const goblinId = addToken(db, mapId, { kind: 'monster', name: 'Goblin', x: 6, y: 5 });
  recomputeFog(db, () => {}, mapId);
  // Move hero far away so (6,5) is no longer lit.
  db.prepare('UPDATE tokens SET x=?, y=? WHERE id=?').run(15, 15, heroId);
  recomputeFog(db, () => {}, mapId);
  // Goblin's (6,5) is now fogged — but explored, and cell_memory still has the snapshot.
  const fogStr = db.prepare('SELECT data FROM fog WHERE map_id=?').get(mapId).data;
  const fogSet = new Set(JSON.parse(fogStr));
  assert.ok(fogSet.has('6,5'), '(6,5) should now be fogged');
  const row = db.prepare('SELECT snapshot FROM cell_memory WHERE map_id=? AND cx=? AND cy=? AND token_id=?')
    .get(mapId, 6, 5, goblinId);
  assert.ok(row, 'snapshot retained after cell goes dark');
  const snap = JSON.parse(row.snapshot);
  assert.equal(snap.name, 'Goblin');
});

test('memory tokens do not update once cell is fogged', () => {
  const { db } = makeTempDb();
  const mapId = makeMap(db);
  const heroId = addToken(db, mapId, { kind: 'pc', name: 'Hero', x: 5, y: 5, light_type: 'torch', owner_id: 1 });
  const goblinId = addToken(db, mapId, { kind: 'monster', name: 'Goblin', x: 6, y: 5 });
  recomputeFog(db, () => {}, mapId);
  // Hero leaves; (6,5) goes dark.
  db.prepare('UPDATE tokens SET x=?, y=? WHERE id=?').run(15, 15, heroId);
  recomputeFog(db, () => {}, mapId);
  // DM moves the real goblin token to (10,10) — out of sight from hero.
  db.prepare('UPDATE tokens SET x=?, y=? WHERE id=?').run(10, 10, goblinId);
  recomputeFog(db, () => {}, mapId);
  // Cell_memory at (6,5) should still have the goblin
  const stale = db.prepare('SELECT snapshot FROM cell_memory WHERE map_id=? AND cx=? AND cy=? AND token_id=?')
    .get(mapId, 6, 5, goblinId);
  assert.ok(stale, 'stale snapshot at (6,5) remains');
  // Cell_memory at (10,10) should NOT have the goblin (cell never observed).
  const new10 = db.prepare('SELECT snapshot FROM cell_memory WHERE map_id=? AND cx=? AND cy=?')
    .all(mapId, 10, 10);
  assert.equal(new10.length, 0, 'unobserved cell has no memory');
  // computeMemoryFromDb should return the stale goblin
  const fogStr = db.prepare('SELECT data FROM fog WHERE map_id=?').get(mapId).data;
  const fogSet = new Set(JSON.parse(fogStr));
  const mem = computeMemoryFromDb(db, mapId, fogSet);
  const cell65 = mem.find(c => c.cx === 6 && c.cy === 5);
  assert.ok(cell65, '(6,5) included in memory payload');
  assert.equal(cell65.tokens.length, 1);
  assert.equal(cell65.tokens[0].name, 'Goblin');
});

test('re-entering a stale memory cell replaces memory with reality', () => {
  const { db } = makeTempDb();
  const mapId = makeMap(db);
  const heroId = addToken(db, mapId, { kind: 'pc', name: 'Hero', x: 5, y: 5, light_type: 'torch', owner_id: 1 });
  const goblinId = addToken(db, mapId, { kind: 'monster', name: 'Goblin', x: 6, y: 5 });
  recomputeFog(db, () => {}, mapId);
  db.prepare('UPDATE tokens SET x=?, y=? WHERE id=?').run(15, 15, heroId);
  recomputeFog(db, () => {}, mapId);
  // Move goblin away while hero is gone
  db.prepare('UPDATE tokens SET x=?, y=? WHERE id=?').run(10, 10, goblinId);
  // Hero comes back so (6,5) is lit again
  db.prepare('UPDATE tokens SET x=?, y=? WHERE id=?').run(5, 5, heroId);
  recomputeFog(db, () => {}, mapId);
  // (6,5) is lit -> stale snapshot of the goblin should be cleared.
  const row = db.prepare('SELECT snapshot FROM cell_memory WHERE map_id=? AND cx=? AND cy=? AND token_id=?')
    .get(mapId, 6, 5, goblinId);
  assert.equal(row, undefined, 'stale snapshot cleared on re-entry');
});

test('memory:clear handler wipes both tables for the map', () => {
  const { db } = makeTempDb();
  const mapId = makeMap(db);
  addToken(db, mapId, { kind: 'pc', name: 'Hero', x: 5, y: 5, light_type: 'torch', owner_id: 1 });
  addToken(db, mapId, { kind: 'monster', name: 'Goblin', x: 6, y: 5 });
  recomputeFog(db, () => {}, mapId);
  assert.ok(db.prepare('SELECT COUNT(*) c FROM explored_cells WHERE map_id=?').get(mapId).c > 0);
  assert.ok(db.prepare('SELECT COUNT(*) c FROM cell_memory WHERE map_id=?').get(mapId).c > 0);
  // Simulate the handler:
  db.prepare('DELETE FROM explored_cells WHERE map_id=?').run(mapId);
  db.prepare('DELETE FROM cell_memory WHERE map_id=?').run(mapId);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM explored_cells WHERE map_id=?').get(mapId).c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM cell_memory WHERE map_id=?').get(mapId).c, 0);
});

test('per-map isolation: memory does not leak between maps', () => {
  const { db } = makeTempDb();
  const map1 = makeMap(db);
  const map2 = makeMap(db);
  addToken(db, map1, { kind: 'pc', name: 'A', x: 5, y: 5, light_type: 'torch', owner_id: 1 });
  addToken(db, map1, { kind: 'monster', name: 'M1', x: 6, y: 5 });
  addToken(db, map2, { kind: 'pc', name: 'B', x: 2, y: 2, light_type: 'torch', owner_id: 1 });
  addToken(db, map2, { kind: 'monster', name: 'M2', x: 3, y: 2 });
  recomputeFog(db, () => {}, map1);
  recomputeFog(db, () => {}, map2);
  const ex1 = db.prepare('SELECT cx,cy FROM explored_cells WHERE map_id=?').all(map1);
  const ex2 = db.prepare('SELECT cx,cy FROM explored_cells WHERE map_id=?').all(map2);
  assert.ok(ex1.length > 0 && ex2.length > 0);
  // No row in either explored set should match the other map's PC region exactly.
  const set1 = new Set(ex1.map(r => `${r.cx},${r.cy}`));
  const set2 = new Set(ex2.map(r => `${r.cx},${r.cy}`));
  assert.ok(set1.has('5,5'));
  assert.ok(!set2.has('5,5'), 'map2 should not contain map1 PC cell');
  assert.ok(set2.has('2,2'));
  assert.ok(!set1.has('2,2'), 'map1 should not contain map2 PC cell');
  // Cell_memory rows are scoped by map_id.
  const m1mem = db.prepare('SELECT * FROM cell_memory WHERE map_id=?').all(map1);
  const m2mem = db.prepare('SELECT * FROM cell_memory WHERE map_id=?').all(map2);
  assert.ok(m1mem.every(r => r.map_id === map1));
  assert.ok(m2mem.every(r => r.map_id === map2));
});

test('map duplication does NOT copy explored_cells / cell_memory', () => {
  const { db } = makeTempDb();
  const mapId = makeMap(db);
  addToken(db, mapId, { kind: 'pc', name: 'Hero', x: 5, y: 5, light_type: 'torch', owner_id: 1 });
  addToken(db, mapId, { kind: 'monster', name: 'Goblin', x: 6, y: 5 });
  recomputeFog(db, () => {}, mapId);
  const newId = duplicateMap(db, mapId);
  assert.ok(newId);
  const ex = db.prepare('SELECT COUNT(*) c FROM explored_cells WHERE map_id=?').get(newId).c;
  const mem = db.prepare('SELECT COUNT(*) c FROM cell_memory WHERE map_id=?').get(newId).c;
  assert.equal(ex, 0, 'duplicated map starts unexplored');
  assert.equal(mem, 0, 'duplicated map has no memory');
});

test('party PC tokens are never written to cell_memory', () => {
  const { db } = makeTempDb();
  const mapId = makeMap(db);
  const heroId = addToken(db, mapId, { kind: 'pc', name: 'Hero', x: 5, y: 5, light_type: 'torch', owner_id: 1 });
  recomputeFog(db, () => {}, mapId);
  // While lit there should be no snapshot for the PC.
  let row = db.prepare('SELECT * FROM cell_memory WHERE map_id=? AND token_id=?').all(mapId, heroId);
  assert.equal(row.length, 0, 'PC never snapshotted while lit');
  // Move PC away — cell (5,5) becomes fogged but no snapshot of PC should have been frozen.
  db.prepare('UPDATE tokens SET x=?, y=? WHERE id=?').run(15, 15, heroId);
  recomputeFog(db, () => {}, mapId);
  row = db.prepare('SELECT * FROM cell_memory WHERE map_id=? AND token_id=?').all(mapId, heroId);
  assert.equal(row.length, 0, 'PC has no memory rows even after moving away');
});

test('player-owned tokens (owner_id != null) are never snapshotted', () => {
  const { db } = makeTempDb();
  const mapId = makeMap(db);
  const heroId = addToken(db, mapId, { kind: 'pc', name: 'Hero', x: 5, y: 5, light_type: 'torch', owner_id: 1 });
  // A player-owned NPC (e.g. familiar) — kind isn't 'pc' but owner_id is set.
  const familiarId = addToken(db, mapId, { kind: 'npc', name: 'Owl', x: 6, y: 5, owner_id: 2 });
  recomputeFog(db, () => {}, mapId);
  let rows = db.prepare('SELECT * FROM cell_memory WHERE map_id=? AND token_id=?').all(mapId, familiarId);
  assert.equal(rows.length, 0, 'player-owned token not snapshotted while lit');
  db.prepare('UPDATE tokens SET x=?, y=? WHERE id=?').run(15, 15, heroId);
  recomputeFog(db, () => {}, mapId);
  rows = db.prepare('SELECT * FROM cell_memory WHERE map_id=? AND token_id=?').all(mapId, familiarId);
  assert.equal(rows.length, 0, 'player-owned token still not in memory after cell goes dark');
});

test('monster memory clears when monster becomes visible elsewhere', () => {
  const { db } = makeTempDb();
  const mapId = makeMap(db);
  const heroId = addToken(db, mapId, { kind: 'pc', name: 'Hero', x: 5, y: 5, light_type: 'torch', owner_id: 1 });
  const goblinId = addToken(db, mapId, { kind: 'monster', name: 'Goblin', x: 6, y: 5 });
  recomputeFog(db, () => {}, mapId);
  // Hero leaves; (6,5) goes dark; stale memory for goblin remains at (6,5).
  db.prepare('UPDATE tokens SET x=?, y=? WHERE id=?').run(2, 2, heroId);
  recomputeFog(db, () => {}, mapId);
  let stale = db.prepare('SELECT * FROM cell_memory WHERE map_id=? AND cx=? AND cy=? AND token_id=?')
    .get(mapId, 6, 5, goblinId);
  assert.ok(stale, 'stale memory at (6,5) before re-sighting');
  // DM moves goblin to (3,2), which is adjacent to hero at (2,2) and therefore lit.
  db.prepare('UPDATE tokens SET x=?, y=? WHERE id=?').run(3, 2, goblinId);
  recomputeFog(db, () => {}, mapId);
  // Goblin is now currently visible at (3,2) — all stale memory rows should be cleared.
  stale = db.prepare('SELECT * FROM cell_memory WHERE map_id=? AND cx=? AND cy=? AND token_id=?')
    .get(mapId, 6, 5, goblinId);
  assert.equal(stale, undefined, 'stale (6,5) memory cleared because goblin is currently lit');
  // A fresh snapshot exists at the goblin's current cell (it's lit, so it gets re-snapshotted).
  const fresh = db.prepare('SELECT * FROM cell_memory WHERE map_id=? AND cx=? AND cy=? AND token_id=?')
    .get(mapId, 3, 2, goblinId);
  assert.ok(fresh, 'fresh snapshot recorded at goblin current cell');
});

test('two monsters in same cell: only the re-sighted one clears', () => {
  const { db } = makeTempDb();
  const mapId = makeMap(db);
  const heroId = addToken(db, mapId, { kind: 'pc', name: 'Hero', x: 5, y: 5, light_type: 'torch', owner_id: 1 });
  const gobId = addToken(db, mapId, { kind: 'monster', name: 'Goblin', x: 6, y: 5 });
  const orcId = addToken(db, mapId, { kind: 'monster', name: 'Orc',    x: 6, y: 5 });
  recomputeFog(db, () => {}, mapId);
  // Hero leaves; cell goes dark with both snapshots intact.
  db.prepare('UPDATE tokens SET x=?, y=? WHERE id=?').run(2, 2, heroId);
  recomputeFog(db, () => {}, mapId);
  let rows = db.prepare('SELECT token_id FROM cell_memory WHERE map_id=? AND cx=? AND cy=?')
    .all(mapId, 6, 5);
  const ids = new Set(rows.map(r => r.token_id));
  assert.ok(ids.has(gobId) && ids.has(orcId), 'both monsters remembered at (6,5)');
  // Move only the goblin into the hero's torch radius.
  db.prepare('UPDATE tokens SET x=?, y=? WHERE id=?').run(3, 2, gobId);
  recomputeFog(db, () => {}, mapId);
  const stillGob = db.prepare('SELECT * FROM cell_memory WHERE map_id=? AND cx=? AND cy=? AND token_id=?')
    .get(mapId, 6, 5, gobId);
  const stillOrc = db.prepare('SELECT * FROM cell_memory WHERE map_id=? AND cx=? AND cy=? AND token_id=?')
    .get(mapId, 6, 5, orcId);
  assert.equal(stillGob, undefined, 'goblin memory at (6,5) cleared after re-sighting');
  assert.ok(stillOrc, 'orc memory at (6,5) still present (orc not re-sighted)');
});

test('computeMemoryTokensFromDb only returns tokens in fogged cells', () => {
  const { db } = makeTempDb();
  const mapId = makeMap(db);
  const heroId = addToken(db, mapId, { kind: 'pc', name: 'Hero', x: 5, y: 5, light_type: 'torch', owner_id: 1 });
  addToken(db, mapId, { kind: 'monster', name: 'Goblin', x: 6, y: 5 });
  recomputeFog(db, () => {}, mapId);
  // While still lit, computeMemoryTokensFromDb should NOT return (6,5).
  let fogStr = db.prepare('SELECT data FROM fog WHERE map_id=?').get(mapId).data;
  let fogSet = new Set(JSON.parse(fogStr));
  let mt = computeMemoryTokensFromDb(db, mapId, fogSet);
  assert.equal(mt.find(m => m.cx === 6 && m.cy === 5), undefined,
    'lit cell should not appear in memory payload');
  // Move hero away so (6,5) is fogged-and-explored.
  db.prepare('UPDATE tokens SET x=?, y=? WHERE id=?').run(15, 15, heroId);
  recomputeFog(db, () => {}, mapId);
  fogStr = db.prepare('SELECT data FROM fog WHERE map_id=?').get(mapId).data;
  fogSet = new Set(JSON.parse(fogStr));
  mt = computeMemoryTokensFromDb(db, mapId, fogSet);
  const found = mt.find(m => m.cx === 6 && m.cy === 5);
  assert.ok(found, '(6,5) snapshot returned once the cell is fogged');
  assert.equal(found.snapshot.name, 'Goblin');
});
