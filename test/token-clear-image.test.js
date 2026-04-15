import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { snapshotToken, restoreTokenRow } from '../lib/logic.js';

function makeTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dgrid-clearimg-'));
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

test('token:update with image=NULL clears the column', () => {
  const db = makeTempDb();
  const info = db.prepare('INSERT INTO tokens (map_id, name, image, x, y) VALUES (?,?,?,?,?)')
    .run(1, 'A', '/uploads/foo.png', 1, 1);
  const id = info.lastInsertRowid;
  assert.equal(db.prepare('SELECT image FROM tokens WHERE id=?').get(id).image, '/uploads/foo.png');
  // Mirror the server's UPDATE pattern with image=null.
  db.prepare('UPDATE tokens SET image=? WHERE id=?').run(null, id);
  assert.equal(db.prepare('SELECT image FROM tokens WHERE id=?').get(id).image, null);
});

test('snapshotToken / restoreTokenRow round-trips a NULL image', () => {
  const db = makeTempDb();
  const info = db.prepare('INSERT INTO tokens (map_id, name, image, x, y) VALUES (?,?,?,?,?)')
    .run(1, 'B', null, 2, 3);
  const id = info.lastInsertRowid;
  const snap = snapshotToken(db, id);
  assert.equal(snap.image, null);
  // Mutate then restore — snapshot should win.
  db.prepare('UPDATE tokens SET image=? WHERE id=?').run('/uploads/bar.png', id);
  assert.equal(db.prepare('SELECT image FROM tokens WHERE id=?').get(id).image, '/uploads/bar.png');
  restoreTokenRow(db, snap);
  assert.equal(db.prepare('SELECT image FROM tokens WHERE id=?').get(id).image, null);
});

test('snapshotToken captures image column when set', () => {
  const db = makeTempDb();
  const info = db.prepare('INSERT INTO tokens (map_id, name, image, x, y) VALUES (?,?,?,?,?)')
    .run(1, 'C', '/uploads/baz.png', 0, 0);
  const id = info.lastInsertRowid;
  const snap = snapshotToken(db, id);
  assert.equal(snap.image, '/uploads/baz.png');
  // Clear it then restore — should bring back the URL.
  db.prepare('UPDATE tokens SET image=NULL WHERE id=?').run(id);
  restoreTokenRow(db, snap);
  assert.equal(db.prepare('SELECT image FROM tokens WHERE id=?').get(id).image, '/uploads/baz.png');
});
