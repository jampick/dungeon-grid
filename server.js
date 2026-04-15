import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import Database from 'better-sqlite3';
import multer from 'multer';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { LIGHT_PRESETS, FACING_VEC, computeRevealed, rollDice, recomputeFog as recomputeFogLogic,
  canClearChat, createUndoStack, snapshotToken, restoreTokenRow, snapshotWalls, restoreWalls, snapshotMap, snapshotFog,
  isReachable, pathCost, shouldQueueLightChange, loginDm, loginPlayer, generateRandomDungeon, computeMemoryTokensFromDb,
  computeActivePlayerIds, reassignOwnedTokensToNull } from './lib/logic.js';
import { getObjectById } from './lib/objects.js';
import { sizeMultiplier } from './lib/creatures.js';
import { listMaps, createMap as createMapDb, renameMap as renameMapDb, activateMap as activateMapDb, duplicateMap as duplicateMapDb, deleteMap as deleteMapDb, performTravel, nullLinksToMap } from './lib/maps.js';
import { getDeploymentInfo, TRIGGER_DIR, buildTriggerFilename } from './lib/deployment.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DM_PASSWORD = process.env.DM_PASSWORD || 'changeme';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 10 * 1024 * 1024 });

app.use(express.json({ limit: '5mb' }));

// --- index.html with cache-busted asset URLs ---
// Render once at startup: substitute {{VERSION}} with the deployed
// short SHA so <script src="/app.js?v=abc1234"> forces a fresh fetch
// on every deploy. Static assets themselves get long-cache headers
// (browsers rely on the changing query string for invalidation).
const CACHE_BUST = (() => {
  const { shortSha } = getDeploymentInfo();
  return shortSha && shortSha !== 'unknown' ? shortSha : String(Date.now());
})();
const INDEX_HTML = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8')
  .replace(/\{\{VERSION\}\}/g, CACHE_BUST);
app.get(['/', '/index.html'], (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.type('html').send(INDEX_HTML);
});

// Render app.js once at startup with {{LIB_VERSION}} substituted for the
// deployed short SHA. This cache-busts the static `import` of /lib/logic.js
// inside the module so a new deploy can't load a fresh app.js against a
// stale cached lib (which previously caused "does not provide an export
// named 'stackOffsets'" SyntaxErrors after deploys).
const APP_JS = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8')
  .replace(/\{\{LIB_VERSION\}\}/g, CACHE_BUST);
app.get('/app.js', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.type('application/javascript').send(APP_JS);
});

