import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { snapshotMap } from '../lib/logic.js';

function makeTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dgrid-clearbg-'));
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
  `);
  return db;
}

test('UPDATE maps SET background=NULL clears the background column', () => {
  const db = makeTempDb();
  const info = db.prepare(
    'INSERT INTO maps (session_id, name, background) VALUES (?,?,?)'
  ).run(1, 'M', '/uploads/bg.png');
  const id = info.lastInsertRowid;
  assert.equal(db.prepare('SELECT background FROM maps WHERE id=?').get(id).background, '/uploads/bg.png');

  db.prepare('UPDATE maps SET background=? WHERE id=?').run(null, id);
  const row = db.prepare('SELECT background FROM maps WHERE id=?').get(id);
  assert.equal(row.background, null);
});

test('snapshotMap captures background so undo can restore it', () => {
  const db = makeTempDb();
  const info = db.prepare(
    'INSERT INTO maps (session_id, name, background) VALUES (?,?,?)'
  ).run(1, 'M', '/uploads/original.png');
  const id = info.lastInsertRowid;

  const prev = snapshotMap(db, id);
  assert.equal(prev.background, '/uploads/original.png');

  // Simulate the clear-bg UPDATE
  db.prepare('UPDATE maps SET background=? WHERE id=?').run(null, id);
  assert.equal(db.prepare('SELECT background FROM maps WHERE id=?').get(id).background, null);

  // Simulate undo inverse using the snapshot
  db.prepare('UPDATE maps SET background=? WHERE id=?').run(prev.background, id);
  assert.equal(db.prepare('SELECT background FROM maps WHERE id=?').get(id).background, '/uploads/original.png');
});
