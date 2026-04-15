// Dungeon Grid client
const $ = (id) => document.getElementById(id);
const loginEl = $('login'), appEl = $('app');

let auth = JSON.parse(localStorage.getItem('dg_auth') || 'null');
let socket = null;
let state = null;
let me = null;
let editingTokenId = null;
let selectedTokenId = null;
let dragging = null;
let view = { scale: 1, ox: 0, oy: 0 };
const LIGHT_PRESETS = {
  none:        { radius: 0,  cone: false },
  candle:      { radius: 2,  cone: false },
  torch:       { radius: 3,  cone: false },
  lantern:     { radius: 6,  cone: false },
  bullseye:    { radius: 12, cone: true  },
  light_spell: { radius: 4,  cone: false },
  continual:   { radius: 12, cone: false },
  infravision: { radius: 12, cone: false },
};
const FACING_RAD = [
  -Math.PI/2, -Math.PI/4, 0, Math.PI/4, Math.PI/2, 3*Math.PI/4, Math.PI, -3*Math.PI/4
];

let fogMode = null; // 'reveal' | 'hide' | null
let fogCells = new Set();
let wallMode = null; // 'edge' | 'room' | null
let walls = new Map(); // "cx,cy,side" -> { kind, open }
let roomDrag = null; // {x1,y1,x2,y2}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (auth?.token) headers['x-player-token'] = auth.token;
  const res = await fetch(path, { ...opts, headers });
  if (!res.ok) throw new Error((await res.json()).error || res.statusText);
  return res.json();
}

$('btnDM').onclick = async () => {
  try {
    const r = await api('/api/login/dm', { method: 'POST', body: JSON.stringify({ password: $('dmpass').value, name: $('name').value || 'DM' }) });
    auth = r; localStorage.setItem('dg_auth', JSON.stringify(auth)); enterApp();
  } catch (e) { $('loginErr').textContent = e.message; }
};
$('btnPlayer').onclick = async () => {
  try {
    const r = await api('/api/login/player', { method: 'POST', body: JSON.stringify({ name: $('name').value }) });
    auth = r; localStorage.setItem('dg_auth', JSON.stringify(auth)); enterApp();
  } catch (e) { $('loginErr').textContent = e.message; }
};

function enterApp() {
  loginEl.classList.add('hidden');
  appEl.classList.remove('hidden');
  me = auth;
  document.body.classList.toggle('player', auth.role !== 'dm');
  $('meInfo').textContent = `${auth.name} (${auth.role})`;
  connectSocket();
}

function connectSocket() {
  socket = io({ auth: { token: auth.token } });
  socket.on('connect_error', (e) => { alert('Auth failed: ' + e.message); localStorage.removeItem('dg_auth'); location.reload(); });
  socket.on('state', (s) => { state = s; applyState(); });
  socket.on('token:update', ({ id, x, y }) => {
    const t = state?.tokens.find(t => t.id === id);
    if (t) { if (x !== undefined) t.x = x; if (y !== undefined) t.y = y; draw(); }
  });
  socket.on('fog:state', ({ data }) => { loadFog(data); draw(); });
  socket.on('walls:state', (list) => { loadWalls(list); draw(); });
  socket.on('chat:msg', onChat);
  socket.on('chat:cleared', () => { const c = $('chat'); if (c) c.innerHTML = ''; });
  socket.on('approval:request', () => {}); // legacy
}

let lastActiveMapId = null;
function applyState() {
  const m = state.activeMap;
  if (!m) return;
  if (lastActiveMapId !== m.id) {
    // Active map changed — reset per-map client state
    lastActiveMapId = m.id;
    bgImg = null;
    bgUrl = null;
    fogCells = new Set();
    walls = new Map();
    view = { scale: 1, ox: 20, oy: 20 };
    selectedTokenId = null;
  }
  renderMapList();
  $('mapName').textContent = m.name;
  $('gridType').value = m.grid_type;
  $('gridSize').value = m.grid_size;
  $('mapW').value = m.width;
  $('mapH').value = m.height;
  $('approval').checked = !!state.campaign.approval_mode;
  $('doorApproval').checked = !!state.campaign.door_approval;
  $('showOtherHp').checked = !!state.campaign.show_other_hp;
  $('ruleset').value = state.campaign.ruleset || '1e';
  loadFog(state.fog);
  loadWalls(state.walls || []);
  renderTokenList();
  renderOwners();
  renderPendings();
  renderDeployment();
  resizeCanvas();
  draw();
}

