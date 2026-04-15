import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { reassignOwnedTokensToNull } from '../lib/logic.js';

function makeTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dgrid-ownerdc-'));
  const db = new Database(path.join(dir, 'grid.db'));
  db.exec(`
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
  `);
  return db;
}

test('reassignOwnedTokensToNull only nulls tokens owned by target player on target map', () => {
  const db = makeTempDb();
  const ins = db.prepare('INSERT INTO tokens (map_id, name, owner_id, x, y) VALUES (?,?,?,?,?)');
  ins.run(1, 'A', 5, 0, 0);
  ins.run(1, 'B', 5, 1, 1);
  ins.run(1, 'C', 6, 2, 2);

  const changes = reassignOwnedTokensToNull(db, 1, 5);
  assert.equal(changes, 2);

  const rows = db.prepare('SELECT name, owner_id FROM tokens ORDER BY id').all();
  assert.equal(rows.find(r => r.name === 'A').owner_id, null);
  assert.equal(rows.find(r => r.name === 'B').owner_id, null);
  assert.equal(rows.find(r => r.name === 'C').owner_id, 6);
});

test('reassignOwnedTokensToNull does not touch other maps', () => {
  const db = makeTempDb();
  const ins = db.prepare('INSERT INTO tokens (map_id, name, owner_id, x, y) VALUES (?,?,?,?,?)');
  ins.run(1, 'on-map-1', 5, 0, 0);
  ins.run(2, 'on-map-2', 5, 0, 0);

  const changes = reassignOwnedTokensToNull(db, 1, 5);
  assert.equal(changes, 1);
  assert.equal(db.prepare("SELECT owner_id FROM tokens WHERE name='on-map-2'").get().owner_id, 5);
  assert.equal(db.prepare("SELECT owner_id FROM tokens WHERE name='on-map-1'").get().owner_id, null);
});

test('reassignOwnedTokensToNull with null playerId is a no-op', () => {
  const db = makeTempDb();
  db.prepare('INSERT INTO tokens (map_id, name, owner_id, x, y) VALUES (?,?,?,?,?)').run(1, 'X', 5, 0, 0);
  assert.equal(reassignOwnedTokensToNull(db, 1, null), 0);
  assert.equal(db.prepare("SELECT owner_id FROM tokens WHERE name='X'").get().owner_id, 5);
});
