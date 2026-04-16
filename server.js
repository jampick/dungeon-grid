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
  computeActivePlayerIds, reassignOwnedTokensToNull,
  applyTerrainPaint, applyTerrainClear, computeFollowerTargets, canMoveToken } from './lib/logic.js';
import { getObjectById } from './lib/objects.js';
import { sizeMultiplier } from './lib/creatures.js';
import { listMaps, createMap as createMapDb, renameMap as renameMapDb, activateMap as activateMapDb, duplicateMap as duplicateMapDb, deleteMap as deleteMapDb, performTravel, nullLinksToMap } from './lib/maps.js';
import { getDeploymentInfo, TRIGGER_DIR, buildTriggerFilename } from './lib/deployment.js';
import { hashPassword, verifyPassword, makeLoginLimiter } from './lib/auth.js';
import { migrate, seedDefaultSession, deleteSession } from './lib/sessions.js';

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
// Session deep-link. The client-side router inspects window.location on boot
// to distinguish `/` (landing) from `/s/<id>` (session shell). Server always
// serves the same HTML — the session-not-found case is rendered client side.
app.get('/s/:id', (req, res) => {
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

// Destructive one-shot migration — if the new `sessions` table isn't present
// we drop every legacy table and rebuild from the Phase 1a schema. The user
// explicitly confirmed losing pre-migration data is acceptable.
migrate(db);
seedDefaultSession(db);

// First-boot seed of the global DM password hash. Subsequent boots prefer
// whatever's already in the DB so rotating via the API sticks even if the
// env var still carries an old value. Recovery path: delete the row and
// restart with DM_PASSWORD set.
{
  const existing = db.prepare("SELECT value FROM instance_settings WHERE key='dm_password_hash'").get();
  if (!existing) {
    const hash = hashPassword(DM_PASSWORD);
    db.prepare("INSERT INTO instance_settings (key, value) VALUES ('dm_password_hash', ?)").run(hash);
  }
}

// Light presets / FACING_VEC / computeRevealed now live in lib/logic.js.

function recomputeFog(mapId, sid) {
  return recomputeFogLogic(db, (event, payload) => {
    if (sid) io.to(`session:${sid}`).emit(event, payload);
    else io.emit(event, payload);
  }, mapId);
}
function autoRevealForToken(tokenId, sid) {
  const t = db.prepare('SELECT map_id FROM tokens WHERE id=?').get(tokenId);
  if (t) recomputeFog(t.map_id, sid);
}
// Resolve the owning session for a map id so cascading server-side
// operations (undo inverses, etc.) can target the correct broadcast room.
function sessionForMap(mapId) {
  const r = db.prepare('SELECT session_id FROM maps WHERE id=?').get(mapId);
  return r?.session_id || null;
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
      // Resolve the player's session (they may have disconnected so we
      // look them up from the still-present player row) and reassign any
      // owned tokens on that session's active map.
      const pRow = db.prepare('SELECT session_id FROM players WHERE id=?').get(playerId);
      if (pRow) {
        const map = getActiveMap(pRow.session_id);
        if (map) reassignOwnedTokensToNull(db, map.id, playerId);
        broadcastState(pRow.session_id);
      }
    }, DISCONNECT_GRACE_MS);
    // Don't keep the event loop alive purely for this timer.
    if (typeof timer.unref === 'function') timer.unref();
    playerDisconnectTimers.set(playerId, timer);
  }
}

// In-memory undo stack for DM actions. Cleared when the active map changes.
const undoStack = createUndoStack();
function pushUndo(entry) { undoStack.push(entry); }

// Seed a default map for the default session on first boot.
{
  const defaultMapCount = db.prepare("SELECT COUNT(*) c FROM maps WHERE session_id='default'").get().c;
  if (!defaultMapCount) {
    db.prepare("INSERT INTO maps (session_id, name, active) VALUES ('default', 'Blank Map', 1)").run();
  }
}

// --- Auth ---
function newToken() { return crypto.randomBytes(16).toString('hex'); }
function verifyDm(pw) {
  const row = db.prepare("SELECT value FROM instance_settings WHERE key='dm_password_hash'").get();
  if (!row) return false;
  return verifyPassword(pw, row.value);
}
const loginLimiter = makeLoginLimiter();

function authFromReq(req) {
  const t = req.headers['x-player-token'] || req.query.t;
  if (!t) return null;
  return db.prepare('SELECT * FROM players WHERE token = ?').get(t);
}