function renderDeployment() {
  const el = $('deployInfo');
  if (!el) return;
  const d = state.deployment;
  if (!d) { el.textContent = 'unknown'; return; }
  el.innerHTML = '';
  const sha = document.createElement('code');
  sha.textContent = d.shortSha || 'unknown';
  const sep = document.createTextNode(' · ');
  const subject = document.createElement('span');
  subject.className = 'deploy-subject';
  subject.textContent = d.subject || '';
  subject.title = d.subject || '';
  el.appendChild(sha);
  el.appendChild(sep);
  el.appendChild(subject);
}

function renderPendings() {
  const box = $('approvalBox');
  const moves = state.pendings || [];
  const doors = state.doorPendings || [];
  if (auth.role !== 'dm' || (!moves.length && !doors.length)) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  box.classList.remove('hidden');
  box.innerHTML = '<h4>Pending actions</h4>';
  for (const p of moves) {
    const t = state.tokens.find(x => x.id === p.id);
    const name = t?.name || `#${p.id}`;
    const row = document.createElement('div');
    row.className = 'pending';
    row.innerHTML = `<b>${escapeHtml(p.actor)}</b> move ${escapeHtml(name)} (${p.fromX},${p.fromY}) → (${p.toX},${p.toY})
      <br/><button class="ok">Approve</button> <button class="no">Deny</button>`;
    row.querySelector('.ok').onclick = () => socket.emit('approval:resolve', { approved: true, tokenId: p.id });
    row.querySelector('.no').onclick = () => socket.emit('approval:resolve', { approved: false, tokenId: p.id });
    box.appendChild(row);
  }
  for (const p of doors) {
    const row = document.createElement('div');
    row.className = 'pending';
    row.innerHTML = `<b>${escapeHtml(p.actor)}</b> wants to ${p.toOpen ? 'open' : 'close'} door @ (${p.cx},${p.cy},${p.side})
      <br/><button class="ok">Approve</button> <button class="no">Deny</button>`;
    row.querySelector('.ok').onclick = () => socket.emit('door:resolve', { approved: true, key: p.key });
    row.querySelector('.no').onclick = () => socket.emit('door:resolve', { approved: false, key: p.key });
    box.appendChild(row);
  }
}

function renderMapList() {
  const list = $('mapList');
  if (!list) return;
  list.innerHTML = '';
  const maps = state.maps || [];
  for (const m of maps) {
    const row = document.createElement('div');
    row.className = 'map-row' + (m.active ? ' active' : '');
    const nameSpan = document.createElement('span');
    nameSpan.className = 'map-name';
    nameSpan.textContent = m.name + (m.active ? ' (active)' : '');
    nameSpan.title = 'Click to rename';
    nameSpan.onclick = () => {
      const next = prompt('Rename map:', m.name);
      if (next && next.trim() && next !== m.name) {
        socket.emit('map:rename', { id: m.id, name: next.trim() });
      }
    };
    const btnAct = document.createElement('button');
    btnAct.textContent = 'Activate';
    btnAct.disabled = !!m.active;
    btnAct.onclick = () => socket.emit('map:activate', { id: m.id });
    const btnDup = document.createElement('button');
    btnDup.textContent = 'Duplicate';
    btnDup.onclick = () => socket.emit('map:duplicate', { id: m.id });
    const btnDel = document.createElement('button');
    btnDel.textContent = 'Delete';
    btnDel.onclick = () => {
      if (maps.length <= 1) { alert('Cannot delete the last map.'); return; }
      if (confirm(`Delete map "${m.name}"? This removes its tokens, walls, and fog.`)) {
        socket.emit('map:delete', { id: m.id });
      }
    };
    row.appendChild(nameSpan);
    row.appendChild(btnAct);
    row.appendChild(btnDup);
    row.appendChild(btnDel);
    list.appendChild(row);
  }
}

function renderTokenList() {
  const list = $('tokenList'); list.innerHTML = '';
  for (const t of state.tokens) {
    const row = document.createElement('div');
    row.className = 'tk';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.backgroundColor = t.color || '';
    const name = document.createElement('span');
    name.textContent = t.name || '';
    row.appendChild(dot);
    row.appendChild(name);
    row.onclick = () => openTokenDialog(t.id);
    list.appendChild(row);
  }
}
function renderOwners() {
  const sel = $('tkOwner');
  sel.innerHTML = '<option value="">(none)</option>';
  for (const p of state.players) if (p.role === 'player') {
    const o = document.createElement('option');
    o.value = p.id; o.textContent = p.name;
    sel.appendChild(o);
  }
}

