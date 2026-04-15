// Session lifecycle helpers. Pure DB (and optional filesystem) operations —
// callers supply the db handle and, for cascade delete, an uploads directory.

import path from 'path';
import fs from 'fs';

// Run the server's session schema on a fresh DB. Safe to call multiple times
// on an already-migrated DB: checked via the presence of the `sessions` table
// by the caller. This function is also exported so tests can reuse the exact
// same schema without drifting.
export function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      join_password_hash TEXT,
      approval_mode INTEGER DEFAULT 0,
      door_approval INTEGER DEFAULT 1,
      light_approval INTEGER DEFAULT 1,
      show_other_hp INTEGER DEFAULT 0,
      ruleset TEXT DEFAULT '1e',
      party_leader_id INTEGER,
      created_at INTEGER,
      last_active_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS instance_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS maps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      name TEXT NOT NULL,
      grid_type TEXT DEFAULT 'square',
      grid_size INTEGER DEFAULT 50,
      width INTEGER DEFAULT 30,
      height INTEGER DEFAULT 20,
      background TEXT,
      active INTEGER DEFAULT 0,
      cell_feet INTEGER DEFAULT 5,
      fog_mode TEXT DEFAULT 'dungeon'
    );
    CREATE TABLE IF NOT EXISTS tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      size INTEGER DEFAULT 1,
      race TEXT,
      move INTEGER DEFAULT 6,
      aoe TEXT,
      link_map_id INTEGER,
      link_x INTEGER,
      link_y INTEGER
    );
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      name TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      role TEXT DEFAULT 'player'
    );
    CREATE TABLE IF NOT EXISTS catalog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      name TEXT,
      kind TEXT,
      image TEXT,
      size INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS fog (
      map_id INTEGER PRIMARY KEY,
      data TEXT
    );
    CREATE TABLE IF NOT EXISTS walls (
      map_id INTEGER,
      cx INTEGER,
      cy INTEGER,
      side TEXT,
      kind TEXT DEFAULT 'wall',
      open INTEGER DEFAULT 0,
      PRIMARY KEY (map_id, cx, cy, side)
    );
    CREATE TABLE IF NOT EXISTS explored_cells (
      map_id INTEGER,
      cx INTEGER,
      cy INTEGER,
      PRIMARY KEY (map_id, cx, cy)
    );
    CREATE TABLE IF NOT EXISTS cell_memory (
      map_id INTEGER,
      cx INTEGER,
      cy INTEGER,
      token_id INTEGER,
      snapshot TEXT,
      PRIMARY KEY (map_id, cx, cy, token_id)
    );
    CREATE TABLE IF NOT EXISTS terrain (
      map_id INTEGER,
      cx INTEGER,
      cy INTEGER,
      kind TEXT,
      PRIMARY KEY (map_id, cx, cy)
    );
  `);
}

// Idempotent migration: if the sessions table already exists with a TEXT id
// column, do nothing. Otherwise drop every legacy table and rebuild from
// createSchema. The user explicitly confirmed destructive migration is OK.
export function migrate(db) {
  const info = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get();
  if (info) {
    // Sessions table present — assume already migrated. Also make sure any
    // tables we rely on exist (fresh dbs go straight through createSchema
    // below anyway).
    createSchema(db);
    return { migrated: false };
  }
  // Drop every legacy table we know about. Order doesn't matter since
  // there are no foreign keys.
  const legacy = [
    'campaigns', 'maps', 'tokens', 'players', 'catalog', 'fog',
    'walls', 'explored_cells', 'cell_memory', 'terrain', 'events',
    'sessions', 'instance_settings',
  ];
  for (const t of legacy) {
    try { db.exec(`DROP TABLE IF EXISTS ${t}`); } catch {}
  }
  createSchema(db);
  return { migrated: true };
}

// Seed a single `default` session so the instance boots with something
// addressable. Idempotent: skips if any session already exists.
export function seedDefaultSession(db) {
  const c = db.prepare('SELECT COUNT(*) c FROM sessions').get().c;
  if (c) return false;
  const now = Date.now();
  db.prepare(
    'INSERT INTO sessions (id, name, created_at, last_active_at) VALUES (?,?,?,?)'
  ).run('default', 'Default', now, now);
  return true;
}

// Delete a session and everything that belongs to it, in a single
// transaction. Child tables (tokens/walls/fog/explored_cells/cell_memory/
// terrain) are scoped via map_id, so we look up the map ids first and
// delete their rows by map_id IN (...) before dropping the maps.
export function deleteSession(db, sessionId, uploadsDir) {
  const tx = db.transaction(() => {
    const mapIds = db
      .prepare('SELECT id FROM maps WHERE session_id=?')
      .all(sessionId)
      .map((r) => r.id);
    if (mapIds.length) {
      const placeholders = mapIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM tokens WHERE map_id IN (${placeholders})`).run(...mapIds);
      db.prepare(`DELETE FROM walls WHERE map_id IN (${placeholders})`).run(...mapIds);
      db.prepare(`DELETE FROM fog WHERE map_id IN (${placeholders})`).run(...mapIds);
      db.prepare(`DELETE FROM explored_cells WHERE map_id IN (${placeholders})`).run(...mapIds);
      db.prepare(`DELETE FROM cell_memory WHERE map_id IN (${placeholders})`).run(...mapIds);
      db.prepare(`DELETE FROM terrain WHERE map_id IN (${placeholders})`).run(...mapIds);
    }
    db.prepare('DELETE FROM maps WHERE session_id=?').run(sessionId);
    db.prepare('DELETE FROM players WHERE session_id=?').run(sessionId);
    db.prepare('DELETE FROM catalog WHERE session_id=?').run(sessionId);
    db.prepare('DELETE FROM sessions WHERE id=?').run(sessionId);
  });
  tx();
  if (uploadsDir) {
    try {
      fs.rmSync(path.join(uploadsDir, sessionId), { recursive: true, force: true });
    } catch {}
  }
}
