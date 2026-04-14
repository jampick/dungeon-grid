import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import Database from 'better-sqlite3';
import multer from 'multer';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { LIGHT_PRESETS, FACING_VEC, computeRevealed, rollDice, recomputeFog as recomputeFogLogic } from './lib/logic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DM_PASSWORD = process.env.DM_PASSWORD || 'changeme';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 10 * 1024 * 1024 });

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));
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
  active INTEGER DEFAULT 0
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
  size INTEGER DEFAULT 1
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
  const { password, name } = req.body;
  if (password !== DM_PASSWORD) return res.status(401).json({ error: 'bad password' });
  const campaign = db.prepare('SELECT * FROM campaigns ORDER BY id LIMIT 1').get();
  let p = db.prepare('SELECT * FROM players WHERE campaign_id=? AND role=?').get(campaign.id, 'dm');
  if (!p) {
    const info = db.prepare('INSERT INTO players (campaign_id, name, token, role) VALUES (?,?,?,?)').run(campaign.id, name || 'DM', newToken(), 'dm');
    p = db.prepare('SELECT * FROM players WHERE id=?').get(info.lastInsertRowid);
  }
  res.json({ token: p.token, role: p.role, name: p.name, playerId: p.id });
});

app.post('/api/login/player', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const campaign = db.prepare('SELECT * FROM campaigns ORDER BY id LIMIT 1').get();
  let p = db.prepare('SELECT * FROM players WHERE campaign_id=? AND name=? AND role=?').get(campaign.id, name, 'player');
  if (!p) {
    const info = db.prepare('INSERT INTO players (campaign_id, name, token, role) VALUES (?,?,?,?)').run(campaign.id, name, newToken(), 'player');
    p = db.prepare('SELECT * FROM players WHERE id=?').get(info.lastInsertRowid);
  }
  res.json({ token: p.token, role: p.role, name: p.name, playerId: p.id });
});

