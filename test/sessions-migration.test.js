import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrate, seedDefaultSession } from '../lib/sessions.js';
import { hashPassword, verifyPassword } from '../lib/auth.js';

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dgrid-migrate-'));
  return new Database(path.join(dir, 'grid.db'));
}

test('migrate on fresh db creates the sessions + maps + players schema', () => {
  const db = freshDb();
  const r = migrate(db);
  assert.equal(r.migrated, true);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
  for (const t of ['sessions','instance_settings','maps','tokens','players','catalog','fog','walls','explored_cells','cell_memory','terrain']) {
    assert.ok(tables.includes(t), `missing table ${t}`);
  }
  // sessions.id is TEXT PRIMARY KEY
  const cols = db.prepare("PRAGMA table_info(sessions)").all();
  const idCol = cols.find(c => c.name === 'id');
  assert.equal(idCol.type, 'TEXT');
  assert.equal(idCol.pk, 1);
});

test('seedDefaultSession inserts default session and is idempotent', () => {
  const db = freshDb();
  migrate(db);
  assert.equal(seedDefaultSession(db), true);
  assert.equal(seedDefaultSession(db), false);
  const row = db.prepare('SELECT id, name FROM sessions WHERE id=?').get('default');
  assert.equal(row.id, 'default');
  assert.equal(row.name, 'Default');
});

test('migrate on an already-migrated db is a no-op (preserves rows)', () => {
  const db = freshDb();
  migrate(db);
  seedDefaultSession(db);
  db.prepare('INSERT INTO sessions (id, name, created_at) VALUES (?,?,?)').run('keepme','Keep',Date.now());
  const before = db.prepare('SELECT COUNT(*) c FROM sessions').get().c;
  const r = migrate(db);
  assert.equal(r.migrated, false);
  const after = db.prepare('SELECT COUNT(*) c FROM sessions').get().c;
  assert.equal(after, before);
  assert.ok(db.prepare('SELECT id FROM sessions WHERE id=?').get('keepme'));
});

test('migrate drops legacy campaigns table and recreates', () => {
  const db = freshDb();
  // Simulate a legacy db.
  db.exec(`
    CREATE TABLE campaigns (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE maps (id INTEGER PRIMARY KEY, campaign_id INTEGER, name TEXT);
  `);
  db.prepare('INSERT INTO campaigns (name) VALUES (?)').run('old');
  const r = migrate(db);
  assert.equal(r.migrated, true);
  // campaigns should be gone
  const legacy = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='campaigns'").get();
  assert.equal(legacy, undefined);
  // maps recreated with session_id TEXT
  const cols = db.prepare('PRAGMA table_info(maps)').all();
  const sid = cols.find(c => c.name === 'session_id');
  assert.ok(sid);
  assert.equal(sid.type, 'TEXT');
});

test('bcrypt hash of DM_PASSWORD stored in instance_settings can be verified', () => {
  const db = freshDb();
  migrate(db);
  const hash = hashPassword('envpw', 4);
  db.prepare("INSERT INTO instance_settings (key, value) VALUES ('dm_password_hash', ?)").run(hash);
  const row = db.prepare("SELECT value FROM instance_settings WHERE key='dm_password_hash'").get();
  assert.equal(verifyPassword('envpw', row.value), true);
  assert.equal(verifyPassword('wrong', row.value), false);
});
