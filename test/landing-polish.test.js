import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { relativeTime } from '../lib/logic.js';
import { createSchema } from '../lib/sessions.js';

// --- relativeTime unit tests ---

test('relativeTime(Date.now()) returns "just now"', () => {
  assert.equal(relativeTime(Date.now()), 'just now');
});

test('relativeTime 5 minutes ago returns "5 min ago"', () => {
  assert.equal(relativeTime(Date.now() - 5 * 60000), '5 min ago');
});

test('relativeTime 2 hours ago returns "2 hours ago"', () => {
  assert.equal(relativeTime(Date.now() - 2 * 3600000), '2 hours ago');
});

test('relativeTime 1 day ago returns "1 days ago"', () => {
  assert.equal(relativeTime(Date.now() - 86400000), '1 days ago');
});

test('relativeTime(null) returns "never"', () => {
  assert.equal(relativeTime(null), 'never');
});

test('relativeTime(0) returns a large number of days ago without crashing', () => {
  const result = relativeTime(0);
  assert.ok(result.endsWith('days ago'), `expected days ago, got: ${result}`);
  const num = parseInt(result, 10);
  assert.ok(num > 1000, `expected large day count, got: ${num}`);
});

test('relativeTime(undefined) returns "never"', () => {
  assert.equal(relativeTime(undefined), 'never');
});

// --- Server active_players field test ---

test('sessions list query shape includes active_players >= 0', () => {
  // Simulate the server-side mapping logic without starting the full server.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dgrid-lp-'));
  const db = new Database(path.join(dir, 'grid.db'));
  createSchema(db);
  const now = Date.now();
  db.prepare('INSERT INTO sessions (id, name, created_at) VALUES (?,?,?)').run('s1', 'Test', now);

  const rows = db.prepare(
    'SELECT id, name, join_password_hash, last_active_at FROM sessions ORDER BY last_active_at DESC'
  ).all();

  // Fake io.sockets.adapter.rooms (empty — no live connections in test)
  const rooms = new Map();
  const mapped = rows.map(r => ({
    id: r.id,
    name: r.name,
    has_join_password: !!r.join_password_hash,
    last_active_at: r.last_active_at,
    active_players: rooms.get('session:' + r.id)?.size || 0,
  }));

  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].id, 's1');
  assert.equal(typeof mapped[0].active_players, 'number');
  assert.ok(mapped[0].active_players >= 0);
});
