import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldQueueLightChange } from '../lib/logic.js';

const baseToken = {
  id: 1,
  name: 'Harlen',
  light_type: 'torch',
  light_radius: 3,
  owner_id: 42,
};

test('shouldQueueLightChange: player changing light_type with approval on => queue', () => {
  const q = shouldQueueLightChange(
    'player',
    { id: 1, light_type: 'bullseye', light_radius: 12 },
    baseToken,
    { light_approval: 1 },
  );
  assert.equal(q, true);
});

test('shouldQueueLightChange: approval off => direct apply (no queue)', () => {
  const q = shouldQueueLightChange(
    'player',
    { id: 1, light_type: 'bullseye', light_radius: 12 },
    baseToken,
    { light_approval: 0 },
  );
  assert.equal(q, false);
});

test('shouldQueueLightChange: name-only update does not queue even with approval on', () => {
  const q = shouldQueueLightChange(
    'player',
    { id: 1, name: 'Harlen the Bold' },
    baseToken,
    { light_approval: 1 },
  );
  assert.equal(q, false);
});

test('shouldQueueLightChange: DM always bypasses queue', () => {
  const q = shouldQueueLightChange(
    'dm',
    { id: 1, light_type: 'bullseye', light_radius: 12 },
    baseToken,
    { light_approval: 1 },
  );
  assert.equal(q, false);
});

test('shouldQueueLightChange: unchanged light_type does not queue', () => {
  const q = shouldQueueLightChange(
    'player',
    { id: 1, light_type: 'torch', light_radius: 3 },
    baseToken,
    { light_approval: 1 },
  );
  assert.equal(q, false);
});

test('shouldQueueLightChange: radius-only change queues', () => {
  const q = shouldQueueLightChange(
    'player',
    { id: 1, light_radius: 5 },
    baseToken,
    { light_approval: 1 },
  );
  assert.equal(q, true);
});

// Integration-ish DB test: simulate the strip-and-apply logic end-to-end on an
// in-memory sqlite DB to verify that with light_approval=1 the light fields
// are NOT persisted while a simultaneous name change IS persisted, and that
// with light_approval=0 everything applies.
import Database from 'better-sqlite3';

function mkDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE campaigns (id INTEGER PRIMARY KEY, light_approval INTEGER DEFAULT 1);
    CREATE TABLE tokens (
      id INTEGER PRIMARY KEY,
      name TEXT,
      light_type TEXT DEFAULT 'none',
      light_radius INTEGER DEFAULT 0,
      owner_id INTEGER
    );
  `);
  db.prepare('INSERT INTO campaigns (id, light_approval) VALUES (1, 1)').run();
  db.prepare("INSERT INTO tokens (id, name, light_type, light_radius, owner_id) VALUES (1, 'Harlen', 'torch', 3, 42)").run();
  return db;
}

// Mirrors the server's token:update handler behavior for the light-queue path.
function applyUpdate(db, role, data) {
  const t = db.prepare('SELECT * FROM tokens WHERE id=?').get(data.id);
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id=1').get();
  let queued = false;
  if (shouldQueueLightChange(role, data, t, campaign)) {
    queued = true;
    data = { ...data };
    delete data.light_type;
    delete data.light_radius;
  }
  const fields = ['name','light_type','light_radius'];
  const sets = [], vals = [];
  for (const f of fields) if (f in data) { sets.push(`${f}=?`); vals.push(data[f]); }
  if (sets.length) {
    vals.push(data.id);
    db.prepare(`UPDATE tokens SET ${sets.join(',')} WHERE id=?`).run(...vals);
  }
  return { queued };
}

test('integration: player light change with approval=1 is not persisted', () => {
  const db = mkDb();
  const res = applyUpdate(db, 'player', { id: 1, light_type: 'bullseye', light_radius: 12 });
  assert.equal(res.queued, true);
  const row = db.prepare('SELECT * FROM tokens WHERE id=1').get();
  assert.equal(row.light_type, 'torch');
  assert.equal(row.light_radius, 3);
});

test('integration: player light change with approval=0 applies directly', () => {
  const db = mkDb();
  db.prepare('UPDATE campaigns SET light_approval=0 WHERE id=1').run();
  const res = applyUpdate(db, 'player', { id: 1, light_type: 'bullseye', light_radius: 12 });
  assert.equal(res.queued, false);
  const row = db.prepare('SELECT * FROM tokens WHERE id=1').get();
  assert.equal(row.light_type, 'bullseye');
  assert.equal(row.light_radius, 12);
});

test('integration: combined name + light change — name applies, light is queued', () => {
  const db = mkDb();
  const res = applyUpdate(db, 'player', { id: 1, name: 'Harlen the Bold', light_type: 'bullseye', light_radius: 12 });
  assert.equal(res.queued, true);
  const row = db.prepare('SELECT * FROM tokens WHERE id=1').get();
  assert.equal(row.name, 'Harlen the Bold');
  assert.equal(row.light_type, 'torch');
  assert.equal(row.light_radius, 3);
});

test('integration: DM light change always applies directly', () => {
  const db = mkDb();
  const res = applyUpdate(db, 'dm', { id: 1, light_type: 'bullseye', light_radius: 12 });
  assert.equal(res.queued, false);
  const row = db.prepare('SELECT * FROM tokens WHERE id=1').get();
  assert.equal(row.light_type, 'bullseye');
  assert.equal(row.light_radius, 12);
});
