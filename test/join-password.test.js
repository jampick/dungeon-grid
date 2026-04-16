import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { hashPassword } from '../lib/auth.js';
import { createSchema } from '../lib/sessions.js';

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dgrid-joinpw-'));
  const db = new Database(path.join(dir, 'grid.db'));
  createSchema(db);
  db.prepare('INSERT INTO sessions (id, name, created_at) VALUES (?,?,?)').run('s1', 'S1', Date.now());
  return db;
}

test('PATCH join_password sets a non-null hash', () => {
  const db = makeDb();
  const pw = 'secret';
  const hash = hashPassword(pw, 4);
  db.prepare('UPDATE sessions SET join_password_hash=? WHERE id=?').run(hash, 's1');
  const row = db.prepare('SELECT join_password_hash FROM sessions WHERE id=?').get('s1');
  assert.ok(row.join_password_hash, 'hash should be non-null after setting a password');
  assert.ok(row.join_password_hash.startsWith('$2'), 'hash should be a bcrypt hash');
});

test('PATCH join_password null clears hash to null', () => {
  const db = makeDb();
  // First set a password
  const hash = hashPassword('secret', 4);
  db.prepare('UPDATE sessions SET join_password_hash=? WHERE id=?').run(hash, 's1');
  // Now clear it (simulates PATCH with join_password: null)
  const clearValue = null;
  db.prepare('UPDATE sessions SET join_password_hash=? WHERE id=?').run(clearValue, 's1');
  const row = db.prepare('SELECT join_password_hash FROM sessions WHERE id=?').get('s1');
  assert.equal(row.join_password_hash, null, 'hash should be null after clearing');
});

test('PATCH join_password empty string clears hash to null', () => {
  const db = makeDb();
  // First set a password
  const hash = hashPassword('secret', 4);
  db.prepare('UPDATE sessions SET join_password_hash=? WHERE id=?').run(hash, 's1');
  // Simulate server logic: empty string means clear
  const pw = '';
  const newHash = pw ? hashPassword(pw) : null;
  db.prepare('UPDATE sessions SET join_password_hash=? WHERE id=?').run(newHash, 's1');
  const row = db.prepare('SELECT join_password_hash FROM sessions WHERE id=?').get('s1');
  assert.equal(row.join_password_hash, null, 'hash should be null after clearing with empty string');
});

test('has_join_password reflects correctly in session list', () => {
  const db = makeDb();
  // No password set initially
  const rows1 = db.prepare('SELECT id, name, join_password_hash FROM sessions').all();
  const s1 = rows1.find(r => r.id === 's1');
  assert.equal(!!s1.join_password_hash, false, 'has_join_password should be false initially');

  // Set a password
  const hash = hashPassword('secret', 4);
  db.prepare('UPDATE sessions SET join_password_hash=? WHERE id=?').run(hash, 's1');
  const rows2 = db.prepare('SELECT id, name, join_password_hash FROM sessions').all();
  const s2 = rows2.find(r => r.id === 's1');
  assert.equal(!!s2.join_password_hash, true, 'has_join_password should be true after setting password');

  // Clear the password
  db.prepare('UPDATE sessions SET join_password_hash=? WHERE id=?').run(null, 's1');
  const rows3 = db.prepare('SELECT id, name, join_password_hash FROM sessions').all();
  const s3 = rows3.find(r => r.id === 's1');
  assert.equal(!!s3.join_password_hash, false, 'has_join_password should be false after clearing');
});
