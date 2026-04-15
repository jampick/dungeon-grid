import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  createUndoStack,
  UNDO_MAX,
  snapshotToken,
  restoreTokenRow,
  snapshotWalls,
  restoreWalls,
} from '../lib/logic.js';

function makeTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dgrid-undo-'));
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
    CREATE TABLE fog (
      map_id INTEGER PRIMARY KEY,
      data TEXT
    );
    CREATE TABLE walls (
      map_id INTEGER,
      cx INTEGER,
      cy INTEGER,
      side TEXT,
      kind TEXT DEFAULT 'wall',
      open INTEGER DEFAULT 0,
      PRIMARY KEY (map_id, cx, cy, side)
    );
  `);
  const info = db.prepare('INSERT INTO maps (name, width, height, active) VALUES (?,?,?,1)').run('M', 20, 20);
  return { db, mapId: info.lastInsertRowid };
}

function makeEmit() {
  const events = [];
  const fn = (ev, payload) => events.push({ ev, payload });
  fn.events = events;
  return fn;
}

test('token move then undo restores position', () => {
  const { db, mapId } = makeTempDb();
  const id = db.prepare('INSERT INTO tokens (map_id, kind, name, x, y) VALUES (?,?,?,?,?)').run(mapId, 'pc', 'Hero', 3, 4).lastInsertRowid;
  const stack = createUndoStack();
  const emit = makeEmit();

  // Simulate handler: snapshot old pos, push inverse, apply
  const before = snapshotToken(db, id);
  stack.push({
    kind: 'token:move',
    label: 'Move Hero',
    inverse: () => {
      db.prepare('UPDATE tokens SET x=?, y=? WHERE id=?').run(before.x, before.y, id);
      emit('token:update', { id, x: before.x, y: before.y });
    },
  });
  db.prepare('UPDATE tokens SET x=?, y=? WHERE id=?').run(10, 10, id);

  // Undo
  const entry = stack.pop();
  entry.inverse();

  const t = db.prepare('SELECT x, y FROM tokens WHERE id=?').get(id);
  assert.equal(t.x, 3);
  assert.equal(t.y, 4);
  assert.ok(emit.events.some(e => e.ev === 'token:update' && e.payload.x === 3 && e.payload.y === 4));
  assert.equal(stack.length, 0);
});

test('token delete then undo reappears with same fields', () => {
  const { db, mapId } = makeTempDb();
  const id = db.prepare('INSERT INTO tokens (map_id, kind, name, x, y, hp_current, hp_max, ac, color) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(mapId, 'npc', 'Goblin', 7, 8, 5, 5, 13, '#aabbcc').lastInsertRowid;
  const prev = snapshotToken(db, id);

  const stack = createUndoStack();
  stack.push({
    kind: 'token:delete',
    label: 'Delete Goblin',
    inverse: () => restoreTokenRow(db, prev),
  });
  db.prepare('DELETE FROM tokens WHERE id=?').run(id);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM tokens WHERE id=?').get(id).c, 0);

  stack.pop().inverse();
  const after = db.prepare('SELECT * FROM tokens WHERE id=?').get(id);
  assert.ok(after);
  assert.equal(after.name, 'Goblin');
  assert.equal(after.x, 7);
  assert.equal(after.y, 8);
  assert.equal(after.hp_current, 5);
  assert.equal(after.ac, 13);
  assert.equal(after.color, '#aabbcc');
});

test('wall create then undo removes wall', () => {
  const { db, mapId } = makeTempDb();
  const stack = createUndoStack();
  const prev = snapshotWalls(db, mapId);
  stack.push({
    kind: 'wall:toggle',
    label: 'Create wall',
    inverse: () => restoreWalls(db, mapId, prev),
  });
  db.prepare("INSERT INTO walls (map_id, cx, cy, side, kind, open) VALUES (?,?,?,?,'wall',0)").run(mapId, 2, 3, 'n');
  assert.equal(snapshotWalls(db, mapId).length, 1);

  stack.pop().inverse();
  assert.equal(snapshotWalls(db, mapId).length, 0);
});

test('undo stack drops oldest past UNDO_MAX', () => {
  const stack = createUndoStack();
  let undoneCount = 0;
  for (let i = 0; i < UNDO_MAX + 1; i++) {
    stack.push({ kind: 'test', label: `e${i}`, inverse: () => { undoneCount++; } });
  }
  assert.equal(stack.length, UNDO_MAX);
  // The oldest (e0) should have been dropped; top is e50
  assert.equal(stack.topLabel(), `e${UNDO_MAX}`);
  // And e0 should not be present
  assert.ok(!stack._entries.some(e => e.label === 'e0'));
});

test('undo with empty stack is a no-op and does not throw', () => {
  const stack = createUndoStack();
  assert.equal(stack.pop(), null);
  // simulate handler pattern
  const entry = stack.pop();
  assert.doesNotThrow(() => { if (entry) entry.inverse(); });
  assert.equal(stack.length, 0);
});
