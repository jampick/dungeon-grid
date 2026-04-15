import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createSchema, seedDefaultSession } from '../lib/sessions.js';
import { createMap, listMaps } from '../lib/maps.js';

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dgrid-iso-'));
  const db = new Database(path.join(dir, 'grid.db'));
  createSchema(db);
  return db;
}

test('maps list scoped by session_id returns only that session\'s maps', () => {
  const db = makeDb();
  const now = Date.now();
  db.prepare('INSERT INTO sessions (id, name, created_at) VALUES (?,?,?)').run('a', 'A', now);
  db.prepare('INSERT INTO sessions (id, name, created_at) VALUES (?,?,?)').run('b', 'B', now);
  const aMap = createMap(db, 'a', { name: 'A1' });
  createMap(db, 'a', { name: 'A2' });
  const bMap = createMap(db, 'b', { name: 'B1' });
  const aList = listMaps(db, 'a');
  const bList = listMaps(db, 'b');
  assert.equal(aList.length, 2);
  assert.equal(bList.length, 1);
  assert.ok(aList.every(m => m.session_id === 'a'));
  assert.ok(bList.every(m => m.session_id === 'b'));
  // Cross-check: tokens on map A are only fetched via map_id; querying
  // B's maps returns none of A's data because listMaps filters by session.
  db.prepare("INSERT INTO tokens (map_id, kind, name, x, y) VALUES (?,?,?,?,?)").run(aMap, 'pc', 'Alice', 1, 1);
  db.prepare("INSERT INTO tokens (map_id, kind, name, x, y) VALUES (?,?,?,?,?)").run(bMap, 'pc', 'Bob', 2, 2);
  const aMapIds = aList.map(m => m.id);
  const placeholders = aMapIds.map(() => '?').join(',');
  const aTokens = db.prepare(`SELECT * FROM tokens WHERE map_id IN (${placeholders})`).all(...aMapIds);
  assert.equal(aTokens.length, 1);
  assert.equal(aTokens[0].name, 'Alice');
});

test('players scoped by session_id do not bleed across sessions', () => {
  const db = makeDb();
  db.prepare('INSERT INTO sessions (id, name, created_at) VALUES (?,?,?)').run('a', 'A', Date.now());
  db.prepare('INSERT INTO sessions (id, name, created_at) VALUES (?,?,?)').run('b', 'B', Date.now());
  db.prepare('INSERT INTO players (session_id, name, token, role) VALUES (?,?,?,?)').run('a','Alice','tok-a1','player');
  db.prepare('INSERT INTO players (session_id, name, token, role) VALUES (?,?,?,?)').run('b','Alice','tok-b1','player');
  const aPlayers = db.prepare('SELECT * FROM players WHERE session_id=?').all('a');
  const bPlayers = db.prepare('SELECT * FROM players WHERE session_id=?').all('b');
  assert.equal(aPlayers.length, 1);
  assert.equal(bPlayers.length, 1);
  assert.notEqual(aPlayers[0].token, bPlayers[0].token);
});

test('seedDefaultSession is idempotent', () => {
  const db = makeDb();
  assert.equal(seedDefaultSession(db), true);
  assert.equal(seedDefaultSession(db), false);
  const rows = db.prepare('SELECT id FROM sessions').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'default');
});
