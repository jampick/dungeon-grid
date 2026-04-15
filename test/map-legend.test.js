import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createMap } from '../lib/maps.js';
import { formatLegendText } from '../lib/logic.js';

// Build a temp DB whose schema mirrors a *legacy* maps table (no cell_feet),
// then apply the migration the same way server.js does at startup. This way
// the test exercises both the column-add migration and the new default.
function makeTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dgrid-legend-'));
  const db = new Database(path.join(dir, 'grid.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE campaigns (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER
    );
    CREATE TABLE maps (
      id INTEGER PRIMARY KEY,
      campaign_id INTEGER,
      name TEXT,
      grid_type TEXT DEFAULT 'square',
      grid_size INTEGER DEFAULT 50,
      width INTEGER DEFAULT 30,
      height INTEGER DEFAULT 20,
      background TEXT,
      active INTEGER DEFAULT 0
    );
  `);
  // Mirror the server.js migration block.
  try { db.exec("ALTER TABLE maps ADD COLUMN cell_feet INTEGER DEFAULT 5"); } catch {}
  const info = db.prepare('INSERT INTO campaigns (name, created_at) VALUES (?, ?)').run('C', Date.now());
  return { db, campaignId: info.lastInsertRowid };
}

test('migration adds cell_feet column to legacy maps table', () => {
  const { db } = makeTempDb();
  const cols = db.prepare("PRAGMA table_info(maps)").all().map(c => c.name);
  assert.ok(cols.includes('cell_feet'), 'cell_feet column should exist after migration');
});

test('createMap defaults cell_feet to 5 when unspecified', () => {
  const { db, campaignId } = makeTempDb();
  const id = createMap(db, campaignId, { name: 'M' });
  const row = db.prepare('SELECT cell_feet FROM maps WHERE id=?').get(id);
  assert.equal(row.cell_feet, 5);
});

test('createMap honors explicit cell_feet value', () => {
  const { db, campaignId } = makeTempDb();
  const id = createMap(db, campaignId, { name: 'M', cell_feet: 10 });
  const row = db.prepare('SELECT cell_feet FROM maps WHERE id=?').get(id);
  assert.equal(row.cell_feet, 10);
});

test('UPDATE on cell_feet persists', () => {
  const { db, campaignId } = makeTempDb();
  const id = createMap(db, campaignId, { name: 'M' });
  db.prepare('UPDATE maps SET cell_feet=? WHERE id=?').run(20, id);
  const row = db.prepare('SELECT cell_feet FROM maps WHERE id=?').get(id);
  assert.equal(row.cell_feet, 20);
});

test('formatLegendText returns expected strings', () => {
  assert.equal(formatLegendText(5), '1 sq = 5 ft');
  assert.equal(formatLegendText(10), '1 sq = 10 ft');
  assert.equal(formatLegendText(1), '1 sq = 1 ft');
  assert.equal(formatLegendText(100), '1 sq = 100 ft');
});

test('formatLegendText falls back to 5 for invalid input', () => {
  assert.equal(formatLegendText(undefined), '1 sq = 5 ft');
  assert.equal(formatLegendText(0), '1 sq = 5 ft');
  assert.equal(formatLegendText(-3), '1 sq = 5 ft');
  assert.equal(formatLegendText(NaN), '1 sq = 5 ft');
});
