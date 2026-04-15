import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { hashPassword, verifyPassword } from '../lib/auth.js';
import { createSchema } from '../lib/sessions.js';
import { loginPlayer, loginDm } from '../lib/logic.js';

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dgrid-auth-'));
  const db = new Database(path.join(dir, 'grid.db'));
  createSchema(db);
  db.prepare('INSERT INTO sessions (id, name, created_at) VALUES (?,?,?)').run('s1', 'S1', Date.now());
  return db;
}

test('hashPassword / verifyPassword roundtrip (cost 4 for speed)', () => {
  const hash = hashPassword('hunter2', 4);
  assert.ok(hash.startsWith('$2'));
  assert.equal(verifyPassword('hunter2', hash), true);
  assert.equal(verifyPassword('wrong', hash), false);
  assert.equal(verifyPassword('', hash), false);
  assert.equal(verifyPassword('hunter2', ''), false);
});

test('hashPassword refuses empty / non-string input', () => {
  assert.throws(() => hashPassword(''), /password required/);
  assert.throws(() => hashPassword(null), /password required/);
});

test('loginPlayer happy path in a session with no join password', () => {
  const db = makeDb();
  let n = 0;
  const r = loginPlayer(db, { session_id: 's1', name: 'Alice' }, {
    newToken: () => `tok-${++n}`,
  });
  assert.equal(r.ok, true);
  assert.equal(r.session_id, 's1');
  assert.equal(r.token, 'tok-1');
  assert.equal(r.name, 'Alice');
});

test('loginPlayer with wrong join password is rejected', () => {
  const db = makeDb();
  const hash = hashPassword('letmein', 4);
  db.prepare('UPDATE sessions SET join_password_hash=? WHERE id=?').run(hash, 's1');
  const r = loginPlayer(db, { session_id: 's1', name: 'Alice', join_password: 'wrong' }, {
    newToken: () => 'tok-1',
    verifyJoin: verifyPassword,
  });
  assert.equal(r.ok, false);
  assert.equal(r.status, 401);
  // Correct password succeeds.
  const ok = loginPlayer(db, { session_id: 's1', name: 'Alice', join_password: 'letmein' }, {
    newToken: () => 'tok-ok',
    verifyJoin: verifyPassword,
  });
  assert.equal(ok.ok, true);
});

test('loginPlayer rejects missing session_id', () => {
  const db = makeDb();
  const r = loginPlayer(db, { name: 'Alice' }, { newToken: () => 'x' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test('loginDm uses verifyDm callback', () => {
  const db = makeDb();
  const hash = hashPassword('dmpw', 4);
  let n = 0;
  const deps = {
    verifyDm: (pw) => verifyPassword(pw, hash),
    newToken: () => `dm-${++n}`,
  };
  const ok = loginDm(db, { session_id: 's1', password: 'dmpw', name: 'Gary' }, deps);
  assert.equal(ok.ok, true);
  assert.equal(ok.role, 'dm');
  const bad = loginDm(db, { session_id: 's1', password: 'nope' }, deps);
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 401);
});
