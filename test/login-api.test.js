import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { loginDm, loginPlayer } from '../lib/logic.js';

function makeTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dgrid-login-'));
  const db = new Database(path.join(dir, 'grid.db'));
  db.exec(`
    CREATE TABLE campaigns (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER
    );
    CREATE TABLE players (
      id INTEGER PRIMARY KEY,
      campaign_id INTEGER,
      name TEXT,
      token TEXT UNIQUE,
      role TEXT DEFAULT 'player'
    );
  `);
  db.prepare('INSERT INTO campaigns (name, created_at) VALUES (?, ?)').run('Test', Date.now());
  return db;
}

// Deterministic token generator so we can assert exact values.
function makeTokenFactory(prefix = 'tok') {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

const DM_PW = 'secret';

test('loginDm: correct password returns ok with dm role and a token', () => {
  const db = makeTempDb();
  const r = loginDm(db, { password: DM_PW, name: 'Gary' }, {
    dmPassword: DM_PW,
    newToken: makeTokenFactory('dm'),
  });
  assert.equal(r.ok, true);
  assert.equal(r.role, 'dm');
  assert.equal(r.name, 'Gary');
  assert.equal(r.token, 'dm-1');
  assert.ok(Number.isInteger(r.playerId));
});

test('loginDm: wrong password returns ok:false with 401', () => {
  const db = makeTempDb();
  const r = loginDm(db, { password: 'nope' }, {
    dmPassword: DM_PW,
    newToken: makeTokenFactory(),
  });
  assert.equal(r.ok, false);
  assert.equal(r.status, 401);
  assert.match(r.error, /password/i);
});

test('loginDm: missing password returns ok:false', () => {
  const db = makeTempDb();
  const r = loginDm(db, {}, {
    dmPassword: DM_PW,
    newToken: makeTokenFactory(),
  });
  assert.equal(r.ok, false);
  assert.equal(r.status, 401);
});

test('loginDm: two successful logins reuse the same dm row', () => {
  const db = makeTempDb();
  const deps = { dmPassword: DM_PW, newToken: makeTokenFactory('dm') };
  const a = loginDm(db, { password: DM_PW, name: 'Gary' }, deps);
  const b = loginDm(db, { password: DM_PW, name: 'Somebody Else' }, deps);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.playerId, b.playerId, 'DM row should be reused');
  assert.equal(a.token, b.token, 'token should be stable across re-login');
  // Only one dm row should exist.
  const dmCount = db.prepare("SELECT COUNT(*) c FROM players WHERE role='dm'").get().c;
  assert.equal(dmCount, 1);
});

test('loginPlayer: new name creates a player row with role=player and a token', () => {
  const db = makeTempDb();
  const r = loginPlayer(db, { name: 'Alice' }, { newToken: makeTokenFactory('p') });
  assert.equal(r.ok, true);
  assert.equal(r.role, 'player');
  assert.equal(r.name, 'Alice');
  assert.equal(r.token, 'p-1');
  assert.ok(Number.isInteger(r.playerId));
});

test('loginPlayer: missing name returns ok:false with 400', () => {
  const db = makeTempDb();
  const r = loginPlayer(db, {}, { newToken: makeTokenFactory() });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.match(r.error, /name/i);
});

test('loginPlayer: two logins with same name reuse the existing row', () => {
  const db = makeTempDb();
  const deps = { newToken: makeTokenFactory('p') };
  const a = loginPlayer(db, { name: 'Alice' }, deps);
  const b = loginPlayer(db, { name: 'Alice' }, deps);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.playerId, b.playerId);
  assert.equal(a.token, b.token);
  const aliceCount = db.prepare("SELECT COUNT(*) c FROM players WHERE name='Alice'").get().c;
  assert.equal(aliceCount, 1);
});
