import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createSchema, deleteSession } from '../lib/sessions.js';

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dgrid-cascade-'));
  const db = new Database(path.join(dir, 'grid.db'));
  createSchema(db);
  return { db, dir };
}

function seedNested(db, sid) {
  db.prepare('INSERT INTO sessions (id, name, created_at) VALUES (?,?,?)').run(sid, sid, Date.now());
  const info = db.prepare('INSERT INTO maps (session_id, name, active) VALUES (?,?,1)').run(sid, 'M');
  const mapId = info.lastInsertRowid;
  db.prepare('INSERT INTO tokens (map_id, kind, name, x, y) VALUES (?,?,?,?,?)').run(mapId, 'pc', 'T', 1, 1);
  db.prepare('INSERT INTO walls (map_id, cx, cy, side, kind, open) VALUES (?,?,?,?,?,?)').run(mapId, 0, 0, 'n', 'wall', 0);
  db.prepare('INSERT INTO fog (map_id, data) VALUES (?,?)').run(mapId, '[]');
  db.prepare('INSERT INTO explored_cells (map_id, cx, cy) VALUES (?,?,?)').run(mapId, 1, 1);
  db.prepare('INSERT INTO cell_memory (map_id, cx, cy, token_id, snapshot) VALUES (?,?,?,?,?)').run(mapId, 1, 1, 1, '{}');
  db.prepare('INSERT INTO terrain (map_id, cx, cy, kind) VALUES (?,?,?,?)').run(mapId, 1, 1, 'grass');
  db.prepare('INSERT INTO players (session_id, name, token, role) VALUES (?,?,?,?)').run(sid, 'Alice', `tok-${sid}`, 'player');
  db.prepare('INSERT INTO catalog (session_id, name, kind) VALUES (?,?,?)').run(sid, 'Goblin', 'npc');
  return mapId;
}

test('deleteSession wipes all nested rows for that session', () => {
  const { db } = makeDb();
  const mapA = seedNested(db, 'a');
  seedNested(db, 'b'); // keep a second session as control
  deleteSession(db, 'a', null);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM sessions WHERE id=?').get('a').c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM maps WHERE session_id=?').get('a').c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM tokens WHERE map_id=?').get(mapA).c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM walls WHERE map_id=?').get(mapA).c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM fog WHERE map_id=?').get(mapA).c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM explored_cells WHERE map_id=?').get(mapA).c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM cell_memory WHERE map_id=?').get(mapA).c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM terrain WHERE map_id=?').get(mapA).c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM players WHERE session_id=?').get('a').c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM catalog WHERE session_id=?').get('a').c, 0);
  // Session B survives intact.
  assert.equal(db.prepare('SELECT COUNT(*) c FROM sessions WHERE id=?').get('b').c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM maps WHERE session_id=?').get('b').c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM players WHERE session_id=?').get('b').c, 1);
});

test('deleteSession removes the uploads directory', () => {
  const { db, dir } = makeDb();
  seedNested(db, 'a');
  const uploadsDir = path.join(dir, 'uploads');
  const sessionUploads = path.join(uploadsDir, 'a');
  fs.mkdirSync(sessionUploads, { recursive: true });
  fs.writeFileSync(path.join(sessionUploads, 'x.png'), 'fake');
  deleteSession(db, 'a', uploadsDir);
  assert.equal(fs.existsSync(sessionUploads), false);
});
