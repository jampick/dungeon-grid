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

// Resolve the theme to apply on page load.
// stored: value from localStorage ('light' | 'dark' | null | any other string)
// systemPref: OS / browser preference ('light' | 'dark')
// Rules:
//   - a valid stored choice ('light' or 'dark') always wins
//   - null / undefined + valid systemPref 'light' → dark (dark is the default)
//   - null / undefined + systemPref 'dark' → dark
//   - any invalid string falls back to 'dark'
export function resolveTheme(stored, systemPref) {
  if (stored === 'light' || stored === 'dark') return stored;
  if (stored == null && systemPref === 'dark') return 'dark';
  return 'dark';
}

// Pure geometry helper for the client's fog-carve light renderer. Returns the
// center point, pixel radius, and (for cone lights) the start/end sweep angles
// in radians. Angles use the canvas convention (x right, y down, 0 = east,
// positive = clockwise). Cone half-angle is 60° (matches the client render).
// Returns null when the token produces no light.
export function computeLightGeometry(token, preset, cellSize) {
  if (!token || !preset || !cellSize) return null;
  const override = Number(token.light_radius) || 0;
  const rCells = override > 0 ? override : (preset.radius || 0);
  if (rCells <= 0) return null;
  const cx = (token.x + 0.5) * cellSize;
  const cy = (token.y + 0.5) * cellSize;
  const radius = rCells * cellSize;
  let cone = null;
  if (preset.cone) {
    const facingIdx = ((Number(token.facing) || 0) % 8 + 8) % 8;
    // 0=N,1=NE,2=E,3=SE,4=S,5=SW,6=W,7=NW. Canvas 0 radians = east.
    // N = -PI/2, E = 0, S = PI/2, W = PI.
    const facingRad = [-Math.PI/2, -Math.PI/4, 0, Math.PI/4, Math.PI/2, 3*Math.PI/4, Math.PI, -3*Math.PI/4][facingIdx];
    const half = Math.PI / 3; // 60°
    cone = { startAngle: facingRad - half, endAngle: facingRad + half };
  }
  return { cx, cy, radius, cone };
}

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

// Returns true iff the cardinal edge between (x1,y1) and (x2,y2) is blocked
// by a wall or a closed door. `wallSet` is a Map keyed "cx,cy,side" where
// side is 'n' (north edge of the cell) or 'w' (west edge of the cell).
// Diagonals and non-adjacent pairs return false here; callers that care
// about diagonal movement must combine two orthogonal isBlocked checks.
export function isBlocked(wallSet, x1, y1, x2, y2) {
  if (!wallSet) return false;
  const blocks = (key) => {
    const w = wallSet.get(key);
    if (!w) return false;
    if (w.kind === 'door' && w.open) return false;
    return true;
  };
  if (x2 === x1 && y2 === y1 - 1) return blocks(`${x1},${y1},n`);
  if (x2 === x1 && y2 === y1 + 1) return blocks(`${x1},${y2},n`);
  if (x2 === x1 - 1 && y2 === y1) return blocks(`${x1},${y1},w`);
  if (x2 === x1 + 1 && y2 === y1) return blocks(`${x2},${y1},w`);
  return false;
}

// Standard integer Bresenham line from (x1,y1) to (x2,y2) inclusive.
// Returns an array of [x,y] pairs. For a single-point input returns [[x1,y1]].
export function bresenhamLine(x1, y1, x2, y2) {
  const out = [];
  let x = x1 | 0, y = y1 | 0;
  const ex = x2 | 0, ey = y2 | 0;
  const dx = Math.abs(ex - x), dy = Math.abs(ey - y);
  const sx = x < ex ? 1 : -1;
  const sy = y < ey ? 1 : -1;
  let err = dx - dy;
  // Guard against pathological inputs — a ridiculously long drag shouldn't
  // lock the loop; the movement cap in the caller handles real gameplay.
  const MAX_STEPS = 10000;
  for (let i = 0; i < MAX_STEPS; i++) {
    out.push([x, y]);
    if (x === ex && y === ey) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx)  { err += dx; y += sy; }
  }
  return out;
}