// Serve /creatures/* with no-cache so new icon SVGs (same filenames) are not
// pinned by browsers or the Cloudflare edge under the generic public mount's
// immutable/1y headers. Must precede the public mount to win route precedence.
app.use('/creatures', express.static(path.join(__dirname, 'public', 'creatures'), {
  setHeaders(res) {
    res.set('Cache-Control', 'no-cache');
  },
}));
app.use(express.static(path.join(__dirname, 'public'), { index: false, maxAge: '1y', immutable: true }));
// Serve lib/ as a static asset so the browser client can import the same
// pure-logic helpers the server uses (computeRevealed, wall collision, ...).
// The client loads app.js as a module and imports from '/lib/logic.js'.
app.use('/lib', express.static(path.join(__dirname, 'lib'), {
  setHeaders(res) {
    res.set('Cache-Control', 'no-cache');
  },
}));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- DB ---
const db = new Database(path.join(__dirname, 'data', 'grid.db'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  ruleset TEXT DEFAULT '1e',
  approval_mode INTEGER DEFAULT 0,
  door_approval INTEGER DEFAULT 1,
  light_approval INTEGER DEFAULT 1,
  show_other_hp INTEGER DEFAULT 0,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS maps (
  id INTEGER PRIMARY KEY,
  campaign_id INTEGER,
  name TEXT,
  grid_type TEXT DEFAULT 'square',
  grid_size INTEGER DEFAULT 50,
  width INTEGER DEFAULT 30,
  height INTEGER DEFAULT 20,
  background TEXT,
  active INTEGER DEFAULT 0,
  cell_feet INTEGER DEFAULT 5
);
CREATE TABLE IF NOT EXISTS tokens (
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
  size INTEGER DEFAULT 1,
  race TEXT,
  move INTEGER DEFAULT 6,
  aoe TEXT,
  link_map_id INTEGER,
  link_x INTEGER,
  link_y INTEGER
);
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY,
  campaign_id INTEGER,
  name TEXT,
  token TEXT UNIQUE,
  role TEXT DEFAULT 'player'
);
CREATE TABLE IF NOT EXISTS catalog (
  id INTEGER PRIMARY KEY,
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
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  campaign_id INTEGER,
  ts INTEGER,
  actor TEXT,
  kind TEXT,
  payload TEXT
);
`);

// Migrations for existing DBs
for (const stmt of [
  "ALTER TABLE tokens ADD COLUMN light_type TEXT DEFAULT 'none'",
  "ALTER TABLE tokens ADD COLUMN facing INTEGER DEFAULT 0",
  "ALTER TABLE walls ADD COLUMN kind TEXT DEFAULT 'wall'",
  "ALTER TABLE walls ADD COLUMN open INTEGER DEFAULT 0",
  "ALTER TABLE campaigns ADD COLUMN door_approval INTEGER DEFAULT 1",
  "ALTER TABLE campaigns ADD COLUMN light_approval INTEGER DEFAULT 1",
  "ALTER TABLE tokens ADD COLUMN race TEXT",
  "ALTER TABLE tokens ADD COLUMN move INTEGER DEFAULT 6",
  "ALTER TABLE maps ADD COLUMN cell_feet INTEGER DEFAULT 5",
  "ALTER TABLE tokens ADD COLUMN aoe TEXT",
  "ALTER TABLE tokens ADD COLUMN link_map_id INTEGER",
  "ALTER TABLE tokens ADD COLUMN link_x INTEGER",
  "ALTER TABLE tokens ADD COLUMN link_y INTEGER",
]) { try { db.exec(stmt); } catch {} }

// Light presets / FACING_VEC / computeRevealed now live in lib/logic.js.

function recomputeFog(mapId) {
  return recomputeFogLogic(db, (event, payload) => io.emit(event, payload), mapId);
}
function autoRevealForToken(tokenId) {
  const t = db.prepare('SELECT map_id FROM tokens WHERE id=?').get(tokenId);
  if (t) recomputeFog(t.map_id);
}

// In-memory pending moves (active map only): tokenId -> { fromX, fromY, toX, toY, actor }
const pendingMoves = new Map();
// In-memory pending door actions: "cx,cy,side" -> { actor, toOpen }
const pendingDoors = new Map();
// In-memory pending light changes: tokenId -> { actor, from:{light_type,light_radius}, to:{light_type,light_radius} }
const pendingLights = new Map();

// --- Active player tracking ---
// Map<playerId, Set<socketId>> of currently connected sockets per player.
// A player is "active" iff their set is non-empty. When the last socket for
// a player disconnects, we start a 10s grace timer; if they don't reconnect
// in time, all tokens they owned on the active map have owner_id cleared.
const activePlayers = new Map();
const playerDisconnectTimers = new Map();
const DISCONNECT_GRACE_MS = 10_000;

function addPlayerSocket(playerId, socketId) {
  let set = activePlayers.get(playerId);
  if (!set) { set = new Set(); activePlayers.set(playerId, set); }
  set.add(socketId);
  // Cancel any pending disconnect cleanup — the player came back.
  const pending = playerDisconnectTimers.get(playerId);
  if (pending) {
    clearTimeout(pending);
    playerDisconnectTimers.delete(playerId);
  }
}
function removePlayerSocket(playerId, socketId) {
  const set = activePlayers.get(playerId);
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) {
    activePlayers.delete(playerId);
    // Schedule grace-period cleanup. If the player reconnects within the
    // window, addPlayerSocket clears this timer.
    const prior = playerDisconnectTimers.get(playerId);
    if (prior) clearTimeout(prior);
    const timer = setTimeout(() => {
      playerDisconnectTimers.delete(playerId);
      // Re-check: did they come back during the timer? (defense in depth)
      if (activePlayers.has(playerId)) return;
      const map = getActiveMap();
      if (map) reassignOwnedTokensToNull(db, map.id, playerId);
      broadcastState();
    }, DISCONNECT_GRACE_MS);
    // Don't keep the event loop alive purely for this timer.
    if (typeof timer.unref === 'function') timer.unref();
    playerDisconnectTimers.set(playerId, timer);
  }
}

// In-memory undo stack for DM actions. Cleared when the active map changes.
const undoStack = createUndoStack();
function pushUndo(entry) { undoStack.push(entry); }

// Seed default campaign
const campaignCount = db.prepare('SELECT COUNT(*) c FROM campaigns').get().c;
if (!campaignCount) {
  const info = db.prepare('INSERT INTO campaigns (name, created_at) VALUES (?, ?)').run('Default Campaign', Date.now());
  db.prepare('INSERT INTO maps (campaign_id, name, active) VALUES (?, ?, 1)').run(info.lastInsertRowid, 'Blank Map');
}

// --- Auth ---
function newToken() { return crypto.randomBytes(16).toString('hex'); }

function authFromReq(req) {
  const t = req.headers['x-player-token'] || req.query.t;
  if (!t) return null;
  return db.prepare('SELECT * FROM players WHERE token = ?').get(t);
}

app.post('/api/login/dm', (req, res) => {
  const r = loginDm(db, req.body || {}, { dmPassword: DM_PASSWORD, newToken });
  if (!r.ok) return res.status(r.status || 400).json({ error: r.error });
  res.json({ token: r.token, role: r.role, name: r.name, playerId: r.playerId });
});

app.post('/api/login/player', (req, res) => {
  const r = loginPlayer(db, req.body || {}, { newToken });
  if (!r.ok) return res.status(r.status || 400).json({ error: r.error });
  res.json({ token: r.token, role: r.role, name: r.name, playerId: r.playerId });
});

// --- Uploads ---
const MIME_TO_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};
const upload = multer({
  dest: path.join(__dirname, 'uploads'),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (MIME_TO_EXT[file.mimetype]) return cb(null, true);
    cb(null, false);
  },
});
function requireAuth(req, res, next) {
  const user = authFromReq(req);
  if (!user) return res.status(401).json({ error: 'unauth' });
  req.user = user;
  next();
}
app.post('/api/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'image required (png/jpeg/webp/gif)' });
  const ext = MIME_TO_EXT[req.file.mimetype];
  const newName = req.file.filename + ext;
  fs.renameSync(req.file.path, path.join(__dirname, 'uploads', newName));
  res.json({ url: '/uploads/' + newName });
});

// --- Deployment info (captured once at startup) ---
const DEPLOYMENT = getDeploymentInfo();

// --- State helpers ---
function getActiveMap() {
  return db.prepare('SELECT * FROM maps WHERE active=1 ORDER BY id LIMIT 1').get();
}
function getState() {
  const campaign = db.prepare('SELECT * FROM campaigns ORDER BY id LIMIT 1').get();
  const maps = db.prepare('SELECT * FROM maps WHERE campaign_id=?').all(campaign.id);
  const activeMap = getActiveMap();
  const tokens = activeMap ? db.prepare('SELECT * FROM tokens WHERE map_id=?').all(activeMap.id) : [];
  const fogRow = activeMap ? db.prepare('SELECT data FROM fog WHERE map_id=?').get(activeMap.id) : null;
  const walls = activeMap ? db.prepare('SELECT cx, cy, side, kind, open FROM walls WHERE map_id=?').all(activeMap.id) : [];
  const catalog = db.prepare('SELECT * FROM catalog').all();
  const players = db.prepare('SELECT id, name, role FROM players WHERE campaign_id=?').all(campaign.id);
  const pendings = [...pendingMoves.entries()].map(([id, v]) => ({ id, ...v }));
  const doorPendings = [...pendingDoors.entries()].map(([key, v]) => ({ key, ...v }));
  const lightPendings = [...pendingLights.entries()].map(([id, v]) => ({ id, ...v }));
  let explored = [];
  let memoryTokens = [];
  if (activeMap) {
    explored = db.prepare('SELECT cx, cy FROM explored_cells WHERE map_id=?').all(activeMap.id).map(r => `${r.cx},${r.cy}`);
    let fogSet = null;
    try { fogSet = new Set(JSON.parse(fogRow?.data || '[]')); } catch { fogSet = new Set(); }
    memoryTokens = computeMemoryTokensFromDb(db, activeMap.id, fogSet);
  }
  const activePlayerIds = computeActivePlayerIds(activePlayers);
  return { campaign, maps, activeMap, tokens, fog: fogRow?.data || null, walls, catalog, players, activePlayerIds, pendings, doorPendings, lightPendings, undoLabel: undoStack.topLabel(), deployment: DEPLOYMENT, explored, memoryTokens };
}

app.get('/api/state', (req, res) => {
  const user = authFromReq(req);
  if (!user) return res.status(401).json({ error: 'unauth' });
  res.json({ me: { id: user.id, name: user.name, role: user.role }, ...getState() });
});

// --- Socket.IO real-time ---
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('unauth'));
  const p = db.prepare('SELECT * FROM players WHERE token=?').get(token);
  if (!p) return next(new Error('unauth'));
  socket.data.player = p;
  next();
});

function broadcastState() {
  io.emit('state', getState());
}

function requireDM(socket) { return socket.data.player.role === 'dm'; }

io.on('connection', (socket) => {
  const me = socket.data.player;
  // Track this socket against its player so the owner dropdown can filter
  // to currently-connected players, and so we can reassign ownership when
  // they leave (after a grace period).
  addPlayerSocket(me.id, socket.id);
  socket.on('disconnect', () => {
    removePlayerSocket(me.id, socket.id);
    broadcastState();
  });
  socket.emit('hello', { id: me.id, name: me.name, role: me.role });
  socket.emit('state', getState());
  // Notify everyone that the active-player set changed.
  broadcastState();

  socket.on('token:move', ({ id, x, y }) => {
    const t = db.prepare('SELECT * FROM tokens WHERE id=?').get(id);
    if (!t) return;
    if (me.role !== 'dm' && t.owner_id !== me.id) return;
    // Defense in depth: a malicious (or buggy) player client could bypass the
    // client-side wall check and emit any x,y. DMs move freely — they need to
    // reposition tokens past walls — but players must have a wall-aware path
    // from the currently committed position to the destination. If not, snap
    // them back by rebroadcasting authoritative state.
    if (me.role !== 'dm') {
      const map = db.prepare('SELECT * FROM maps WHERE id=?').get(t.map_id);
      const wallRows = db.prepare('SELECT cx, cy, side, kind, open FROM walls WHERE map_id=?').all(t.map_id);
      const wallSet = new Map(wallRows.map(w => [`${w.cx},${w.cy},${w.side}`, w]));
      if (!isReachable(t.x, t.y, x, y, map, wallSet, 50)) {
        // Reject — re-emit the committed position so the client snaps back.
        socket.emit('token:update', { id, x: t.x, y: t.y });
        socket.emit('state', getState());
        return;
      }
      // Distance cap: shortest-path cost from current position must be
      // within the token's move budget. DMs bypass (handled above).
      const budget = Number.isFinite(t.move) ? t.move : 6;
      const cost = pathCost(t.x, t.y, x, y, wallSet, budget);
      if (cost > budget) {
        socket.emit('token:update', { id, x: t.x, y: t.y });
        socket.emit('state', getState());
        return;
      }
    }
    const campaign = db.prepare('SELECT * FROM campaigns ORDER BY id LIMIT 1').get();
    if (campaign.approval_mode && me.role !== 'dm') {
      // Queue as pending; original position is whatever is currently committed
      pendingMoves.set(id, { fromX: t.x, fromY: t.y, toX: x, toY: y, actor: me.name });
      broadcastState();
      return;
    }
    // Direct apply (DM or non-approval mode). Clear any pending on this token.
    pendingMoves.delete(id);
    if (me.role === 'dm') {
      const fromX = t.x, fromY = t.y;
      pushUndo({
        kind: 'token:move',
        label: `Move ${t.name || 'token'}`,
        inverse: () => {
          db.prepare('UPDATE tokens SET x=?, y=? WHERE id=?').run(fromX, fromY, id);
          io.emit('token:update', { id, x: fromX, y: fromY });
          autoRevealForToken(id);
          broadcastState();
        },
      });
    }
    db.prepare('UPDATE tokens SET x=?, y=? WHERE id=?').run(x, y, id);
    io.emit('token:update', { id, x, y });
    autoRevealForToken(id);
    broadcastState();
  });

  socket.on('token:create', (data) => {
    if (!requireDM(socket) && data.kind !== 'pc') return;
    const map = getActiveMap();
    const info = db.prepare(`INSERT INTO tokens (map_id,kind,name,image,x,y,hp_current,hp_max,ac,light_radius,light_type,facing,color,owner_id,size,race,move,aoe,link_map_id,link_x,link_y)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      map.id, data.kind || 'npc', data.name || '?', data.image || null,
      data.x || 5, data.y || 5, data.hp_current || 10, data.hp_max || 10,
      data.ac || 10, data.light_radius || 0, data.light_type || 'none', data.facing || 0,
      data.color || '#2a2a2a', data.owner_id || null, data.size || 1,
      data.race || null, Number.isFinite(parseInt(data.move, 10)) ? parseInt(data.move, 10) : 6,
      data.aoe || null,
      data.link_map_id ?? null, data.link_x ?? null, data.link_y ?? null
    );
    if (me.role === 'dm') {
      const newId = info.lastInsertRowid;
      pushUndo({
        kind: 'token:create',
        label: `Create ${data.name || 'token'}`,
        inverse: () => {
          db.prepare('DELETE FROM tokens WHERE id=?').run(newId);
          recomputeFog(map.id);
          broadcastState();
        },
      });
    }
    autoRevealForToken(info.lastInsertRowid);
    broadcastState();
  });

  socket.on('token:update', (data) => {
    const t = db.prepare('SELECT * FROM tokens WHERE id=?').get(data.id);
    if (!t) return;
    if (me.role !== 'dm' && t.owner_id !== me.id) return;
    // Player light changes may need DM approval. If so, record the pending
    // entry and strip light fields from this update so remaining edits
    // (name/HP/etc.) still apply immediately.
    const campaignRow = db.prepare('SELECT * FROM campaigns ORDER BY id LIMIT 1').get();
    if (shouldQueueLightChange(me.role, data, t, campaignRow)) {
      const nextType = 'light_type' in data ? data.light_type : t.light_type;
      const nextRadius = 'light_radius' in data ? data.light_radius : t.light_radius;
      pendingLights.set(data.id, {
        actor: me.name,
        from: { light_type: t.light_type, light_radius: t.light_radius },
        to:   { light_type: nextType,      light_radius: nextRadius    },
      });
      // Strip the queued fields; any other edits fall through.
      data = { ...data };
      delete data.light_type;
      delete data.light_radius;
      io.emit('chat:msg', { from: 'system', role: 'dm', text: `${me.name}'s light source change for ${t.name || 'token'} is pending DM approval.`, ts: Date.now() });
    }
    const fields = ['name','hp_current','hp_max','ac','light_radius','light_type','facing','color','image','size','kind','owner_id','race','move','aoe','link_map_id','link_x','link_y'];
    const sets = [], vals = [];
    for (const f of fields) if (f in data) { sets.push(`${f}=?`); vals.push(data[f]); }
    if (!sets.length) { broadcastState(); return; }
    if (me.role === 'dm') {
      const prev = snapshotToken(db, data.id);
      pushUndo({
        kind: 'token:update',
        label: `Update ${t.name || 'token'}`,
        inverse: () => {
          restoreTokenRow(db, prev);
          autoRevealForToken(data.id);
          broadcastState();
        },
      });
    }
    vals.push(data.id);
    db.prepare(`UPDATE tokens SET ${sets.join(',')} WHERE id=?`).run(...vals);
    autoRevealForToken(data.id);
    broadcastState();
  });

  socket.on('token:delete', ({ id }) => {
    if (!requireDM(socket)) return;
    const prev = snapshotToken(db, id);
    if (!prev) return;
    pendingMoves.delete(id);
    pendingLights.delete(id);
    db.prepare('DELETE FROM tokens WHERE id=?').run(id);
    pushUndo({
      kind: 'token:delete',
      label: `Delete ${prev.name || 'token'}`,
      inverse: () => {
        restoreTokenRow(db, prev);
        recomputeFog(prev.map_id);
        broadcastState();
      },
    });
    recomputeFog(prev.map_id);
    broadcastState();
  });

  socket.on('token:travel', ({ linkTokenId }) => {
    const result = performTravel(db, me.id, linkTokenId);
    if (!result.ok) {
      if (result.reason === 'no-owned-token') {
        socket.emit('chat:msg', { from: 'system', role: 'dm', text: 'No owned token to travel with.', ts: Date.now() });
      }
      return;
    }
    // Push an inverse undo entry that restores the moved tokens' prior
    // position/map. DM-initiated travels also snapshot the active-map
    // switch so undo restores the previous view.
    const prevActive = me.role === 'dm' ? getActiveMap() : null;
    const prevRows = result.prev;
    pushUndo({
      kind: 'token:travel',
      label: 'Travel',
      inverse: () => {
        const upd = db.prepare('UPDATE tokens SET map_id=?, x=?, y=? WHERE id=?');
        for (const r of prevRows) upd.run(r.map_id, r.x, r.y, r.id);
        if (prevActive) activateMapDb(db, prevActive.id);
        recomputeFog(result.fromMapId);
        recomputeFog(result.toMapId);
        broadcastState();
      },
    });
    // DMs take the whole table with them. Players travel solo and stay
    // rendered against whatever map is currently active for the campaign.
    if (me.role === 'dm') {
      activateMapDb(db, result.toMapId);
    }
    recomputeFog(result.fromMapId);
    recomputeFog(result.toMapId);
    broadcastState();
  });

  socket.on('map:update', (data) => {
    if (!requireDM(socket)) return;
    const map = getActiveMap();
    const fields = ['name','grid_type','grid_size','width','height','background','cell_feet'];
    const sets = [], vals = [];
    for (const f of fields) if (f in data) { sets.push(`${f}=?`); vals.push(data[f]); }
    if (!sets.length) return;
    const prev = snapshotMap(db, map.id);
    pushUndo({
      kind: 'map:update',
      label: 'Map settings',
      inverse: () => {
        db.prepare('UPDATE maps SET name=?, grid_type=?, grid_size=?, width=?, height=?, background=? WHERE id=?')
          .run(prev.name, prev.grid_type, prev.grid_size, prev.width, prev.height, prev.background, prev.id);
        recomputeFog(prev.id);
        broadcastState();
      },
    });
    vals.push(map.id);
    db.prepare(`UPDATE maps SET ${sets.join(',')} WHERE id=?`).run(...vals);
    recomputeFog(map.id);
    broadcastState();
  });

  socket.on('map:create', (data) => {
    if (!requireDM(socket)) return;
    const campaign = db.prepare('SELECT * FROM campaigns ORDER BY id LIMIT 1').get();
    const newId = createMapDb(db, campaign.id, data || {});
    if (data && data.activate) activateMapDb(db, newId);
    broadcastState();
  });

  socket.on('map:activate', ({ id }) => {
    if (!requireDM(socket)) return;
    activateMapDb(db, id);
    undoStack.clear();
    broadcastState();
  });

  socket.on('map:rename', ({ id, name }) => {
    if (!requireDM(socket)) return;
    renameMapDb(db, id, name);
    broadcastState();
  });

  socket.on('map:duplicate', ({ id }) => {
    if (!requireDM(socket)) return;
    duplicateMapDb(db, id);
    broadcastState();
  });

  socket.on('memory:clear', () => {
    if (!requireDM(socket)) return;
    const map = getActiveMap();
    if (!map) return;
    db.prepare('DELETE FROM explored_cells WHERE map_id=?').run(map.id);
    db.prepare('DELETE FROM cell_memory WHERE map_id=?').run(map.id);
    recomputeFog(map.id);
    broadcastState();
  });

  socket.on('map:delete', ({ id }) => {
    if (!requireDM(socket)) return;
    try {
      deleteMapDb(db, id);
      db.prepare('DELETE FROM explored_cells WHERE map_id=?').run(id);
      db.prepare('DELETE FROM cell_memory WHERE map_id=?').run(id);
      nullLinksToMap(db, id);
    }
    catch (e) { socket.emit('chat:msg', { from: 'system', role: 'dm', text: `map:delete failed: ${e.message}`, ts: Date.now() }); return; }
    undoStack.clear();
    broadcastState();
  });

  socket.on('campaign:settings', (data) => {
    if (!requireDM(socket)) return;
    const c = db.prepare('SELECT * FROM campaigns ORDER BY id LIMIT 1').get();
    const fields = ['ruleset','approval_mode','door_approval','light_approval','show_other_hp','name'];
    const sets = [], vals = [];
    for (const f of fields) if (f in data) { sets.push(`${f}=?`); vals.push(data[f]); }
    if (!sets.length) return;
    vals.push(c.id);
    db.prepare(`UPDATE campaigns SET ${sets.join(',')} WHERE id=?`).run(...vals);
    if ('approval_mode' in data && !data.approval_mode) pendingMoves.clear();
    if ('door_approval' in data && !data.door_approval) pendingDoors.clear();
    if ('light_approval' in data && !data.light_approval) pendingLights.clear();
    broadcastState();
  });

  socket.on('fog:update', ({ data }) => {
    if (!requireDM(socket)) return;
    const map = getActiveMap();
    const prev = snapshotFog(db, map.id);
    pushUndo({
      kind: 'fog:update',
      label: 'Fog paint',
      inverse: () => {
        if (prev == null) {
          db.prepare('DELETE FROM fog WHERE map_id=?').run(map.id);
          io.emit('fog:state', { data: '[]' });
        } else {
          db.prepare('INSERT INTO fog (map_id, data) VALUES (?,?) ON CONFLICT(map_id) DO UPDATE SET data=excluded.data').run(map.id, prev);
          io.emit('fog:state', { data: prev });
        }
        broadcastState();
      },
    });
    db.prepare('INSERT INTO fog (map_id, data) VALUES (?,?) ON CONFLICT(map_id) DO UPDATE SET data=excluded.data').run(map.id, data);
    io.emit('fog:state', { data });
    broadcastState();
  });

  socket.on('wall:toggle', ({ cx, cy, side }) => {
    if (!requireDM(socket)) return;
    const map = getActiveMap();
    const prev = snapshotWalls(db, map.id);
    const existing = db.prepare('SELECT kind FROM walls WHERE map_id=? AND cx=? AND cy=? AND side=?').get(map.id, cx, cy, side);
    if (existing) db.prepare('DELETE FROM walls WHERE map_id=? AND cx=? AND cy=? AND side=?').run(map.id, cx, cy, side);
    else db.prepare("INSERT INTO walls (map_id, cx, cy, side, kind, open) VALUES (?,?,?,?,'wall',0)").run(map.id, cx, cy, side);
    pushUndo({
      kind: 'wall:toggle',
      label: existing ? 'Delete wall' : 'Create wall',
      inverse: () => {
        restoreWalls(db, map.id, prev);
        io.emit('walls:state', snapshotWalls(db, map.id));
        recomputeFog(map.id);
        broadcastState();
      },
    });
    io.emit('walls:state', db.prepare('SELECT cx, cy, side, kind, open FROM walls WHERE map_id=?').all(map.id));
    recomputeFog(map.id);
    broadcastState();
  });

  socket.on('door:request', ({ cx, cy, side }) => {
    // Player (or DM) wants to open/close a door
    const map = getActiveMap();
    const d = db.prepare("SELECT kind, open FROM walls WHERE map_id=? AND cx=? AND cy=? AND side=? AND kind='door'").get(map.id, cx, cy, side);
    if (!d) return;
    const campaign = db.prepare('SELECT * FROM campaigns ORDER BY id LIMIT 1').get();
    const toOpen = !d.open;
    if (me.role !== 'dm' && campaign.door_approval) {
      pendingDoors.set(`${cx},${cy},${side}`, { actor: me.name, toOpen, cx, cy, side });
      broadcastState();
      return;
    }
    db.prepare('UPDATE walls SET open=? WHERE map_id=? AND cx=? AND cy=? AND side=?').run(toOpen ? 1 : 0, map.id, cx, cy, side);
    pendingDoors.delete(`${cx},${cy},${side}`);
    io.emit('walls:state', db.prepare('SELECT cx, cy, side, kind, open FROM walls WHERE map_id=?').all(map.id));
    recomputeFog(map.id);
    broadcastState();
  });

  socket.on('door:resolve', ({ approved, key }) => {
    if (!requireDM(socket)) return;
    const p = pendingDoors.get(key);
    if (!p) return;
    pendingDoors.delete(key);
    if (approved) {
      const map = getActiveMap();
      db.prepare('UPDATE walls SET open=? WHERE map_id=? AND cx=? AND cy=? AND side=?').run(p.toOpen ? 1 : 0, map.id, p.cx, p.cy, p.side);
      io.emit('walls:state', db.prepare('SELECT cx, cy, side, kind, open FROM walls WHERE map_id=?').all(map.id));
      recomputeFog(map.id);
    }
    broadcastState();
  });

  socket.on('door:cycle', ({ cx, cy, side }) => {
    if (!requireDM(socket)) return;
    const map = getActiveMap();
    const prev = snapshotWalls(db, map.id);
    pushUndo({
      kind: 'door:cycle',
      label: 'Door cycle',
      inverse: () => {
        restoreWalls(db, map.id, prev);
        io.emit('walls:state', snapshotWalls(db, map.id));
        recomputeFog(map.id);
        broadcastState();
      },
    });
    const existing = db.prepare('SELECT kind, open FROM walls WHERE map_id=? AND cx=? AND cy=? AND side=?').get(map.id, cx, cy, side);
    // cycle: none -> closed door -> open door -> none (wall gets replaced by closed door)
    if (!existing) {
      db.prepare("INSERT INTO walls (map_id, cx, cy, side, kind, open) VALUES (?,?,?,?,'door',0)").run(map.id, cx, cy, side);
    } else if (existing.kind === 'wall') {
      db.prepare("UPDATE walls SET kind='door', open=0 WHERE map_id=? AND cx=? AND cy=? AND side=?").run(map.id, cx, cy, side);
    } else if (existing.kind === 'door' && !existing.open) {
      db.prepare("UPDATE walls SET open=1 WHERE map_id=? AND cx=? AND cy=? AND side=?").run(map.id, cx, cy, side);
    } else {
      db.prepare('DELETE FROM walls WHERE map_id=? AND cx=? AND cy=? AND side=?').run(map.id, cx, cy, side);
    }
    io.emit('walls:state', db.prepare('SELECT cx, cy, side, kind, open FROM walls WHERE map_id=?').all(map.id));
    recomputeFog(map.id);
  });

  socket.on('wall:clear', () => {
    if (!requireDM(socket)) return;
    const map = getActiveMap();
    const prev = snapshotWalls(db, map.id);
    pushUndo({
      kind: 'wall:clear',
      label: 'Clear walls',
      inverse: () => {
        restoreWalls(db, map.id, prev);
        io.emit('walls:state', snapshotWalls(db, map.id));
        recomputeFog(map.id);
        broadcastState();
      },
    });
    db.prepare('DELETE FROM walls WHERE map_id=?').run(map.id);
    io.emit('walls:state', []);
    recomputeFog(map.id);
    broadcastState();
  });

  socket.on('map:generate-random', () => {
    if (!requireDM(socket)) return;
    const map = getActiveMap();
    if (!map) return;
    const prevWalls = snapshotWalls(db, map.id);
    // Snapshot existing object tokens so undo restores furniture too.
    const prevObjectTokens = db.prepare(
      "SELECT * FROM tokens WHERE map_id=? AND kind='object'"
    ).all(map.id);
    const { walls: gen, furniture } = generateRandomDungeon(map.width, map.height);
    const insWall = db.prepare('INSERT INTO walls (map_id, cx, cy, side, kind, open) VALUES (?,?,?,?,?,?)');
    const insTok = db.prepare(`INSERT INTO tokens
      (map_id,kind,name,image,x,y,hp_current,hp_max,ac,light_radius,light_type,facing,color,owner_id,size,race,move)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM walls WHERE map_id=?').run(map.id);
      for (const w of gen) {
        insWall.run(map.id, w.cx, w.cy, w.side, w.kind || 'wall', w.open ? 1 : 0);
      }
      // Replace existing furniture tokens with newly placed ones.
      db.prepare("DELETE FROM tokens WHERE map_id=? AND kind='object'").run(map.id);
      for (const f of (furniture || [])) {
        const preset = getObjectById(f.preset);
        if (!preset) continue;
        insTok.run(
          map.id, 'object', preset.name, preset.image,
          f.cx, f.cy,
          preset.hp || 1, preset.hp || 1, preset.ac || 10,
          0, 'none', 0,
          preset.color || '#2a2a2a', null,
          sizeMultiplier(preset.size), null, 0
        );
      }
    });
    tx();
    pushUndo({
      kind: 'map:generate-random',
      label: 'Generate random map',
      inverse: () => {
        const restore = db.transaction(() => {
          restoreWalls(db, map.id, prevWalls);
          db.prepare("DELETE FROM tokens WHERE map_id=? AND kind='object'").run(map.id);
          const restoreIns = db.prepare(`INSERT INTO tokens
            (id,map_id,kind,name,image,x,y,hp_current,hp_max,ac,light_radius,light_type,facing,color,owner_id,size,race,move)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
          for (const r of prevObjectTokens) {
            restoreIns.run(r.id, r.map_id, r.kind, r.name, r.image, r.x, r.y,
              r.hp_current, r.hp_max, r.ac, r.light_radius, r.light_type, r.facing,
              r.color, r.owner_id, r.size, r.race, r.move);
          }
        });
        restore();
        recomputeFog(map.id);
        io.emit('walls:state', db.prepare('SELECT cx, cy, side, kind, open FROM walls WHERE map_id=?').all(map.id));
        broadcastState();
      },
    });
    recomputeFog(map.id);
    io.emit('walls:state', db.prepare('SELECT cx, cy, side, kind, open FROM walls WHERE map_id=?').all(map.id));
    broadcastState();
  });

  socket.on('wall:rect', ({ x1, y1, x2, y2 }) => {
    if (!requireDM(socket)) return;
    const map = getActiveMap();
    const prev = snapshotWalls(db, map.id);
    pushUndo({
      kind: 'wall:rect',
      label: 'Room walls',
      inverse: () => {
        restoreWalls(db, map.id, prev);
        io.emit('walls:state', snapshotWalls(db, map.id));
        recomputeFog(map.id);
        broadcastState();
      },
    });
    const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
    const ins = db.prepare('INSERT OR IGNORE INTO walls (map_id, cx, cy, side) VALUES (?,?,?,?)');
    const tx = db.transaction(() => {
      for (let x = minX; x <= maxX; x++) {
        ins.run(map.id, x, minY, 'n');       // top edge
        ins.run(map.id, x, maxY + 1, 'n');   // bottom edge (= top of row below)
      }
      for (let y = minY; y <= maxY; y++) {
        ins.run(map.id, minX, y, 'w');       // left edge
        ins.run(map.id, maxX + 1, y, 'w');   // right edge (= left of col to right)
      }
    });
    tx();
    io.emit('walls:state', db.prepare('SELECT cx, cy, side, kind, open FROM walls WHERE map_id=?').all(map.id));
    recomputeFog(map.id);
  });

  socket.on('catalog:add', (data) => {
    if (!requireDM(socket)) return;
    db.prepare('INSERT INTO catalog (name, kind, image, size) VALUES (?,?,?,?)')
      .run(data.name, data.kind || 'object', data.image || null, data.size || 1);
    broadcastState();
  });

  socket.on('chat:msg', ({ text }) => {
    io.emit('chat:msg', { from: me.name, role: me.role, text, ts: Date.now() });
  });

  socket.on('chat:clear', () => {
    if (!canClearChat(me.role)) return;
    io.emit('chat:cleared', { by: me.name, ts: Date.now() });
  });

  socket.on('dice:roll', ({ expr }) => {
    const result = rollDice(expr);
    io.emit('chat:msg', { from: me.name, role: me.role, text: `🎲 ${expr} = **${result.total}** (${result.rolls.join(', ')})`, ts: Date.now() });
  });

  socket.on('dm:update-request', () => {
    if (!requireDM(socket)) return;
    const reply = (text) => socket.emit('chat:msg', { from: 'system', role: 'dm', text, ts: Date.now() });
    try {
      const fname = buildTriggerFilename();
      fs.writeFileSync(path.join(TRIGGER_DIR, fname), `${me.name} @ ${new Date().toISOString()}\n`);
      reply(`🔄 Update requested (${fname}). The host runner picks this up within ~1 minute; the app will restart if a new commit is found.`);
    } catch (e) {
      reply(`⚠️ Update trigger failed: ${e.code || e.message}. Host-side updater may not be configured — check /volume1/docker/dungeon-grid/triggers is bind-mounted.`);
    }
  });

  socket.on('dm:undo', () => {
    if (!requireDM(socket)) return;
    const entry = undoStack.pop();
    if (!entry) { broadcastState(); return; }
    try { entry.inverse(); } catch (e) { console.error('undo failed', e); }
    broadcastState();
  });

  socket.on('light:resolve', ({ approved, tokenId }) => {
    if (!requireDM(socket)) return;
    const pending = pendingLights.get(tokenId);
    if (!pending) return;
    pendingLights.delete(tokenId);
    if (approved) {
      const prev = snapshotToken(db, tokenId);
      if (prev) {
        pushUndo({
          kind: 'token:update',
          label: `Light change ${prev.name || 'token'}`,
          inverse: () => {
            restoreTokenRow(db, prev);
            autoRevealForToken(tokenId);
            broadcastState();
          },
        });
      }
      db.prepare('UPDATE tokens SET light_type=?, light_radius=? WHERE id=?')
        .run(pending.to.light_type, pending.to.light_radius, tokenId);
      autoRevealForToken(tokenId);
    }
    broadcastState();
  });

  socket.on('approval:resolve', ({ approved, tokenId }) => {
    if (!requireDM(socket)) return;
    const pending = pendingMoves.get(tokenId);
    if (!pending) return;
    pendingMoves.delete(tokenId);
    if (approved) {
      db.prepare('UPDATE tokens SET x=?, y=? WHERE id=?').run(pending.toX, pending.toY, tokenId);
      autoRevealForToken(tokenId);
    }
    broadcastState();
  });
});

server.listen(PORT, () => {
  console.log(`dungeon-grid running on http://localhost:${PORT}`);
});
