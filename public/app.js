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
let fogMode = null; // 'reveal' | 'hide' | null
let fogCells = new Set();

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
  socket.on('chat:msg', onChat);
  socket.on('approval:request', (r) => {
    if (auth.role !== 'dm') return;
    showApproval(r);
  });
  socket.on('approval:resolved', () => { $('approvalBox').classList.add('hidden'); });
}

function applyState() {
  const m = state.activeMap;
  if (!m) return;
  $('mapName').textContent = m.name;
  $('gridType').value = m.grid_type;
  $('gridSize').value = m.grid_size;
  $('mapW').value = m.width;
  $('mapH').value = m.height;
  $('approval').checked = !!state.campaign.approval_mode;
  $('showOtherHp').checked = !!state.campaign.show_other_hp;
  $('ruleset').value = state.campaign.ruleset || '1e';
  loadFog(state.fog);
  renderTokenList();
  renderOwners();
  resizeCanvas();
  draw();
}

function renderTokenList() {
  const list = $('tokenList'); list.innerHTML = '';
  for (const t of state.tokens) {
    const row = document.createElement('div');
    row.className = 'tk';
    row.innerHTML = `<span class="dot" style="background:${t.color}"></span><span>${t.name}</span>`;
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

  // light sources (soft circles)
  for (const t of state.tokens) {
    if (!t.light_radius) continue;
    const cx = (t.x + 0.5) * size, cy = (t.y + 0.5) * size;
    const r = t.light_radius * size;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(255, 220, 130, 0.35)');
    g.addColorStop(1, 'rgba(255, 220, 130, 0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.fill();
  }

  // fog overlay (drawn as dark paper patches)
  if (fogCells.size) {
    ctx.fillStyle = 'rgba(42,42,42,0.82)';
    for (const key of fogCells) {
      const [fx, fy] = key.split(',').map(Number);
      ctx.fillRect(fx * size, fy * size, size, size);
    }
  }

  // tokens
  for (const t of state.tokens) drawToken(t, size);

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
      dragging = { mode: 'token', id: t.id };
      selectedTokenId = t.id;
      return;
    }
  }
  dragging = { mode: 'pan', sx, sy, ox: view.ox, oy: view.oy };
});
canvas.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
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
    if (t) socket.emit('token:move', { id: t.id, x: t.x, y: t.y });
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
function onChat(m) {
  const el = document.createElement('div');
  el.className = 'msg' + (m.role === 'dm' ? ' dm' : '');
  el.innerHTML = `<span class="who">${escapeHtml(m.from)}:</span> ${escapeHtml(m.text)}`;
  const chat = $('chat');
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
}
function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// ---- Approval ----
function showApproval(r) {
  const box = $('approvalBox');
  box.classList.remove('hidden');
  box.innerHTML = `<b>${r.actor}</b> wants to ${r.kind}<br/>
    <button id="apYes">Approve</button> <button id="apNo">Deny</button>`;
  $('apYes').onclick = () => socket.emit('approval:resolve', { approved: true, kind: r.kind, payload: r.payload });
  $('apNo').onclick = () => socket.emit('approval:resolve', { approved: false, kind: r.kind, payload: r.payload });
}

// ---- boot ----
if (auth) enterApp();