// Walk Bresenham from (x0,y0) toward (x1,y1), stopping at the last cell that
// can be reached without crossing a wall or closed door. Cardinal steps use
// isBlocked directly; diagonal steps use the "both orthogonal gaps open" rule
// (matching computeRevealed). If the origin equals the destination, returns
// the origin unchanged.
export function walkUntilBlocked(x0, y0, x1, y1, wallSet) {
  const line = bresenhamLine(x0, y0, x1, y1);
  let cx = line[0][0], cy = line[0][1];
  for (let i = 1; i < line.length; i++) {
    const [nx, ny] = line[i];
    const dx = nx - cx, dy = ny - cy;
    if (dx === 0 && dy === 0) continue;
    const isDiag = dx !== 0 && dy !== 0;
    if (isDiag) {
      // Both orthogonal sub-steps must be clear, on both sides of the
      // diagonal — matches the stricter rule in computeRevealed.
      if (isBlocked(wallSet, cx, cy, cx + dx, cy)) break;
      if (isBlocked(wallSet, cx + dx, cy, nx, ny)) break;
      if (isBlocked(wallSet, cx, cy, cx, cy + dy)) break;
      if (isBlocked(wallSet, cx, cy + dy, nx, ny)) break;
    } else {
      if (isBlocked(wallSet, cx, cy, nx, ny)) break;
    }
    cx = nx; cy = ny;
  }
  return { x: cx, y: cy };
}

// BFS reachability check. Returns true iff (toX,toY) is reachable from
// (fromX,fromY) through unblocked cardinal or diagonal steps, within
// `maxDist` cells of BFS expansion. Used server-side to reject bogus moves.
export function isReachable(fromX, fromY, toX, toY, map, wallSet, maxDist = 50) {
  if (fromX === toX && fromY === toY) return true;
  if (!map) return false;
  const W = map.width, H = map.height;
  if (toX < 0 || toY < 0 || toX >= W || toY >= H) return false;
  const visited = new Set();
  const start = `${fromX},${fromY}`;
  visited.add(start);
  const queue = [[fromX, fromY, 0]];
  while (queue.length) {
    const [x, y, d] = queue.shift();
    if (d >= maxDist) continue;
    // cardinal
    for (const [nx, ny] of [[x, y-1],[x, y+1],[x-1, y],[x+1, y]]) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const k = `${nx},${ny}`;
      if (visited.has(k)) continue;
      if (isBlocked(wallSet, x, y, nx, ny)) continue;
      if (nx === toX && ny === toY) return true;
      visited.add(k);
      queue.push([nx, ny, d + 1]);
    }
    // diagonals — both orthogonal gaps open on both sides
    for (const [nx, ny] of [[x-1,y-1],[x+1,y-1],[x-1,y+1],[x+1,y+1]]) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const k = `${nx},${ny}`;
      if (visited.has(k)) continue;
      if (isBlocked(wallSet, x, y, nx, y) || isBlocked(wallSet, nx, y, nx, ny)) continue;
      if (isBlocked(wallSet, x, y, x, ny) || isBlocked(wallSet, x, ny, nx, ny)) continue;
      if (nx === toX && ny === toY) return true;
      visited.add(k);
      queue.push([nx, ny, d + 1]);
    }
  }
  return false;
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

  const hasWall = (x1, y1, x2, y2) => isBlocked(wallSet, x1, y1, x2, y2);

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

// Build a list of rectangles (in pixel coords) representing the union of
// visible (NOT fogged) cells. Used client-side to construct a clip path for
// rounded-light carving. Pure so it can be unit-tested in Node.
//
// visibleCells: iterable of "x,y" keys. cellSize: pixel size of a cell.
// Returns: [{ x, y, w, h }, ...] — one rect per cell, or [] for empty input.
export function buildVisiblePath(visibleCells, cellSize) {
  const rects = [];
  if (!visibleCells || !cellSize) return rects;
  for (const key of visibleCells) {
    if (typeof key !== 'string') continue;
    const comma = key.indexOf(',');
    if (comma < 0) continue;
    const cx = parseInt(key.slice(0, comma), 10);
    const cy = parseInt(key.slice(comma + 1), 10);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
    rects.push({ x: cx * cellSize, y: cy * cellSize, w: cellSize, h: cellSize });
  }
  return rects;
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

// Token image cache entry shape: { img, status: 'loading'|'loaded'|'error' }
// Pure predicate: is a cache entry ready to render?
export function isImageReady(entry) {
  return !!(entry && entry.status === 'loaded' && entry.img);
}

// Pure helper: given a token and a cache Map<url, entry>, decide whether
// an image should be drawn and return the image ref (or null).
export function chooseTokenImage(token, cache) {
  if (!token || !token.image) return { hasImage: false, imgRef: null };
  const entry = cache && typeof cache.get === 'function' ? cache.get(token.image) : null;
  if (isImageReady(entry)) return { hasImage: true, imgRef: entry.img };
  return { hasImage: false, imgRef: null };
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
