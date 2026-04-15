// Dungeon Grid client
// Loaded as an ES module (<script type="module">) so we can import the same
// pure-logic helpers the server uses. Keeps one source of truth for wall
// collision and light/fog BFS across both sides.
import { LIGHT_PRESETS, computeRevealed, walkUntilBlocked, walkWithRange, getRaces, defaultMoveForRace, stackOffsets, effectiveLightRadius, pickByKindPriority, shouldMarkUnread, computeSeenTokenIds, formatLegendText, cacheBustedImageUrl, lightClipRadiusPx, hasLineOfSight, findCopyOffset, shouldStartPan, isTokenSelected } from '/lib/logic.js?v={{LIB_VERSION}}';
import { getCreatures, SIZE_MULTIPLIERS, sizeMultiplier } from '/lib/creatures.js?v={{LIB_VERSION}}';
import { getObjects } from '/lib/objects.js?v={{LIB_VERSION}}';
import { getSpells } from '/lib/spells.js?v={{LIB_VERSION}}';

// Map a numeric token-size multiplier back to the closest D&D size category
// label, for repopulating the Size <select> when editing an existing token.
function categoryForMultiplier(mult) {
  const n = Number(mult);
  if (!isFinite(n) || n <= 0) return 'medium';
  let best = 'medium';
  let bestDelta = Infinity;
  for (const [cat, m] of Object.entries(SIZE_MULTIPLIERS)) {
    const d = Math.abs(m - n);
    if (d < bestDelta) { bestDelta = d; best = cat; }
  }
  return best;
}

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
const FACING_RAD = [
  -Math.PI/2, -Math.PI/4, 0, Math.PI/4, Math.PI/2, 3*Math.PI/4, Math.PI, -3*Math.PI/4
];

let fogMode = null; // 'reveal' | 'hide' | null
let fogCells = new Set();
// Three-state fog: cells that have ever been observed by a party member.
// Subset of fogCells where we render dim "memory" instead of pitch black.
let exploredCells = new Set();
// Remembered tokens for explored-but-fogged cells: array of { cx, cy, snapshot }.
let memoryTokens = [];
// While a token is being dragged, we compute fog client-side so the light
// glides with the cursor instead of teleporting on mouseup. Null means "use
// the server's authoritative fogCells". Reset on mouseup and on fog:state.
let previewFogCells = null;
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
  // Auto-open help on first visit after login.
  if (!localStorage.getItem('dg_seen_help') && localStorage.getItem('dg_hide_help') !== '1') {
    setTimeout(() => openHelp(), 500);
  }
}

