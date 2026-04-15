// Pure logic extracted from server.js for testability.
// No DB, no Socket.IO, no filesystem.

// Substitute the {{LIB_VERSION}} token in a source string with the
// given version. Used by server.js at startup to cache-bust the
// `import ... from '/lib/logic.js?v={{LIB_VERSION}}'` line in app.js
// so browsers re-fetch lib modules after every deploy.
export function substituteVersion(source, version) {
  const v = version == null ? '' : String(version);
  return String(source).replace(/\{\{LIB_VERSION\}\}/g, v);
}

// Decide if an incoming chat message should mark the chat panel as unread.
export function shouldMarkUnread({ isCollapsed, fromName, selfName }) {
  if (!isCollapsed) return false;
  if (fromName === selfName) return false;
  return true;
}

// Format the map legend text describing the per-cell distance.
export function formatLegendText(cellFeet) {
  const n = Number(cellFeet);
  const v = Number.isFinite(n) && n > 0 ? Math.round(n) : 5;
  return `1 sq = ${v} ft`;
}

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

// Resolve the effective light radius for a token-like object. The
// `light_radius` field is a custom override: when > 0 it wins, otherwise
// fall back to the preset radius for the given `light_type`.
export function effectiveLightRadius({ light_type, light_radius } = {}) {
  if (light_radius && light_radius > 0) return light_radius;
  const preset = LIGHT_PRESETS[light_type || 'none'];
  return preset ? preset.radius : 0;
}

// A token emits light ONLY if its `light_type` is set to a real preset
// (torch, lantern, candle, bullseye, light_spell, continual, infravision).
// Tokens with `light_type === 'none'` or unset do NOT emit light, regardless
// of kind — even PCs. Effect tokens never emit light. This matches the
// user's intent: the light_type field is the single source of truth for
// "does this token glow?"
export function tokenIsLightSource(t) {
  if (!t) return false;
  if (t.kind === 'effect') return false;
  if (t.light_type && t.light_type !== 'none') return true;
  return false;
}

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