// --- Session endpoints ---
app.get('/api/sessions', (req, res) => {
  const rows = db.prepare(
    'SELECT id, name, join_password_hash, last_active_at FROM sessions ORDER BY last_active_at DESC'
  ).all();
  res.json(rows.map(r => ({
    id: r.id,
    name: r.name,
    has_join_password: !!r.join_password_hash,
    last_active_at: r.last_active_at,
    active_players: io.sockets.adapter.rooms.get('session:' + r.id)?.size || 0,
  })));
});

app.get('/api/sessions/:id', (req, res) => {
  const row = db.prepare('SELECT id, name, join_password_hash, approval_mode, door_approval, light_approval, show_other_hp, ruleset, party_leader_id, last_active_at FROM sessions WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json({
    id: row.id,
    name: row.name,
    has_join_password: !!row.join_password_hash,
    approval_mode: row.approval_mode,
    door_approval: row.door_approval,
    light_approval: row.light_approval,
    show_other_hp: row.show_other_hp,
    ruleset: row.ruleset,
    party_leader_id: row.party_leader_id,
    last_active_at: row.last_active_at,
  });
});

app.post('/api/sessions', loginLimiter, (req, res) => {
  const { name, join_password, dm_password } = req.body || {};
  if (!name || !dm_password) return res.status(400).json({ error: 'missing' });
  if (!verifyDm(dm_password)) return res.status(401).json({ error: 'wrong dm password' });
  const id = crypto.randomBytes(5).toString('hex');
  const now = Date.now();
  const joinHash = join_password ? hashPassword(join_password) : null;
  db.prepare('INSERT INTO sessions (id, name, join_password_hash, created_at, last_active_at) VALUES (?,?,?,?,?)')
    .run(id, name, joinHash, now, now);
  // Seed a blank map so the new session has something to look at.
  db.prepare("INSERT INTO maps (session_id, name, active) VALUES (?, 'Blank Map', 1)").run(id);
  res.json({ id, name });
});

app.patch('/api/sessions/:id', (req, res) => {
  const user = authFromReq(req);
  if (!user || user.role !== 'dm' || user.session_id !== req.params.id) {
    return res.status(401).json({ error: 'unauth' });
  }
  const data = req.body || {};
  const fields = ['name','ruleset','approval_mode','door_approval','light_approval','show_other_hp','party_leader_id'];
  const sets = [], vals = [];
  for (const f of fields) if (f in data) { sets.push(`${f}=?`); vals.push(data[f]); }
  if ('join_password' in data) {
    sets.push('join_password_hash=?');
    vals.push(data.join_password ? hashPassword(data.join_password) : null);
  }
  if (!sets.length) return res.json({ ok: true });
  vals.push(req.params.id);
  db.prepare(`UPDATE sessions SET ${sets.join(',')} WHERE id=?`).run(...vals);
  res.json({ ok: true });
});

app.delete('/api/sessions/:id', (req, res) => {
  const user = authFromReq(req);
  if (!user || user.role !== 'dm' || user.session_id !== req.params.id) {
    return res.status(401).json({ error: 'unauth' });
  }
  deleteSession(db, req.params.id, path.join(__dirname, 'uploads'));
  res.json({ ok: true });
});

app.put('/api/instance/dm-password', loginLimiter, (req, res) => {
  const { old: oldPw, new: newPw } = req.body || {};
  if (!oldPw || !newPw) return res.status(400).json({ error: 'missing' });
  if (!verifyDm(oldPw)) return res.status(401).json({ error: 'wrong password' });
  const newHash = hashPassword(newPw);
  db.prepare("UPDATE instance_settings SET value=? WHERE key='dm_password_hash'").run(newHash);
  res.json({ ok: true });
});

// --- Login endpoints ---
app.post('/api/login/dm', loginLimiter, (req, res) => {
  const r = loginDm(db, req.body || {}, { verifyDm, newToken });
  if (!r.ok) return res.status(r.status || 400).json({ error: r.error });
  const now = Date.now();
  db.prepare('UPDATE sessions SET last_active_at=? WHERE id=?').run(now, r.session_id);
  res.json({ token: r.token, role: r.role, name: r.name, playerId: r.playerId, session_id: r.session_id });
});

app.post('/api/login/player', loginLimiter, (req, res) => {
  const r = loginPlayer(db, req.body || {}, { newToken, verifyJoin: verifyPassword });
  if (!r.ok) return res.status(r.status || 400).json({ error: r.error });
  const now = Date.now();
  db.prepare('UPDATE sessions SET last_active_at=? WHERE id=?').run(now, r.session_id);
  res.json({ token: r.token, role: r.role, name: r.name, playerId: r.playerId, session_id: r.session_id });
});