// ---- Help overlay ----
function openHelp() {
  const overlay = $('helpOverlay');
  if (!overlay) return;
  const roleLabel = auth && auth.role === 'dm' ? 'the <b>Dungeon Master</b>' : 'a <b>Player</b>';
  const intro = $('helpIntro');
  if (intro) {
    intro.innerHTML = `Welcome! You're playing as ${roleLabel}. Here's a quick tour of what the table can do — you can always reopen this from the <b>?</b> button in the toolbar.`;
  }
  const hide = $('helpHideAgain');
  if (hide) hide.checked = localStorage.getItem('dg_hide_help') === '1';
  overlay.classList.remove('hidden');
}
function closeHelp() {
  const overlay = $('helpOverlay');
  if (!overlay) return;
  overlay.classList.add('hidden');
  localStorage.setItem('dg_seen_help', '1');
  const hide = $('helpHideAgain');
  if (hide && hide.checked) localStorage.setItem('dg_hide_help', '1');
  else localStorage.removeItem('dg_hide_help');
}
function wireHelpOverlay() {
  const btn = $('btnHelp');
  if (btn) btn.addEventListener('click', openHelp);
  const closeBtn = $('helpClose');
  if (closeBtn) closeBtn.addEventListener('click', closeHelp);
  const overlay = $('helpOverlay');
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target.classList.contains('help-backdrop')) closeHelp();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay && !overlay.classList.contains('hidden')) {
      closeHelp();
    }
  });
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wireHelpOverlay);
} else {
  wireHelpOverlay();
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
    exploredCells = new Set();
    memoryTokens = [];
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
  $('mapFeet').value = m.cell_feet || 5;
  $('approval').checked = !!state.campaign.approval_mode;
  $('doorApproval').checked = !!state.campaign.door_approval;
  $('lightApproval').checked = !!state.campaign.light_approval;
  $('showOtherHp').checked = !!state.campaign.show_other_hp;
  $('ruleset').value = state.campaign.ruleset || '1e';
  loadFog(state.fog);
  loadExplored(state.explored || []);
  loadMemoryTokens(state.memoryTokens || []);
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
  const lights = state.lightPendings || [];
  if (auth.role !== 'dm' || (!moves.length && !doors.length && !lights.length)) {
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
  for (const p of lights) {
    const t = state.tokens.find(x => x.id === p.id);
    const name = t?.name || `#${p.id}`;
    const row = document.createElement('div');
    row.className = 'pending';
    const fromR = effectiveLightRadius(p.from);
    const toR = effectiveLightRadius(p.to);
    row.innerHTML = `<b>${escapeHtml(p.actor)}</b> wants to change ${escapeHtml(name)}'s light: ${escapeHtml(p.from.light_type)} → ${escapeHtml(p.to.light_type)} (radius ${fromR} → ${toR})
      <br/><button class="ok">Approve</button> <button class="no">Deny</button>`;
    row.querySelector('.ok').onclick = () => socket.emit('light:resolve', { approved: true, tokenId: p.id });
    row.querySelector('.no').onclick = () => socket.emit('light:resolve', { approved: false, tokenId: p.id });
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
  const isDM = auth && auth.role === 'dm';
  const seenIds = computeSeenTokenIds({
    tokens: state.tokens,
    fogCells,
    memoryTokens,
    playerId: me ? me.playerId : null,
    isDM,
  });
  for (const t of state.tokens) {
    if (!isDM && !seenIds.has(t.id)) continue;
    const row = document.createElement('div');
    row.className = 'tk' + (isTokenSelected(t.id, selectedTokenId) ? ' selected' : '');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.backgroundColor = t.color || '';
    const name = document.createElement('span');
    name.textContent = t.name || '';
    row.appendChild(dot);
    row.appendChild(name);
    row.onclick = () => {
      // Sync selection before opening the dialog so the canvas halo
      // and row highlight stay in lockstep when the dialog closes.
      selectedTokenId = t.id;
      draw();
      openTokenDialog(t.id);
    };
    list.appendChild(row);
  }
}
function renderOwners() {
  const sel = $('tkOwner');
  sel.innerHTML = '<option value="">(none)</option>';
  const active = new Set(state.activePlayerIds || []);
  // Active players get normal (selectable) options.
  for (const p of state.players) if (p.role === 'player' && active.has(p.id)) {
    const o = document.createElement('option');
    o.value = p.id; o.textContent = p.name;
    sel.appendChild(o);
  }
  // If the token currently being edited is owned by an offline player,
  // surface them as a disabled option so the DM can see who it belonged to.
  const t = editingTokenId ? state.tokens.find(x => x.id === editingTokenId) : null;
  if (t && t.owner_id && !active.has(t.owner_id)) {
    const offline = state.players.find(p => p.id === t.owner_id);
    if (offline) {
      const o = document.createElement('option');
      o.value = offline.id;
      o.textContent = `${offline.name} (offline)`;
      o.disabled = true;
      o.selected = true;
      sel.appendChild(o);
    }
  }
}

// ---- Canvas ----
const canvas = $('board');
const ctx = canvas.getContext('2d');

// ---- theme ----
// Pure helper: decide which theme to apply given a stored choice and system pref.
// Kept in sync with lib/logic.js#resolveTheme (which is unit tested).
function resolveTheme(stored, systemPref) {
  if (stored === 'light' || stored === 'dark') return stored;
  if (stored == null && systemPref === 'dark') return 'dark';
  return 'dark';
}

// Cached CSS var colors used by the canvas renderer. Refreshed on theme change.
const themeColors = {
  paper: '#f4ecd8',
  paperDark: '#e8deb9',
  ink: '#2a2a2a',
  inkSoft: '#5b5246',
  accent: '#7a2e2e',
  chatBg: '#fbf6e7',
  doorWood: '#6b3b1a',
  doorHandle: '#e8c77a',
  fogPlayer: 'rgba(30,26,20,1)',
  fogDm: 'rgba(42,42,42,0.55)',
  lightGlowInner: 'rgba(255, 220, 130, 0.38)',
  lightGlowOuter: 'rgba(255, 220, 130, 0)',
  gridLine: 'rgba(42,42,42,0.45)',
};
function getCssVar(name, fallback) {
  const v = getComputedStyle(document.body).getPropertyValue(name).trim();
  return v || fallback;
}
function refreshThemeColors() {
  themeColors.paper         = getCssVar('--paper',         themeColors.paper);
  themeColors.paperDark     = getCssVar('--paper-dark',    themeColors.paperDark);
  themeColors.ink           = getCssVar('--ink',           themeColors.ink);
  themeColors.inkSoft       = getCssVar('--ink-soft',      themeColors.inkSoft);
  themeColors.accent        = getCssVar('--accent',        themeColors.accent);
  themeColors.chatBg        = getCssVar('--chat-bg',       themeColors.chatBg);
  themeColors.doorWood      = getCssVar('--door-wood',     themeColors.doorWood);
  themeColors.doorHandle    = getCssVar('--door-handle',   themeColors.doorHandle);
  themeColors.fogPlayer     = getCssVar('--fog-player',    themeColors.fogPlayer);
  themeColors.fogDm         = getCssVar('--fog-dm',        themeColors.fogDm);
  themeColors.lightGlowInner= getCssVar('--light-glow-inner', themeColors.lightGlowInner);
  themeColors.lightGlowOuter= getCssVar('--light-glow-outer', themeColors.lightGlowOuter);
  themeColors.gridLine      = getCssVar('--grid-line',     themeColors.gridLine);
}
function applyTheme(theme) {
  document.body.classList.toggle('dark', theme === 'dark');
  refreshThemeColors();
  const btn = $('btnTheme');
  if (btn) {
    // moon in light mode (click -> go dark), sun in dark mode (click -> go light)
    btn.textContent = theme === 'dark' ? '\u2600' : '\u263E';
    btn.title = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  }
}
function currentTheme() {
  return document.body.classList.contains('dark') ? 'dark' : 'light';
}
function initTheme() {
  const stored = localStorage.getItem('dg_theme');
  const systemPref = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  applyTheme(resolveTheme(stored, systemPref));
}
// Apply before first draw so canvas picks up correct colors.
initTheme();

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
let chatUnread = false;
function markChatUnread(m) {
  const right = $('right');
  const isCollapsed = !!(right && right.classList.contains('collapsed'));
  const selfName = (typeof auth !== 'undefined' && auth) ? auth.name : null;
  if (!shouldMarkUnread({ isCollapsed, fromName: m && m.from, selfName })) return;
  chatUnread = true;
  const btn = $('toggleRight');
  if (btn) btn.classList.add('has-unread');
}
$('toggleRight').onclick = () => {
  const el = $('right');
  el.classList.toggle('collapsed');
  $('toggleRight').textContent = el.classList.contains('collapsed') ? '‹' : '›';
  if (!el.classList.contains('collapsed')) {
    chatUnread = false;
    $('toggleRight').classList.remove('has-unread');
  }
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

// Recompute fog client-side from the current token positions, using the same
// BFS that the server uses (computeRevealed in lib/logic.js). This is called
// during token drags so the light glides with the cursor. The server stays
// authoritative — on mouseup we emit token:move and the server recomputes
// and broadcasts the real fog:state, which clears the preview.
function recomputePreviewFog() {
  if (!state?.activeMap) { previewFogCells = null; return; }
  const m = state.activeMap;
  const lit = new Set();
  for (const t of state.tokens) {
    const isParty = t.kind === 'pc' || t.owner_id != null;
    if (!isParty) continue;
    // walls is a Map<string, {kind, open}> already in the right shape.
    for (const key of computeRevealed(t, m, walls)) lit.add(key);
  }
  const fog = new Set();
  for (let x = 0; x < m.width; x++) {
    for (let y = 0; y < m.height; y++) {
      const k = `${x},${y}`;
      if (!lit.has(k)) fog.add(k);
    }
  }
  previewFogCells = fog;
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

// Render an area-of-effect overlay (circle/cone/line/square) centered on
// the token's cell. Cones and lines use the token's `facing` field for
// orientation. Sizes are in cells; the canvas state is saved/restored
// internally so callers don't need to.
function drawAoeOverlay(token, aoe, cellSize) {
  if (!aoe || !aoe.shape) return;
  const cx = (token.x + 0.5) * cellSize;
  const cy = (token.y + 0.5) * cellSize;
  ctx.save();
  ctx.fillStyle = aoe.color || 'rgba(255,255,255,0.3)';
  if (aoe.shape === 'circle') {
    const r = (Number(aoe.radius) || 0) * cellSize;
    if (r > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (aoe.shape === 'square') {
    const side = (Number(aoe.side) || 0) * cellSize;
    if (side > 0) {
      const half = side / 2;
      ctx.fillRect(cx - half, cy - half, side, side);
    }
  } else if (aoe.shape === 'cone') {
    const r = (Number(aoe.radius) || 0) * cellSize;
    const angDeg = Number(aoe.angle) || 60;
    if (r > 0) {
      const facing = FACING_RAD[(token.facing || 0) % 8];
      const half = (angDeg * Math.PI / 180) / 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, facing - half, facing + half);
      ctx.closePath();
      ctx.fill();
    }
  } else if (aoe.shape === 'line') {
    const len = (Number(aoe.length) || 0) * cellSize;
    const wid = (Number(aoe.width)  || 1) * cellSize;
    if (len > 0 && wid > 0) {
      const facing = FACING_RAD[(token.facing || 0) % 8];
      ctx.translate(cx, cy);
      ctx.rotate(facing);
      ctx.fillRect(0, -wid / 2, len, wid);
    }
  }
  ctx.restore();
}

function draw() {
  if (!state?.activeMap) return;
  ensureBg();
  const m = state.activeMap;
  const size = m.grid_size;
  const W = m.width * size;
  const H = m.height * size;
  // Use the client-side preview fog while dragging a lit token, otherwise
  // the server's authoritative fog. Every fog read in draw() must go
  // through this local alias so the light flows with the cursor.
  const displayFog = previewFogCells || fogCells;

  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.translate(view.ox, view.oy);
  ctx.scale(view.scale, view.scale);

  // paper background
  ctx.fillStyle = themeColors.paper;
  ctx.fillRect(0, 0, W, H);
  if (bgImg) {
    ctx.globalAlpha = 0.85;
    ctx.drawImage(bgImg, 0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  // grid
  ctx.strokeStyle = themeColors.gridLine;
  ctx.lineWidth = 1;
  if (m.grid_type === 'square') drawSquareGrid(m.width, m.height, size);
  else drawHexGrid(m.width, m.height, size);

  const isDM = auth.role === 'dm';
  const cellVisible = (x, y) => !displayFog.has(`${x},${y}`);
  const tokenVisibleToMe = (t) => isDM || (t.owner_id && t.owner_id === me.playerId) || cellVisible(t.x, t.y);
  // Effect tokens (spell AOEs: fireball, cone of cold, lightning bolt, ...)
  // are bright explosive magical events. A player should see one if any
  // party member has a clear line of sight to the effect's origin, even if
  // the viewer's own cell is dark. Walls and closed doors still block.
  // DMs always see all effects.
  const effectVisibleToMe = (t) => {
    if (isDM) return true;
    for (const p of state.tokens) {
      const isParty = p.kind === 'pc' || p.owner_id != null;
      if (!isParty) continue;
      if (hasLineOfSight(p.x, p.y, t.x, t.y, walls)) return true;
    }
    return false;
  };

  // fog overlay — rounded-light version (two-pass per-light clip).
  //
  // For each party light source we build a single clip region that is the
  // intersection of (a) the union of server-visible cells around the light
  // and (b) a circle (or cone) of the light's pixel radius. Canvas `clip()`
  // calls compose as intersections, so we save/restore once per light and
  // layer two clips. Inside that clip we do a flat destination-out carve of
  // the fog — no soft radial falloff, since the circle clip provides the
  // clean edge (this eliminates the cardinal-direction "finger" artifacts
  // that appeared when the gradient's fade ended before the cell edge).
  //
  // After carving, we re-enter the same clip with source-over and paint a
  // warm radial "firelight" fill, so that in dark mode (where the revealed
  // --paper is near black) the lit area actually looks lit. This replaces
  // the old separate "soft glow" pass that ran before the fog.
  // Three-layer fog: unexplored cells get the dark "fogPlayer/fogDm" color
  // (same as before), explored-but-not-lit cells get a dim memory overlay.
  // Both are painted as solid layers up front; the per-light carve below
  // then removes whichever cells are currently lit using destination-out.
  if (displayFog.size) {
    ctx.save();
    // Unexplored: paint only cells in fog AND NOT in exploredCells.
    // For DMs, exploredCells is irrelevant — they see everything, so use
    // the existing fogDm fill across the full fog set.
    if (isDM || !exploredCells.size) {
      ctx.fillStyle = isDM ? themeColors.fogDm : themeColors.fogPlayer;
      ctx.fillRect(0, 0, W, H);
    } else {
      // Players: paint unexplored cells solid, then memory cells dim on top.
      ctx.fillStyle = themeColors.fogPlayer;
      ctx.beginPath();
      let anyUnex = false;
      for (const k of displayFog) {
        if (exploredCells.has(k)) continue;
        const comma = k.indexOf(',');
        const cx = +k.slice(0, comma), cy = +k.slice(comma + 1);
        ctx.rect(cx * size, cy * size, size, size);
        anyUnex = true;
      }
      if (anyUnex) ctx.fill();
      // Memory layer — dim so walls/ghost tokens stay legible.
      ctx.fillStyle = 'rgba(30,25,20,0.78)';
      ctx.beginPath();
      let anyMem = false;
      for (const k of displayFog) {
        if (!exploredCells.has(k)) continue;
        const comma = k.indexOf(',');
        const cx = +k.slice(0, comma), cy = +k.slice(comma + 1);
        ctx.rect(cx * size, cy * size, size, size);
        anyMem = true;
      }
      if (anyMem) ctx.fill();
    }
    ctx.restore();
  }

  // Helper: build the clip path for a single light's shape (circle or cone)
  // intersected with the union of visible cells inside the light's bounding
  // box. We only walk cells within the bounding radius to keep per-light
  // cost O(r^2) rather than O(map).
  const buildLightClip = (t, preset) => {
    const rCells = t.light_radius > 0 ? t.light_radius : preset.radius;
    if (rCells <= 0) return null;
    const cx = (t.x + 0.5) * size, cy = (t.y + 0.5) * size;
    // Visual clip radius extends half a cell past the nominal cell count so
    // cardinal-direction cells at the edge of the lit BFS render fully (their
    // outer edge falls inside the circle instead of halfway across them).
    // The server's computeRevealed BFS is unchanged and remains the source of
    // truth for which cells are lit; this only affects the client-side clip.
    const rPx = lightClipRadiusPx(rCells, size);
    // Visible cells inside the light's bounding box, trimmed to map bounds.
    const minX = Math.max(0, t.x - rCells - 1);
    const maxX = Math.min(m.width  - 1, t.x + rCells + 1);
    const minY = Math.max(0, t.y - rCells - 1);
    const maxY = Math.min(m.height - 1, t.y + rCells + 1);
    return { cx, cy, rPx, rCells, preset, minX, maxX, minY, maxY };
  };

  const applyLightClip = (info) => {
    // First clip: visible cells in the light's bounding box. The server's
    // BFS fog is still the source of truth for wall occlusion.
    ctx.beginPath();
    for (let vx = info.minX; vx <= info.maxX; vx++) {
      for (let vy = info.minY; vy <= info.maxY; vy++) {
        if (displayFog.has(`${vx},${vy}`)) continue;
        ctx.rect(vx * size, vy * size, size, size);
      }
    }
    ctx.clip();
    // Second clip: circle or cone. Canvas intersects with the prior clip.
    ctx.beginPath();
    if (info.preset.cone) {
      ctx.moveTo(info.cx, info.cy);
      ctx.arc(info.cx, info.cy, info.rPx, info.coneStart, info.coneEnd);
      ctx.closePath();
    } else {
      ctx.arc(info.cx, info.cy, info.rPx, 0, Math.PI * 2);
    }
    ctx.clip();
  };

  // Iterate party light sources once; two-pass per light (carve, then glow).
  for (const t of state.tokens) {
    const isParty = t.kind === 'pc' || t.owner_id != null;
    if (!isParty) continue;
    if (!tokenVisibleToMe(t)) continue;
    const preset = LIGHT_PRESETS[t.light_type || 'none'] || LIGHT_PRESETS.none;
    const info = buildLightClip(t, preset);
    if (!info) continue;
    if (preset.cone) {
      const facing = FACING_RAD[(t.facing || 0) % 8];
      const half = Math.PI / 3;
      info.coneStart = facing - half;
      info.coneEnd   = facing + half;
    }

    // Pass 1: carve the fog hole with a flat destination-out fill.
    if (displayFog.size) {
      ctx.save();
      applyLightClip(info);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,1)';
      ctx.fillRect(info.minX * size, info.minY * size,
                   (info.maxX - info.minX + 1) * size,
                   (info.maxY - info.minY + 1) * size);
      ctx.restore();
    }

    // Pass 2: paint a warm firelight fill on top of the revealed area.
    ctx.save();
    applyLightClip(info);
    const warmInner = themeColors.lightWarmInner || 'rgba(255, 180, 90, 0.55)';
    const warmOuter = themeColors.lightWarmOuter || 'rgba(255, 150, 70, 0.15)';
    const wg = ctx.createRadialGradient(info.cx, info.cy, 0, info.cx, info.cy, info.rPx);
    wg.addColorStop(0, warmInner);
    wg.addColorStop(1, warmOuter);
    ctx.fillStyle = wg;
    ctx.fillRect(info.minX * size, info.minY * size,
                 (info.maxX - info.minX + 1) * size,
                 (info.maxY - info.minY + 1) * size);
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
      // Also show walls/doors that border an explored (memory) cell so the
      // remembered room layout stays visible after the party leaves.
      const aMem = exploredCells.has(`${ix},${iy}`);
      const bKey = side === 'n' ? `${ix},${iy - 1}` : `${ix - 1},${iy}`;
      const bMem = exploredCells.has(bKey);
      if (!a && !b && !aMem && !bMem) continue;
    }
    const x = ix * size, y = iy * size;
    // edge endpoints
    const x1 = x, y1 = y;
    const x2 = side === 'n' ? x + size : x;
    const y2 = side === 'n' ? y : y + size;
    if (info.kind === 'wall') {
      ctx.strokeStyle = themeColors.ink;
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    } else if (info.kind === 'door') {
      // mid third = door leaf, outer thirds = wall flanking
      const fx = (x2 - x1), fy = (y2 - y1);
      const aX = x1 + fx * 0.2, aY = y1 + fy * 0.2;
      const bX = x1 + fx * 0.8, bY = y1 + fy * 0.8;
      ctx.strokeStyle = themeColors.ink;
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(aX, aY); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bX, bY); ctx.lineTo(x2, y2); ctx.stroke();
      if (!info.open) {
        // closed door: brown rectangle between a and b
        ctx.strokeStyle = themeColors.doorWood;
        ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(aX, aY); ctx.lineTo(bX, bY); ctx.stroke();
        // small handle dot
        ctx.fillStyle = themeColors.doorHandle;
        ctx.beginPath();
        ctx.arc((aX + bX) / 2 + (fy ? 3 : 0), (aY + bY) / 2 + (fx ? 3 : 0), 1.8, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // open door: two short brown ticks perpendicular to the edge at a and b
        ctx.strokeStyle = themeColors.doorWood;
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
        ctx.fillStyle = themeColors.paper;
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

  // movement range cue: dashed circle around the drag origin. Player only —
  // DMs bypass the cap so they don't need the cue.
  if (dragging?.mode === 'token' && auth.role !== 'dm' && Number.isFinite(dragging.moveBudget)) {
    const cx = (dragging.origX + 0.5) * size;
    const cy = (dragging.origY + 0.5) * size;
    const radius = dragging.moveBudget * size;
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = themeColors.accent || 'rgba(122,46,46,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
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

  // AOE overlays for spell effect tokens. Drawn UNDER regular tokens so
  // monster tokens stay visible inside e.g. a fireball, but ABOVE the
  // floor/grid/walls so the colored region clearly reads as a magical
  // effect. Effects obey the same fog rules as other tokens.
  for (const t of state.tokens) {
    if (t.kind !== 'effect') continue;
    // Effects use LOS-based visibility, not the lit-cell rule that
    // tokenVisibleToMe applies — see effectVisibleToMe above.
    if (!effectVisibleToMe(t)) continue;
    let aoe = null;
    try { aoe = t.aoe ? JSON.parse(t.aoe) : null; } catch { aoe = null; }
    if (!aoe) continue;
    drawAoeOverlay(t, aoe, size);
  }

  // tokens — only those visible to me. Group by cell so stacked tokens
  // can be fanned out and optionally badged with a count.
  {
    const byCell = new Map();
    for (const t of state.tokens) {
      // Effects use LOS visibility (see effectVisibleToMe); everything else
      // uses the lit-cell rule. Keeps the stacked-token marker for an effect
      // in sync with whether its AOE overlay is shown.
      const visible = t.kind === 'effect' ? effectVisibleToMe(t) : tokenVisibleToMe(t);
      if (!visible) continue;
      const key = `${t.x},${t.y}`;
      let arr = byCell.get(key);
      if (!arr) { arr = []; byCell.set(key, arr); }
      arr.push(t);
    }
    for (const [, toks] of byCell) {
      const offs = stackOffsets(toks.length, size);
      for (let i = 0; i < toks.length; i++) {
        drawToken(toks[i], size, offs[i]);
      }
      if (toks.length > 1) {
        drawStackBadge(toks[0].x, toks[0].y, size, toks.length);
      }
    }
  }

  // Memory tokens: ghosted remembered tokens in fogged-but-explored cells.
  // DMs already see real tokens through fog so we skip; players only see
  // memory in cells that are NOT currently lit.
  if (!isDM && memoryTokens && memoryTokens.length) {
    for (const mt of memoryTokens) {
      const key = `${mt.cx},${mt.cy}`;
      if (!displayFog.has(key)) continue; // currently lit -> real token shown
      if (!exploredCells.has(key)) continue;
      ctx.save();
      ctx.globalAlpha = 0.4;
      drawMemoryToken(mt.snapshot, mt.cx, mt.cy, size);
      ctx.restore();
    }
  }

  ctx.restore();

  // Screen-space scale legend (bottom-right corner).
  // Reset to device-pixel transform so the legend stays put while panning/zooming.
  drawScaleLegend(m, size);
}

function drawScaleLegend(m, gridSize) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.width / dpr;
  const cssH = canvas.height / dpr;
  const cellFeet = m.cell_feet || 5;

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const pad = 12;
  const boxW = 140;
  const boxH = 44;
  // Clamp so the legend is always visible on tiny canvases.
  let x = cssW - boxW - pad;
  let y = cssH - boxH - pad;
  if (x < pad) x = Math.max(0, (cssW - boxW) / 2);
  if (y < pad) y = Math.max(0, (cssH - boxH) / 2);

  // Rounded rect background (paper @ 80%) with ink border.
  const r = 6;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + boxW - r, y);
  ctx.quadraticCurveTo(x + boxW, y, x + boxW, y + r);
  ctx.lineTo(x + boxW, y + boxH - r);
  ctx.quadraticCurveTo(x + boxW, y + boxH, x + boxW - r, y + boxH);
  ctx.lineTo(x + r, y + boxH);
  ctx.quadraticCurveTo(x, y + boxH, x, y + boxH - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = themeColors.paper;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = themeColors.ink;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Text: "1 sq = N ft"
  ctx.fillStyle = themeColors.ink;
  ctx.font = '11px Georgia, serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(formatLegendText(cellFeet), x + 10, y + 7);

  // Scale bar: 4 cells wide at the current zoom, clamped to box width.
  const cells = 4;
  const maxBar = boxW - 20 - 40; // leave room for label on the right
  let barLen = cells * gridSize * view.scale;
  if (barLen > maxBar) barLen = maxBar;
  if (barLen < 4) barLen = 4;
  const barX = x + 10;
  const barY = y + 28;
  ctx.strokeStyle = themeColors.ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(barX, barY);
  ctx.lineTo(barX + barLen, barY);
  ctx.stroke();
  // End ticks
  ctx.beginPath();
  ctx.moveTo(barX, barY - 3); ctx.lineTo(barX, barY + 3);
  ctx.moveTo(barX + barLen, barY - 3); ctx.lineTo(barX + barLen, barY + 3);
  ctx.stroke();
  ctx.lineWidth = 1;

  ctx.textBaseline = 'middle';
  ctx.fillText(`${cells * cellFeet} ft`, barX + barLen + 6, barY);

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

// Build a deploy-versioned URL for /creatures/* images so a new deploy
// forces browsers and the Cloudflare edge to re-fetch icon SVGs whose
// filenames stayed the same but whose bytes changed. Uploads pass through.
function bustImageUrl(url) {
  const sha = (state && state.deployment && state.deployment.shortSha) || 'dev';
  return cacheBustedImageUrl(url, sha);
}

// Module-level cache of loaded token images, keyed by (cache-busted) URL.
const tokenImageCache = new Map();
function getTokenImage(url) {
  const key = bustImageUrl(url);
  let entry = tokenImageCache.get(key);
  if (entry) return entry;
  entry = { img: new Image(), status: 'loading' };
  entry.img.onload = () => { entry.status = 'loaded'; draw(); };
  entry.img.onerror = () => { entry.status = 'error'; };
  entry.img.src = key;
  tokenImageCache.set(key, entry);
  return entry;
}

function drawToken(t, size, offset) {
  const ox = offset ? offset.dx : 0;
  const oy = offset ? offset.dy : 0;
  const cx = (t.x + 0.5) * size + ox;
  const cy = (t.y + 0.5) * size + oy;
  const r = size * 0.42 * (t.size || 1);

  // Look up cached image (if any). Fall back to plain circle until loaded/on error.
  let imgEntry = null;
  if (t.image) imgEntry = getTokenImage(t.image);
  const hasImage = !!(imgEntry && imgEntry.status === 'loaded' && imgEntry.img.complete);

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  if (!hasImage) {
    ctx.fillStyle = themeColors.paper;
    ctx.fill();
  }

  if (hasImage) {
    // Clip to the circle and draw the portrait inside it.
    ctx.save();
    ctx.clip();
    // Slight desaturate/contrast tweak so it blends with the pencil aesthetic.
    const prevFilter = ctx.filter;
    try { ctx.filter = 'saturate(0.7) contrast(1.05)'; } catch (_) {}
    ctx.drawImage(imgEntry.img, cx - r, cy - r, r * 2, r * 2);
    try { ctx.filter = prevFilter || 'none'; } catch (_) {}
    ctx.restore();
  }

  // Border stroke (drawn on top of image so it frames the portrait).
  ctx.lineWidth = 2;
  ctx.strokeStyle = t.color || themeColors.ink;
  ctx.stroke();

  // facing arrowhead (short shaft + small filled triangle)
  if (t.facing != null) {
    const a = FACING_RAD[t.facing % 8];
    const cosA = Math.cos(a), sinA = Math.sin(a);
    const tipX = cx + cosA * r * 1.1;
    const tipY = cy + sinA * r * 1.1;
    const headLen = size * 0.18;
    const halfWidth = size * 0.1;
    const baseX = tipX - cosA * headLen;
    const baseY = tipY - sinA * headLen;
    const perpX = -sinA, perpY = cosA;
    const facingColor = t.color || themeColors.ink;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // shaft
    ctx.beginPath();
    ctx.moveTo(cx + cosA * r * 0.55, cy + sinA * r * 0.55);
    ctx.lineTo(baseX, baseY);
    ctx.strokeStyle = facingColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    // triangular arrowhead
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(baseX + perpX * halfWidth, baseY + perpY * halfWidth);
    ctx.lineTo(baseX - perpX * halfWidth, baseY - perpY * halfWidth);
    ctx.closePath();
    ctx.fillStyle = facingColor;
    ctx.fill();
  }

  ctx.font = `${Math.floor(size * 0.22)}px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const label = t.name ? t.name.slice(0, 10) : '';
  if (hasImage) {
    // Render the name as a small dark-backdrop pill BELOW the token so it
    // doesn't overlap the portrait. HP bar (if any) will draw below this.
    const padX = 4, padY = 2;
    const fontPx = Math.floor(size * 0.18);
    ctx.font = `${fontPx}px Georgia, serif`;
    const textW = ctx.measureText(label).width;
    const pillW = textW + padX * 2;
    const pillH = fontPx + padY * 2;
    const px = cx - pillW / 2;
    const py = cy + r + 3;
    ctx.fillStyle = 'rgba(20,20,20,0.75)';
    ctx.fillRect(px, py, pillW, pillH);
    ctx.strokeStyle = themeColors.ink;
    ctx.lineWidth = 1;
    ctx.strokeRect(px, py, pillW, pillH);
    ctx.fillStyle = '#f5f1e6';
    ctx.textBaseline = 'top';
    ctx.fillText(label, cx, py + padY);
    ctx.textBaseline = 'middle';
  } else {
    ctx.fillStyle = themeColors.ink;
    ctx.fillText(label, cx, cy);
  }

  // HP bar visibility
  const canSeeHp = me.role === 'dm'
    || (t.owner_id && t.owner_id === me.playerId)
    || state.campaign.show_other_hp;
  if (canSeeHp && t.hp_max) {
    const pct = Math.max(0, Math.min(1, t.hp_current / t.hp_max));
    const bw = size * 0.8, bh = 5;
    // If an image is present, the name pill is drawn below the token — push
    // the HP bar further down so they don't overlap.
    const pillOffset = hasImage ? (Math.floor(size * 0.18) + 6) : 0;
    const bx = cx - bw/2, by = cy + r + 3 + pillOffset;
    ctx.fillStyle = themeColors.paperDark;
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = pct > 0.5 ? '#2a5a2a' : pct > 0.25 ? '#8a6a1a' : '#7a2e2e';
    ctx.fillRect(bx, by, bw * pct, bh);
    ctx.strokeStyle = themeColors.ink;
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, bw, bh);
  }

  // Selection halo: dashed accent ring drawn on top of the token so
  // the user sees which token is currently selected (mirrors the
  // sidebar row highlight). Drawn after the body/border/HP so it isn't
  // hidden behind any later art passes in this function.
  if (isTokenSelected(t.id, selectedTokenId)) {
    ctx.save();
    ctx.strokeStyle = themeColors.accent || '#c77a4a';
    ctx.lineWidth = 3;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

// Render a remembered token snapshot as a ghost: just a circle outline +
// portrait (if cached) at reduced opacity. No HP bar, no facing arrow, no
// pending indicators. Caller is responsible for setting globalAlpha.
function drawMemoryToken(snap, gx, gy, size) {
  if (!snap) return;
  const cx = (gx + 0.5) * size;
  const cy = (gy + 0.5) * size;
  const r = size * 0.42 * (snap.size || 1);
  let imgEntry = null;
  if (snap.image) imgEntry = getTokenImage(snap.image);
  const hasImage = !!(imgEntry && imgEntry.status === 'loaded' && imgEntry.img.complete);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = themeColors.paper;
  ctx.fill();
  if (hasImage) {
    ctx.save();
    ctx.clip();
    const prevFilter = ctx.filter;
    try { ctx.filter = 'saturate(0.2) contrast(0.9)'; } catch (_) {}
    ctx.drawImage(imgEntry.img, cx - r, cy - r, r * 2, r * 2);
    try { ctx.filter = prevFilter || 'none'; } catch (_) {}
    ctx.restore();
  }
  ctx.lineWidth = 2;
  ctx.strokeStyle = snap.color || themeColors.ink;
  ctx.setLineDash([3, 3]);
  ctx.stroke();
  ctx.setLineDash([]);
  if (snap.name) {
    ctx.font = `${Math.floor(size * 0.2)}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = themeColors.ink;
    ctx.fillText(snap.name.slice(0, 10), cx, cy);
  }
}

// Small circular badge showing "xN" in the top-right corner of a cell when
// multiple tokens are stacked in it.
function drawStackBadge(cellX, cellY, size, n) {
  const br = size * 0.14;
  const bx = (cellX + 1) * size - br - 2;
  const by = cellY * size + br + 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(bx, by, br, 0, Math.PI * 2);
  ctx.fillStyle = themeColors.accent;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = themeColors.ink;
  ctx.stroke();
  ctx.fillStyle = themeColors.paper;
  ctx.font = `bold ${Math.max(9, Math.floor(size * 0.18))}px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`\u00d7${n}`, bx, by + 1);
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

  // Explicit pan modifier: shift, middle-click, or right-click.
  // Must run before token hit-test so users can pan even when the
  // cursor happens to be over a token.
  if (shouldStartPan(e)) {
    dragging = { mode: 'pan', sx, sy, ox: view.ox, oy: view.oy };
    canvas.style.cursor = 'grabbing';
    return;
  }

  // hit test tokens: collect ALL hits, then prioritize by role/kind so
  // furniture (kind='object') doesn't block clicks on creatures the user
  // actually wants to drag. Iterate in reverse so within a kind the most
  // recently inserted token still wins.
  const candidates = [];
  for (let i = state.tokens.length - 1; i >= 0; i--) {
    const t = state.tokens[i];
    const cx = (t.x + 0.5) * size, cy = (t.y + 0.5) * size;
    const r = size * 0.42 * (t.size || 1);
    if ((w.x - cx)**2 + (w.y - cy)**2 <= r*r) candidates.push(t);
  }
  let chosen = null;
  if (candidates.length) {
    if (auth.role === 'dm') {
      chosen = pickByKindPriority(candidates, ['pc', 'npc', 'monster', 'object', 'effect']);
    } else {
      chosen = candidates.find((t) => t.owner_id === me.playerId) || null;
    }
  }
  if (chosen) {
    // Track the last unblocked cell so that wall collisions during the
    // drag can "slide" the token instead of teleporting it through walls.
    // DM drags skip the wall check (same as the server), so lastValid is
    // only used for players but we always initialize it for symmetry.
    dragging = {
      mode: 'token',
      id: chosen.id,
      origX: chosen.x,
      origY: chosen.y,
      lastValidX: chosen.x,
      lastValidY: chosen.y,
      moveBudget: Number.isFinite(chosen.move) ? chosen.move : 6,
    };
    selectedTokenId = chosen.id;
    renderTokenList();
    draw();
    return;
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
  // Map is "locked" against accidental panning: plain left-click on
  // empty space is a no-op. Pan requires an explicit modifier
  // (shift / middle / right) — handled by the shouldStartPan branch
  // above.
  // Plain click on empty space (no token, no tool mode, no pan) also
  // deselects any currently selected token so the halo clears.
  if (selectedTokenId != null) {
    selectedTokenId = null;
    draw();
    renderTokenList();
  }
});
canvas.addEventListener('mousemove', (e) => {
  if (!dragging) {
    // Cursor hint: shift = "you can pan" (grab), otherwise default crosshair.
    canvas.style.cursor = e.shiftKey ? 'grab' : 'crosshair';
    return;
  }
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
    const m = state.activeMap;
    const size = m.grid_size;
    const t = state.tokens.find(t => t.id === dragging.id);
    if (t) {
      const targetX = Math.max(0, Math.min(m.width  - 1, Math.floor(w.x / size)));
      const targetY = Math.max(0, Math.min(m.height - 1, Math.floor(w.y / size)));
      if (auth.role === 'dm') {
        // DM moves freely — same bypass the server uses.
        t.x = targetX;
        t.y = targetY;
        dragging.lastValidX = targetX;
        dragging.lastValidY = targetY;
      } else {
        // Players slide along walls. Bresenham-walk from the last unblocked
        // cell toward the cursor, stopping at the first blocked edge. This
        // matches the server's BFS wall rule (cardinals via isBlocked and
        // diagonals requiring both orthogonals open).
        // Distance cap: walk from origin (not lastValid) so the budget is
        // measured against the original mousedown cell, and the token sticks
        // at the last cell within move range.
        const { x: nx, y: ny } = walkWithRange(
          dragging.origX, dragging.origY,
          targetX, targetY,
          walls,
          dragging.moveBudget,
        );
        dragging.lastValidX = nx;
        dragging.lastValidY = ny;
        t.x = nx;
        t.y = ny;
      }
      // Live light/fog preview: only meaningful for party lights, but cheap
      // to recompute unconditionally. The server re-broadcasts authoritative
      // fog on mouseup and clears the preview then.
      recomputePreviewFog();
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
      // lastValidX/Y is what the collision walker settled on; it equals the
      // raw cursor cell for DMs and the last unblocked cell for players.
      // Approval queue gets the same collided destination, not the raw mouse
      // target, so players can't propose impossible moves.
      const targetX = dragging.lastValidX;
      const targetY = dragging.lastValidY;
      // In approval mode, snap back to original until DM resolves
      if (state.campaign.approval_mode && auth.role !== 'dm') {
        t.x = dragging.origX; t.y = dragging.origY;
      }
      // Drop the client-side fog preview — the server will broadcast the
      // authoritative fog:state in response to this move.
      previewFogCells = null;
      draw();
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
  canvas.style.cursor = 'crosshair';
});
// Shift key acts as a pan affordance hint — update cursor while hovering.
window.addEventListener('keydown', (e) => {
  if (e.key === 'Shift' && !dragging) canvas.style.cursor = 'grab';
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'Shift' && !dragging) canvas.style.cursor = 'crosshair';
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
$('btnReset').onclick = () => {
  // Recenter on the active map so a user who accidentally panned
  // (or held shift and dragged) can un-stick themselves quickly.
  const m = state.activeMap;
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.width / dpr;
  const cssH = canvas.height / dpr;
  if (m && m.grid_size) {
    const mapW = m.width * m.grid_size;
    const mapH = m.height * m.grid_size;
    view = { scale: 1, ox: Math.max(20, (cssW - mapW) / 2), oy: Math.max(20, (cssH - mapH) / 2) };
  } else {
    view = { scale: 1, ox: 20, oy: 20 };
  }
  draw();
};

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

$('btnTheme').onclick = () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  localStorage.setItem('dg_theme', next);
  applyTheme(next);
  if (typeof draw === 'function' && state) draw();
};
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
    cell_feet: Math.max(1, Math.min(100, parseInt($('mapFeet').value, 10) || 5)),
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
$('clearBg').onclick = () => {
  if (!confirm('Clear the background image for this map?')) return;
  $('bgFile').value = '';
  socket.emit('map:update', { background: null });
};
$('btnRandomMap').onclick = () => {
  if (!confirm('Replace all walls/doors on this map with a random dungeon? This cannot be undone globally, but each wall change is still in the undo stack for the session.')) return;
  socket.emit('map:generate-random');
};

$('approval').onchange = () => socket.emit('campaign:settings', { approval_mode: $('approval').checked ? 1 : 0 });
$('doorApproval').onchange = () => socket.emit('campaign:settings', { door_approval: $('doorApproval').checked ? 1 : 0 });
$('lightApproval').onchange = () => socket.emit('campaign:settings', { light_approval: $('lightApproval').checked ? 1 : 0 });
$('showOtherHp').onchange = () => socket.emit('campaign:settings', { show_other_hp: $('showOtherHp').checked ? 1 : 0 });
$('ruleset').onchange = () => socket.emit('campaign:settings', { ruleset: $('ruleset').value });

// ---- Token dialog ----
const dlg = $('tokenDialog');
let pendingPresetImage = null;
// When a spell preset is picked, we stash its AOE shape config here so the
// next token:create / token:update payload includes it as JSON.
let pendingAoe = null;
$('addToken').onclick = () => openTokenDialog(null);
let clearImageRequested = false;
function presetListFor(kind) {
  // Objects are not ruleset-keyed; creatures and spells are. Returns [] for
  // kinds that don't have a preset catalog (e.g. 'pc').
  if (kind === 'object') return getObjects();
  if (kind === 'monster' || kind === 'npc') {
    const ruleset = state?.campaign?.ruleset || '1e';
    return getCreatures(ruleset, kind);
  }
  if (kind === 'effect') {
    const ruleset = state?.campaign?.ruleset || '1e';
    return getSpells(ruleset).damage || [];
  }
  return [];
}
function populatePresetList(kind) {
  const sel = $('tkPreset');
  sel.innerHTML = '<option value="">(none — manual)</option>';
  const list = presetListFor(kind);
  for (const c of list) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    sel.appendChild(opt);
  }
  sel.value = '';
}
function refreshPresetRow() {
  const kind = $('tkKind').value;
  const show = (kind === 'monster' || kind === 'npc' || kind === 'object' || kind === 'effect');
  $('tkPresetRow').style.display = show ? '' : 'none';
  populatePresetList(kind);
}
function setPreviewSrc(imgEl, src) {
  if (src) {
    // Apply the same /creatures/* cache-bust used for canvas token images so
    // preset preview and "current image" panes see the current deploy bytes.
    imgEl.src = bustImageUrl(src);
    imgEl.style.display = '';
  } else {
    imgEl.removeAttribute('src');
    imgEl.style.display = 'none';
  }
}
function resetTokenImagePreview(currentSrc) {
  pendingPresetImage = null;
  setPreviewSrc($('tkImgCurrent'), currentSrc || '');
  setPreviewSrc($('tkImgPreview'), '');
  try { $('tkImage').value = ''; } catch {}
}
function populateRaceList() {
  const sel = $('tkRace');
  if (!sel) return;
  const ruleset = state?.campaign?.ruleset || '1e';
  const races = getRaces(ruleset);
  sel.innerHTML = '<option value="">(none)</option>' +
    races.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
}
function openTokenDialog(id) {
  editingTokenId = id;
  const t = id ? state.tokens.find(t => t.id === id) : null;
  // Re-render the owner dropdown so the editing-token's offline-owner
  // (if any) gets a placeholder option.
  renderOwners();
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
  // Reset image inputs / clear-flag for the new editing session.
  $('tkImage').value = '';
  clearImageRequested = false;
  $('tkClearImage').style.display = t && t.image ? '' : 'none';
  populateRaceList();
  $('tkRace').value = t?.race || '';
  $('tkMove').value = t?.move ?? 6;
  if ($('tkSize')) $('tkSize').value = categoryForMultiplier(t?.size ?? 1);
  $('tkDelete').style.display = id && auth.role === 'dm' ? '' : 'none';
  $('tkCopy').style.display = id && auth.role === 'dm' ? '' : 'none';
  resetTokenImagePreview(t?.image || '');
  // Re-hydrate any stored AOE shape config so an existing effect token
  // round-trips its shape if the user edits it without picking a preset.
  pendingAoe = null;
  if (t && t.kind === 'effect' && t.aoe) {
    try { pendingAoe = JSON.parse(t.aoe); } catch { pendingAoe = null; }
  }
  refreshPresetRow();
  dlg.showModal();
}
$('tkClearImage').onclick = () => {
  clearImageRequested = true;
  $('tkImage').value = '';
  $('tkClearImage').style.display = 'none';
  pendingPresetImage = null;
  setPreviewSrc($('tkImgPreview'), '');
  setPreviewSrc($('tkImgCurrent'), '');
};
$('tkKind').onchange = () => { refreshPresetRow(); };
$('tkPreset').onchange = () => {
  const id = $('tkPreset').value;
  if (!id) return;
  const kind = $('tkKind').value;
  const list = presetListFor(kind);
  const preset = list.find(c => c.id === id);
  if (!preset) return;
  $('tkName').value = preset.name;
  if (kind === 'effect') {
    // Spell presets carry shape geometry instead of HP/AC. Stash the
    // AOE config so the next save persists it as JSON on the token.
    pendingAoe = { shape: preset.shape, color: preset.color };
    if (preset.radius != null) pendingAoe.radius = preset.radius;
    if (preset.angle  != null) pendingAoe.angle  = preset.angle;
    if (preset.length != null) pendingAoe.length = preset.length;
    if (preset.width  != null) pendingAoe.width  = preset.width;
    if (preset.side   != null) pendingAoe.side   = preset.side;
  } else {
    $('tkHp').value = preset.hp;
    $('tkHpMax').value = preset.hp;
    $('tkAc').value = preset.ac;
  }
  if (preset.color && typeof preset.color === 'string' && preset.color.startsWith('#')) {
    $('tkColor').value = preset.color;
  }
  pendingPresetImage = preset.image;
  clearImageRequested = false;
  setPreviewSrc($('tkImgPreview'), preset.image);
  if ($('tkSize') && preset.size) $('tkSize').value = preset.size;
  if (preset.move != null) $('tkMove').value = preset.move;
  // Light-source object presets carry a light_type — propagate it and
  // clear the custom radius override so the preset's default radius wins.
  if (preset.light_type) {
    $('tkLightType').value = preset.light_type;
    $('tkLight').value = 0;
  }
};
$('tkImage').onchange = () => {
  const file = $('tkImage').files[0];
  if (file) { clearImageRequested = false; }
  if (!file) { setPreviewSrc($('tkImgPreview'), pendingPresetImage || ''); return; }
  const reader = new FileReader();
  reader.onload = () => setPreviewSrc($('tkImgPreview'), reader.result);
  reader.readAsDataURL(file);
};
// Auto-fill move when user picks a race in the dialog.
if ($('tkRace')) {
  $('tkRace').addEventListener('change', () => {
    const ruleset = state?.campaign?.ruleset || '1e';
    const raceId = $('tkRace').value;
    if (!raceId) return;
    $('tkMove').value = defaultMoveForRace(ruleset, raceId);
  });
}
$('tkCancel').onclick = () => { resetTokenImagePreview(''); clearImageRequested = false; dlg.close(); };
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
    race: $('tkRace').value || null,
    move: parseInt($('tkMove').value, 10) || 6,
    size: sizeMultiplier($('tkSize') ? $('tkSize').value : 'medium'),
  };
  const file = $('tkImage').files[0];
  if (file) {
    const fd = new FormData(); fd.append('file', file);
    const res = await fetch('/api/upload', { method: 'POST', body: fd, headers: { 'x-player-token': auth.token } });
    data.image = (await res.json()).url;
  } else if (clearImageRequested) {
    data.image = null;
  } else if (pendingPresetImage) {
    data.image = pendingPresetImage;
  }
  if (data.kind === 'effect' && pendingAoe) {
    data.aoe = JSON.stringify(pendingAoe);
  }
  if (editingTokenId) {
    data.id = editingTokenId;
    socket.emit('token:update', data);
  } else {
    socket.emit('token:create', data);
  }
  pendingPresetImage = null;
  pendingAoe = null;
  dlg.close();
};
$('tkDelete').onclick = () => {
  if (editingTokenId) socket.emit('token:delete', { id: editingTokenId });
  dlg.close();
};
$('tkCopy').onclick = () => {
  if (!editingTokenId) return;
  const t = state.tokens.find(x => x.id === editingTokenId);
  if (!t) return;
  const m = state.activeMap;
  if (!m) return;
  const occupied = new Set(state.tokens.map(x => `${x.x},${x.y}`));
  const { x, y } = findCopyOffset(t.x, t.y, occupied, m.width, m.height);
  const copy = {
    kind: t.kind, name: t.name,
    hp_current: t.hp_current, hp_max: t.hp_max, ac: t.ac,
    color: t.color, image: t.image, size: t.size, race: t.race,
    move: t.move, light_type: t.light_type, light_radius: t.light_radius,
    facing: t.facing, owner_id: t.owner_id, aoe: t.aoe,
    x, y,
  };
  socket.emit('token:create', copy);
  dlg.close();
};

// ---- Fog ----
$('fogReveal').onclick = () => { fogMode = fogMode === 'reveal' ? null : 'reveal'; };
$('fogHide').onclick = () => { fogMode = fogMode === 'hide' ? null : 'hide'; };
const memBtn = $('memoryClear');
if (memBtn) memBtn.onclick = () => {
  if (confirm('Clear all party memory for this map?')) socket.emit('memory:clear');
};
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
  // Any authoritative fog from the server trumps the drag-time preview.
  previewFogCells = null;
}
function loadExplored(list) {
  exploredCells = new Set(Array.isArray(list) ? list : []);
}
function loadMemoryTokens(list) {
  memoryTokens = Array.isArray(list) ? list : [];
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
  markChatUnread(m);
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

// Esc deselects the currently selected token. Native <dialog> elements
// consume Escape themselves, so this only fires when no modal is open.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (selectedTokenId == null) return;
  selectedTokenId = null;
  draw();
  renderTokenList();
});

// ---- boot ----
if (auth) enterApp();
