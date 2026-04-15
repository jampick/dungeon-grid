// Pure logic extracted from server.js for testability.
// No DB, no Socket.IO, no filesystem.

// Clamp a panel width to the allowed [min, max] range.
// Non-finite inputs fall back to min.
export function clampPanelWidth(w, min = 180, max = 600) {
  const n = Number(w);
  if (!Number.isFinite(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

// --- 1e light sources ---
// radius in cells (5 ft), cone = bullseye only
export const LIGHT_PRESETS = {
  none:           { radius: 0,  cone: false },
  candle:         { radius: 2,  cone: false },
  torch:          { radius: 3,  cone: false },
  lantern:        { radius: 6,  cone: false },
  bullseye:       { radius: 12, cone: true  },
  light_spell:    { radius: 4,  cone: false },
  continual:      { radius: 12, cone: false },
  infravision:    { radius: 12, cone: false },
};

// facing: 0=N, 1=NE, 2=E, 3=SE, 4=S, 5=SW, 6=W, 7=NW
export const FACING_VEC = [
  [0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]
];

// Auth gate for clearing chat. Only the DM may clear.
export function canClearChat(role) {
  return role === 'dm';
}

export function rollDice(expr) {
  if (typeof expr !== 'string') return { total: 0, rolls: [] };
  const m = /^(\d*)d(\d+)([+-]\d+)?$/i.exec(expr.replace(/\s/g,''));
  if (!m) return { total: 0, rolls: [] };
  const n = parseInt(m[1] || '1', 10);
  const sides = parseInt(m[2], 10);
  const mod = parseInt(m[3] || '0', 10);
  const rolls = Array.from({length: Math.min(n, 100)}, () => 1 + Math.floor(Math.random() * sides));
  const total = rolls.reduce((a,b)=>a+b,0) + mod;
  return { total, rolls };
}

export function computeRevealed(token, map, wallSet) {
  const preset = LIGHT_PRESETS[token.light_type || 'none'] || LIGHT_PRESETS.none;
  const override = token.light_radius || 0;
  const r = override > 0 ? override : preset.radius;
  if (r <= 0) return [];
  const cx = token.x, cy = token.y;
  const [fx, fy] = FACING_VEC[(token.facing || 0) % 8];
  const fmag = Math.hypot(fx, fy) || 1;
  const fxn = fx / fmag, fyn = fy / fmag;

  // Wall/closed-door between adjacent cells (cardinals only)
  const blocks = (key) => {
    const w = wallSet.get(key);
    if (!w) return false;
    if (w.kind === 'door' && w.open) return false;
    return true;
  };
  const hasWall = (x1, y1, x2, y2) => {
    if (x2 === x1 && y2 === y1 - 1) return blocks(`${x1},${y1},n`);
    if (x2 === x1 && y2 === y1 + 1) return blocks(`${x1},${y2},n`);
    if (x2 === x1 - 1 && y2 === y1) return blocks(`${x1},${y1},w`);
    if (x2 === x1 + 1 && y2 === y1) return blocks(`${x2},${y1},w`);
    return false;
  };

  // BFS flood fill from token, stopped by walls; include cells within Euclidean radius (and cone).
  const visited = new Set();
  const result = [];
  const start = `${cx},${cy}`;
  visited.add(start);
  const queue = [[cx, cy]];

  const withinLight = (x, y) => {
    const dx = x - cx, dy = y - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > r + 0.01) return false;
    if (preset.cone && (dx !== 0 || dy !== 0)) {
      const dot = (dx * fxn + dy * fyn) / dist;
      if (dot < 0.5) return false;
    }
    return true;
  };

  while (queue.length) {
    const [x, y] = queue.shift();
    if (withinLight(x, y)) result.push(`${x},${y}`);

    // cardinal neighbors
    for (const [nx, ny] of [[x, y-1],[x, y+1],[x-1, y],[x+1, y]]) {
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      const k = `${nx},${ny}`;
      if (visited.has(k)) continue;
      if (hasWall(x, y, nx, ny)) continue;
      if (Math.hypot(nx - cx, ny - cy) > r + 1.5) continue;
      visited.add(k);
      queue.push([nx, ny]);
    }
    // diagonals — must have both orthogonal gaps open to pass
    for (const [nx, ny] of [[x-1,y-1],[x+1,y-1],[x-1,y+1],[x+1,y+1]]) {
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      const k = `${nx},${ny}`;
      if (visited.has(k)) continue;
      if (hasWall(x, y, nx, y) || hasWall(nx, y, nx, ny)) continue;
      if (hasWall(x, y, x, ny) || hasWall(x, ny, nx, ny)) continue;
      if (Math.hypot(nx - cx, ny - cy) > r + 1.5) continue;
      visited.add(k);
      queue.push([nx, ny]);
    }
  }
  return result;
}

// Pure fog recompute given pre-fetched map/tokens/walls. Returns array of fogged cell keys.
export function computeFog(map, tokens, wallRows) {
  const wallSet = new Map(wallRows.map(w => [`${w.cx},${w.cy},${w.side}`, w]));
  const lit = new Set();
  for (const t of tokens) {
    const isParty = t.kind === 'pc' || t.owner_id != null;
    if (!isParty) continue;
    for (const key of computeRevealed(t, map, wallSet)) lit.add(key);
  }
  const fog = [];
  for (let x = 0; x < map.width; x++) {
    for (let y = 0; y < map.height; y++) {
      const k = `${x},${y}`;
      if (!lit.has(k)) fog.push(k);
    }
  }
  return fog;
}

// --- Undo stack ---------------------------------------------------------
// Simple FIFO-capped stack of { kind, label, inverse }. `inverse` is a closure
// that reapplies a prior state (e.g. re-inserts a deleted row) and should also
// re-broadcast via whatever emit function was captured when the entry was created.
// Kept pure of any particular transport so it can be tested with fake emits.

export const UNDO_MAX = 50;

export function createUndoStack(max = UNDO_MAX) {
  const entries = [];
  return {
    get length() { return entries.length; },
    top() { return entries[entries.length - 1] || null; },
    topLabel() { const t = entries[entries.length - 1]; return t ? t.label : null; },
    push(entry) {
      if (!entry || typeof entry.inverse !== 'function') return;
      entries.push(entry);
      while (entries.length > max) entries.shift();
    },
    pop() { return entries.pop() || null; },
    clear() { entries.length = 0; },
    // test helper
    _entries: entries,
  };
}

// Snapshot/restore helpers used by the server's dm:undo handler. These are
// pure (take db + emit), so tests can drive them without socket.io.

export function snapshotToken(db, id) {
  return db.prepare('SELECT * FROM tokens WHERE id=?').get(id) || null;
}

export function restoreTokenRow(db, row) {
  if (!row) return;
  const cols = Object.keys(row);
  const placeholders = cols.map(() => '?').join(',');
  db.prepare(`INSERT OR REPLACE INTO tokens (${cols.join(',')}) VALUES (${placeholders})`)
    .run(...cols.map(c => row[c]));
}

export function snapshotWalls(db, mapId) {
  return db.prepare('SELECT cx, cy, side, kind, open FROM walls WHERE map_id=?').all(mapId);
}

export function restoreWalls(db, mapId, rows) {
  db.prepare('DELETE FROM walls WHERE map_id=?').run(mapId);
  const ins = db.prepare('INSERT INTO walls (map_id, cx, cy, side, kind, open) VALUES (?,?,?,?,?,?)');
  const tx = db.transaction(() => {
    for (const w of rows) ins.run(mapId, w.cx, w.cy, w.side, w.kind || 'wall', w.open ? 1 : 0);
  });
  tx();
}

export function snapshotMap(db, mapId) {
  return db.prepare('SELECT * FROM maps WHERE id=?').get(mapId) || null;
}

export function snapshotFog(db, mapId) {
  const row = db.prepare('SELECT data FROM fog WHERE map_id=?').get(mapId);
  return row ? row.data : null;
}

// DB-backed recompute. Takes a better-sqlite3 db and an emit(event, payload) function.
// Extracted from server.js so it can be driven from tests with a temp DB + no-op emit.
export function recomputeFog(db, emit, mapId) {
  const map = db.prepare('SELECT * FROM maps WHERE id=?').get(mapId);
  if (!map) return null;
  const tokens = db.prepare('SELECT * FROM tokens WHERE map_id=?').all(mapId);
  const wallRows = db.prepare('SELECT cx, cy, side, kind, open FROM walls WHERE map_id=?').all(mapId);
  const fog = computeFog(map, tokens, wallRows);
  const data = JSON.stringify(fog);
  db.prepare('INSERT INTO fog (map_id, data) VALUES (?,?) ON CONFLICT(map_id) DO UPDATE SET data=excluded.data').run(mapId, data);
  if (emit) emit('fog:state', { data });
  return fog;
}