// ---- Canvas ----
const canvas = $('board');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = (rect.height - 40) * dpr;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = (rect.height - 40) + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', () => { resizeCanvas(); draw(); });
if (window.ResizeObserver) {
  const ro = new ResizeObserver(() => { resizeCanvas(); draw(); });
  ro.observe(document.getElementById('sidebar'));
  ro.observe(document.getElementById('right'));
}

$('toggleLeft').onclick = () => {
  const el = $('sidebar');
  el.classList.toggle('collapsed');
  $('toggleLeft').textContent = el.classList.contains('collapsed') ? '›' : '‹';
  setTimeout(() => { resizeCanvas(); draw(); }, 0);
};
$('toggleRight').onclick = () => {
  const el = $('right');
  el.classList.toggle('collapsed');
  $('toggleRight').textContent = el.classList.contains('collapsed') ? '‹' : '›';
  setTimeout(() => { resizeCanvas(); draw(); }, 0);
};

// --- Side panel resize handles ---
// Pure clamp (mirrors lib/logic.js clampPanelWidth — tested there).
function _clampPanelW(w, min = 180, max = 600) {
  const n = Number(w);
  if (!Number.isFinite(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}
function initPanelResize(panelId, handleId, storageKey, edge, defaultW) {
  const panel = document.getElementById(panelId);
  const handle = document.getElementById(handleId);
  if (!panel || !handle) return;
  // Restore persisted width.
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved != null) panel.style.width = _clampPanelW(parseFloat(saved), 180, 600) + 'px';
    else panel.style.width = defaultW + 'px';
  } catch (_) {
    panel.style.width = defaultW + 'px';
  }
  let startX = 0, startW = 0, dragging = false;
  handle.addEventListener('mousedown', (e) => {
    dragging = true;
    startX = e.clientX;
    startW = panel.getBoundingClientRect().width;
    handle.classList.add('dragging');
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    // Left panel: right edge -> wider when dragging right (positive dx).
    // Right panel: left edge -> wider when dragging left (negative dx).
    const raw = edge === 'right' ? startW + dx : startW - dx;
    const w = _clampPanelW(raw, 180, 600);
    panel.style.width = w + 'px';
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    try {
      const w = panel.getBoundingClientRect().width;
      localStorage.setItem(storageKey, String(Math.round(w)));
    } catch (_) {}
  });
}
initPanelResize('sidebar', 'sidebarResize', 'dg_sidebar_w', 'right', 240);
initPanelResize('right',   'rightResize',   'dg_right_w',   'left',  260);

function worldToScreen(x, y) {
  return { x: x * view.scale + view.ox, y: y * view.scale + view.oy };
}
function screenToWorld(x, y) {
  return { x: (x - view.ox) / view.scale, y: (y - view.oy) / view.scale };
}

let bgImg = null;
let bgUrl = null;
function ensureBg() {
  const url = state?.activeMap?.background;
  if (url !== bgUrl) {
    bgUrl = url;
    if (url) { bgImg = new Image(); bgImg.onload = draw; bgImg.src = url; }
    else bgImg = null;
  }
}