// --- Uploads ---
const upload = multer({
  dest: path.join(__dirname, 'uploads'),
  limits: { fileSize: 10 * 1024 * 1024 }
});
app.post('/api/upload', upload.single('file'), (req, res) => {
  const user = authFromReq(req);
  if (!user) return res.status(401).json({ error: 'unauth' });
  const ext = path.extname(req.file.originalname) || '.png';
  const newName = req.file.filename + ext;
  fs.renameSync(req.file.path, path.join(__dirname, 'uploads', newName));
  res.json({ url: '/uploads/' + newName });
});

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
  return { campaign, maps, activeMap, tokens, fog: fogRow?.data || null, walls, catalog, players, pendings, doorPendings };
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
  socket.emit('hello', { id: me.id, name: me.name, role: me.role });
  socket.emit('state', getState());

  socket.on('token:move', ({ id, x, y }) => {
    const t = db.prepare('SELECT * FROM tokens WHERE id=?').get(id);
    if (!t) return;
    if (me.role !== 'dm' && t.owner_id !== me.id) return;
    const campaign = db.prepare('SELECT * FROM campaigns ORDER BY id LIMIT 1').get();
    if (campaign.approval_mode && me.role !== 'dm') {
      // Queue as pending; original position is whatever is currently committed
      pendingMoves.set(id, { fromX: t.x, fromY: t.y, toX: x, toY: y, actor: me.name });
      broadcastState();
      return;
    }
    // Direct apply (DM or non-approval mode). Clear any pending on this token.
    pendingMoves.delete(id);
    db.prepare('UPDATE tokens SET x=?, y=? WHERE id=?').run(x, y, id);
    io.emit('token:update', { id, x, y });
    autoRevealForToken(id);
    broadcastState();
  });

  socket.on('token:create', (data) => {
    if (!requireDM(socket) && data.kind !== 'pc') return;
    const map = getActiveMap();
    const info = db.prepare(`INSERT INTO tokens (map_id,kind,name,image,x,y,hp_current,hp_max,ac,light_radius,light_type,facing,color,owner_id,size)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      map.id, data.kind || 'npc', data.name || '?', data.image || null,
      data.x || 5, data.y || 5, data.hp_current || 10, data.hp_max || 10,
      data.ac || 10, data.light_radius || 0, data.light_type || 'none', data.facing || 0,
      data.color || '#2a2a2a', data.owner_id || null, data.size || 1
    );
    autoRevealForToken(info.lastInsertRowid);
    broadcastState();
  });

  socket.on('token:update', (data) => {
    const t = db.prepare('SELECT * FROM tokens WHERE id=?').get(data.id);
    if (!t) return;
    if (me.role !== 'dm' && t.owner_id !== me.id) return;
    const fields = ['name','hp_current','hp_max','ac','light_radius','light_type','facing','color','image','size','kind','owner_id'];
    const sets = [], vals = [];
    for (const f of fields) if (f in data) { sets.push(`${f}=?`); vals.push(data[f]); }
    if (!sets.length) return;
    vals.push(data.id);
    db.prepare(`UPDATE tokens SET ${sets.join(',')} WHERE id=?`).run(...vals);
    autoRevealForToken(data.id);
    broadcastState();
  });

  socket.on('token:delete', ({ id }) => {
    if (!requireDM(socket)) return;
    const t = db.prepare('SELECT map_id FROM tokens WHERE id=?').get(id);
    pendingMoves.delete(id);
    db.prepare('DELETE FROM tokens WHERE id=?').run(id);
    if (t) recomputeFog(t.map_id);
    broadcastState();
  });

  socket.on('map:update', (data) => {
    if (!requireDM(socket)) return;
    const map = getActiveMap();
    const fields = ['name','grid_type','grid_size','width','height','background'];
    const sets = [], vals = [];
    for (const f of fields) if (f in data) { sets.push(`${f}=?`); vals.push(data[f]); }
    if (!sets.length) return;
    vals.push(map.id);
    db.prepare(`UPDATE maps SET ${sets.join(',')} WHERE id=?`).run(...vals);
    recomputeFog(map.id);
    broadcastState();
  });

  socket.on('map:create', (data) => {
    if (!requireDM(socket)) return;
    const campaign = db.prepare('SELECT * FROM campaigns ORDER BY id LIMIT 1').get();
    db.prepare('INSERT INTO maps (campaign_id, name, grid_type, grid_size, width, height) VALUES (?,?,?,?,?,?)')
      .run(campaign.id, data.name || 'New Map', data.grid_type || 'square', data.grid_size || 50, data.width || 30, data.height || 20);
    broadcastState();
  });

  socket.on('map:activate', ({ id }) => {
    if (!requireDM(socket)) return;
    const campaign = db.prepare('SELECT * FROM campaigns ORDER BY id LIMIT 1').get();
    db.prepare('UPDATE maps SET active=0 WHERE campaign_id=?').run(campaign.id);
    db.prepare('UPDATE maps SET active=1 WHERE id=?').run(id);
    broadcastState();
  });

  socket.on('campaign:settings', (data) => {
    if (!requireDM(socket)) return;
    const c = db.prepare('SELECT * FROM campaigns ORDER BY id LIMIT 1').get();
    const fields = ['ruleset','approval_mode','door_approval','show_other_hp','name'];
    const sets = [], vals = [];
    for (const f of fields) if (f in data) { sets.push(`${f}=?`); vals.push(data[f]); }
    if (!sets.length) return;
    vals.push(c.id);
    db.prepare(`UPDATE campaigns SET ${sets.join(',')} WHERE id=?`).run(...vals);
    if ('approval_mode' in data && !data.approval_mode) pendingMoves.clear();
    if ('door_approval' in data && !data.door_approval) pendingDoors.clear();
    broadcastState();
  });

  socket.on('fog:update', ({ data }) => {
    if (!requireDM(socket)) return;
    const map = getActiveMap();
    db.prepare('INSERT INTO fog (map_id, data) VALUES (?,?) ON CONFLICT(map_id) DO UPDATE SET data=excluded.data').run(map.id, data);
    io.emit('fog:state', { data });
  });

  socket.on('wall:toggle', ({ cx, cy, side }) => {
    if (!requireDM(socket)) return;
    const map = getActiveMap();
    const existing = db.prepare('SELECT kind FROM walls WHERE map_id=? AND cx=? AND cy=? AND side=?').get(map.id, cx, cy, side);
    if (existing) db.prepare('DELETE FROM walls WHERE map_id=? AND cx=? AND cy=? AND side=?').run(map.id, cx, cy, side);
    else db.prepare("INSERT INTO walls (map_id, cx, cy, side, kind, open) VALUES (?,?,?,?,'wall',0)").run(map.id, cx, cy, side);
    io.emit('walls:state', db.prepare('SELECT cx, cy, side, kind, open FROM walls WHERE map_id=?').all(map.id));
    recomputeFog(map.id);
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
    db.prepare('DELETE FROM walls WHERE map_id=?').run(map.id);
    io.emit('walls:state', []);
    recomputeFog(map.id);
  });

  socket.on('wall:rect', ({ x1, y1, x2, y2 }) => {
    if (!requireDM(socket)) return;
    const map = getActiveMap();
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

  socket.on('dice:roll', ({ expr }) => {
    const result = rollDice(expr);
    io.emit('chat:msg', { from: me.name, role: me.role, text: `🎲 ${expr} = **${result.total}** (${result.rolls.join(', ')})`, ts: Date.now() });
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
  console.log(`DM password: ${DM_PASSWORD}`);
});