// --- Uploads ---
const MIME_TO_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};
function requireAuth(req, res, next) {
  const user = authFromReq(req);
  if (!user) return res.status(401).json({ error: 'unauth' });
  req.user = user;
  next();
}
// Session-scoped upload storage. Multer writes the temp file before the
// handler runs, so we resolve the player's session in the destination
// callback. Rejected uploads (unauthenticated) never touch disk.
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const user = authFromReq(req);
      if (!user) return cb(new Error('unauth'));
      const dir = path.join(__dirname, 'uploads', user.session_id);
      try { fs.mkdirSync(dir, { recursive: true }); } catch {}
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const base = crypto.randomBytes(8).toString('hex');
      cb(null, base);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (MIME_TO_EXT[file.mimetype]) return cb(null, true);
    cb(null, false);
  },
});
app.post('/api/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'image required (png/jpeg/webp/gif)' });
  const ext = MIME_TO_EXT[req.file.mimetype];
  const newName = req.file.filename + ext;
  fs.renameSync(req.file.path, path.join(path.dirname(req.file.path), newName));
  res.json({ url: `/uploads/${req.user.session_id}/${newName}` });
});

// --- Deployment info (captured once at startup) ---
const DEPLOYMENT = getDeploymentInfo();

// --- State helpers ---
function getActiveMap(sid) {
  return db.prepare('SELECT * FROM maps WHERE session_id=? AND active=1 ORDER BY id LIMIT 1').get(sid);
}
function getState(sid) {
  const session = db.prepare('SELECT * FROM sessions WHERE id=?').get(sid);
  // Preserve the legacy `campaign` shape on the state payload so existing
  // server code (and tests) that reaches for campaign.party_leader_id /
  // approval_mode / etc. keeps working without a wholesale rename.
  const campaign = session ? { ...session, id: session.id } : null;
  const maps = db.prepare('SELECT * FROM maps WHERE session_id=?').all(sid);
  const activeMap = getActiveMap(sid);
  const tokens = activeMap ? db.prepare('SELECT * FROM tokens WHERE map_id=?').all(activeMap.id) : [];
  const fogRow = activeMap ? db.prepare('SELECT data FROM fog WHERE map_id=?').get(activeMap.id) : null;
  const walls = activeMap ? db.prepare('SELECT cx, cy, side, kind, open FROM walls WHERE map_id=?').all(activeMap.id) : [];
  const catalog = db.prepare('SELECT * FROM catalog WHERE session_id=?').all(sid);
  const players = db.prepare('SELECT id, name, role FROM players WHERE session_id=?').all(sid);
  const pendings = [...pendingMoves.entries()].map(([id, v]) => ({ id, ...v }));
  const doorPendings = [...pendingDoors.entries()].map(([key, v]) => ({ key, ...v }));
  const lightPendings = [...pendingLights.entries()].map(([id, v]) => ({ id, ...v }));
  let explored = [];
  let memoryTokens = [];
  let terrain = [];
  if (activeMap) {
    explored = db.prepare('SELECT cx, cy FROM explored_cells WHERE map_id=?').all(activeMap.id).map(r => `${r.cx},${r.cy}`);
    let fogSet = null;
    try { fogSet = new Set(JSON.parse(fogRow?.data || '[]')); } catch { fogSet = new Set(); }
    memoryTokens = computeMemoryTokensFromDb(db, activeMap.id, fogSet);
    terrain = db.prepare('SELECT cx, cy, kind FROM terrain WHERE map_id=?').all(activeMap.id);
  }
  const activePlayerIds = computeActivePlayerIds(activePlayers);
  return { campaign, maps, activeMap, tokens, fog: fogRow?.data || null, walls, catalog, players, activePlayerIds, pendings, doorPendings, lightPendings, undoLabel: undoStack.topLabel(), deployment: DEPLOYMENT, explored, memoryTokens, terrain };
}

app.get('/api/state', (req, res) => {
  const user = authFromReq(req);
  if (!user) return res.status(401).json({ error: 'unauth' });
  res.json({ me: { id: user.id, name: user.name, role: user.role, session_id: user.session_id }, ...getState(user.session_id) });
});

// --- Socket.IO real-time ---
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('unauth'));
  const p = db.prepare('SELECT * FROM players WHERE token=?').get(token);
  if (!p) return next(new Error('unauth'));
  socket.data.player = p;
  socket.data.session_id = p.session_id;
  socket.join(`session:${p.session_id}`);
  next();
});

function broadcastState(sid) {
  if (sid) io.to(`session:${sid}`).emit('state', getState(sid));
}

function requireDM(socket) { return socket.data.player.role === 'dm'; }