// Pixel radius used by the client's light clip (circle + cone). Adds half a
// cell to `rCells` so the visual clip reaches the outer edge of the outermost
// cardinal cell rather than its midpoint. Returns 0 for non-positive input.
export function lightClipRadiusPx(rCells, cellSize) {
  const r = Number(rCells) || 0;
  const s = Number(cellSize) || 0;
  if (r <= 0 || s <= 0) return 0;
  return (r + 0.5) * s;
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
  // Extend the visual clip radius by half a cell so the circle reaches the
  // OUTER edge of the outermost cardinal cell rather than slicing through
  // its middle. The server's BFS (computeRevealed) is still the source of
  // truth for which cells are lit — this is purely a visual-clip fix so
  // cardinal-direction cells at max radius render fully instead of half-lit.
  const radius = lightClipRadiusPx(rCells, cellSize);
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

// Pick the highest-priority token from a list of hit candidates based on
// `kind`. Used by the canvas mousedown handler so DMs grab creatures before
// furniture when a click hits multiple tokens stacked in the same cell.
// Iteration order of `candidates` is preserved within a kind, so callers can
// pass the reverse-iterated hit list to keep the existing top-of-stack
// preference within each kind. Tokens with no `kind` are treated as 'npc'.
export function pickByKindPriority(candidates, kindOrder) {
  if (!Array.isArray(candidates) || !candidates.length) return null;
  if (Array.isArray(kindOrder)) {
    for (const kind of kindOrder) {
      const match = candidates.find((t) => (t && (t.kind || 'npc')) === kind);
      if (match) return match;
    }
  }
  return candidates[0] || null;
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

// Returns true if a straight Bresenham line from (x0,y0) to (x1,y1) is not
// blocked by any wall or closed door in wallSet. The endpoints themselves
// count as unblocked, so same-cell queries return true. Diagonal steps use
// the same "both orthogonal gaps open on both sides" rule as walkUntilBlocked
// and computeRevealed, so LOS stays consistent with movement/light.
//
// This is used for effect-token visibility: spell AOEs are bright magical
// events visible to any party member who has LOS, independent of whether the
// viewer's own cell happens to be lit.
export function hasLineOfSight(x0, y0, x1, y1, wallSet) {
  if (x0 === x1 && y0 === y1) return true;
  const line = bresenhamLine(x0, y0, x1, y1);
  for (let i = 1; i < line.length; i++) {
    const [px, py] = line[i - 1];
    const [nx, ny] = line[i];
    const dx = nx - px, dy = ny - py;
    if (dx === 0 && dy === 0) continue;
    const isDiag = dx !== 0 && dy !== 0;
    if (isDiag) {
      if (isBlocked(wallSet, px, py, px + dx, py)) return false;
      if (isBlocked(wallSet, px + dx, py, nx, ny)) return false;
      if (isBlocked(wallSet, px, py, px, py + dy)) return false;
      if (isBlocked(wallSet, px, py + dy, nx, ny)) return false;
    } else {
      if (isBlocked(wallSet, px, py, nx, ny)) return false;
    }
  }
  return true;
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

// --- Race catalog -------------------------------------------------------
// Per-ruleset list of playable races. `move` is in cells (5 ft squares).
// 1e values map "12 inches" of dungeon move => 12 cells. 5e values convert
// 30 ft => 6 squares. 2e currently aliases to 1e for v1; tune later.
const RACES_1E = [
  { id: 'human',    name: 'Human',    move: 12 },
  { id: 'elf',      name: 'Elf',      move: 12 },
  { id: 'dwarf',    name: 'Dwarf',    move:  9 },
  { id: 'halfling', name: 'Halfling', move:  9 },
  { id: 'half-elf', name: 'Half-Elf', move: 12 },
  { id: 'gnome',    name: 'Gnome',    move:  9 },
  { id: 'half-orc', name: 'Half-Orc', move: 12 },
];
export const RACES = {
  '1e': RACES_1E,
  '2e': RACES_1E, // alias for v1
  '5e': [
    { id: 'human',     name: 'Human',     move: 6 },
    { id: 'elf',       name: 'Elf',       move: 7 },
    { id: 'dwarf',     name: 'Dwarf',     move: 5 },
    { id: 'halfling',  name: 'Halfling',  move: 5 },
    { id: 'half-elf',  name: 'Half-Elf',  move: 6 },
    { id: 'gnome',     name: 'Gnome',     move: 5 },
    { id: 'half-orc',  name: 'Half-Orc',  move: 6 },
    { id: 'dragonborn',name: 'Dragonborn',move: 6 },
    { id: 'tiefling',  name: 'Tiefling',  move: 6 },
  ],
};

export function getRaces(ruleset) {
  return RACES[ruleset] || RACES['1e'];
}

export function defaultMoveForRace(ruleset, raceId) {
  const list = getRaces(ruleset);
  const r = list.find(x => x.id === raceId);
  return r ? r.move : 6;
}

// Walk Bresenham from (x0,y0) toward (x1,y1), stopping at the first wall
// blocker OR when the accumulated step count reaches `maxCost`. Diagonals
// cost 1 (Chebyshev). Returns { x, y, cost } where (x,y) is the last cell
// reached (possibly == origin) and cost is the number of steps taken.
export function walkWithRange(x0, y0, x1, y1, wallSet, maxCost) {
  const line = bresenhamLine(x0, y0, x1, y1);
  let cx = line[0][0], cy = line[0][1];
  let cost = 0;
  const cap = Number.isFinite(maxCost) ? maxCost : Infinity;
  for (let i = 1; i < line.length; i++) {
    if (cost >= cap) break;
    const [nx, ny] = line[i];
    const dx = nx - cx, dy = ny - cy;
    if (dx === 0 && dy === 0) continue;
    const isDiag = dx !== 0 && dy !== 0;
    if (isDiag) {
      if (isBlocked(wallSet, cx, cy, cx + dx, cy)) break;
      if (isBlocked(wallSet, cx + dx, cy, nx, ny)) break;
      if (isBlocked(wallSet, cx, cy, cx, cy + dy)) break;
      if (isBlocked(wallSet, cx, cy + dy, nx, ny)) break;
    } else {
      if (isBlocked(wallSet, cx, cy, nx, ny)) break;
    }
    cx = nx; cy = ny;
    cost++;
  }
  return { x: cx, y: cy, cost };
}

// BFS shortest path cost from (fromX,fromY) to (toX,toY). Chebyshev: each
// cardinal or diagonal step costs 1. Walls/closed doors block. Cuts off
// expansion past `maxCost` cells (unreachable returns Infinity). Used by
// the server to validate that a player's requested destination is within
// their token's move budget.
export function pathCost(fromX, fromY, toX, toY, wallSet, maxCost) {
  if (fromX === toX && fromY === toY) return 0;
  const cap = Number.isFinite(maxCost) ? maxCost : 50;
  const visited = new Map();
  const key = (x, y) => `${x},${y}`;
  visited.set(key(fromX, fromY), 0);
  // simple FIFO BFS — Chebyshev with uniform cost so BFS yields shortest
  let queue = [[fromX, fromY, 0]];
  while (queue.length) {
    const next = [];
    for (const [x, y, d] of queue) {
      if (d >= cap) continue;
      const nd = d + 1;
      const neighbors = [
        [x, y - 1], [x, y + 1], [x - 1, y], [x + 1, y],
        [x - 1, y - 1], [x + 1, y - 1], [x - 1, y + 1], [x + 1, y + 1],
      ];
      for (const [nx, ny] of neighbors) {
        const dx = nx - x, dy = ny - y;
        const isDiag = dx !== 0 && dy !== 0;
        if (isDiag) {
          if (isBlocked(wallSet, x, y, x + dx, y)) continue;
          if (isBlocked(wallSet, x + dx, y, nx, ny)) continue;
          if (isBlocked(wallSet, x, y, x, y + dy)) continue;
          if (isBlocked(wallSet, x, y + dy, nx, ny)) continue;
        } else {
          if (isBlocked(wallSet, x, y, nx, ny)) continue;
        }
        if (nx === toX && ny === toY) return nd;
        const k = key(nx, ny);
        if (visited.has(k)) continue;
        visited.set(k, nd);
        next.push([nx, ny, nd]);
      }
    }
    queue = next;
  }
  return Infinity;
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

// PC self-visibility: every PC/owned token can always "feel" the 3x3 around
// itself even with no light_type, so PCs aren't lost in the void after the
// strict tokenIsLightSource rule. Walls and closed doors block the self-zone,
// using the same diagonal rule as computeRevealed (both orthogonal gaps open).
// Mutates `lit` in place. Pure helper — exported for testability.
export function addPartySelfVisibility(tokens, wallSet, map, lit) {
  for (const t of tokens) {
    const isParty = t.kind === 'pc' || t.owner_id != null;
    if (!isParty) continue;
    const tx = t.x, ty = t.y;
    if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue;
    // Always reveal the token's own cell.
    lit.add(`${tx},${ty}`);
    // Cardinal neighbors — blocked by walls.
    for (const [nx, ny] of [[tx, ty - 1], [tx, ty + 1], [tx - 1, ty], [tx + 1, ty]]) {
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      if (isBlocked(wallSet, tx, ty, nx, ny)) continue;
      lit.add(`${nx},${ny}`);
    }
    // Diagonal neighbors — both orthogonal gaps must be open.
    for (const [nx, ny] of [[tx - 1, ty - 1], [tx + 1, ty - 1], [tx - 1, ty + 1], [tx + 1, ty + 1]]) {
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      if (isBlocked(wallSet, tx, ty, nx, ty) || isBlocked(wallSet, nx, ty, nx, ny)) continue;
      if (isBlocked(wallSet, tx, ty, tx, ny) || isBlocked(wallSet, tx, ny, nx, ny)) continue;
      lit.add(`${nx},${ny}`);
    }
  }
}

// Pure fog recompute given pre-fetched map/tokens/walls. Returns array of fogged cell keys.
export function computeFog(map, tokens, wallRows) {
  const wallSet = new Map(wallRows.map(w => [`${w.cx},${w.cy},${w.side}`, w]));
  const lit = new Set();
  for (const t of tokens) {
    if (!tokenIsLightSource(t)) continue;
    for (const key of computeRevealed(t, map, wallSet)) lit.add(key);
  }
  addPartySelfVisibility(tokens, wallSet, map, lit);
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

// Given a Map<playerId, Set<socketId>>, return the array of player IDs
// whose socket sets are non-empty (i.e. currently connected). Pure: takes
// only the map, returns a sorted-by-insertion-order array.
export function computeActivePlayerIds(playerSocketMap) {
  if (!playerSocketMap || typeof playerSocketMap.entries !== 'function') return [];
  const out = [];
  for (const [pid, set] of playerSocketMap.entries()) {
    if (set && typeof set.size === 'number' && set.size > 0) out.push(pid);
  }
  return out;
}

// UPDATE all tokens on the given map owned by playerId so their owner_id
// becomes NULL. Returns the number of rows changed. Pure-ish: takes a db
// handle, performs a single UPDATE, no socket/io side effects.
export function reassignOwnedTokensToNull(db, mapId, playerId) {
  if (playerId == null) return 0;
  const info = db.prepare('UPDATE tokens SET owner_id=NULL WHERE map_id=? AND owner_id=?')
    .run(mapId, playerId);
  return info.changes || 0;
}

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

// Return an array of {dx, dy} offsets (in pixels) for rendering N tokens
// that share a single grid cell, so stacked tokens don't fully overlap.
// n=1 -> center (no offset). n>=2 -> points evenly spaced around a small
// circle whose radius is ~15% of the cell size.
export function stackOffsets(n, cellSize) {
  if (!n || n < 1) return [];
  if (n === 1) return [{ dx: 0, dy: 0 }];
  const r = cellSize * 0.15;
  const out = [];
  // Start angle so n=2 gives left/right (dx < 0 and dx > 0).
  const start = Math.PI;
  for (let i = 0; i < n; i++) {
    const a = start + (i * 2 * Math.PI) / n;
    out.push({ dx: Math.cos(a) * r, dy: Math.sin(a) * r });
  }
  return out;
}

// --- Party leader / formation movement ------------------------------------
// See GitHub issue #1 for the full spec. Pure helper used by both server
// (authoritative) and tests. Given a leader
// token, the set of follower tokens (each with current x,y), and the leader's
// new (newX,newY), return an array of { tokenId, targetX, targetY } for each
// follower describing where they should end up after the formation move.
//
// Algorithm:
//  1. For each follower compute its CURRENT offset from the leader's OLD
//     position. That offset is the formation slot — we never persist it.
//  2. Desired slot = (newX + dx, newY + dy). If that cell is in-bounds, not
//     occupied by another follower's assigned slot, not the leader's new
//     cell, AND a wall-aware Bresenham walk from the follower's current
//     position lands exactly on it, the follower fills its slot.
//  3. Otherwise the follower COLLAPSES to single-file directly behind the
//     leader: we walk the leader's own movement line (from newX,newY back
//     toward oldX,oldY) and assign the first trailing cell that is in-bounds
//     and not yet claimed. If even that fails (no clear trailing cell, or
//     follower can't path to it), the follower stays where it is.
//
// `wallSet` is the same Map used by isBlocked. `map` is { width, height }.
// Followers are processed in the order given so callers can sort by initiative
// or token id for stability — collapse claims slots first-come, first-serve.
export function computeFollowerTargets(leaderOld, followers, newX, newY, wallSet, map) {
  const results = [];
  if (!followers || followers.length === 0) return results;
  const W = map?.width ?? Infinity;
  const H = map?.height ?? Infinity;
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  // Leader's own movement line, used to seed single-file collapse. The
  // trailing cells (those nearest the OLD position) are the line starting at
  // newX,newY walking BACKWARD; we generate by reversing a forward Bresenham.
  const leaderLine = bresenhamLine(newX, newY, leaderOld.x, leaderOld.y);
  // leaderLine[0] is the leader's new cell. Trailing cells start at index 1.
  const claimed = new Set();
  claimed.add(`${newX},${newY}`);
  // Helper: can a follower walk from (fx,fy) to exactly (tx,ty) via the
  // wall-aware walker? walkUntilBlocked stops at the last clear cell along
  // the Bresenham line, so success means the walker reached (tx,ty).
  const canReach = (fx, fy, tx, ty) => {
    if (fx === tx && fy === ty) return true;
    const r = walkUntilBlocked(fx, fy, tx, ty, wallSet);
    return r.x === tx && r.y === ty;
  };
  for (const f of followers) {
    const dx = f.x - leaderOld.x;
    const dy = f.y - leaderOld.y;
    const desiredX = newX + dx;
    const desiredY = newY + dy;
    let tx = null, ty = null;
    if (inBounds(desiredX, desiredY)
        && !claimed.has(`${desiredX},${desiredY}`)
        && canReach(f.x, f.y, desiredX, desiredY)) {
      tx = desiredX;
      ty = desiredY;
    } else {
      // Collapse to single-file: walk the leader's path in reverse, taking
      // the first unclaimed trailing cell the follower can reach.
      for (let i = 1; i < leaderLine.length; i++) {
        const [cx, cy] = leaderLine[i];
        if (!inBounds(cx, cy)) continue;
        if (claimed.has(`${cx},${cy}`)) continue;
        if (!canReach(f.x, f.y, cx, cy)) continue;
        tx = cx; ty = cy;
        break;
      }
    }
    if (tx == null) {
      // No legal slot — follower stays put.
      tx = f.x; ty = f.y;
    }
    claimed.add(`${tx},${ty}`);
    results.push({ tokenId: f.id, targetX: tx, targetY: ty });
  }
  return results;
}

// --- Random dungeon generator ---------------------------------------------
// Pure: takes width, height (cells) and an optional numeric seed. Returns
// { walls: [{ cx, cy, side, kind, open }] } describing a procedurally
// generated dungeon (rooms connected by L-shaped corridors). Walls use the
// same (cx, cy, side) convention as the rest of the app where side is 'n'
// (top edge of cell cy) or 'w' (left edge of cell cx). Cells are floor or
// non-floor; every floor/non-floor edge becomes a wall, except where a
// corridor enters a room — that becomes a closed door.
// Theme -> object preset id distribution for thematic furniture in random
// dungeons. See generateRandomDungeon. Plain data, ordered for stable output
// under a seeded PRNG.
export const ROOM_THEMES = [
  'barracks', 'storage', 'dining', 'library', 'smithy',
  'treasure', 'throne', 'shrine', 'empty',
];

// Object preset ids the random generator uses to populate themed rooms.
// The catalog itself lives in lib/objects.js; the generator only needs ids.
const THEME_FURNITURE = {
  barracks: [{ id: 'bed', min: 2, max: 4 }, { id: 'weapon_rack', min: 0, max: 1 }],
  storage:  [{ id: 'crate', min: 1, max: 3 }, { id: 'barrel', min: 1, max: 3 }],
  dining:   [{ id: 'table', min: 1, max: 1 }, { id: 'chair', min: 2, max: 4 }],
  library:  [{ id: 'bookshelf', min: 2, max: 3 }, { id: 'desk', min: 0, max: 1 }],
  smithy:   [{ id: 'anvil', min: 1, max: 1 }, { id: 'firepit', min: 1, max: 1 }, { id: 'weapon_rack', min: 0, max: 1 }],
  treasure: [{ id: 'chest', min: 1, max: 3 }, { id: 'statue', min: 0, max: 1 }],
  throne:   [{ id: 'throne', min: 1, max: 1 }, { id: 'statue', min: 0, max: 2 }],
  shrine:   [{ id: 'altar', min: 1, max: 1 }, { id: 'statue', min: 0, max: 2 }],
  empty:    [],
};

export function generateRandomDungeon(width, height, seed) {
  const W = Math.max(1, Math.floor(Number(width) || 0));
  const H = Math.max(1, Math.floor(Number(height) || 0));
  // Mulberry32 seeded PRNG; falls back to Math.random when no seed.
  let rand;
  if (seed == null) {
    rand = Math.random;
  } else {
    let s = (Number(seed) >>> 0) || 1;
    rand = function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const randInt = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

  // Floor grid: 1 = floor, 0 = non-floor.
  const floor = new Array(W * H).fill(0);
  const idx = (x, y) => y * W + x;
  const isFloor = (x, y) => x >= 0 && y >= 0 && x < W && y < H && floor[idx(x, y)] === 1;

  // Place rooms.
  const targetRooms = Math.max(5, Math.floor((W * H) / 80));
  const maxAttempts = targetRooms * 8;
  const rooms = [];
  for (let attempt = 0; attempt < maxAttempts && rooms.length < targetRooms; attempt++) {
    const rw = randInt(3, 8);
    const rh = randInt(3, 6);
    if (rw + 2 > W || rh + 2 > H) continue;
    // leave a 1-cell margin so walls fit inside the map
    const rx = randInt(1, W - rw - 1);
    const ry = randInt(1, H - rh - 1);
    // reject overlap (with 1-cell padding)
    let overlap = false;
    for (const r of rooms) {
      if (rx <= r.x + r.w && rx + rw >= r.x - 1 &&
          ry <= r.y + r.h && ry + rh >= r.y - 1) {
        overlap = true; break;
      }
    }
    if (overlap) continue;
    rooms.push({ x: rx, y: ry, w: rw, h: rh });
    for (let yy = ry; yy < ry + rh; yy++) {
      for (let xx = rx; xx < rx + rw; xx++) {
        floor[idx(xx, yy)] = 1;
      }
    }
  }

  // Corridor tracking: cells that are corridor (not part of any room).
  const corridor = new Array(W * H).fill(0);
  function inAnyRoom(x, y) {
    for (const r of rooms) {
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return true;
    }
    return false;
  }
  function carve(x, y) {
    if (x < 1 || y < 1 || x > W - 2 || y > H - 2) return;
    if (floor[idx(x, y)] === 0) {
      floor[idx(x, y)] = 1;
      corridor[idx(x, y)] = 1;
    } else if (!inAnyRoom(x, y)) {
      corridor[idx(x, y)] = 1;
    }
  }
  // Connect each room to the next via L-shaped corridor.
  for (let i = 1; i < rooms.length; i++) {
    const a = rooms[i - 1];
    const b = rooms[i];
    const ax = randInt(a.x, a.x + a.w - 1);
    const ay = randInt(a.y, a.y + a.h - 1);
    const bx = randInt(b.x, b.x + b.w - 1);
    const by = randInt(b.y, b.y + b.h - 1);
    if (rand() < 0.5) {
      for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) carve(x, ay);
      for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) carve(bx, y);
    } else {
      for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) carve(ax, y);
      for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) carve(x, by);
    }
  }

  // Build walls. New algorithm: room boundaries are authoritative. We walk
  // each room's perimeter and place either a wall or (rarely) a door on
  // every edge. Then we walk corridor cells and seal the corridor's outer
  // edges. This guarantees room enclosure even when a corridor brushes
  // along a room wall (the previous floor-edge-delta algorithm dropped
  // walls on those edges, leaving L-shaped gaps).
  const wallSet = new Map(); // key "cx,cy,side" -> { cx, cy, side, kind, open }
  function setEdge(cx, cy, side, kind) {
    const key = `${cx},${cy},${side}`;
    const cur = wallSet.get(key);
    // doors win over walls
    if (cur && cur.kind === 'door') return;
    wallSet.set(key, { cx, cy, side, kind, open: 0 });
  }

  const isCorridor = (x, y) => x >= 0 && y >= 0 && x < W && y < H && corridor[idx(x, y)] === 1;

  // For each room: walk the perimeter. Every edge gets a wall by default.
  // For each side (n/s/e/w) we may convert AT MOST one edge to a door,
  // chosen as the first interior edge whose neighbor is a corridor cell
  // that genuinely leads away from this room (i.e. has at least one
  // non-this-room neighbor floor cell). This prevents door-spam along a
  // corridor that runs flush with a room wall, while still placing a real
  // door where a corridor actually enters the room.
  function inRoom(r, x, y) {
    return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  }
  // True iff (x,y) is a corridor cell that has at least one neighbor floor
  // cell which is NOT inside the given room — i.e. a corridor that comes
  // from somewhere else (a real connection), not just a stray cell flush
  // along the wall.
  function corridorLeadsAway(r, x, y) {
    if (!isCorridor(x, y)) return false;
    const n = [[1,0],[-1,0],[0,1],[0,-1]];
    for (const [dx, dy] of n) {
      const nx = x + dx, ny = y + dy;
      if (!isFloor(nx, ny)) continue;
      if (!inRoom(r, nx, ny)) return true;
    }
    return false;
  }

  for (const r of rooms) {
    const sideDoored = { n: false, s: false, e: false, w: false };
    // North side: cells (x, r.y) for x in [r.x .. r.x+r.w-1]; edge stored at (x, r.y, 'n')
    for (let x = r.x; x < r.x + r.w; x++) {
      const ny = r.y - 1;
      if (!sideDoored.n && corridorLeadsAway(r, x, ny)) {
        setEdge(x, r.y, 'n', 'door');
        sideDoored.n = true;
      } else {
        setEdge(x, r.y, 'n', 'wall');
      }
    }
    // South side: edge stored at (x, r.y+r.h, 'n')
    for (let x = r.x; x < r.x + r.w; x++) {
      const ny = r.y + r.h;
      if (!sideDoored.s && corridorLeadsAway(r, x, ny)) {
        setEdge(x, r.y + r.h, 'n', 'door');
        sideDoored.s = true;
      } else {
        setEdge(x, r.y + r.h, 'n', 'wall');
      }
    }
    // West side: edge stored at (r.x, y, 'w')
    for (let y = r.y; y < r.y + r.h; y++) {
      const nx = r.x - 1;
      if (!sideDoored.w && corridorLeadsAway(r, nx, y)) {
        setEdge(r.x, y, 'w', 'door');
        sideDoored.w = true;
      } else {
        setEdge(r.x, y, 'w', 'wall');
      }
    }
    // East side: edge stored at (r.x+r.w, y, 'w')
    for (let y = r.y; y < r.y + r.h; y++) {
      const nx = r.x + r.w;
      if (!sideDoored.e && corridorLeadsAway(r, nx, y)) {
        setEdge(r.x + r.w, y, 'w', 'door');
        sideDoored.e = true;
      } else {
        setEdge(r.x + r.w, y, 'w', 'wall');
      }
    }
  }

  // For each corridor cell, seal edges to non-floor neighbors. Edges to
  // other corridor cells stay open. Edges to room interiors are skipped
  // (the room-perimeter pass already decided those — wall or door).
  function isInAnyRoom(x, y) {
    for (const r of rooms) if (inRoom(r, x, y)) return true;
    return false;
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!isCorridor(x, y)) continue;
      // North edge: neighbor (x, y-1)
      if (!isFloor(x, y - 1)) setEdge(x, y, 'n', 'wall');
      // South edge: stored at (x, y+1, 'n')
      if (!isFloor(x, y + 1)) setEdge(x, y + 1, 'n', 'wall');
      // West edge
      if (!isFloor(x - 1, y)) setEdge(x, y, 'w', 'wall');
      // East edge
      if (!isFloor(x + 1, y)) setEdge(x + 1, y, 'w', 'wall');
      // suppress unused
      void isInAnyRoom;
    }
  }

  // ---- Thematic furniture ------------------------------------------------
  // Assign each room a theme; place 0-N object preset placements inside.
  const furniture = []; // [{ cx, cy, preset }]
  const roomThemes = [];
  for (let i = 0; i < rooms.length; i++) {
    const r = rooms[i];
    const theme = ROOM_THEMES[Math.floor(rand() * ROOM_THEMES.length)];
    roomThemes.push(theme);
    const recipe = THEME_FURNITURE[theme] || [];
    // Collect interior cells (the whole room — corridors enter from a wall
    // door so any interior cell is fine; the door cell itself is the
    // adjacent corridor cell, not a room interior cell, so this is safe).
    const cells = [];
    for (let yy = r.y; yy < r.y + r.h; yy++) {
      for (let xx = r.x; xx < r.x + r.w; xx++) {
        cells.push([xx, yy]);
      }
    }
    // Deterministic shuffle via the seeded PRNG.
    for (let k = cells.length - 1; k > 0; k--) {
      const j = Math.floor(rand() * (k + 1));
      const tmp = cells[k]; cells[k] = cells[j]; cells[j] = tmp;
    }
    let cursor = 0;
    for (const item of recipe) {
      const count = item.min + Math.floor(rand() * (item.max - item.min + 1));
      for (let n = 0; n < count && cursor < cells.length; n++) {
        const [cx, cy] = cells[cursor++];
        furniture.push({ cx, cy, preset: item.id });
      }
    }
  }

  // Test invariant: every room perimeter edge must be a wall or door.
  // (Cheap O(rooms*perimeter); only runs in dev. Throws if violated so
  // regressions trip loudly in tests.)
  for (const r of rooms) {
    const checks = [];
    for (let x = r.x; x < r.x + r.w; x++) {
      checks.push(`${x},${r.y},n`);
      checks.push(`${x},${r.y + r.h},n`);
    }
    for (let y = r.y; y < r.y + r.h; y++) {
      checks.push(`${r.x},${y},w`);
      checks.push(`${r.x + r.w},${y},w`);
    }
    for (const k of checks) {
      const e = wallSet.get(k);
      if (!e || (e.kind !== 'wall' && e.kind !== 'door')) {
        throw new Error(`generateRandomDungeon: room enclosure broken at ${k}`);
      }
    }
  }

  // Stable order so deterministic seeds give deterministic arrays.
  const walls = Array.from(wallSet.values()).sort((a, b) => {
    if (a.cy !== b.cy) return a.cy - b.cy;
    if (a.cx !== b.cx) return a.cx - b.cx;
    return a.side < b.side ? -1 : a.side > b.side ? 1 : 0;
  });
  // Annotate rooms with theme for callers/tests.
  const roomsOut = rooms.map((r, i) => ({ ...r, theme: roomThemes[i] }));
  return { walls, rooms: roomsOut, furniture };
}

