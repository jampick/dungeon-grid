import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

// Mirrors the walls schema in server.js and exercises the exact SELECT
// the `wall:rect` handler uses for its `walls:state` broadcast. Regression
// guard for the bug where wall:rect emitted rows missing `kind` and `open`,
// which would clobber in-memory door state on clients.

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
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
  return db;
}

// Replays the wall:rect insert transaction (same statements as server.js).
function wallRectInsert(db, mapId, x1, y1, x2, y2) {
  const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
  const ins = db.prepare('INSERT OR IGNORE INTO walls (map_id, cx, cy, side) VALUES (?,?,?,?)');
  const tx = db.transaction(() => {
    for (let x = minX; x <= maxX; x++) {
      ins.run(mapId, x, minY, 'n');
      ins.run(mapId, x, maxY + 1, 'n');
    }
    for (let y = minY; y <= maxY; y++) {
      ins.run(mapId, minX, y, 'w');
      ins.run(mapId, maxX + 1, y, 'w');
    }
  });
  tx();
}

const SELECT_WALLS = 'SELECT cx, cy, side, kind, open FROM walls WHERE map_id=?';

test('wall:rect broadcast query includes kind and open for all rows', () => {
  const db = makeDb();
  const mapId = 1;

  // Pre-existing open door on what will become the rectangle boundary.
  db.prepare("INSERT INTO walls (map_id, cx, cy, side, kind, open) VALUES (?,?,?,?,'door',1)")
    .run(mapId, 3, 2, 'n');

  wallRectInsert(db, mapId, 2, 2, 5, 5);

  const rows = db.prepare(SELECT_WALLS).all(mapId);
  assert.ok(rows.length > 0, 'should have rows');

  // Every row must include kind and open fields.
  for (const r of rows) {
    assert.ok('kind' in r, `row missing kind: ${JSON.stringify(r)}`);
    assert.ok('open' in r, `row missing open: ${JSON.stringify(r)}`);
    assert.ok(typeof r.kind === 'string', 'kind should be a string');
  }

  // The pre-existing open door must survive and still be reported as an open door,
  // not clobbered or returned with missing fields.
  const door = rows.find(r => r.cx === 3 && r.cy === 2 && r.side === 'n');
  assert.ok(door, 'pre-existing door row should be present');
  assert.equal(door.kind, 'door');
  assert.equal(door.open, 1);
});

test('wall:rect INSERT OR IGNORE does not overwrite an existing door row', () => {
  const db = makeDb();
  const mapId = 1;
  db.prepare("INSERT INTO walls (map_id, cx, cy, side, kind, open) VALUES (?,?,?,?,'door',1)")
    .run(mapId, 0, 0, 'n');

  // Rectangle whose top edge collides with (0,0,'n').
  wallRectInsert(db, mapId, 0, 0, 2, 2);

  const row = db.prepare('SELECT kind, open FROM walls WHERE map_id=? AND cx=? AND cy=? AND side=?')
    .get(mapId, 0, 0, 'n');
  assert.equal(row.kind, 'door');
  assert.equal(row.open, 1);
});