io.on('connection', (socket) => {
  const me = socket.data.player;
  const sid = socket.data.session_id;
  // Track this socket against its player so the owner dropdown can filter
  // to currently-connected players, and so we can reassign ownership when
  // they leave (after a grace period).
  addPlayerSocket(me.id, socket.id);
  socket.on('disconnect', () => {
    removePlayerSocket(me.id, socket.id);
    broadcastState(sid);
  });
  socket.emit('hello', { id: me.id, name: me.name, role: me.role, session_id: sid });
  socket.emit('state', getState(sid));
  // Notify everyone that the active-player set changed.
  broadcastState(sid);

  socket.on('token:move', ({ id, x, y }) => {
    const t = db.prepare('SELECT * FROM tokens WHERE id=?').get(id);
    if (!t) return;
    // Permission: DM, owner, OR party-leader-owning-player moving a PC.
    // The leader exception lets the lead player reposition other party
    // members directly (not just via auto-follow-on-drag).
    const campaignRow0 = db.prepare('SELECT * FROM sessions WHERE id=?').get(sid);
    const leaderToken0 = campaignRow0 && campaignRow0.party_leader_id
      ? db.prepare('SELECT * FROM tokens WHERE id=?').get(campaignRow0.party_leader_id)
      : null;
    if (!canMoveToken(me, t, campaignRow0, leaderToken0)) return;
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
    const campaign = db.prepare('SELECT * FROM sessions WHERE id=?').get(sid);
    if (campaign.approval_mode && me.role !== 'dm') {
      // Queue as pending; original position is whatever is currently committed
      pendingMoves.set(id, { fromX: t.x, fromY: t.y, toX: x, toY: y, actor: me.name });
      broadcastState(sid);
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
          io.to(`session:${sid}`).emit('token:update', { id, x: fromX, y: fromY });
          autoRevealForToken(id, sid);
          broadcastState(sid);
        },
      });
    }
    db.prepare('UPDATE tokens SET x=?, y=? WHERE id=?').run(x, y, id);
    io.to(`session:${sid}`).emit('token:update', { id, x, y });
    autoRevealForToken(id, sid);
    broadcastState(sid);
  });

  socket.on('token:create', (data) => {
    if (!requireDM(socket) && data.kind !== 'pc') return;
    const map = getActiveMap(sid);
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
          broadcastState(sid);
        },
      });
    }
    autoRevealForToken(info.lastInsertRowid);
    broadcastState(sid);
  });

  socket.on('token:update', (data) => {
    const t = db.prepare('SELECT * FROM tokens WHERE id=?').get(data.id);
    if (!t) return;
    if (me.role !== 'dm' && t.owner_id !== me.id) return;
    // Player light changes may need DM approval. If so, record the pending
    // entry and strip light fields from this update so remaining edits
    // (name/HP/etc.) still apply immediately.
    const campaignRow = db.prepare('SELECT * FROM sessions WHERE id=?').get(sid);
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
      io.to(`session:${sid}`).emit('chat:msg', { from: 'system', role: 'dm', text: `${me.name}'s light source change for ${t.name || 'token'} is pending DM approval.`, ts: Date.now() });
    }
    const fields = ['name','hp_current','hp_max','ac','light_radius','light_type','facing','color','image','size','kind','owner_id','race','move','aoe','link_map_id','link_x','link_y'];
    const sets = [], vals = [];
    for (const f of fields) if (f in data) { sets.push(`${f}=?`); vals.push(data[f]); }
    if (!sets.length) { broadcastState(sid); return; }
    if (me.role === 'dm') {
      const prev = snapshotToken(db, data.id);
      pushUndo({
        kind: 'token:update',
        label: `Update ${t.name || 'token'}`,
        inverse: () => {
          restoreTokenRow(db, prev);
          autoRevealForToken(data.id);
          broadcastState(sid);
        },
      });
    }
    vals.push(data.id);
    db.prepare(`UPDATE tokens SET ${sets.join(',')} WHERE id=?`).run(...vals);
    autoRevealForToken(data.id);
    broadcastState(sid);
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
        broadcastState(sid);
      },
    });
    recomputeFog(prev.map_id);
    broadcastState(sid);
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
    const prevActive = me.role === 'dm' ? getActiveMap(sid) : null;
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
        broadcastState(sid);
      },
    });
    // DMs take the whole table with them. Players travel solo and stay
    // rendered against whatever map is currently active for the campaign.
    if (me.role === 'dm') {
      activateMapDb(db, result.toMapId);
    }
    recomputeFog(result.fromMapId);
    recomputeFog(result.toMapId);
    broadcastState(sid);
  });

  socket.on('map:update', (data) => {
    if (!requireDM(socket)) return;
    const map = getActiveMap(sid);
    const fields = ['name','grid_type','grid_size','width','height','background','cell_feet','fog_mode'];
    const sets = [], vals = [];
    for (const f of fields) if (f in data) {
      let v = data[f];
      if (f === 'fog_mode' && !['dungeon','outdoor','none'].includes(v)) v = 'dungeon';
      sets.push(`${f}=?`); vals.push(v);
    }
    if (!sets.length) return;
    const prev = snapshotMap(db, map.id);
    pushUndo({
      kind: 'map:update',
      label: 'Map settings',
      inverse: () => {
        db.prepare('UPDATE maps SET name=?, grid_type=?, grid_size=?, width=?, height=?, background=?, fog_mode=? WHERE id=?')
          .run(prev.name, prev.grid_type, prev.grid_size, prev.width, prev.height, prev.background, prev.fog_mode || 'dungeon', prev.id);
        recomputeFog(prev.id);
        broadcastState(sid);
      },
    });
    vals.push(map.id);
    db.prepare(`UPDATE maps SET ${sets.join(',')} WHERE id=?`).run(...vals);
    recomputeFog(map.id);
    broadcastState(sid);
  });

  socket.on('map:create', (data) => {
    if (!requireDM(socket)) return;
    const campaign = db.prepare('SELECT * FROM sessions WHERE id=?').get(sid);
    const newId = createMapDb(db, campaign.id, data || {});
    if (data && data.activate) activateMapDb(db, newId);
    broadcastState(sid);
  });

  socket.on('map:activate', ({ id }) => {
    if (!requireDM(socket)) return;
    activateMapDb(db, id);
    undoStack.clear();
    broadcastState(sid);
  });

  socket.on('map:rename', ({ id, name }) => {
    if (!requireDM(socket)) return;
    renameMapDb(db, id, name);
    broadcastState(sid);
  });

  socket.on('map:duplicate', ({ id }) => {
    if (!requireDM(socket)) return;
    duplicateMapDb(db, id);
    broadcastState(sid);
  });

  socket.on('memory:clear', () => {
    if (!requireDM(socket)) return;
    const map = getActiveMap(sid);
    if (!map) return;
    db.prepare('DELETE FROM explored_cells WHERE map_id=?').run(map.id);
    db.prepare('DELETE FROM cell_memory WHERE map_id=?').run(map.id);
    recomputeFog(map.id);
    broadcastState(sid);
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
    broadcastState(sid);
  });

  socket.on('campaign:settings', (data) => {
    if (!requireDM(socket)) return;
    const c = db.prepare('SELECT * FROM sessions WHERE id=?').get(sid);
    const fields = ['ruleset','approval_mode','door_approval','light_approval','show_other_hp','name','party_leader_id'];
    const sets = [], vals = [];
    for (const f of fields) if (f in data) { sets.push(`${f}=?`); vals.push(data[f]); }
    if (!sets.length) return;
    vals.push(c.id);
    db.prepare(`UPDATE sessions SET ${sets.join(',')} WHERE id=?`).run(...vals);
    if ('approval_mode' in data && !data.approval_mode) pendingMoves.clear();
    if ('door_approval' in data && !data.door_approval) pendingDoors.clear();
    if ('light_approval' in data && !data.light_approval) pendingLights.clear();
    broadcastState(sid);
  });

  socket.on('fog:update', ({ data }) => {
    if (!requireDM(socket)) return;
    const map = getActiveMap(sid);
    const prev = snapshotFog(db, map.id);
    pushUndo({
      kind: 'fog:update',
      label: 'Fog paint',
      inverse: () => {
        if (prev == null) {
          db.prepare('DELETE FROM fog WHERE map_id=?').run(map.id);
          io.to(`session:${sid}`).emit('fog:state', { data: '[]' });
        } else {
          db.prepare('INSERT INTO fog (map_id, data) VALUES (?,?) ON CONFLICT(map_id) DO UPDATE SET data=excluded.data').run(map.id, prev);
          io.to(`session:${sid}`).emit('fog:state', { data: prev });
        }
        broadcastState(sid);
      },
    });
    db.prepare('INSERT INTO fog (map_id, data) VALUES (?,?) ON CONFLICT(map_id) DO UPDATE SET data=excluded.data').run(map.id, data);
    io.to(`session:${sid}`).emit('fog:state', { data });
    broadcastState(sid);
  });

  socket.on('terrain:paint', ({ cx, cy, kind }) => {
    if (!requireDM(socket)) return;
    const map = getActiveMap(sid);
    if (!map) return;
    const r = applyTerrainPaint(db, map.id, cx, cy, kind);
    if (!r.ok) return;
    io.to(`session:${sid}`).emit('terrain:state', db.prepare('SELECT cx, cy, kind FROM terrain WHERE map_id=?').all(map.id));
  });

  socket.on('terrain:clear', ({ cx, cy }) => {
    if (!requireDM(socket)) return;
    const map = getActiveMap(sid);
    if (!map) return;
    const r = applyTerrainClear(db, map.id, cx, cy);
    if (!r.ok) return;
    io.to(`session:${sid}`).emit('terrain:state', db.prepare('SELECT cx, cy, kind FROM terrain WHERE map_id=?').all(map.id));
  });

  socket.on('terrain:rect', ({ x1, y1, x2, y2, kind }) => {
    if (!requireDM(socket)) return;
    const map = getActiveMap(sid);
    if (!map) return;
    const xa = Math.min(x1, x2), xb = Math.max(x1, x2);
    const ya = Math.min(y1, y2), yb = Math.max(y1, y2);
    const tx = db.transaction(() => {
      for (let cy = ya; cy <= yb; cy++) {
        for (let cx = xa; cx <= xb; cx++) {
          if (kind == null) applyTerrainClear(db, map.id, cx, cy);
          else applyTerrainPaint(db, map.id, cx, cy, kind);
        }
      }
    });
    tx();
    io.to(`session:${sid}`).emit('terrain:state', db.prepare('SELECT cx, cy, kind FROM terrain WHERE map_id=?').all(map.id));
  });

  socket.on('wall:toggle', ({ cx, cy, side }) => {
    if (!requireDM(socket)) return;
    const map = getActiveMap(sid);
    const prev = snapshotWalls(db, map.id);
    const existing = db.prepare('SELECT kind FROM walls WHERE map_id=? AND cx=? AND cy=? AND side=?').get(map.id, cx, cy, side);
    if (existing) db.prepare('DELETE FROM walls WHERE map_id=? AND cx=? AND cy=? AND side=?').run(map.id, cx, cy, side);
    else db.prepare("INSERT INTO walls (map_id, cx, cy, side, kind, open) VALUES (?,?,?,?,'wall',0)").run(map.id, cx, cy, side);
    pushUndo({
      kind: 'wall:toggle',
      label: existing ? 'Delete wall' : 'Create wall',
      inverse: () => {
        restoreWalls(db, map.id, prev);
        io.to(`session:${sid}`).emit('walls:state', snapshotWalls(db, map.id));
        recomputeFog(map.id);
        broadcastState(sid);
      },
    });
    io.to(`session:${sid}`).emit('walls:state', db.prepare('SELECT cx, cy, side, kind, open FROM walls WHERE map_id=?').all(map.id));
    recomputeFog(map.id);
    broadcastState(sid);
  });

  socket.on('door:request', ({ cx, cy, side }) => {
    // Player (or DM) wants to open/close a door
    const map = getActiveMap(sid);
    const d = db.prepare("SELECT kind, open FROM walls WHERE map_id=? AND cx=? AND cy=? AND side=? AND kind='door'").get(map.id, cx, cy, side);
    if (!d) return;
    const campaign = db.prepare('SELECT * FROM sessions WHERE id=?').get(sid);
    const toOpen = !d.open;
    if (me.role !== 'dm' && campaign.door_approval) {
      pendingDoors.set(`${cx},${cy},${side}`, { actor: me.name, toOpen, cx, cy, side });
      broadcastState(sid);
      return;
    }
    db.prepare('UPDATE walls SET open=? WHERE map_id=? AND cx=? AND cy=? AND side=?').run(toOpen ? 1 : 0, map.id, cx, cy, side);
    pendingDoors.delete(`${cx},${cy},${side}`);
    io.to(`session:${sid}`).emit('walls:state', db.prepare('SELECT cx, cy, side, kind, open FROM walls WHERE map_id=?').all(map.id));
    recomputeFog(map.id);
    broadcastState(sid);
  });

  socket.on('door:resolve', ({ approved, key }) => {
    if (!requireDM(socket)) return;
    const p = pendingDoors.get(key);
    if (!p) return;
    pendingDoors.delete(key);
    if (approved) {
      const map = getActiveMap(sid);
      db.prepare('UPDATE walls SET open=? WHERE map_id=? AND cx=? AND cy=? AND side=?').run(p.toOpen ? 1 : 0, map.id, p.cx, p.cy, p.side);
      io.to(`session:${sid}`).emit('walls:state', db.prepare('SELECT cx, cy, side, kind, open FROM walls WHERE map_id=?').all(map.id));
      recomputeFog(map.id);
    }
    broadcastState(sid);
  });

  socket.on('door:cycle', ({ cx, cy, side }) => {
    if (!requireDM(socket)) return;
    const map = getActiveMap(sid);
    const prev = snapshotWalls(db, map.id);
    pushUndo({
      kind: 'door:cycle',
      label: 'Door cycle',
      inverse: () => {
        restoreWalls(db, map.id, prev);
        io.to(`session:${sid}`).emit('walls:state', snapshotWalls(db, map.id));
        recomputeFog(map.id);
        broadcastState(sid);
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
    io.to(`session:${sid}`).emit('walls:state', db.prepare('SELECT cx, cy, side, kind, open FROM walls WHERE map_id=?').all(map.id));
    recomputeFog(map.id);
  });

  socket.on('wall:clear', () => {
    if (!requireDM(socket)) return;
    const map = getActiveMap(sid);
    const prev = snapshotWalls(db, map.id);
    pushUndo({
      kind: 'wall:clear',
      label: 'Clear walls',
      inverse: () => {
        restoreWalls(db, map.id, prev);
        io.to(`session:${sid}`).emit('walls:state', snapshotWalls(db, map.id));
        recomputeFog(map.id);
        broadcastState(sid);
      },
    });
    db.prepare('DELETE FROM walls WHERE map_id=?').run(map.id);
    io.to(`session:${sid}`).emit('walls:state', []);
    recomputeFog(map.id);
    broadcastState(sid);
  });

  socket.on('map:generate-random', () => {
    if (!requireDM(socket)) return;
    const map = getActiveMap(sid);
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
        io.to(`session:${sid}`).emit('walls:state', db.prepare('SELECT cx, cy, side, kind, open FROM walls WHERE map_id=?').all(map.id));
        broadcastState(sid);
      },
    });
    recomputeFog(map.id);
    io.to(`session:${sid}`).emit('walls:state', db.prepare('SELECT cx, cy, side, kind, open FROM walls WHERE map_id=?').all(map.id));
    broadcastState(sid);
  });

  socket.on('wall:rect', ({ x1, y1, x2, y2 }) => {
    if (!requireDM(socket)) return;
    const map = getActiveMap(sid);
    const prev = snapshotWalls(db, map.id);
    pushUndo({
      kind: 'wall:rect',
      label: 'Room walls',
      inverse: () => {
        restoreWalls(db, map.id, prev);
        io.to(`session:${sid}`).emit('walls:state', snapshotWalls(db, map.id));
        recomputeFog(map.id);
        broadcastState(sid);
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
    io.to(`session:${sid}`).emit('walls:state', db.prepare('SELECT cx, cy, side, kind, open FROM walls WHERE map_id=?').all(map.id));
    recomputeFog(map.id);
  });

  socket.on('catalog:add', (data) => {
    if (!requireDM(socket)) return;
    db.prepare('INSERT INTO catalog (name, kind, image, size) VALUES (?,?,?,?)')
      .run(data.name, data.kind || 'object', data.image || null, data.size || 1);
    broadcastState(sid);
  });

  socket.on('chat:msg', ({ text }) => {
    io.to(`session:${sid}`).emit('chat:msg', { from: me.name, role: me.role, text, ts: Date.now() });
  });

  socket.on('chat:clear', () => {
    if (!canClearChat(me.role)) return;
    io.to(`session:${sid}`).emit('chat:cleared', { by: me.name, ts: Date.now() });
  });

  socket.on('dice:roll', ({ expr }) => {
    const result = rollDice(expr);
    io.to(`session:${sid}`).emit('chat:msg', { from: me.name, role: me.role, text: `🎲 ${expr} = **${result.total}** (${result.rolls.join(', ')})`, ts: Date.now() });
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
    if (!entry) { broadcastState(sid); return; }
    try { entry.inverse(); } catch (e) { console.error('undo failed', e); }
    broadcastState(sid);
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
            autoRevealForToken(tokenId, sid);
            broadcastState(sid);
          },
        });
      }
      db.prepare('UPDATE tokens SET light_type=?, light_radius=? WHERE id=?')
        .run(pending.to.light_type, pending.to.light_radius, tokenId);
      autoRevealForToken(tokenId, sid);
    }
    broadcastState(sid);
  });

  socket.on('approval:resolve', ({ approved, tokenId }) => {
    if (!requireDM(socket)) return;
    const pending = pendingMoves.get(tokenId);
    if (!pending) return;
    pendingMoves.delete(tokenId);
    if (approved) {
      db.prepare('UPDATE tokens SET x=?, y=? WHERE id=?').run(pending.toX, pending.toY, tokenId);
      io.to(`session:${sid}`).emit('token:update', { id: tokenId, x: pending.toX, y: pending.toY });
      autoRevealForToken(tokenId, sid);
      // Apply queued formation followers atomically with the leader move.
      if (Array.isArray(pending.followerMoves)) {
        for (const fm of pending.followerMoves) {
          db.prepare('UPDATE tokens SET x=?, y=? WHERE id=?').run(fm.targetX, fm.targetY, fm.tokenId);
          io.to(`session:${sid}`).emit('token:update', { id: fm.tokenId, x: fm.targetX, y: fm.targetY });
          autoRevealForToken(fm.tokenId);
        }
      }
    }
    broadcastState(sid);
  });

  // --- Party formation follow ---------------------------------------------
  // Sent immediately after the leader's token:move. The client provides the
  // snapshot of every other PC's position at the moment of drag start so the
  // server can authoritatively recompute follower targets (we don't trust the
  // client's targets — only the snapshot of starting positions).
  // In approval mode for a non-DM, the leader's pending move was already
  // queued by token:move; we look it up and attach the follower plan so a
  // single approval applies the whole formation atomically.
  socket.on('party:follow', ({ leaderId, leaderFromX, leaderFromY, followers }) => {
    const leader = db.prepare('SELECT * FROM tokens WHERE id=?').get(leaderId);
    if (!leader) return;
    const campaign = db.prepare('SELECT * FROM sessions WHERE id=?').get(sid);
    if (campaign.party_leader_id !== leaderId) return;
    if (me.role !== 'dm' && leader.owner_id !== me.id) return;
    const map = db.prepare('SELECT * FROM maps WHERE id=?').get(leader.map_id);
    if (!map) return;
    const wallRows = db.prepare('SELECT cx, cy, side, kind, open FROM walls WHERE map_id=?').all(leader.map_id);
    const wallSet = new Map(wallRows.map(w => [`${w.cx},${w.cy},${w.side}`, w]));
    // Filter follower snapshot: must be PC, on this map, not the leader,
    // currently exists. The client sends {id,x,y} from the moment of drag.
    const followerList = [];
    for (const f of (followers || [])) {
      const row = db.prepare('SELECT * FROM tokens WHERE id=?').get(f.id);
      if (!row) continue;
      if (row.kind !== 'pc') continue;
      if (row.map_id !== leader.map_id) continue;
      if (row.id === leaderId) continue;
      followerList.push({ id: row.id, x: f.x, y: f.y });
    }
    // Determine the leader's authoritative new position. In approval mode for
    // a non-DM, the leader move is in pendingMoves; otherwise it's already
    // committed in the tokens table.
    let newX, newY, oldX, oldY;
    const pending = pendingMoves.get(leaderId);
    if (pending) {
      newX = pending.toX; newY = pending.toY;
      oldX = pending.fromX; oldY = pending.fromY;
    } else {
      newX = leader.x; newY = leader.y;
      oldX = Number.isFinite(leaderFromX) ? leaderFromX : leader.x;
      oldY = Number.isFinite(leaderFromY) ? leaderFromY : leader.y;
    }
    if (oldX === newX && oldY === newY) return;
    const followerMoves = computeFollowerTargets(
      { x: oldX, y: oldY },
      followerList,
      newX, newY,
      wallSet,
      map,
    );
    if (pending) {
      // Single approval covers leader + entire formation.
      pending.followerMoves = followerMoves;
      pendingMoves.set(leaderId, pending);
      broadcastState(sid);
      return;
    }
    // Direct apply — capture undo as one combined entry.
    const beforeRows = followerMoves.map(fm => {
      const r = db.prepare('SELECT id, x, y FROM tokens WHERE id=?').get(fm.tokenId);
      return r ? { id: r.id, x: r.x, y: r.y } : null;
    }).filter(Boolean);
    if (me.role === 'dm') {
      pushUndo({
        kind: 'party:follow',
        label: 'Formation move',
        inverse: () => {
          for (const r of beforeRows) {
            db.prepare('UPDATE tokens SET x=?, y=? WHERE id=?').run(r.x, r.y, r.id);
            io.to(`session:${sid}`).emit('token:update', { id: r.id, x: r.x, y: r.y });
            autoRevealForToken(r.id);
          }
          broadcastState(sid);
        },
      });
    }
    for (const fm of followerMoves) {
      db.prepare('UPDATE tokens SET x=?, y=? WHERE id=?').run(fm.targetX, fm.targetY, fm.tokenId);
      io.to(`session:${sid}`).emit('token:update', { id: fm.tokenId, x: fm.targetX, y: fm.targetY });
      autoRevealForToken(fm.tokenId);
    }
    broadcastState(sid);
  });
});

server.listen(PORT, () => {
  console.log(`dungeon-grid running on http://localhost:${PORT}`);
});