export function snapshotMap(db, mapId) {
  return db.prepare('SELECT * FROM maps WHERE id=?').get(mapId) || null;
}

export function snapshotFog(db, mapId) {
  const row = db.prepare('SELECT data FROM fog WHERE map_id=?').get(mapId);
  return row ? row.data : null;
}

// Pure predicate: should an incoming token:update from `role` be queued for
// DM approval because it changes light_type / light_radius while the campaign
// has light_approval enabled?
export function shouldQueueLightChange(role, data, token, campaign) {
  if (!data || !token || !campaign) return false;
  if (role === 'dm') return false;
  if (!campaign.light_approval) return false;
  const typeChanged = 'light_type' in data && data.light_type !== token.light_type;
  const radiusChanged = 'light_radius' in data && Number(data.light_radius) !== Number(token.light_radius);
  return typeChanged || radiusChanged;
}

// Token image cache entry shape: { img, status: 'loading'|'loaded'|'error' }
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

// Append a cache-busting ?v=<shortSha> query to /creatures/* URLs so a new
// deploy forces browsers and the Cloudflare edge to re-fetch icon SVGs whose
// filenames stayed the same but whose bytes changed. Uploads and other URLs
// pass through unchanged (user uploads have unique filenames already).
export function cacheBustedImageUrl(url, shortSha) {
  if (url === null || url === undefined) return url;
  if (url === '') return url;
  if (typeof url !== 'string') return url;
  if (!url.startsWith('/creatures/')) return url;
  const v = shortSha || 'dev';
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}v=${v}`;
}

// --- Memory fog helpers --------------------------------------------------
// Snapshot just the fields we want to remember about a token. Used when a
// cell transitions from lit to fogged: we freeze a JSON blob of each token
// observed in that cell at the moment it goes dark.
export function snapshotTokenForMemory(token) {
  if (!token) return null;
  return {
    name: token.name ?? null,
    color: token.color ?? null,
    kind: token.kind ?? null,
    image: token.image ?? null,
    facing: token.facing ?? 0,
    size: token.size ?? 1,
    hp_current: token.hp_current ?? null,
    hp_max: token.hp_max ?? null,
  };
}

// Read explored_cells + cell_memory for a map and produce the per-cell
// memory payload for the client. Only cells in `fogCellsSet` (currently not
// lit) and present in `explored_cells` contribute — lit cells should render
// the authoritative current state instead.
//
// Returns: [{ cx, cy, tokens: [snapshot, ...] }]
export function computeMemoryFromDb(db, mapId, fogCellsSet) {
  const explored = db.prepare('SELECT cx, cy FROM explored_cells WHERE map_id=?').all(mapId);
  if (!explored.length) return [];
  const wantCells = new Map(); // "cx,cy" -> { cx, cy, tokens: [] }
  for (const r of explored) {
    const k = `${r.cx},${r.cy}`;
    if (fogCellsSet && !fogCellsSet.has(k)) continue;
    wantCells.set(k, { cx: r.cx, cy: r.cy, tokens: [] });
  }
  if (!wantCells.size) return [];
  const rows = db.prepare('SELECT cx, cy, snapshot FROM cell_memory WHERE map_id=?').all(mapId);
  for (const r of rows) {
    const k = `${r.cx},${r.cy}`;
    const cell = wantCells.get(k);
    if (!cell) continue;
    try { cell.tokens.push(JSON.parse(r.snapshot)); } catch {}
  }
  return [...wantCells.values()];
}

// Flat denormalized version (one row per remembered token) for the wire
// payload — easier for the client to consume.
export function computeMemoryTokensFromDb(db, mapId, fogCellsSet) {
  const explored = new Set(
    db.prepare('SELECT cx, cy FROM explored_cells WHERE map_id=?').all(mapId)
      .map(r => `${r.cx},${r.cy}`)
  );
  if (!explored.size) return [];
  const rows = db.prepare('SELECT cx, cy, token_id, snapshot FROM cell_memory WHERE map_id=?').all(mapId);
  const out = [];
  for (const r of rows) {
    const k = `${r.cx},${r.cy}`;
    if (!explored.has(k)) continue;
    if (fogCellsSet && !fogCellsSet.has(k)) continue; // lit -> use real tokens
    let snap;
    try { snap = JSON.parse(r.snapshot); } catch { continue; }
    out.push({ cx: r.cx, cy: r.cy, token_id: r.token_id, snapshot: snap });
  }
  return out;
}

// Pure helper: compute the set of token ids that should appear in the
// player-facing token list. DM sees everything; players see tokens that are
// (a) currently in a lit cell, (b) remembered via memoryTokens, or
// (c) owned by the player (their own characters are always listed).
export function computeSeenTokenIds({ tokens, fogCells, memoryTokens, playerId, isDM }) {
  const all = Array.isArray(tokens) ? tokens : [];
  if (isDM) return new Set(all.map(t => t.id));
  const seen = new Set();
  const fog = fogCells instanceof Set ? fogCells : new Set(fogCells || []);
  for (const t of all) {
    if (playerId != null && t.owner_id != null && t.owner_id === playerId) {
      seen.add(t.id);
      continue;
    }
    if (!fog.has(`${t.x},${t.y}`)) seen.add(t.id);
  }
  if (Array.isArray(memoryTokens)) {
    for (const m of memoryTokens) {
      if (m == null) continue;
      const id = m.token_id;
      if (id != null) seen.add(id);
    }
  }
  return seen;
}

// DB-backed recompute. Takes a better-sqlite3 db and an emit(event, payload) function.
// Extracted from server.js so it can be driven from tests with a temp DB + no-op emit.
//
// Memory fog: every recompute updates `explored_cells` and `cell_memory`:
//   - All currently lit cells get added to explored_cells (idempotent).
//   - For lit cells, existing cell_memory rows are deleted (the player
//     observes reality there now, so any stale snapshot is replaced) and
//     fresh snapshots are inserted for every token currently inside a lit
//     cell. This means when a lit cell transitions to fogged, the latest
//     snapshot of what was in it stays in cell_memory until the party
//     re-enters and refreshes it.
export function recomputeFog(db, emit, mapId) {
  const map = db.prepare('SELECT * FROM maps WHERE id=?').get(mapId);
  if (!map) return null;
  // Per-map fog_mode short-circuit. Outdoor / none maps always have an empty
  // fog array — no BFS, no memory tracking, no explored_cells writes.
  const fogMode = (map.fog_mode || 'dungeon');
  if (fogMode !== 'dungeon') {
    const data = '[]';
    db.prepare('INSERT INTO fog (map_id, data) VALUES (?,?) ON CONFLICT(map_id) DO UPDATE SET data=excluded.data').run(mapId, data);
    if (emit) emit('fog:state', { data });
    return [];
  }
  const tokens = db.prepare('SELECT * FROM tokens WHERE map_id=?').all(mapId);
  const wallRows = db.prepare('SELECT cx, cy, side, kind, open FROM walls WHERE map_id=?').all(mapId);

  // Compute lit set the same way computeFog does, but keep it explicit so we
  // can use it for memory bookkeeping.
  const wallSet = new Map(wallRows.map(w => [`${w.cx},${w.cy},${w.side}`, w]));
  const lit = new Set();
  for (const t of tokens) {
    if (!tokenIsLightSource(t)) continue;
    for (const key of computeRevealed(t, map, wallSet)) lit.add(key);
  }
  addPartySelfVisibility(tokens, wallSet, map, lit);

  // Maintain explored_cells / cell_memory only if the schema is present.
  // (Older test fixtures that pre-date the memory tables still work.)
  let hasMemoryTables = false;
  try {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('explored_cells','cell_memory')").all();
    hasMemoryTables = row.length === 2;
  } catch { hasMemoryTables = false; }

  if (hasMemoryTables && lit.size) {
    const insExplored = db.prepare('INSERT OR IGNORE INTO explored_cells (map_id, cx, cy) VALUES (?,?,?)');
    const delMemCell = db.prepare('DELETE FROM cell_memory WHERE map_id=? AND cx=? AND cy=?');
    const delMemToken = db.prepare('DELETE FROM cell_memory WHERE map_id=? AND token_id=?');
    const insMem = db.prepare('INSERT OR REPLACE INTO cell_memory (map_id, cx, cy, token_id, snapshot) VALUES (?,?,?,?,?)');
    // Tokens whose current position is within the lit set — their stale
    // memory should be wiped everywhere, because the live observation
    // supersedes any frozen snapshot.
    const litTokenIds = [];
    for (const t of tokens) {
      if (lit.has(`${t.x},${t.y}`)) litTokenIds.push(t.id);
    }
    const tx = db.transaction(() => {
      for (const k of lit) {
        const comma = k.indexOf(',');
        const cx = parseInt(k.slice(0, comma), 10);
        const cy = parseInt(k.slice(comma + 1), 10);
        insExplored.run(mapId, cx, cy);
        delMemCell.run(mapId, cx, cy);
      }
      // Wipe stale memory for any token currently visible anywhere on the map.
      for (const id of litTokenIds) {
        delMemToken.run(mapId, id);
      }
      for (const t of tokens) {
        const k = `${t.x},${t.y}`;
        if (!lit.has(k)) continue;
        // Party tokens (PCs / player-owned) are always live — never snapshot.
        const isParty = t.kind === 'pc' || t.owner_id != null;
        if (isParty) continue;
        const snap = JSON.stringify(snapshotTokenForMemory(t));
        insMem.run(mapId, t.x, t.y, t.id, snap);
      }
    });
    tx();
  }

  // Build fog list (cells not currently lit).
  const fog = [];
  for (let x = 0; x < map.width; x++) {
    for (let y = 0; y < map.height; y++) {
      const k = `${x},${y}`;
      if (!lit.has(k)) fog.push(k);
    }
  }
  const data = JSON.stringify(fog);
  db.prepare('INSERT INTO fog (map_id, data) VALUES (?,?) ON CONFLICT(map_id) DO UPDATE SET data=excluded.data').run(mapId, data);
  if (emit) emit('fog:state', { data });
  return fog;
}

// --- Login helpers ---------------------------------------------------------
// Pure functions that exercise only the DB. Extracted from server.js so the
// login flow can be regression-tested without booting Express/Socket.IO.
// Each returns either { ok:true, token, role, name, playerId } or
// { ok:false, error, status }.

export function loginDm(db, body, deps) {
  const { password, name } = body || {};
  const { dmPassword, newToken } = deps || {};
  if (password !== dmPassword) {
    return { ok: false, error: 'bad password', status: 401 };
  }
  const campaign = db.prepare('SELECT * FROM campaigns ORDER BY id LIMIT 1').get();
  if (!campaign) {
    return { ok: false, error: 'no campaign', status: 500 };
  }
  let p = db.prepare('SELECT * FROM players WHERE campaign_id=? AND role=?').get(campaign.id, 'dm');
  if (!p) {
    const info = db.prepare('INSERT INTO players (campaign_id, name, token, role) VALUES (?,?,?,?)')
      .run(campaign.id, name || 'DM', newToken(), 'dm');
    p = db.prepare('SELECT * FROM players WHERE id=?').get(info.lastInsertRowid);
  }
  return { ok: true, token: p.token, role: p.role, name: p.name, playerId: p.id };
}

// Pick a target cell for a copied token. Prefer one cell east of the
// original, then west, south, north. Skip any candidate that is either
// out of bounds or already in `occupiedSet` (a Set of "x,y" strings).
// If all four cardinal neighbors are unavailable, fall back to the
// original cell (the stack indicator will handle visual overlap).
export function findCopyOffset(origX, origY, occupiedSet, width, height) {
  const candidates = [
    [origX + 1, origY],
    [origX - 1, origY],
    [origX, origY + 1],
    [origX, origY - 1],
  ];
  for (const [x, y] of candidates) {
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    if (occupiedSet && occupiedSet.has(`${x},${y}`)) continue;
    return { x, y };
  }
  return { x: origX, y: origY };
}

export function loginPlayer(db, body, deps) {
  const { name } = body || {};
  const { newToken } = deps || {};
  if (!name) {
    return { ok: false, error: 'name required', status: 400 };
  }
  const campaign = db.prepare('SELECT * FROM campaigns ORDER BY id LIMIT 1').get();
  if (!campaign) {
    return { ok: false, error: 'no campaign', status: 500 };
  }
  let p = db.prepare('SELECT * FROM players WHERE campaign_id=? AND name=? AND role=?').get(campaign.id, name, 'player');
  if (!p) {
    const info = db.prepare('INSERT INTO players (campaign_id, name, token, role) VALUES (?,?,?,?)')
      .run(campaign.id, name, newToken(), 'player');
    p = db.prepare('SELECT * FROM players WHERE id=?').get(info.lastInsertRowid);
  }
  return { ok: true, token: p.token, role: p.role, name: p.name, playerId: p.id };
}

// Decide whether a canvas mousedown event should start a map pan.
// Pan requires an explicit modifier so a plain left-click on empty
// space is a no-op (prevents accidental panning when a user misses
// the token hit radius). Accepted pan triggers:
//   - shift + left-drag
//   - middle mouse button (button === 1)
//   - right mouse button (button === 2)
// Defensive: undefined / nullish event returns false.
export function shouldStartPan(event) {
  if (!event) return false;
  const { shiftKey, button } = event;
  return !!shiftKey || button === 1 || button === 2;
}

// Determine whether a given token id should render as "selected".
// Centralized so the canvas halo pass and the sidebar row renderer
// apply an identical rule. Carefully handles the id===0 case (0 is a
// valid token id and must not be treated as falsy) and treats null or
// undefined ids as "not selected".
export function isTokenSelected(tokenId, selectedId) {
  if (tokenId == null || selectedId == null) return false;
  return tokenId === selectedId;
}

// ---- Terrain ----
// Per-cell terrain paint kinds and their colors. The 8 v1 kinds are baked
// into the palette below; new kinds get added here so client + server +
// tests share one source of truth.
export const TERRAIN_COLORS = {
  grass:  '#4a6e3a',
  forest: '#2e5a2e',
  water:  '#4a7aa8',
  road:   '#a89070',
  hill:   '#8a7a5a',
  desert: '#d8c68a',
  swamp:  '#4a5a3a',
  snow:   '#e8ecf0',
};

export const TERRAIN_KINDS = Object.keys(TERRAIN_COLORS);

// Resolve a terrain kind to its hex color. Unknown / null kinds get a
// neutral fallback so a stale client never crashes the renderer.
export function pickTerrainColor(kind) {
  if (kind == null) return null;
  return TERRAIN_COLORS[kind] || '#888888';
}

// Pure handler logic for the `terrain:paint` socket event. Returns a
// summary so callers (server.js, tests) can broadcast or assert without
// duplicating the upsert SQL. Validates the kind against TERRAIN_COLORS;
// unknown kinds are rejected.
export function applyTerrainPaint(db, mapId, cx, cy, kind) {
  if (!Number.isInteger(cx) || !Number.isInteger(cy)) return { ok: false, reason: 'bad-coord' };
  if (!TERRAIN_COLORS[kind]) return { ok: false, reason: 'bad-kind' };
  db.prepare(
    'INSERT INTO terrain (map_id, cx, cy, kind) VALUES (?,?,?,?) ' +
    'ON CONFLICT(map_id, cx, cy) DO UPDATE SET kind=excluded.kind'
  ).run(mapId, cx, cy, kind);
  return { ok: true, mapId, cx, cy, kind };
}

// Pure handler logic for `terrain:clear`.
export function applyTerrainClear(db, mapId, cx, cy) {
  if (!Number.isInteger(cx) || !Number.isInteger(cy)) return { ok: false, reason: 'bad-coord' };
  const info = db.prepare('DELETE FROM terrain WHERE map_id=? AND cx=? AND cy=?').run(mapId, cx, cy);
  return { ok: true, mapId, cx, cy, removed: info.changes };
}