function draw() {
  if (!state?.activeMap) return;
  ensureBg();
  const m = state.activeMap;
  const size = m.grid_size;
  const W = m.width * size;
  const H = m.height * size;

  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.translate(view.ox, view.oy);
  ctx.scale(view.scale, view.scale);

  // paper background
  ctx.fillStyle = '#f4ecd8';
  ctx.fillRect(0, 0, W, H);
  if (bgImg) {
    ctx.globalAlpha = 0.85;
    ctx.drawImage(bgImg, 0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  // grid
  ctx.strokeStyle = 'rgba(42,42,42,0.45)';
  ctx.lineWidth = 1;
  if (m.grid_type === 'square') drawSquareGrid(m.width, m.height, size);
  else drawHexGrid(m.width, m.height, size);

  const isDM = auth.role === 'dm';
  const cellVisible = (x, y) => !fogCells.has(`${x},${y}`);
  const tokenVisibleToMe = (t) => isDM || (t.owner_id && t.owner_id === me.playerId) || cellVisible(t.x, t.y);

  // light sources (soft glow) — only from tokens visible to me
  for (const t of state.tokens) {
    if (!tokenVisibleToMe(t)) continue;
    const preset = LIGHT_PRESETS[t.light_type || 'none'] || LIGHT_PRESETS.none;
    const r = (t.light_radius > 0 ? t.light_radius : preset.radius) * size;
    if (r <= 0) continue;
    const cx = (t.x + 0.5) * size, cy = (t.y + 0.5) * size;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(255, 220, 130, 0.38)');
    g.addColorStop(1, 'rgba(255, 220, 130, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    if (preset.cone) {
      const facing = FACING_RAD[(t.facing || 0) % 8];
      const half = Math.PI / 3; // 60° half-angle for playability
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, facing - half, facing + half);
      ctx.closePath();
    } else {
      ctx.arc(cx, cy, r, 0, Math.PI*2);
    }
    ctx.fill();
  }

  // fog overlay — rounded-light version.
  // Strategy (Option B, simplified): draw a solid fog rectangle over the
  // entire map, then carve out a soft radial hole for each party light
  // source using destination-out. The carve is clipped to the union of
  // server-visible cells so walls still occlude (the server's BFS is the
  // source of truth — see computeFog in lib/logic.js).
  if (fogCells.size) {
    // Build visible-cell rects once per frame (avoid per-light allocation).
    const visibleRects = [];
    for (let vx = 0; vx < m.width; vx++) {
      for (let vy = 0; vy < m.height; vy++) {
        if (!fogCells.has(`${vx},${vy}`)) {
          visibleRects.push(vx, vy);
        }
      }
    }

    ctx.save();
    // Offscreen-style layering: render fog into its own compositing group by
    // drawing solid fog, then destination-out carving, all within save/restore.
    ctx.fillStyle = isDM ? 'rgba(42,42,42,0.55)' : 'rgba(30,26,20,1)';
    ctx.fillRect(0, 0, W, H);

    if (visibleRects.length) {
      // Clip to union of visible cells so light cannot bleed past walls.
      ctx.beginPath();
      for (let i = 0; i < visibleRects.length; i += 2) {
        const vx = visibleRects[i], vy = visibleRects[i + 1];
        ctx.rect(vx * size, vy * size, size, size);
      }
      ctx.clip();

      ctx.globalCompositeOperation = 'destination-out';
      // Carve a soft circle for each party light source. Use a radial
      // gradient that is fully opaque in the center (fully erases fog) and
      // fades out toward the edge for a smooth lit/fogged transition.
      for (const t of state.tokens) {
        const isParty = t.kind === 'pc' || t.owner_id != null;
        if (!isParty) continue;
        if (!tokenVisibleToMe(t)) continue;
        const preset = LIGHT_PRESETS[t.light_type || 'none'] || LIGHT_PRESETS.none;
        const rCells = t.light_radius > 0 ? t.light_radius : preset.radius;
        if (rCells <= 0) continue;
        // Extend carve radius slightly past the server's hard cell radius so
        // the soft falloff lands on the cell boundary rather than inside it.
        const r = (rCells + 0.5) * size;
        const cx = (t.x + 0.5) * size, cy = (t.y + 0.5) * size;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0,    'rgba(0,0,0,1)');
        g.addColorStop(0.65, 'rgba(0,0,0,0.95)');
        g.addColorStop(1,    'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        if (preset.cone) {
          const facing = FACING_RAD[(t.facing || 0) % 8];
          const half = Math.PI / 3;
          ctx.moveTo(cx, cy);
          ctx.arc(cx, cy, r, facing - half, facing + half);
          ctx.closePath();
        } else {
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
        }
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }

  // walls & doors — visible if either bordering cell is visible (for players)
  ctx.lineCap = 'round';
  const pendingDoorKeys = new Set((state.doorPendings || []).map(d => d.key));
  for (const [key, info] of walls) {
    const [cx, cy, side] = key.split(',');
    const ix = +cx, iy = +cy;
    if (!isDM) {
      const a = cellVisible(ix, iy);
      const b = side === 'n' ? cellVisible(ix, iy - 1) : cellVisible(ix - 1, iy);
      if (!a && !b) continue;
    }
    const x = ix * size, y = iy * size;
    // edge endpoints
    const x1 = x, y1 = y;
    const x2 = side === 'n' ? x + size : x;
    const y2 = side === 'n' ? y : y + size;
    if (info.kind === 'wall') {
      ctx.strokeStyle = '#2a2a2a';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    } else if (info.kind === 'door') {
      // mid third = door leaf, outer thirds = wall flanking
      const fx = (x2 - x1), fy = (y2 - y1);
      const aX = x1 + fx * 0.2, aY = y1 + fy * 0.2;
      const bX = x1 + fx * 0.8, bY = y1 + fy * 0.8;
      ctx.strokeStyle = '#2a2a2a';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(aX, aY); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bX, bY); ctx.lineTo(x2, y2); ctx.stroke();
      if (!info.open) {
        // closed door: brown rectangle between a and b
        ctx.strokeStyle = '#6b3b1a';
        ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(aX, aY); ctx.lineTo(bX, bY); ctx.stroke();
        // small handle dot
        ctx.fillStyle = '#e8c77a';
        ctx.beginPath();
        ctx.arc((aX + bX) / 2 + (fy ? 3 : 0), (aY + bY) / 2 + (fx ? 3 : 0), 1.8, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // open door: two short brown ticks perpendicular to the edge at a and b
        ctx.strokeStyle = '#6b3b1a';
        ctx.lineWidth = 3;
        const nx = -fy / size, ny = fx / size; // unit perpendicular
        const L = size * 0.22;
        ctx.beginPath();
        ctx.moveTo(aX, aY); ctx.lineTo(aX + nx * L, aY + ny * L);
        ctx.moveTo(bX, bY); ctx.lineTo(bX + nx * L, bY + ny * L);
        ctx.stroke();
      }
      // pending indicator
      if (pendingDoorKeys.has(key)) {
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        ctx.fillStyle = 'rgba(122,46,46,0.9)';
        ctx.beginPath(); ctx.arc(mx, my, size * 0.18, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#f4ecd8';
        ctx.font = `bold ${Math.floor(size * 0.22)}px Georgia, serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('?', mx, my);
      }
    }
  }
  ctx.lineWidth = 1;

  // room drag preview
  if (roomDrag) {
    const { x1, y1, x2, y2 } = roomDrag;
    const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
    ctx.strokeStyle = 'rgba(122,46,46,0.8)';
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(minX * size, minY * size, (maxX - minX + 1) * size, (maxY - minY + 1) * size);
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
  }

  // pending approval ghosts — DM only
  if (isDM && state.pendings?.length) {
    for (const p of state.pendings) {
      const fx = (p.fromX + 0.5) * size, fy = (p.fromY + 0.5) * size;
      const tx = (p.toX + 0.5) * size, ty = (p.toY + 0.5) * size;
      ctx.save();
      ctx.strokeStyle = 'rgba(122,46,46,0.8)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(tx, ty); ctx.stroke();
      // ghost circle at destination
      ctx.beginPath();
      ctx.arc(tx, ty, size * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(244,236,216,0.6)';
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(122,46,46,0.9)';
      ctx.font = `${Math.floor(size * 0.2)}px Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', tx, ty);
      ctx.restore();
    }
  }

  // tokens — only those visible to me
  for (const t of state.tokens) {
    if (!tokenVisibleToMe(t)) continue;
    drawToken(t, size);
  }

  ctx.restore();
}

function drawSquareGrid(w, h, s) {
  for (let x = 0; x <= w; x++) {
    ctx.beginPath();
    ctx.moveTo(x * s, 0); ctx.lineTo(x * s, h * s);
    ctx.stroke();
  }
  for (let y = 0; y <= h; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * s); ctx.lineTo(w * s, y * s);
    ctx.stroke();
  }
}

function drawHexGrid(w, h, s) {
  // pointy-top hex with "size" as the cell width
  const r = s / 2;
  const hexH = r * 2;
  const hexW = Math.sqrt(3) * r;
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const cx = hexW * (col + (row % 2 ? 0.5 : 0)) + hexW/2;
      const cy = hexH * 0.75 * row + r;
      drawHex(cx, cy, r);
    }
  }
}
function drawHex(cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI/3 * i + Math.PI/6;
    const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
}

function drawToken(t, size) {
  const cx = (t.x + 0.5) * size;
  const cy = (t.y + 0.5) * size;
  const r = size * 0.42 * (t.size || 1);

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#f4ecd8';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = t.color || '#2a2a2a';
  ctx.stroke();

  // facing tick (small notch pointing outward)
  if (t.facing != null) {
    const a = FACING_RAD[t.facing % 8];
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r * 0.6, cy + Math.sin(a) * r * 0.6);
    ctx.lineTo(cx + Math.cos(a) * r * 1.05, cy + Math.sin(a) * r * 1.05);
    ctx.strokeStyle = t.color || '#2a2a2a';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.fillStyle = '#2a2a2a';
  ctx.font = `${Math.floor(size * 0.22)}px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(t.name.slice(0, 10), cx, cy);

  // HP bar visibility
  const canSeeHp = me.role === 'dm'
    || (t.owner_id && t.owner_id === me.playerId)
    || state.campaign.show_other_hp;
  if (canSeeHp && t.hp_max) {
    const pct = Math.max(0, Math.min(1, t.hp_current / t.hp_max));
    const bw = size * 0.8, bh = 5;
    const bx = cx - bw/2, by = cy + r + 3;
    ctx.fillStyle = '#e8deb9';
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = pct > 0.5 ? '#2a5a2a' : pct > 0.25 ? '#8a6a1a' : '#7a2e2e';
    ctx.fillRect(bx, by, bw * pct, bh);
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, bw, bh);
  }
  ctx.restore();
}

// ---- pointer / drag ----
canvas.addEventListener('mousedown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
  const w = screenToWorld(sx, sy);
  const m = state.activeMap;
  const size = m.grid_size;
  const cellX = Math.floor(w.x / size), cellY = Math.floor(w.y / size);

  if ((wallMode === 'edge' || wallMode === 'door') && auth.role === 'dm') {
    // nearest edge of the cell
    const lx = w.x - cellX * size;
    const ly = w.y - cellY * size;
    const dN = ly, dS = size - ly, dW = lx, dE = size - lx;
    const min = Math.min(dN, dS, dW, dE);
    let cx = cellX, cy = cellY, side = 'n';
    if (min === dN) { side = 'n'; }
    else if (min === dS) { side = 'n'; cy = cellY + 1; }
    else if (min === dW) { side = 'w'; }
    else { side = 'w'; cx = cellX + 1; }
    socket.emit(wallMode === 'door' ? 'door:cycle' : 'wall:toggle', { cx, cy, side });
    return;
  }
  if (wallMode === 'room' && auth.role === 'dm') {
    roomDrag = { x1: cellX, y1: cellY, x2: cellX, y2: cellY };
    dragging = { mode: 'room' };
    draw();
    return;
  }

  if (fogMode && auth.role === 'dm') {
    const key = `${cellX},${cellY}`;
    if (fogMode === 'reveal') fogCells.delete(key); else fogCells.add(key);
    draw();
    pushFog();
    return;
  }

  if (e.button === 2 || e.shiftKey) {
    dragging = { mode: 'pan', sx, sy, ox: view.ox, oy: view.oy };
    return;
  }

  // hit test a token
  for (let i = state.tokens.length - 1; i >= 0; i--) {
    const t = state.tokens[i];
    const cx = (t.x + 0.5) * size, cy = (t.y + 0.5) * size;
    const r = size * 0.42 * (t.size || 1);
    if ((w.x - cx)**2 + (w.y - cy)**2 <= r*r) {
      if (auth.role !== 'dm' && t.owner_id !== me.playerId) return;
      dragging = { mode: 'token', id: t.id, origX: t.x, origY: t.y };
      selectedTokenId = t.id;
      return;
    }
  }
  // hit test a door (near nearest edge, within ~1/3 cell)
  const lx = w.x - cellX * size, ly = w.y - cellY * size;
  const dN = ly, dS = size - ly, dW = lx, dE = size - lx;
  const minEdge = Math.min(dN, dS, dW, dE);
  if (minEdge < size * 0.25) {
    let ex = cellX, ey = cellY, eside = 'n';
    if (minEdge === dN) { eside = 'n'; }
    else if (minEdge === dS) { eside = 'n'; ey = cellY + 1; }
    else if (minEdge === dW) { eside = 'w'; }
    else { eside = 'w'; ex = cellX + 1; }
    const key = `${ex},${ey},${eside}`;
    const info = walls.get(key);
    if (info && info.kind === 'door') {
      // player (or DM without tool mode) click toggles via request
      socket.emit('door:request', { cx: ex, cy: ey, side: eside });
      return;
    }
  }
  dragging = { mode: 'pan', sx, sy, ox: view.ox, oy: view.oy };
});
canvas.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
  if (dragging.mode === 'room') {
    const w = screenToWorld(sx, sy);
    const size = state.activeMap.grid_size;
    roomDrag.x2 = Math.floor(w.x / size);
    roomDrag.y2 = Math.floor(w.y / size);
    draw();
    return;
  }
  if (dragging.mode === 'pan') {
    view.ox = dragging.ox + (sx - dragging.sx);
    view.oy = dragging.oy + (sy - dragging.sy);
    draw();
  } else if (dragging.mode === 'token') {
    const w = screenToWorld(sx, sy);
    const size = state.activeMap.grid_size;
    const t = state.tokens.find(t => t.id === dragging.id);
    if (t) {
      t.x = Math.floor(w.x / size);
      t.y = Math.floor(w.y / size);
      draw();
    }
  }
  if (fogMode && (e.buttons & 1) && auth.role === 'dm') {
    const w = screenToWorld(sx, sy);
    const size = state.activeMap.grid_size;
    const key = `${Math.floor(w.x/size)},${Math.floor(w.y/size)}`;
    if (fogMode === 'reveal') fogCells.delete(key); else fogCells.add(key);
    draw();
  }
});
canvas.addEventListener('mouseup', () => {
  if (dragging?.mode === 'token') {
    const t = state.tokens.find(t => t.id === dragging.id);
    if (t) {
      const targetX = t.x, targetY = t.y;
      // In approval mode, snap back to original until DM resolves
      if (state.campaign.approval_mode && auth.role !== 'dm') {
        t.x = dragging.origX; t.y = dragging.origY;
        draw();
      }
      socket.emit('token:move', { id: dragging.id, x: targetX, y: targetY });
    }
  }
  if (dragging?.mode === 'room' && roomDrag) {
    socket.emit('wall:rect', roomDrag);
    roomDrag = null;
    draw();
  }
  if (fogMode) pushFog();
  dragging = null;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
  const before = screenToWorld(sx, sy);
  view.scale *= e.deltaY < 0 ? 1.1 : 1/1.1;
  const after = screenToWorld(sx, sy);
  view.ox += (after.x - before.x) * view.scale;
  view.oy += (after.y - before.y) * view.scale;
  draw();
}, { passive: false });

$('btnZoomIn').onclick = () => { view.scale *= 1.15; draw(); };
$('btnZoomOut').onclick = () => { view.scale /= 1.15; draw(); };
$('btnReset').onclick = () => { view = { scale: 1, ox: 20, oy: 20 }; draw(); };

// ---- Map Library ----
$('newMap').onclick = () => {
  const name = prompt('New map name:', 'New Map');
  if (!name) return;
  const grid_type = prompt('Grid type (square or hex):', 'square') || 'square';
  const widthStr = prompt('Width in cells:', '30');
  const heightStr = prompt('Height in cells:', '20');
  const grid_size = parseInt(prompt('Cell px:', '50'), 10) || 50;
  const width = parseInt(widthStr, 10) || 30;
  const height = parseInt(heightStr, 10) || 20;
  socket.emit('map:create', { name: name.trim(), grid_type, grid_size, width, height, activate: true });
};

// ---- Undo ----
function doUndo() {
  if (auth.role !== 'dm') return;
  socket.emit('dm:undo');
}
$('btnUndo').onclick = doUndo;
$('btnUndo').addEventListener('mouseenter', () => {
  const label = state?.undoLabel;
  $('btnUndo').title = label ? `Undo: ${label}` : 'Nothing to undo (Ctrl+Z)';
});

$('btnUpdate').onclick = () => {
  if (auth.role !== 'dm') return;
  if (!confirm('Request an update? The server will git-pull and rebuild on the next host tick. Your session will briefly disconnect and auto-reconnect when the new build is up.')) return;
  socket.emit('dm:update-request');
};
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
    e.preventDefault();
    doUndo();
  }
});

// ---- Map settings ----
$('saveMap').onclick = () => {
  socket.emit('map:update', {
    grid_type: $('gridType').value,
    grid_size: parseInt($('gridSize').value, 10),
    width: parseInt($('mapW').value, 10),
    height: parseInt($('mapH').value, 10),
  });
};
$('bgFile').onchange = async () => {
  const file = $('bgFile').files[0];
  if (!file) return;
  const fd = new FormData(); fd.append('file', file);
  const res = await fetch('/api/upload', { method: 'POST', body: fd, headers: { 'x-player-token': auth.token } });
  const { url } = await res.json();
  socket.emit('map:update', { background: url });
};

$('approval').onchange = () => socket.emit('campaign:settings', { approval_mode: $('approval').checked ? 1 : 0 });
$('doorApproval').onchange = () => socket.emit('campaign:settings', { door_approval: $('doorApproval').checked ? 1 : 0 });
$('showOtherHp').onchange = () => socket.emit('campaign:settings', { show_other_hp: $('showOtherHp').checked ? 1 : 0 });
$('ruleset').onchange = () => socket.emit('campaign:settings', { ruleset: $('ruleset').value });

// ---- Token dialog ----
const dlg = $('tokenDialog');
$('addToken').onclick = () => openTokenDialog(null);
function openTokenDialog(id) {
  editingTokenId = id;
  const t = id ? state.tokens.find(t => t.id === id) : null;
  $('tkName').value = t?.name || '';
  $('tkKind').value = t?.kind || 'npc';
  $('tkHp').value = t?.hp_current ?? 10;
  $('tkHpMax').value = t?.hp_max ?? 10;
  $('tkAc').value = t?.ac ?? 10;
  $('tkLight').value = t?.light_radius ?? 0;
  $('tkLightType').value = t?.light_type || 'none';
  $('tkFacing').value = t?.facing ?? 0;
  $('tkColor').value = t?.color || '#2a2a2a';
  $('tkOwner').value = t?.owner_id || '';
  $('tkDelete').style.display = id && auth.role === 'dm' ? '' : 'none';
  dlg.showModal();
}
$('tkCancel').onclick = () => dlg.close();
$('tkSave').onclick = async () => {
  const data = {
    name: $('tkName').value || '?',
    kind: $('tkKind').value,
    hp_current: parseInt($('tkHp').value, 10),
    hp_max: parseInt($('tkHpMax').value, 10),
    ac: parseInt($('tkAc').value, 10),
    light_radius: parseInt($('tkLight').value, 10),
    light_type: $('tkLightType').value,
    facing: parseInt($('tkFacing').value, 10),
    color: $('tkColor').value,
    owner_id: $('tkOwner').value ? parseInt($('tkOwner').value, 10) : null,
  };
  const file = $('tkImage').files[0];
  if (file) {
    const fd = new FormData(); fd.append('file', file);
    const res = await fetch('/api/upload', { method: 'POST', body: fd, headers: { 'x-player-token': auth.token } });
    data.image = (await res.json()).url;
  }
  if (editingTokenId) {
    data.id = editingTokenId;
    socket.emit('token:update', data);
  } else {
    socket.emit('token:create', data);
  }
  dlg.close();
};
$('tkDelete').onclick = () => {
  if (editingTokenId) socket.emit('token:delete', { id: editingTokenId });
  dlg.close();
};

// ---- Fog ----
$('fogReveal').onclick = () => { fogMode = fogMode === 'reveal' ? null : 'reveal'; };
$('fogHide').onclick = () => { fogMode = fogMode === 'hide' ? null : 'hide'; };
$('fogClear').onclick = () => { fogCells = new Set(); pushFog(); draw(); };
$('fogAll').onclick = () => {
  const m = state.activeMap;
  fogCells = new Set();
  for (let x = 0; x < m.width; x++) for (let y = 0; y < m.height; y++) fogCells.add(`${x},${y}`);
  pushFog(); draw();
};
function pushFog() {
  socket.emit('fog:update', { data: JSON.stringify([...fogCells]) });
}
function loadFog(data) {
  try { fogCells = new Set(JSON.parse(data || '[]')); } catch { fogCells = new Set(); }
}
function loadWalls(list) {
  walls = new Map(list.map(w => [`${w.cx},${w.cy},${w.side}`, { kind: w.kind || 'wall', open: !!w.open }]));
}

// Wall tool buttons
function setWallMode(m) {
  wallMode = wallMode === m ? null : m;
  if (wallMode) fogMode = null;
  for (const id of ['wallEdge','wallRoom','doorTool']) $(id).classList.remove('active');
  if (wallMode === 'edge') $('wallEdge').classList.add('active');
  if (wallMode === 'room') $('wallRoom').classList.add('active');
  if (wallMode === 'door') $('doorTool').classList.add('active');
}
$('wallEdge').onclick = () => setWallMode('edge');
$('wallRoom').onclick = () => setWallMode('room');
$('doorTool').onclick = () => setWallMode('door');
$('wallClear').onclick = () => { if (confirm('Clear all walls and doors?')) socket.emit('wall:clear'); };

// ---- Dice + Chat ----
document.querySelectorAll('.dice button[data-d]').forEach(b => {
  b.onclick = () => socket.emit('dice:roll', { expr: b.dataset.d });
});
$('rollCustom').onclick = () => {
  const v = $('customDice').value.trim();
  if (v) socket.emit('dice:roll', { expr: v });
};
$('chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const v = e.target.value.trim();
    if (v) { socket.emit('chat:msg', { text: v }); e.target.value = ''; }
  }
});
$('chatClear').onclick = () => {
  if (confirm('Clear chat for everyone?')) socket.emit('chat:clear');
};
function onChat(m) {
  const el = document.createElement('div');
  el.className = 'msg' + (m.role === 'dm' ? ' dm' : '');
  el.innerHTML = `<span class="who">${escapeHtml(m.from)}:</span> ${escapeHtml(m.text)}`;
  const chat = $('chat');
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
}
function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }


// ---- facing hotkeys (Q/E rotate selected token) ----
document.addEventListener('keydown', (e) => {
  if (document.activeElement && ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) return;
  if (!selectedTokenId) return;
  const t = state?.tokens.find(t => t.id === selectedTokenId);
  if (!t) return;
  if (auth.role !== 'dm' && t.owner_id !== me.playerId) return;
  let delta = 0;
  if (e.key === 'q' || e.key === 'Q') delta = -1;
  else if (e.key === 'e' || e.key === 'E') delta = 1;
  else return;
  const facing = ((t.facing || 0) + delta + 8) % 8;
  socket.emit('token:update', { id: t.id, facing });
});

// ---- boot ----
if (auth) enterApp();
